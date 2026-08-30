-- =============================================================
--  FLYP - RUN THIS WHOLE FILE ONCE in the Supabase SQL Editor
--
--  Migrations 0048, 0049 and 0050, in order. 0041-0047 are already applied.
--
--    0048  SECURITY - any user could make themselves an admin. Also fixes
--          forged messages, a reaction that could be moved into a private
--          chat, and viewer counts anyone could rewrite.
--    0049  BLOCKING - a blocked person could still comment on your videos,
--          message you, and read your posts. Blocks also left follows intact.
--    0050  RATE LIMITS - nothing but support tickets was limited, so
--          mass-follow, DM flooding and comment spam were a for-loop away.
--
--  Safe to run more than once. Everything is create-or-replace, drop-first,
--  or if-not-exists.
--
--  A verification block at the very end reports whether each piece landed,
--  and whether pg_cron is enabled - which decides if account deletion ever
--  actually completes. Read its output.
-- =============================================================


-- #############################################################
-- ##  0048_security_fixes.sql
-- #############################################################
-- ============================================================
-- 0048_security_fixes.sql   ***  APPLY THIS URGENTLY  ***
--
-- Four security holes found by an independent review on 2026-08-30.
-- Finding 1 is critical and is live right now.
--
-- Background that explains all four: no table in this schema uses
-- FORCE ROW LEVEL SECURITY, and every SECURITY DEFINER function is owned by
-- the role that owns the tables. So those functions bypass RLS completely on
-- everything they touch — whatever the function body checks IS the only
-- check. Several of them were not checking enough.
-- ============================================================


-- ============================================================
-- 1. CRITICAL — any user could make themselves an admin.
--
-- 0001 created:
--   create policy "profiles update own" on public.profiles
--     for update to authenticated using (auth.uid() = id);
--
-- There is no WITH CHECK and no column list. In PostgreSQL an UPDATE policy
-- with only USING reuses that expression as its WITH CHECK, and
-- "auth.uid() = id" is still true after you have changed any OTHER column on
-- your own row. So every column was self-writable, including is_admin.
--
-- The validate_profile() trigger from 0007 does not help: it fires
-- `before insert or update of name, handle, bio, avatar_url` and so never
-- sees is_admin, verified, banned_until or deactivated_at.
--
--   await supabase.from('profiles')
--     .update({ is_admin: true, banned_until: null })
--     .eq('id', MY_USER_ID);
--
-- That one call granted full admin — read and delete any video, edit any
-- profile, adjust any wallet, read every support ticket — and made bans
-- self-reversible.
--
-- Fixed with a trigger rather than column privileges, because admins are
-- also in the `authenticated` role and revoking the column from that role
-- would break the admin panel too.
-- ============================================================

create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- An admin may change these; nobody else may, on any row including
  -- their own. Silently reverting rather than raising keeps ordinary
  -- profile edits working while making privilege edits impossible.
  if not public.is_admin() then
    new.is_admin        := old.is_admin;
    new.verified        := old.verified;
    new.banned_until    := old.banned_until;
    new.deactivated_at  := old.deactivated_at;
    -- Counters are maintained by triggers; letting a user set their own
    -- follower count is how fake popularity gets manufactured.
    new.followers_count := old.followers_count;
    new.following_count := old.following_count;
    new.likes_count     := old.likes_count;
  end if;
  return new;
end;
$$;

drop trigger if exists tr_guard_profile_privileges on public.profiles;
create trigger tr_guard_profile_privileges
  before update on public.profiles
  for each row execute function public.guard_profile_privileges();


-- ============================================================
-- 2. HIGH — messages could be forged and attributed to another user.
--
-- record_call_in_chat() (0045) took chat_id and caller_id straight off the
-- calls row and inserted a message from them with RLS bypassed. Neither
-- value could be trusted:
--
--   * the calls INSERT policy never constrained chat_id at all, so a call
--     could point at any chat, including one you are not in;
--   * the calls UPDATE policy is
--       using (caller_id = auth.uid() or callee_id = auth.uid())
--     and because that is an OR, you could rewrite caller_id to someone
--     else while remaining the callee, and still satisfy it.
--
-- The trigger then wrote exactly what the messages policy
-- (`auth.uid() = from_user_id and is_chat_member(chat_id)`) exists to stop.
-- Worse, two further triggers amplified it: notify_on_message told every
-- member the victim had messaged them, and accept_on_reply (0043) marked the
-- message request accepted on the victim's behalf — walking a stranger
-- straight out of the Requests tab that migration had just built.
-- ============================================================

create or replace function public.record_call_in_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seconds integer := 0;
begin
  if new.status not in ('ended', 'declined', 'missed') then return null; end if;
  if old.status is not distinct from new.status then return null; end if;
  if new.chat_id is null then return null; end if;

  -- Trust nothing off the row. Both parties must genuinely be in the chat
  -- the record is about, or no record is written.
  if not exists (
        select 1 from public.chat_members
         where chat_id = new.chat_id and user_id = new.caller_id)
     or not exists (
        select 1 from public.chat_members
         where chat_id = new.chat_id and user_id = new.callee_id) then
    return null;
  end if;

  if new.status = 'ended' and new.answered_at is not null then
    v_seconds := greatest(0, extract(epoch from (coalesce(new.ended_at, now()) - new.answered_at))::integer);
  end if;

  insert into public.messages (chat_id, from_user_id, type, text)
  values (
    new.chat_id, new.caller_id, 'call',
    json_build_object('kind', new.kind, 'status', new.status, 'seconds', v_seconds)::text
  );
  return null;
end;
$$;

-- A policy's WITH CHECK cannot see OLD, so it cannot express "this column
-- must not change". A trigger can.
create or replace function public.guard_call_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.caller_id is distinct from old.caller_id
     or new.callee_id is distinct from old.callee_id
     or new.chat_id  is distinct from old.chat_id then
    raise exception 'call participants cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists tr_guard_call_participants on public.calls;
create trigger tr_guard_call_participants
  before update on public.calls
  for each row execute function public.guard_call_participants();

-- And stop a call being aimed at a chat you are not a member of.
-- The existing policy is named "calls insert as caller" (0019). Replacing it
-- under its real name matters: creating a differently-named policy alongside
-- it would leave the permissive one in force, since policies are OR-ed.
drop policy if exists "calls insert as caller" on public.calls;
create policy "calls insert as caller" on public.calls
  for insert to authenticated
  with check (
    caller_id = auth.uid()
    and callee_id <> auth.uid()
    and (chat_id is null or public.is_chat_member(chat_id))
  );


-- ============================================================
-- 3. MEDIUM — a reaction could be moved into a chat you are not in.
--
-- The INSERT policy on message_reactions correctly required chat membership.
-- The UPDATE policy checked only `user_id = auth.uid()` in both USING and
-- WITH CHECK — and message_id was updatable. So you could react to a message
-- in your own chat, then move that row onto any message in the database,
-- carrying arbitrary text in `emoji` (an unconstrained text column) into a
-- private conversation.
--
-- The policy is not needed at all: toggle_message_reaction is SECURITY
-- DEFINER and does the emoji swap itself with ON CONFLICT DO UPDATE, so the
-- client never issues a direct UPDATE.
-- ============================================================

drop policy if exists "reactions update own" on public.message_reactions;

-- Keep the emoji column to something emoji-shaped while we are here, so a
-- reaction can never be used to smuggle a paragraph of text into a chat.
alter table public.message_reactions
  drop constraint if exists message_reactions_emoji_len;
alter table public.message_reactions
  add constraint message_reactions_emoji_len
  check (char_length(emoji) between 1 and 16);


-- ============================================================
-- 4. MEDIUM — viewer counts could be inflated or zeroed by anyone.
--
-- 0046 said in its own comment that only the host may write this number,
-- then added two SECURITY DEFINER functions that bypassed the host-only
-- policy and checked nothing. join_live_stream only checked you were signed
-- in; leave_live_stream checked nothing at all. Neither recorded WHO joined,
-- so calling join in a loop inflated the count — and viewer_count_max only
-- ever rises, so the fake peak was permanent. Calling leave against someone
-- else's stream pushed it down the browse list, which is ordered by
-- viewer_count.
--
-- Fixed by counting actual rows, one per viewer, so a user counts once no
-- matter how many times they call.
-- ============================================================

create table if not exists public.live_viewers (
  live_id    uuid not null references public.live_streams (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (live_id, user_id)
);

create index if not exists idx_live_viewers_live on public.live_viewers (live_id);

alter table public.live_viewers enable row level security;

-- Written only through the functions below; readable so a host could list
-- who is watching.
drop policy if exists "live_viewers read" on public.live_viewers;
create policy "live_viewers read" on public.live_viewers
  for select to authenticated using (true);

create or replace function public.join_live_stream(p_live_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_count integer;
begin
  if v_me is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.live_streams
                  where id = p_live_id and status = 'live') then
    return 0;
  end if;

  -- One row per person. A second call by the same user changes nothing.
  insert into public.live_viewers (live_id, user_id)
  values (p_live_id, v_me)
  on conflict (live_id, user_id) do nothing;

  select count(*) into v_count from public.live_viewers where live_id = p_live_id;

  update public.live_streams
     set viewer_count = v_count,
         viewer_count_max = greatest(viewer_count_max, v_count)
   where id = p_live_id;

  return v_count;
end;
$$;

create or replace function public.leave_live_stream(p_live_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_count integer;
begin
  if v_me is null then raise exception 'not signed in'; end if;

  -- Keyed on auth.uid(), so you can only ever remove yourself.
  delete from public.live_viewers
   where live_id = p_live_id and user_id = v_me;

  select count(*) into v_count from public.live_viewers where live_id = p_live_id;

  update public.live_streams set viewer_count = v_count where id = p_live_id;

  return v_count;
end;
$$;

revoke all on function public.join_live_stream(uuid)  from public;
revoke all on function public.leave_live_stream(uuid) from public;
grant execute on function public.join_live_stream(uuid)  to authenticated;
grant execute on function public.leave_live_stream(uuid) to authenticated;

-- A stream that ends should not leave stale viewer rows behind.
create or replace function public.clear_live_viewers_on_end()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'live' and old.status = 'live' then
    delete from public.live_viewers where live_id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists tr_clear_live_viewers on public.live_streams;
create trigger tr_clear_live_viewers
  after update on public.live_streams
  for each row execute function public.clear_live_viewers_on_end();


-- #############################################################
-- ##  0049_blocking_fixes.sql
-- #############################################################
-- ============================================================
-- 0049_blocking_fixes.sql
--
-- Blocking was enforced in twenty places but missed four, and every one of
-- the four is something a blocked person can do to the person who blocked
-- them. This is a safety feature, so a partial implementation is worse than
-- it looks: the person who blocked believes they are protected.
--
-- What already worked (checked, unchanged): the feed excludes blocked users,
-- as do live comments, mentions, location sharing, and the live-start alert.
--
-- What did not:
--   1. a blocked person could still COMMENT on your videos
--   2. a blocked person could still MESSAGE you in an existing conversation
--   3. a blocked person could still READ your videos directly
--   4. blocking left existing follows in place, both directions
--
-- A fifth gap is deliberately NOT fixed here — see the note at the bottom.
-- ============================================================


-- ── One helper, both directions ──────────────────────────
-- Blocking is symmetrical in effect: whichever way round it was done, the
-- two people should not reach each other. Every check below uses this, so
-- they cannot drift apart later.
create or replace function public.is_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.blocks
     where (blocker_id = p_a and blocked_id = p_b)
        or (blocker_id = p_b and blocked_id = p_a)
  );
$$;

revoke all on function public.is_blocked_between(uuid, uuid) from public;
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated, anon;


-- ============================================================
-- 1. Commenting
--
-- may_comment_on() (0027) checked the video exists, comments are allowed,
-- and the owner's "who can comment" setting — but never looked at blocks.
-- So someone you had blocked could keep commenting on everything you posted.
-- ============================================================
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

  -- Added: a block stops this before any preference is considered.
  if public.is_blocked_between(v_owner, p_actor) then return false; end if;

  v_rule := public.setting_text(v_owner, 'who_can_comment');
  if v_rule = 'nobody' then return false; end if;
  if v_rule = 'following' then
    return exists (select 1 from public.follows
                    where follower_id = v_owner and followed_id = p_actor);
  end if;
  return true;
end;
$fn$;


-- ============================================================
-- 2. Messaging
--
-- can_message() (0027) does check blocks — but it was only ever called from
-- the app, in views.js, before opening a NEW conversation. The database
-- policy behind messages checked only membership:
--
--   with check (auth.uid() = from_user_id and public.is_chat_member(chat_id))
--
-- So a conversation that already existed before the block carried on
-- working, and a direct API call bypassed the app's check entirely. A UI
-- check is not enforcement.
--
-- Only direct messages are gated. Blocking someone should not silently
-- break a group both people are in — that is a different decision, and
-- taking it here would surprise everyone else in the group.
-- ============================================================
create or replace function public.may_message_in_chat(p_chat uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare v_type text; v_other uuid;
begin
  select type into v_type from public.chats where id = p_chat;
  if v_type is null then return false; end if;
  if v_type <> 'dm' then return true; end if;   -- groups are unaffected

  select user_id into v_other
    from public.chat_members
   where chat_id = p_chat and user_id <> p_actor
   limit 1;

  if v_other is null then return true; end if;  -- a chat with only you in it
  return not public.is_blocked_between(v_other, p_actor);
end;
$fn$;

revoke all on function public.may_message_in_chat(uuid, uuid) from public;
grant execute on function public.may_message_in_chat(uuid, uuid) to authenticated;

drop policy if exists "messages members insert" on public.messages;
create policy "messages members insert" on public.messages
  for insert to authenticated
  with check (
    auth.uid() = from_user_id
    and public.is_chat_member(chat_id)
    and public.may_message_in_chat(chat_id, auth.uid())
  );


-- ============================================================
-- 3. Reading videos directly
--
-- can_see_posts_of() (0030) asked three questions — is it yours, is the
-- account public, do you follow them — and never asked about blocks. The
-- FEED filtered blocked creators out, so this looked fine in the app. But
-- the feed is not the only way in: a direct query on the videos table, or
-- opening a shared /v/<id> link, went straight past it.
--
-- So blocking hid someone from your feed while leaving all your posts
-- readable to them.
-- ============================================================
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
      -- Added: neither direction of a block may see the other's posts.
      -- p_viewer is null for signed-out visitors, where no block can exist.
      (p_viewer is null or not public.is_blocked_between(p_owner, p_viewer))
      and (
        not coalesce((select is_private from public.profiles where id = p_owner), false)
        or exists (select 1 from public.follows
                    where follower_id = p_viewer and followed_id = p_owner)
      )
    );
$fn$;


-- ============================================================
-- 4. Existing follows survived a block
--
-- Nothing removed them, so after blocking someone: they still followed you,
-- they still counted in your follower total, they still appeared in your
-- followers list, and your posts could still reach them through any path
-- that trusted the follow rather than re-checking the block.
--
-- Every comparable app severs the relationship both ways on block.
-- ============================================================
create or replace function public.drop_follows_on_block()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.follows
   where (follower_id = new.blocker_id and followed_id = new.blocked_id)
      or (follower_id = new.blocked_id and followed_id = new.blocker_id);

  -- A pending follow request is the same relationship waiting to happen.
  delete from public.follow_requests
   where (requester_id = new.blocker_id and target_id = new.blocked_id)
      or (requester_id = new.blocked_id and target_id = new.blocker_id);

  return null;
end;
$$;

drop trigger if exists tr_drop_follows_on_block on public.blocks;
create trigger tr_drop_follows_on_block
  after insert on public.blocks
  for each row execute function public.drop_follows_on_block();


-- ============================================================
-- NOT fixed here, on purpose: profile visibility
--
-- `profiles read public` is `using (true)` — every profile is readable by
-- anyone, signed in or not. So a blocked person can still open your profile
-- and see your name, photo, bio and counts. Instagram hides it entirely.
--
-- Left alone deliberately, because the profiles table is read everywhere a
-- name or avatar appears: group chat members, follower lists, comment
-- authors, admin screens. Restricting it needs each of those paths checked
-- first, or people start rendering as blanks in places that have nothing to
-- do with blocking.
--
-- It is a real gap and it should be closed — as its own change, with the
-- app tested against it, not bundled in with four unrelated fixes.
-- ============================================================


-- #############################################################
-- ##  0050_rate_limits.sql
-- #############################################################
-- ============================================================
-- 0050_rate_limits.sql
--
-- Nothing except support tickets was rate limited. Because the browser talks
-- straight to Postgres, anyone who opens devtools can call these tables in a
-- loop — mass-follow thousands of accounts, flood a stranger with messages,
-- spray comments across every video, or brigade the report queue. None of it
-- needs a special tool; it is a for-loop in the console.
--
-- The limits below are deliberately GENEROUS. A limit that a real, enthusiastic
-- person can hit is a bug, not a safeguard — it teaches people the app is
-- broken. These are set roughly an order of magnitude above normal use, so
-- they catch scripts and leave humans alone. Tune them in app_limits later if
-- real usage argues for it.
--
-- Same shape as check_support_rate_limit() from 0033: count the recent rows,
-- raise if there are too many. Cheap, no extra tables, no background job.
-- ============================================================


-- ── Supporting index ─────────────────────────────────────
-- Counting a person's recent messages filters on from_user_id, which is not
-- the leading column of any existing index — so without this the check would
-- scan the whole messages table on every single send, and the rate limiter
-- would itself become the performance problem.
--
-- (The earlier index audit concluded messages.from_user_id was not worth
-- indexing because nothing filtered on it with equality. This migration is
-- what changes that.)
create index if not exists idx_messages_from_user_created
  on public.messages (from_user_id, created_at desc);

create index if not exists idx_follows_follower_created
  on public.follows (follower_id, created_at desc);

create index if not exists idx_comments_user_created
  on public.comments (user_id, created_at desc);

create index if not exists idx_reports_reporter_created
  on public.reports (reporter_id, created_at desc);


-- ── One helper, so every limit reads the same way ────────
create or replace function public.rate_limit_exceeded(
  p_count integer, p_max integer, p_what text
) returns void
language plpgsql
immutable
as $$
begin
  if p_count >= p_max then
    -- The message reaches the user, so it says what to do, not just "no".
    raise exception 'too many % — please wait a little and try again', p_what
      using errcode = 'check_violation';
  end if;
end;
$$;


-- ── Following: 60 per hour ───────────────────────────────
-- A person exploring the app might follow twenty in a burst. A growth script
-- does thousands. This sits well above the first and well below the second.
create or replace function public.check_follow_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  select count(*) into n from public.follows
   where follower_id = new.follower_id
     and created_at > now() - interval '1 hour';
  perform public.rate_limit_exceeded(n, 60, 'follows');
  return new;
end;
$$;

drop trigger if exists trg_follow_rate on public.follows;
create trigger trg_follow_rate
  before insert on public.follows
  for each row execute function public.check_follow_rate();


-- ── Comments: 40 per hour ────────────────────────────────
create or replace function public.check_comment_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  select count(*) into n from public.comments
   where user_id = new.user_id
     and created_at > now() - interval '1 hour';
  perform public.rate_limit_exceeded(n, 40, 'comments');
  return new;
end;
$$;

drop trigger if exists trg_comment_rate on public.comments;
create trigger trg_comment_rate
  before insert on public.comments
  for each row execute function public.check_comment_rate();


-- ── Messages: 200 per hour overall, 60 per hour into one chat ────
-- Two limits, because they stop different things. The overall cap stops one
-- account spraying many people; the per-chat cap stops one person being
-- buried by a single sender. 200 an hour is more than three a minute
-- sustained for an hour, which no real conversation reaches.
create or replace function public.check_message_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare n_total integer; n_chat integer;
begin
  -- Records written by triggers (call records) must not be counted against
  -- the person, and must never be blocked.
  if new.type = 'call' then return new; end if;

  select count(*) into n_total from public.messages
   where from_user_id = new.from_user_id
     and created_at > now() - interval '1 hour';
  perform public.rate_limit_exceeded(n_total, 200, 'messages');

  select count(*) into n_chat from public.messages
   where from_user_id = new.from_user_id
     and chat_id = new.chat_id
     and created_at > now() - interval '1 hour';
  perform public.rate_limit_exceeded(n_chat, 60, 'messages to this conversation');

  return new;
end;
$$;

drop trigger if exists trg_message_rate on public.messages;
create trigger trg_message_rate
  before insert on public.messages
  for each row execute function public.check_message_rate();


-- ── Reports: 20 per hour ─────────────────────────────────
-- Auto-hide already counts DISTINCT reporters, so one account cannot take a
-- video down alone. This is about the admin queue: without it, one person can
-- bury the moderators in thousands of reports and hide the real ones.
create or replace function public.check_report_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if new.reporter_id is null then return new; end if;
  select count(*) into n from public.reports
   where reporter_id = new.reporter_id
     and created_at > now() - interval '1 hour';
  perform public.rate_limit_exceeded(n, 20, 'reports');
  return new;
end;
$$;

drop trigger if exists trg_report_rate on public.reports;
create trigger trg_report_rate
  before insert on public.reports
  for each row execute function public.check_report_rate();


-- ── Likes: 500 per hour ──────────────────────────────────
-- Deliberately high. Someone scrolling and liking freely is normal
-- behaviour and must never be interrupted; this only catches automation.
create or replace function public.check_like_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  select count(*) into n from public.likes
   where user_id = new.user_id
     and created_at > now() - interval '1 hour';
  perform public.rate_limit_exceeded(n, 500, 'likes');
  return new;
end;
$$;

drop trigger if exists trg_like_rate on public.likes;
create trigger trg_like_rate
  before insert on public.likes
  for each row execute function public.check_like_rate();


-- ── Live streams: 10 started per hour ────────────────────
create or replace function public.check_live_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  select count(*) into n from public.live_streams
   where host_id = new.host_id
     and started_at > now() - interval '1 hour';
  perform public.rate_limit_exceeded(n, 10, 'broadcasts');
  return new;
end;
$$;

drop trigger if exists trg_live_rate on public.live_streams;
create trigger trg_live_rate
  before insert on public.live_streams
  for each row execute function public.check_live_rate();


-- ============================================================
-- Deliberately NOT limited here
--
--   videos      already gated by within_upload_quota() and the storage
--               policy from 0031, which is a stricter and better check
--   saves       harmless; only affects the person doing it
--   reactions   capped by the primary key — one per person per message
--   follow_requests  a private account's own approval step already gates it
--
-- Also worth knowing: this is per-ACCOUNT, not per-device or per-IP.
-- Someone willing to register a thousand accounts is not stopped by any of
-- this. That is what signup limits and email verification are for, and they
-- are a separate piece of work.
-- ============================================================


-- #############################################################
-- ##  VERIFICATION - read these rows
-- #############################################################

select '0048 admin guard'        as check,
       coalesce((select 'OK' from pg_trigger where tgname='tr_guard_profile_privileges'), 'MISSING') as result
union all select '0048 call participants locked',
       coalesce((select 'OK' from pg_trigger where tgname='tr_guard_call_participants'), 'MISSING')
union all select '0048 reaction update policy removed',
       case when exists (select 1 from pg_policies where tablename='message_reactions' and policyname='reactions update own')
            then 'STILL THERE - bad' else 'OK' end
union all select '0048 live_viewers table',
       coalesce((select 'OK' from pg_tables where tablename='live_viewers'), 'MISSING')
union all select '0049 block helper',
       coalesce(to_regprocedure('public.is_blocked_between(uuid,uuid)')::text, 'MISSING')
union all select '0049 follows dropped on block',
       coalesce((select 'OK' from pg_trigger where tgname='tr_drop_follows_on_block'), 'MISSING')
union all select '0049 message block check',
       coalesce(to_regprocedure('public.may_message_in_chat(uuid,uuid)')::text, 'MISSING')
union all select '0050 rate limit triggers',
       (select count(*)::text || ' of 6' from pg_trigger
         where tgname in ('trg_follow_rate','trg_comment_rate','trg_message_rate',
                          'trg_report_rate','trg_like_rate','trg_live_rate'))
union all select 'pg_cron enabled (account deletion)',
       coalesce((select 'YES' from pg_extension where extname='pg_cron'),
                'NO - scheduled deletion never runs')
union all select 'accounts awaiting deletion',
       coalesce((select count(*)::text from public.profiles where deletion_scheduled_at is not null), '0');
