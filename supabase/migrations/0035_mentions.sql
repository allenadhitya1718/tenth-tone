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
  -- address (support@tenthtone.app) is read as a mention of "tenthtone".
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
