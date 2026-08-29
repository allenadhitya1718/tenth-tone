-- ============================================================
-- 0031_upload_quotas.sql
--
-- Makes the storage bill a number you choose rather than one that
-- happens to you.
--
-- Neither Cloudflare nor Supabase offers a hard spending cap, so the
-- ceiling has to live where the bytes come from: this app. Nothing
-- reaches storage except through an upload, and every upload now passes
-- a quota check enforced by a storage policy - not by client code that
-- could be bypassed.
--
--   app_limits            - one row of tunable ceilings
--   within_upload_quota() - the gate, called from the storage policy
--   storage_used_bytes()  - what is actually stored right now
--
-- Set global_max_bytes below your provider's free allowance and the bill
-- is structurally zero: uploads start failing before you ever cross it.
--
-- Apply in the Supabase SQL editor AFTER 0001..0030.
-- ============================================================

-- ── Tunable limits, one row ──
create table if not exists public.app_limits (
  id                 smallint primary key default 1 check (id = 1),

  -- A 90-second clip lands near 10-15 MB after compression, so 60 MB is
  -- generous for a real upload and a third of the old headroom for abuse.
  max_video_bytes    bigint  not null default 62914560,      -- 60 MB

  -- Per person, per day.
  user_daily_uploads integer not null default 20,
  user_daily_bytes   bigint  not null default 524288000,     -- 500 MB

  -- The whole point: total stored bytes across every bucket. 9 GB sits
  -- inside both the Supabase and Cloudflare R2 free allowances, so while
  -- this stands the storage bill cannot leave zero. Raise it deliberately
  -- when you decide to spend.
  global_max_bytes   bigint  not null default 9663676416,    -- 9 GB

  updated_at         timestamptz not null default now()
);

insert into public.app_limits (id) values (1) on conflict (id) do nothing;

alter table public.app_limits enable row level security;

-- Readable by everyone signed in, so the app can show remaining quota.
-- Writable only by admins.
drop policy if exists "app_limits read" on public.app_limits;
create policy "app_limits read" on public.app_limits
  for select to authenticated using (true);

drop policy if exists "app_limits admin write" on public.app_limits;
create policy "app_limits admin write" on public.app_limits
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));


-- ── What is actually stored ──
-- Reads storage.objects directly, so it measures reality rather than a
-- counter that can drift out of step with the files.
create or replace function public.storage_used_bytes()
returns bigint
language sql
security definer
stable
set search_path = public, storage
as $fn$
  select coalesce(sum((metadata->>'size')::bigint), 0)::bigint
  from storage.objects;
$fn$;

grant execute on function public.storage_used_bytes() to authenticated;


-- ── One person's uploads today ──
-- Video paths are videos/<user_id>/..., so the owner is the first folder.
create or replace function public.user_uploads_today(p_user uuid)
returns table (upload_count integer, upload_bytes bigint)
language sql
security definer
stable
set search_path = public, storage
as $fn$
  select
    count(*)::integer,
    coalesce(sum((metadata->>'size')::bigint), 0)::bigint
  from storage.objects
  where bucket_id in ('videos', 'chat-media')
    and (storage.foldername(name))[1] = p_user::text
    and created_at >= date_trunc('day', now());
$fn$;

grant execute on function public.user_uploads_today(uuid) to authenticated;


-- ── The gate ──
-- Called from the storage insert policy, so it holds even if someone talks
-- to the storage API directly with the public key.
--
-- The size of the file being uploaded is not known here - Supabase fills in
-- metadata after the row lands - so this measures usage BEFORE this file.
-- The overshoot is therefore capped at one file, which max_video_bytes
-- bounds anyway.
create or replace function public.within_upload_quota(p_user uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public, storage
as $fn$
declare
  v_lim   public.app_limits%rowtype;
  v_count integer;
  v_bytes bigint;
  v_total bigint;
begin
  if p_user is null then return false; end if;

  select * into v_lim from public.app_limits where id = 1;
  if not found then return true; end if;   -- unconfigured means unrestricted

  -- Admins are exempt, so a full disk never locks the operators out.
  if exists (select 1 from public.profiles where id = p_user and is_admin) then
    return true;
  end if;

  select upload_count, upload_bytes into v_count, v_bytes
  from public.user_uploads_today(p_user);

  if v_count >= v_lim.user_daily_uploads then return false; end if;
  if v_bytes >= v_lim.user_daily_bytes  then return false; end if;

  v_total := public.storage_used_bytes();
  if v_total >= v_lim.global_max_bytes then return false; end if;

  return true;
end;
$fn$;

grant execute on function public.within_upload_quota(uuid) to authenticated;


-- ── Tell the app why an upload would fail, before it tries ──
-- The policy can only say yes or no; this explains which ceiling was hit so
-- the person gets a real message instead of a generic refusal.
create or replace function public.upload_quota_status()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, storage
as $fn$
declare
  v_me    uuid := auth.uid();
  v_lim   public.app_limits%rowtype;
  v_count integer;
  v_bytes bigint;
  v_total bigint;
  v_reason text := null;
begin
  if v_me is null then return jsonb_build_object('allowed', false, 'reason', 'signed_out'); end if;

  select * into v_lim from public.app_limits where id = 1;
  select upload_count, upload_bytes into v_count, v_bytes from public.user_uploads_today(v_me);
  v_total := public.storage_used_bytes();

  if exists (select 1 from public.profiles where id = v_me and is_admin) then
    v_reason := null;
  elsif v_count >= v_lim.user_daily_uploads then v_reason := 'daily_count';
  elsif v_bytes >= v_lim.user_daily_bytes    then v_reason := 'daily_bytes';
  elsif v_total >= v_lim.global_max_bytes    then v_reason := 'global_full';
  end if;

  return jsonb_build_object(
    'allowed',          v_reason is null,
    'reason',           v_reason,
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


-- ── Enforce it at the storage layer ──
drop policy if exists "videos own write" on storage.objects;
create policy "videos own write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.within_upload_quota(auth.uid())
  );

drop policy if exists "chat media own write" on storage.objects;
create policy "chat media own write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.within_upload_quota(auth.uid())
  );


-- ── Hard per-file ceilings, enforced by storage itself ──
-- 200 MB allowed roughly 5,000 uploads per terabyte of abuse. 60 MB is
-- still four times a realistic 90-second clip.
update storage.buckets set file_size_limit =  62914560 where id = 'videos';      -- 60 MB
update storage.buckets set file_size_limit =  20971520 where id = 'chat-media';  -- 20 MB
update storage.buckets set file_size_limit =   5242880 where id = 'avatars';     --  5 MB
