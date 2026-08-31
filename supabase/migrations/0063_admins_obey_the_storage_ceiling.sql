-- 0063 — nobody walks past the storage ceiling, operators included
--
-- 0031 exempted admins from the whole quota, with this reasoning:
--
--     -- Admins are exempt, so a full disk never locks the operators out.
--
-- That was right at the time. Hitting the ceiling meant uploads stopped: free,
-- annoying, and a bad moment to lock out the people who fix things.
--
-- It means something else now. Media has moved to Cloudflare R2, where there
-- is a card on file and no spending cap, and global_max_bytes is the only
-- thing standing between this app and a bill that arrives by itself. An
-- exemption from "uploads stop" and an exemption from "money starts" are not
-- the same exemption, and the second one was never intended.
--
-- Both admin accounts (mohamed_syed2, user_d6aceb49) could upload past 8 GB
-- without being stopped. So:
--
--   DAILY limits  — admins stay exempt. Those exist to stop one person
--                   flooding the app, and an operator testing or moderating
--                   should not trip over them.
--   GLOBAL limit  — applies to everyone. It is the money one.
--
-- The escape hatch is not "be an admin", it is "raise the number" — a
-- deliberate, visible, logged decision by someone who has looked at the bill.
-- That is what a spending limit should require.
--
-- ── The second hole ──
-- Fixing within_upload_quota() alone would NOT have been enough, which is the
-- part worth remembering. 0040 added admin-only storage policies so that
-- media could be seeded for accounts that cannot sign in:
--
--     create policy "videos admin write" on storage.objects
--       for insert to authenticated
--       with check (bucket_id = 'videos' and public.is_admin());
--
-- Postgres OR's together every policy for a command, so an admin insert that
-- failed the quota policy still succeeded through this one — no quota check in
-- it at all. Tightening the function while leaving these alone would have
-- produced a ceiling that looked enforced and was not.

-- ── Just the money ceiling, on its own ──
-- Split out so the storage policies can require it without also imposing the
-- daily limits, which would break seeding.
create or replace function public.within_global_storage_limit()
returns boolean
language plpgsql
security definer
stable
set search_path = public, storage
as $fn$
declare
  v_limit bigint;
begin
  select global_max_bytes into v_limit from public.app_limits where id = 1;
  if v_limit is null or v_limit <= 0 then return true; end if;   -- unconfigured means unrestricted
  return public.storage_used_bytes() < v_limit;
end;
$fn$;

grant execute on function public.within_global_storage_limit() to authenticated;


-- ── The gate ──
-- Same signature as 0031's, so the storage policies that call it are unchanged.
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

grant execute on function public.within_upload_quota(uuid) to authenticated;


-- ── The explanation the app shows ──
-- global_full is now tested FIRST, so an admin who has hit the ceiling is told
-- so rather than being told everything is fine. db.js already has an Arabic
-- message for that reason, so no client change is needed.
create or replace function public.upload_quota_status()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, storage
as $fn$
declare
  v_me       uuid := auth.uid();
  v_lim      public.app_limits%rowtype;
  v_count    integer;
  v_bytes    bigint;
  v_total    bigint;
  v_is_admin boolean;
  v_reason   text := null;
begin
  if v_me is null then
    return jsonb_build_object('allowed', false, 'reason', 'signed_out');
  end if;

  select * into v_lim from public.app_limits where id = 1;
  select upload_count, upload_bytes into v_count, v_bytes from public.user_uploads_today(v_me);
  v_total := public.storage_used_bytes();

  v_is_admin := exists (select 1 from public.profiles where id = v_me and is_admin);

  if v_total >= v_lim.global_max_bytes then
    v_reason := 'global_full';                        -- applies to everyone
  elsif v_is_admin then
    v_reason := null;                                 -- daily limits waived
  elsif v_count >= v_lim.user_daily_uploads then
    v_reason := 'daily_count';
  elsif v_bytes >= v_lim.user_daily_bytes then
    v_reason := 'daily_bytes';
  end if;

  return jsonb_build_object(
    'allowed',          v_reason is null,
    'reason',           v_reason,
    'is_admin',         v_is_admin,
    'max_video_bytes',  v_lim.max_video_bytes,
    'uploads_today',    v_count,
    'uploads_limit',    v_lim.user_daily_uploads,
    'bytes_today',      v_bytes,
    'bytes_limit',      v_lim.user_daily_bytes,
    'global_used',      v_total,
    'global_limit',     v_lim.global_max_bytes
  );
end;
$fn$;

grant execute on function public.upload_quota_status() to authenticated;


-- ── Close the 0040 bypass ──
-- The admin path stays — seeding still needs it — but it no longer skips the
-- money ceiling. Only the global limit is added, not the daily ones, or
-- seeding a batch of demo clips would trip user_daily_uploads.
drop policy if exists "videos admin write" on storage.objects;
create policy "videos admin write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'videos'
    and public.is_admin()
    and public.within_global_storage_limit()
  );

drop policy if exists "avatars admin write" on storage.objects;
create policy "avatars admin write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and public.is_admin()
    and public.within_global_storage_limit()
  );

-- "videos admin update" is deliberately left alone. An update replaces an
-- existing object rather than adding one, and gating it on a full disk would
-- block the very action that makes room.


-- ── Verify ──
-- 1. Both admin accounts must now be refused when the ceiling is below usage,
--    and allowed again when it is not:
--
--      update public.app_limits set global_max_bytes = 1 where id = 1;
--
--      select p.handle, p.is_admin, public.within_upload_quota(p.id) as can_upload
--        from public.profiles p order by p.is_admin desc limit 8;
--      -- expect can_upload = false for EVERY row, admins included.
--      -- Before this migration the two admins came back true.
--
--      update public.app_limits set global_max_bytes = 900000000 where id = 1;
--      -- re-run: admins true, and non-admins true as well while there is room
--
-- 2. Every insert policy on storage.objects must mention a quota function:
--
--      select polname, pg_get_expr(polwithcheck, polrelid) as check_expr
--        from pg_policy
--       where polrelid = 'storage.objects'::regclass and polcmd = 'a'
--       order by polname;
--      -- expect within_upload_quota or within_global_storage_limit in each
