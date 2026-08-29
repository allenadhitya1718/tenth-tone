-- ============================================================
--  APPLY_ALL.sql  -  Tenth Tone
--  Everything outstanding, in dependency order, in one file.
--
--  SAFE TO RE-RUN. Every statement uses IF NOT EXISTS,
--  CREATE OR REPLACE, or a preceding DROP ... IF EXISTS, so running
--  it twice (or with some parts already applied) changes nothing.
--
--  HOW TO RUN
--    Supabase dashboard -> SQL Editor -> New query
--    Paste this whole file -> Run
--
--  WHAT IS IN HERE
--    0005  admin wallet writes            (was never applied)
--    0006  self top-up / withdraw         (was never applied)
--    0017  send_gift as one transaction
--    0018  chat policies (fixes messaging)
--    0019  voice / video call signalling
--    0020  file + location message types
--    0021  profile link, private flag, pinned videos
--    0022  gender / country (private table)
--    0023  original sounds + backfill
--    0024  allow comments / allow saving
--    0025  hashtag index + backfill
--    0026  mark notifications as read
--    0027  settings actually save + are enforced
--    0028  hidden words, restrict, mute
--    Last: corrects two coin balances changed during testing
-- ============================================================



-- ============================================================
-- >>> 0005_admin_writes.sql
-- ============================================================

-- ============================================================
-- 0005_admin_writes.sql
-- Lets admins edit other users' profiles, adjust wallet balances,
-- write wallet_transactions ledger entries, and soft-delete users.
-- Apply this in Supabase SQL editor *after* 0001..0004.
-- ============================================================

-- ── profiles: admins can update any row (name, handle, bio, verified, etc.) ──
drop policy if exists "admins update profiles" on public.profiles;
create policy "admins update profiles" on public.profiles
  for update to authenticated
  using (public.is_admin());

-- ── profiles: admins can delete (cascade removes videos, wallet, etc.) ──
drop policy if exists "admins delete profiles" on public.profiles;
create policy "admins delete profiles" on public.profiles
  for delete to authenticated
  using (public.is_admin());

-- ── wallets: admins can upsert/update any balance ──
drop policy if exists "admins update wallets" on public.wallets;
create policy "admins update wallets" on public.wallets
  for update to authenticated
  using (public.is_admin());

drop policy if exists "admins insert wallets" on public.wallets;
create policy "admins insert wallets" on public.wallets
  for insert to authenticated
  with check (public.is_admin());

-- ── wallet_transactions: admins can write ledger entries for any user ──
drop policy if exists "admins insert wallet_tx" on public.wallet_transactions;
create policy "admins insert wallet_tx" on public.wallet_transactions
  for insert to authenticated
  with check (public.is_admin());

-- ============================================================
-- admin_adjust_wallet(user_id, delta, reason)
-- One atomic call that:
--   1. upserts wallets.balance += delta  (clamped to 0)
--   2. writes a wallet_transactions ledger row
--   3. writes an admin_logs row
-- ============================================================
create or replace function public.admin_adjust_wallet(
  p_user_id uuid,
  p_delta   integer,
  p_reason  text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_new_balance integer;
  v_type text;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin only';
  end if;

  -- Upsert wallet row & adjust balance (never below 0)
  insert into public.wallets (user_id, balance) values (p_user_id, greatest(0, p_delta))
    on conflict (user_id) do update
    set balance = greatest(0, public.wallets.balance + p_delta),
        updated_at = now();

  select balance into v_new_balance from public.wallets where user_id = p_user_id;

  -- Pick a ledger type that matches the existing check constraint
  v_type := case when p_delta >= 0 then 'topup' else 'withdrawal' end;

  insert into public.wallet_transactions (user_id, type, amount, description)
  values (p_user_id, v_type, abs(p_delta), coalesce(p_reason, 'تعديل من المشرف'));

  insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
  values (v_admin, 'adjust_wallet', 'user', p_user_id,
          jsonb_build_object('delta', p_delta, 'reason', p_reason, 'new_balance', v_new_balance));

  return v_new_balance;
end;
$$;

grant execute on function public.admin_adjust_wallet(uuid, integer, text) to authenticated;

-- ============================================================
-- admin_user_detail(user_id) → single JSON blob with everything
-- the admin "edit user" modal needs (profile + wallet + counts).
-- ============================================================
create or replace function public.admin_user_detail(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin only';
  end if;

  select jsonb_build_object(
    'profile', to_jsonb(p),
    'wallet',  (select to_jsonb(w) from public.wallets w where w.user_id = p.id),
    'video_count', (select count(*) from public.videos v where v.user_id = p.id),
    'recent_videos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'thumbnail', v.thumbnail, 'video_url', v.video_url,
        'description', v.description, 'likes_count', v.likes_count,
        'views_count', v.views_count, 'created_at', v.created_at,
        'is_draft', v.is_draft
      ) order by v.created_at desc), '[]'::jsonb)
      from (select * from public.videos where user_id = p.id order by created_at desc limit 6) v
    ),
    'recent_logs', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'action', al.action, 'created_at', al.created_at, 'payload', al.payload,
        'admin', (select jsonb_build_object('name', ap.name, 'handle', ap.handle)
                  from public.profiles ap where ap.id = al.admin_id)
      ) order by al.created_at desc), '[]'::jsonb)
      from (select * from public.admin_logs where target_type='user' and target_id = p.id
            order by created_at desc limit 8) al
    )
  )
  into v_result
  from public.profiles p
  where p.id = p_user_id;

  return v_result;
end;
$$;

grant execute on function public.admin_user_detail(uuid) to authenticated;


-- ============================================================
-- >>> 0006_self_service.sql
-- ============================================================

-- ============================================================
-- 0006_self_service.sql
-- Wires up the remaining user-facing stubs:
--   * profiles.is_private flag (toggle from Settings)
--   * self-service wallet topup / withdraw
--   * self-service account deletion
-- Apply this in Supabase SQL editor AFTER 0001..0005.
-- ============================================================

-- ── Private-account flag ──
alter table public.profiles
  add column if not exists is_private boolean not null default false;

-- ============================================================
-- self_topup(amount, package) → credits the caller's wallet
-- In production this would be called from a Stripe / Apple-IAP
-- webhook after payment confirmation. For now it's exposed to the
-- client so the demo "Top-up" sheet actually credits coins.
-- ============================================================
create or replace function public.self_topup(
  p_amount  integer,
  p_package text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_new_balance integer;
begin
  if v_me is null then raise exception 'must be signed in'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  if p_amount > 100000 then raise exception 'amount too large for a single topup'; end if;

  insert into public.wallets (user_id, balance) values (v_me, p_amount)
    on conflict (user_id) do update
    set balance = public.wallets.balance + p_amount,
        updated_at = now();

  select balance into v_new_balance from public.wallets where user_id = v_me;

  insert into public.wallet_transactions (user_id, type, amount, description)
  values (v_me, 'topup', p_amount, coalesce('شحن — ' || p_package, 'شحن'));

  return v_new_balance;
end;
$$;

grant execute on function public.self_topup(integer, text) to authenticated;

-- ============================================================
-- self_withdraw(amount, method) → debits caller's wallet,
-- records a withdrawal ledger row. (Real payout happens off-system.)
-- ============================================================
create or replace function public.self_withdraw(
  p_amount integer,
  p_method text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_balance integer;
begin
  if v_me is null then raise exception 'must be signed in'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;

  select balance into v_balance from public.wallets where user_id = v_me;
  if coalesce(v_balance, 0) < p_amount then raise exception 'الرصيد غير كافٍ'; end if;
  if p_amount < 100 then raise exception 'الحد الأدنى للسحب 100 عملة'; end if;

  update public.wallets set balance = balance - p_amount, updated_at = now() where user_id = v_me;
  select balance into v_balance from public.wallets where user_id = v_me;

  insert into public.wallet_transactions (user_id, type, amount, description)
  values (v_me, 'withdrawal', p_amount, coalesce('سحب — ' || p_method, 'سحب'));

  return v_balance;
end;
$$;

grant execute on function public.self_withdraw(integer, text) to authenticated;

-- ============================================================
-- self_delete_account() → permanently deletes the caller's profile
-- and everything that cascades from it (videos, comments, wallet, etc.)
-- The auth.users row is NOT deleted here — that requires the service-
-- role key. The user is effectively dead in-app, but their auth login
-- remains until an admin / Edge Function clears it. (Future work.)
-- ============================================================
create or replace function public.self_delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'must be signed in'; end if;
  delete from public.profiles where id = v_me;
end;
$$;

grant execute on function public.self_delete_account() to authenticated;


-- ============================================================
-- >>> 0017_send_gift_rpc.sql
-- ============================================================

-- ============================================================
-- 0017_send_gift_rpc.sql
-- Moves gift sending from the browser into a single database
-- transaction.
--
-- The old client-side version (API.sendGift in web/js/db.js) had two
-- problems:
--   1. It read the balance, checked it, then wrote — as separate calls.
--      Two gifts sent at the same moment could both pass the check and
--      overspend the wallet.
--   2. Regular users have no INSERT/UPDATE policy on `wallets` or
--      `wallet_transactions` (only admins do), and the code never checked
--      those calls for errors. So for a normal user the gift row was
--      created but no coins ever moved — silently.
--
-- send_gift() runs as security definer, so it can move coins without
-- opening the wallet tables up to the client, and `for update` locks the
-- sender's row so concurrent gifts queue instead of racing.
--
-- Apply in the Supabase SQL editor AFTER 0001..0016.
-- ============================================================

create or replace function public.send_gift(
  p_to_user_id     uuid,
  p_gift_id        text,
  p_live_stream_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_price   integer;
  v_name    text;
  v_balance integer;
  v_tx      uuid;
begin
  if v_me is null then raise exception 'must be signed in'; end if;
  if p_to_user_id is null then raise exception 'recipient required'; end if;
  if p_to_user_id = v_me then raise exception 'cannot send a gift to yourself'; end if;

  select price, name into v_price, v_name from public.gifts where id = p_gift_id;
  if v_price is null then raise exception 'gift not found'; end if;
  if v_price <= 0 then raise exception 'invalid gift price'; end if;

  -- Make sure the sender has a wallet row, then lock it. The lock is what
  -- makes this safe: a second concurrent send_gift() waits here until this
  -- transaction commits, so it sees the already-reduced balance.
  insert into public.wallets (user_id, balance) values (v_me, 0)
    on conflict (user_id) do nothing;

  select balance into v_balance from public.wallets where user_id = v_me for update;

  if v_balance < v_price then
    raise exception 'insufficient balance';
  end if;

  update public.wallets
     set balance = balance - v_price, updated_at = now()
   where user_id = v_me;

  insert into public.wallets (user_id, balance) values (p_to_user_id, v_price)
    on conflict (user_id) do update
    set balance = public.wallets.balance + v_price,
        updated_at = now();

  insert into public.gift_transactions (from_user_id, to_user_id, gift_id, live_stream_id, amount)
  values (v_me, p_to_user_id, p_gift_id, p_live_stream_id, v_price)
  returning id into v_tx;

  insert into public.wallet_transactions (user_id, type, amount, reference, description)
  values (v_me,          'gift_sent',     v_price, v_tx, v_name),
         (p_to_user_id,  'gift_received', v_price, v_tx, v_name);

  return v_tx;
end;
$$;

revoke all on function public.send_gift(uuid, text, uuid) from public;
grant execute on function public.send_gift(uuid, text, uuid) to authenticated;

-- Let people see the gifts they sent or received (previously admin-only,
-- so the wallet screen could never show a user their own gift history).
alter table public.gift_transactions enable row level security;
drop policy if exists "gift_tx own read" on public.gift_transactions;
create policy "gift_tx own read" on public.gift_transactions
  for select to authenticated
  using (from_user_id = auth.uid() or to_user_id = auth.uid());


-- ============================================================
-- >>> 0018_fix_chat_policies.sql
-- ============================================================

-- ============================================================
-- 0018_fix_chat_policies.sql
-- Fixes messaging, which was completely broken.
--
-- Two problems:
--
-- 1. INFINITE RECURSION. The read policy on chat_members ran a subquery
--    against chat_members, so Postgres re-evaluated the same policy forever:
--      "infinite recursion detected in policy for relation chat_members"
--    Opening any DM failed with that error.
--
-- 2. NO INSERT POLICY. chat_members had only SELECT policies, so nobody
--    (except via admin policies) could ever add a member to a chat. Creating
--    a DM or a group could not work.
--
-- The fix is a security-definer helper. Because it runs as the definer it
-- does NOT re-trigger the caller's RLS, which breaks the recursion loop.
--
-- Apply in the Supabase SQL editor AFTER 0001..0017.
-- ============================================================

-- ── Helpers ──────────────────────────────────────────────
create or replace function public.is_chat_member(p_chat_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.chat_members
     where chat_id = p_chat_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_chat_creator(p_chat_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.chats
     where id = p_chat_id and created_by = auth.uid()
  );
$$;

revoke all on function public.is_chat_member(uuid)  from public;
revoke all on function public.is_chat_creator(uuid) from public;
grant execute on function public.is_chat_member(uuid)  to authenticated;
grant execute on function public.is_chat_creator(uuid) to authenticated;

-- ── chat_members ─────────────────────────────────────────
-- Read: your own row, or any row in a chat you belong to (via the helper,
-- so no recursion).
drop policy if exists "chat_members self read" on public.chat_members;
create policy "chat_members self read" on public.chat_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_chat_member(chat_id));

-- Insert: the person who created the chat may add members (including
-- themselves). This is what makes "New chat" and "New group" work at all.
drop policy if exists "chat_members insert by creator" on public.chat_members;
create policy "chat_members insert by creator" on public.chat_members
  for insert to authenticated
  with check (public.is_chat_creator(chat_id));

-- Delete: leave a chat yourself, or be removed by the chat's creator.
drop policy if exists "chat_members delete" on public.chat_members;
create policy "chat_members delete" on public.chat_members
  for delete to authenticated
  using (user_id = auth.uid() or public.is_chat_creator(chat_id));

-- ── chats ────────────────────────────────────────────────
drop policy if exists "chats members read" on public.chats;
create policy "chats members read" on public.chats
  for select to authenticated
  using (created_by = auth.uid() or public.is_chat_member(id));

-- Group name / photo edits by the creator.
drop policy if exists "chats update by creator" on public.chats;
create policy "chats update by creator" on public.chats
  for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- ── messages ─────────────────────────────────────────────
drop policy if exists "messages members read" on public.messages;
create policy "messages members read" on public.messages
  for select to authenticated
  using (public.is_chat_member(chat_id));

drop policy if exists "messages members insert" on public.messages;
create policy "messages members insert" on public.messages
  for insert to authenticated
  with check (auth.uid() = from_user_id and public.is_chat_member(chat_id));

drop policy if exists "messages delete own" on public.messages;
create policy "messages delete own" on public.messages
  for delete to authenticated
  using (auth.uid() = from_user_id);


-- ============================================================
-- >>> 0019_calls.sql
-- ============================================================

-- ============================================================
-- 0019_calls.sql
-- Voice / video calling: the signalling layer.
--
-- Agora carries the actual audio and video, but it has no concept of
-- "ringing" - it can only connect two people who both join the same
-- channel. This table is what tells the other person a call is coming,
-- and lets either side accept, decline or hang up.
--
-- Deliberately independent of Agora: everything here works before an
-- Agora App ID exists, so the whole flow can be built and tested now.
--
-- Apply in the Supabase SQL editor AFTER 0001..0018.
-- ============================================================

create table if not exists public.calls (
  id           uuid primary key default uuid_generate_v4(),
  caller_id    uuid not null references public.profiles (id) on delete cascade,
  callee_id    uuid not null references public.profiles (id) on delete cascade,
  chat_id      uuid references public.chats (id) on delete set null,
  kind         text not null default 'audio' check (kind in ('audio', 'video')),
  -- ringing  : caller has dialled, callee has not answered yet
  -- accepted : callee picked up, both sides join the channel
  -- declined : callee rejected
  -- missed   : nobody answered before the timeout
  -- ended    : call finished normally, or caller cancelled
  status       text not null default 'ringing'
               check (status in ('ringing', 'accepted', 'declined', 'missed', 'ended')),
  -- Agora channel name. Generated up front so both sides agree on it
  -- without another round trip.
  channel      text not null,
  created_at   timestamptz not null default now(),
  answered_at  timestamptz,
  ended_at     timestamptz
);

create index if not exists idx_calls_callee_status on public.calls (callee_id, status, created_at desc);
create index if not exists idx_calls_caller        on public.calls (caller_id, created_at desc);

alter table public.calls enable row level security;

-- Either participant can see the call.
drop policy if exists "calls read own" on public.calls;
create policy "calls read own" on public.calls
  for select to authenticated
  using (caller_id = auth.uid() or callee_id = auth.uid());

-- You can only start a call as yourself, and not to yourself.
drop policy if exists "calls insert as caller" on public.calls;
create policy "calls insert as caller" on public.calls
  for insert to authenticated
  with check (caller_id = auth.uid() and callee_id <> auth.uid());

-- Either side can update (accept / decline / hang up).
drop policy if exists "calls update participant" on public.calls;
create policy "calls update participant" on public.calls
  for update to authenticated
  using (caller_id = auth.uid() or callee_id = auth.uid())
  with check (caller_id = auth.uid() or callee_id = auth.uid());

-- Realtime: the callee's device listens for inserts, and both sides listen
-- for status changes on their own call.
-- Guarded: re-running this file must not fail if the table is already
-- published for realtime.
do $pub$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'calls'
  ) then
    alter publication supabase_realtime add table public.calls;
  end if;
end
$pub$;


-- ============================================================
-- >>> 0020_message_attachments.sql
-- ============================================================

-- ============================================================
-- 0020_message_attachments.sql
-- Adds two message kinds so the chat attachment menu can send more
-- than photos and videos:
--
--   file      - documents (PDF, Word, zip, ...). attachment_url points at
--               the uploaded file; `text` carries the original filename so
--               the bubble can show it.
--   location  - a shared place. `text` holds a maps link, so even a client
--               that does not understand the type still shows something
--               useful instead of an empty bubble.
--
-- Camera and Gallery need no schema change - they reuse image/video.
--
-- Apply in the Supabase SQL editor AFTER 0001..0019.
-- ============================================================

alter table public.messages drop constraint if exists messages_type_check;

alter table public.messages
  add constraint messages_type_check
  check (type in ('text', 'voice', 'image', 'video', 'sticker', 'system', 'file', 'location'));


-- ============================================================
-- >>> 0021_profile_extras.sql
-- ============================================================

-- ============================================================
-- 0021_profile_extras.sql
-- Profile page additions:
--   * profiles.link       - "link in bio" (creators expect this)
--   * profiles.is_private - private-account flag. This was originally in
--                           0006_self_service.sql, which was never applied
--                           to this database, so it is repeated here with
--                           "if not exists" - safe either way.
--   * videos.is_pinned    - pin up to 3 videos to the top of a profile,
--                           the way TikTok does.
--
-- Apply in the Supabase SQL editor AFTER 0001..0020.
-- ============================================================

alter table public.profiles add column if not exists link       text;
alter table public.profiles add column if not exists is_private boolean not null default false;

alter table public.videos   add column if not exists is_pinned  boolean not null default false;

-- Pinned videos are read on every profile visit, so index the lookup.
create index if not exists idx_videos_pinned
  on public.videos (user_id, is_pinned, created_at desc)
  where is_pinned = true;

-- ── Cap pinning at 3 per user ──
-- Enforced in the database so the client cannot exceed it, whatever the UI does.
create or replace function public.enforce_pin_limit()
returns trigger
language plpgsql
as $$
begin
  if new.is_pinned and (tg_op = 'INSERT' or old.is_pinned is distinct from new.is_pinned) then
    if (select count(*) from public.videos
         where user_id = new.user_id and is_pinned = true and id <> new.id) >= 3 then
      raise exception 'pin limit reached';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tr_enforce_pin_limit on public.videos;
create trigger tr_enforce_pin_limit
  before insert or update of is_pinned on public.videos
  for each row execute function public.enforce_pin_limit();


-- ============================================================
-- >>> 0022_user_private.sql
-- ============================================================

-- ============================================================
-- 0022_user_private.sql
-- Gender and country.
--
-- These deliberately do NOT go on public.profiles. That table's read policy
-- is `for select to authenticated, anon using (true)` - literally everyone,
-- signed in or not, can read every column of it. Personal details belong in
-- their own table, readable only by the owner (and admins, for moderation).
--
-- NOTE: date of birth is intentionally not stored here. An age gate is still
-- required by both app stores before launch - it will need its own home.
--
-- Apply in the Supabase SQL editor AFTER 0001..0021.
-- ============================================================

create table if not exists public.user_private (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  gender      text check (gender in ('male', 'female', 'other', 'undisclosed')),
  country     text,          -- ISO 3166-1 alpha-2, e.g. 'SA'
  updated_at  timestamptz not null default now()
);

alter table public.user_private enable row level security;

drop policy if exists "user_private own" on public.user_private;
create policy "user_private own" on public.user_private
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "user_private admin read" on public.user_private;
create policy "user_private admin read" on public.user_private
  for select to authenticated
  using (public.is_admin());

create or replace function public.touch_user_private()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tr_touch_user_private on public.user_private;
create trigger tr_touch_user_private
  before insert or update on public.user_private
  for each row execute function public.touch_user_private();


-- ============================================================
-- >>> 0023_original_sounds.sql
-- ============================================================

-- ============================================================
-- 0023_original_sounds.sql
-- Makes "original sounds" real.
--
-- The sounds table existed and videos already had sound_id, but nothing
-- ever created a sound, so the only rows were four seeded placeholders
-- with no audio behind them. This migration:
--   * links a sound back to the person and video it came from
--   * keeps usage_count accurate via a trigger instead of a stored guess
--   * adds sound favourites
--   * clears out the placeholder rows
--
-- No music licensing is involved: an original sound is the audio of a
-- user's own video, which is their content.
--
-- Apply in the Supabase SQL editor AFTER 0001..0022.
-- ============================================================

alter table public.sounds add column if not exists created_by      uuid references public.profiles (id) on delete set null;
alter table public.sounds add column if not exists origin_video_id uuid references public.videos   (id) on delete set null;
alter table public.sounds add column if not exists is_original     boolean not null default true;

create index if not exists idx_sounds_usage on public.sounds (usage_count desc, created_at desc);

-- Only the creator may edit or remove their own sound.
drop policy if exists "sounds update own" on public.sounds;
create policy "sounds update own" on public.sounds
  for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());

drop policy if exists "sounds delete own" on public.sounds;
create policy "sounds delete own" on public.sounds
  for delete to authenticated using (created_by = auth.uid());

-- ── usage_count follows reality ──
create or replace function public.sync_sound_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('DELETE', 'UPDATE') and old.sound_id is not null then
    update public.sounds set usage_count = greatest(usage_count - 1, 0) where id = old.sound_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.sound_id is not null then
    update public.sounds set usage_count = usage_count + 1 where id = new.sound_id;
  end if;
  return null;
end;
$$;

drop trigger if exists tr_sync_sound_usage on public.videos;
create trigger tr_sync_sound_usage
  after insert or update of sound_id or delete on public.videos
  for each row execute function public.sync_sound_usage();

-- ── Favourites ──
create table if not exists public.sound_favorites (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  sound_id   uuid not null references public.sounds   (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, sound_id)
);

alter table public.sound_favorites enable row level security;

drop policy if exists "sound_favorites own" on public.sound_favorites;
create policy "sound_favorites own" on public.sound_favorites
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Clear the placeholder sounds ──
-- They had no audio_url and showed as "trending" with zero videos.
update public.videos set sound_id = null
 where sound_id in ('11111111-1111-1111-1111-111111111111',
                    '22222222-2222-2222-2222-222222222222',
                    '33333333-3333-3333-3333-333333333333',
                    '44444444-4444-4444-4444-444444444444');

delete from public.sounds
 where id in ('11111111-1111-1111-1111-111111111111',
              '22222222-2222-2222-2222-222222222222',
              '33333333-3333-3333-3333-333333333333',
              '44444444-4444-4444-4444-444444444444');

-- Recount anything left, so no fabricated numbers survive.
update public.sounds s
   set usage_count = (select count(*) from public.videos v where v.sound_id = s.id);

-- ── Backfill: give every existing public video an original sound ──
-- Without this, videos posted before this change have no sound, so the music
-- disc in the feed has nothing to open. Their `music` column held seeded
-- fake song titles ("هزّة - سارة"), which are replaced by the real creator.
with created as (
  insert into public.sounds (title, author_name, audio_url, cover_url, duration,
                             created_by, origin_video_id, is_original)
  select 'صوت أصلي',
         coalesce(nullif(p.name, ''), p.handle, ''),
         v.video_url,
         v.thumbnail,
         30,
         v.user_id,
         v.id,
         true
    from public.videos v
    join public.profiles p on p.id = v.user_id
   where v.sound_id is null
     and v.is_draft = false
  returning id, origin_video_id, author_name
)
update public.videos v
   set sound_id = c.id,
       music    = 'صوت أصلي - ' || c.author_name
  from created c
 where v.id = c.origin_video_id;

-- Recount again now the backfill has linked everything.
update public.sounds s
   set usage_count = (select count(*) from public.videos v where v.sound_id = s.id);


-- ============================================================
-- >>> 0024_post_settings.sql
-- ============================================================

-- ============================================================
-- 0024_post_settings.sql
-- Makes the post screen's "Allow comments" and "Allow saving" toggles real.
--
-- They existed in the UI but nothing stored or enforced them - the columns
-- did not exist and no code read them, so flipping either did nothing.
--
-- Storing the flag is not enough: the rules below stop a comment or save
-- being written at the database level, so turning them off cannot be
-- bypassed by calling the API directly.
--
-- Apply in the Supabase SQL editor AFTER 0001..0023.
-- ============================================================

alter table public.videos add column if not exists allow_comments boolean not null default true;
alter table public.videos add column if not exists allow_saving   boolean not null default true;

-- ── Comments respect allow_comments ──
drop policy if exists "comments insert own" on public.comments;
create policy "comments insert own" on public.comments
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.videos v
       where v.id = comments.video_id
         and v.allow_comments = true
    )
  );

-- ── Saves respect allow_saving ──
drop policy if exists "saves own write" on public.saves;
create policy "saves own write" on public.saves
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.videos v
       where v.id = saves.video_id
         and v.allow_saving = true
    )
  );

-- Removing your own save must always be allowed, even if the creator has
-- since turned saving off.
drop policy if exists "saves own delete" on public.saves;
create policy "saves own delete" on public.saves
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "saves own read" on public.saves;
create policy "saves own read" on public.saves
  for select to authenticated using (auth.uid() = user_id);


-- ============================================================
-- >>> 0025_hashtag_index.sql
-- ============================================================

-- ============================================================
-- 0025_hashtag_index.sql
-- Turns hashtags from a text search into a real index.
--
-- Before: tapping #travel ran `description LIKE '%#travel%'`. That matches
-- #travelling too, cannot use an index, and gets slower with every video.
-- The hashtags table existed but was only used to render the trending list.
--
-- This adds a join table so a tag lookup is exact and indexed, keeps it in
-- sync with captions via the existing trigger, and backfills what is already
-- posted.
--
-- Apply in the Supabase SQL editor AFTER 0001..0024.
-- ============================================================

create table if not exists public.video_hashtags (
  video_id uuid not null references public.videos   (id) on delete cascade,
  tag      text not null references public.hashtags (tag) on delete cascade,
  primary key (video_id, tag)
);

create index if not exists idx_video_hashtags_tag on public.video_hashtags (tag);

alter table public.video_hashtags enable row level security;

drop policy if exists "video_hashtags read" on public.video_hashtags;
create policy "video_hashtags read" on public.video_hashtags
  for select to authenticated, anon using (true);
-- Writes happen only through the trigger below (security definer).

-- ── Keep hashtags AND video_hashtags in sync with captions ──
-- Replaces the function added in 0016, which only maintained usage_count.
create or replace function public.sync_hashtags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
begin
  if tg_op in ('DELETE', 'UPDATE') then
    delete from public.video_hashtags where video_id = old.id;
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.description is not null then
    for t in
      select distinct lower(m[1])
        from regexp_matches(new.description, '#([^\s#]{1,60})', 'g') m
    loop
      insert into public.hashtags (tag, usage_count) values (t, 0)
        on conflict (tag) do nothing;
      insert into public.video_hashtags (video_id, tag) values (new.id, t)
        on conflict do nothing;
    end loop;
  end if;

  -- usage_count follows the join table rather than being incremented blindly,
  -- so it can never drift out of step with reality.
  update public.hashtags h
     set usage_count = (select count(*) from public.video_hashtags vh where vh.tag = h.tag),
         updated_at  = now()
   where h.tag in (
     select tag from public.video_hashtags where video_id = coalesce(new.id, old.id)
     union
     select tag from public.hashtags
   );

  return null;
end;
$$;

drop trigger if exists tr_sync_hashtags on public.videos;
create trigger tr_sync_hashtags
  after insert or update of description or delete on public.videos
  for each row execute function public.sync_hashtags();

-- ── Backfill from captions already posted ──
insert into public.hashtags (tag, usage_count)
select distinct lower(m[1]), 0
  from public.videos v,
       lateral regexp_matches(v.description, '#([^\s#]{1,60})', 'g') m
 where v.description is not null
on conflict (tag) do nothing;

insert into public.video_hashtags (video_id, tag)
select distinct v.id, lower(m[1])
  from public.videos v,
       lateral regexp_matches(v.description, '#([^\s#]{1,60})', 'g') m
 where v.description is not null
on conflict do nothing;

update public.hashtags h
   set usage_count = (select count(*) from public.video_hashtags vh where vh.tag = h.tag);

-- Drop tags that no longer appear in any caption.
delete from public.hashtags h
 where not exists (select 1 from public.video_hashtags vh where vh.tag = h.tag);




-- ============================================================
-- >>> 0026_notifications_read.sql
-- ============================================================

-- ============================================================
-- 0026_notifications_read.sql
-- Lets people mark their own notifications as read.
--
-- public.notifications had only a SELECT policy ("notifications own"),
-- so setting read_at was silently rejected - the update returned no
-- error but affected zero rows. That is why the unread badge could
-- never clear, and why nothing in the app ever tried.
--
-- Apply in the Supabase SQL editor AFTER 0001..0025.
-- ============================================================

drop policy if exists "notifications own update" on public.notifications;
create policy "notifications own update" on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Clearing your own notification list is a normal thing to want.
drop policy if exists "notifications own delete" on public.notifications;
create policy "notifications own delete" on public.notifications
  for delete to authenticated
  using (user_id = auth.uid());

-- Unread lookups run on every screen that shows the bell badge.
create index if not exists idx_notifs_unread
  on public.notifications (user_id, created_at desc)
  where read_at is null;




-- ============================================================
-- >>> 0027_user_settings.sql
-- ============================================================

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




-- ============================================================
-- >>> 0028_moderation_tools.sql
-- ============================================================

-- ============================================================
-- 0028_moderation_tools.sql
-- Hidden words, Restrict, and Mute.
--
-- Until now the only defence against a bad comment was reporting it after
-- the fact, and the only way to deal with a person was a full block - which
-- is confrontational, visible, and so people avoid using it.
--
--   hidden_words     - comments containing these are filtered out for you
--   restricted_users - their comments on your videos are visible only to
--                      them; they cannot tell. They also cannot DM you.
--   muted_users      - their videos stop appearing in your feed, without
--                      unfollowing them
--
-- Apply in the Supabase SQL editor AFTER 0001..0027.
-- ============================================================
-- ============================================================

-- ── Hidden words ──
create table if not exists public.hidden_words (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  word       text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, word)
);

alter table public.hidden_words enable row level security;

drop policy if exists "hidden_words own" on public.hidden_words;
create policy "hidden_words own" on public.hidden_words
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ── Restricted accounts ──
create table if not exists public.restricted_users (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  restricted_id uuid not null references public.profiles (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, restricted_id),
  constraint restrict_not_self check (user_id <> restricted_id)
);

create index if not exists idx_restricted_by on public.restricted_users (restricted_id);

alter table public.restricted_users enable row level security;

-- Deliberately readable only by the person who set it: the whole point of
-- Restrict is that the restricted person cannot tell.
drop policy if exists "restricted own" on public.restricted_users;
create policy "restricted own" on public.restricted_users
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ── Muted accounts ──
create table if not exists public.muted_users (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  muted_id   uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, muted_id),
  constraint mute_not_self check (user_id <> muted_id)
);

alter table public.muted_users enable row level security;

drop policy if exists "muted own" on public.muted_users;
create policy "muted own" on public.muted_users
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ── Restrict blocks direct messages too ──
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

  -- A restricted person cannot start a conversation with you.
  if exists (select 1 from public.restricted_users
              where user_id = p_target and restricted_id = p_actor) then
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


-- ── The feed skips muted people ──
-- Same function as 0013 with one extra exclusion. Everything else is
-- unchanged.
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
      and (p.banned_until is null or p.banned_until <= now())
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


-- ============================================================
-- >>> Correct two coin balances
-- Changed while testing the gift transfer; these restore the
-- original values. Harmless if they are already correct.
-- ============================================================

update public.wallets set balance = 100,  updated_at = now()
 where user_id = 'fc1c61d1-5fa1-4224-8e21-f92697c8bdb3';
update public.wallets set balance = 1000, updated_at = now()
 where user_id = '392702a5-9566-42f0-b951-0ca75ceec680';


-- ============================================================
-- >>> 0029_settings_expansion.sql
-- ============================================================

-- ============================================================
-- 0029_settings_expansion.sql
--
-- Backing for the settings areas that had no storage behind them:
--
--   videos.is_archived    - hide a post from your profile without deleting it
--   close_friends         - a smaller audience than "followers"
--   data_export_requests  - "download your data", queued for an operator
--   user_settings.*       - activity-status and tagging preferences
--
-- Apply in the Supabase SQL editor AFTER 0001..0028.
-- ============================================================

-- ── Archive ──
-- Separate from is_hidden, which is moderation taking a post down. Archiving
-- is the author's own choice and they can undo it.
alter table public.videos
  add column if not exists is_archived boolean not null default false;

create index if not exists idx_videos_owner_archived
  on public.videos (user_id, is_archived, created_at desc);


-- ── Close friends ──
create table if not exists public.close_friends (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  friend_id  uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  constraint close_friend_not_self check (user_id <> friend_id)
);

alter table public.close_friends enable row level security;

-- Only the owner of the list may read it. Nobody is told they are on it,
-- which is the same promise Instagram makes.
drop policy if exists "close_friends own" on public.close_friends;
create policy "close_friends own" on public.close_friends
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ── Download your data ──
create table if not exists public.data_export_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending', 'ready', 'failed')),
  file_url     text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_export_user on public.data_export_requests (user_id, requested_at desc);

alter table public.data_export_requests enable row level security;

drop policy if exists "exports own read" on public.data_export_requests;
create policy "exports own read" on public.data_export_requests
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "exports own insert" on public.data_export_requests;
create policy "exports own insert" on public.data_export_requests
  for insert to authenticated with check (user_id = auth.uid());

-- One open request at a time, so repeated taps do not queue a pile of work.
create unique index if not exists idx_export_one_pending
  on public.data_export_requests (user_id)
  where status = 'pending';


-- ── Extra preferences ──
alter table public.user_settings
  add column if not exists show_activity_status boolean not null default true;

alter table public.user_settings
  add column if not exists who_can_tag text not null default 'everyone';

do $tag$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_settings_who_can_tag_check'
  ) then
    alter table public.user_settings
      add constraint user_settings_who_can_tag_check
      check (who_can_tag in ('everyone', 'following', 'nobody'));
  end if;
end
$tag$;


-- ── Archived posts stay out of the feed ──
-- Identical to 0028 apart from the is_archived exclusion.
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


-- ============================================================
-- >>> 0030_private_accounts.sql
-- ============================================================

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


-- ============================================================
-- >>> 0031_upload_quotas.sql
-- ============================================================

-- ============================================================
-- 0031_upload_quotas.sql
--
-- Makes the storage bill a number you choose rather than one that
-- happens to you.
--
-- Neither Cloudflare nor Supabase offers a hard spending cap, so the
-- ceiling has to live where the bytes come from: this app. Nothing
-- reaches storage except through an upload, and every upload now passes
-- a quota check enforced by a storage policy - not by client code that
-- could be bypassed.
--
--   app_limits            - one row of tunable ceilings
--   within_upload_quota() - the gate, called from the storage policy
--   storage_used_bytes()  - what is actually stored right now
--
-- Set global_max_bytes below your provider's free allowance and the bill
-- is structurally zero: uploads start failing before you ever cross it.
--
-- Apply in the Supabase SQL editor AFTER 0001..0030.
-- ============================================================

-- ── Tunable limits, one row ──
create table if not exists public.app_limits (
  id                 smallint primary key default 1 check (id = 1),

  -- A 90-second clip lands near 10-15 MB after compression, so 60 MB is
  -- generous for a real upload and a third of the old headroom for abuse.
  max_video_bytes    bigint  not null default 62914560,      -- 60 MB

  -- Per person, per day.
  user_daily_uploads integer not null default 20,
  user_daily_bytes   bigint  not null default 524288000,     -- 500 MB

  -- The whole point: total stored bytes across every bucket. 9 GB sits
  -- inside both the Supabase and Cloudflare R2 free allowances, so while
  -- this stands the storage bill cannot leave zero. Raise it deliberately
  -- when you decide to spend.
  global_max_bytes   bigint  not null default 9663676416,    -- 9 GB

  updated_at         timestamptz not null default now()
);

insert into public.app_limits (id) values (1) on conflict (id) do nothing;

alter table public.app_limits enable row level security;

-- Readable by everyone signed in, so the app can show remaining quota.
-- Writable only by admins.
drop policy if exists "app_limits read" on public.app_limits;
create policy "app_limits read" on public.app_limits
  for select to authenticated using (true);

drop policy if exists "app_limits admin write" on public.app_limits;
create policy "app_limits admin write" on public.app_limits
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));


-- ── What is actually stored ──
-- Reads storage.objects directly, so it measures reality rather than a
-- counter that can drift out of step with the files.
create or replace function public.storage_used_bytes()
returns bigint
language sql
security definer
stable
set search_path = public, storage
as $fn$
  select coalesce(sum((metadata->>'size')::bigint), 0)::bigint
  from storage.objects;
$fn$;

grant execute on function public.storage_used_bytes() to authenticated;


-- ── One person's uploads today ──
-- Video paths are videos/<user_id>/..., so the owner is the first folder.
create or replace function public.user_uploads_today(p_user uuid)
returns table (upload_count integer, upload_bytes bigint)
language sql
security definer
stable
set search_path = public, storage
as $fn$
  select
    count(*)::integer,
    coalesce(sum((metadata->>'size')::bigint), 0)::bigint
  from storage.objects
  where bucket_id in ('videos', 'chat-media')
    and (storage.foldername(name))[1] = p_user::text
    and created_at >= date_trunc('day', now());
$fn$;

grant execute on function public.user_uploads_today(uuid) to authenticated;


-- ── The gate ──
-- Called from the storage insert policy, so it holds even if someone talks
-- to the storage API directly with the public key.
--
-- The size of the file being uploaded is not known here - Supabase fills in
-- metadata after the row lands - so this measures usage BEFORE this file.
-- The overshoot is therefore capped at one file, which max_video_bytes
-- bounds anyway.
create or replace function public.within_upload_quota(p_user uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public, storage
as $fn$
declare
  v_lim   public.app_limits%rowtype;
  v_count integer;
  v_bytes bigint;
  v_total bigint;
begin
  if p_user is null then return false; end if;

  select * into v_lim from public.app_limits where id = 1;
  if not found then return true; end if;   -- unconfigured means unrestricted

  -- Admins are exempt, so a full disk never locks the operators out.
  if exists (select 1 from public.profiles where id = p_user and is_admin) then
    return true;
  end if;

  select upload_count, upload_bytes into v_count, v_bytes
  from public.user_uploads_today(p_user);

  if v_count >= v_lim.user_daily_uploads then return false; end if;
  if v_bytes >= v_lim.user_daily_bytes  then return false; end if;

  v_total := public.storage_used_bytes();
  if v_total >= v_lim.global_max_bytes then return false; end if;

  return true;
end;
$fn$;

grant execute on function public.within_upload_quota(uuid) to authenticated;


-- ── Tell the app why an upload would fail, before it tries ──
-- The policy can only say yes or no; this explains which ceiling was hit so
-- the person gets a real message instead of a generic refusal.
create or replace function public.upload_quota_status()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, storage
as $fn$
declare
  v_me    uuid := auth.uid();
  v_lim   public.app_limits%rowtype;
  v_count integer;
  v_bytes bigint;
  v_total bigint;
  v_reason text := null;
begin
  if v_me is null then return jsonb_build_object('allowed', false, 'reason', 'signed_out'); end if;

  select * into v_lim from public.app_limits where id = 1;
  select upload_count, upload_bytes into v_count, v_bytes from public.user_uploads_today(v_me);
  v_total := public.storage_used_bytes();

  if exists (select 1 from public.profiles where id = v_me and is_admin) then
    v_reason := null;
  elsif v_count >= v_lim.user_daily_uploads then v_reason := 'daily_count';
  elsif v_bytes >= v_lim.user_daily_bytes    then v_reason := 'daily_bytes';
  elsif v_total >= v_lim.global_max_bytes    then v_reason := 'global_full';
  end if;

  return jsonb_build_object(
    'allowed',          v_reason is null,
    'reason',           v_reason,
    'max_video_bytes',  v_lim.max_video_bytes,
    'uploads_today',    v_count,
    'uploads_limit',    v_lim.user_daily_uploads,
    'bytes_today',      v_bytes,
    'bytes_limit',      v_lim.user_daily_bytes,
    'global_used',      v_total,
    'global_limit',     v_lim.global_max_bytes
  );
end;
$fn$;

grant execute on function public.upload_quota_status() to authenticated;


-- ── Enforce it at the storage layer ──
drop policy if exists "videos own write" on storage.objects;
create policy "videos own write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.within_upload_quota(auth.uid())
  );

drop policy if exists "chat media own write" on storage.objects;
create policy "chat media own write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.within_upload_quota(auth.uid())
  );


-- ── Hard per-file ceilings, enforced by storage itself ──
-- 200 MB allowed roughly 5,000 uploads per terabyte of abuse. 60 MB is
-- still four times a realistic 90-second clip.
update storage.buckets set file_size_limit =  62914560 where id = 'videos';      -- 60 MB
update storage.buckets set file_size_limit =  20971520 where id = 'chat-media';  -- 20 MB
update storage.buckets set file_size_limit =   5242880 where id = 'avatars';     --  5 MB


-- ============================================================
-- >>> 0032_location_safety.sql
-- ============================================================

-- ============================================================
-- 0032_location_safety.sql
--
-- Live location is the most sensitive thing this app stores, and it had no
-- notion of time. A position written once stayed readable forever, so
-- someone who shared their location a year ago and never came back was
-- still pinned to the map at wherever they last stood.
--
--   * a shared location goes stale after 8 hours and stops being readable
--   * rows older than 7 days are deleted outright
--   * turning sharing off blanks the coordinates rather than just hiding them
--
-- Apply in the Supabase SQL editor AFTER 0001..0031.
-- ============================================================

create index if not exists idx_user_locations_updated
  on public.user_locations (updated_at desc);


-- ── Reading someone's location ──
-- Same rules as before (public / self / approved follower) with two additions:
-- sharing must be on, and the fix must be recent. Enforced in the policy, so
-- a stale position is not merely hidden by the app - it cannot be selected.
drop policy if exists "locations read" on public.user_locations;
create policy "locations read" on public.user_locations
  for select to authenticated
  using (
    user_id = auth.uid()
    or (
      coalesce(sharing_enabled, false) = true
      and updated_at > now() - interval '8 hours'
      and not exists (
        select 1 from public.blocks
        where (blocker_id = user_id and blocked_id = auth.uid())
           or (blocker_id = auth.uid() and blocked_id = user_id)
      )
      and (
        visibility = 'public'
        or (
          visibility = 'friends'
          and exists (
            select 1 from public.follows
            where follower_id = auth.uid() and followed_id = user_id
          )
        )
      )
    )
  );


-- ── Turning sharing off removes the coordinates ──
-- Flipping a boolean while the last known position sits in the row is not
-- really stopping sharing. This clears the point itself.
create or replace function public.clear_location_when_off()
returns trigger
language plpgsql
as $fn$
begin
  if coalesce(new.sharing_enabled, false) = false or new.visibility = 'none' then
    new.lat := null;
    new.lng := null;
    new.accuracy := null;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_clear_location_when_off on public.user_locations;
create trigger trg_clear_location_when_off
  before insert or update on public.user_locations
  for each row execute function public.clear_location_when_off();


-- ── Stop sharing, from the app ──
create or replace function public.stop_sharing_location()
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.user_locations
     set sharing_enabled = false, visibility = 'none',
         lat = null, lng = null, accuracy = null, updated_at = now()
   where user_id = auth.uid();
$fn$;

grant execute on function public.stop_sharing_location() to authenticated;


-- ── Housekeeping ──
-- Nothing keeps a week-old position useful, and holding it is a liability.
-- Call from a scheduled job (pg_cron) if available, or from an operator task.
create or replace function public.purge_stale_locations()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare n integer;
begin
  delete from public.user_locations
   where updated_at < now() - interval '7 days';
  get diagnostics n = row_count;
  return n;
end;
$fn$;

revoke all on function public.purge_stale_locations() from public;
grant execute on function public.purge_stale_locations() to service_role;

-- Runs nightly where pg_cron is enabled; harmless where it is not.
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-stale-locations')
      where exists (select 1 from cron.job where jobname = 'purge-stale-locations');
    perform cron.schedule('purge-stale-locations', '0 3 * * *',
                          'select public.purge_stale_locations()');
  end if;
end
$cron$;


-- ============================================================
-- >>> 0033_support_tickets.sql
-- ============================================================

-- ============================================================
-- 0033_support_tickets.sql
--
-- "Report a problem" and "Contact us" opened a mailto: link, which does
-- nothing in the app webview - the buttons appeared dead. Worse, anything
-- that did send went to an inbox with no record in the product.
--
-- Reports now land in a table you can actually work through.
--
-- Note: public.reports already exists and is for moderation - reporting a
-- video, comment, user or stream. This is a different thing: a person
-- telling you the app is broken.
--
-- Apply in the Supabase SQL editor AFTER 0001..0032.
-- ============================================================

create table if not exists public.support_tickets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles (id) on delete set null,

  category    text not null default 'other'
              check (category in ('bug', 'account', 'payment', 'content', 'safety', 'other')),
  subject     text,
  message     text not null,

  -- Captured automatically. Half of support is working out what they were on.
  app_version text,
  device      text,

  status      text not null default 'open'
              check (status in ('open', 'in_progress', 'resolved', 'closed')),
  admin_reply text,
  replied_at  timestamptz,
  replied_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_support_status
  on public.support_tickets (status, created_at desc);
create index if not exists idx_support_user
  on public.support_tickets (user_id, created_at desc);

alter table public.support_tickets enable row level security;

-- You can raise a ticket and read your own; admins see everything.
drop policy if exists "support insert own" on public.support_tickets;
create policy "support insert own" on public.support_tickets
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "support read own or admin" on public.support_tickets;
create policy "support read own or admin" on public.support_tickets
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

drop policy if exists "support admin update" on public.support_tickets;
create policy "support admin update" on public.support_tickets
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));


-- ── Don't let one person flood the queue ──
create or replace function public.check_support_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare n integer;
begin
  select count(*) into n
    from public.support_tickets
   where user_id = new.user_id
     and created_at > now() - interval '1 hour';

  if n >= 5 then
    raise exception 'too many reports, try again later';
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_support_rate_limit on public.support_tickets;
create trigger trg_support_rate_limit
  before insert on public.support_tickets
  for each row execute function public.check_support_rate_limit();


-- ── Tell the person when you reply ──
create or replace function public.notify_on_support_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.admin_reply is not null
     and new.admin_reply is distinct from old.admin_reply
     and new.user_id is not null then
    insert into public.notifications (user_id, actor_id, type, payload)
    values (new.user_id, new.replied_by, 'system',
            jsonb_build_object('ticket_id', new.id,
                               'text', left(new.admin_reply, 120)));
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_notify_support_reply on public.support_tickets;
create trigger trg_notify_support_reply
  after update on public.support_tickets
  for each row execute function public.notify_on_support_reply();


-- ============================================================
-- >>> 0034_account_status.sql
-- ============================================================

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


-- ============================================================
-- >>> 0035_mentions.sql
-- ============================================================

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


-- ============================================================
-- >>> 0036_signup_age.sql
-- ============================================================

-- ============================================================
-- 0036_signup_age.sql
--
-- The rebuilt signup asks for a birthday, which 0022 deliberately left
-- homeless. It lives in user_private (owner-only reads), and it is what the
-- age rules hang off:
--
--   * under 13  - may not have an account at all (both stores require this)
--   * under 18  - may not enable location sharing
--
-- The location rule is enforced by a trigger, not by the app, so it holds
-- for anyone talking to the API directly.
--
-- Apply in the Supabase SQL editor AFTER 0001..0035.
-- ============================================================

alter table public.user_private
  add column if not exists birth_date date;


-- ── A birthday is written once ──
-- If it could be edited freely, a 15-year-old would become 18 the moment the
-- location toggle refused them. Support can still correct genuine mistakes
-- with the service role, which bypasses triggers' auth context but not this
-- guard - so the guard allows service_role explicitly.
create or replace function public.guard_birth_date()
returns trigger
language plpgsql
as $fn$
begin
  if tg_op = 'UPDATE'
     and old.birth_date is not null
     and new.birth_date is distinct from old.birth_date
     and current_setting('request.jwt.claims', true)::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'birth date cannot be changed';
  end if;

  -- The app refuses under-13 signups; this makes the refusal real.
  if new.birth_date is not null
     and new.birth_date > (current_date - interval '13 years') then
    raise exception 'minimum age is 13';
  end if;

  -- A birthday in the future or before 1900 is a typo, not a person.
  if new.birth_date is not null
     and (new.birth_date > current_date or new.birth_date < date '1900-01-01') then
    raise exception 'invalid birth date';
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_guard_birth_date on public.user_private;
create trigger trg_guard_birth_date
  before insert or update on public.user_private
  for each row execute function public.guard_birth_date();


-- ── Is this person an adult? ──
-- security definer because user_private is owner-only, but the location
-- trigger needs the answer for whoever is writing.
create or replace function public.is_adult(p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $fn$
  select coalesce(
    (select birth_date <= (current_date - interval '18 years')
       from public.user_private
      where user_id = p_user),
    false   -- no birthday recorded = not proven adult
  );
$fn$;

grant execute on function public.is_adult(uuid) to authenticated;


-- ── Location sharing is 18+ ──
create or replace function public.enforce_location_age()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if coalesce(new.sharing_enabled, false) = true
     and not public.is_adult(new.user_id) then
    raise exception 'location sharing requires 18+';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_enforce_location_age on public.user_locations;
create trigger trg_enforce_location_age
  before insert or update on public.user_locations
  for each row execute function public.enforce_location_age();
