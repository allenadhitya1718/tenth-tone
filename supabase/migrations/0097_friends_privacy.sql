-- ============================================================
-- 0097_friends_privacy.sql
-- "Who can message me", "Who can comment" and "Who can tag me" gain a
-- Friends option.
--
-- Client note 13: the three privacy choices should offer Friends as well as
-- Everyone. Until now each setting accepted only 'everyone', 'following' and
-- 'nobody' (check constraints from 0027 and 0029), so the app could not even
-- store 'friends': the write failed the constraint.
--
-- ── What "friends" means ──
-- A friend is a MUTUAL follow: you follow them and they follow you. Both
-- rows must exist in public.follows. This matches what the app already
-- calls mutuals when it lists them.
--
-- 'following' is kept exactly as it was ("people I follow"). It is a looser
-- rule than 'friends', and existing accounts that chose it keep it. No row
-- is renamed or migrated; this file only adds a fourth allowed value.
--
-- ── Where the rule is enforced ──
-- Every place that reads one of these three settings decides through one of
-- three functions, and each is recreated here from its LATEST definition
-- with a single added branch for 'friends'. Nothing else in them changes.
--
--   may_comment_on(video, actor)  latest in 0049. Called by the comments
--                                 insert policy (0027).
--   may_message(target, actor)    latest in 0028. Called by
--                                 may_message_in_chat (0069), which the
--                                 messages insert policy calls, and by the
--                                 client before opening a DM. 0091 changed
--                                 only the who_can_message DEFAULT and
--                                 setting_text(); it did not touch this
--                                 function, and neither does this file
--                                 touch setting_text() or the defaults, so
--                                 0091's Requests-tray behaviour is
--                                 unchanged.
--   may_tag(target, actor)        latest in 0035. Called by the caption and
--                                 comment mention triggers (0035).
--
-- may_message_in_chat() itself needs no change: it delegates to
-- may_message(), so the new branch reaches existing conversations too.
--
-- ── Applying it ──
-- Apply in the Supabase SQL editor AFTER 0001..0096. Safe to re-run.
-- create or replace keeps each function's existing grants, including 0073's
-- removal of anon; the grants below only restate what the originals gave.
-- ============================================================

begin;

-- ── 1. Allow 'friends' in the three check constraints ──
-- who_can_message and who_can_comment were declared with inline checks in
-- 0027, so Postgres named them user_settings_<column>_check. who_can_tag's
-- constraint was named explicitly in 0029 with the same pattern. To be safe
-- against a database where the auto-generated name differs, any single
-- check on the table that mentions the column is dropped as well before the
-- named constraint is added back.
do $chk$
declare
  v_col text;
  r     record;
begin
  foreach v_col in array array['who_can_message', 'who_can_comment', 'who_can_tag']
  loop
    for r in
      select c.conname
        from pg_constraint c
       where c.conrelid = 'public.user_settings'::regclass
         and c.contype = 'c'
         and pg_get_constraintdef(c.oid) like '%' || v_col || '%'
    loop
      execute format('alter table public.user_settings drop constraint if exists %I', r.conname);
    end loop;
  end loop;
end
$chk$;

alter table public.user_settings
  drop constraint if exists user_settings_who_can_message_check;
alter table public.user_settings
  add constraint user_settings_who_can_message_check
  check (who_can_message in ('everyone', 'following', 'friends', 'nobody'));

alter table public.user_settings
  drop constraint if exists user_settings_who_can_comment_check;
alter table public.user_settings
  add constraint user_settings_who_can_comment_check
  check (who_can_comment in ('everyone', 'following', 'friends', 'nobody'));

alter table public.user_settings
  drop constraint if exists user_settings_who_can_tag_check;
alter table public.user_settings
  add constraint user_settings_who_can_tag_check
  check (who_can_tag in ('everyone', 'following', 'friends', 'nobody'));


-- ── 2. is_friend(a, b): both follow each other ──
-- security definer so the rule holds regardless of how the follows table's
-- row policies evolve (0054 already hides some follow rows from some
-- readers). Never true for a person and themselves: follows forbids a self
-- row, and the explicit a <> b states it rather than relying on that.
-- Both lookups are served by follows' primary key (follower_id, followed_id).
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
     and exists (select 1 from public.follows
                  where follower_id = a and followed_id = b)
     and exists (select 1 from public.follows
                  where follower_id = b and followed_id = a);
$fn$;

-- Signed-in only, like the other relationship helpers in 0073. Named roles,
-- because `from public` alone is a no-op on Supabase (see 0073).
revoke all on function public.is_friend(uuid, uuid) from public, anon;
grant execute on function public.is_friend(uuid, uuid) to authenticated;


-- ── 3. Who can comment ──
-- Copied from 0049. Only the 'friends' branch is new.
create or replace function public.may_comment_on(p_video uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare v_owner uuid; v_allow boolean; v_rule text;
begin
  select user_id, allow_comments into v_owner, v_allow
    from public.videos where id = p_video;
  if v_owner is null then return false; end if;
  if not coalesce(v_allow, true) then return false; end if;
  if v_owner = p_actor then return true; end if;

  -- Added: a block stops this before any preference is considered.
  if public.is_blocked_between(v_owner, p_actor) then return false; end if;

  v_rule := public.setting_text(v_owner, 'who_can_comment');
  if v_rule = 'nobody' then return false; end if;
  if v_rule = 'following' then
    return exists (select 1 from public.follows
                    where follower_id = v_owner and followed_id = p_actor);
  end if;
  -- 0097: mutual follows only.
  if v_rule = 'friends' then
    return public.is_friend(v_owner, p_actor);
  end if;
  return true;
end;
$fn$;

grant execute on function public.may_comment_on(uuid, uuid) to authenticated;


-- ── 4. Who can message me ──
-- Copied from 0028 (the latest definition; 0069 and 0091 call or surround
-- it but do not redefine it). Only the 'friends' branch is new.
create or replace function public.may_message(p_target uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare v_rule text;
begin
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

grant execute on function public.may_message(uuid, uuid) to authenticated;


-- ── 5. Who can tag me ──
-- Copied from 0035. Only the 'friends' branch is new. The two mention
-- triggers (notify_video_mentions, notify_comment_mentions) call this and
-- need no change.
create or replace function public.may_tag(p_target uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare v_rule text;
begin
  if p_target = p_actor then return false; end if;   -- no self-notification

  if exists (select 1 from public.blocks
              where (blocker_id = p_target and blocked_id = p_actor)
                 or (blocker_id = p_actor and blocked_id = p_target)) then
    return false;
  end if;

  if exists (select 1 from public.restricted_users
              where user_id = p_target and restricted_id = p_actor) then
    return false;
  end if;

  v_rule := public.setting_text(p_target, 'who_can_tag');

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

grant execute on function public.may_tag(uuid, uuid) to authenticated;

commit;


-- ── Verify after running ──
-- One query, because the SQL editor only shows the last statement's result.
-- Every row should read OK.
select 'is_friend exists' as check,
       case when to_regprocedure('public.is_friend(uuid,uuid)') is null
            then 'MISSING' else 'OK' end as result
union all
select 'who_can_message accepts friends',
       case when exists (select 1 from pg_constraint
                          where conname = 'user_settings_who_can_message_check'
                            and pg_get_constraintdef(oid) like '%friends%')
            then 'OK' else 'NOT UPDATED' end
union all
select 'who_can_comment accepts friends',
       case when exists (select 1 from pg_constraint
                          where conname = 'user_settings_who_can_comment_check'
                            and pg_get_constraintdef(oid) like '%friends%')
            then 'OK' else 'NOT UPDATED' end
union all
select 'who_can_tag accepts friends',
       case when exists (select 1 from pg_constraint
                          where conname = 'user_settings_who_can_tag_check'
                            and pg_get_constraintdef(oid) like '%friends%')
            then 'OK' else 'NOT UPDATED' end
union all
select 'may_message handles friends',
       case when pg_get_functiondef('public.may_message(uuid,uuid)'::regprocedure)
                 like '%is_friend(p_target, p_actor)%'
            then 'OK' else 'NOT UPDATED' end
union all
select 'may_comment_on handles friends (block check kept)',
       case when pg_get_functiondef('public.may_comment_on(uuid,uuid)'::regprocedure)
                 like '%is_friend(v_owner, p_actor)%'
             and pg_get_functiondef('public.may_comment_on(uuid,uuid)'::regprocedure)
                 like '%is_blocked_between%'
            then 'OK' else 'NOT UPDATED' end
union all
select 'may_tag handles friends',
       case when pg_get_functiondef('public.may_tag(uuid,uuid)'::regprocedure)
                 like '%is_friend(p_target, p_actor)%'
            then 'OK' else 'NOT UPDATED' end
union all
select 'anon cannot call is_friend',
       case when not exists (
         select 1 from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           cross join lateral aclexplode(p.proacl) a
           join pg_roles r on r.oid = a.grantee
          where n.nspname = 'public' and r.rolname = 'anon' and p.proname = 'is_friend'
       ) then 'OK' else 'EXPOSED' end
order by 1;

-- The behavioural test, with three accounts A, B and C:
--   1. A sets who_can_message to 'friends'. A and B follow each other;
--      C follows A but A does not follow C back.
--   2. B can send A a message; C is refused, in a new chat and in an
--      existing one.
--   3. Repeat with who_can_comment (comment on A's video) and who_can_tag
--      (mention @A in a caption: B's mention notifies A, C's does not).
