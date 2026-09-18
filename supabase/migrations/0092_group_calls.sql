-- 0092 — group calls: adding people to a call
--
-- A call was two people on one row of `calls`, sharing an Agora channel.
-- Adding a third needs three things:
--
--   1. A way to RING them into the same channel. An invite is a `calls` row of
--      its own - caller = whoever invited, callee = the invitee, channel = the
--      root call's, root_id pointing at the root. The invitee's phone rings
--      exactly as for a direct call (the client listens for inserts where it
--      is the callee), accept and decline are unchanged, and accepting opens a
--      call screen that resolves the root and joins ITS channel.
--
--   2. A record of WHO IS IN the call: call_members, one row per person per
--      channel, written only by triggers on `calls` (insert -> ringing,
--      accepted -> joined, declined / missed -> the same, root ended ->
--      everyone left). The client never writes membership except its own
--      "I left".
--
--   3. Hang-up that means "I left": leave_call() marks your row left, and when
--      fewer than two people remain joined the root call is ended - which is
--      what every participant's screen watches. Clients from 1.4.12 and before
--      hang up by ending the root row directly; that still works, and that
--      path marks everyone left.
--
-- Reading: a member of the channel may read (and update) every calls row of
-- that channel - the invitee has to read the root, and either side may turn
-- the call into a video call or end it, which is what an old client's hang-up
-- already did. guard_call_participants (0048) still stops the participants of
-- a row being changed.

-- ── 1. An invite points at its root call ────────────────────────────────

alter table public.calls add column if not exists root_id uuid references public.calls(id) on delete cascade;
create index if not exists idx_calls_root_id on public.calls (root_id);
create index if not exists idx_calls_channel on public.calls (channel);

-- ── 2. Who is in the call ───────────────────────────────────────────────

create table if not exists public.call_members (
  channel    text not null,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  root_id    uuid references public.calls (id) on delete cascade,
  invited_by uuid references public.profiles (id) on delete set null,
  status     text not null default 'ringing'
             check (status in ('ringing', 'joined', 'left', 'declined', 'missed')),
  agora_uid  bigint,
  created_at timestamptz not null default now(),
  joined_at  timestamptz,
  left_at    timestamptz,
  primary key (channel, user_id)
);
create index if not exists idx_call_members_root on public.call_members (root_id);
alter table public.call_members enable row level security;
-- Every column in the realtime payload, so a screen filtering on `channel`
-- sees updates as well as inserts.
alter table public.call_members replica identity full;

-- The membership test, as is_chat_member (0018): SECURITY DEFINER so a policy
-- on call_members can use it without recursing into itself.
create or replace function public.is_call_member(p_channel text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.call_members m
     where m.channel = p_channel and m.user_id = auth.uid()
  );
$$;
revoke all on function public.is_call_member(text) from public;
grant execute on function public.is_call_member(text) to authenticated;

drop policy if exists "call members read" on public.call_members;
create policy "call members read" on public.call_members
  for select to authenticated
  using (public.is_call_member(channel));

-- Your own row (agora_uid). Leaving goes through leave_call below.
drop policy if exists "call members update own" on public.call_members;
create policy "call members update own" on public.call_members
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
-- No insert or delete policy: rows are written by the triggers below.

-- ── 3. Members of a channel may read and update its calls rows ──────────

drop policy if exists "calls read own" on public.calls;
create policy "calls read own" on public.calls
  for select to authenticated
  using (caller_id = auth.uid() or callee_id = auth.uid() or public.is_call_member(channel));

drop policy if exists "calls update participant" on public.calls;
create policy "calls update participant" on public.calls
  for update to authenticated
  using (caller_id = auth.uid() or callee_id = auth.uid() or public.is_call_member(channel))
  with check (caller_id = auth.uid() or callee_id = auth.uid() or public.is_call_member(channel));

-- ── 4. calls -> members ─────────────────────────────────────────────────

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
    set status    = excluded.status,
        root_id   = coalesce(public.call_members.root_id, excluded.root_id),
        joined_at = case when excluded.status = 'joined'
                         then coalesce(public.call_members.joined_at, now())
                         else public.call_members.joined_at end,
        left_at   = case when excluded.status in ('left', 'declined', 'missed')
                         then now() else public.call_members.left_at end;
end;
$$;

create or replace function public.calls_sync_members()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_root uuid;
begin
  v_root := coalesce(new.root_id, new.id);

  if tg_op = 'INSERT' then
    if new.root_id is null then
      -- A direct call: the caller is in from the start.
      perform public.call_member_set(new.channel, new.caller_id, v_root, null, 'joined');
    end if;
    -- The callee - of the call or of the invite - is ringing (or already in,
    -- for a row written as accepted).
    perform public.call_member_set(new.channel, new.callee_id, v_root, new.caller_id,
                                   case when new.status = 'accepted' then 'joined' else 'ringing' end);
    return null;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'accepted' then
      perform public.call_member_set(new.channel, new.callee_id, v_root, new.caller_id, 'joined');
    elsif new.status in ('declined', 'missed') then
      perform public.call_member_set(new.channel, new.callee_id, v_root, new.caller_id, new.status);
    elsif new.status = 'ended' and new.root_id is null then
      -- The root call is over: whoever was still in it has left, whoever was
      -- still ringing was missed - and so were any invites still ringing.
      update public.call_members set status = 'left',   left_at = now() where channel = new.channel and status = 'joined';
      update public.call_members set status = 'missed', left_at = now() where channel = new.channel and status = 'ringing';
      update public.calls set status = 'missed', ended_at = now() where root_id = new.id and status = 'ringing';
    elsif new.status = 'ended' and new.root_id is not null then
      -- An invite row ended: the inviter cancelled a ring, or an old client
      -- hung up by ending the row it was opened with.
      perform public.call_member_set(new.channel, new.callee_id, v_root, new.caller_id,
                                     case when old.status = 'ringing' then 'missed' else 'left' end);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists tr_calls_sync_members on public.calls;
create trigger tr_calls_sync_members
  after insert or update on public.calls
  for each row execute function public.calls_sync_members();

-- ── 5. members -> the root call: fewer than two left in it means it is over ──

create or replace function public.call_members_end_root()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare n_joined integer;
begin
  if new.status = 'left' and old.status is distinct from new.status and new.root_id is not null then
    select count(*) into n_joined from public.call_members
     where channel = new.channel and status = 'joined';
    if n_joined < 2 then
      -- Only an ACCEPTED root: a call still ringing is the caller's to cancel.
      update public.calls set status = 'ended', ended_at = now()
       where id = new.root_id and status = 'accepted';
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists tr_call_members_end_root on public.call_members;
create trigger tr_call_members_end_root
  after update on public.call_members
  for each row execute function public.call_members_end_root();

-- ── 6. "I left" ─────────────────────────────────────────────────────────

-- True when there was a membership row to leave. False for a call that
-- predates this migration (no rows): the client then ends the root itself,
-- as before.
create or replace function public.leave_call(p_channel text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.call_members set status = 'left', left_at = now()
   where channel = p_channel and user_id = auth.uid() and status = 'joined';
  return found;
end;
$$;
revoke all on function public.leave_call(text) from public;
grant execute on function public.leave_call(text) to authenticated;

-- ── 7. Realtime: screens watch the members of their channel ─────────────

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and tablename = 'call_members') then
    execute 'alter publication supabase_realtime add table public.call_members';
  end if;
end $$;
