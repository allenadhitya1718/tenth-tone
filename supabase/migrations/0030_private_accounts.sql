-- ============================================================
-- 0030_private_accounts.sql
--
-- Three settings that stored a value but changed nothing:
--
--   profiles.is_private  - was a flag with no rule behind it. Now following a
--                          private account creates a REQUEST, and their posts
--                          are hidden until the request is approved.
--   notif_gifts          - nothing ever created a gift notification
--   notif_live           - nothing ever created a live notification
--
-- Apply in the Supabase SQL editor AFTER 0001..0029.
-- ============================================================

-- ── Follow requests ──
create table if not exists public.follow_requests (
  requester_id uuid not null references public.profiles (id) on delete cascade,
  target_id    uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (requester_id, target_id),
  constraint follow_request_not_self check (requester_id <> target_id)
);

create index if not exists idx_follow_requests_target
  on public.follow_requests (target_id, created_at desc);

alter table public.follow_requests enable row level security;

-- Both sides can see the request: the target to answer it, the requester so
-- the button can read "Requested" instead of "Follow".
drop policy if exists "follow_requests visible to both" on public.follow_requests;
create policy "follow_requests visible to both" on public.follow_requests
  for select to authenticated
  using (requester_id = auth.uid() or target_id = auth.uid());

drop policy if exists "follow_requests create own" on public.follow_requests;
create policy "follow_requests create own" on public.follow_requests
  for insert to authenticated
  with check (requester_id = auth.uid());

-- The requester may withdraw; the target may decline. Both are deletes.
drop policy if exists "follow_requests delete either side" on public.follow_requests;
create policy "follow_requests delete either side" on public.follow_requests
  for delete to authenticated
  using (requester_id = auth.uid() or target_id = auth.uid());


-- ── Following a private account asks instead of follows ──
create or replace function public.follow_or_request(p_target uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me      uuid := auth.uid();
  v_private boolean;
begin
  if v_me is null then raise exception 'not signed in'; end if;
  if v_me = p_target then raise exception 'cannot follow yourself'; end if;

  -- A block in either direction stops this outright.
  if exists (select 1 from public.blocks
              where (blocker_id = p_target and blocked_id = v_me)
                 or (blocker_id = v_me and blocked_id = p_target)) then
    raise exception 'blocked';
  end if;

  if exists (select 1 from public.follows
              where follower_id = v_me and followed_id = p_target) then
    return 'following';
  end if;

  select coalesce(is_private, false) into v_private
  from public.profiles where id = p_target;

  if not coalesce(v_private, false) then
    insert into public.follows (follower_id, followed_id)
    values (v_me, p_target)
    on conflict do nothing;
    return 'following';
  end if;

  insert into public.follow_requests (requester_id, target_id)
  values (v_me, p_target)
  on conflict do nothing;

  -- The request itself is worth a notification, otherwise it sits unseen.
  if public.setting_bool(p_target, 'notif_follows') then
    insert into public.notifications (user_id, actor_id, type, payload)
    values (p_target, v_me, 'follow_request', '{}'::jsonb)
    on conflict do nothing;
  end if;

  return 'requested';
end;
$fn$;

grant execute on function public.follow_or_request(uuid) to authenticated;


create or replace function public.approve_follow_request(p_requester uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not signed in'; end if;

  delete from public.follow_requests
   where requester_id = p_requester and target_id = v_me;

  if not found then raise exception 'no such request'; end if;

  insert into public.follows (follower_id, followed_id)
  values (p_requester, v_me)
  on conflict do nothing;
end;
$fn$;

grant execute on function public.approve_follow_request(uuid) to authenticated;


-- ── A private account's posts are visible only to approved followers ──
-- Kept as a helper so both the policy and the feed use the same rule.
create or replace function public.can_see_posts_of(p_owner uuid, p_viewer uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $fn$
  select
    p_owner = p_viewer
    or not coalesce((select is_private from public.profiles where id = p_owner), false)
    or exists (select 1 from public.follows
                where follower_id = p_viewer and followed_id = p_owner);
$fn$;

grant execute on function public.can_see_posts_of(uuid, uuid) to authenticated, anon;

drop policy if exists "videos read public" on public.videos;
create policy "videos read public" on public.videos
  for select to authenticated, anon
  using (
    user_id = auth.uid()
    or (
      privacy = 'public'
      and coalesce(is_hidden, false) = false
      and coalesce(is_archived, false) = false
      and public.can_see_posts_of(user_id, auth.uid())
    )
  );


-- ── The feed honours private accounts too ──
create or replace function public.fetch_fyp_feed(
  p_limit            integer default 20,
  p_offset           integer default 0,
  p_user_id          uuid    default null,
  p_max_per_creator  integer default 3
)
returns table (
  id uuid, user_id uuid, description text, music text, sound_id uuid,
  video_url text, thumbnail text, privacy text,
  likes_count integer, comments_count integer, shares_count integer,
  views_count integer, created_at timestamptz,
  user_name text, user_handle text, user_avatar_url text, user_verified boolean
)
language sql
security definer
set search_path = public
stable
as $fn$
  with prefs as (
    select v2.user_id as pref_creator, v2.sound_id as pref_sound
    from public.video_engagement e
    join public.videos v2 on v2.id = e.video_id
    where p_user_id is not null
      and e.user_id = p_user_id
      and (e.watch_count >= 2 or e.total_watch_ms >= 8000 or e.max_completion_pct >= 0.8)
  ),
  liked_prefs as (
    select v2.user_id as pref_creator, v2.sound_id as pref_sound
    from public.likes l
    join public.videos v2 on v2.id = l.video_id
    where p_user_id is not null and l.user_id = p_user_id
  ),
  interested_prefs as (
    select v2.user_id as pref_creator
    from public.video_feedback f
    join public.videos v2 on v2.id = f.video_id
    where p_user_id is not null and f.user_id = p_user_id and f.feedback = 'interested'
  ),
  not_interested_videos as (
    select video_id from public.video_feedback
    where p_user_id is not null and user_id = p_user_id and feedback = 'not_interested'
  ),
  not_interested_creators as (
    select v2.user_id as creator_id
    from public.video_feedback f
    join public.videos v2 on v2.id = f.video_id
    where p_user_id is not null and f.user_id = p_user_id and f.feedback = 'not_interested'
    group by v2.user_id
    having count(*) >= 2
  ),
  blocked as (
    select blocked_id from public.blocks
    where p_user_id is not null and blocker_id = p_user_id
  ),
  muted as (
    select muted_id from public.muted_users
    where p_user_id is not null and user_id = p_user_id
  ),
  scored as (
    select
      v.id, v.user_id, v.description, v.music, v.sound_id, v.video_url, v.thumbnail, v.privacy,
      v.likes_count, v.comments_count, v.shares_count, v.views_count, v.created_at,
      p.name as user_name, p.handle as user_handle,
      p.avatar_url as user_avatar_url, p.verified as user_verified,
      (
        (v.likes_count * 3) + (v.comments_count * 5) +
        (v.shares_count * 7) + (v.views_count * 1) +
        case
          when v.created_at >= now() - interval '24 hours' then 1000
          when v.created_at >= now() - interval '72 hours' then 500
          else 0
        end +
        case when exists (select 1 from prefs where pref_creator = v.user_id) then 2000 else 0 end +
        case when v.sound_id is not null and exists (select 1 from prefs where pref_sound = v.sound_id) then 800 else 0 end +
        case when exists (select 1 from liked_prefs where pref_creator = v.user_id) then 1500 else 0 end +
        case when exists (select 1 from interested_prefs where pref_creator = v.user_id) then 1200 else 0 end
      ) as score
    from public.videos v
    join public.profiles p on p.id = v.user_id
    where v.is_draft = false
      and v.privacy = 'public'
      and coalesce(v.is_hidden, false) = false
      and coalesce(v.is_archived, false) = false
      and (p.banned_until is null or p.banned_until <= now())
      -- A private account's posts never reach the public feed, only the
      -- profiles of people it has approved.
      and (
        not coalesce(p.is_private, false)
        or v.user_id = p_user_id
        or (p_user_id is not null and exists (
              select 1 from public.follows f2
               where f2.follower_id = p_user_id and f2.followed_id = v.user_id))
      )
      and v.user_id not in (select blocked_id from blocked)
      and v.user_id not in (select muted_id from muted)
      and v.id not in (select video_id from not_interested_videos)
      and v.user_id not in (select creator_id from not_interested_creators)
  ),
  ranked as (
    select *,
      row_number() over (partition by user_id order by score desc, created_at desc) as creator_rank
    from scored
  )
  select id, user_id, description, music, sound_id, video_url, thumbnail, privacy,
         likes_count, comments_count, shares_count, views_count, created_at,
         user_name, user_handle, user_avatar_url, user_verified
  from ranked
  where creator_rank <= greatest(p_max_per_creator, 1)
  order by score desc, created_at desc
  limit p_limit
  offset p_offset;
$fn$;

grant execute on function public.fetch_fyp_feed(integer, integer, uuid, integer) to authenticated, anon;


-- ── Gift notifications ──
create or replace function public.notify_on_gift()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.to_user_id = new.from_user_id then return new; end if;
  if not public.setting_bool(new.to_user_id, 'notif_gifts') then return new; end if;
  insert into public.notifications (user_id, actor_id, type, payload)
  values (new.to_user_id, new.from_user_id, 'gift',
          jsonb_build_object('gift_id', new.gift_id, 'amount', new.amount));
  return new;
end; $fn$;

drop trigger if exists trg_notify_on_gift on public.gift_transactions;
create trigger trg_notify_on_gift
  after insert on public.gift_transactions
  for each row execute function public.notify_on_gift();


-- ── Live notifications ──
-- Only when a stream starts, and only to followers who want them. A private
-- host reaches its approved followers only, which the follows table already is.
create or replace function public.notify_on_live()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.status <> 'live' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'live' then return new; end if;

  insert into public.notifications (user_id, actor_id, type, payload)
  select f.follower_id, new.host_id, 'live',
         jsonb_build_object('stream_id', new.id, 'title', left(coalesce(new.title, ''), 60))
  from public.follows f
  where f.followed_id = new.host_id
    and public.setting_bool(f.follower_id, 'notif_live')
    and not exists (select 1 from public.blocks b
                     where b.blocker_id = f.follower_id and b.blocked_id = new.host_id)
    and not exists (select 1 from public.muted_users m
                     where m.user_id = f.follower_id and m.muted_id = new.host_id);
  return new;
end; $fn$;

drop trigger if exists trg_notify_on_live on public.live_streams;
create trigger trg_notify_on_live
  after insert or update of status on public.live_streams
  for each row execute function public.notify_on_live();
