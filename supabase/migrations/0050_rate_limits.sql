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
