-- ============================================================
-- 0034_account_status.sql
--
-- Deleting an account was a single red row that wiped everything instantly,
-- with nothing between "I want a break" and "destroy my account".
--
--   deactivated_at        - hidden, reversible, nothing is destroyed
--   deletion_scheduled_at - a 30-day grace period before anything is erased
--
-- Signing back in during the grace period cancels the deletion, which is how
-- every large platform handles this and what makes the warning honest.
--
-- Apply in the Supabase SQL editor AFTER 0001..0033.
-- ============================================================

alter table public.profiles
  add column if not exists deactivated_at        timestamptz;

alter table public.profiles
  add column if not exists deletion_scheduled_at timestamptz;

create index if not exists idx_profiles_pending_deletion
  on public.profiles (deletion_scheduled_at)
  where deletion_scheduled_at is not null;


-- ── Deactivate: hide, do not destroy ──
create or replace function public.deactivate_account()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not signed in'; end if;

  update public.profiles
     set deactivated_at = now()
   where id = v_me;

  -- A hidden account should not still be broadcasting a position.
  update public.user_locations
     set sharing_enabled = false, visibility = 'none',
         lat = null, lng = null, accuracy = null, updated_at = now()
   where user_id = v_me;
end;
$fn$;

grant execute on function public.deactivate_account() to authenticated;


-- ── Coming back ──
-- Clears both flags: signing in is the clearest possible statement that you
-- did not want the account gone.
create or replace function public.reactivate_account()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not signed in'; end if;

  update public.profiles
     set deactivated_at = null,
         deletion_scheduled_at = null
   where id = v_me;
end;
$fn$;

grant execute on function public.reactivate_account() to authenticated;


-- ── Delete, after a grace period ──
create or replace function public.schedule_account_deletion()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_me uuid := auth.uid();
  v_at timestamptz := now() + interval '30 days';
begin
  if v_me is null then raise exception 'not signed in'; end if;

  update public.profiles
     set deletion_scheduled_at = v_at,
         deactivated_at = coalesce(deactivated_at, now())
   where id = v_me;

  update public.user_locations
     set sharing_enabled = false, visibility = 'none',
         lat = null, lng = null, accuracy = null, updated_at = now()
   where user_id = v_me;

  return v_at;
end;
$fn$;

grant execute on function public.schedule_account_deletion() to authenticated;


create or replace function public.cancel_account_deletion()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform public.reactivate_account();
end;
$fn$;

grant execute on function public.cancel_account_deletion() to authenticated;


-- ── Status, for the app to render ──
create or replace function public.my_account_status()
returns jsonb
language sql
security definer
stable
set search_path = public
as $fn$
  select jsonb_build_object(
    'deactivated',      (deactivated_at is not null),
    'deactivated_at',   deactivated_at,
    'deletion_scheduled_at', deletion_scheduled_at,
    'days_left', case
      when deletion_scheduled_at is null then null
      else greatest(0, ceil(extract(epoch from (deletion_scheduled_at - now())) / 86400))
    end
  )
  from public.profiles
  where id = auth.uid();
$fn$;

grant execute on function public.my_account_status() to authenticated;


-- ── A hidden account is hidden everywhere ──
create or replace function public.can_see_posts_of(p_owner uuid, p_viewer uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $fn$
  select
    p_owner = p_viewer
    or (
      -- Deactivated or pending deletion: nothing of theirs is shown.
      not exists (
        select 1 from public.profiles
         where id = p_owner and deactivated_at is not null
      )
      and (
        not coalesce((select is_private from public.profiles where id = p_owner), false)
        or exists (select 1 from public.follows
                    where follower_id = p_viewer and followed_id = p_owner)
      )
    );
$fn$;

grant execute on function public.can_see_posts_of(uuid, uuid) to authenticated, anon;


-- ── The feed skips deactivated accounts ──
-- 0030's version with one extra condition on the profile join.
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
      and p.deactivated_at is null
      and (p.banned_until is null or p.banned_until <= now())
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


-- ── Carrying out the deletions ──
-- Run from a scheduled job. Anyone still inside their 30 days is untouched.
create or replace function public.purge_scheduled_deletions()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r record;
  n integer := 0;
begin
  for r in
    select id from public.profiles
     where deletion_scheduled_at is not null
       and deletion_scheduled_at <= now()
  loop
    delete from public.profiles where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$fn$;

revoke all on function public.purge_scheduled_deletions() from public;
grant execute on function public.purge_scheduled_deletions() to service_role;

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-scheduled-deletions')
      where exists (select 1 from cron.job where jobname = 'purge-scheduled-deletions');
    perform cron.schedule('purge-scheduled-deletions', '30 3 * * *',
                          'select public.purge_scheduled_deletions()');
  end if;
end
$cron$;
