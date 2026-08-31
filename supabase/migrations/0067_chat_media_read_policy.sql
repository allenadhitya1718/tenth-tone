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
