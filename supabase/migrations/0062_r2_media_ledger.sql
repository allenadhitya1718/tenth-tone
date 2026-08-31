-- 0062 — teach the quota to see files that are not in Supabase
--
-- Media is moving to Cloudflare R2. Read 0059's warning before this one; this
-- migration is the answer to it.
--
-- ── Why this has to exist ──
-- Every ceiling in this app is measured by public.storage_used_bytes(), which
-- sums storage.objects — SUPABASE's table. within_upload_quota() calls it
-- before every upload, and the 07:00 storage alert calls it once a day.
--
-- The moment a video is written to R2 instead, that table stops growing.
-- storage_used_bytes() would report the same ~200 MB for ever: the quota would
-- never refuse an upload, the alert would never fire, and R2 would fill toward
-- the 10 GB where the card on file starts being charged — in silence.
--
-- A monitor pointed at the wrong storage is worse than no monitor, because it
-- reassures. So the accounting moves BEFORE the uploads do.
--
-- ── How ──
-- R2 has no database and no policies, so it cannot be asked "how full are you?"
-- on the hot path. Instead every R2 object is recorded here as it is created,
-- and storage_used_bytes() sums Supabase AND this table. Every existing ceiling
-- then keeps working untouched — within_upload_quota(), upload_quota_status()
-- and check_storage_alert() are not modified by this file at all. They simply
-- start seeing R2.
--
-- Nothing here switches uploads over. Applying it on today's app changes no
-- behaviour: the table is empty, so the sums are identical. That is deliberate
-- — the accounting is proven correct before a single byte moves.

-- ── The ledger ──
-- Written only by the media-upload Edge Function, using the service role. No
-- client can insert here, which is the whole point: a row is created when the
-- SERVER decides to allow an upload, not when a phone claims one happened.
create table if not exists public.media_objects (
  id           uuid primary key default gen_random_uuid(),

  -- Mirrors the Supabase bucket names ('videos', 'avatars', ...) so the same
  -- vocabulary works on both sides while the two exist together.
  bucket       text not null,
  key          text not null,

  user_id      uuid not null references auth.users(id) on delete cascade,

  -- At 'pending' this is what the client SAID it would upload. At 'stored' it
  -- has been replaced by what R2 actually reports. The distinction is the
  -- point: a client can lie, R2 cannot.
  size_bytes   bigint not null default 0 check (size_bytes >= 0),
  content_type text,

  --   pending  — an upload was authorised and a signed URL handed out
  --   stored   — the bytes are in R2 and have been measured
  --   rejected — measured and refused (oversized, wrong type); bytes deleted
  status       text not null default 'pending'
               check (status in ('pending', 'stored', 'rejected')),

  created_at   timestamptz not null default now(),
  confirmed_at timestamptz,

  -- One row per object, so the confirm step is idempotent: a phone retrying on
  -- a flaky connection cannot double-count its own upload.
  unique (bucket, key)
);

create index if not exists media_objects_user_day
  on public.media_objects (user_id, created_at desc);

create index if not exists media_objects_status
  on public.media_objects (status, created_at desc);

alter table public.media_objects enable row level security;

-- Readable so a person can see their own uploads and an operator can audit.
-- Deliberately NO insert, update or delete policy: writes belong to the Edge
-- Function alone, which uses the service role and bypasses RLS. If a client
-- could write here it could declare a 0-byte file and walk straight past the
-- ceiling this table exists to defend.
drop policy if exists "media_objects own read" on public.media_objects;
create policy "media_objects own read" on public.media_objects
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());


-- ── Count the bytes wherever they live ──
-- Same name, same signature, same return type as 0031's version, so every
-- existing caller picks this up with no change of its own.
--
-- Pending rows count TOWARD usage, and that is not an accident. Without it an
-- attacker could ask for a thousand signed URLs at once: each request would run
-- the quota check before any of the uploads had landed, every one would see
-- plenty of room, and all thousand would be authorised. Counting the
-- authorisation rather than the arrival closes that race.
--
-- Pending rows stop counting after 15 minutes, so an abandoned upload does not
-- inflate usage for ever — signed URLs live for minutes, so anything older than
-- that is never going to arrive. expire_pending_media() clears them properly.
create or replace function public.storage_used_bytes()
returns bigint
language sql
security definer
stable
set search_path = public, storage
as $fn$
  select
    coalesce((select sum((metadata->>'size')::bigint) from storage.objects), 0)
  + coalesce((select sum(size_bytes) from public.media_objects
               where status = 'stored'
                  or (status = 'pending'
                      and created_at > now() - interval '15 minutes')), 0);
$fn$;

grant execute on function public.storage_used_bytes() to authenticated;


-- ── One person's uploads today, wherever they went ──
-- Extends 0058's version. The daily count and daily byte ceilings would
-- otherwise reset to zero on the day uploads move to R2.
create or replace function public.user_uploads_today(p_user uuid)
returns table (upload_count integer, upload_bytes bigint)
language sql
security definer
stable
set search_path = public, storage
as $fn$
  with supa as (
    select count(*)::integer as n,
           coalesce(sum((metadata->>'size')::bigint), 0)::bigint as b
      from storage.objects
     where bucket_id in ('videos', 'chat-media', 'avatars', 'group-photos')
       and (storage.foldername(name))[1] = p_user::text
       and created_at >= date_trunc('day', now())
  ),
  r2 as (
    select count(*)::integer as n,
           coalesce(sum(size_bytes), 0)::bigint as b
      from public.media_objects
     where user_id = p_user
       and created_at >= date_trunc('day', now())
       -- A rejected upload still cost a slot. Not counting it would let
       -- somebody retry oversized files all day at no charge to their quota.
       and (status in ('stored', 'rejected')
            or (status = 'pending'
                and created_at > now() - interval '15 minutes'))
  )
  select (supa.n + r2.n)::integer, (supa.b + r2.b)::bigint from supa, r2;
$fn$;

grant execute on function public.user_uploads_today(uuid) to authenticated;


-- ── Housekeeping ──
-- Called nightly by the reconcile Edge Function, which does the R2 half of the
-- job (listing the bucket, deleting orphans). This is the database half:
-- forget authorisations that never became files.
--
-- Returns the keys it gave up on, because a phone that uploaded and then died
-- before confirming leaves REAL bytes behind an abandoned row. The caller
-- checks each one against R2 rather than assuming it never arrived.
-- The output columns are NOT called bucket/key: RETURNS TABLE declares them as
-- OUT parameters, which are visible by name inside the body, so `returning
-- bucket, key` would be ambiguous against the table's own columns of the same
-- name. Prefixing the outputs removes the collision.
create or replace function public.expire_pending_media(
  p_older_than interval default interval '1 hour'
)
returns table (out_bucket text, out_key text)
language sql
security definer
set search_path = public
as $fn$
  delete from public.media_objects
   where status = 'pending'
     and created_at < now() - p_older_than
  returning media_objects.bucket, media_objects.key;
$fn$;

revoke all on function public.expire_pending_media(interval) from public, anon, authenticated;
grant execute on function public.expire_pending_media(interval) to service_role;


-- ── After running ──
-- Nothing should change yet. Confirm exactly that:
--
--   select public.storage_used_bytes()                                as used,
--          (select global_max_bytes from public.app_limits where id=1) as ceiling,
--          (select count(*) from public.media_objects)                 as ledger_rows,
--          public.upload_quota_status() -> 'allowed'                   as still_allowed;
--
-- Expect ledger_rows = 0, `used` identical to before this migration, and
-- still_allowed = true. If `used` moved, something has already written to the
-- ledger and that needs explaining before any upload is switched over.
