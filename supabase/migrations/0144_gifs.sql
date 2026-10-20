-- 0144 - GIFs (Tenor) in chat and in comments
--
-- Owner request: a GIF tab inside the emoji panel, like WhatsApp/Instagram,
-- in the chat composer and the comments sheet. The app searches through the
-- gif-search Edge Function (Tenor API v2, key server-side, contentfilter
-- high) and stores only the Tenor CDN URL of the chosen GIF.
--
-- Apply after 0143. Safe to re-run. Nothing is back-filled or deleted.
-- Deploy the gif-search function (and set TENOR_API_KEY) and redeploy
-- send-push (it gains a 'gif' push label) alongside.
--
-- ============================================================
-- WHAT CHANGES
-- ============================================================
-- 1. messages.type gains 'gif'. A GIF message keeps the Tenor URL in
--    attachment_url (with the pixel size in the fragment, '#w=220&h=180', so
--    the bubble has the right shape before the image loads) and the GIF's
--    description in text (the accessibility label; an older app that does
--    not know 'gif' shows that description as a text bubble). The URL must
--    be on a Tenor CDN host: nobody can make a 'gif' bubble load an
--    arbitrary address.
-- 2. comments.gif_url (nullable text), same host allow-list. A GIF comment
--    may have empty text (comments.text stays NOT NULL; the app writes '').
-- 3. Server screening (0140): a comment with no text has nothing to screen
--    (moderate-content would answer 'skipped' anyway), so a GIF-only comment
--    is not held as pending_review; it is visible at once. A GIF comment WITH
--    text is held and screened exactly as before. The GIF itself is not
--    screened: it comes from Tenor's 'high' (strictest) content filter, and
--    the URL is limited to Tenor's CDN.
-- 4. The word filter (0135) is unchanged: abuse_match('') is null, so an
--    empty text passes; text sent with a GIF is filtered as usual.
-- 5. Notification snippets say '[GIF]' when a GIF comment has no text
--    (comment, reply, comment-like), and message notifications for a GIF
--    carry kind 'gif' and text '[GIF]' (send-push shows its own translated
--    label for kind 'gif'; an older send-push shows the '[GIF]' text).
--
-- RLS is unchanged.

begin;

-- ── 1. messages ─────────────────────────────────────────────────────────
-- Restated in full (a check constraint cannot be added to); the list is
-- 0045's plus 'gif'.
alter table public.messages drop constraint if exists messages_type_check;
alter table public.messages
  add constraint messages_type_check
  check (type in ('text', 'voice', 'image', 'video', 'sticker', 'system',
                  'file', 'location', 'call', 'gif'));

alter table public.messages drop constraint if exists messages_gif_url_check;
alter table public.messages
  add constraint messages_gif_url_check
  check (type <> 'gif'
         or (attachment_url is not null
             and char_length(attachment_url) <= 600
             and attachment_url ~ '^https://(media|media1)\.tenor\.com/[^[:space:]]+$'));

-- ── 2. comments.gif_url ─────────────────────────────────────────────────
alter table public.comments add column if not exists gif_url text;

alter table public.comments drop constraint if exists comments_gif_url_check;
alter table public.comments
  add constraint comments_gif_url_check
  check (gif_url is null
         or (char_length(gif_url) <= 600
             and gif_url ~ '^https://(media|media1)\.tenor\.com/[^[:space:]]+$'));

-- ── 3. screening: nothing to screen in a GIF-only comment ──────────────
-- 0140's function plus the empty-text early return.
create or replace function public.tr_screen_comment_before()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if current_user not in ('authenticated', 'anon') or public.is_admin() then return new; end if;
  if not public.screening_enabled() then return new; end if;
  -- 0144: a GIF-only comment has no text to screen; holding it would only
  -- wait for moderate-content to answer 'skipped' (or for the sweeper).
  if btrim(coalesce(new.text, '')) = '' and new.gif_url is not null then return new; end if;
  new.is_hidden := true; new.hidden_at := now(); new.hidden_reason := 'pending_review';
  return new;
end;
$fn$;
revoke all on function public.tr_screen_comment_before() from public, anon, authenticated;

-- ── 4. what a comment says in a notification ───────────────────────────
create or replace function public.comment_snippet(p_text text, p_gif_url text, p_len integer)
returns text
language sql
immutable
set search_path = public
as $fn$
  select case
           when btrim(coalesce(p_text, '')) <> '' then left(p_text, p_len)
           when p_gif_url is not null then '[GIF]'
           else ''
         end
$fn$;
revoke all on function public.comment_snippet(text, text, integer) from public, anon;
grant execute on function public.comment_snippet(text, text, integer) to authenticated, service_role;

-- 0140's emit_comment_notifications, with the snippet and a 'gif' flag.
create or replace function public.emit_comment_notifications(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c             public.comments%rowtype;
  owner_id      uuid;
  parent_author uuid;
  v_text        text;
begin
  select * into c from public.comments where id = p_id;
  if not found then return; end if;
  -- 0144: a GIF-only comment reads '[GIF]'.
  v_text := public.comment_snippet(c.text, c.gif_url, 80);
  select user_id into owner_id from public.videos where id = c.video_id;
  if c.parent_id is not null then
    select user_id into parent_author from public.comments where id = c.parent_id;
  end if;
  if parent_author is not null and parent_author <> c.user_id then
    insert into public.notifications (user_id, actor_id, type, payload)
    values (parent_author, c.user_id, 'comment',
            jsonb_build_object('video_id', c.video_id, 'comment_id', c.id,
                               'parent_id', c.parent_id, 'text', v_text,
                               'gif', c.gif_url is not null));
  end if;
  if owner_id is not null and owner_id <> c.user_id and owner_id is distinct from parent_author then
    insert into public.notifications (user_id, actor_id, type, payload)
    values (owner_id, c.user_id, 'comment',
            jsonb_build_object('video_id', c.video_id, 'comment_id', c.id, 'text', v_text,
                               'gif', c.gif_url is not null));
  end if;
end;
$fn$;
revoke all on function public.emit_comment_notifications(uuid) from public, anon, authenticated;

-- 0121's notify_on_comment_like, with the snippet.
create or replace function public.notify_on_comment_like()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_author uuid; v_video uuid; v_text text; v_gif text;
begin
  select user_id, video_id, text, gif_url into v_author, v_video, v_text, v_gif
    from public.comments where id = new.comment_id;

  if v_author is null or v_author = new.user_id then
    return null;
  end if;

  -- 0121: one notification per liker per comment per day.
  if exists (select 1 from public.notifications n
              where n.user_id = v_author
                and n.actor_id = new.user_id
                and n.type = 'like'
                and n.payload->>'kind' = 'comment_like'
                and n.payload->>'comment_id' = new.comment_id::text
                and n.created_at > now() - interval '24 hours') then
    return null;
  end if;

  insert into public.notifications (user_id, actor_id, type, payload)
  values (v_author, new.user_id, 'like',
          jsonb_build_object('kind', 'comment_like',
                             'comment_id', new.comment_id,
                             'video_id', v_video,
                             -- 0144: '[GIF]' for a GIF-only comment.
                             'excerpt', public.comment_snippet(v_text, v_gif, 60)));
  return null;
end; $$;

-- 0116's notify_on_message, with '[GIF]' as the text of a GIF message.
create or replace function public.notify_on_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Written by record_call_in_chat (0045), not by a person. The call has its
  -- own incoming-call notification below and its own row in the chat.
  if new.type = 'call' then
    return new;
  end if;

  insert into public.notifications (user_id, actor_id, type, payload)
  select cm.user_id, new.from_user_id, 'message',
    jsonb_build_object(
      'chat_id', new.chat_id,
      'message_id', new.id,
      'kind', coalesce(new.type, 'text'),
      -- Only a text message has a body worth previewing. A voice note's text
      -- column is empty and an image's is a caption at best; send-push names
      -- the kind instead of showing a blank line. 0144: a GIF's text is its
      -- Tenor description, not something the sender wrote, so it reads
      -- '[GIF]' (shown as is by a send-push without the 'gif' label).
      'text', case when coalesce(new.type, 'text') = 'text'
                   then left(coalesce(new.text, ''), 60)
                   when new.type = 'gif' then '[GIF]'
                   else '' end)
  from public.chat_members cm
  where cm.chat_id = new.chat_id
    and cm.user_id <> new.from_user_id
    -- 0116: a block in either direction means no notification and no push.
    and not exists (select 1 from public.blocks b
                     where (b.blocker_id = cm.user_id and b.blocked_id = new.from_user_id)
                        or (b.blocker_id = new.from_user_id and b.blocked_id = cm.user_id));
  return new;
end; $$;

commit;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'messages accept type gif' as check,
       case when pg_get_constraintdef((select oid from pg_constraint
                                        where conrelid = 'public.messages'::regclass
                                          and conname = 'messages_type_check')) like '%gif%'
            then 'OK' else 'NOT UPDATED' end as result
union all
select 'gif messages limited to the Tenor CDN',
       case when exists (select 1 from pg_constraint
                          where conrelid = 'public.messages'::regclass and conname = 'messages_gif_url_check')
            then 'OK' else 'MISSING' end
union all
select 'comments.gif_url exists',
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'comments' and column_name = 'gif_url')
            then 'OK' else 'MISSING' end
union all
select 'comments.gif_url limited to the Tenor CDN',
       case when exists (select 1 from pg_constraint
                          where conrelid = 'public.comments'::regclass and conname = 'comments_gif_url_check')
            then 'OK' else 'MISSING' end
union all
select 'host allow-list (accepts media/media1.tenor.com, refuses others)',
       case when 'https://media.tenor.com/abc/x.gif#w=1&h=1' ~ '^https://(media|media1)\.tenor\.com/[^[:space:]]+$'
             and 'https://media1.tenor.com/abc/x.gif' ~ '^https://(media|media1)\.tenor\.com/[^[:space:]]+$'
             and not ('https://media.tenor.com.evil.example/x.gif' ~ '^https://(media|media1)\.tenor\.com/[^[:space:]]+$')
             and not ('http://media.tenor.com/x.gif' ~ '^https://(media|media1)\.tenor\.com/[^[:space:]]+$')
             and not ('https://evil.example/https://media.tenor.com/x.gif' ~ '^https://(media|media1)\.tenor\.com/[^[:space:]]+$')
            then 'OK' else 'WRONG' end
union all
select 'GIF-only comments are not held for screening',
       case when pg_get_functiondef('public.tr_screen_comment_before()'::regprocedure) like '%0144%'
            then 'OK' else 'NOT UPDATED' end
union all
select 'word filter passes empty text',
       case when public.abuse_match('') is null and public.abuse_match(null) is null
            then 'OK' else 'WRONG' end
union all
select 'comment snippets say [GIF]',
       case when public.comment_snippet('', 'https://media.tenor.com/a.gif', 80) = '[GIF]'
             and public.comment_snippet('hi', 'https://media.tenor.com/a.gif', 80) = 'hi'
             and public.comment_snippet('', null, 80) = ''
             and pg_get_functiondef('public.emit_comment_notifications(uuid)'::regprocedure) like '%comment_snippet%'
             and pg_get_functiondef('public.notify_on_comment_like()'::regprocedure) like '%comment_snippet%'
            then 'OK' else 'NOT UPDATED' end
union all
select 'message notifications say [GIF] (and still skip blocks)',
       case when pg_get_functiondef('public.notify_on_message()'::regprocedure) like '%[GIF]%'
             and pg_get_functiondef('public.notify_on_message()'::regprocedure) like '%0116%'
            then 'OK' else 'NOT UPDATED' end
order by 1;
