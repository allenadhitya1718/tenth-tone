-- ============================================================
-- 0101_post_location_and_tags.sql
-- A post can carry a place, and can tag people.
--
-- Client note 21: "when posting a video or photo, add a location and tag
-- users/friends". The web app's publish screen had both rows once and
-- removed them (views.js, publish screen) because there was nowhere to keep
-- either: videos had no place column and there was no tag table. Only the
-- caption's @handles reached anybody, through the 0035 mention trigger.
--
-- Client note 28: profiles should show a Map of places. That map has no
-- source until a post has coordinates, so the columns below are its source.
--
-- ── What this adds ──
--   videos.place_name / lat / lng   nullable; a post without a place is
--                                   unchanged. Coordinates come in pairs and
--                                   are range-checked. One partial index
--                                   serves "this person's posts that have a
--                                   place", which is what the profile map
--                                   reads.
--   video_tags (video_id, user_id)  one row per person tagged in a post.
--   fetch_profile_places(user, n)   the profile map's query, as an RPC.
--
-- ── Who may tag whom ──
-- A BEFORE INSERT trigger on video_tags refuses the row, with a message the
-- app can show, when:
--   * the tagger is not the post's owner (the insert policy says so too),
--   * the tagged person is the owner (you cannot tag yourself),
--   * either side has blocked the other,
--   * the tagged person's who_can_tag does not allow it. The rule is decided
--     by may_tag() (0035, and 0097 if applied), which already handles
--     'nobody', 'following', blocks and Restrict. 'friends' (mutual follow)
--     is checked here as well, inline, so the rule holds whether or not 0097
--     has run: before 0097 may_tag() would wave an unknown value through,
--     and 0097's constraint is what lets the value be stored at all.
--   * the post already has 20 tags.
-- Refusing loudly, rather than silently dropping the tag, is deliberate: the
-- person posting should learn that the tag did not stick.
--
-- ── Notifications ──
-- The tagged person gets a notification of the EXISTING type 'mention', with
-- payload.kind = 'tag', so notifications_type_check needs no change (same
-- choice as 0057 and 0061). send-push already routes 'mention' to the post;
-- its title reads "mentioned you", which is close enough until send-push
-- learns payload.kind. The app should render "tagged you in a post" when
-- payload.kind = 'tag'.
--
-- A tag on a draft, private, archived or hidden post does not notify, because
-- the link would open on nothing. When a draft is published, the people
-- tagged on it are notified then (trigger on videos.is_draft).
--
-- ── What readers see ──
-- A tag row is readable by anyone who can read the post (the policy asks the
-- videos table, under the reader's own row policies, so draft / privacy /
-- block / private-account rules are inherited rather than restated). A tag
-- naming somebody the reader is blocked from is hidden from that reader.
--
-- ── Removing a tag ──
-- The post's owner may remove any tag. The TAGGED person may also remove
-- their own tag ("remove me from this post"), which every comparable app
-- offers and which is the only recourse after a tag lands. Drop the second
-- half of the delete policy if that is not wanted.
--
-- ── Applying it ──
-- Apply in the Supabase SQL editor AFTER 0001..0096 (0097 optional, either
-- order). Safe to re-run. The feed RPCs (fetch_fyp_feed, 0084's feed) do not
-- return the new columns; the app reads place and tags for a post directly
-- from videos / video_tags, or those RPCs are extended later.
-- ============================================================

begin;

-- ── 1. A place on a post ─────────────────────────────────

alter table public.videos add column if not exists place_name text;
alter table public.videos add column if not exists lat double precision;
alter table public.videos add column if not exists lng double precision;

-- Constraints are added by name, only if missing, so a re-run is a no-op.
do $chk$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'videos_place_name_length'
                    and conrelid = 'public.videos'::regclass) then
    alter table public.videos
      add constraint videos_place_name_length
      check (place_name is null or char_length(place_name) between 1 and 120);
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'videos_lat_range'
                    and conrelid = 'public.videos'::regclass) then
    alter table public.videos
      add constraint videos_lat_range
      check (lat is null or (lat between -90 and 90));
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'videos_lng_range'
                    and conrelid = 'public.videos'::regclass) then
    alter table public.videos
      add constraint videos_lng_range
      check (lng is null or (lng between -180 and 180));
  end if;

  -- Half a coordinate is not a place. Both or neither.
  if not exists (select 1 from pg_constraint
                  where conname = 'videos_lat_lng_pair'
                    and conrelid = 'public.videos'::regclass) then
    alter table public.videos
      add constraint videos_lat_lng_pair
      check ((lat is null) = (lng is null));
  end if;
end
$chk$;

-- The profile map asks "this person's posts that have a place, newest first".
-- Partial, so the many posts with no place cost nothing here.
create index if not exists idx_videos_user_with_place
  on public.videos (user_id, created_at desc)
  where lat is not null and lng is not null;


-- ── 2. Tags ──────────────────────────────────────────────

create table if not exists public.video_tags (
  video_id   uuid not null references public.videos (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (video_id, user_id)
);

-- "Posts I am tagged in" (a profile tab later) reads by the tagged person.
create index if not exists idx_video_tags_user
  on public.video_tags (user_id, created_at desc);

alter table public.video_tags enable row level security;

-- Read: whoever can read the post. The subquery runs under the reader's own
-- policies on videos, so this inherits draft, privacy, hidden, archived,
-- private-account and block rules without restating any of them. A tag that
-- names someone on the other side of a block from the reader is hidden; the
-- owner and the tagged person always see the row.
drop policy if exists "video_tags read" on public.video_tags;
create policy "video_tags read" on public.video_tags
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.videos v
       where v.id = video_tags.video_id
         and (
           v.user_id = (select auth.uid())
           or not public.is_blocked_between(video_tags.user_id, (select auth.uid()))
         )
    )
  );

-- Insert: only on your own post. Everything else (who_can_tag, blocks, the
-- cap) is the trigger's job, because a policy failure reaches the app as a
-- bare "violates row-level security" with no reason it could show.
drop policy if exists "video_tags insert by owner" on public.video_tags;
create policy "video_tags insert by owner" on public.video_tags
  for insert to authenticated
  with check (
    exists (select 1 from public.videos v
             where v.id = video_tags.video_id
               and v.user_id = (select auth.uid()))
  );

-- Delete: the post's owner, or the tagged person removing themselves.
drop policy if exists "video_tags delete" on public.video_tags;
create policy "video_tags delete" on public.video_tags
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.videos v
                where v.id = video_tags.video_id
                  and v.user_id = (select auth.uid()))
  );

-- No update policy: a tag is a pair of ids, there is nothing to edit.
-- Supabase grants every privilege on a new table to anon and authenticated by
-- default; take them all back and give only what the policies above use.
revoke all on public.video_tags from anon, authenticated;
grant select, insert, delete on public.video_tags to authenticated;


-- ── 3. May this person be tagged by that one? ────────────
-- One place for the rule, used by the insert trigger. may_tag() covers self,
-- blocks, Restrict, 'nobody' and 'following' (and 'friends' once 0097 has
-- run). The 'friends' branch below repeats 0097's meaning (mutual follow)
-- inline so the rule is right on a database without 0097; with 0097 it is the
-- same test twice, which costs two primary-key lookups.
create or replace function public.may_tag_in_post(p_target uuid, p_owner uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $fn$
begin
  if p_target is null or p_owner is null or p_target = p_owner then
    return false;
  end if;

  if public.is_blocked_between(p_target, p_owner) then
    return false;
  end if;

  if not public.may_tag(p_target, p_owner) then
    return false;
  end if;

  if public.setting_text(p_target, 'who_can_tag') = 'friends' then
    return exists (select 1 from public.follows
                    where follower_id = p_target and followed_id = p_owner)
       and exists (select 1 from public.follows
                    where follower_id = p_owner and followed_id = p_target);
  end if;

  return true;
end;
$fn$;

revoke all on function public.may_tag_in_post(uuid, uuid) from public, anon;
grant execute on function public.may_tag_in_post(uuid, uuid) to authenticated;


-- ── 4. The gate on every new tag ─────────────────────────
create or replace function public.check_video_tag()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_owner uuid;
  n       integer;
begin
  select user_id into v_owner from public.videos where id = new.video_id;
  if v_owner is null then
    raise exception 'post not found' using errcode = 'foreign_key_violation';
  end if;

  -- The policy already requires this for app inserts; restated so a definer
  -- path added later cannot tag on somebody else's post by accident.
  if auth.uid() is not null and auth.uid() <> v_owner then
    raise exception 'only the person who posted this can tag people in it'
      using errcode = 'insufficient_privilege';
  end if;

  if new.user_id = v_owner then
    raise exception 'you cannot tag yourself' using errcode = 'check_violation';
  end if;

  if not public.may_tag_in_post(new.user_id, v_owner) then
    raise exception 'this person does not allow tags from you'
      using errcode = 'insufficient_privilege';
  end if;

  -- Serialise tag inserts per post, so two parallel inserts cannot both see
  -- 19 and land at 21. Held only until the transaction ends.
  perform pg_advisory_xact_lock(hashtextextended('video_tags:' || new.video_id::text, 0));

  select count(*) into n from public.video_tags where video_id = new.video_id;
  if n >= 20 then
    raise exception 'a post can tag at most 20 people' using errcode = 'check_violation';
  end if;

  new.created_at := now();
  return new;
end;
$fn$;

revoke all on function public.check_video_tag() from public, anon, authenticated;

drop trigger if exists trg_check_video_tag on public.video_tags;
create trigger trg_check_video_tag
  before insert on public.video_tags
  for each row execute function public.check_video_tag();


-- ── 5. Tell the tagged person ────────────────────────────
-- Only once the post is something they can open: published, public, not
-- hidden or archived, and visible to them (a private account's post is not,
-- unless they follow it).
create or replace function public.notify_video_tag(p_video_id uuid, p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v record;
begin
  select id, user_id, description, privacy, is_draft, is_hidden, is_archived
    into v
    from public.videos where id = p_video_id;

  if v.id is null
     or coalesce(v.is_draft, false)
     or coalesce(v.is_hidden, false)
     or coalesce(v.is_archived, false)
     or v.privacy <> 'public'
     or not public.can_see_posts_of(v.user_id, p_target) then
    return;
  end if;

  insert into public.notifications (user_id, actor_id, type, payload)
  values (p_target, v.user_id, 'mention',
          jsonb_build_object('kind', 'tag',
                             'video_id', v.id,
                             'text', left(coalesce(v.description, ''), 80)));
end;
$fn$;

revoke all on function public.notify_video_tag(uuid, uuid) from public, anon, authenticated;

create or replace function public.on_video_tag_inserted()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform public.notify_video_tag(new.video_id, new.user_id);
  return null;
end;
$fn$;

revoke all on function public.on_video_tag_inserted() from public, anon, authenticated;

drop trigger if exists trg_notify_video_tag on public.video_tags;
create trigger trg_notify_video_tag
  after insert on public.video_tags
  for each row execute function public.on_video_tag_inserted();

-- Tags saved on a draft notify when the draft is published.
create or replace function public.notify_tags_on_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare r record;
begin
  if coalesce(old.is_draft, false) and not coalesce(new.is_draft, false) then
    for r in select user_id from public.video_tags where video_id = new.id loop
      -- Re-checked at publish time: the person may have changed who_can_tag
      -- or blocked the poster since the draft was saved.
      if public.may_tag_in_post(r.user_id, new.user_id) then
        perform public.notify_video_tag(new.id, r.user_id);
      end if;
    end loop;
  end if;
  return null;
end;
$fn$;

revoke all on function public.notify_tags_on_publish() from public, anon, authenticated;

drop trigger if exists trg_notify_tags_on_publish on public.videos;
create trigger trg_notify_tags_on_publish
  after update of is_draft on public.videos
  for each row execute function public.notify_tags_on_publish();


-- ── 6. The profile map's query ───────────────────────────
-- Security INVOKER on purpose: it reads videos under the caller's own row
-- policies, so it can never show a place on a post the caller could not open.
-- Drafts and archived posts are left out even for the owner, because the map
-- is the public face of the profile.
create or replace function public.fetch_profile_places(
  p_user_id uuid,
  p_limit   integer default 200
)
returns table (
  video_id   uuid,
  place_name text,
  lat        double precision,
  lng        double precision,
  thumbnail  text,
  created_at timestamptz
)
language sql
stable
set search_path = public
as $fn$
  select v.id, v.place_name, v.lat, v.lng, v.thumbnail, v.created_at
    from public.videos v
   where v.user_id = p_user_id
     and v.lat is not null and v.lng is not null
     and coalesce(v.is_draft, false) = false
     and coalesce(v.is_archived, false) = false
     and coalesce(v.is_hidden, false) = false
   order by v.created_at desc
   limit greatest(1, least(coalesce(p_limit, 200), 500));
$fn$;

revoke all on function public.fetch_profile_places(uuid, integer) from public, anon;
grant execute on function public.fetch_profile_places(uuid, integer) to authenticated;

commit;


-- ── Checks (run after applying; every row should read OK) ──
-- select 'videos place columns' as check,
--        case when (select count(*) from information_schema.columns
--                    where table_schema = 'public' and table_name = 'videos'
--                      and column_name in ('place_name', 'lat', 'lng')) = 3
--             then 'OK' else 'MISSING' end as result
-- union all
-- select 'video_tags has RLS',
--        case when (select relrowsecurity from pg_class
--                    where oid = 'public.video_tags'::regclass)
--             then 'OK' else 'RLS OFF' end
-- union all
-- select 'tag gate trigger',
--        case when exists (select 1 from pg_trigger
--                           where tgname = 'trg_check_video_tag' and not tgisinternal)
--             then 'OK' else 'MISSING' end
-- union all
-- select 'tag notify trigger',
--        case when exists (select 1 from pg_trigger
--                           where tgname = 'trg_notify_video_tag' and not tgisinternal)
--             then 'OK' else 'MISSING' end;
