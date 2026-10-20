-- 0148 - GIFs from KLIPY (Tenor's API is gone)
--
-- Google shut the Tenor API down on 30 June 2026 (no new keys since
-- January), so the gif-search Edge Function now asks KLIPY instead. 0144
-- only accepted GIF URLs on media.tenor.com / media1.tenor.com; this file
-- widens both checks to KLIPY's hosts as well.
--
--   * Tenor URLs stay valid: GIFs already sent keep their rows (and an
--     UPDATE of an old row, e.g. a reaction, is not refused).
--   * KLIPY: https on klipy.com or any of its subdomains (its CDN host is
--     whatever the API answers with; the function and the app check the
--     same rule). A look-alike such as klipy.com.evil.example, or http, is
--     still refused.
--
-- Deploy order: this file, then set KLIPY_API_KEY and redeploy gif-search.
-- Needs 0144. Safe to re-run.

begin;

alter table public.messages drop constraint if exists messages_gif_url_check;
alter table public.messages
  add constraint messages_gif_url_check
  check (type <> 'gif'
         or (attachment_url is not null
             and char_length(attachment_url) <= 600
             and attachment_url ~ '^https://((media|media1)\.tenor\.com|([a-z0-9-]+\.)*klipy\.com)/[^[:space:]]+$'));

alter table public.comments drop constraint if exists comments_gif_url_check;
alter table public.comments
  add constraint comments_gif_url_check
  check (gif_url is null
         or (char_length(gif_url) <= 600
             and gif_url ~ '^https://((media|media1)\.tenor\.com|([a-z0-9-]+\.)*klipy\.com)/[^[:space:]]+$'));

commit;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'gif messages accept KLIPY' as check,
       case when pg_get_constraintdef((select oid from pg_constraint
                                        where conrelid = 'public.messages'::regclass
                                          and conname = 'messages_gif_url_check')) like '%klipy%'
            then 'OK' else 'NOT UPDATED' end as result
union all
select 'comment GIFs accept KLIPY',
       case when pg_get_constraintdef((select oid from pg_constraint
                                        where conrelid = 'public.comments'::regclass
                                          and conname = 'comments_gif_url_check')) like '%klipy%'
            then 'OK' else 'NOT UPDATED' end
union all
select 'host allow-list (Tenor + KLIPY in, look-alikes out)',
       case when 'https://static.klipy.com/ii/abc/x.gif#w=1&h=1' ~ '^https://((media|media1)\.tenor\.com|([a-z0-9-]+\.)*klipy\.com)/[^[:space:]]+$'
             and 'https://klipy.com/x.gif' ~ '^https://((media|media1)\.tenor\.com|([a-z0-9-]+\.)*klipy\.com)/[^[:space:]]+$'
             and 'https://media.tenor.com/abc/x.gif' ~ '^https://((media|media1)\.tenor\.com|([a-z0-9-]+\.)*klipy\.com)/[^[:space:]]+$'
             and not ('https://static.klipy.com.evil.example/x.gif' ~ '^https://((media|media1)\.tenor\.com|([a-z0-9-]+\.)*klipy\.com)/[^[:space:]]+$')
             and not ('https://evilklipy.com/x.gif' ~ '^https://((media|media1)\.tenor\.com|([a-z0-9-]+\.)*klipy\.com)/[^[:space:]]+$')
             and not ('http://static.klipy.com/x.gif' ~ '^https://((media|media1)\.tenor\.com|([a-z0-9-]+\.)*klipy\.com)/[^[:space:]]+$')
             and not ('https://evil.example/https://static.klipy.com/x.gif' ~ '^https://((media|media1)\.tenor\.com|([a-z0-9-]+\.)*klipy\.com)/[^[:space:]]+$')
            then 'OK' else 'WRONG' end
order by 1;
