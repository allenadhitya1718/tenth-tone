-- 0081 — when a post is deleted, the file is deleted too
--
-- 0068 gave people a delete button and deliberately stopped short of the
-- bytes:
--
--     "Storing a few orphaned megabytes is the right trade against a delete
--      path that could remove the wrong file."
--
-- That was the correct call for a cost problem. It is the wrong call for a
-- privacy one, and this is a privacy one. R2 is served from a public base with
-- no authentication of any kind — R2_ROLLOUT step 11 says so in as many words:
-- "anyone holding a media URL can still fetch it". So a person who deletes a
-- post is told it is gone, the row really is gone, and the file stays
-- world-readable at its URL for ever, to anyone who ever saw that URL. An app
-- store submission that claims deletion means deletion cannot rest on that.
--
-- The objection in 0068 is not withdrawn, it is answered: nothing here deletes
-- anything. This migration only makes it POSSIBLE to check safely. The delete
-- itself lives in the media-upload Edge Function, behind a check that the
-- object is yours and that no row in any of the five columns that can hold a
-- media URL still points at it. If any of those five checks cannot be
-- completed, it refuses. Orphaned bytes remain strictly preferable to the
-- wrong file, and that ordering is preserved everywhere below.
--
-- Three parts:
--   1. a 'deleted' state for the ledger, so the bytes stop being counted as
--      stored without the row (and its quota history) disappearing
--   2. an index on key, so the lookup by key is not a table scan
--   3. the part without which none of this works: scrubbing the media URLs off
--      an original sound when its video is deleted
--
-- Part 3 is the whole reason this file is not just an Edge Function change.
-- See its section for what breaks without it.

begin;

-- =====================================================================
-- 1. A fourth state: the bytes are gone
-- =====================================================================
-- 0062 gave media_objects three states — pending, stored, rejected — because
-- at the time nothing ever removed an object that had successfully landed.
-- Now something does, and it needs somewhere to say so.
--
-- Marked rather than deleted, for two reasons that pull in opposite
-- directions and both matter:
--
--   * storage_used_bytes() sums `status = 'stored'`, so flipping to 'deleted'
--     stops the bytes counting toward the ceiling — which is right, they are
--     no longer in the bucket and no longer billed.
--
--   * user_uploads_today() counts a person's uploads for the day, and if a
--     deleted row vanished from that count, upload → delete → upload → delete
--     would be an unlimited daily allowance. The row is kept and section 1b
--     teaches that function to keep counting it. You spent the slot; deleting
--     the file afterwards does not refund it.
--
-- The constraint is dropped by looking it up rather than by its expected
-- name. 0062 declared the check inline, so its name is whatever Postgres
-- generated; `drop constraint if exists media_objects_status_check` would
-- silently do nothing on a database where that guess is wrong, and the `add`
-- below would then succeed alongside the ORIGINAL constraint — leaving a table
-- that still rejects 'deleted' and a migration that reported success.
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class      rel on rel.oid = con.conrelid
      join pg_namespace  ns  on ns.oid  = rel.relnamespace
     where ns.nspname   = 'public'
       and rel.relname  = 'media_objects'
       and con.contype  = 'c'
       and pg_get_constraintdef(con.oid) like '%rejected%'
  loop
    execute format('alter table public.media_objects drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.media_objects
  add constraint media_objects_status_check
  check (status in ('pending', 'stored', 'rejected', 'deleted'));

--   deleted — the object was removed from R2 on purpose, because the last
--             thing referencing it was deleted. Distinct from 'rejected',
--             which means it was refused on arrival and never served.
alter table public.media_objects
  add column if not exists deleted_at timestamptz;


-- ── 1b. A deleted upload still spent its slot ──
-- Identical to 0062's function except for the status list. Called out rather
-- than folded in silently: this is the line that stops delete-and-reupload
-- being a way around the daily ceiling, and it is easy to lose in a future
-- rewrite of this function that copies 0062's version.
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
       -- 'deleted' joins 'rejected' here. Both describe an upload whose bytes
       -- are no longer in the bucket, and neither should hand back the quota
       -- slot it used on the way in.
       and (status in ('stored', 'rejected', 'deleted')
            or (status = 'pending'
                and created_at > now() - interval '15 minutes'))
  )
  select (supa.n + r2.n)::integer, (supa.b + r2.b)::bigint from supa, r2;
$fn$;

grant execute on function public.user_uploads_today(uuid) to authenticated;

-- storage_used_bytes() is deliberately NOT touched. It sums 'stored' plus
-- fresh 'pending', so a 'deleted' row drops out of the usage total on its own
-- — which is exactly the intent. Restated here because the two functions are
-- edited together often enough that "0081 forgot one" is the obvious wrong
-- conclusion to draw from this file.


-- =====================================================================
-- 2. Look a key up without scanning the table
-- =====================================================================
-- 0062's only index over keys is the `unique (bucket, key)` constraint, and
-- key is its SECOND column, so a lookup by key alone cannot use it. Two
-- callers do exactly that: media-reconcile's `.in('key', ...)` on up to 1000
-- keys per page, every hour, and now the delete path resolving a URL back to
-- its ledger row.
create index if not exists media_objects_key on public.media_objects (key);


-- =====================================================================
-- 3. A deleted video must not leave its URL behind in a sound row
-- =====================================================================
-- Without this section the rest of the feature is a no-op for most posts, and
-- it took reading three files to see why:
--
--   * publishVideo creates an "original sound" for every public, non-draft
--     post, and createOriginalSound copies the VIDEO'S OWN URL into
--     sounds.audio_url — there is no separate audio file, the browser plays
--     the mp4's audio track (0079 documents this at length). cover_url gets
--     the poster the same way.
--
--   * sounds.origin_video_id is `on delete set null` (0023). Deleting the
--     video nulls the back-pointer and leaves the sound row standing, still
--     holding both URLs.
--
--   * The Edge Function refuses to delete an object that anything still points
--     at, and sounds.audio_url / sounds.cover_url are two of the five columns
--     it checks.
--
-- So for every public post — the majority — the delete path would find the
-- orphaned sound row, correctly refuse, and nothing would ever be collected.
-- Failing safe, but permanently. The fix is not to weaken the check; it is to
-- stop leaving the reference behind.
--
-- Scrubbing rather than deleting the sound row is the conservative choice.
-- Another person's video may carry `sound_id` pointing here (`on delete set
-- null` again), and deleting the row would strip the music label off their
-- post. Nulling the two URL columns removes the reference and the leak while
-- leaving the label intact. It is also precisely the statement 0079 left at
-- the bottom of itself as the optional scrub, now run automatically at the one
-- moment it is unambiguously correct.
--
-- BEFORE delete, not AFTER: at BEFORE time old.id still exists and
-- origin_video_id still points at it. An AFTER trigger races the foreign key's
-- own `set null` action and would find nothing to scrub.
create or replace function public.scrub_original_sound_media()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.sounds
     set audio_url = null,
         cover_url = null
   where origin_video_id = old.id
     and is_original is true;
  return old;
end;
$fn$;

-- security definer is load-bearing. `sounds update own` (0023) is
-- `created_by = auth.uid()`, so under the caller's own rights an ADMIN
-- deleting somebody else's video would update zero rows — silently, since an
-- RLS-filtered UPDATE raises nothing — and the object would then be
-- undeletable for ever behind a reference nobody could clear.
revoke all on function public.scrub_original_sound_media() from public, anon, authenticated;

drop trigger if exists videos_scrub_original_sound on public.videos;
create trigger videos_scrub_original_sound
  before delete on public.videos
  for each row execute function public.scrub_original_sound_media();

commit;


-- ── Backfill: sounds orphaned by deletes that already happened ──
-- Every video deleted before today left one of these. 0079 already made them
-- unreadable to anyone but their creator (`origin_video_id is null` fails the
-- visibility subquery), so this is not closing a live leak — it is clearing
-- references that would otherwise pin those objects in R2 for ever.
--
-- Narrow on purpose: an original sound with no origin video left. A sound
-- whose video still exists is untouched, and a library track (is_original
-- false) is never an origin sound and never matched.
update public.sounds
   set audio_url = null, cover_url = null
 where is_original is true
   and origin_video_id is null
   and (audio_url is not null or cover_url is not null);


-- =====================================================================
-- Verify
-- =====================================================================
-- One query: the Supabase SQL editor shows only the last statement's result.
--
-- `sound rows still pinning a deleted video's media` must read 0. Anything
-- else means the backfill did not run and those objects cannot be collected.
select 'media_objects accepts deleted status' as check,
       case when exists (
         select 1 from pg_constraint con
           join pg_class rel on rel.oid = con.conrelid
          where rel.relname = 'media_objects' and con.contype = 'c'
            and pg_get_constraintdef(con.oid) like '%deleted%'
       ) then 'OK' else 'MISSING' end as result
union all
select 'media_objects.deleted_at column',
       case when exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'media_objects'
            and column_name = 'deleted_at'
       ) then 'OK' else 'MISSING' end
union all
select 'key index present',
       case when exists (
         select 1 from pg_indexes
          where schemaname = 'public' and indexname = 'media_objects_key'
       ) then 'OK' else 'MISSING' end
union all
select 'scrub trigger on videos',
       case when exists (
         select 1 from pg_trigger
          where tgname = 'videos_scrub_original_sound' and not tgisinternal
       ) then 'OK' else 'MISSING' end
union all
select 'daily quota still counts deleted uploads',
       case when pg_get_functiondef(
              'public.user_uploads_today(uuid)'::regprocedure
            ) like '%''deleted''%'
            then 'OK' else 'MISSING' end
union all
select 'sound rows still pinning a deleted video''s media',
       (select count(*)::text from public.sounds
         where is_original is true and origin_video_id is null
           and (audio_url is not null or cover_url is not null))
order by 1;


-- ── After running ──
-- Deploy the Edge Function, which is where the actual delete lives:
--
--   npx supabase functions deploy media-upload
--
-- Then test in this order, because the second half is the half worth checking:
--
--   1. Post a clip, note its video_url, delete the post, and fetch that URL.
--      Expect 404 rather than video bytes. Before this change it returned 206
--      and the file.
--   2. Confirm media_objects has status 'deleted' and a deleted_at for both
--      the clip and its poster.
--   3. The one that matters: point a SECOND video row at an existing object's
--      URL by hand, delete the first video, and confirm the object is STILL
--      THERE and the function answered still_referenced. Put the row back
--      afterwards. A delete path is only as good as the check that stops it,
--      and nothing on screen would ever reveal that check silently passing.
