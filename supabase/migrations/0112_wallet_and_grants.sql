-- 0112 - free coins, and the other grants that only LOOKED revoked
--
-- Security review 2026-10 (findings F02, F15, F17, and the self_delete_account
-- note). Apply after 0111. Safe to re-run: drop ... if exists, create or
-- replace, and revoke/grant are idempotent.
--
-- ============================================================
-- 1. F02 (CRITICAL) - ANYONE COULD MINT COINS
-- ============================================================
-- 0006 created self_topup(int, text) and self_withdraw(int, text) for a demo
-- top-up sheet. 0007 "revoked" them:
--
--     revoke execute on function public.self_topup(integer, text) from authenticated;
--     revoke execute on function public.self_topup(integer, text) from anon;
--
-- and stopped there. `create function` always grants EXECUTE to PUBLIC, and
-- anon/authenticated are members of PUBLIC, so both kept the right to call
-- it through that grant: POST /rest/v1/rpc/self_topup {p_amount: 100000}
-- credited 100k coins per call to any signed-in account. 0073 explains the
-- same trap for other functions but did not include these two.
--
-- Nothing calls either function any more: coins are bought only through
-- verify-purchase -> credit_wallet_topup (0104/0111, service role only), and
-- withdrawals have no real payout behind them. They are dropped, not just
-- revoked, so no future grant can bring them back by accident.
--
-- Ledger rows they already wrote are left alone: whether to claw back coins
-- minted this way is a business decision, and the check query at the bottom
-- lists them so it can be made.

drop function if exists public.self_topup(integer, text);
drop function if exists public.self_withdraw(integer, text);


-- ============================================================
-- 2. Follower lists: restated with named roles
-- ============================================================
-- list_followers/list_following: 0055 revoked PUBLIC and 0082 revoked anon,
-- so these are already signed-in only. Restated here with named roles so the
-- end state does not depend on the order history ran in.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('list_followers', 'list_following')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;


-- ============================================================
-- 3. F17 - any signed-in user could trigger the admin storage email
-- ============================================================
-- check_storage_alert() decides whether to email the operators and queues
-- the email. Only pg_cron (runs as postgres) needs it; 0059/0060 granted it
-- to authenticated "for testing from the SQL editor", which runs as postgres
-- anyway.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'check_storage_alert'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;


-- ============================================================
-- 4. F15 - helpers that answered questions about OTHER people
-- ============================================================
-- setting_text / setting_bool / has_blocked / is_blocked_between / is_friend
-- / may_message / is_adult / within_upload_quota take arbitrary user ids. RLS
-- policies and SECURITY DEFINER triggers legitimately call them about other
-- people (notify_on_live asks each follower's notif_live; guard_call_block
-- asks about two people who are neither the caller), so EXECUTE cannot simply
-- be taken away from authenticated - policies run as the querying role.
--
-- What has no legitimate use is calling them DIRECTLY as an RPC with someone
-- else's id: POST /rpc/setting_text {p_user: <anyone>, p_key:
-- 'who_can_message'} read any person's private settings, has_blocked /
-- is_blocked_between revealed who blocks whom (has_blocked even to anon).
--
-- PostgREST sets the transaction setting request.path ('/rpc/<name>') for
-- every request. called_as_rpc(name) is true only when THIS function is the
-- endpoint being called, never when it runs inside a policy or another
-- function serving some other request. In that case each helper answers only
-- about a pair that includes the caller, and otherwise returns its harmless
-- default. When request.path is unset (SQL editor, pg_cron, service jobs)
-- nothing changes.
--
-- Each function below is its LATEST definition (named per function), with
-- only the guard added.

create or replace function public.called_as_rpc(p_fn text)
returns boolean
language sql
stable
set search_path = public
as $fn$
  select coalesce(current_setting('request.path', true), '')
         ~ ('(^|/)rpc/' || p_fn || '/?$');
$fn$;
revoke all on function public.called_as_rpc(text) from public, anon, authenticated;

-- setting_text: latest 0091.
create or replace function public.setting_text(p_user uuid, p_key text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v text;
begin
  if public.called_as_rpc('setting_text') and p_user is distinct from auth.uid() then
    return 'everyone';
  end if;
  execute format('select %I from public.user_settings where user_id = $1', p_key)
    into v using p_user;
  return coalesce(v, 'everyone');
end;
$$;

-- setting_bool: latest 0027.
create or replace function public.setting_bool(p_user uuid, p_key text)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare v boolean;
begin
  if public.called_as_rpc('setting_bool') and p_user is distinct from auth.uid() then
    return true;
  end if;
  execute format('select %I from public.user_settings where user_id = $1', p_key)
    into v using p_user;
  return coalesce(v, true);
end;
$fn$;

-- has_blocked: latest 0070. Keeps anon EXECUTE (the profiles policy needs
-- it); a signed-out direct caller gets false for every pair.
create or replace function public.has_blocked(p_blocker uuid, p_blocked uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  -- One direction only: has p_blocker blocked p_blocked?
  select (not public.called_as_rpc('has_blocked')
          or auth.uid() in (p_blocker, p_blocked))
     and exists (
       select 1 from public.blocks
        where blocker_id = p_blocker
          and blocked_id = p_blocked
     );
$$;

-- is_blocked_between: latest 0049.
create or replace function public.is_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select (not public.called_as_rpc('is_blocked_between')
          or auth.uid() in (p_a, p_b))
     and exists (
       select 1 from public.blocks
        where (blocker_id = p_a and blocked_id = p_b)
           or (blocker_id = p_b and blocked_id = p_a)
     );
$$;

-- is_friend: latest 0097.
create or replace function public.is_friend(a uuid, b uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $fn$
  select a is not null
     and b is not null
     and a <> b
     and (not public.called_as_rpc('is_friend') or auth.uid() in (a, b))
     and exists (select 1 from public.follows
                  where follower_id = a and followed_id = b)
     and exists (select 1 from public.follows
                  where follower_id = b and followed_id = a);
$fn$;

-- may_message: latest 0097. The app calls it directly with p_actor = itself,
-- which still works.
create or replace function public.may_message(p_target uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare v_rule text;
begin
  if public.called_as_rpc('may_message') and p_actor is distinct from auth.uid() then
    return false;
  end if;

  if p_target = p_actor then return true; end if;

  if exists (select 1 from public.blocks
              where blocker_id = p_target and blocked_id = p_actor) then
    return false;
  end if;

  -- A restricted person cannot start a conversation with you.
  if exists (select 1 from public.restricted_users
              where user_id = p_target and restricted_id = p_actor) then
    return false;
  end if;

  v_rule := public.setting_text(p_target, 'who_can_message');
  if v_rule = 'nobody' then return false; end if;
  if v_rule = 'following' then
    return exists (select 1 from public.follows
                    where follower_id = p_target and followed_id = p_actor);
  end if;
  -- 0097: mutual follows only.
  if v_rule = 'friends' then
    return public.is_friend(p_target, p_actor);
  end if;
  return true;
end;
$fn$;

-- is_adult: latest 0036. The app asks only about itself.
create or replace function public.is_adult(p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $fn$
  select (not public.called_as_rpc('is_adult') or p_user = auth.uid())
     and coalesce(
       (select birth_date <= (current_date - interval '18 years')
          from public.user_private
         where user_id = p_user),
       false   -- no birthday recorded = not proven adult
     );
$fn$;

-- within_upload_quota: latest 0063.
create or replace function public.within_upload_quota(p_user uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public, storage
as $fn$
declare
  v_lim      public.app_limits%rowtype;
  v_count    integer;
  v_bytes    bigint;
  v_is_admin boolean;
begin
  if p_user is null then return false; end if;
  if public.called_as_rpc('within_upload_quota') and p_user is distinct from auth.uid() then
    return false;
  end if;

  select * into v_lim from public.app_limits where id = 1;
  if not found then return true; end if;

  v_is_admin := exists (select 1 from public.profiles where id = p_user and is_admin);

  -- Daily limits: still waived for operators. These stop one account flooding
  -- the app; they are not what protects the bill.
  if not v_is_admin then
    select upload_count, upload_bytes into v_count, v_bytes
      from public.user_uploads_today(p_user);

    if v_count >= v_lim.user_daily_uploads then return false; end if;
    if v_bytes >= v_lim.user_daily_bytes  then return false; end if;
  end if;

  -- The global ceiling. No exemption, for anyone.
  return public.within_global_storage_limit();
end;
$fn$;

-- (user_uploads_today gets the same guard in 0118, where it is rewritten.)

-- create or replace keeps each function's existing grants. Restated anyway,
-- with named roles, so the end state does not depend on history.
revoke all on function public.setting_text(uuid, text)       from public, anon;
revoke all on function public.setting_bool(uuid, text)       from public, anon;
revoke all on function public.is_blocked_between(uuid, uuid) from public, anon;
revoke all on function public.is_friend(uuid, uuid)          from public, anon;
revoke all on function public.may_message(uuid, uuid)        from public, anon;
revoke all on function public.is_adult(uuid)                 from public, anon;
revoke all on function public.within_upload_quota(uuid)      from public, anon;
revoke all on function public.has_blocked(uuid, uuid)        from public;
grant execute on function public.setting_text(uuid, text)       to authenticated;
grant execute on function public.setting_bool(uuid, text)       to authenticated;
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated;
grant execute on function public.is_friend(uuid, uuid)          to authenticated;
grant execute on function public.may_message(uuid, uuid)        to authenticated;
grant execute on function public.is_adult(uuid)                 to authenticated;
grant execute on function public.within_upload_quota(uuid)      to authenticated;
grant execute on function public.has_blocked(uuid, uuid)        to authenticated, anon;


-- ============================================================
-- 5. In-app account deletion
-- ============================================================
-- self_delete_account() (0006) has been service-role only since 0073, so the
-- app cannot call it. The app's delete flow uses schedule_account_deletion()
-- (0034: deactivates now, purge_scheduled_deletions() removes the auth user
-- after 30 days), which only ever touches auth.uid(). The client's
-- selfDeleteAccount() now calls that too. Nothing to change here; the check
-- below confirms the path the app relies on is callable.


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'self_topup is gone' as check,
       case when to_regprocedure('public.self_topup(integer, text)') is null
            then 'OK' else 'STILL PRESENT' end as result
union all
select 'self_withdraw is gone',
       case when to_regprocedure('public.self_withdraw(integer, text)') is null
            then 'OK' else 'STILL PRESENT' end
union all
select 'anon cannot list followers',
       case when not has_function_privilege('anon', 'public.list_followers(uuid)', 'execute')
            then 'OK' else 'STILL EXPOSED' end
union all
select 'authenticated cannot trigger the storage alert',
       case when not has_function_privilege('authenticated', 'public.check_storage_alert()', 'execute')
            then 'OK' else 'STILL EXPOSED' end
union all
select 'anon cannot read settings',
       case when not has_function_privilege('anon', 'public.setting_text(uuid, text)', 'execute')
            then 'OK' else 'STILL EXPOSED' end
union all
select 'has_blocked still callable by anon (profiles policy)',
       case when has_function_privilege('anon', 'public.has_blocked(uuid, uuid)', 'execute')
            then 'OK' else 'BROKEN - signed-out browsing fails' end
union all
select 'schedule_account_deletion callable by authenticated',
       case when has_function_privilege('authenticated', 'public.schedule_account_deletion()', 'execute')
            then 'OK' else 'BROKEN - in-app deletion fails' end
order by 1;

-- Review by hand: coins minted through self_topup before this file. Every
-- 'topup' ledger row without a matching store top-up (wallet_topups, 0104)
-- came from the demo function.
--
--   select wt.user_id, count(*) as n, sum(wt.amount) as coins, max(wt.created_at) as last
--     from public.wallet_transactions wt
--    where wt.type = 'topup'
--      and not exists (select 1 from public.wallet_topups t
--                       where t.user_id = wt.user_id
--                         and abs(extract(epoch from (t.created_at - wt.created_at))) < 5)
--    group by wt.user_id order by coins desc;
--
-- Any other SECURITY DEFINER function still executable through PUBLIC:
--
--   select p.oid::regprocedure
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prosecdef
--      and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
--                   where a.grantee = 0 and a.privilege_type = 'EXECUTE')
--    order by 1;
