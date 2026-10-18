-- 0119 - comments, likes and live chat are only as visible as what they are on
--
-- Security review 2026-10, finding F12 (medium). Apply after 0118. Safe to
-- re-run.
--
-- ============================================================
-- F12 - THE CONVERSATION LEAKED EVEN WHEN THE POST DID NOT
-- ============================================================
-- "videos read public" (latest 0073) hides drafts, hidden, archived, private
-- and friends-only videos, private accounts' posts from non-followers, and
-- posts across a block. But the rows hanging off a video had their own,
-- wide-open policies:
--
--   comments       "comments read public" (0012): is_hidden = false - anon too
--   likes          "likes read public"    (0001): true                - anon too
--   comment_likes  "comment likes read"   (0072): true                - anon too
--   live_comments  "live comments read"   (0016): true                - anon too
--   live_viewers   "live_viewers read"    (0048): true (signed in)
--
-- so GET /rest/v1/comments?video_id=eq.<private post> with the anon key
-- returned every comment on it, and the chat of a friends-only live was
-- readable by anybody.
--
-- Each policy now also requires the parent row to be visible to the reader.
-- The EXISTS subqueries run under the reader's own policies on the parent
-- table, so "visible" means exactly what videos / live_streams already say,
-- with no second copy of the rules to drift. A person always sees their own
-- rows. The admin read policies (0002) are separate and unchanged.
--
-- "live read" (latest 0004) gains a block check: a host who has blocked you
-- no longer shows you the stream, its chat or its viewer list. has_blocked()
-- is used (one direction, anon-callable) for the same reasons 0070/0077 give.

begin;

drop policy if exists "comments read public" on public.comments;
create policy "comments read public" on public.comments
  for select to authenticated, anon
  using (
    user_id = (select auth.uid())
    or (
      is_hidden = false
      and exists (select 1 from public.videos v where v.id = comments.video_id)
    )
  );

drop policy if exists "likes read public" on public.likes;
create policy "likes read public" on public.likes
  for select to authenticated, anon
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.videos v where v.id = likes.video_id)
  );

drop policy if exists "comment likes read" on public.comment_likes;
create policy "comment likes read" on public.comment_likes
  for select to authenticated, anon
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.comments c where c.id = comment_likes.comment_id)
  );

drop policy if exists "live read" on public.live_streams;
create policy "live read" on public.live_streams
  for select to authenticated, anon
  using (
    status <> 'banned' and (
      host_id = (select auth.uid())
      or (
        not public.has_blocked(live_streams.host_id, (select auth.uid()))
        and (
          privacy = 'public'
          or (
            privacy = 'friends'
            and exists (select 1 from public.follows
                         where follower_id = (select auth.uid())
                           and followed_id = live_streams.host_id)
          )
        )
      )
    )
  );

drop policy if exists "live comments read" on public.live_comments;
create policy "live comments read" on public.live_comments
  for select to authenticated, anon
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.live_streams ls where ls.id = live_comments.live_stream_id)
  );

drop policy if exists "live_viewers read" on public.live_viewers;
create policy "live_viewers read" on public.live_viewers
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.live_streams ls where ls.id = live_viewers.live_id)
  );

commit;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select p.tablename || ' / ' || p.policyname as check,
       case when p.qual like '%EXISTS%' or p.qual like '%has_blocked%'
            then 'OK' else 'STILL OPEN' end as result
  from pg_policies p
 where p.schemaname = 'public'
   and (p.tablename, p.policyname) in (
         ('comments', 'comments read public'),
         ('likes', 'likes read public'),
         ('comment_likes', 'comment likes read'),
         ('live_streams', 'live read'),
         ('live_comments', 'live comments read'),
         ('live_viewers', 'live_viewers read'))
order by 1;

-- Behavioural test with the anon key, V = a friends-only or private video:
--   GET /rest/v1/comments?video_id=eq.<V>   -> []
--   GET /rest/v1/likes?video_id=eq.<V>      -> []
