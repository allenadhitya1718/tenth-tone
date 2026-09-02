-- 0079 — a private video's URL must not be published to a table anyone can read
--
-- Found during App Store prep, and confirmed against the live project before a
-- line of this was written. Three separate things were true:
--
-- ── 1. THE HOLE (this file fixes it) ──
-- publishVideo creates an "original sound" for every post, and
-- createOriginalSound copies the VIDEO'S OWN URL into sounds.audio_url — there
-- is no separate audio file, the browser plays the mp4's audio track.
--
-- `sounds` has been readable by everyone since 0008:
--
--     create policy "sounds read public" on public.sounds
--       for select to authenticated, anon using (true);
--
-- So a clip published as 'private' or 'friends' had `videos` RLS hiding its
-- row, and the sound row handing its media URL straight back to any stranger
-- holding the public anon key. Media is served from a public bucket with no
-- authentication of any kind, so the URL IS the file. Verified live: one
-- unauthenticated GET against /rest/v1/sounds returns full R2 media URLs, and
-- one unauthenticated GET against such a URL returns `206 Partial Content`
-- and real video bytes.
--
-- That is the part of "private videos aren't private" a stranger could reach
-- with no account and no prior access. It is closed here in RLS, and in db.js,
-- which now simply does not write the row for a non-public post.
--
-- ── 2. NOT fixed here, because SQL cannot fix it ──
-- Anyone who already HAS a media URL keeps working access to those bytes,
-- whatever the privacy column says. Cloudflare R2 served from a public base
-- has no policy layer to consult, and the Supabase `videos` bucket is
-- `public = true`. Closing that needs an authorising proxy in front of the
-- bytes. See the note at the end of this file; pretending a migration could do
-- it would be worse than saying so.
--
-- ── 3. Enumeration ──
-- Split into 0080, because it touches storage policies rather than app tables
-- and deserves to be applied and reverted on its own.

begin;

-- =====================================================================
-- 1. Repair origin_video_id before anything depends on it
-- =====================================================================
-- 0023 added sounds.origin_video_id, but rows written before it still have
-- NULL while carrying a perfectly identifiable audio_url — it is the origin
-- video's own URL, byte for byte. (Confirmed present in the live project.)
--
-- This matters because the policy in section 2 decides visibility by looking
-- at the origin video. A NULL there would hide an otherwise fine public sound
-- from everyone but its creator. Matching on the URL repairs every row that
-- can be repaired; whatever is still NULL afterwards genuinely has no video
-- behind it any more.
-- Two passes, strongest link first.
--
-- publishVideo writes `videos.sound_id = <the sound it just made>`, so that
-- column is a direct, unambiguous back-pointer wherever it survived. Only rows
-- it cannot answer fall through to matching on the URL, which is exact but
-- softer: a video deleted since then leaves an audio_url matching nothing, and
-- that row stays NULL on purpose. We cannot prove what it belonged to, so it
-- does not get to claim a video.
update public.sounds s
   set origin_video_id = v.id
  from public.videos v
 where s.origin_video_id is null
   and v.sound_id = s.id;

update public.sounds s
   set origin_video_id = v.id
  from public.videos v
 where s.origin_video_id is null
   and s.audio_url is not null
   and v.video_url = s.audio_url;


-- =====================================================================
-- 2. A sound is exactly as visible as the video it came from
-- =====================================================================
-- Three ways a row stays readable, ordered so the cheap tests run first and
-- the subquery only when it must:
--
--   * not an original sound — a library track has no video behind it and
--                             nothing private to leak
--   * yours                 — you can always see your own
--   * its origin video is publicly visible — the same test `videos` RLS
--                             applies (0012), written out rather than
--                             inherited so this policy reads on its own
--
-- Everything else is refused, including an original sound whose origin video
-- was deleted or could not be repaired above. Failing closed is right here:
-- the cost is a missing music label under a clip that still plays, and the
-- alternative is the hole this migration exists to close.
--
-- `to authenticated, anon` is kept from 0008 — signed-out visitors still
-- browse public sounds, which was never the problem.
drop policy if exists "sounds read public" on public.sounds;
drop policy if exists "sounds read visible" on public.sounds;
create policy "sounds read visible" on public.sounds
  for select to authenticated, anon
  using (
    is_original is distinct from true
    or created_by = auth.uid()
    or exists (
      select 1
        from public.videos v
       where v.id = sounds.origin_video_id
         and v.privacy = 'public'
         and v.is_draft = false
         and v.is_hidden = false
    )
  );

-- The subquery runs per candidate row and lands on videos' primary key, so it
-- is already cheap. This index is for the other direction — the sound page
-- asking which videos came from a sound — which had no index at all.
create index if not exists sounds_origin_video on public.sounds (origin_video_id);


-- =====================================================================
-- 3. You may only create a sound as yourself
-- =====================================================================
-- 0008's insert policy is `with check (true)`, so any signed-in caller could
-- insert a sounds row claiming any created_by, any author_name and any
-- audio_url. That is a forgery primitive on its own, and after section 2 it
-- becomes a way to reopen the hole: set `created_by` to yourself on a row
-- pointing at somebody else's private media and the second clause of the read
-- policy hands it back.
--
-- createOriginalSound already sets created_by to the caller, so this refuses
-- nothing the app does.
drop policy if exists "sounds insert auth" on public.sounds;
drop policy if exists "sounds insert own" on public.sounds;
create policy "sounds insert own" on public.sounds
  for insert to authenticated
  with check (created_by = auth.uid());

commit;


-- =====================================================================
-- Verify
-- =====================================================================
-- One query on purpose: the Supabase SQL editor shows only the LAST
-- statement's result, so separate selects would report one line and silently
-- hide the rest.
--
-- Expect the three policy checks to read OK.
--
-- `original sounds still missing an origin video` should normally be 0. Each
-- one is a sound only its creator can now see, because neither backfill could
-- prove which video it came from. That is the safe direction, and the cost is
-- a missing music label under a clip that still plays. If one of them is
-- legitimately public and you want it back, set its origin_video_id by hand:
--
--   update public.sounds set origin_video_id = '<video uuid>' where id = '<sound uuid>';
--
-- `leaked_private_sound_urls` is
-- the finding itself — sound rows still carrying the media URL of a video that
-- is not public. After this migration those rows exist but are no longer
-- READABLE by anyone except their owner; if you would rather they not exist at
-- all, the statement to scrub them is at the bottom of this file.
select 'sounds read policy is privacy-aware' as check,
       case when exists (select 1 from pg_policies
                          where schemaname = 'public' and tablename = 'sounds'
                            and policyname = 'sounds read visible')
             and not exists (select 1 from pg_policies
                              where schemaname = 'public' and tablename = 'sounds'
                                and policyname = 'sounds read public')
            then 'OK' else 'MISSING' end as result
union all
select 'sounds insert is owner-bound',
       case when exists (select 1 from pg_policies
                          where schemaname = 'public' and tablename = 'sounds'
                            and policyname = 'sounds insert own')
             and not exists (select 1 from pg_policies
                              where schemaname = 'public' and tablename = 'sounds'
                                and policyname = 'sounds insert auth')
            then 'OK' else 'MISSING' end
union all
select 'origin_video_id index present',
       case when exists (select 1 from pg_indexes
                          where schemaname = 'public' and indexname = 'sounds_origin_video')
            then 'OK' else 'MISSING' end
union all
select 'original sounds still missing an origin video',
       (select count(*)::text from public.sounds
         where is_original is true and origin_video_id is null)
union all
select 'leaked_private_sound_urls',
       (select count(*)::text
          from public.sounds s
          join public.videos v on v.id = s.origin_video_id
         where s.is_original is true
           and s.audio_url is not null
           and (v.privacy <> 'public' or v.is_draft or v.is_hidden))
order by 1;


-- ── Optional: scrub the URLs already written ──
-- The policy above stops them being read, which is the security boundary. This
-- removes them from the row as well, for anyone who would rather a private
-- clip's URL not sit in a column at all. The sound row is kept so a video
-- referencing it does not lose its music label.
--
--   update public.sounds s
--      set audio_url = null, cover_url = null
--     from public.videos v
--    where v.id = s.origin_video_id
--      and s.is_original is true
--      and (v.privacy <> 'public' or v.is_draft or v.is_hidden);


-- ── What this migration does NOT fix ──
-- Anyone already holding a media URL keeps working access to those bytes, and
-- nothing in Postgres can revoke it: the object store serves them without ever
-- asking the database. Two follow-ups, cheapest first:
--
--   1. tools/rekey_media_r2.py — rewrites existing object keys to opaque
--      random ones. That BOTH removes the uploader's auth UUID from every URL
--      in the wild AND invalidates every URL leaked so far, because the old
--      key stops existing. You run it; it needs the service_role key.
--
--   2. A Cloudflare Worker on a custom domain in front of the bucket, checking
--      a Supabase JWT before serving a non-public object. This is the only
--      real answer to "private means private", and it needs flyp-sa.com's DNS
--      moved to Cloudflare first (R2_ROLLOUT.md step 2).
