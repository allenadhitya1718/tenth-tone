-- Client change (Nov 2026): FLYP is stories and lives only, so permanent
-- photo/video posts are gone. The 2.0 app has no way to post any more, but
-- older test builds (TestFlight 11, Play build 100, earlier APKs) still have
-- the publish screen. This stops the server from accepting new posts from any
-- app, while people keep editing (caption, privacy) and deleting what they
-- already posted.
--
-- "videos write own" covered every action (ALL). It becomes UPDATE only.
-- Reading and deleting own posts already have their own policies
-- ("videos read public", "videos delete own"); admins keep theirs.
-- Live highlights are a separate table (0167) and are not affected.
-- Undo: create the ALL policy again (below, commented out).

drop policy if exists "videos write own" on public.videos;

create policy "videos update own" on public.videos
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Undo:
-- drop policy if exists "videos update own" on public.videos;
-- create policy "videos write own" on public.videos
--   for all to authenticated
--   using (auth.uid() = user_id)
--   with check (auth.uid() = user_id);
