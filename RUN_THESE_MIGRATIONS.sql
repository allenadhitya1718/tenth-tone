-- ============================================================
-- FLYP — run this whole file in the Supabase SQL editor, once.
--
-- Contains three migrations plus one combined check:
--   0067  chat attachments can be read back        (they never could)
--   0068  people can delete their own videos       (only admins could)
--   0069  "who can message me" is actually enforced (it did nothing)
--
-- Each is idempotent, so re-running is harmless.
--
-- The editor shows only the LAST statement's result, so the individual
-- verify blocks inside each migration scroll past unseen — that is expected.
-- One combined check runs at the very end and is the one you will see.
-- ============================================================



-- ####################  0067_chat_media_read_policy.sql  ####################

-- 0067 — let chat members actually read chat attachments
--
-- Found by testing with two real accounts: sending a photo in a chat has NEVER
-- worked. Not since today's changes — since 0031. Two independent faults, both
-- of which had to be fixed before a single attachment could work.
--
-- ── Fault 1 (fixed in db.js, no migration needed) ──
-- The upload path was `<chatId>/<timestamp>-<userId>.<ext>`, and 0031's write
-- policy is:
--
--     (storage.foldername(name))[1] = auth.uid()::text
--
-- The first segment was the CHAT id, so that check failed on every upload and
-- the client got "new row violates row-level security policy". The message was
-- still sent — without its attachment. The path is now
-- `<userId>/<chatId>/<timestamp>.<ext>`, which satisfies the write policy and
-- also makes chat media visible to user_uploads_today(), which reads the same
-- first segment and had therefore never counted a single chat upload.
--
-- ── Fault 2 (this file) ──
-- `chat-media` is a PRIVATE bucket (0001 creates it with public = false) and
-- has only ever had a write policy. There is no SELECT policy anywhere in
-- 0001..0066. createSignedUrl() needs to read the object to sign it, so it
-- returned null and the client threw "Cannot read properties of null" — which
-- reads like a front-end bug and is actually a missing policy.
--
-- ── Who should be able to read ──
-- Members of that conversation, and nobody else. The path now carries the chat
-- id as its second segment, so membership is a direct lookup. This is
-- deliberately NOT "anyone signed in": chat attachments are private messages,
-- and a signed URL that any account could mint would make the whole bucket
-- readable by anyone who could guess a path.

-- The regex guard matters. (storage.foldername(name))[2] is text, and casting
-- a non-uuid to uuid raises rather than returning false — inside a policy that
-- turns one malformed object name into an error for every query touching the
-- bucket. Objects uploaded under the OLD two-segment layout have no second
-- segment at all, so this is not hypothetical.
drop policy if exists "chat media members read" on storage.objects;
create policy "chat media members read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
    and exists (
      select 1
        from public.chat_members cm
       where cm.chat_id = ((storage.foldername(name))[2])::uuid
         and cm.user_id = auth.uid()
    )
  );

-- The uploader can always read their own, whatever the layout. Without this,
-- anything written under the old two-segment path is unreadable even by the
-- person who sent it — and the sender needs to read it back immediately, since
-- createSignedUrl() runs microseconds after the upload.
drop policy if exists "chat media own read" on storage.objects;
create policy "chat media own read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Deleting your own attachment. Absent before, so a chat attachment could
-- never be removed from storage even when its message was deleted.
drop policy if exists "chat media own delete" on storage.objects;
create policy "chat media own delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ── Verify ──
-- One query, because the Supabase SQL editor shows only the last statement's
-- result. Expect four rows, all OK.
select 'chat media members read (select)' as check,
       case when exists (select 1 from pg_policies
                          where tablename = 'objects' and schemaname = 'storage'
                            and policyname = 'chat media members read')
            then 'OK' else 'MISSING' end as result
union all
select 'chat media own read (select)',
       case when exists (select 1 from pg_policies
                          where tablename = 'objects' and schemaname = 'storage'
                            and policyname = 'chat media own read')
            then 'OK' else 'MISSING' end
union all
select 'chat media own delete',
       case when exists (select 1 from pg_policies
                          where tablename = 'objects' and schemaname = 'storage'
                            and policyname = 'chat media own delete')
            then 'OK' else 'MISSING' end
union all
select 'chat media own write still present (0031)',
       case when exists (select 1 from pg_policies
                          where tablename = 'objects' and schemaname = 'storage'
                            and policyname = 'chat media own write')
            then 'OK' else 'MISSING' end
order by 1;

-- After running, send a photo in a chat from two different accounts and
-- confirm BOTH sides can open it. The sender reading their own back proves
-- the own-read policy; the recipient proves the membership one.


-- ####################  0068_delete_own_video.sql  ####################

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


-- ####################  0069_enforce_who_can_message.sql  ####################

-- 0069 — make "who can message me" actually stop messages
--
-- Found by testing with two accounts: account A set who_can_message to
-- 'nobody', and account B sent it a message anyway. The setting saved, the
-- screen showed it, and nothing enforced it.
--
-- ── Why it did nothing ──
-- There are two functions and they are not the same one.
--
--   may_message(target, actor)         — 0027, replaced in 0028. Implements
--                                        the rule correctly. Called ONLY from
--                                        the client, by API.canMessage, which
--                                        gates opening a NEW conversation.
--
--   may_message_in_chat(chat, actor)   — 0049. This is what the `messages`
--                                        insert policy actually calls, and it
--                                        checks blocking and nothing else.
--
-- So the rule applied to starting a chat, in the client, where anyone talking
-- to the API directly skips it — and never applied at all to a conversation
-- that already existed. Since a DM row survives forever once created, "nobody"
-- meant "nobody new, in the app, if they are being polite".
--
-- who_can_comment does not have this problem: 0027 wired may_comment_on()
-- straight into the comments insert policy, which is exactly the right shape.
-- Messages simply never got the same treatment.
--
-- ── The fix ──
-- One function. The policy already calls it, so nothing else changes.
--
-- Note the block check stays as is_blocked_between(). may_message() looks at
-- blocks in ONE direction only (has the target blocked the actor), while
-- is_blocked_between() covers both — so replacing the check outright would
-- have quietly let a person message someone THEY had blocked. The two are kept
-- side by side deliberately; the small overlap costs nothing.

create or replace function public.may_message_in_chat(p_chat uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare v_type text; v_other uuid;
begin
  select type into v_type from public.chats where id = p_chat;
  if v_type is null then return false; end if;

  -- Groups are unaffected. A per-person "who can message me" rule has no
  -- meaning in a room several people joined; leaving a group is the control
  -- that applies there.
  if v_type <> 'dm' then return true; end if;

  select user_id into v_other
    from public.chat_members
   where chat_id = p_chat and user_id <> p_actor
   limit 1;

  if v_other is null then return true; end if;          -- a chat with only you

  -- Both directions, unchanged from 0049.
  if public.is_blocked_between(v_other, p_actor) then return false; end if;

  -- NEW: the recipient's own choice, and their restrict list. This is the
  -- whole point of the migration — the same function the client was already
  -- consulting, now consulted where it cannot be skipped.
  return public.may_message(v_other, p_actor);
end;
$fn$;

revoke all on function public.may_message_in_chat(uuid, uuid) from public;
grant execute on function public.may_message_in_chat(uuid, uuid) to authenticated;


-- ── Verify ──
-- One query, because the SQL editor only shows the last statement's result.
-- Replace the two ids with a real pair who share a DM, then set the TARGET's
-- who_can_message to 'nobody' and re-run: allowed should flip to false.
--
--   select public.may_message_in_chat('<chat-id>'::uuid, '<sender-id>'::uuid) as allowed;
--
-- The behavioural test that matters, with two accounts:
--   1. Account A: Settings > who can message me > nobody
--   2. Account B, in an EXISTING conversation with A, sends a message
--   3. It must be refused. Before this migration it went through.
select 'may_message_in_chat now consults may_message' as check,
       case when pg_get_functiondef('public.may_message_in_chat(uuid,uuid)'::regprocedure)
                 like '%may_message(v_other%'
            then 'OK' else 'NOT UPDATED' end as result
union all
select 'both-direction block check retained',
       case when pg_get_functiondef('public.may_message_in_chat(uuid,uuid)'::regprocedure)
                 like '%is_blocked_between%'
            then 'OK' else 'LOST — do not ship' end
union all
select 'comments already enforced (0027, for contrast)',
       case when exists (
         select 1 from pg_policies
          where schemaname = 'public' and tablename = 'comments'
            and policyname = 'comments insert own'
       ) then 'OK' else 'MISSING' end
order by 1;



-- ============================================================
-- COMBINED CHECK — this is the result you will see.
-- Every row should read OK.
--
-- The last two rows are the diagnostic for the open blocking question:
-- a blocked person could still read the blocker's profile row. 0054's policy
-- is correct, so the suspicion is a SECOND permissive policy on profiles —
-- Postgres OR-s them together, so the loosest one wins.
-- ============================================================
select '0067 chat media members read' as check,
       case when exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
                          and policyname='chat media members read') then 'OK' else 'MISSING' end as result
union all
select '0067 chat media own read',
       case when exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
                          and policyname='chat media own read') then 'OK' else 'MISSING' end
union all
select '0067 chat media own delete',
       case when exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
                          and policyname='chat media own delete') then 'OK' else 'MISSING' end
union all
select '0067 chat media own write kept (0031)',
       case when exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
                          and policyname='chat media own write') then 'OK' else 'MISSING' end
union all
select '0068 videos delete own',
       case when exists (select 1 from pg_policies where schemaname='public' and tablename='videos'
                          and policyname='videos delete own') then 'OK' else 'MISSING' end
union all
select '0068 admins delete any video kept (0002)',
       case when exists (select 1 from pg_policies where schemaname='public' and tablename='videos'
                          and policyname='admins delete any video') then 'OK' else 'MISSING' end
union all
select '0069 may_message_in_chat consults may_message',
       case when pg_get_functiondef('public.may_message_in_chat(uuid,uuid)'::regprocedure)
                 like '%may_message(v_other%' then 'OK' else 'NOT UPDATED' end
union all
select '0069 both-direction block check retained',
       case when pg_get_functiondef('public.may_message_in_chat(uuid,uuid)'::regprocedure)
                 like '%is_blocked_between%' then 'OK' else 'LOST - do not ship' end
union all
select 'DIAGNOSTIC: select policies on profiles',
       (select count(*)::text || ' policy(ies) - expect exactly 1'
          from pg_policy where polrelid='public.profiles'::regclass and polcmd in ('r','*'))
union all
select 'DIAGNOSTIC: their names',
       (select string_agg(polname, ' | ' order by polname)
          from pg_policy where polrelid='public.profiles'::regclass and polcmd in ('r','*'))
order by 1;
