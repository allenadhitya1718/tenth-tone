-- 0094 — group calls, second pass: what the first real invites showed
--
-- Every invite tried between real accounts on 18 Sep ended 'missed', and the
-- one that was answered was undone two seconds later by a second invite for
-- the same person. Four causes; three are here, the fourth (a call push that
-- opened a call screen with no Accept on it) is in the client.
--
--   1. call_member_set() overwrote status unconditionally. A 'ringing' write
--      landed on a 'joined' row and threw that person out of the membership,
--      and the next hang-up ended the call for everyone (fewer than two
--      'joined'). A live member is never demoted by a ring, a decline or a
--      miss again; only 'left' and the root ending move them.
--   2. leave_call() only knew 'joined'. Someone rung from a push who never
--      reached 'joined' had nothing to leave, so the client fell back to
--      ending the ROOT - one person leaving hung up on everyone. A ringing
--      member leaving now declines their own invite instead, and the function
--      reports that as handled.
--   3. Invites paid the per-pair call rate limit (10 an hour), so retrying an
--      Add that seemed not to work locked the pair out. Invites keep the
--      overall cap and skip the per-pair one.
--   4. Nothing stopped an invite - or a call - across a block, and an invite
--      could ring a person into a channel with someone they had blocked. Both
--      refused at insert, with the word 'blocked' for the client to show.

-- ── 1. A live member is never demoted by a later ring ──────────────────

create or replace function public.call_member_set(p_channel text, p_user uuid, p_root uuid, p_by uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.call_members (channel, user_id, root_id, invited_by, status, joined_at, left_at)
  values (p_channel, p_user, p_root, p_by, p_status,
          case when p_status = 'joined' then now() end,
          case when p_status in ('left', 'declined', 'missed') then now() end)
  on conflict (channel, user_id) do update
    set status     = case
                       when public.call_members.status = 'joined'
                        and excluded.status in ('ringing', 'declined', 'missed') then 'joined'
                       else excluded.status
                     end,
        root_id    = coalesce(public.call_members.root_id, excluded.root_id),
        invited_by = coalesce(public.call_members.invited_by, excluded.invited_by),
        joined_at  = case
                       when excluded.status = 'joined' and public.call_members.status <> 'joined' then now()
                       else public.call_members.joined_at
                     end,
        left_at    = case
                       when excluded.status = 'left' then now()
                       when excluded.status in ('declined', 'missed')
                        and public.call_members.status <> 'joined' then now()
                       when excluded.status = 'joined' then null
                       else public.call_members.left_at
                     end;
end;
$$;

-- ── 2. Leaving while still 'ringing' ───────────────────────────────────

create or replace function public.leave_call(p_channel text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  update public.call_members set status = 'left', left_at = now()
   where channel = p_channel and user_id = auth.uid() and status = 'joined';
  get diagnostics n = row_count;
  if n > 0 then return true; end if;
  -- Rung into this channel and never joined: decline the invite(s) that
  -- rang us. tr_calls_sync_members marks the membership declined; the root
  -- is untouched (call_members_end_root counts only 'left').
  update public.calls set status = 'declined', ended_at = now()
   where channel = p_channel and callee_id = auth.uid()
     and root_id is not null and status = 'ringing';
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- ── 3. Invites skip the per-pair cap ───────────────────────────────────

create or replace function public.check_call_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare n_total integer; n_callee integer;
begin
  select count(*) into n_total from public.calls
   where caller_id = new.caller_id
     and created_at > now() - interval '1 hour';
  perform public.rate_limit_exceeded(n_total, 20, 'calls');

  if new.root_id is null then
    select count(*) into n_callee from public.calls
     where caller_id = new.caller_id
       and callee_id = new.callee_id
       and root_id is null
       and created_at > now() - interval '1 hour';
    perform public.rate_limit_exceeded(n_callee, 10, 'calls to this person');
  end if;
  return new;
end;
$$;

-- ── 4. No call and no invite across a block ────────────────────────────

create or replace function public.guard_call_block()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_blocked_between(new.caller_id, new.callee_id) then
    raise exception 'blocked';
  end if;
  if new.root_id is not null and exists (
       select 1 from public.call_members m
        where m.channel = new.channel
          and m.status in ('joined', 'ringing')
          and m.user_id <> new.callee_id
          and public.is_blocked_between(m.user_id, new.callee_id)) then
    raise exception 'blocked';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_call_block on public.calls;
create trigger trg_call_block
  before insert on public.calls
  for each row execute function public.guard_call_block();
