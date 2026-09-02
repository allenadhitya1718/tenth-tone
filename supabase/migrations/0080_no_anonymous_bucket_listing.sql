-- 0080 — stop anonymous callers listing the public buckets
--
-- Separate from 0079 on purpose. 0079 closes a hole in an app table and is
-- unambiguously safe. This one touches storage policies, so it is worth
-- applying on its own and checking one screen afterwards.
--
-- ── What is wrong ──
-- 0001 and 0058 give the three public buckets an unconditional read policy:
--
--     create policy "videos public read" on storage.objects
--       for select to authenticated, anon using (bucket_id = 'videos');
--
-- Storage's LIST endpoint is a SELECT on storage.objects, so `using (true)`
-- for a whole bucket is also `you may enumerate this bucket`. Verified live
-- with nothing but the public anon key:
--
--     POST /storage/v1/object/list/avatars  {"prefix":"","limit":5}
--     -> [{"name":"8eb4261b-…"}, {"name":"d6aceb49-…"}]
--
-- Those folder names are auth UUIDs. It is a roster of every account that has
-- ever uploaded, free to anyone who opens the app's JavaScript.
--
-- ── Why removing it does not break reading ──
-- A public bucket is read through /storage/v1/object/public/<bucket>/<path>,
-- which storage-api serves after checking `bucket.public = true` — it does not
-- evaluate these policies at all. That URL is exactly what getPublicUrl()
-- builds, and it is the only way this app ever reads media: there is no
-- .list() and no .download() anywhere in web/js. Avatar upload uses
-- upsert (covered by the existing `avatars own write` / `own update`
-- policies), and the R2 path does not touch Supabase storage.
--
-- So these policies govern only the authenticated object route. Scoped to the
-- owner, which is what every write policy on these buckets already says.
--
-- ── If something does break ──
-- The symptom would be loud and immediate: avatars or video failing to load
-- everywhere, not something subtle. Revert with:
--
--   create policy "videos public read" on storage.objects
--     for select to authenticated, anon using (bucket_id = 'videos');
--   create policy "avatars public read" on storage.objects
--     for select to authenticated, anon using (bucket_id = 'avatars');
--   create policy "group photos public read" on storage.objects
--     for select to authenticated, anon using (bucket_id = 'group-photos');

begin;

drop policy if exists "videos public read" on storage.objects;
drop policy if exists "videos own read" on storage.objects;
create policy "videos own read" on storage.objects
  for select to authenticated
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars public read" on storage.objects;
drop policy if exists "avatars own read" on storage.objects;
create policy "avatars own read" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "group photos public read" on storage.objects;
drop policy if exists "group photos own read" on storage.objects;
create policy "group photos own read" on storage.objects
  for select to authenticated
  using (bucket_id = 'group-photos' and (storage.foldername(name))[1] = auth.uid()::text);

commit;


-- =====================================================================
-- Verify
-- =====================================================================
-- One query, because the SQL editor shows only the last statement's result.
-- Every row must read OK.
--
-- Then do the other half in the app, which SQL cannot check: open the feed and
-- a profile and confirm avatars and video still load. And re-run the listing
-- probe with the anon key — it must now come back empty:
--
--   curl -X POST "$SUPABASE_URL/storage/v1/object/list/avatars" \
--        -H "apikey: <anon key>" -H "Content-Type: application/json" \
--        -d '{"prefix":"","limit":5,"offset":0}'
select 'videos bucket not anon-listable' as check,
       case when not exists (select 1 from pg_policies
                              where schemaname = 'storage' and tablename = 'objects'
                                and policyname = 'videos public read')
             and exists (select 1 from pg_policies
                          where schemaname = 'storage' and tablename = 'objects'
                            and policyname = 'videos own read')
            then 'OK' else 'STILL OPEN' end as result
union all
select 'avatars bucket not anon-listable',
       case when not exists (select 1 from pg_policies
                              where schemaname = 'storage' and tablename = 'objects'
                                and policyname = 'avatars public read')
             and exists (select 1 from pg_policies
                          where schemaname = 'storage' and tablename = 'objects'
                            and policyname = 'avatars own read')
            then 'OK' else 'STILL OPEN' end
union all
select 'group-photos bucket not anon-listable',
       case when not exists (select 1 from pg_policies
                              where schemaname = 'storage' and tablename = 'objects'
                                and policyname = 'group photos public read')
             and exists (select 1 from pg_policies
                          where schemaname = 'storage' and tablename = 'objects'
                            and policyname = 'group photos own read')
            then 'OK' else 'STILL OPEN' end
union all
select 'chat-media still member-scoped (0067 intact)',
       case when exists (select 1 from pg_policies
                          where schemaname = 'storage' and tablename = 'objects'
                            and policyname = 'chat media members read')
            then 'OK' else 'MISSING' end
union all
select 'write policies untouched',
       case when (select count(*) from pg_policies
                   where schemaname = 'storage' and tablename = 'objects'
                     and policyname in ('videos own write', 'avatars own write',
                                        'avatars own update', 'group photos own write',
                                        'group photos own update')) = 5
            then 'OK' else 'CHECK MANUALLY' end
order by 1;
