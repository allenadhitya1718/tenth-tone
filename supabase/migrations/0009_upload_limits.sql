-- =============================================================
-- Upload limits (server-side backstop matching client-side
-- validation in web/js/compress.js: max 200 MB per video,
-- max 1.5 minutes duration enforced client-side before upload).
-- =============================================================

update storage.buckets
  set file_size_limit = 200 * 1024 * 1024  -- 200 MB
  where id = 'videos';

update storage.buckets
  set file_size_limit = 10 * 1024 * 1024   -- 10 MB, avatars are stills
  where id = 'avatars';

update storage.buckets
  set file_size_limit = 50 * 1024 * 1024   -- 50 MB, chat media (video/audio clips)
  where id = 'chat-media';

update storage.buckets
  set file_size_limit = 10 * 1024 * 1024   -- 10 MB, group photos are stills
  where id = 'group-photos';
