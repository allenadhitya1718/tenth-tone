-- 0077 — three holes: two RLS-inside-RLS block leaks, one forged export row
--
-- Run this whole file once in the Supabase SQL editor. Safe to re-run.
-- Apply AFTER 0001..0076.
--
-- ============================================================
-- THE SHAPE, ONE MORE TIME
-- ============================================================
-- 0070 wrote it down and then only fixed the one table it was chasing:
--
--   A policy's subquery runs under the CALLER's RLS.
--
-- public.blocks has, since 0004 and still today:
--
--     create policy "blocks read own" on public.blocks
--       for select to authenticated using (auth.uid() = blocker_id);
--
-- Only the BLOCKER can read a block row. So any policy that writes
-- `not exists (select 1 from public.blocks ...)` is asking the blocked person
-- to produce the evidence against themselves. They cannot see the row, EXISTS
-- finds nothing, NOT EXISTS is true, and the guard fails OPEN — for exactly
-- the person it exists to stop.
--
-- 0070 fixed public.profiles. Two more copies of the same expression were left
-- in place and are fixed here. Neither has ever worked once.
--
-- The fix is the same one 0049 and 0070 established: go through a
-- SECURITY DEFINER helper, which runs as its owner and is not subject to the
-- caller's RLS, so it can see the block row the caller cannot. No new pattern,
-- no new helper — this file invents nothing.
--
--   public.is_blocked_between(a, b)  — 0049, security definer, BOTH directions
--   public.has_blocked(blocker, blocked) — 0070, security definer, ONE direction
--
-- Both are checked below before anything depends on them; if either is not
-- SECURITY DEFINER this file aborts rather than shipping a fix that is still
-- broken in the same way.
--
--
-- ============================================================
-- POLICY NAMES — READ THIS BEFORE EDITING
-- ============================================================
-- 0076 spent two years dead because a DROP POLICY had two words transposed
-- ("saves own write" vs "saves write own") and `if exists` swallowed it in
-- silence. The names dropped below are the exact strings that created the
-- live policies, taken from the migrations that created them:
--
--   "locations read"            user_locations       created 0001, replaced 0004, replaced 0032
--   "live comments insert own"  live_comments        created 0016
--   "exports own insert"        data_export_requests created 0029
--
-- Two safeguards against the 0076 failure mode, because `if exists` cannot be
-- trusted to tell you it missed:
--
--   1. Each replacement REUSES the same name. If a DROP silently matches
--      nothing, the following CREATE POLICY fails with "policy already
--      exists" and this file stops. It cannot leave a second permissive policy
--      sitting beside the old one ORing it back open.
--   2. The preflight block below raises if any of the three names is not
--      present, so a rename upstream is a loud failure, not a no-op.
--
-- Confirm against the live database before and after with:
--
--   select tablename, policyname, cmd, qual, with_check
--     from pg_policies
--    where schemaname = 'public'
--      and tablename in ('user_locations', 'live_comments', 'data_export_requests')
--    order by tablename, policyname;
--
--
-- ============================================================
-- ON `revoke ... from public` — DO NOT REACH FOR IT HERE
-- ============================================================
-- 0073 proved it: a Supabase project ships
--   alter default privileges in schema public
--     grant all on functions to postgres, anon, authenticated, service_role;
-- so `revoke ... from public` removes a grant that was never the operative
-- one. Roles must be named.
--
-- The same trap has a table-level twin, and it is why hole 3 is NOT fixed with
-- a column privilege. `revoke update (status, file_url) ... from authenticated`
-- does nothing at all while that role still holds table-level UPDATE — Postgres
-- checks the table grant first and never consults the column list. And
-- revoking table-level UPDATE from `authenticated` would take the admin panel
-- with it: admins reach PostgREST as `authenticated` too, so
-- adminCompleteExport() would start failing for the operators the panel exists
-- for. Hole 3 is therefore fixed in RLS and in a trigger, where the caller's
-- identity is actually available.


-- ============================================================
-- PREFLIGHT — abort loudly rather than half-apply
-- ============================================================
do $preflight$
declare
  missing text := '';
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'is_blocked_between' and p.prosecdef
  ) then
    missing := missing || 'is_blocked_between() missing or NOT security definer (0049); ';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'has_blocked' and p.prosecdef
  ) then
    missing := missing || 'has_blocked() missing or NOT security definer (0070); ';
  end if;

  if missing <> '' then
    raise exception 'PREFLIGHT FAILED: %  — without SECURITY DEFINER the helper '
                    'runs under the caller''s RLS and the fix below would be '
                    'exactly as broken as what it replaces.', missing;
  end if;

  -- The three policy names this file replaces. Absent = renamed upstream =
  -- stop, do not create a second policy alongside whatever is really there.
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'user_locations' and policyname = 'locations read') then
    raise exception 'PREFLIGHT FAILED: policy "locations read" not found on public.user_locations — '
                    'check pg_policies for its real name before running this file.';
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'live_comments' and policyname = 'live comments insert own') then
    raise exception 'PREFLIGHT FAILED: policy "live comments insert own" not found on public.live_comments — '
                    'check pg_policies for its real name before running this file.';
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'data_export_requests' and policyname = 'exports own insert') then
    raise exception 'PREFLIGHT FAILED: policy "exports own insert" not found on public.data_export_requests — '
                    'check pg_policies for its real name before running this file.';
  end if;
end
$preflight$;


-- ============================================================
-- 1. HIGH — A BLOCKED PERSON COULD STILL READ YOUR LIVE LOCATION
-- ============================================================
-- 0032_location_safety.sql:25. The policy that decides who may read
-- public.user_locations contained:
--
--     and not exists (
--       select 1 from public.blocks
--       where (blocker_id = user_id and blocked_id = auth.uid())
--          or (blocker_id = auth.uid() and blocked_id = user_id)
--     )
--
-- Both directions are written, and only one of them ever worked. When A has
-- blocked B and B queries, the subquery runs as B; "blocks read own" hides A's
-- row from B; the guard passes. The direction that failed open is the one that
-- matters: the person you blocked kept reading your live coordinates, updated
-- in realtime, for as long as sharing was on.
--
-- (The other direction happened to work, because there the caller IS the
-- blocker and can see their own row. A guard that only holds against the
-- person it is not protecting you from.)
--
-- is_blocked_between() is the exact drop-in: same both-directions semantics,
-- evaluated where the rows are visible. Everything else in this policy —
-- self-read, sharing_enabled, the 8-hour staleness window from 0032, the
-- public/friends visibility split — is reproduced verbatim and deliberately
-- unchanged. This file narrows access and nothing else.
drop policy if exists "locations read" on public.user_locations;
create policy "locations read" on public.user_locations
  for select to authenticated
  using (
    user_id = auth.uid()
    or (
      coalesce(sharing_enabled, false) = true
      and updated_at > now() - interval '8 hours'
      -- was: not exists (select 1 from public.blocks ...) — see above
      and not public.is_blocked_between(user_locations.user_id, auth.uid())
      and (
        visibility = 'public'
        or (
          visibility = 'friends'
          and exists (
            select 1 from public.follows
            where follower_id = auth.uid() and followed_id = user_id
          )
        )
      )
    )
  );


-- ============================================================
-- 2. MEDIUM — BLOCKED USERS COULD STILL COMMENT ON YOUR LIVE STREAM
-- ============================================================
-- 0016_live_chat_hashtags.sql:29. Same shape, and the file even documents the
-- intent it never delivered: "can't comment on a stream you're blocked from".
--
--     and not exists (
--       select 1 from public.blocks b
--       where b.blocker_id = ls.host_id and b.blocked_id = auth.uid()
--     )
--
-- The commenter is the blocked party by construction, so this subquery is
-- guaranteed to return nothing for the only person it was written to stop.
-- It has never rejected a single insert.
--
-- has_blocked(), not is_blocked_between(), and the choice is deliberate: this
-- check is one-directional on purpose (has the HOST blocked the commenter),
-- and 0070 gives the reason for keeping such checks one-directional — a
-- blocker must keep their own access to the person they blocked. Swapping in
-- the both-directions helper would also silence anyone who had blocked the
-- host, which is a behaviour change, not a security fix. Same names, same
-- structure, same "stream must be live" requirement.
drop policy if exists "live comments insert own" on public.live_comments;
create policy "live comments insert own" on public.live_comments
  for insert to authenticated
  with check (
    auth.uid() = user_id
    -- can't comment on a stream you're blocked from, or one that ended
    and exists (
      select 1 from public.live_streams ls
      where ls.id = live_stream_id
        and ls.status = 'live'
        -- was: not exists (select 1 from public.blocks b ...) — see above
        and not public.has_blocked(ls.host_id, auth.uid())
    )
  );


-- ============================================================
-- 3. MEDIUM — ANYONE COULD FORGE A "READY" EXPORT WITH ANY file_url
-- ============================================================
-- 0029_settings_expansion.sql:63.
--
--     create policy "exports own insert" on public.data_export_requests
--       for insert to authenticated with check (user_id = auth.uid());
--
-- The only thing checked is the owner. status and file_url are columns like
-- any other, so a signed-in user posting straight at PostgREST can insert
--
--     { user_id: <self>, status: 'ready', file_url: 'https://attacker/...' }
--
-- and admin.js renders file_url as a live anchor in the export queue, so an
-- operator gets a "Download" link to somewhere an attacker chose. It also
-- walks straight past idx_export_one_pending, which is a partial index on
-- status = 'pending' and therefore rate-limits nothing that is not pending.
--
-- Requesting an export must keep working — db.js's requestDataExport() inserts
-- { user_id: me } and takes the column defaults, which is exactly what the
-- policy below permits. Only status/file_url/completed_at are taken away.
--
-- Two layers, because RLS alone is one edit away from being wrong again and
-- this was already wrong once:
--   a) the policy pins the three fields at insert time;
--   b) a BEFORE trigger re-pins them for every non-operator caller, on INSERT
--      and UPDATE both, so it holds even if a future policy is looser.
drop policy if exists "exports own insert" on public.data_export_requests;
create policy "exports own insert" on public.data_export_requests
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and file_url is null
    and completed_at is null
  );


-- The queue is filled in by the export worker (service_role) or by an operator
-- through the admin panel. Nobody else may name a status or a URL.
create or replace function public.guard_export_request()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  -- nullif() guards the cast: request.jwt.claims is unset in the SQL editor
  -- and can be an empty string, and ''::jsonb raises.
  v_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
begin
  -- Operator paths: the worker holding service_role, anything running as a
  -- database role other than the two PostgREST uses, and admins.
  if v_role = 'service_role'
     or current_user not in ('authenticated', 'anon')
     or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Not an error — a normal request simply cannot carry these.
    new.status       := 'pending';
    new.file_url     := null;
    new.completed_at := null;
  else
    if new.status       is distinct from old.status
       or new.file_url  is distinct from old.file_url
       or new.completed_at is distinct from old.completed_at then
      raise exception 'only an operator can complete a data export';
    end if;
  end if;

  return new;
end
$fn$;

drop trigger if exists trg_guard_export_request on public.data_export_requests;
create trigger trg_guard_export_request
  before insert or update on public.data_export_requests
  for each row execute function public.guard_export_request();


-- Belt and braces on the value itself, so a compromised or careless operator
-- path still cannot store a javascript: URL for the panel to render.
-- NOT VALID on purpose: it applies to every new and updated row immediately
-- but does not fail this migration on historic rows. Clean those up using the
-- verification query at the bottom, then run
--   alter table public.data_export_requests validate constraint data_export_file_url_https;
do $c$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'data_export_file_url_https'
  ) then
    alter table public.data_export_requests
      add constraint data_export_file_url_https
      check (file_url is null or file_url ~ '^https://') not valid;
  end if;
end
$c$;


-- ============================================================
-- VERIFY
-- ============================================================
-- Structural first. The behavioural tests are at the very bottom and are the
-- ones that count — every policy replaced above passed structural review for
-- years while doing nothing.
select 'is_blocked_between() is security definer' as check,
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'is_blocked_between' and p.prosecdef
       ) then 'OK' else 'NOT SECURITY DEFINER — location fix is inert' end as result
union all
select 'has_blocked() is security definer',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'has_blocked' and p.prosecdef
       ) then 'OK' else 'NOT SECURITY DEFINER — live-chat fix is inert' end
union all
select 'locations read no longer selects from blocks directly',
       case when exists (
         select 1 from pg_policies where schemaname = 'public'
           and tablename = 'user_locations' and policyname = 'locations read'
           -- "is_blocked_between" contains no "blocks", so the second test is
           -- a clean check that the raw subquery is really gone.
           and qual like '%is_blocked_between%' and qual not ilike '%blocks%'
       ) then 'OK' else 'NOT UPDATED — blocked users can still read locations' end
union all
select 'locations read still enforces the 8-hour staleness window',
       case when exists (
         select 1 from pg_policies where schemaname = 'public'
           and tablename = 'user_locations' and policyname = 'locations read'
           and qual like '%08:00:00%'
       ) then 'OK' else 'LOST — 0032''s staleness rule was dropped, re-check the policy' end
union all
select 'only the two expected policies can return a user_locations row',
       case when (
         select coalesce(string_agg(policyname, ', ' order by policyname), '(none)')
           from pg_policies where schemaname = 'public'
            and tablename = 'user_locations' and cmd in ('SELECT', 'ALL')
       ) = 'locations read, locations write own'
       then 'OK' else 'UNEXPECTED SELECT POLICY — permissive policies OR together, check pg_policies' end
union all
select 'live comments insert own no longer selects from blocks directly',
       case when exists (
         select 1 from pg_policies where schemaname = 'public'
           and tablename = 'live_comments' and policyname = 'live comments insert own'
           and with_check like '%has_blocked%' and with_check not ilike '%blocks%'
       ) then 'OK' else 'NOT UPDATED — blocked users can still comment' end
union all
select 'live comments insert own still requires a live stream',
       case when exists (
         select 1 from pg_policies where schemaname = 'public'
           and tablename = 'live_comments' and policyname = 'live comments insert own'
           and with_check like '%''live''%'
       ) then 'OK' else 'LOST — comments on ended streams are possible again' end
union all
select 'exports own insert pins status/file_url/completed_at',
       case when exists (
         select 1 from pg_policies where schemaname = 'public'
           and tablename = 'data_export_requests' and policyname = 'exports own insert'
           and with_check like '%pending%' and with_check like '%file_url%'
       ) then 'OK' else 'NOT UPDATED — export rows can still be forged' end
union all
select 'export guard trigger installed',
       case when exists (
         select 1 from pg_trigger
          where tgrelid = 'public.data_export_requests'::regclass
            and tgname = 'trg_guard_export_request' and not tgisinternal
       ) then 'OK' else 'MISSING — RLS is the only layer left' end
union all
select 'file_url https constraint present',
       case when exists (
         select 1 from pg_constraint where conname = 'data_export_file_url_https'
       ) then 'OK' else 'MISSING' end
union all
select 'admins can still complete an export (panel not broken)',
       case when exists (
         select 1 from pg_policies where schemaname = 'public'
           and tablename = 'data_export_requests' and policyname = 'exports admin update'
       ) then 'OK' else 'MISSING — 0037''s admin update policy is gone' end
order by 1;


-- Existing rows that would fail the new constraint. Expect zero. Anything
-- listed here is either a forged row or a real export stored on a non-https
-- URL; look at each one, fix or delete it, then VALIDATE the constraint.
select 'suspect export rows (expect 0 rows)' as check,
       id, user_id, status, file_url, requested_at
  from public.data_export_requests
 where file_url is not null
   and file_url !~ '^https://'
 order by requested_at desc;


-- ── THE TESTS THAT ACTUALLY PROVE IT, with two accounts ──
--
-- 1. LOCATION (the one that matters). As A: turn location sharing on with
--    visibility 'public'. As B: confirm you can see A on the map. Now as A,
--    block B. As B, reload — A must disappear, and a direct
--    GET /rest/v1/user_locations?user_id=eq.<A> must come back empty.
--    Then as A, check the Blocked users screen still lists B by name: if that
--    went blank, something took the one-directional profile rule with it.
--
-- 2. LIVE CHAT. As A: go live. As B (blocked by A): open the stream and try to
--    send a chat message — it must be refused. As C (not blocked): the same
--    message must still send.
--
-- 3. EXPORT. As any signed-in user, post directly at PostgREST:
--      POST /rest/v1/data_export_requests
--      { "user_id": "<self>", "status": "ready", "file_url": "https://x/" }
--    The row must land as status 'pending' with a null file_url (the trigger
--    pins it) or be refused outright by the policy. Then use the app's normal
--    "Download your data" button — it must still create a pending request —
--    and mark that request ready from the admin panel, which must still work.
