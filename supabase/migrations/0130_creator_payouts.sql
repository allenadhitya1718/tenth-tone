-- ============================================================
-- 0130 - creator payouts: diamonds from received gifts, KYC, bank withdrawals
--
-- MUMBAI PROJECT ONLY (vfkwipvinmnybilcrdzr). Apply AFTER 0127 (iap_refunds,
-- wallet_flags) and 0128 (admin_v2_* pattern). Independent of 0129.
-- Safe to re-run: tables/columns "if not exists", every function dropped and
-- re-created, policies and triggers dropped and re-created, config row
-- inserted only when missing (admin edits are never overwritten).
--
-- ============================================================
-- THE MODEL
-- ============================================================
-- Coins (wallets / send_gift, 0104) are unchanged and still have no cash
-- value. Separately, every gift a person RECEIVES earns them "diamonds":
--
--   diamonds = floor(gift coins x payout_config.diamonds_per_coin)   (default 1)
--   SAR      = diamonds x payout_config.sar_per_diamond
--
-- sar_per_diamond is seeded conservatively from the CHEAPEST price per coin
-- among the active coin_packages (price_label parsed, coins + bonus_coins),
-- x (1 - 0.30 store cut) x 0.50 creator share, rounded DOWN to 4 decimals.
-- With the 0104 packages: 219.99 SAR / 7500 coins = 0.029332 -> x0.35 =
-- 0.010266 -> 0.0102 SAR per diamond (100 SAR = 9,804 diamonds). Stored as a
-- number; admins edit it (admin_v2_payout_set_config). A withdrawal locks the
-- rate in force when it is requested.
--
-- Ledger: creator_earnings, one row per gift_transactions row (unique), made
-- by an AFTER INSERT trigger on gift_transactions. send_gift is NOT changed;
-- the trigger swallows its own errors (a warning, the gift still goes
-- through), and admin_v2_payout_backfill() re-creates any missing rows.
--
--   status   pending    on hold until available_at (= gift time + hold_days)
--            available  may be withdrawn
--            withheld   not withdrawable (reason in withhold_reason); only an
--                       admin releases it
--            withdrawn  bookkeeping: covered by a PAID withdrawal (FIFO)
--            reversed   voided by an admin, never counted again
--
-- Hold release is lazy (every creator/admin read settles what is due) plus a
-- pg_cron job every hour at :23 when pg_cron is enabled.
--
-- ============================================================
-- REFUNDED / SANDBOX COINS - the conservative rule
-- ============================================================
-- Coins are fungible: the wallet does not record which top-up a given coin
-- came from, so exact lineage is NOT tracked. Instead:
--
-- 1. At gift time ("funding"): the sender's PAID coins = sum of coins of
--    their wallet_topups that are status 'credited', environment
--    'production' and not refunded. If the coins the sender has given away
--    in gifts so far (this one included) exceed that, the whole gift is
--    withheld ('unfunded_coins'). This covers: sandbox / TestFlight / license
--    tester coins, admin-granted coins, coins the sender themselves received
--    as gifts and re-gifted, and top-ups recorded before 0111 (environment
--    null). It is permanent until an admin releases it.
-- 2. At gift time AND again when the hold ends: withheld when the sender has
--    an UNREVIEWED wallet_flags row ('sender_flagged') or any refund in the
--    last refund_lookback_days (default 30) ('sender_refund'): a refunded
--    wallet_topups row or an iap_refunds row for them.
-- 3. Immediately when it happens: a trigger on iap_refunds (outcome
--    'reversed') withholds that sender's pending/available earnings from
--    gifts in the lookback window; a trigger on wallet_flags (new or reopened
--    flag) withholds ALL that sender's pending/available earnings.
--    Rows already 'withdrawn' (paid out) cannot be taken back here; the
--    admin pages show the creator's balance going negative instead, which
--    blocks further withdrawals until it is covered.
-- 4. An admin can put a creator on hold (creator_payout_holds): all their
--    pending/available earnings become withheld, new gifts arrive withheld,
--    and withdrawals are refused until released.
--
-- ============================================================
-- KYC AND WITHDRAWALS
-- ============================================================
-- creator_kyc (one row per creator): legal name, Saudi national ID / Iqama
-- number (10 digits, starts with 1 or 2), ID photo (front) in the PRIVATE
-- storage bucket 'kyc' at <uid>/..., IBAN (SA + 22 digits, ISO 13616 mod-97
-- checked), bank name, attestation that the IBAN is in the creator's own
-- name. NO table grants to anon/authenticated at all: the owner reads a
-- MASKED copy through my_creator_kyc(); admins read through admin_v2_kyc_*.
-- Storage: the owner may upload into and read their own folder; admins may
-- read (the panel creates a short-lived signed URL with its own session
-- after admin_v2_kyc_document() returns the path; SQL cannot sign URLs).
-- Nobody may update or delete objects in 'kyc' through the API.
--
-- creator_withdrawals: amount in SAR (>= min_withdraw_sar, <= available),
-- diamonds reserved at request time (atomic: per-creator advisory lock),
-- name / IBAN / bank snapshotted.
--   requested -> approved -> paid (admin-entered bank reference)
--   requested | approved -> rejected (reason)  -> diamonds return to available
--   requested -> cancelled (by the creator)    -> diamonds return to available
-- One open (requested / approved) withdrawal per creator at a time.
--
-- Eligibility (payout_eligibility): payouts active, birth date on file and
-- age >= min_age (18), account age >= min_account_age_days (30), not banned /
-- deactivated / scheduled for deletion, not in wallet_flags (unreviewed), not
-- on payout hold, KYC approved.
--
-- Notifications (type 'system', actor null): payload.kind
--   payout_kyc_approved, payout_kyc_rejected (reason),
--   payout_withdrawal_approved, payout_withdrawal_paid,
--   payout_withdrawal_rejected (reason)
-- payload also carries title (Arabic) / body (English) so the app's generic
-- system row renders something readable until describe.ts learns the kinds.
--
-- Account deletion: creator_kyc.user_id and creator_withdrawals.user_id are
-- ON DELETE SET NULL so payout records survive for accounting; earnings go
-- with the account. See the open retention question in PAYOUTS_ADMIN_SPEC.md.
--
-- NOTE: 0128's verify query counts exactly 17 admin_v2_* functions; after
-- this file it reads "MISSING SOME" if 0128 is re-run. That is expected.
-- ============================================================

begin;

-- ── 0. notifications.type must allow 'system' (it has since 0001) ───────
-- Extended, never restated; reads both renderings of the list
-- (ARRAY['a'::text, ...] and '{a,b}'::text[]).
do $$
declare
  v_name  text;
  v_def   text;
  v_types text[];
begin
  select c.conname, pg_get_constraintdef(c.oid) into v_name, v_def
    from pg_constraint c
   where c.conrelid = 'public.notifications'::regclass
     and c.contype = 'c'
     and (c.conname = 'notifications_type_check' or pg_get_constraintdef(c.oid) like '%follow%')
   order by (c.conname = 'notifications_type_check') desc
   limit 1;

  if v_def is null then return; end if;   -- no constraint: anything goes

  select coalesce(array_agg(distinct t), '{}')
    into v_types
    from (select trim(both '" ' from unnest(
                   case when m[1] like '{%}' then string_to_array(trim(both '{}' from m[1]), ',')
                        else array[m[1]] end)) as t
            from regexp_matches(v_def, '''([^'']+)''', 'g') as m) s
   where t <> '';

  if 'system' = any (v_types) then return; end if;
  v_types := v_types || array['system'];

  execute format('alter table public.notifications drop constraint %I', v_name);
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type = any (%L::text[]))',
    v_types);
end $$;


-- ── 1. payout_config (single row) ───────────────────────────────────────
create table if not exists public.payout_config (
  id                    boolean primary key default true check (id),
  diamonds_per_coin     numeric(12,4) not null default 1      check (diamonds_per_coin > 0),
  sar_per_diamond       numeric(12,4) not null default 0.0102 check (sar_per_diamond > 0),
  min_withdraw_sar      numeric(12,2) not null default 100    check (min_withdraw_sar > 0),
  hold_days             integer       not null default 7      check (hold_days between 0 and 365),
  min_account_age_days  integer       not null default 30     check (min_account_age_days between 0 and 3650),
  min_age               integer       not null default 18     check (min_age between 18 and 100),
  refund_lookback_days  integer       not null default 30     check (refund_lookback_days between 0 and 365),
  active                boolean       not null default true,
  updated_at            timestamptz   not null default now(),
  updated_by            uuid references public.profiles (id) on delete set null
);

-- Seeded once: cheapest price per coin x 0.70 x 0.50, rounded down to 4 dp.
insert into public.payout_config (id, sar_per_diamond)
select true,
       greatest(0.0001, coalesce(
         (select trunc(min(price / (coins + bonus_coins)) * 0.70 * 0.50, 4)
            from (select nullif(substring(price_label from '([0-9]+(?:\.[0-9]+)?)'), '')::numeric as price,
                         coins, bonus_coins
                    from public.coin_packages
                   where active and coins + bonus_coins > 0) p
           where price > 0),
         0.0102))
on conflict (id) do nothing;

alter table public.payout_config enable row level security;
revoke all on public.payout_config from anon, authenticated;
grant select on public.payout_config to authenticated;   -- not secret; writes via admin RPC only
grant all on public.payout_config to service_role;

drop policy if exists "payout config read" on public.payout_config;
create policy "payout config read" on public.payout_config
  for select to authenticated using (true);


-- ── 2. creator_payout_holds (admin hold on a creator) ───────────────────
create table if not exists public.creator_payout_holds (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  reason     text,
  held_by    uuid references public.profiles (id) on delete set null,
  held_at    timestamptz not null default now()
);
alter table public.creator_payout_holds enable row level security;
revoke all on public.creator_payout_holds from anon, authenticated;
grant all on public.creator_payout_holds to service_role;


-- ── 3. creator_earnings ─────────────────────────────────────────────────
create table if not exists public.creator_earnings (
  id                   uuid primary key default uuid_generate_v4(),
  gift_transaction_id  uuid unique references public.gift_transactions (id) on delete set null,
  receiver_id          uuid not null references public.profiles (id) on delete cascade,
  sender_id            uuid references public.profiles (id) on delete set null,
  gift_id              text,
  coins                integer not null check (coins >= 0),
  diamonds             integer not null check (diamonds >= 0),
  status               text not null default 'pending'
                       check (status in ('pending', 'available', 'withheld', 'withdrawn', 'reversed')),
  withhold_reason      text,
  available_at         timestamptz not null,
  released_by          uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  status_changed_at    timestamptz not null default now()
);

create index if not exists idx_creator_earnings_receiver
  on public.creator_earnings (receiver_id, status, available_at);
create index if not exists idx_creator_earnings_sender
  on public.creator_earnings (sender_id, created_at desc) where sender_id is not null;
create index if not exists idx_creator_earnings_due
  on public.creator_earnings (available_at) where status = 'pending';
-- The funding check sums a sender's gifts.
create index if not exists idx_gift_tx_from_created
  on public.gift_transactions (from_user_id, created_at);

alter table public.creator_earnings enable row level security;
revoke all on public.creator_earnings from anon, authenticated;
grant select on public.creator_earnings to authenticated;    -- own rows, via RLS
grant all on public.creator_earnings to service_role;

drop policy if exists "creator earnings own read" on public.creator_earnings;
create policy "creator earnings own read" on public.creator_earnings
  for select to authenticated
  using (receiver_id = (select auth.uid()));


-- ── 4. creator_kyc ──────────────────────────────────────────────────────
create table if not exists public.creator_kyc (
  id                 uuid primary key default uuid_generate_v4(),
  user_id            uuid unique references public.profiles (id) on delete set null,
  legal_name         text not null,
  id_number          text not null,
  id_type            text not null check (id_type in ('national_id', 'iqama')),
  id_photo_path      text not null,
  iban               text not null,
  bank_name          text not null,
  owner_attested     boolean not null default false,
  status             text not null default 'pending'
                     check (status in ('pending', 'approved', 'rejected')),
  reject_reason      text,
  submissions        integer not null default 1,
  submitted_at       timestamptz not null default now(),
  reviewed_at        timestamptz,
  reviewed_by        uuid references public.profiles (id) on delete set null,
  updated_at         timestamptz not null default now()
);

create index if not exists idx_creator_kyc_status on public.creator_kyc (status, submitted_at);
create index if not exists idx_creator_kyc_iban on public.creator_kyc (iban);
create index if not exists idx_creator_kyc_id_number on public.creator_kyc (id_number);

alter table public.creator_kyc enable row level security;
-- No grant at all to anon / authenticated: every read and write is a
-- SECURITY DEFINER function below. RLS stays on as a second wall.
revoke all on public.creator_kyc from anon, authenticated;
grant all on public.creator_kyc to service_role;


-- ── 5. creator_withdrawals ──────────────────────────────────────────────
create table if not exists public.creator_withdrawals (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid references public.profiles (id) on delete set null,
  kyc_id           uuid references public.creator_kyc (id) on delete set null,
  amount_sar       numeric(12,2) not null check (amount_sar > 0),
  diamonds         integer not null check (diamonds > 0),
  sar_per_diamond  numeric(12,4) not null,
  legal_name       text not null,
  iban             text not null,
  bank_name        text not null,
  status           text not null default 'requested'
                   check (status in ('requested', 'approved', 'paid', 'rejected', 'cancelled')),
  bank_reference   text,
  reject_reason    text,
  admin_note       text,
  requested_at     timestamptz not null default now(),
  approved_at      timestamptz,
  approved_by      uuid references public.profiles (id) on delete set null,
  paid_at          timestamptz,
  paid_by          uuid references public.profiles (id) on delete set null,
  rejected_at      timestamptz,
  rejected_by      uuid references public.profiles (id) on delete set null,
  cancelled_at     timestamptz,
  updated_at       timestamptz not null default now()
);

create index if not exists idx_creator_withdrawals_user
  on public.creator_withdrawals (user_id, requested_at desc);
create index if not exists idx_creator_withdrawals_status
  on public.creator_withdrawals (status, requested_at);
-- At most one open withdrawal per creator.
create unique index if not exists uq_creator_withdrawals_open
  on public.creator_withdrawals (user_id) where status in ('requested', 'approved');

alter table public.creator_withdrawals enable row level security;
revoke all on public.creator_withdrawals from anon, authenticated;
grant all on public.creator_withdrawals to service_role;


-- ── 6. Private storage bucket 'kyc' ─────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kyc', 'kyc', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Owner uploads into <uid>/..., at most 20 objects per account (a KYC needs
-- one; re-submissions add one each). Quota function as every insert policy
-- on storage.objects must (0031). The count is a definer helper so the
-- policy never queries storage.objects under RLS itself.
drop function if exists public.kyc_object_count(uuid);
create or replace function public.kyc_object_count()
returns integer
language sql
security definer
stable
set search_path = public, storage
as $fn$
  select count(*)::integer from storage.objects
   where bucket_id = 'kyc' and (storage.foldername(name))[1] = auth.uid()::text;
$fn$;
revoke all on function public.kyc_object_count() from public, anon;
grant execute on function public.kyc_object_count() to authenticated;

drop policy if exists "kyc own write" on storage.objects;
create policy "kyc own write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'kyc'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.within_upload_quota(auth.uid())
    and public.kyc_object_count() < 20
  );

drop policy if exists "kyc own read" on storage.objects;
create policy "kyc own read" on storage.objects
  for select to authenticated
  using (bucket_id = 'kyc' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "kyc admin read" on storage.objects;
create policy "kyc admin read" on storage.objects
  for select to authenticated
  using (bucket_id = 'kyc' and public.is_admin());
-- Deliberately no update / delete policy for 'kyc'.


-- ── 7. Helpers ──────────────────────────────────────────────────────────

-- ISO 13616: SA + 22 digits, mod 97 = 1.
drop function if exists public.is_valid_saudi_iban(text);
create function public.is_valid_saudi_iban(p_iban text)
returns boolean
language plpgsql
immutable
set search_path = public
as $fn$
declare
  v   text := upper(regexp_replace(coalesce(p_iban, ''), '\s', '', 'g'));
  r   text;
  m   integer := 0;
  i   integer;
begin
  if v !~ '^SA[0-9]{22}$' then return false; end if;
  -- Move the first four characters to the end; S = 28, A = 10.
  r := substr(v, 5) || '2810' || substr(v, 3, 2);
  for i in 1 .. length(r) loop
    m := (m * 10 + substr(r, i, 1)::integer) % 97;
  end loop;
  return m = 1;
end;
$fn$;
grant execute on function public.is_valid_saudi_iban(text) to authenticated;

drop function if exists public.payout_mask_iban(text);
create function public.payout_mask_iban(p_iban text)
returns text language sql immutable as $fn$
  select case when p_iban is null then null
              else left(p_iban, 2) || repeat('•', greatest(length(p_iban) - 6, 0)) || right(p_iban, 4) end;
$fn$;

drop function if exists public.payout_mask_id(text);
create function public.payout_mask_id(p_id text)
returns text language sql immutable as $fn$
  select case when p_id is null then null
              else repeat('•', greatest(length(p_id) - 3, 0)) || right(p_id, 3) end;
$fn$;

drop function if exists public.payout_cfg();
create function public.payout_cfg()
returns public.payout_config
language sql stable security definer set search_path = public as $fn$
  select * from public.payout_config where id;
$fn$;

-- Why a gift's diamonds must be withheld because of its SENDER, or null.
drop function if exists public.payout_sender_risk(uuid);
create function public.payout_sender_risk(p_sender uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_days integer := coalesce((select refund_lookback_days from public.payout_config where id), 30);
begin
  if p_sender is null then return null; end if;
  if exists (select 1 from public.wallet_flags f
              where f.user_id = p_sender and f.reviewed_at is null) then
    return 'sender_flagged';
  end if;
  if exists (select 1 from public.wallet_topups t
              where t.user_id = p_sender
                and t.refunded_at > now() - make_interval(days => v_days))
     or exists (select 1 from public.iap_refunds r
                 where r.user_id = p_sender
                   and r.recorded_at > now() - make_interval(days => v_days)) then
    return 'sender_refund';
  end if;
  return null;
end;
$fn$;

-- Did the sender pay (production, not refunded) for every coin they have
-- given away up to and including the gift at p_at?
drop function if exists public.payout_gift_funded(uuid, timestamptz);
create function public.payout_gift_funded(p_sender uuid, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce((select sum(t.coins) from public.wallet_topups t
                    where t.user_id = p_sender
                      and t.status = 'credited'
                      and t.environment = 'production'
                      and t.refunded_at is null), 0)
         >=
         coalesce((select sum(g.amount) from public.gift_transactions g
                    where g.from_user_id = p_sender
                      and g.created_at <= p_at), 0);
$fn$;

-- Pending earnings whose hold is over become available (or withheld, when
-- the sender now looks risky or the creator is on hold). p_user null = all.
drop function if exists public.payout_settle(uuid);
create function public.payout_settle(p_user uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r   record;
  n   integer := 0;
  why text;
begin
  for r in
    select e.id, e.sender_id, e.receiver_id, e.released_by
      from public.creator_earnings e
     where e.status = 'pending'
       and e.available_at <= now()
       and (p_user is null or e.receiver_id = p_user)
     order by e.available_at
     for update skip locked
  loop
    why := null;
    if r.released_by is null then
      why := public.payout_sender_risk(r.sender_id);
      if why is null and exists (select 1 from public.creator_payout_holds h where h.user_id = r.receiver_id) then
        why := 'creator_on_hold';
      end if;
    end if;
    update public.creator_earnings
       set status = case when why is null then 'available' else 'withheld' end,
           withhold_reason = why,
           status_changed_at = now()
     where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$fn$;

-- Diamond totals for one creator.
drop function if exists public.payout_balance(uuid);
create function public.payout_balance(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  with e as (
    select
      coalesce(sum(diamonds) filter (where status <> 'reversed'), 0)                 as total,
      coalesce(sum(diamonds) filter (where status = 'pending'), 0)                   as pending,
      coalesce(sum(diamonds) filter (where status in ('available', 'withdrawn')), 0) as earned_ok,
      coalesce(sum(diamonds) filter (where status = 'withheld'), 0)                  as withheld,
      min(available_at) filter (where status = 'pending')                            as next_at
    from public.creator_earnings where receiver_id = p_user
  ), w as (
    select
      coalesce(sum(diamonds) filter (where status in ('requested', 'approved')), 0) as reserved,
      coalesce(sum(diamonds) filter (where status = 'paid'), 0)                     as paid,
      coalesce(sum(amount_sar) filter (where status = 'paid'), 0)                   as paid_sar,
      coalesce(sum(amount_sar) filter (where status in ('requested', 'approved')), 0) as reserved_sar
    from public.creator_withdrawals where user_id = p_user
  )
  select jsonb_build_object(
    'total',        e.total,
    'pending',      e.pending,
    'available',    e.earned_ok - w.reserved - w.paid,
    'withheld',     e.withheld,
    'reserved',     w.reserved,
    'withdrawn',    w.paid,
    'withdrawn_sar', w.paid_sar,
    'reserved_sar', w.reserved_sar,
    'next_release_at', e.next_at,
    'next_release_diamonds',
      coalesce((select sum(diamonds) from public.creator_earnings
                 where receiver_id = p_user and status = 'pending'
                   and available_at < e.next_at + interval '1 day'), 0))
  from e, w;
$fn$;

-- Why this person cannot withdraw right now ([] = eligible).
drop function if exists public.payout_eligibility(uuid);
create function public.payout_eligibility(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  c        public.payout_config;
  p        record;
  v_birth  date;
  v_kyc    text;
  reasons  text[] := '{}';
  v_days_left integer := 0;
begin
  c := public.payout_cfg();
  select created_at, banned_until, deactivated_at, deletion_scheduled_at
    into p from public.profiles where id = p_user;
  if not found then
    return jsonb_build_object('eligible', false, 'reasons', jsonb_build_array('no_account'));
  end if;

  if not coalesce(c.active, false) then reasons := reasons || 'payouts_paused'; end if;

  select birth_date into v_birth from public.user_private where user_id = p_user;
  if v_birth is null then
    reasons := reasons || 'no_birth_date';
  elsif v_birth > (current_date - make_interval(years => c.min_age))::date then
    reasons := reasons || 'under_age';
  end if;

  if p.created_at > now() - make_interval(days => c.min_account_age_days) then
    reasons := reasons || 'account_too_new';
    v_days_left := ceil(extract(epoch from (p.created_at + make_interval(days => c.min_account_age_days) - now())) / 86400)::integer;
  end if;

  if (p.banned_until is not null and p.banned_until > now())
     or p.deactivated_at is not null or p.deletion_scheduled_at is not null then
    reasons := reasons || 'account_restricted';
  end if;

  if exists (select 1 from public.wallet_flags f where f.user_id = p_user and f.reviewed_at is null) then
    reasons := reasons || 'account_flagged';
  end if;
  if exists (select 1 from public.creator_payout_holds h where h.user_id = p_user) then
    reasons := reasons || 'on_hold';
  end if;

  select status into v_kyc from public.creator_kyc where user_id = p_user;
  if v_kyc is null then reasons := reasons || 'kyc_missing';
  elsif v_kyc = 'pending' then reasons := reasons || 'kyc_pending';
  elsif v_kyc = 'rejected' then reasons := reasons || 'kyc_rejected';
  end if;

  return jsonb_build_object('eligible', cardinality(reasons) = 0,
                            'reasons', to_jsonb(reasons),
                            'account_days_left', v_days_left);
end;
$fn$;

-- In-app notice to a creator. Title Arabic, body English: the app's generic
-- system row shows "title — body" for kinds it does not know yet.
drop function if exists public.payout_notify(uuid, text, jsonb);
create function public.payout_notify(p_user uuid, p_kind text, p_extra jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_title text;
  v_body  text;
begin
  if p_user is null then return; end if;
  case p_kind
    when 'payout_kyc_approved' then
      v_title := 'تم قبول التحقق من هويتك'; v_body := 'Your payout verification was approved.';
    when 'payout_kyc_rejected' then
      v_title := 'لم يُقبل التحقق من هويتك'; v_body := 'Your payout verification was not approved.';
    when 'payout_withdrawal_approved' then
      v_title := 'تمت الموافقة على طلب السحب'; v_body := 'Your withdrawal was approved.';
    when 'payout_withdrawal_paid' then
      v_title := 'تم تحويل أرباحك'; v_body := 'Your withdrawal was sent to your bank.';
    when 'payout_withdrawal_rejected' then
      v_title := 'تم رفض طلب السحب'; v_body := 'Your withdrawal was declined. The diamonds are back in your balance.';
    else
      v_title := null; v_body := null;
  end case;
  insert into public.notifications (user_id, actor_id, type, payload)
  values (p_user, null, 'system',
          jsonb_build_object('kind', p_kind, 'title', v_title, 'body', v_body) || coalesce(p_extra, '{}'::jsonb));
end;
$fn$;

-- After a withdrawal is PAID: label the oldest available earnings as
-- 'withdrawn' up to the creator's total paid diamonds (bookkeeping only;
-- payout_balance counts available + withdrawn the same way).
drop function if exists public.payout_mark_withdrawn(uuid);
create function public.payout_mark_withdrawn(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_paid bigint;
begin
  select coalesce(sum(diamonds), 0) into v_paid
    from public.creator_withdrawals where user_id = p_user and status = 'paid';
  update public.creator_earnings e
     set status = 'withdrawn', status_changed_at = now()
    from (select id, sum(diamonds) over (order by available_at, created_at, id) as run
            from public.creator_earnings
           where receiver_id = p_user and status in ('available', 'withdrawn')) x
   where e.id = x.id and e.status = 'available' and x.run <= v_paid;
end;
$fn$;

revoke all on function public.payout_cfg()                         from public, anon, authenticated;
revoke all on function public.payout_sender_risk(uuid)             from public, anon, authenticated;
revoke all on function public.payout_gift_funded(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.payout_settle(uuid)                  from public, anon, authenticated;
revoke all on function public.payout_balance(uuid)                 from public, anon, authenticated;
revoke all on function public.payout_eligibility(uuid)             from public, anon, authenticated;
revoke all on function public.payout_notify(uuid, text, jsonb)     from public, anon, authenticated;
revoke all on function public.payout_mark_withdrawn(uuid)          from public, anon, authenticated;
grant execute on function public.payout_settle(uuid) to service_role;


-- ── 8. Earnings from every gift (trigger; send_gift untouched) ──────────
drop function if exists public.creator_earnings_on_gift() cascade;
create function public.creator_earnings_on_gift()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c          public.payout_config;
  v_diamonds integer;
  v_why      text;
begin
  begin
    c := public.payout_cfg();
    v_diamonds := floor(new.amount * coalesce(c.diamonds_per_coin, 1))::integer;
    if v_diamonds <= 0 or new.to_user_id is null then return new; end if;

    if not public.payout_gift_funded(new.from_user_id, new.created_at) then
      v_why := 'unfunded_coins';
    else
      v_why := public.payout_sender_risk(new.from_user_id);
    end if;
    if v_why is null and exists (select 1 from public.creator_payout_holds h where h.user_id = new.to_user_id) then
      v_why := 'creator_on_hold';
    end if;

    insert into public.creator_earnings
           (gift_transaction_id, receiver_id, sender_id, gift_id, coins, diamonds,
            status, withhold_reason, available_at, created_at)
    values (new.id, new.to_user_id, new.from_user_id, new.gift_id, new.amount, v_diamonds,
            case when v_why is null then 'pending' else 'withheld' end, v_why,
            new.created_at + make_interval(days => coalesce(c.hold_days, 7)), new.created_at)
    on conflict (gift_transaction_id) do nothing;
  exception when others then
    -- Never let payouts break a gift. admin_v2_payout_backfill() repairs.
    raise warning 'creator_earnings_on_gift(%): % %', new.id, sqlstate, sqlerrm;
  end;
  return new;
end;
$fn$;
revoke all on function public.creator_earnings_on_gift() from public, anon, authenticated;

drop trigger if exists trg_creator_earnings_on_gift on public.gift_transactions;
create trigger trg_creator_earnings_on_gift
  after insert on public.gift_transactions
  for each row execute function public.creator_earnings_on_gift();


-- ── 9. Refunds and flags withhold the sender's gifts at once ────────────
drop function if exists public.creator_earnings_on_refund() cascade;
create function public.creator_earnings_on_refund()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_days integer := coalesce((select refund_lookback_days from public.payout_config where id), 30);
begin
  if new.user_id is null or new.outcome <> 'reversed' then return new; end if;
  update public.creator_earnings
     set status = 'withheld', withhold_reason = 'sender_refund', status_changed_at = now()
   where sender_id = new.user_id
     and status in ('pending', 'available')
     and released_by is null
     and created_at > now() - make_interval(days => v_days);
  return new;
exception when others then
  raise warning 'creator_earnings_on_refund: % %', sqlstate, sqlerrm;
  return new;
end;
$fn$;
revoke all on function public.creator_earnings_on_refund() from public, anon, authenticated;

drop trigger if exists trg_creator_earnings_on_refund on public.iap_refunds;
create trigger trg_creator_earnings_on_refund
  after insert or update of outcome, user_id on public.iap_refunds
  for each row execute function public.creator_earnings_on_refund();

drop function if exists public.creator_earnings_on_flag() cascade;
create function public.creator_earnings_on_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.reviewed_at is not null then return new; end if;
  update public.creator_earnings
     set status = 'withheld', withhold_reason = 'sender_flagged', status_changed_at = now()
   where sender_id = new.user_id
     and status in ('pending', 'available')
     and released_by is null;
  return new;
exception when others then
  raise warning 'creator_earnings_on_flag: % %', sqlstate, sqlerrm;
  return new;
end;
$fn$;
revoke all on function public.creator_earnings_on_flag() from public, anon, authenticated;

drop trigger if exists trg_creator_earnings_on_flag on public.wallet_flags;
create trigger trg_creator_earnings_on_flag
  after insert or update on public.wallet_flags
  for each row execute function public.creator_earnings_on_flag();


-- ── 10. Creator RPCs (authenticated, own data only) ─────────────────────

drop function if exists public.my_creator_earnings();
create function public.my_creator_earnings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  me     uuid := auth.uid();
  c      public.payout_config;
  b      jsonb;
  el     jsonb;
  k      public.creator_kyc;
  v_open uuid;
  v_avail bigint;
  v_max  numeric;
begin
  if me is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  perform public.payout_settle(me);
  c  := public.payout_cfg();
  b  := public.payout_balance(me);
  el := public.payout_eligibility(me);
  select * into k from public.creator_kyc where user_id = me;
  select id into v_open from public.creator_withdrawals
   where user_id = me and status in ('requested', 'approved') limit 1;

  v_avail := greatest((b->>'available')::bigint, 0);
  v_max   := trunc(v_avail * c.sar_per_diamond, 2);

  return jsonb_build_object(
    'active', c.active,
    'config', jsonb_build_object(
      'sar_per_diamond', c.sar_per_diamond, 'diamonds_per_coin', c.diamonds_per_coin,
      'min_withdraw_sar', c.min_withdraw_sar, 'hold_days', c.hold_days,
      'min_age', c.min_age, 'min_account_age_days', c.min_account_age_days),
    'diamonds', b - 'withdrawn_sar' - 'reserved_sar' - 'next_release_at' - 'next_release_diamonds',
    'next_release_at', b->'next_release_at',
    'next_release_diamonds', b->'next_release_diamonds',
    'sar', jsonb_build_object(
      'available', v_max,
      'pending',   trunc((b->>'pending')::numeric * c.sar_per_diamond, 2),
      'withheld',  trunc((b->>'withheld')::numeric * c.sar_per_diamond, 2),
      'reserved',  (b->>'reserved_sar')::numeric,
      'withdrawn', (b->>'withdrawn_sar')::numeric),
    'max_withdraw_sar', v_max,
    'eligibility', el,
    'open_withdrawal_id', v_open,
    'can_request', (el->>'eligible')::boolean and v_open is null and v_max >= c.min_withdraw_sar,
    'kyc', case when k.id is null then null else jsonb_build_object(
      'status', k.status, 'legal_name', k.legal_name, 'id_type', k.id_type,
      'id_masked', public.payout_mask_id(k.id_number),
      'iban_masked', public.payout_mask_iban(k.iban),
      'bank_name', k.bank_name, 'reject_reason', k.reject_reason,
      'submitted_at', k.submitted_at, 'reviewed_at', k.reviewed_at) end
  );
end;
$fn$;

drop function if exists public.my_creator_withdrawals(integer);
create function public.my_creator_withdrawals(p_limit integer default 50)
returns table (
  id uuid, amount_sar numeric, diamonds integer, status text, iban_masked text, bank_name text,
  bank_reference text, reject_reason text, requested_at timestamptz, approved_at timestamptz,
  paid_at timestamptz, rejected_at timestamptz, cancelled_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
  select w.id, w.amount_sar, w.diamonds, w.status, public.payout_mask_iban(w.iban), w.bank_name,
         w.bank_reference, w.reject_reason, w.requested_at, w.approved_at, w.paid_at,
         w.rejected_at, w.cancelled_at
    from public.creator_withdrawals w
   where w.user_id = auth.uid()
   order by w.requested_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
$fn$;

-- Submit or replace KYC. Allowed when none exists, or it is pending /
-- rejected, or approved with no open withdrawal (a change goes back to
-- review). Errors are stable codes the app translates.
drop function if exists public.creator_submit_kyc(text, text, text, text, text, boolean);
create function public.creator_submit_kyc(
  p_legal_name    text,
  p_id_number     text,
  p_id_photo_path text,
  p_iban          text,
  p_bank_name     text,
  p_owner_attested boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  me      uuid := auth.uid();
  c       public.payout_config;
  v_name  text := regexp_replace(trim(coalesce(p_legal_name, '')), '\s+', ' ', 'g');
  v_id    text := regexp_replace(coalesce(p_id_number, ''), '\s', '', 'g');
  v_iban  text := upper(regexp_replace(coalesce(p_iban, ''), '\s', '', 'g'));
  v_bank  text := trim(coalesce(p_bank_name, ''));
  v_path  text := trim(coalesce(p_id_photo_path, ''));
  v_birth date;
  p       record;
  k       public.creator_kyc;
begin
  if me is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('payout:' || me::text, 0));
  c := public.payout_cfg();

  select created_at, banned_until, deactivated_at, deletion_scheduled_at into p
    from public.profiles where id = me;
  if (p.banned_until is not null and p.banned_until > now())
     or p.deactivated_at is not null or p.deletion_scheduled_at is not null then
    raise exception 'account_restricted';
  end if;
  select birth_date into v_birth from public.user_private where user_id = me;
  if v_birth is null then raise exception 'no_birth_date'; end if;
  if v_birth > (current_date - make_interval(years => c.min_age))::date then
    raise exception 'under_age';
  end if;

  if length(v_name) < 5 or length(v_name) > 120 or v_name !~ ' ' or v_name ~ '[0-9<>{}@#$%^*=_|\\]' then
    raise exception 'invalid_name';
  end if;
  if v_id !~ '^[12][0-9]{9}$' then raise exception 'invalid_id_number'; end if;
  if not public.is_valid_saudi_iban(v_iban) then raise exception 'invalid_iban'; end if;
  if length(v_bank) < 2 or length(v_bank) > 80 then raise exception 'invalid_bank'; end if;
  if not coalesce(p_owner_attested, false) then raise exception 'must_confirm_owner'; end if;

  if v_path = '' or (storage.foldername(v_path))[1] is distinct from me::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'kyc' and o.name = v_path) then
    raise exception 'photo_missing';
  end if;

  -- One person, one payout account.
  if exists (select 1 from public.creator_kyc x
              where x.id_number = v_id and x.user_id is distinct from me and x.status <> 'rejected') then
    raise exception 'id_in_use';
  end if;
  if exists (select 1 from public.creator_kyc x
              where x.iban = v_iban and x.user_id is distinct from me and x.status <> 'rejected') then
    raise exception 'iban_in_use';
  end if;

  select * into k from public.creator_kyc where user_id = me for update;
  if k.id is not null then
    if exists (select 1 from public.creator_withdrawals w
                where w.user_id = me and w.status in ('requested', 'approved')) then
      raise exception 'kyc_locked';
    end if;
    if k.submissions >= 10 then raise exception 'too_many_submissions'; end if;
    update public.creator_kyc
       set legal_name = v_name, id_number = v_id,
           id_type = case when left(v_id, 1) = '1' then 'national_id' else 'iqama' end,
           id_photo_path = v_path, iban = v_iban, bank_name = v_bank, owner_attested = true,
           status = 'pending', reject_reason = null, submissions = submissions + 1,
           submitted_at = now(), reviewed_at = null, reviewed_by = null, updated_at = now()
     where id = k.id;
  else
    insert into public.creator_kyc (user_id, legal_name, id_number, id_type, id_photo_path,
                                    iban, bank_name, owner_attested)
    values (me, v_name, v_id, case when left(v_id, 1) = '1' then 'national_id' else 'iqama' end,
            v_path, v_iban, v_bank, true);
  end if;

  return jsonb_build_object('status', 'pending');
end;
$fn$;

drop function if exists public.creator_request_withdrawal(numeric);
create function public.creator_request_withdrawal(p_amount_sar numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  me       uuid := auth.uid();
  c        public.payout_config;
  el       jsonb;
  b        jsonb;
  k        public.creator_kyc;
  v_amount numeric := p_amount_sar;
  v_need   integer;
  v_avail  bigint;
  v_id     uuid;
begin
  if me is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  -- Serialises this creator's requests, cancels and KYC changes.
  perform pg_advisory_xact_lock(hashtextextended('payout:' || me::text, 0));
  perform public.payout_settle(me);
  c := public.payout_cfg();

  el := public.payout_eligibility(me);
  if not (el->>'eligible')::boolean then
    raise exception 'not_eligible:%', el->'reasons'->>0;
  end if;
  if exists (select 1 from public.creator_withdrawals
              where user_id = me and status in ('requested', 'approved')) then
    raise exception 'open_withdrawal';
  end if;

  if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, 2) then
    raise exception 'bad_amount';
  end if;
  if v_amount < c.min_withdraw_sar then raise exception 'below_minimum'; end if;

  b := public.payout_balance(me);
  v_avail := (b->>'available')::bigint;
  v_need  := ceil(v_amount / c.sar_per_diamond)::integer;
  if v_need > v_avail then raise exception 'above_available'; end if;

  select * into k from public.creator_kyc where user_id = me and status = 'approved';
  if k.id is null then raise exception 'not_eligible:kyc_missing'; end if;

  insert into public.creator_withdrawals
         (user_id, kyc_id, amount_sar, diamonds, sar_per_diamond, legal_name, iban, bank_name)
  values (me, k.id, v_amount, v_need, c.sar_per_diamond, k.legal_name, k.iban, k.bank_name)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'status', 'requested',
                            'amount_sar', v_amount, 'diamonds', v_need);
end;
$fn$;

drop function if exists public.creator_cancel_withdrawal(uuid);
create function public.creator_cancel_withdrawal(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('payout:' || me::text, 0));
  update public.creator_withdrawals
     set status = 'cancelled', cancelled_at = now(), updated_at = now()
   where id = p_id and user_id = me and status = 'requested';
  if not found then raise exception 'cannot_cancel'; end if;
end;
$fn$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.my_creator_earnings()',
    'public.my_creator_withdrawals(integer)',
    'public.creator_submit_kyc(text, text, text, text, text, boolean)',
    'public.creator_request_withdrawal(numeric)',
    'public.creator_cancel_withdrawal(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;


-- ── 11. Admin RPCs (is_admin(), admin_logs in the same transaction) ─────

drop function if exists public.admin_v2_payout_overview();
create function public.admin_v2_payout_overview()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c  public.payout_config;
  v_month timestamptz := date_trunc('month', now());
  v_owed_d bigint;
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  perform public.payout_settle(null);
  c := public.payout_cfg();

  -- Owed = diamonds earned and withdrawable that have not been paid out yet
  -- (available + reserved in open requests).
  select coalesce(sum(diamonds) filter (where status in ('available', 'withdrawn')), 0)
         - coalesce((select sum(diamonds) from public.creator_withdrawals where status = 'paid'), 0)
    into v_owed_d
    from public.creator_earnings;

  return jsonb_build_object(
    'config', to_jsonb(c),
    'owed_diamonds', v_owed_d,
    'owed_sar', trunc(v_owed_d * c.sar_per_diamond, 2),
    'on_hold_diamonds', (select coalesce(sum(diamonds), 0) from public.creator_earnings where status = 'pending'),
    'withheld_diamonds', (select coalesce(sum(diamonds), 0) from public.creator_earnings where status = 'withheld'),
    'requested', (select jsonb_build_object('count', count(*), 'sar', coalesce(sum(amount_sar), 0))
                    from public.creator_withdrawals where status = 'requested'),
    'approved',  (select jsonb_build_object('count', count(*), 'sar', coalesce(sum(amount_sar), 0))
                    from public.creator_withdrawals where status = 'approved'),
    'paid_this_month', (select jsonb_build_object('count', count(*), 'sar', coalesce(sum(amount_sar), 0))
                          from public.creator_withdrawals where status = 'paid' and paid_at >= v_month),
    'paid_all_time',   (select jsonb_build_object('count', count(*), 'sar', coalesce(sum(amount_sar), 0))
                          from public.creator_withdrawals where status = 'paid'),
    'kyc_pending', (select count(*) from public.creator_kyc where status = 'pending'),
    'creators_on_hold', (select count(*) from public.creator_payout_holds),
    'top_owed', (
      select coalesce(jsonb_agg(x order by x.owed desc), '[]'::jsonb) from (
        select e.receiver_id as user_id, p.handle, p.name,
               sum(e.diamonds) filter (where e.status in ('available', 'withdrawn'))
                 - coalesce((select sum(w.diamonds) from public.creator_withdrawals w
                              where w.user_id = e.receiver_id and w.status = 'paid'), 0) as owed
          from public.creator_earnings e
          left join public.profiles p on p.id = e.receiver_id
         group by e.receiver_id, p.handle, p.name
         order by 4 desc nulls last
         limit 10) x)
  );
end;
$fn$;

drop function if exists public.admin_v2_kyc_list(text, integer, integer);
create function public.admin_v2_kyc_list(
  p_status text default 'pending', p_limit integer default 50, p_offset integer default 0
)
returns table (
  id uuid, user_id uuid, handle text, name text, account_created_at timestamptz,
  legal_name text, id_number text, id_type text, iban text, bank_name text, owner_attested boolean,
  status text, reject_reason text, submissions integer, submitted_at timestamptz,
  reviewed_at timestamptz, reviewed_by_handle text, birth_date date,
  same_id_accounts bigint, same_iban_accounts bigint, flagged boolean
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  return query
  select k.id, k.user_id, p.handle, p.name, p.created_at,
         k.legal_name, k.id_number, k.id_type, k.iban, k.bank_name, k.owner_attested,
         k.status, k.reject_reason, k.submissions, k.submitted_at,
         k.reviewed_at, rp.handle, up.birth_date,
         (select count(*) from public.creator_kyc x where x.id_number = k.id_number and x.id <> k.id),
         (select count(*) from public.creator_kyc x where x.iban = k.iban and x.id <> k.id),
         exists (select 1 from public.wallet_flags f where f.user_id = k.user_id and f.reviewed_at is null)
    from public.creator_kyc k
    left join public.profiles p  on p.id = k.user_id
    left join public.profiles rp on rp.id = k.reviewed_by
    left join public.user_private up on up.user_id = k.user_id
   where coalesce(p_status, 'all') = 'all' or k.status = p_status
   order by k.submitted_at asc
   limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(coalesce(p_offset, 0), 0);
end;
$fn$;

-- Returns where the ID photo is. The panel then calls
--   supabase.storage.from('kyc').createSignedUrl(path, 120)
-- with the admin's own session ("kyc admin read" storage policy). Every view
-- is logged.
drop function if exists public.admin_v2_kyc_document(uuid);
create function public.admin_v2_kyc_document(p_kyc_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare k public.creator_kyc;
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into k from public.creator_kyc where id = p_kyc_id;
  if k.id is null then raise exception 'no such kyc'; end if;
  insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
  values (auth.uid(), 'kyc_view_document', 'user', k.user_id, jsonb_build_object('kyc_id', k.id));
  return jsonb_build_object('bucket', 'kyc', 'path', k.id_photo_path, 'expires_in', 120);
end;
$fn$;

drop function if exists public.admin_v2_kyc_review(uuid, boolean, text);
create function public.admin_v2_kyc_review(p_kyc_id uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  k public.creator_kyc;
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 500), '');
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into k from public.creator_kyc where id = p_kyc_id for update;
  if k.id is null then raise exception 'no such kyc'; end if;
  if k.user_id = auth.uid() then raise exception 'you cannot review your own verification'; end if;
  if not coalesce(p_approve, false) and v_reason is null then raise exception 'a reason is required'; end if;

  update public.creator_kyc
     set status = case when p_approve then 'approved' else 'rejected' end,
         reject_reason = case when p_approve then null else v_reason end,
         reviewed_at = now(), reviewed_by = auth.uid(), updated_at = now()
   where id = k.id;

  insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
  values (auth.uid(), case when p_approve then 'kyc_approve' else 'kyc_reject' end, 'user', k.user_id,
          jsonb_build_object('kyc_id', k.id, 'reason', v_reason));

  perform public.payout_notify(k.user_id,
    case when p_approve then 'payout_kyc_approved' else 'payout_kyc_rejected' end,
    case when p_approve then '{}'::jsonb else jsonb_build_object('reason', v_reason) end);
end;
$fn$;

drop function if exists public.admin_v2_payout_withdrawals(text, integer, integer);
create function public.admin_v2_payout_withdrawals(
  p_status text default 'requested', p_limit integer default 50, p_offset integer default 0
)
returns table (
  id uuid, user_id uuid, handle text, name text, amount_sar numeric, diamonds integer,
  sar_per_diamond numeric, legal_name text, iban text, bank_name text, status text,
  bank_reference text, reject_reason text, admin_note text, requested_at timestamptz,
  approved_at timestamptz, paid_at timestamptz, rejected_at timestamptz, cancelled_at timestamptz,
  creator_available_diamonds bigint, creator_withheld_diamonds bigint,
  kyc_status text, eligibility jsonb, flagged boolean, on_hold boolean
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  perform public.payout_settle(null);
  return query
  select w.id, w.user_id, p.handle, p.name, w.amount_sar, w.diamonds, w.sar_per_diamond,
         w.legal_name, w.iban, w.bank_name, w.status, w.bank_reference, w.reject_reason, w.admin_note,
         w.requested_at, w.approved_at, w.paid_at, w.rejected_at, w.cancelled_at,
         (public.payout_balance(w.user_id)->>'available')::bigint,
         (public.payout_balance(w.user_id)->>'withheld')::bigint,
         (select k.status from public.creator_kyc k where k.user_id = w.user_id),
         case when w.user_id is null then null else public.payout_eligibility(w.user_id) end,
         exists (select 1 from public.wallet_flags f where f.user_id = w.user_id and f.reviewed_at is null),
         exists (select 1 from public.creator_payout_holds h where h.user_id = w.user_id)
    from public.creator_withdrawals w
    left join public.profiles p on p.id = w.user_id
   where coalesce(p_status, 'all') = 'all' or w.status = p_status
   order by w.requested_at asc
   limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(coalesce(p_offset, 0), 0);
end;
$fn$;

drop function if exists public.admin_v2_payout_approve(uuid, text);
create function public.admin_v2_payout_approve(p_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare w public.creator_withdrawals;
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into w from public.creator_withdrawals where id = p_id for update;
  if w.id is null then raise exception 'no such withdrawal'; end if;
  if w.user_id = auth.uid() then raise exception 'you cannot approve your own withdrawal'; end if;
  if w.status <> 'requested' then raise exception 'withdrawal is %', w.status; end if;

  update public.creator_withdrawals
     set status = 'approved', approved_at = now(), approved_by = auth.uid(),
         admin_note = coalesce(nullif(trim(p_note), ''), admin_note), updated_at = now()
   where id = w.id;

  insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
  values (auth.uid(), 'payout_approve', 'user', w.user_id,
          jsonb_build_object('withdrawal_id', w.id, 'amount_sar', w.amount_sar, 'note', p_note));
  perform public.payout_notify(w.user_id, 'payout_withdrawal_approved',
                               jsonb_build_object('withdrawal_id', w.id, 'amount_sar', w.amount_sar));
end;
$fn$;

drop function if exists public.admin_v2_payout_mark_paid(uuid, text);
create function public.admin_v2_payout_mark_paid(p_id uuid, p_reference text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  w     public.creator_withdrawals;
  v_ref text := nullif(left(trim(coalesce(p_reference, '')), 120), '');
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  if v_ref is null then raise exception 'a bank reference is required'; end if;
  select * into w from public.creator_withdrawals where id = p_id for update;
  if w.id is null then raise exception 'no such withdrawal'; end if;
  if w.user_id = auth.uid() then raise exception 'you cannot pay your own withdrawal'; end if;
  if w.status <> 'approved' then raise exception 'withdrawal is % (approve it first)', w.status; end if;

  update public.creator_withdrawals
     set status = 'paid', paid_at = now(), paid_by = auth.uid(), bank_reference = v_ref, updated_at = now()
   where id = w.id;
  if w.user_id is not null then perform public.payout_mark_withdrawn(w.user_id); end if;

  insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
  values (auth.uid(), 'payout_paid', 'user', w.user_id,
          jsonb_build_object('withdrawal_id', w.id, 'amount_sar', w.amount_sar, 'reference', v_ref));
  perform public.payout_notify(w.user_id, 'payout_withdrawal_paid',
                               jsonb_build_object('withdrawal_id', w.id, 'amount_sar', w.amount_sar));
end;
$fn$;

drop function if exists public.admin_v2_payout_reject(uuid, text);
create function public.admin_v2_payout_reject(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  w        public.creator_withdrawals;
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 500), '');
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  if v_reason is null then raise exception 'a reason is required'; end if;
  select * into w from public.creator_withdrawals where id = p_id for update;
  if w.id is null then raise exception 'no such withdrawal'; end if;
  if w.status not in ('requested', 'approved') then raise exception 'withdrawal is %', w.status; end if;

  -- The reserved diamonds return to available simply because the row no
  -- longer counts as reserved (payout_balance).
  update public.creator_withdrawals
     set status = 'rejected', rejected_at = now(), rejected_by = auth.uid(),
         reject_reason = v_reason, updated_at = now()
   where id = w.id;

  insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
  values (auth.uid(), 'payout_reject', 'user', w.user_id,
          jsonb_build_object('withdrawal_id', w.id, 'amount_sar', w.amount_sar, 'reason', v_reason,
                             'was', w.status));
  perform public.payout_notify(w.user_id, 'payout_withdrawal_rejected',
                               jsonb_build_object('withdrawal_id', w.id, 'amount_sar', w.amount_sar,
                                                  'reason', v_reason));
end;
$fn$;

drop function if exists public.admin_v2_payout_set_config(numeric, numeric, numeric, integer, integer, integer, integer, boolean);
create function public.admin_v2_payout_set_config(
  p_diamonds_per_coin    numeric default null,
  p_sar_per_diamond      numeric default null,
  p_min_withdraw_sar     numeric default null,
  p_hold_days            integer default null,
  p_min_account_age_days integer default null,
  p_min_age              integer default null,
  p_refund_lookback_days integer default null,
  p_active               boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_old public.payout_config;
  v_new public.payout_config;
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into v_old from public.payout_config where id for update;

  update public.payout_config
     set diamonds_per_coin    = coalesce(p_diamonds_per_coin, diamonds_per_coin),
         sar_per_diamond      = coalesce(p_sar_per_diamond, sar_per_diamond),
         min_withdraw_sar     = coalesce(p_min_withdraw_sar, min_withdraw_sar),
         hold_days            = coalesce(p_hold_days, hold_days),
         min_account_age_days = coalesce(p_min_account_age_days, min_account_age_days),
         min_age              = coalesce(p_min_age, min_age),
         refund_lookback_days = coalesce(p_refund_lookback_days, refund_lookback_days),
         active               = coalesce(p_active, active),
         updated_at = now(), updated_by = auth.uid()
   where id
  returning * into v_new;

  insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
  values (auth.uid(), 'payout_config', 'payout_config', null,
          jsonb_build_object('old', to_jsonb(v_old), 'new', to_jsonb(v_new)));
  return to_jsonb(v_new);
end;
$fn$;

-- Withhold (p_hold true) or release (false) a creator's earnings.
drop function if exists public.admin_v2_payout_hold(uuid, boolean, text);
create function public.admin_v2_payout_hold(p_user uuid, p_hold boolean, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 500), '');
  n integer;
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'no such user'; end if;
  perform pg_advisory_xact_lock(hashtextextended('payout:' || p_user::text, 0));

  if coalesce(p_hold, true) then
    if v_reason is null then raise exception 'a reason is required'; end if;
    insert into public.creator_payout_holds (user_id, reason, held_by)
    values (p_user, v_reason, auth.uid())
    on conflict (user_id) do update set reason = excluded.reason, held_by = excluded.held_by, held_at = now();
    update public.creator_earnings
       set status = 'withheld', withhold_reason = 'creator_on_hold', released_by = null,
           status_changed_at = now()
     where receiver_id = p_user and status in ('pending', 'available');
    get diagnostics n = row_count;
  else
    delete from public.creator_payout_holds where user_id = p_user;
    -- An explicit admin release: the automatic sender checks no longer apply
    -- to these rows (released_by is set).
    update public.creator_earnings
       set status = case when available_at <= now() then 'available' else 'pending' end,
           withhold_reason = null, released_by = auth.uid(), status_changed_at = now()
     where receiver_id = p_user and status = 'withheld';
    get diagnostics n = row_count;
  end if;

  insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
  values (auth.uid(), case when coalesce(p_hold, true) then 'payout_hold' else 'payout_release' end,
          'user', p_user, jsonb_build_object('reason', v_reason, 'rows', n));
  return jsonb_build_object('rows', n);
end;
$fn$;

-- One earnings row: withhold, release or reverse.
drop function if exists public.admin_v2_payout_set_earning(uuid, text, text);
create function public.admin_v2_payout_set_earning(p_earning_id uuid, p_action text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  e public.creator_earnings;
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 500), '');
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into e from public.creator_earnings where id = p_earning_id for update;
  if e.id is null then raise exception 'no such earning'; end if;
  if e.status = 'withdrawn' then raise exception 'already paid out'; end if;

  if p_action = 'withhold' then
    if v_reason is null then raise exception 'a reason is required'; end if;
    update public.creator_earnings
       set status = 'withheld', withhold_reason = 'admin: ' || v_reason, released_by = null,
           status_changed_at = now()
     where id = e.id;
  elsif p_action = 'release' then
    update public.creator_earnings
       set status = case when available_at <= now() then 'available' else 'pending' end,
           withhold_reason = null, released_by = auth.uid(), status_changed_at = now()
     where id = e.id;
  elsif p_action = 'reverse' then
    if v_reason is null then raise exception 'a reason is required'; end if;
    update public.creator_earnings
       set status = 'reversed', withhold_reason = 'admin: ' || v_reason, status_changed_at = now()
     where id = e.id;
  else
    raise exception 'action must be withhold, release or reverse';
  end if;

  insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
  values (auth.uid(), 'payout_earning_' || p_action, 'user', e.receiver_id,
          jsonb_build_object('earning_id', e.id, 'diamonds', e.diamonds, 'was', e.status, 'reason', v_reason));
end;
$fn$;

-- Everything about one creator, for the detail drawer.
drop function if exists public.admin_v2_payout_creator(uuid);
create function public.admin_v2_payout_creator(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare c public.payout_config;
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  perform public.payout_settle(p_user);
  c := public.payout_cfg();
  return jsonb_build_object(
    'balance', public.payout_balance(p_user),
    'sar_per_diamond', c.sar_per_diamond,
    'eligibility', public.payout_eligibility(p_user),
    'hold', (select to_jsonb(h) from public.creator_payout_holds h where h.user_id = p_user),
    'kyc', (select jsonb_build_object('id', k.id, 'status', k.status, 'legal_name', k.legal_name,
                                      'iban', k.iban, 'bank_name', k.bank_name, 'submitted_at', k.submitted_at)
              from public.creator_kyc k where k.user_id = p_user),
    'withheld_by_reason', (
      select coalesce(jsonb_object_agg(coalesce(withhold_reason, '?'), d), '{}'::jsonb)
        from (select withhold_reason, sum(diamonds) as d from public.creator_earnings
               where receiver_id = p_user and status = 'withheld' group by 1) s),
    'top_senders', (
      select coalesce(jsonb_agg(x order by x.diamonds desc), '[]'::jsonb) from (
        select e.sender_id, p.handle, sum(e.diamonds) as diamonds, count(*) as gifts,
               exists (select 1 from public.wallet_flags f where f.user_id = e.sender_id and f.reviewed_at is null) as flagged
          from public.creator_earnings e left join public.profiles p on p.id = e.sender_id
         where e.receiver_id = p_user and e.status <> 'reversed'
         group by e.sender_id, p.handle order by 3 desc limit 10) x),
    'recent_earnings', (
      select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb) from (
        select id, gift_transaction_id, sender_id, gift_id, coins, diamonds, status, withhold_reason,
               available_at, released_by, created_at
          from public.creator_earnings where receiver_id = p_user
         order by created_at desc limit 100) e),
    'withdrawals', (
      select coalesce(jsonb_agg(to_jsonb(w) order by w.requested_at desc), '[]'::jsonb) from (
        select id, amount_sar, diamonds, status, bank_reference, reject_reason, requested_at, paid_at
          from public.creator_withdrawals where user_id = p_user
         order by requested_at desc limit 50) w)
  );
end;
$fn$;

-- Creates earnings rows for gifts that have none (the trigger failed, or
-- gifts sent before 0130 if the owner decides they count). Same rules as
-- the trigger; hold counted from the gift's own time.
drop function if exists public.admin_v2_payout_backfill(timestamptz);
create function public.admin_v2_payout_backfill(p_since timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c   public.payout_config;
  g   record;
  why text;
  n   integer := 0;
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_since is null then raise exception 'p_since is required'; end if;
  c := public.payout_cfg();
  for g in
    select t.* from public.gift_transactions t
     where t.created_at >= p_since
       and not exists (select 1 from public.creator_earnings e where e.gift_transaction_id = t.id)
     order by t.created_at
  loop
    if floor(g.amount * c.diamonds_per_coin) <= 0 then continue; end if;
    why := case when not public.payout_gift_funded(g.from_user_id, g.created_at) then 'unfunded_coins'
                else public.payout_sender_risk(g.from_user_id) end;
    if why is null and exists (select 1 from public.creator_payout_holds h where h.user_id = g.to_user_id) then
      why := 'creator_on_hold';
    end if;
    insert into public.creator_earnings
           (gift_transaction_id, receiver_id, sender_id, gift_id, coins, diamonds,
            status, withhold_reason, available_at, created_at)
    values (g.id, g.to_user_id, g.from_user_id, g.gift_id, g.amount,
            floor(g.amount * c.diamonds_per_coin)::integer,
            case when why is null then 'pending' else 'withheld' end, why,
            g.created_at + make_interval(days => c.hold_days), g.created_at)
    on conflict (gift_transaction_id) do nothing;
    n := n + 1;
  end loop;
  insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
  values (auth.uid(), 'payout_backfill', 'payout_config', null,
          jsonb_build_object('since', p_since, 'rows', n));
  return jsonb_build_object('rows', n);
end;
$fn$;

-- Grants for every admin_v2_ function (same loop as 0128; covers this file's).
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'admin\_v2\_%'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

commit;


-- ── 12. Schedule: release due holds every hour at :23 ───────────────────
do $sched$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not enabled - hold release stays lazy (it runs on every creator / admin read).';
    return;
  end if;
  perform cron.unschedule('creator-earnings-release')
   where exists (select 1 from cron.job where jobname = 'creator-earnings-release');
  perform cron.schedule('creator-earnings-release', '23 * * * *',
                        $job$ select public.payout_settle(null); $job$);
end;
$sched$;


-- ============================================================
-- VERIFY - every row should read OK
-- ============================================================
select 'payout tables exist' as check,
       case when to_regclass('public.payout_config') is not null
             and to_regclass('public.creator_earnings') is not null
             and to_regclass('public.creator_kyc') is not null
             and to_regclass('public.creator_withdrawals') is not null
             and to_regclass('public.creator_payout_holds') is not null
            then 'OK' else 'MISSING' end as result
union all select 'payout_config row',
       case when (select count(*) from public.payout_config) = 1 then 'OK' else 'MISSING' end
union all select 'sar_per_diamond = ' || (select sar_per_diamond::text from public.payout_config where id),
       case when (select sar_per_diamond from public.payout_config where id) between 0.0001 and 1
            then 'OK' else 'CHECK BY HAND' end
union all select 'payout tables have RLS',
       case when (select bool_and(relrowsecurity) from pg_class
                   where oid in ('public.payout_config'::regclass, 'public.creator_earnings'::regclass,
                                 'public.creator_kyc'::regclass, 'public.creator_withdrawals'::regclass,
                                 'public.creator_payout_holds'::regclass))
            then 'OK' else 'RLS OFF' end
union all select 'users cannot read or write KYC / withdrawals directly',
       case when not has_table_privilege('authenticated', 'public.creator_kyc', 'select')
             and not has_table_privilege('authenticated', 'public.creator_kyc', 'insert')
             and not has_table_privilege('anon', 'public.creator_kyc', 'select')
             and not has_table_privilege('authenticated', 'public.creator_withdrawals', 'select')
             and not has_table_privilege('authenticated', 'public.creator_withdrawals', 'insert')
             and not has_table_privilege('authenticated', 'public.creator_earnings', 'insert')
             and not has_table_privilege('authenticated', 'public.creator_earnings', 'update')
             and not has_table_privilege('authenticated', 'public.payout_config', 'update')
            then 'OK' else 'EXPOSED' end
union all select 'kyc bucket is private',
       case when exists (select 1 from storage.buckets where id = 'kyc' and not public)
            then 'OK' else 'MISSING OR PUBLIC' end
union all select 'kyc storage policies (own write, own read, admin read; no update/delete)',
       case when (select count(*) from pg_policies
                   where schemaname = 'storage' and tablename = 'objects'
                     and policyname in ('kyc own write', 'kyc own read', 'kyc admin read')) = 3
             and not exists (select 1 from pg_policies
                              where schemaname = 'storage' and tablename = 'objects'
                                and cmd in ('UPDATE', 'DELETE', 'ALL')
                                and (coalesce(qual, '') like '%''kyc''%' or coalesce(qual, '') not like '%bucket_id%'))
            then 'OK' else 'CHECK storage.objects POLICIES' end
union all select 'gift trigger',
       case when exists (select 1 from pg_trigger where tgname = 'trg_creator_earnings_on_gift'
                          and tgrelid = 'public.gift_transactions'::regclass)
            then 'OK' else 'MISSING' end
union all select 'refund + flag triggers',
       case when (select count(*) from pg_trigger
                   where tgname in ('trg_creator_earnings_on_refund', 'trg_creator_earnings_on_flag')) = 2
            then 'OK' else 'MISSING' end
union all select 'send_gift unchanged (still refuses a short balance)',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'send_gift'
                            and p.prosrc like '%v_balance < v_price%')
            then 'OK' else 'CHECK send_gift BY HAND' end
union all select 'IBAN check: SA0380000000608010167519 valid, ...518 invalid',
       case when public.is_valid_saudi_iban('SA03 8000 0000 6080 1016 7519')
             and not public.is_valid_saudi_iban('SA0380000000608010167518')
            then 'OK' else 'BROKEN' end
union all select 'creator RPCs callable by authenticated, not anon',
       case when has_function_privilege('authenticated', 'public.my_creator_earnings()', 'execute')
             and has_function_privilege('authenticated', 'public.creator_request_withdrawal(numeric)', 'execute')
             and not has_function_privilege('anon', 'public.my_creator_earnings()', 'execute')
             and not has_function_privilege('anon', 'public.creator_submit_kyc(text,text,text,text,text,boolean)', 'execute')
            then 'OK' else 'EXPOSED' end
union all select 'internal payout helpers not callable by users',
       case when not has_function_privilege('authenticated', 'public.payout_settle(uuid)', 'execute')
             and not has_function_privilege('authenticated', 'public.payout_notify(uuid,text,jsonb)', 'execute')
             and not has_function_privilege('authenticated', 'public.payout_balance(uuid)', 'execute')
             and not has_function_privilege('authenticated', 'public.payout_eligibility(uuid)', 'execute')
            then 'OK' else 'EXPOSED' end
union all select 'every payout admin function is SECURITY DEFINER and checks is_admin()',
       case when not exists (
              select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public'
                 and (p.proname like 'admin\_v2\_payout\_%' or p.proname like 'admin\_v2\_kyc\_%')
                 and (not p.prosecdef or pg_get_functiondef(p.oid) not like '%is_admin()%'))
             and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and (p.proname like 'admin\_v2\_payout\_%' or p.proname like 'admin\_v2\_kyc\_%')) = 13
            then 'OK' else 'CHECK' end
union all select 'notifications allow system',
       case when exists (select 1 from pg_constraint
                          where conrelid = 'public.notifications'::regclass and contype = 'c'
                            and pg_get_constraintdef(oid) ~ '[{,'']system[},'']')
              or not exists (select 1 from pg_constraint
                              where conrelid = 'public.notifications'::regclass
                                and conname = 'notifications_type_check')
            then 'OK' else 'MISSING' end
order by 1;

-- Behavioural test (as a NON-admin through the API):
--   rpc('admin_v2_payout_overview')      -> 42501 'not permitted'
--   from('creator_kyc').select('*')      -> permission denied
--   rpc('my_creator_earnings')           -> your own summary
-- Where pg_cron is enabled:
--   select jobname, schedule, active from cron.job where jobname = 'creator-earnings-release';
