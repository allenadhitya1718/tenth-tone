-- 0104 - live gifts that can actually be sent, and a safe way to buy coins
--         (client notes 17 and 12)
--
-- ============================================================
-- A. GIFTS (note 17)
-- ============================================================
-- The agreed gifts (horse, camel, ...) were never added: 0001 seeded only
-- rose, heart, star, trophy, crown, rocket, yacht and car. This adds
--   dates (تمر), coffee dallah (دلة قهوة), falcon (صقر), camel (جمل),
--   horse (حصان)
-- and keeps the original eight exactly as they are (their prices are not
-- touched). gifts.name has always held the Arabic name; this adds name_en,
-- asset_url (an animation or image, for example a Lottie JSON or PNG on R2;
-- null means "show the emoji") and sort_order (the order of the gift tray).
-- Re-running the seed refreshes names, emoji and order of the five new gifts
-- but never overwrites an asset_url somebody has set since.
--
-- SENDING A GIFT HAS NEVER WORKED. Found while checking send_gift (0017):
--   0030 added a trigger, notify_on_gift, that inserts a notification of type
--   'gift'. notifications_type_check (last restated in 0053) does not allow
--   'gift'. notify_on_gift runs inside send_gift's transaction, so for every
--   recipient with notif_gifts on - which is the default - the insert raised
--   23514 and rolled the whole gift back, coins included. Nobody noticed only
--   because no client ever called send_gift (CLIENT_NOTES_STATUS note 17).
--   Fixed below by adding 'gift' to the allowed types. The constraint is
--   EXTENDED from whatever it currently allows rather than restated, so types
--   added by any other migration are kept.
--
-- send_gift's money logic (lock the sender's wallet, check, debit, credit,
-- two ledger rows) is correct and is kept line for line. Re-created here only
-- to add the checks a live gift tray needs:
--   - the gift must be active (a retired gift could still be bought by id);
--   - sender and recipient must not have blocked each other;
--   - when a live_stream_id is given, the stream must be live and the
--     recipient must be its host or an accepted guest (live_guests, 0103), so
--     a "live gift" cannot be pinned on a stream it has nothing to do with.
-- Signature and return value are unchanged: send_gift(to, gift_id, live_id)
-- returns the gift_transactions id.
--
-- Everyone in the live sees gifts arrive: gift_transactions joins the
-- supabase_realtime publication, and a new read policy lets anyone who can
-- see a stream read the gifts sent in it (realtime respects RLS, so without
-- that policy only sender and recipient would receive the event).
--
-- ============================================================
-- B. BUYING COINS (note 12)
-- ============================================================
-- There was no way to buy coins. self_topup (0006) let the client credit
-- itself and was rightly revoked in 0007. This adds the server-side half of a
-- real store purchase:
--
--   coin_packages   what can be bought: product_id is the App Store / Google
--                   Play product id (create the SAME id in both consoles),
--                   coins + bonus_coins is what is credited. price_label is
--                   only a fallback for display: the app must show the
--                   localized price the store returns for the product.
--   wallet_topups   one row per store transaction; store_transaction_id is
--                   unique, which is what makes crediting idempotent. A user
--                   reads their own rows (purchase history); nobody writes.
--   credit_wallet_topup(p_user, p_product_id, p_platform,
--                       p_store_transaction_id)
--                   credits the wallet and writes the ledger row. EXECUTE is
--                   granted to service_role ONLY.
--
-- HOW A PURCHASE MUST FLOW (none of this is built yet):
--   1. The app buys the product through the store (StoreKit on iOS, Google
--      Play Billing on Android, e.g. via react-native-iap or RevenueCat).
--   2. The app sends the receipt / purchase token to a NEW Edge Function
--      (for example `verify-purchase`), or RevenueCat calls a webhook.
--   3. That function verifies the purchase with the store itself - Apple App
--      Store Server API (transaction id, signed JWS) / Google Play Developer
--      API (purchases.products.get with the purchase token) - or trusts only
--      RevenueCat's signed webhook. It must check the product id, that the
--      purchase is completed (not pending / refunded), and that it belongs to
--      this app's bundle id / package name.
--   4. Only then does it call credit_wallet_topup with the service role key,
--      and finally acknowledges / finishes / consumes the purchase.
--   The app must NEVER credit coins itself, and must never be given a way to.
--   Calling credit_wallet_topup twice with the same store transaction id
--   credits once, so store retries and webhook redeliveries are safe.
--
--   iOS: Apple requires coins (a digital currency spent in the app) to be sold
--   through In-App Purchase as consumables (App Review Guideline 3.1.1). A
--   card form, Stripe, or a link out to a web shop for coins will be
--   rejected. Android: Google Play Billing for the same reason.
--
-- Apply AFTER 0103 (send_gift reads live_guests). Safe to re-run.

begin;

-- ============================================================
-- A1. Gift catalogue columns
-- ============================================================

alter table public.gifts add column if not exists name_en    text;
alter table public.gifts add column if not exists asset_url  text;
alter table public.gifts add column if not exists sort_order integer not null default 0;

-- The original eight: English names and an order, prices left alone.
update public.gifts g
   set name_en    = coalesce(g.name_en, v.name_en),
       sort_order = v.sort_order
  from (values
          ('rose',   'Rose',     10),
          ('heart',  'Heart',    20),
          ('star',   'Star',     30),
          ('trophy', 'Trophy',   60),
          ('crown',  'Crown',    80),
          ('rocket', 'Rocket',  100),
          ('yacht',  'Yacht',   110),
          ('car',    'Car',     130)
       ) as v(id, name_en, sort_order)
 where g.id = v.id;

-- The agreed gifts. Price ladder, in coins, alongside the existing ones:
--   rose 1, heart 5, star 10, dates 15, dallah 30, trophy 50, falcon 150,
--   crown 200, camel 300, rocket 500, yacht 1000, horse 1500, car 2000
-- (There is no dallah or dates emoji; ☕ and 🌴 stand in until asset_url
-- carries the real artwork.)
insert into public.gifts (id, name, name_en, emoji, price, active, sort_order) values
  ('dates',  'تمر',       'Dates',         '🌴',   15, true,  40),
  ('dallah', 'دلة قهوة',  'Coffee dallah', '☕',   30, true,  50),
  ('falcon', 'صقر',       'Falcon',        '🦅',  150, true,  70),
  ('camel',  'جمل',       'Camel',         '🐪',  300, true,  90),
  ('horse',  'حصان',      'Horse',         '🐎', 1500, true, 120)
on conflict (id) do update
  set name       = excluded.name,
      name_en    = excluded.name_en,
      emoji      = excluded.emoji,
      price      = excluded.price,
      active     = excluded.active,
      sort_order = excluded.sort_order;
      -- asset_url deliberately not touched: it is set by hand once uploaded.

-- ============================================================
-- A2. Allow the 'gift' notification type (the bug described above)
-- ============================================================
-- Reads the values the constraint allows today, adds 'gift', and rebuilds it.
-- Does nothing when 'gift' is already allowed.
do $$
declare
  v_def   text;
  v_types text[];
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = 'public.notifications'::regclass
     and c.conname  = 'notifications_type_check';

  -- pg_get_constraintdef renders the list as  ARRAY['like'::text, ...]
  select coalesce(array_agg(distinct m[1]), '{}')
    into v_types
    from regexp_matches(coalesce(v_def, ''), '''([^'']+)''', 'g') as m;

  if 'gift' = any (v_types) then return; end if;

  -- No constraint at all would be unexpected; fall back to 0053's list.
  if cardinality(v_types) = 0 then
    v_types := array['like', 'comment', 'follow', 'mention', 'message',
                     'system', 'live', 'follow_request'];
  end if;
  v_types := v_types || array['gift'];

  alter table public.notifications drop constraint if exists notifications_type_check;
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type = any (%L::text[]))',
    v_types);
end $$;

-- ============================================================
-- A3. send_gift: same money logic, plus the checks a live needs
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
  v_host    uuid;
  v_status  text;
begin
  if v_me is null then raise exception 'must be signed in'; end if;
  if p_to_user_id is null then raise exception 'recipient required'; end if;
  if p_to_user_id = v_me then raise exception 'cannot send a gift to yourself'; end if;

  -- New in 0104: retired gifts cannot be sent.
  select price, name into v_price, v_name from public.gifts
   where id = p_gift_id and active;
  if v_price is null then raise exception 'gift not found'; end if;
  if v_price <= 0 then raise exception 'invalid gift price'; end if;

  -- New in 0104: no gifts across a block, in either direction.
  if public.is_blocked_between(v_me, p_to_user_id) then
    raise exception 'cannot send a gift to this account';
  end if;

  -- New in 0104: a live gift must go to someone in that live.
  if p_live_stream_id is not null then
    select host_id, status into v_host, v_status
      from public.live_streams where id = p_live_stream_id;
    if v_host is null then raise exception 'live stream not found'; end if;
    if v_status <> 'live' then raise exception 'live stream has ended'; end if;
    if p_to_user_id <> v_host
       and not exists (select 1 from public.live_guests g
                        where g.live_id = p_live_stream_id
                          and g.user_id = p_to_user_id
                          and g.status  = 'accepted') then
      raise exception 'recipient is not in this live stream';
    end if;
  end if;

  -- ---- unchanged from 0017 from here on ----

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

revoke all on function public.send_gift(uuid, text, uuid) from public, anon;
grant execute on function public.send_gift(uuid, text, uuid) to authenticated;

-- ============================================================
-- A4. Everyone in the live sees the gifts
-- ============================================================
-- Gifts sent in a stream are readable by anyone who can see that stream (the
-- subquery runs under the caller's live_streams read policy, privacy
-- included). Gifts sent outside a live stay private to sender and recipient
-- ("gift_tx own read", 0017).
drop policy if exists "gift_tx live read" on public.gift_transactions;
create policy "gift_tx live read" on public.gift_transactions
  for select to authenticated
  using (
    live_stream_id is not null
    and exists (select 1 from public.live_streams ls
                 where ls.id = gift_transactions.live_stream_id)
  );

create index if not exists idx_gift_tx_live_created
  on public.gift_transactions (live_stream_id, created_at desc)
  where live_stream_id is not null;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime'
                        and schemaname = 'public' and tablename = 'gift_transactions') then
    execute 'alter publication supabase_realtime add table public.gift_transactions';
  end if;
end $$;

-- ============================================================
-- B1. Coin packages
-- ============================================================

create table if not exists public.coin_packages (
  id           uuid primary key default uuid_generate_v4(),
  product_id   text not null unique,
  coins        integer not null check (coins > 0),
  bonus_coins  integer not null default 0 check (bonus_coins >= 0),
  price_label  text,
  active       boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

alter table public.coin_packages enable row level security;
revoke insert, update, delete, truncate on public.coin_packages from anon, authenticated;

drop policy if exists "coin packages read" on public.coin_packages;
create policy "coin packages read" on public.coin_packages
  for select to authenticated
  using (active);

-- Product ids must be created with exactly these names in App Store Connect
-- (consumable) and the Play Console (one-time product). price_label is the
-- intended SAR price tier and only a fallback for display.
insert into public.coin_packages (product_id, coins, bonus_coins, price_label, active, sort_order) values
  ('flyp.coins.100',   100,    0, '4.99 SAR',   true, 10),
  ('flyp.coins.500',   500,   25, '19.99 SAR',  true, 20),
  ('flyp.coins.1200', 1200,  100, '44.99 SAR',  true, 30),
  ('flyp.coins.2500', 2500,  300, '89.99 SAR',  true, 40),
  ('flyp.coins.6500', 6500, 1000, '219.99 SAR', true, 50)
on conflict (product_id) do update
  set coins       = excluded.coins,
      bonus_coins = excluded.bonus_coins,
      price_label = excluded.price_label,
      active      = excluded.active,
      sort_order  = excluded.sort_order;

-- ============================================================
-- B2. Top-up records
-- ============================================================

create table if not exists public.wallet_topups (
  id                   uuid primary key default uuid_generate_v4(),
  user_id              uuid not null references public.profiles (id) on delete cascade,
  package_id           uuid references public.coin_packages (id) on delete set null,
  platform             text not null check (platform in ('ios', 'android')),
  store_transaction_id text not null unique,
  status               text not null default 'pending'
                       check (status in ('pending', 'credited', 'rejected')),
  coins                integer not null check (coins >= 0),
  created_at           timestamptz not null default now(),
  credited_at          timestamptz
);

create index if not exists idx_wallet_topups_user_created
  on public.wallet_topups (user_id, created_at desc);

alter table public.wallet_topups enable row level security;
revoke insert, update, delete, truncate on public.wallet_topups from anon, authenticated;

drop policy if exists "wallet topups own read" on public.wallet_topups;
create policy "wallet topups own read" on public.wallet_topups
  for select to authenticated
  using (user_id = (select auth.uid()));
-- No insert / update / delete policy: only credit_wallet_topup (and the
-- service role, which bypasses RLS) ever writes here.

-- ============================================================
-- B3. credit_wallet_topup - service role only
-- ============================================================
-- Called by the verifying Edge Function AFTER the store confirmed the
-- purchase. Returns
--   { topup_id, credited (true = this call added coins), coins, balance }
-- Idempotent on p_store_transaction_id:
--   - first call: records the top-up as 'credited' and adds the coins;
--   - a row already 'pending' (recorded earlier by the function, e.g. an
--     Android pending purchase) is credited now;
--   - already 'credited': returns it again with credited = false;
--   - 'rejected', or the transaction id belongs to another user: refused.
-- A package that has since been deactivated is still honoured: the purchase
-- was paid for.

create or replace function public.credit_wallet_topup(
  p_user                 uuid,
  p_product_id           text,
  p_platform             text,
  p_store_transaction_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg     public.coin_packages%rowtype;
  v_topup   public.wallet_topups%rowtype;
  v_coins   integer;
  v_balance integer;
begin
  -- Not a client function. The grant below already limits it to the service
  -- role; this refuses again if it is ever granted wider by mistake.
  if auth.uid() is not null then raise exception 'not allowed'; end if;

  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'unknown user';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android') then raise exception 'bad platform'; end if;
  if coalesce(trim(p_store_transaction_id), '') = '' then
    raise exception 'store transaction id required';
  end if;

  select * into v_pkg from public.coin_packages where product_id = p_product_id;
  if not found then raise exception 'unknown product %', p_product_id; end if;
  v_coins := v_pkg.coins + v_pkg.bonus_coins;

  -- Claim the transaction id. A concurrent call with the same id waits on the
  -- unique index here, then finds the row below.
  insert into public.wallet_topups
         (user_id, package_id, platform, store_transaction_id, status, coins)
  values (p_user, v_pkg.id, p_platform, p_store_transaction_id, 'pending', v_coins)
  on conflict (store_transaction_id) do nothing;

  select * into v_topup from public.wallet_topups
   where store_transaction_id = p_store_transaction_id
   for update;

  if v_topup.user_id <> p_user then
    raise exception 'store transaction belongs to another account';
  end if;
  if v_topup.status = 'rejected' then
    raise exception 'store transaction was rejected';
  end if;
  if v_topup.status = 'credited' then
    select balance into v_balance from public.wallets where user_id = p_user;
    return jsonb_build_object('topup_id', v_topup.id, 'credited', false,
                              'coins', v_topup.coins, 'balance', coalesce(v_balance, 0));
  end if;

  -- 'pending' -> credit it now.
  update public.wallet_topups
     set status = 'credited', credited_at = now(),
         package_id = v_pkg.id, coins = v_coins
   where id = v_topup.id;

  insert into public.wallets (user_id, balance) values (p_user, v_coins)
    on conflict (user_id) do update
    set balance = public.wallets.balance + v_coins,
        updated_at = now()
  returning balance into v_balance;

  insert into public.wallet_transactions (user_id, type, amount, reference, description)
  values (p_user, 'topup', v_coins, v_topup.id, 'شحن — ' || p_product_id);

  return jsonb_build_object('topup_id', v_topup.id, 'credited', true,
                            'coins', v_coins, 'balance', v_balance);
end;
$$;

-- Named roles, not just PUBLIC: Supabase grants EXECUTE on new functions to
-- authenticated by default (see 0073), so `from public` alone would leave
-- every signed-in user able to mint coins.
revoke all on function public.credit_wallet_topup(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.credit_wallet_topup(uuid, text, text, text) to service_role;

commit;

-- ── Verification ─────────────────────────────────────────────────────────
-- Run after applying. Every row should read OK.
select 'gift notification type allowed' as check,
       case when exists (select 1 from pg_constraint
                          where conname = 'notifications_type_check'
                            and pg_get_constraintdef(oid) like '%''gift''%')
            then 'OK' else 'MISSING' end as result
union all select 'horse and camel seeded',
       case when (select count(*) from public.gifts where id in ('horse', 'camel') and active) = 2
            then 'OK' else 'MISSING' end
union all select 'gift_transactions in realtime',
       case when exists (select 1 from pg_publication_tables
                          where pubname = 'supabase_realtime' and tablename = 'gift_transactions')
            then 'OK' else 'MISSING (no supabase_realtime publication?)' end
union all select 'credit_wallet_topup not callable by users',
       case when not has_function_privilege('authenticated',
                   'public.credit_wallet_topup(uuid,text,text,text)', 'execute')
             and not has_function_privilege('anon',
                   'public.credit_wallet_topup(uuid,text,text,text)', 'execute')
            then 'OK' else 'EXPOSED' end
union all select 'coin packages seeded',
       (select count(*)::text from public.coin_packages where active);
