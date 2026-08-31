-- 0068 — let people delete their own videos
--
-- Found by testing: there is no way for a user to delete a post. Not a broken
-- button — no button and no function. The only delete that exists is
-- `admins delete any video` from 0002, so a person who posted something they
-- regret has to ask an operator to remove it.
--
-- Messages were already fine: 0018 added "messages delete own", and only the
-- client function and the UI were missing (both added alongside this). Videos
-- had neither the policy nor the rest.
--
-- Deliberately narrow: your own row, and nothing else. Comments on the video,
-- likes and saves disappear with it through the existing on-delete cascades —
-- checked in 0001 before writing this, rather than assumed.

drop policy if exists "videos delete own" on public.videos;
create policy "videos delete own" on public.videos
  for delete to authenticated
  using (user_id = auth.uid());


-- ── A note on the bytes, which this does NOT handle ──
-- Deleting the row does not delete the file from Cloudflare R2. The object
-- keeps its media_objects row with status 'stored', so the hourly reconcile
-- job leaves it alone — that job only removes objects with NO ledger row, and
-- it is deliberately conservative because deleting on an incomplete search
-- destroys live content.
--
-- The result is an orphaned object that still counts against the storage
-- ceiling. That is the leak already recorded as step 10 of R2_ROLLOUT.md, and
-- it applies equally to admin deletions today. Fixing it properly means
-- marking the ledger row for collection and letting the sweeper act on that,
-- which is a change to the sweeper rather than to this policy.
--
-- Storing a few orphaned megabytes is the right trade against a delete path
-- that could remove the wrong file.


-- ── Verify ──
-- One query: the Supabase SQL editor only shows the last statement's result.
select 'videos delete own policy' as check,
       case when exists (
         select 1 from pg_policies
          where schemaname = 'public' and tablename = 'videos'
            and policyname = 'videos delete own'
       ) then 'OK' else 'MISSING' end as result
union all
select 'admins delete any video still present (0002)',
       case when exists (
         select 1 from pg_policies
          where schemaname = 'public' and tablename = 'videos'
            and policyname = 'admins delete any video'
       ) then 'OK' else 'MISSING' end
union all
select 'messages delete own still present (0018)',
       case when exists (
         select 1 from pg_policies
          where schemaname = 'public' and tablename = 'messages'
            and policyname = 'messages delete own'
       ) then 'OK' else 'MISSING' end
order by 1;

-- After running: post a clip from one account, delete it from that account,
-- and confirm a SECOND account cannot delete it. The second half is the half
-- worth checking — a delete policy that is too permissive lets anyone remove
-- anyone's work, and nothing on screen would reveal it.
