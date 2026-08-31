-- 0058 — close the avatars quota bypass, and give group-photos a policy at all
--
-- Found by testing rather than by reading: with a signed-in account already
-- over its daily limit (uploads_today 30, limit 20, upload_quota_status
-- reporting allowed=false), uploads were correctly refused for `videos`,
-- `chat-media` and `group-photos` — and ACCEPTED for `avatars`.
--
-- 1. THE BYPASS. 0031 rewrote the insert policies for `videos` and
--    `chat-media` to call within_upload_quota(), but left the `avatars`
--    policy from 0001 untouched. So any authenticated account could write an
--    unlimited number of 5 MB files to `avatars`, ignoring user_daily_uploads
--    and user_daily_bytes — and, because the global check also lives inside
--    within_upload_quota(), ignoring global_max_bytes as well. Storage growth
--    there was bounded by nothing at all.
--
--    user_uploads_today() also counted only `videos` and `chat-media`, so
--    those files were invisible to the very ceiling meant to catch them.
--
-- 2. GROUP PHOTOS WERE BROKEN. The bucket is created in 0001 and db.js
--    uploads to it when a group is given a photo, but no insert policy was
--    ever written for it. With RLS on, that upload fails for everyone — the
--    "blocked" result in testing was not the quota working, it was the
--    feature not working. It gets the same own-folder + quota rule as the
--    others.
--
-- Overwriting your own avatar stays free: that is an UPDATE, storage.objects
-- keeps its original created_at, and nothing new is stored.

-- ── Count every bucket a user can write to ──
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
  where bucket_id in ('videos', 'chat-media', 'avatars', 'group-photos')
    and (storage.foldername(name))[1] = p_user::text
    and created_at >= date_trunc('day', now());
$fn$;

grant execute on function public.user_uploads_today(uuid) to authenticated;

-- ── Avatars: same gate as everything else ──
drop policy if exists "avatars own write" on storage.objects;
create policy "avatars own write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.within_upload_quota(auth.uid())
  );

-- The admin path from 0040 is deliberately left in place: seeding writes
-- avatars for accounts that cannot sign in, and within_upload_quota() exempts
-- admins anyway, so a full disk never locks the operators out.

-- ── Group photos: a policy where there was none ──
drop policy if exists "group photos public read" on storage.objects;
create policy "group photos public read" on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'group-photos');

drop policy if exists "group photos own write" on storage.objects;
create policy "group photos own write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'group-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.within_upload_quota(auth.uid())
  );

drop policy if exists "group photos own update" on storage.objects;
create policy "group photos own update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'group-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- A per-file ceiling for group-photos, which 0031 set for the other three
-- but not this one. Group photos are stills.
update storage.buckets set file_size_limit = 5242880 where id = 'group-photos';  -- 5 MB

-- ── Verify after running ──
-- Expect four rows, every one of them with within_upload_quota in the check:
--
--   select polname, pg_get_expr(polwithcheck, polrelid) as check_expr
--     from pg_policy
--    where polrelid = 'storage.objects'::regclass
--      and polcmd = 'a'
--    order by polname;
