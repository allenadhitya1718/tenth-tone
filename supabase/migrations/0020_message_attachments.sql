-- ============================================================
-- 0020_message_attachments.sql
-- Adds two message kinds so the chat attachment menu can send more
-- than photos and videos:
--
--   file      - documents (PDF, Word, zip, ...). attachment_url points at
--               the uploaded file; `text` carries the original filename so
--               the bubble can show it.
--   location  - a shared place. `text` holds a maps link, so even a client
--               that does not understand the type still shows something
--               useful instead of an empty bubble.
--
-- Camera and Gallery need no schema change - they reuse image/video.
--
-- Apply in the Supabase SQL editor AFTER 0001..0019.
-- ============================================================

alter table public.messages drop constraint if exists messages_type_check;

alter table public.messages
  add constraint messages_type_check
  check (type in ('text', 'voice', 'image', 'video', 'sticker', 'system', 'file', 'location'));
