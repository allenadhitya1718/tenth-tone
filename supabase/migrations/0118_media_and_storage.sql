-- 0118 - an upload that was never confirmed still used its slot; public
-- buckets take media only
--
-- Security review 2026-10, findings F08 (medium-high), F15 (part) and F20
-- (low). Apply after 0117. Deploy media-upload with the same change set (it
-- adds a per-day cap on signed URLs). Safe to re-run.
--
-- ============================================================
-- F08 - PENDING UPLOADS STOPPED COUNTING AFTER 15 MINUTES
-- ============================================================
-- user_uploads_today() (latest 0081) counted a 'pending' media_objects row
-- only while it was younger than 15 minutes. A pending row is a signed PUT
-- URL that was handed out; if the client uploads and never calls confirm,
-- the object sits in the PUBLIC R2 bucket and the row stays pending. After
-- 15 minutes it dropped out of the daily count and byte total, so the quota
-- reopened: sign, upload, never confirm, wait, repeat - up to the in-flight
-- cap every 15 minutes, all day, at the declared size the client chose.
-- expire_pending_media() would delete those rows, but media-reconcile (its
-- only caller) is not deployed.
--
-- Now a pending row counts for the rest of the day like any other upload.
-- Deleting stale pending rows (media-reconcile) still frees nothing for the
-- day they were made, by design. media-upload additionally refuses more than
-- MAX_SIGNS_PER_DAY signs per person per UTC day.
--
-- Also F15: user_uploads_today(p_user) answered for any user id when called
-- directly; it now answers only about the caller in that case (see
-- called_as_rpc in 0112).

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
       -- 0118: 'pending' at any age. An unconfirmed upload may well be
       -- sitting in the bucket; it used its slot.
       and status in ('stored', 'rejected', 'deleted', 'pending')
  )
  select (supa.n + r2.n)::integer, (supa.b + r2.b)::bigint
    from supa, r2
   where not public.called_as_rpc('user_uploads_today')
      or p_user = auth.uid();
$fn$;
revoke all on function public.user_uploads_today(uuid) from public, anon;
grant execute on function public.user_uploads_today(uuid) to authenticated;


-- ============================================================
-- F20 - PUBLIC BUCKETS ACCEPTED ANY CONTENT TYPE
-- ============================================================
-- avatars, videos and group-photos are public and had no allowed_mime_types,
-- so a signed-in user could upload text/html or image/svg+xml into their own
-- folder and get a public URL on the project's storage domain serving it.
-- Restricted to the media types the apps actually upload (both apps send the
-- picker's / recorder's type; application/octet-stream is kept because a
-- picker that reports no type falls back to it, and it is served as a
-- download, not rendered). chat-media is private (signed URLs, members only)
-- and carries voice notes and files, so it is left as it is.

update storage.buckets
   set allowed_mime_types = array[
         'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
         'image/heic', 'image/heif', 'image/avif',
         'application/octet-stream'
       ]
 where id in ('avatars', 'group-photos');

update storage.buckets
   set allowed_mime_types = array[
         'video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp', 'video/x-m4v',
         'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
         'application/octet-stream'
       ]
 where id = 'videos';


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'stale pending uploads count toward the day' as check,
       case when pg_get_functiondef('public.user_uploads_today(uuid)'::regprocedure)
                 like '%''deleted'', ''pending''%'
            then 'OK' else 'NOT UPDATED' end as result
union all
select 'bucket ' || id || ' has a content-type allow list',
       case when allowed_mime_types is not null
             and not ('text/html' = any(allowed_mime_types))
             and not ('image/svg+xml' = any(allowed_mime_types))
            then 'OK' else 'OPEN' end
  from storage.buckets where id in ('avatars', 'group-photos', 'videos')
order by 1;

-- Objects already uploaded with a dangerous type (review and delete by hand):
--
--   select bucket_id, name, metadata->>'mimetype' as type, created_at
--     from storage.objects
--    where bucket_id in ('avatars', 'group-photos', 'videos')
--      and coalesce(metadata->>'mimetype', '') !~ '^(image|video)/'
--    order by created_at desc;
