-- =============================================================
-- FLYP - run this whole file once in the Supabase SQL Editor
--
-- Combines the two migrations that are not yet applied:
--   0035_mentions.sql        @handle search, mention notifications
--   0038_live_streaming.sql  the write policies live streaming needs
--
-- 0036_signup_age.sql is ALREADY APPLIED and is deliberately not here.
--
-- Safe to run more than once: every policy and trigger is dropped first,
-- functions use create or replace, indexes use if not exists.
-- =============================================================


-- ############################################################
-- ##  0035_mentions.sql
-- ############################################################

-- ============================================================
-- 0035_mentions.sql
--
-- You could type @someone, but it stayed plain text: no link, no
-- notification, nobody told. The 'mention' notification type has existed
-- since 0001 and nothing ever created one.
--
-- Mentions are resolved in the database rather than the app, so a mention
-- counts whether it was typed in the app, pasted in, or written by anything
-- else that inserts a row - and so who_can_tag cannot be bypassed by
-- calling the API directly.
--
-- Apply in the Supabase SQL editor AFTER 0001..0034.
-- ============================================================

-- ── Pull @handles out of a piece of text ──
-- Handles are letters, digits, underscore and dot, matching what signup
-- allows. Arabic text sits happily around them because the pattern only ever
-- matches ASCII handle characters after an @.
create or replace function public.extract_handles(p_text text)
returns text[]
language sql
immutable
as $fn$
  -- The @ must not follow a word character, or the domain half of an email
  -- address (support@flyp-sa.com) is read as a mention of "flyp".
  -- Trailing dots are sentence punctuation, not part of the handle.
  select coalesce(
    array_agg(distinct rtrim(lower(m[2]), '.')),
    array[]::text[]
  )
  from regexp_matches(
    coalesce(p_text, ''),
    '(^|[^A-Za-z0-9_.])@([A-Za-z0-9_][A-Za-z0-9_.]{1,29})',
    'g'
  ) as m;
$fn$;


-- ── May this person tag me? ──
create or replace function public.may_tag(p_target uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare v_rule text;
begin
  if p_target = p_actor then return false; end if;   -- no self-notification

  if exists (select 1 from public.blocks
              where (blocker_id = p_target and blocked_id = p_actor)
                 or (blocker_id = p_actor and blocked_id = p_target)) then
    return false;
  end if;

  if exists (select 1 from public.restricted_users
              where user_id = p_target and restricted_id = p_actor) then
    return false;
  end if;

  v_rule := public.setting_text(p_target, 'who_can_tag');

  if v_rule = 'nobody' then return false; end if;
  if v_rule = 'following' then
    return exists (select 1 from public.follows
                    where follower_id = p_target and followed_id = p_actor);
  end if;
  return true;
end;
$fn$;

grant execute on function public.may_tag(uuid, uuid) to authenticated;


-- ── Notify the people named in a caption ──
create or replace function public.notify_video_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_handles text[];
  v_old     text[] := array[]::text[];
  r         record;
begin
  v_handles := public.extract_handles(new.description);
  if array_length(v_handles, 1) is null then return new; end if;

  -- On an edit, only newly added handles are notified. Fixing a typo should
  -- not ping everyone a second time.
  if tg_op = 'UPDATE' then
    v_old := public.extract_handles(old.description);
  end if;

  for r in
    select p.id
    from public.profiles p
    where lower(p.handle) = any (v_handles)
      and not (lower(p.handle) = any (v_old))
  loop
    if public.may_tag(r.id, new.user_id) then
      insert into public.notifications (user_id, actor_id, type, payload)
      values (r.id, new.user_id, 'mention',
              jsonb_build_object('video_id', new.id,
                                 'text', left(coalesce(new.description, ''), 80)));
    end if;
  end loop;

  return new;
end;
$fn$;

drop trigger if exists trg_notify_video_mentions on public.videos;
create trigger trg_notify_video_mentions
  after insert or update of description on public.videos
  for each row execute function public.notify_video_mentions();


-- ── Notify the people named in a comment ──
create or replace function public.notify_comment_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_handles text[];
  v_owner   uuid;
  r         record;
begin
  v_handles := public.extract_handles(new.text);
  if array_length(v_handles, 1) is null then return new; end if;

  -- The video owner already gets a 'comment' notification; a mention on top
  -- of it would be the same event twice.
  select user_id into v_owner from public.videos where id = new.video_id;

  for r in
    select p.id
    from public.profiles p
    where lower(p.handle) = any (v_handles)
      and p.id is distinct from v_owner
  loop
    if public.may_tag(r.id, new.user_id) then
      insert into public.notifications (user_id, actor_id, type, payload)
      values (r.id, new.user_id, 'mention',
              jsonb_build_object('video_id', new.video_id,
                                 'comment_id', new.id,
                                 'text', left(coalesce(new.text, ''), 80)));
    end if;
  end loop;

  return new;
end;
$fn$;

drop trigger if exists trg_notify_comment_mentions on public.comments;
create trigger trg_notify_comment_mentions
  after insert on public.comments
  for each row execute function public.notify_comment_mentions();


-- ── Looking up handles as you type ──
-- Prefix search on a lowered handle, which the index below serves.
create index if not exists idx_profiles_handle_lower
  on public.profiles (lower(handle));

create or replace function public.search_handles(p_prefix text, p_limit integer default 8)
returns table (id uuid, handle text, name text, avatar_url text, verified boolean)
language sql
security definer
stable
set search_path = public
as $fn$
  select p.id, p.handle, p.name, p.avatar_url, p.verified
  from public.profiles p
  where p.handle is not null
    and lower(p.handle) like lower(p_prefix) || '%'
    and p.deactivated_at is null
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = p.id and b.blocked_id = auth.uid())
         or (b.blocker_id = auth.uid() and b.blocked_id = p.id)
    )
  order by p.followers_count desc nulls last
  limit greatest(1, least(p_limit, 20));
$fn$;

grant execute on function public.search_handles(text, integer) to authenticated;


-- ############################################################
-- ##  0038_live_streaming.sql
-- ############################################################

-- =============================================================
-- 0038  Live streaming: the write policies that were never added
--
-- live_streams had RLS enabled in 0001 with only a read policy, and an
-- admin-update policy in 0002. There was no insert policy and no policy
-- letting a host touch their own row, so:
--   * nobody could start a stream at all
--   * a host could not end their own stream
-- Both failed with "new row violates row-level security policy".
--
-- Safe to run more than once.
-- =============================================================

-- ── A host may open a stream as themselves ────────────────────
-- A banned or deactivated account cannot, which matches the rule the
-- upload path already applies to videos.
drop policy if exists "live insert own" on public.live_streams;
create policy "live insert own" on public.live_streams
  for insert to authenticated
  with check (
    auth.uid() = host_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        -- Same not-banned test the feed and upload paths use.
        and (p.banned_until is null or p.banned_until <= now())
        and p.deactivated_at is null
    )
  );

-- ── A host may update their own stream ────────────────────────
-- Ending it, retitling it, and writing the viewer count that Agora
-- reports on the host client.
drop policy if exists "live update own" on public.live_streams;
create policy "live update own" on public.live_streams
  for update to authenticated
  using (auth.uid() = host_id)
  with check (auth.uid() = host_id);

-- ── A host may delete their own stream ────────────────────────
-- Ending sets status to 'ended' and keeps the row. This is for a host
-- who wants the record gone entirely.
drop policy if exists "live delete own" on public.live_streams;
create policy "live delete own" on public.live_streams
  for delete to authenticated
  using (auth.uid() = host_id);

-- ── A host may clear chat on their own stream ─────────────────
-- 0016 gave live_comments read and insert policies but no delete, so a
-- host had no way to remove an abusive comment from their own stream.
drop policy if exists "live comments delete own or host" on public.live_comments;
create policy "live comments delete own or host" on public.live_comments
  for delete to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.live_streams ls
      where ls.id = live_stream_id and ls.host_id = auth.uid()
    )
    or public.is_admin()
  );

-- ── Close streams left open by a crash or a closed tab ────────
-- Without this a stream whose host disappeared stays 'live' forever and
-- keeps showing in the browse list with nothing behind it.
create or replace function public.close_stale_live_streams(p_minutes integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.live_streams
     set status = 'ended',
         ended_at = now()
   where status = 'live'
     and started_at < now() - make_interval(mins => greatest(p_minutes, 1));
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.close_stale_live_streams(integer) from public;
grant execute on function public.close_stale_live_streams(integer) to authenticated;

-- Index the browse query: live streams, most watched first.
create index if not exists idx_live_streams_live
  on public.live_streams (status, viewer_count desc)
  where status = 'live';


