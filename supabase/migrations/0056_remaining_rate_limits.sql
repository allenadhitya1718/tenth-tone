-- ============================================================
-- 0056_remaining_rate_limits.sql
--
-- Finishes what 0050 started. Same shape throughout: count the recent rows,
-- raise if there are too many, using the rate_limit_exceeded() helper from
-- 0050. Cheap, no extra tables, no background job.
--
-- CORRECTION TO 0050
--
-- The closing note in 0050 says videos are "already gated by
-- within_upload_quota() and the storage policy from 0031, which is a stricter
-- and better check". That is true of the FILE UPLOAD and false of the ROW.
--
-- The quota lives in the RLS policy on storage.objects, so it fires when bytes
-- are written to a bucket. Inserting a row into public.videos touches
-- storage.objects not at all. The policy guarding that insert is:
--
--     create policy "videos write own" on public.videos
--       for all to authenticated
--       using (auth.uid() = user_id) with check (auth.uid() = user_id);
--
-- — which checks ownership and nothing else. Nothing ties video_url to a file
-- the caller owns, or requires it to be set. So a for-loop in devtools can
-- insert thousands of rows carrying any URL, or none, and every one lands in
-- the feed. The daily upload quota never sees it because nothing was uploaded.
--
-- Hence the limit below. The quota and the rate limit guard different doors.
--
-- As with 0050, these are deliberately GENEROUS. A limit a real, enthusiastic
-- person can reach is a bug, not a safeguard.
-- ============================================================


-- ── Supporting indexes ───────────────────────────────────
-- Each check filters by the actor and a time window. Without a matching index
-- the check scans the table on every insert and the rate limiter becomes the
-- performance problem it was meant to prevent.
--
-- videos already has idx_videos_user_created (user_id, created_at desc) from
-- an earlier migration, so it needs nothing here.

-- live_comments is indexed by (live_stream_id, created_at) for reading a
-- stream's chat. Counting one PERSON's recent comments does not use that.
create index if not exists idx_live_comments_user_created
  on public.live_comments (user_id, created_at desc);

create index if not exists idx_chats_created_by_created
  on public.chats (created_by, created_at desc);

-- calls is indexed by (callee_id, status, created_at) for "who is ringing me".
-- The limits below count by CALLER, which that index does not serve.
create index if not exists idx_calls_caller_created
  on public.calls (caller_id, created_at desc);


-- ── Videos: 30 rows per hour ─────────────────────────────
-- The storage quota already caps real uploads at 20 a day, so nobody posting
-- genuine clips comes near this. It exists purely to stop the row-only flood
-- described above, where no file is ever uploaded.
create or replace function public.check_video_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  select count(*) into n from public.videos
   where user_id = new.user_id
     and created_at > now() - interval '1 hour';
  perform public.rate_limit_exceeded(n, 30, 'uploads');
  return new;
end;
$$;

drop trigger if exists trg_video_rate on public.videos;
create trigger trg_video_rate
  before insert on public.videos
  for each row execute function public.check_video_rate();


-- ── Live comments: 300 per hour ──────────────────────────
-- Live chat is the fastest-moving surface in the app and the classic flood
-- target — it is public, real-time, and every message is pushed to every
-- viewer, so one script degrades the stream for everybody watching.
--
-- 300 an hour is five a minute sustained for a full hour. An excited viewer
-- bursts well above five in a minute but never holds that pace, so the hourly
-- window absorbs the bursts and still stops a script.
create or replace function public.check_live_comment_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  select count(*) into n from public.live_comments
   where user_id = new.user_id
     and created_at > now() - interval '1 hour';
  perform public.rate_limit_exceeded(n, 300, 'live chat messages');
  return new;
end;
$$;

drop trigger if exists trg_live_comment_rate on public.live_comments;
create trigger trg_live_comment_rate
  before insert on public.live_comments
  for each row execute function public.check_live_comment_rate();


-- ── Chats: 30 created per hour ───────────────────────────
-- Creating conversations is how you reach strangers. Message rate limits are
-- per-conversation as well as overall (0050), so without a cap here the way
-- around the per-conversation limit is simply to open more conversations.
--
-- created_by is nullable, so guard it — a null would count every chat with a
-- null creator and lock the feature for everyone.
create or replace function public.check_chat_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if new.created_by is null then return new; end if;
  select count(*) into n from public.chats
   where created_by = new.created_by
     and created_at > now() - interval '1 hour';
  perform public.rate_limit_exceeded(n, 30, 'new conversations');
  return new;
end;
$$;

drop trigger if exists trg_chat_rate on public.chats;
create trigger trg_chat_rate
  before insert on public.chats
  for each row execute function public.check_chat_rate();


-- ── Calls: 20 per hour overall, 10 per hour to one person ────
-- Two limits, for the same reason messages have two. The overall cap stops one
-- account dialling many people; the per-callee cap is the anti-harassment one,
-- because a ringing phone is far more intrusive than an unread message.
--
-- Blocking already stops a caller outright, but only AFTER the person has been
-- rung enough times to decide to block. This narrows that window.
--
-- Rows written by triggers (the call records placed into chat by 0045) are
-- inserted into messages, not calls, so nothing here needs to exempt them.
create or replace function public.check_call_rate()
returns trigger language plpgsql security definer set search_path = public as $$
declare n_total integer; n_callee integer;
begin
  select count(*) into n_total from public.calls
   where caller_id = new.caller_id
     and created_at > now() - interval '1 hour';
  perform public.rate_limit_exceeded(n_total, 20, 'calls');

  select count(*) into n_callee from public.calls
   where caller_id = new.caller_id
     and callee_id = new.callee_id
     and created_at > now() - interval '1 hour';
  perform public.rate_limit_exceeded(n_callee, 10, 'calls to this person');

  return new;
end;
$$;

drop trigger if exists trg_call_rate on public.calls;
create trigger trg_call_rate
  before insert on public.calls
  for each row execute function public.check_call_rate();


-- ============================================================
-- Deliberately NOT limited, and why
--
--   blocks       Limiting these would hurt the person being protected. Someone
--                harassed by a ring of accounts needs to block all of them, now.
--                A cap there traps the victim, not the attacker. Blocking costs
--                one small row and affects only the blocker's own experience,
--                so there is nothing to protect against.
--
--   sounds       Insert only happens alongside a video, which is now capped.
--
--   wallet_transactions
--                Insert is admin-only already (0005: with check is_admin()).
--                Users can read their own and write none.
--
--   saves, reactions, follow_requests
--                Covered by 0050's closing note — harmless, key-capped, or
--                gated by someone else's approval.
--
-- STILL TRUE, AND THE IMPORTANT PART:
--
-- Every limit here and in 0050 is per-ACCOUNT. They do not stop somebody
-- willing to register a thousand accounts — that person simply gets a
-- thousand times each limit. What actually raises the cost of an account is
-- CAPTCHA on signup plus email verification, neither of which is enabled yet.
-- Until they are, treat all of this as protection against a careless script,
-- not a determined one.
-- ============================================================


-- ── Verification ─────────────────────────────────────────
-- Run this after applying. Every row should read 'yes'.
select 'trg_video_rate'        as object,
       case when exists (select 1 from pg_trigger where tgname = 'trg_video_rate' and not tgisinternal)
            then 'yes' else 'MISSING' end as installed
union all select 'trg_live_comment_rate',
       case when exists (select 1 from pg_trigger where tgname = 'trg_live_comment_rate' and not tgisinternal)
            then 'yes' else 'MISSING' end
union all select 'trg_chat_rate',
       case when exists (select 1 from pg_trigger where tgname = 'trg_chat_rate' and not tgisinternal)
            then 'yes' else 'MISSING' end
union all select 'trg_call_rate',
       case when exists (select 1 from pg_trigger where tgname = 'trg_call_rate' and not tgisinternal)
            then 'yes' else 'MISSING' end
union all select 'idx_live_comments_user_created',
       case when to_regclass('public.idx_live_comments_user_created') is not null then 'yes' else 'MISSING' end
union all select 'idx_chats_created_by_created',
       case when to_regclass('public.idx_chats_created_by_created') is not null then 'yes' else 'MISSING' end
union all select 'idx_calls_caller_created',
       case when to_regclass('public.idx_calls_caller_created') is not null then 'yes' else 'MISSING' end;
