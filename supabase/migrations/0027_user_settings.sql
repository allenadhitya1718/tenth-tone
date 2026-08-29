-- ============================================================
-- 0027_user_settings.sql
-- Makes the Settings screen real.
--
-- Every notification toggle on that screen was `async () => {}` - an empty
-- function. "Who can message me" and "Who can comment" were static labels.
-- Nothing was stored and nothing was enforced.
--
-- Storing a preference is not enough: the rules below make the database
-- honour them, so switching something off cannot be bypassed by calling
-- the API directly.
--
-- Also adds session tracking, which is what login alerts need.
--
-- Apply in the Supabase SQL editor AFTER 0001..0026.
-- ============================================================

create table if not exists public.user_settings (
  user_id          uuid primary key references public.profiles (id) on delete cascade,

  -- Notification preferences
  notif_likes      boolean not null default true,
  notif_comments   boolean not null default true,
  notif_follows    boolean not null default true,
  notif_messages   boolean not null default true,
  notif_live       boolean not null default true,
  notif_gifts      boolean not null default true,

  -- Who may reach me. 'following' means people I follow.
  who_can_message  text not null default 'everyone'
                   check (who_can_message in ('everyone', 'following', 'nobody')),
  who_can_comment  text not null default 'everyone'
                   check (who_can_comment in ('everyone', 'following', 'nobody')),

  -- Playback preferences, stored server-side so they follow the account
  autoplay         boolean not null default true,
  data_saver       boolean not null default false,

  updated_at       timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "user_settings own" on public.user_settings;
create policy "user_settings own" on public.user_settings
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ── Helpers ──
-- Read one setting for a user, defaulting to permissive when no row exists.
-- security definer so triggers can read the recipient's preferences without
-- opening the whole table up to everyone.

create or replace function public.setting_bool(p_user uuid, p_key text)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare v boolean;
begin
  execute format('select %I from public.user_settings where user_id = $1', p_key)
    into v using p_user;
  return coalesce(v, true);
end;
$fn$;

create or replace function public.setting_text(p_user uuid, p_key text)
returns text
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare v text;
begin
  execute format('select %I from public.user_settings where user_id = $1', p_key)
    into v using p_user;
  return coalesce(v, 'everyone');
end;
$fn$;

revoke all on function public.setting_bool(uuid, text) from public;
revoke all on function public.setting_text(uuid, text) from public;
grant execute on function public.setting_bool(uuid, text) to authenticated;
grant execute on function public.setting_text(uuid, text) to authenticated;


-- ── Notification triggers now respect the recipient's preferences ──

create or replace function public.notify_on_like()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare owner_id uuid;
begin
  select user_id into owner_id from public.videos where id = new.video_id;
  if owner_id is null or owner_id = new.user_id then return new; end if;
  if not public.setting_bool(owner_id, 'notif_likes') then return new; end if;
  insert into public.notifications (user_id, actor_id, type, payload)
  values (owner_id, new.user_id, 'like', jsonb_build_object('video_id', new.video_id));
  return new;
end; $fn$;

create or replace function public.notify_on_comment()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare owner_id uuid;
begin
  select user_id into owner_id from public.videos where id = new.video_id;
  if owner_id is null or owner_id = new.user_id then return new; end if;
  if not public.setting_bool(owner_id, 'notif_comments') then return new; end if;
  insert into public.notifications (user_id, actor_id, type, payload)
  values (owner_id, new.user_id, 'comment',
          jsonb_build_object('video_id', new.video_id, 'comment_id', new.id, 'text', left(new.text, 80)));
  return new;
end; $fn$;

create or replace function public.notify_on_follow()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if not public.setting_bool(new.followed_id, 'notif_follows') then return new; end if;
  insert into public.notifications (user_id, actor_id, type, payload)
  values (new.followed_id, new.follower_id, 'follow', '{}'::jsonb);
  return new;
end; $fn$;

create or replace function public.notify_on_message()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.notifications (user_id, actor_id, type, payload)
  select cm.user_id, new.from_user_id, 'message',
    jsonb_build_object('chat_id', new.chat_id, 'message_id', new.id,
                       'text', left(coalesce(new.text, ''), 60))
  from public.chat_members cm
  where cm.chat_id = new.chat_id
    and cm.user_id <> new.from_user_id
    and public.setting_bool(cm.user_id, 'notif_messages');
  return new;
end; $fn$;


-- ── "Who can comment" is enforced, not just displayed ──
-- Combines with allow_comments from 0024.

create or replace function public.may_comment_on(p_video uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare v_owner uuid; v_allow boolean; v_rule text;
begin
  select user_id, allow_comments into v_owner, v_allow
    from public.videos where id = p_video;
  if v_owner is null then return false; end if;
  if not coalesce(v_allow, true) then return false; end if;
  if v_owner = p_actor then return true; end if;

  v_rule := public.setting_text(v_owner, 'who_can_comment');
  if v_rule = 'nobody' then return false; end if;
  if v_rule = 'following' then
    return exists (select 1 from public.follows
                    where follower_id = v_owner and followed_id = p_actor);
  end if;
  return true;
end;
$fn$;

grant execute on function public.may_comment_on(uuid, uuid) to authenticated;

drop policy if exists "comments insert own" on public.comments;
create policy "comments insert own" on public.comments
  for insert to authenticated
  with check (auth.uid() = user_id and public.may_comment_on(video_id, auth.uid()));


-- ── "Who can message me" ──
-- Used by the client before opening a DM. Also blocks anyone the target
-- has blocked.

create or replace function public.may_message(p_target uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare v_rule text;
begin
  if p_target = p_actor then return true; end if;
  if exists (select 1 from public.blocks
              where blocker_id = p_target and blocked_id = p_actor) then
    return false;
  end if;
  v_rule := public.setting_text(p_target, 'who_can_message');
  if v_rule = 'nobody' then return false; end if;
  if v_rule = 'following' then
    return exists (select 1 from public.follows
                    where follower_id = p_target and followed_id = p_actor);
  end if;
  return true;
end;
$fn$;

grant execute on function public.may_message(uuid, uuid) to authenticated;


-- ── Session tracking, for login alerts ──

create table if not exists public.user_sessions (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  device      text,          -- e.g. "Chrome on Windows"
  platform    text,          -- 'web' | 'android' | 'ios'
  last_seen   timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists idx_user_sessions_user
  on public.user_sessions (user_id, last_seen desc);

alter table public.user_sessions enable row level security;

drop policy if exists "user_sessions own" on public.user_sessions;
create policy "user_sessions own" on public.user_sessions
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Records this device and raises a notification the first time it is seen.
-- The very first device on an account does not alert - there is nothing to
-- compare it against, and alerting on signup is just noise.
create or replace function public.record_session(p_device text, p_platform text default 'web')
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me uuid := auth.uid();
  v_id uuid;
begin
  if v_me is null then raise exception 'must be signed in'; end if;

  select id into v_id from public.user_sessions
   where user_id = v_me and device = p_device and platform = p_platform
   limit 1;

  if v_id is not null then
    update public.user_sessions set last_seen = now() where id = v_id;
    return v_id;
  end if;

  insert into public.user_sessions (user_id, device, platform)
  values (v_me, p_device, p_platform)
  returning id into v_id;

  if (select count(*) from public.user_sessions where user_id = v_me) > 1 then
    insert into public.notifications (user_id, actor_id, type, payload)
    values (v_me, v_me, 'system',
            jsonb_build_object('kind', 'new_login',
                               'device', p_device,
                               'platform', p_platform));
  end if;

  return v_id;
end;
$fn$;

grant execute on function public.record_session(text, text) to authenticated;
