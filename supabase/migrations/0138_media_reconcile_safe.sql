-- 0138 - safe orphan-upload cleanup (F08 completed)
--
-- Security review 2026-10, finding F08. Apply after 0137. Safe to re-run.
--
-- ============================================================
-- WHY
-- ============================================================
-- A signed-but-never-confirmed upload leaves a media_objects row 'pending'
-- and possibly real bytes in R2. The old media-reconcile walked the WHOLE
-- bucket and deleted anything without a ledger row. The bucket is SHARED with
-- the old project, so that would have deleted the other project's files. It
-- was therefore never deployed.
--
-- The rewritten function NEVER lists the bucket. It works only from this
-- project's own ledger: keys that media-upload signed (videos/xx/<32 hex>.ext)
-- and that are still 'pending' after min_age_hours (>= 24) with nothing in the
-- database pointing at them. This migration holds the database half:
--   reconcile_config            kill switch, live flag (default OFF = dry run),
--                               batch limit, minimum age
--   media_key_referenced(key)   is the key held by any URL column
--   media_orphan_scan(...)      what WOULD be deleted (read only)
--   media_orphan_claim(ids)     atomic claim: pending -> deleted, re-checked
--   media_orphan_release(ids)   undo the claim for objects R2 failed to delete
--   run_media_reconcile()       one pg_net call to the function (daily cron)
--
-- Deletion stays OFF until reconcile_config.live is set to true by the owner
-- (see supabase/RUN_NOW_schedule_reconcile.sql). The daily job reports in
-- admin_logs ('media_reconcile') either way.

begin;

create table if not exists public.reconcile_config (
  id              boolean primary key default true check (id),
  enabled         boolean not null default true,      -- kill switch: false = the function does nothing
  live            boolean not null default false,     -- false = dry run only, nothing is deleted
  batch_limit     integer not null default 100 check (batch_limit between 1 and 500),
  min_age_hours   integer not null default 24 check (min_age_hours >= 24),
  updated_at      timestamptz not null default now()
);
insert into public.reconcile_config (id) values (true) on conflict (id) do nothing;
alter table public.reconcile_config enable row level security;
revoke all on public.reconcile_config from public, anon, authenticated;

-- ── Is this key held by anything? ───────────────────────────────────────
-- Matched as a suffix (like media-upload's delete action), so a change of
-- public base URL cannot turn a live reference into a miss. The list covers
-- every text column that can hold a media URL (checked in VERIFY below).
create or replace function public.media_key_referenced(p_key text)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare
  v_pairs text[][] := array[
    ['videos','video_url'], ['videos','thumbnail'],
    ['sounds','audio_url'], ['sounds','cover_url'],
    ['live_streams','thumbnail'], ['live_streams','background_image'],
    ['stories','media_url'], ['stories','poster_url'],
    ['profiles','avatar_url'],
    ['messages','attachment_url'],
    ['chats','photo_url'],
    ['ads','image_url'],
    ['gifts','asset_url'],
    ['media_delete_queue','url']
  ];
  i int;
  hit boolean;
begin
  if coalesce(p_key, '') = '' then return true; end if;
  for i in 1 .. array_length(v_pairs, 1) loop
    if to_regclass('public.' || v_pairs[i][1]) is not null
       and exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = v_pairs[i][1]
                      and column_name = v_pairs[i][2]) then
      execute format('select exists (select 1 from public.%I where %I like $1)',
                     v_pairs[i][1], v_pairs[i][2])
        into hit using '%' || p_key;
      if hit then return true; end if;
    end if;
  end loop;
  return false;
end;
$fn$;
revoke all on function public.media_key_referenced(text) from public, anon, authenticated;
grant execute on function public.media_key_referenced(text) to service_role;

-- A key as media-upload builds it, nothing else.
create or replace function public.media_key_is_ours(p_bucket text, p_key text)
returns boolean
language sql
immutable
as $$
  select p_bucket in ('videos', 'chat-media', 'avatars', 'group-photos')
     and p_key ~ '^(videos|chat-media|avatars|group-photos)/[0-9a-f]{2}/[0-9a-f]{32}\.[a-z0-9]{1,6}$'
     and split_part(p_key, '/', 1) = p_bucket
$$;
revoke all on function public.media_key_is_ours(text, text) from public, anon, authenticated;
grant execute on function public.media_key_is_ours(text, text) to service_role;

-- ── Read-only scan ──────────────────────────────────────────────────────
create or replace function public.media_orphan_scan(p_limit integer, p_min_age_hours integer)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare
  v_age   interval := make_interval(hours => greatest(coalesce(p_min_age_hours, 24), 24));
  v_limit integer  := least(greatest(coalesce(p_limit, 100), 1), 500);
  r       record;
  v_cands jsonb := '[]'::jsonb;
  v_eligible integer := 0; v_bytes bigint := 0;
  v_ref integer := 0; v_badkey integer := 0; v_pending_total integer; v_pending_old integer;
begin
  select count(*) into v_pending_total from public.media_objects where status = 'pending';
  select count(*) into v_pending_old from public.media_objects
   where status = 'pending' and created_at < now() - v_age;

  for r in
    select id, bucket, key, size_bytes, created_at
      from public.media_objects
     where status = 'pending' and created_at < now() - v_age
     order by created_at
  loop
    if not public.media_key_is_ours(r.bucket, r.key) then
      v_badkey := v_badkey + 1;
    elsif public.media_key_referenced(r.key) then
      v_ref := v_ref + 1;
    else
      v_eligible := v_eligible + 1;
      v_bytes := v_bytes + coalesce(r.size_bytes, 0);
      if jsonb_array_length(v_cands) < v_limit then
        v_cands := v_cands || jsonb_build_object(
          'id', r.id, 'bucket', r.bucket, 'key', r.key,
          'size_bytes', r.size_bytes, 'created_at', r.created_at);
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'pending_total', v_pending_total,
    'pending_older_than_min_age', v_pending_old,
    'eligible', v_eligible,
    'eligible_bytes', v_bytes,
    'skipped_referenced', v_ref,
    'skipped_unrecognised_key', v_badkey,
    'candidates', v_cands);
end;
$fn$;
revoke all on function public.media_orphan_scan(integer, integer) from public, anon, authenticated;
grant execute on function public.media_orphan_scan(integer, integer) to service_role;

-- ── Atomic claim ────────────────────────────────────────────────────────
-- pending -> deleted in ONE statement, with every condition re-checked, so a
-- confirm racing the sweep either wins (row no longer pending, not claimed)
-- or loses (row is 'deleted' and confirm refuses it).
create or replace function public.media_orphan_claim(p_ids uuid[], p_min_age_hours integer)
returns table (out_id uuid, out_bucket text, out_key text, out_size bigint)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_age interval := make_interval(hours => greatest(coalesce(p_min_age_hours, 24), 24));
  r record;
begin
  for r in
    select id, bucket, key, size_bytes from public.media_objects
     where id = any (p_ids) and status = 'pending' and created_at < now() - v_age
     for update
  loop
    if public.media_key_is_ours(r.bucket, r.key) and not public.media_key_referenced(r.key) then
      update public.media_objects
         set status = 'deleted', deleted_at = now()
       where id = r.id and status = 'pending';
      out_id := r.id; out_bucket := r.bucket; out_key := r.key; out_size := r.size_bytes;
      return next;
    end if;
  end loop;
end;
$fn$;
revoke all on function public.media_orphan_claim(uuid[], integer) from public, anon, authenticated;
grant execute on function public.media_orphan_claim(uuid[], integer) to service_role;

create or replace function public.media_orphan_release(p_ids uuid[])
returns integer
language sql
security definer
set search_path = public
as $$
  with u as (
    update public.media_objects set status = 'pending', deleted_at = null
     where id = any (p_ids) and status = 'deleted'
    returning 1)
  select count(*)::integer from u
$$;
revoke all on function public.media_orphan_release(uuid[]) from public, anon, authenticated;
grant execute on function public.media_orphan_release(uuid[]) to service_role;

-- ── The daily call ──────────────────────────────────────────────────────
-- Uses the existing job_endpoints row 'media-reconcile' (URL + secret headers
-- already stored there, never printed). Whether it deletes or only reports is
-- decided by reconcile_config.live inside the function.
create or replace function public.run_media_reconcile()
returns text
language sql
security definer
set search_path = public
as $$ select public.call_job_endpoint('media-reconcile') $$;
revoke all on function public.run_media_reconcile() from public, anon, authenticated;

commit;

do $sched$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not enabled - NOTHING SCHEDULED';
    return;
  end if;
  perform cron.unschedule('media-reconcile-daily')
   where exists (select 1 from cron.job where jobname = 'media-reconcile-daily');
  perform cron.schedule('media-reconcile-daily', '10 4 * * *', $job$ select public.run_media_reconcile(); $job$);
end;
$sched$;

-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'reconcile_config exists, deletion OFF by default' as check,
       case when exists (select 1 from public.reconcile_config where id and live = false and enabled)
            then 'OK' else 'WRONG' end as result
union all select 'reconcile_config not readable by clients',
       case when not has_table_privilege('authenticated', 'public.reconcile_config', 'select')
             and not has_table_privilege('anon', 'public.reconcile_config', 'select')
            then 'OK' else 'EXPOSED' end
union all select 'claim/scan/release are service_role only',
       case when not has_function_privilege('authenticated', 'public.media_orphan_claim(uuid[],integer)', 'execute')
             and not has_function_privilege('anon', 'public.media_orphan_scan(integer,integer)', 'execute')
             and has_function_privilege('service_role', 'public.media_orphan_claim(uuid[],integer)', 'execute')
            then 'OK' else 'WRONG' end
union all select 'min age cannot go below 24h',
       case when exists (select 1 from pg_constraint where conrelid = 'public.reconcile_config'::regclass
                            and pg_get_constraintdef(oid) like '%min_age_hours >= 24%')
            then 'OK' else 'MISSING' end
union all select 'a key shaped like ours is recognised, others are not',
       case when public.media_key_is_ours('videos', 'videos/ab/' || repeat('a', 32) || '.mp4')
             and not public.media_key_is_ours('videos', 'videos/someone/else.mp4')
             and not public.media_key_is_ours('videos', 'chat-media/ab/' || repeat('a', 32) || '.mp4')
            then 'OK' else 'WRONG' end
union all select 'every URL-looking text column is covered by media_key_referenced (or is not media)',
       coalesce((select 'UNCOVERED: ' || string_agg(table_name || '.' || column_name, ', ')
                   from information_schema.columns c
                  where table_schema = 'public' and data_type = 'text'
                    and column_name ~* 'url|thumb|avatar|photo|cover|poster|attach|image|media_url|background|asset'
                    and (table_name, column_name) not in (
                      ('videos','video_url'),('videos','thumbnail'),('sounds','audio_url'),('sounds','cover_url'),
                      ('live_streams','thumbnail'),('live_streams','background_image'),
                      ('stories','media_url'),('stories','poster_url'),('profiles','avatar_url'),
                      ('messages','attachment_url'),('chats','photo_url'),('ads','image_url'),
                      ('gifts','asset_url'),('media_delete_queue','url'),
                      -- not R2 media: function URL, job URL, KYC/export private paths
                      ('alert_config','function_url'),('job_endpoints','url'),
                      ('creator_kyc','id_photo_path'),('data_export_requests','file_url'))
                    and column_name <> 'media_kind'
                  having count(*) > 0), 'OK')
union all select 'daily job scheduled',
       case when exists (select 1 from cron.job where jobname = 'media-reconcile-daily' and active)
            then 'OK' else 'NOT SCHEDULED' end;
