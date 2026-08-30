-- =============================================================
--  Tenth Tone - RUN THIS WHOLE FILE ONCE in the Supabase SQL Editor
--
--  Combines migrations 0042 through 0046, in dependency order:
--    0042  message replies + reactions
--    0043  message requests (Instagram-style inbox tabs)
--    0044  profile name/handle required  (repairs the nameless account)
--    0045  call records in chat + live alerts to followers
--    0046  live viewer count
--
--  Safe to run more than once: every function is create-or-replace, every
--  policy and trigger is dropped first, every column add is if-not-exists.
-- =============================================================


-- #############################################################
-- ##  0042_message_replies_reactions.sql
-- #############################################################
-- ============================================================
-- 0042_message_replies_reactions.sql
--
-- Two things a conversation needs once it has more than one thread of
-- discussion running, and which every messenger the users compare us to
-- already has:
--
--   1. Replying to a specific message, so an answer arriving ten messages
--      later still points at what it answers.
--   2. Reacting to a message, so a shared reel can be acknowledged without
--      sending "haha" as its own message.
--
-- Both hang off a single message, so they land together.
-- ============================================================

-- ── Replies ──────────────────────────────────────────────
-- Self reference. on delete set null rather than cascade: deleting the
-- quoted message must not delete the replies to it — the reply is still a
-- real thing somebody said. The UI renders a null target as "message
-- deleted" instead of vanishing.
alter table public.messages
  add column if not exists reply_to_id uuid
  references public.messages (id) on delete set null;

create index if not exists idx_messages_reply_to
  on public.messages (reply_to_id)
  where reply_to_id is not null;

-- ── Reactions ────────────────────────────────────────────
-- One reaction per person per message: the primary key enforces it, so
-- reacting again replaces rather than accumulates, which is how Instagram
-- and WhatsApp both behave. A set of counted emoji per message would need a
-- different key; this is deliberately the simpler model.
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists idx_message_reactions_message
  on public.message_reactions (message_id);

alter table public.message_reactions enable row level security;

-- Membership is checked through the message's chat. is_chat_member is the
-- security-definer helper from 0018 — calling chat_members directly from a
-- policy is what caused the infinite recursion that migration fixed.
drop policy if exists "reactions read" on public.message_reactions;
create policy "reactions read" on public.message_reactions
  for select to authenticated
  using (
    exists (
      select 1 from public.messages m
       where m.id = message_reactions.message_id
         and public.is_chat_member(m.chat_id)
    )
  );

drop policy if exists "reactions write own" on public.message_reactions;
create policy "reactions write own" on public.message_reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
       where m.id = message_reactions.message_id
         and public.is_chat_member(m.chat_id)
    )
  );

drop policy if exists "reactions update own" on public.message_reactions;
create policy "reactions update own" on public.message_reactions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "reactions delete own" on public.message_reactions;
create policy "reactions delete own" on public.message_reactions
  for delete to authenticated
  using (user_id = auth.uid());

-- ── Toggling a reaction ──────────────────────────────────
-- Tapping the emoji you already picked clears it; tapping a different one
-- swaps it. Doing that as one statement avoids the delete-then-insert round
-- trip and the flicker it causes.
create or replace function public.toggle_message_reaction(p_message_id uuid, p_emoji text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_current text;
begin
  if v_me is null then
    raise exception 'not signed in';
  end if;

  -- Refuse a reaction to a message in a chat you are not in.
  if not exists (
    select 1 from public.messages m
     where m.id = p_message_id and public.is_chat_member(m.chat_id)
  ) then
    raise exception 'not a member of this chat';
  end if;

  select emoji into v_current
    from public.message_reactions
   where message_id = p_message_id and user_id = v_me;

  if v_current is not distinct from p_emoji then
    delete from public.message_reactions
     where message_id = p_message_id and user_id = v_me;
    return null;                       -- same emoji tapped again: cleared
  end if;

  insert into public.message_reactions (message_id, user_id, emoji)
  values (p_message_id, v_me, p_emoji)
  on conflict (message_id, user_id) do update set emoji = excluded.emoji,
                                                  created_at = now();
  return p_emoji;
end;
$$;

revoke all on function public.toggle_message_reaction(uuid, text) from public;
grant execute on function public.toggle_message_reaction(uuid, text) to authenticated;

-- Realtime: without this the other person's reaction only appears on reload.
do $$
begin
  begin
    alter publication supabase_realtime add table public.message_reactions;
  exception
    when duplicate_object then null;   -- already published
    when undefined_object then null;   -- publication absent on this project
  end;
end $$;


-- #############################################################
-- ##  0043_message_requests.sql
-- #############################################################
-- ============================================================
-- 0043_message_requests.sql
--
-- Message requests, the way Instagram does them.
--
-- Until now a DM from a complete stranger landed in the inbox beside the
-- people you actually talk to, with nothing marking it as unsolicited and no
-- way to refuse it short of blocking the sender.
--
-- A conversation is a REQUEST for you when you have not accepted it and you
-- do not follow the other person. Following them is itself consent, so a
-- message from someone you follow is never a request. Sending a reply
-- accepts it, which is what accepting means in practice.
-- ============================================================

alter table public.chat_members
  add column if not exists accepted_at timestamptz;

-- Existing conversations are all already-accepted; without this backfill the
-- whole inbox would move into Requests the moment this is applied.
update public.chat_members
   set accepted_at = coalesce(accepted_at, joined_at)
 where accepted_at is null;

-- ── Which of my chats are requests ────────────────────────
-- Returned for the whole inbox in one call, like chat_unread_counts.
--
-- A chat counts as a request when all of these hold:
--   * I have not accepted it
--   * I follow nobody in it
--   * somebody other than me has actually written something
-- The last condition matters: a chat I created and have not yet used is not
-- a request from anyone, and should not appear in that tab.
create or replace function public.chat_request_flags()
returns table (chat_id uuid, is_request boolean)
language sql
security definer
stable
set search_path = public
as $$
  select cm.chat_id,
         (
           cm.accepted_at is null
           and not exists (
             select 1
               from public.chat_members other
               join public.follows f
                 on f.followed_id = other.user_id
               where other.chat_id = cm.chat_id
                 and other.user_id <> cm.user_id
                 and f.follower_id = cm.user_id
           )
           and exists (
             select 1 from public.messages m
              where m.chat_id = cm.chat_id
                and m.from_user_id <> cm.user_id
           )
         ) as is_request
    from public.chat_members cm
   where cm.user_id = auth.uid();
$$;

revoke all on function public.chat_request_flags() from public;
grant execute on function public.chat_request_flags() to authenticated;

-- ── Accepting ────────────────────────────────────────────
create or replace function public.accept_chat_request(p_chat_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.chat_members
     set accepted_at = now()
   where chat_id = p_chat_id
     and user_id = auth.uid()
     and accepted_at is null;
$$;

revoke all on function public.accept_chat_request(uuid) from public;
grant execute on function public.accept_chat_request(uuid) to authenticated;

-- ── Declining ────────────────────────────────────────────
-- Removes you from the conversation. The other person is not told, which is
-- the point: declining must not be a signal back to a stranger.
create or replace function public.decline_chat_request(p_chat_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.chat_members
   where chat_id = p_chat_id
     and user_id = auth.uid();
$$;

revoke all on function public.decline_chat_request(uuid) from public;
grant execute on function public.decline_chat_request(uuid) to authenticated;

-- ── Replying accepts ─────────────────────────────────────
-- Answering a stranger is acceptance; making people also press a button
-- would be asking twice for the same decision.
create or replace function public.accept_on_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_members
     set accepted_at = now()
   where chat_id = new.chat_id
     and user_id = new.from_user_id
     and accepted_at is null;
  return null;
end;
$$;

drop trigger if exists tr_accept_on_reply on public.messages;
create trigger tr_accept_on_reply
  after insert on public.messages
  for each row execute function public.accept_on_reply();


-- #############################################################
-- ##  0044_profile_required_fields.sql
-- #############################################################
-- ============================================================
-- 0044_profile_required_fields.sql
--
-- An account showed up in "Featured creators" with no name at all — just a
-- coloured circle and a follower count.
--
-- The signup wizard does require a name, but nothing below it did, so any
-- account created by another route (the Supabase dashboard, a seeded row, an
-- older build) landed nameless and every screen faithfully rendered nothing.
--
-- The specific hole: handle_new_user built the name with
--
--   coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1), '')
--
-- and the client sends `name: name || ''`. coalesce only replaces NULL, never
-- an empty string, so '' sailed through every fallback and was stored.
-- ============================================================

-- ── Repair the trigger ───────────────────────────────────
-- nullif(trim(...), '') turns blank into NULL so coalesce can actually do its
-- job, and the chain now ends at a guaranteed non-empty value.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name   text;
  v_handle text;
begin
  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    nullif(trim(split_part(coalesce(new.email, ''), '@', 1)), ''),
    'مستخدم'
  );

  v_handle := coalesce(
    nullif(trim(new.raw_user_meta_data->>'handle'), ''),
    'user_' || substr(replace(new.id::text, '-', ''), 1, 8)
  );

  insert into public.profiles (id, name, handle)
  values (new.id, v_name, v_handle)
  on conflict (id) do nothing;

  return new;
end;
$$;

-- ── Repair the rows already stored ───────────────────────
-- Falls back to the handle, which is always present, rather than inventing
-- anything. These accounts are real; only their display name was lost.
update public.profiles
   set name = coalesce(nullif(trim(handle), ''), 'مستخدم')
 where name is null or trim(name) = '';

update public.profiles
   set handle = 'user_' || substr(replace(id::text, '-', ''), 1, 8)
 where handle is null or trim(handle) = '';

-- ── Stop it happening again ──────────────────────────────
-- Added after the backfill, or the constraint would refuse to validate
-- against the rows it is meant to protect.
alter table public.profiles
  drop constraint if exists profiles_name_not_blank;
alter table public.profiles
  add constraint profiles_name_not_blank
  check (name is not null and length(trim(name)) >= 1);

alter table public.profiles
  drop constraint if exists profiles_handle_not_blank;
alter table public.profiles
  add constraint profiles_handle_not_blank
  check (handle is not null and length(trim(handle)) >= 1);


-- #############################################################
-- ##  0045_call_records_live_alerts.sql
-- #############################################################
-- ============================================================
-- 0045_call_records_live_alerts.sql
--
-- Two things that happened but left no trace.
--
--   1. Calls. You could ring someone, talk, hang up — and the conversation
--      showed nothing. No record of who called, when, whether it connected,
--      or how long it lasted. Every messenger keeps that line in the thread.
--
--   2. Going live. A stream started and nobody was told, so a broadcast was
--      only found by whoever happened to be looking at the live tab.
--
-- Both are written by triggers rather than by the app: whichever side hangs
-- up, and whichever client starts the stream, the record still gets made.
-- ============================================================

-- ── 1. Call records in the conversation ──────────────────

-- 'call' joins the allowed message types. The list is restated in full
-- because a check constraint cannot be added to.
alter table public.messages drop constraint if exists messages_type_check;
alter table public.messages
  add constraint messages_type_check
  check (type in ('text', 'voice', 'image', 'video', 'sticker', 'system',
                  'file', 'location', 'call'));

-- The detail is stored as JSON in `text` rather than in new columns: the app
-- has to render "Video call · 2:34" in Arabic or English, so it needs the
-- parts, not a sentence built in the database that could only be one language.
create or replace function public.record_call_in_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seconds integer := 0;
begin
  -- Only when the call actually reaches a terminal state, and only on the
  -- transition into it — an update that touches something else must not
  -- write a second record.
  if new.status not in ('ended', 'declined', 'missed') then
    return null;
  end if;
  if old.status is not distinct from new.status then
    return null;
  end if;
  if new.chat_id is null then
    return null;   -- a call placed outside a conversation has nowhere to go
  end if;

  if new.status = 'ended' and new.answered_at is not null then
    v_seconds := greatest(0, extract(epoch from (coalesce(new.ended_at, now()) - new.answered_at))::integer);
  end if;

  insert into public.messages (chat_id, from_user_id, type, text)
  values (
    new.chat_id,
    new.caller_id,          -- attributed to whoever placed the call
    'call',
    json_build_object(
      'kind',    new.kind,          -- audio | video
      'status',  new.status,        -- ended | declined | missed
      'seconds', v_seconds
    )::text
  );

  return null;
end;
$$;

drop trigger if exists tr_record_call_in_chat on public.calls;
create trigger tr_record_call_in_chat
  after update on public.calls
  for each row execute function public.record_call_in_chat();

-- ── 2. Telling followers a stream started ────────────────

-- 'live' joins the notification types, again restating the whole list.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('like', 'comment', 'follow', 'mention', 'message',
                  'system', 'live'));

create or replace function public.notify_followers_live()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'live' then
    return null;
  end if;

  -- One row per follower. Blocked people are excluded here rather than
  -- filtered on read, so a block genuinely stops the notification existing.
  insert into public.notifications (user_id, actor_id, type, payload)
  select f.follower_id,
         new.host_id,
         'live',
         json_build_object('live_id', new.id, 'title', coalesce(new.title, ''))
    from public.follows f
   where f.followed_id = new.host_id
     and not exists (
       select 1 from public.blocks b
        where (b.blocker_id = f.follower_id and b.blocked_id = new.host_id)
           or (b.blocker_id = new.host_id and b.blocked_id = f.follower_id)
     );

  return null;
end;
$$;

drop trigger if exists tr_notify_followers_live on public.live_streams;
create trigger tr_notify_followers_live
  after insert on public.live_streams
  for each row execute function public.notify_followers_live();


-- #############################################################
-- ##  0046_live_viewer_count.sql
-- #############################################################
-- ============================================================
-- 0046_live_viewer_count.sql
--
-- The viewer count on a stream was read once when the screen opened and then
-- never moved. A broadcast would sit at "3 watching" for its whole run, which
-- is worse than showing nothing — it looks live and is not.
--
-- Viewers cannot write the number themselves: 0038 restricts updates on
-- live_streams to the host, and rightly so, or anyone could inflate their own
-- audience. These two functions are the only way in, they move the count by
-- exactly one, and they cannot touch anything else on the row.
--
-- This is a counter, not presence. A viewer whose phone dies without firing
-- leave leaves the count one too high until the stream ends. That is the
-- accepted trade in every app that does it this way; real presence needs a
-- heartbeat table and is not worth it here.
-- ============================================================

create or replace function public.join_live_stream(p_live_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  update public.live_streams
     set viewer_count = viewer_count + 1,
         -- The peak is what the host is told afterwards, so it only ever rises.
         viewer_count_max = greatest(viewer_count_max, viewer_count + 1)
   where id = p_live_id
     and status = 'live'
  returning viewer_count into v_count;

  return coalesce(v_count, 0);
end;
$$;

create or replace function public.leave_live_stream(p_live_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.live_streams
     set viewer_count = greatest(viewer_count - 1, 0)   -- never negative
   where id = p_live_id
  returning viewer_count into v_count;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.join_live_stream(uuid)  from public;
revoke all on function public.leave_live_stream(uuid) from public;
grant execute on function public.join_live_stream(uuid)  to authenticated;
grant execute on function public.leave_live_stream(uuid) to authenticated;

-- Realtime on live_streams: without this the count still would not move on
-- anyone else's screen, and viewers would not learn the stream had ended.
do $$
begin
  begin
    alter publication supabase_realtime add table public.live_streams;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;
