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
