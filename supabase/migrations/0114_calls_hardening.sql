-- 0114 - calls: nobody joins a call they were not let into, and nobody rings
-- a stranger
--
-- Security review 2026-10, findings F03 (high) and F09 (medium). Apply after
-- 0113 (and after 0092-0096, which this builds on). Safe to re-run.
--
-- ============================================================
-- F03 - THREE WAYS INTO SOMEONE ELSE'S CALL
-- ============================================================
-- agora-token hands a PUBLISHER token for a 'call_*' channel to anyone with a
-- call_members row in it (or a calls row they can read). Three ways to get one:
--
--   a. call_member_set(channel, user, root, by, status) is SECURITY DEFINER
--      and was never revoked (0092/0094 only create it), so
--      POST /rpc/call_member_set {p_channel: <victim's>, p_user: me,
--      p_status: 'joined'} made you a joined member of any call.
--   b. "call members update own" (0092) lets you rewrite your own row freely:
--      a declined or missed invitee could set status back to 'joined'.
--   c. calls.channel is chosen by the CLIENT. Insert a call to anybody with
--      channel = the victim's channel, and calls_sync_members() marks you
--      'joined' in it as the caller. The same trick through UPDATE: nothing
--      stopped changing channel (or root_id) on a row you are party to.
--
-- Fixes:
--   a. call_member_set: service role only. Its only callers are the
--      SECURITY DEFINER triggers on calls, which run as the owner.
--   b. call_members: the client may update agora_uid on its own row and
--      nothing else (column privilege). Leaving is leave_call() (definer).
--   c. The channel of a NEW call is generated here ('call_' + 32 hex chars).
--      An invite (root_id set) takes the root's channel, and only someone who
--      is currently joined in that call may invite. Both apps already read
--      the channel back from the inserted row (.insert().select().single()),
--      so neither needs a change. channel and root_id can no longer change
--      on UPDATE.
--
-- ============================================================
-- F09 - ANYONE COULD RING ANYONE, OR "ANSWER" FOR THEM
-- ============================================================
--   * A row could be inserted as status 'accepted', which made the callee a
--     'joined' member without them answering. Insert now always means
--     'ringing', with server times.
--   * Any signed-in account could ring any other (full-screen incoming-call
--     push), limited only by a block. A ring now needs the same consent a
--     DM does (may_message: blocks, restrict list, "who can message me") AND
--     an existing relationship the CALLEE created: they follow the caller,
--     they have accepted or written in a conversation with the caller, or
--     they have called the caller before. A refused ring raises 'blocked',
--     which both apps already show as "You can't call this person".
--   * Status changes are checked for app requests: only the callee accepts
--     or declines, a call that is over stays over (ended / declined / missed
--     never go back to ringing or accepted - an old client's late hang-up on
--     a finished call is a silent no-op rather than an error).

begin;

-- ── a. call_member_set is internal ──────────────────────────────────────
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'call_member_set'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- ── b. call_members: your own agora_uid, nothing else ───────────────────
revoke insert, update, delete, truncate on public.call_members from anon, authenticated;
grant select on public.call_members to authenticated;
grant update (agora_uid) on public.call_members to authenticated;

drop policy if exists "call members update own" on public.call_members;
create policy "call members update own" on public.call_members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ── Who may ring whom ───────────────────────────────────────────────────
-- p_caller rings p_callee. SECURITY DEFINER so it can see the follows,
-- chats and messages involved whatever the caller's own policies show.
create or replace function public.may_ring(p_callee uuid, p_caller uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select p_callee is not null
     and p_caller is not null
     and p_callee <> p_caller
     and not public.is_blocked_between(p_callee, p_caller)
     and public.may_message(p_callee, p_caller)
     and (
       -- the callee follows the caller
       exists (select 1 from public.follows f
                where f.follower_id = p_callee and f.followed_id = p_caller)
       -- the callee accepted a conversation the caller is in
       or exists (select 1
                    from public.chat_members me
                    join public.chat_members them
                      on them.chat_id = me.chat_id and them.user_id = p_caller
                   where me.user_id = p_callee
                     and me.accepted_at is not null)
       -- the callee has written in a conversation the caller is in
       or exists (select 1
                    from public.chat_members them
                    join public.messages m
                      on m.chat_id = them.chat_id and m.from_user_id = p_callee
                   where them.user_id = p_caller
                     and coalesce(m.type, 'text') <> 'call')
       -- the callee has called the caller before
       or exists (select 1 from public.calls c
                   where c.caller_id = p_callee and c.callee_id = p_caller)
     );
$fn$;
revoke all on function public.may_ring(uuid, uuid) from public, anon, authenticated;

-- ── c + F09: a new calls row is shaped by the server ────────────────────
-- Named trg_call_aa_* so it runs BEFORE trg_call_block and trg_call_rate
-- (same-event triggers fire in name order): guard_call_block reads
-- new.channel for invites and must see the server's channel.
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

drop trigger if exists trg_call_aa_prepare on public.calls;
create trigger trg_call_aa_prepare
  before insert on public.calls
  for each row execute function public.calls_prepare_insert();

-- ── c: who a call is between, and where it is, never changes ────────────
-- Latest guard_call_participants is 0093's; channel and root_id are added.
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
  if new.channel is distinct from old.channel
     or new.root_id is distinct from old.root_id then
    raise exception 'a call cannot be moved to another channel';
  end if;
  return new;
end;
$$;

drop trigger if exists tr_guard_call_participants on public.calls;
create trigger tr_guard_call_participants
  before update on public.calls
  for each row execute function public.guard_call_participants();

-- ── F09: status changes made by the app ─────────────────────────────────
-- SECURITY INVOKER on purpose: current_user is then the role that issued
-- the UPDATE. 'authenticated' means a request from the app. The cascades in
-- calls_sync_members / call_members_end_root / leave_call run inside
-- SECURITY DEFINER code, where current_user is the owner, and are left alone.
create or replace function public.guard_call_status()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare v_me uuid := auth.uid();
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Over is over. Silently, so an old client's late hang-up is a no-op.
  if old.status in ('ended', 'declined', 'missed') then
    new.status      := old.status;
    new.ended_at    := old.ended_at;
    new.answered_at := old.answered_at;
    return new;
  end if;

  if new.status = 'accepted' then
    if old.status <> 'ringing' or v_me is distinct from new.callee_id then
      raise exception 'only the person being called can answer';
    end if;
    new.answered_at := now();
  elsif new.status = 'declined' then
    if old.status <> 'ringing' or v_me is distinct from new.callee_id then
      raise exception 'only the person being called can decline';
    end if;
    new.ended_at := now();
  elsif new.status = 'missed' then
    if old.status <> 'ringing' or v_me not in (new.caller_id, new.callee_id) then
      raise exception 'only a ringing call can be missed';
    end if;
    new.ended_at := now();
  elsif new.status = 'ended' then
    new.ended_at := now();
  else
    -- 'ringing' again, or anything unknown.
    raise exception 'invalid call status change';
  end if;
  return new;
end;
$fn$;
revoke all on function public.guard_call_status() from public, anon, authenticated;

drop trigger if exists tr_guard_call_status on public.calls;
create trigger tr_guard_call_status
  before update on public.calls
  for each row execute function public.guard_call_status();

commit;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'authenticated cannot call call_member_set' as check,
       case when not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'call_member_set'
            and has_function_privilege('authenticated', p.oid, 'execute'))
            then 'OK' else 'STILL EXPOSED' end as result
union all
select 'call_members: only agora_uid is updatable by the app',
       case when not has_column_privilege('authenticated', 'public.call_members', 'status', 'update')
             and has_column_privilege('authenticated', 'public.call_members', 'agora_uid', 'update')
            then 'OK' else 'WRONG' end
union all
select 'calls insert shaped by the server',
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.calls'::regclass and tgname = 'trg_call_aa_prepare'
                            and not tgisinternal)
            then 'OK' else 'MISSING' end
union all
select 'prepare runs before the block check (name order)',
       case when 'trg_call_aa_prepare' < 'trg_call_block' then 'OK' else 'WRONG ORDER' end
union all
select 'calls status guard installed',
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.calls'::regclass and tgname = 'tr_guard_call_status'
                            and not tgisinternal)
            then 'OK' else 'MISSING' end
union all
select 'channel is immutable',
       case when pg_get_functiondef('public.guard_call_participants()'::regprocedure) like '%new.channel is distinct from old.channel%'
            then 'OK' else 'NOT UPDATED' end
order by 1;

-- Behavioural test, accounts A and B who follow each other, C a stranger:
--   as A: insert into calls (caller_id, callee_id, channel, status)
--         values (A, B, 'anything', 'accepted') returning channel, status;
--         -- channel = 'call_<32 hex>', status = 'ringing'
--   as C: same towards B                                  -- 'blocked'
--   as C: select call_member_set('<A''s channel>', C, null, null, 'joined');  -- permission denied
--   as B: update call_members set status = 'joined' where user_id = B;        -- permission denied
