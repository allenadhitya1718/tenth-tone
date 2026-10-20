-- 0145 (PROPOSAL, NOT APPLIED) - calling a group chat
--
-- A group chat had no call button because a call needed ONE callee: the root
-- calls row is "caller rang callee", and its status is both that callee's
-- answer and the state of the whole call. Ringing a group with that shape
-- (root to the first member, invites to the rest) breaks as soon as the first
-- member declines or misses: the root turns 'declined' / 'missed', every
-- screen watching it (the caller's and every invitee's) ends the call, and
-- no further invite can be made into it - while the others may still be
-- answering.
--
-- So a group call gets a root that is nobody's ring:
--
--   * calls.group_chat_id: the group chat a call was started from. Set only
--     on that root, only by start_group_call() below.
--   * The root is caller = callee = the person calling, status 'accepted'
--     from the start (the call exists; the caller is in it). It never rings
--     anybody: notify_on_call (0093) only pushes 'ringing' rows, and the apps
--     only ring for 'ringing' rows where they are the callee. Its chat_id is
--     the group, so the call record lands once, in the group, when it ends.
--   * Every member is rung with an ordinary invite (0092: root_id = the root,
--     same channel), inserted by start_group_call one by one, each through
--     the usual checks in calls_prepare_insert (0114): may_ring (blocks, the
--     restrict list, "who can message me", a relationship - accepting the
--     group counts), guard_call_block (0094) and check_call_rate (0094/0142).
--     A member who can't be rung is skipped and counted, not an error.
--     Invites carry no chat_id, so a group call does not open DMs with
--     everybody in the group.
--   * Ending is unchanged: leave_call() / call_members_end_root (0092) end
--     the root when fewer than two remain joined. Nobody answering: the
--     caller's app ends the root after the ring time (missed for every
--     invite, by the 0095 sweep).
--
-- Size cap: the app's GROUP_LIMIT (mobile/src/features/call/callSession.ts),
-- 8 people on a voice call and 4 on a video call, the caller included.
-- Applied here too, so a group call cannot ring 200 phones. Members past the
-- cap are counted as skipped.
--
-- Rate limits: the root and every invite count toward the 20 calls / hour
-- of check_call_rate, so one call to a group of 7 uses 8 of them.
--
-- Needs 0092-0096 and 0114. Safe to re-run.

begin;

-- ── 1. Which group a call was started from ─────────────────────────────

alter table public.calls
  add column if not exists group_chat_id uuid references public.chats (id) on delete set null;

-- ── 2. calls_prepare_insert (0114) learns the group root ───────────────
-- Identical to 0114 except the block marked 0145. The group root may only be
-- written by start_group_call, which sets a transaction-local flag around its
-- insert. PostgREST exposes no way for a client to set that flag.

create or replace function public.calls_prepare_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_root record;
begin
  -- No JWT (SQL editor, service jobs): trusted, left as written.
  if auth.uid() is null then
    return new;
  end if;

  -- 0145: a group call's root.
  if new.group_chat_id is not null then
    if coalesce(current_setting('flyp.group_call_root', true), '') <> 'on'
       or new.root_id is not null
       or new.caller_id is distinct from auth.uid()
       or new.callee_id is distinct from auth.uid() then
      raise exception 'start a group call with start_group_call';
    end if;
    new.status      := 'accepted';
    new.answered_at := now();
    new.ended_at    := null;
    new.created_at  := now();
    new.channel     := 'call_' || replace(gen_random_uuid()::text, '-', '');
    return new;
  end if;

  new.status      := 'ringing';
  new.answered_at := null;
  new.ended_at    := null;
  new.created_at  := now();

  if new.root_id is null then
    new.channel := 'call_' || replace(gen_random_uuid()::text, '-', '');
  else
    select id, root_id, channel, status into v_root
      from public.calls where id = new.root_id;
    if not found then
      raise exception 'no such call';
    end if;
    if v_root.root_id is not null then
      raise exception 'no such call';
    end if;
    if v_root.status not in ('ringing', 'accepted') then
      raise exception 'this call has already ended';
    end if;
    if not exists (select 1 from public.call_members m
                    where m.channel = v_root.channel
                      and m.user_id = new.caller_id
                      and m.status = 'joined') then
      raise exception 'you are not in this call';
    end if;
    new.channel := v_root.channel;
  end if;

  if not public.may_ring(new.callee_id, new.caller_id) then
    raise exception 'blocked';
  end if;

  return new;
end;
$fn$;
revoke all on function public.calls_prepare_insert() from public, anon, authenticated;

-- ── 3. group_chat_id never changes (except to null when the chat goes) ──
-- 0114's guard_call_participants plus group_chat_id, in the same way chat_id
-- is handled (0093): clearing it is the ON DELETE SET NULL cascade.

create or replace function public.guard_call_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.caller_id is distinct from old.caller_id
     or new.callee_id is distinct from old.callee_id then
    raise exception 'call participants cannot be changed';
  end if;
  if new.chat_id is distinct from old.chat_id and new.chat_id is not null then
    raise exception 'a call cannot be moved to another chat';
  end if;
  if new.group_chat_id is distinct from old.group_chat_id and new.group_chat_id is not null then
    raise exception 'a call cannot be moved to another chat';
  end if;
  if new.channel is distinct from old.channel
     or new.root_id is distinct from old.root_id then
    raise exception 'a call cannot be moved to another channel';
  end if;
  return new;
end;
$$;

-- ── 4. Start a group call ──────────────────────────────────────────────
-- Returns { call_id, channel, rung, skipped }. Raises 'no one in this group
-- can be called' (and writes nothing) when not one member could be rung.

create or replace function public.start_group_call(p_chat_id uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me      uuid := auth.uid();
  v_root    public.calls;
  v_cap     integer;
  v_rung    integer := 0;
  v_skipped integer := 0;
  v_member  record;
begin
  if v_me is null then
    raise exception 'not signed in';
  end if;
  if p_kind is null or p_kind not in ('audio', 'video') then
    raise exception 'invalid call kind';
  end if;
  if not exists (select 1 from public.chats c where c.id = p_chat_id and c.type = 'group') then
    raise exception 'no such group';
  end if;
  if not exists (select 1 from public.chat_members cm where cm.chat_id = p_chat_id and cm.user_id = v_me) then
    raise exception 'you are not in this group';
  end if;

  -- People in the call, the caller included (the app's GROUP_LIMIT).
  v_cap := case when p_kind = 'video' then 4 else 8 end;

  perform set_config('flyp.group_call_root', 'on', true);
  insert into public.calls (caller_id, callee_id, chat_id, kind, status, channel, group_chat_id)
  values (v_me, v_me, p_chat_id, p_kind, 'accepted', 'pending', p_chat_id)
  returning * into v_root;
  perform set_config('flyp.group_call_root', 'off', true);

  -- Members who accepted the group first, then by how long they have been in it.
  for v_member in
    select cm.user_id
      from public.chat_members cm
     where cm.chat_id = p_chat_id and cm.user_id <> v_me
     order by cm.accepted_at nulls last, cm.joined_at
  loop
    if v_rung >= v_cap - 1 then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    begin
      insert into public.calls (caller_id, callee_id, chat_id, kind, status, channel, root_id)
      values (v_me, v_member.user_id, null, p_kind, 'ringing', v_root.channel, v_root.id);
      v_rung := v_rung + 1;
    exception when others then
      -- may_ring said no ('blocked'), a block with someone in the call, or the
      -- rate limit: this member is not rung.
      v_skipped := v_skipped + 1;
    end;
  end loop;

  if v_rung = 0 then
    raise exception 'no one in this group can be called';
  end if;

  return jsonb_build_object(
    'call_id', v_root.id,
    'channel', v_root.channel,
    'rung',    v_rung,
    'skipped', v_skipped
  );
end;
$fn$;
revoke all on function public.start_group_call(uuid, text) from public, anon;
grant execute on function public.start_group_call(uuid, text) to authenticated;

commit;

-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'calls.group_chat_id exists' as check,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'calls'
                            and column_name = 'group_chat_id')
            then 'OK' else 'MISSING' end as result
union all
select 'prepare knows the group root',
       case when pg_get_functiondef('public.calls_prepare_insert()'::regprocedure) like '%flyp.group_call_root%'
            then 'OK' else 'NOT UPDATED' end
union all
select 'start_group_call callable by the app',
       case when has_function_privilege('authenticated', 'public.start_group_call(uuid, text)', 'execute')
            then 'OK' else 'NOT GRANTED' end
union all
select 'start_group_call not callable signed out',
       case when not has_function_privilege('anon', 'public.start_group_call(uuid, text)', 'execute')
            then 'OK' else 'EXPOSED' end;

-- Behavioural test: group G with A, B, C (all accepted the group), D who
-- blocked A.
--   as A: select start_group_call('<G>', 'audio');
--         -- {"rung": 2, "skipped": 1, ...}; B and C ring, D does not
--   as A: insert into calls (caller_id, callee_id, kind, channel, group_chat_id)
--         values (A, A, 'audio', 'x', '<G>');      -- 'start a group call with start_group_call'
--   as B: accept the invite; A and B are 'joined'; B hangs up -> root ended
--         (fewer than two joined), C's ring swept to missed.
