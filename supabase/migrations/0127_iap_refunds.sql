-- 0127 - store refunds and chargebacks take the coins back
--
-- ============================================================
-- THE PROBLEM
-- ============================================================
-- Coins are credited once the store confirms a purchase (verify-purchase ->
-- credit_wallet_topup, 0104/0111). Nothing ever looked at the store again, so
-- a buyer could:
--   1. buy 6500 coins,
--   2. send them all away as live gifts (send_gift, 0104),
--   3. ask Apple / Google for a refund (or charge back the card),
-- and keep the gifts' effect while getting the money back. verify-purchase
-- already refuses a purchase that is refunded BEFORE it is credited (Apple
-- revocationDate, Google purchaseState = 1); this handles refunds AFTER.
--
-- ============================================================
-- WHAT THIS ADDS
-- ============================================================
-- 1. wallet_topups.refunded_at / refund_reason. A refunded top-up keeps its
--    status ('credited' stays 'credited': credit_wallet_topup then answers
--    "already credited" and never pays it out twice). A refunded 'pending'
--    top-up (a Google cash payment that was voided) becomes 'rejected', so it
--    can never be credited later.
--
-- 2. reverse_wallet_topup(p_store_transaction_id, p_reason, ...) - service
--    role ONLY. Called by the Edge Functions play-voided-purchases (Google
--    Voided Purchases API, polled) and apple-notifications (App Store Server
--    Notifications V2). Idempotent on the store transaction id:
--      credited  -> wallet balance -= the coins credited, ledger row type
--                   'refund', refunded_at set. THE BALANCE MAY GO NEGATIVE
--                   (the coins were already spent): send_gift refuses while
--                   balance < price (0104: `if v_balance < v_price`), so the
--                   account cannot gift again until a new top-up covers it.
--      pending   -> status 'rejected', nothing to take back.
--      rejected  -> only stamped.
--      already refunded -> nothing (outcome 'already_reversed').
--      no top-up -> a tombstone in iap_refunds; a later attempt to record
--                   that transaction (credit_wallet_topup, or
--                   verify-purchase's pending insert) is turned into a
--                   'rejected' row by trg_wallet_topups_refund_tombstone, so
--                   a refund that arrives first cannot be followed by a
--                   credit.
--    Google rows may be matched by order id (store_order_id, 0111) when the
--    'gp:'+sha256(token) id is not found.
--
-- 3. iap_refunds    one row per refunded store transaction: what happened,
--                   how many coins were taken back, the balance after. Admin
--                   read only. Also the tombstone list for (2).
--    wallet_flags   accounts to review: refunded twice or more, or left with
--                   a negative balance by a refund (spent coins that were
--                   then refunded - the abuse this exists for). Admin read,
--                   admin may mark reviewed. Nothing is blocked automatically
--                   beyond the negative balance itself.
--
-- 4. wallet_transactions.type gains 'refund' (amount positive, like
--    'gift_sent': the type says the coins went OUT). The constraint is
--    EXTENDED from what it allows today, as 0104 did for notifications.
--
-- 5. iap_poll_state: the Google poller's cursor (high-water time, a page
--    token to resume an interrupted run, a short lease so two runs do not
--    overlap, last result). Service role only.
--
-- 6. job_endpoints row 'play-voided-purchases' (copied from 'send-push' with
--    the path swapped, the 0087/0110 trick: same x-reconcile-secret and
--    apikey) and a pg_cron job every 6 hours at :41, guarded on pg_cron.
--
-- NOT CLAWED BACK: coins the refunder gave away stay with the recipients.
-- There is no withdrawal / creator payout yet; when there is, it must look
-- at iap_refunds / wallet_flags (and at environment = 'sandbox', 0111).
--
-- admin_adjust_wallet (0005) clamps the result at 0: a positive adjustment
-- on a negative balance wipes the debt. Adjust negative balances knowingly.
--
-- ============================================================
-- APPLYING
-- ============================================================
-- AFTER 0104, 0111 (wallet_topups) and 0087 / 0090 (job_endpoints,
-- call_job_endpoint). Independent of 0126. Safe to re-run. Deploy the
-- function first so the first scheduled call finds it:
--   npx supabase functions deploy play-voided-purchases --no-verify-jwt
--   npx supabase functions deploy apple-notifications   --no-verify-jwt
-- The schedule block is outside the transaction and does nothing (with a
-- notice) without pg_cron. Check queries at the end.

begin;

-- ============================================================
-- 1. Refund columns on wallet_topups
-- ============================================================
alter table public.wallet_topups add column if not exists refunded_at   timestamptz;
alter table public.wallet_topups add column if not exists refund_reason text;

create index if not exists idx_wallet_topups_refunded
  on public.wallet_topups (refunded_at desc)
  where refunded_at is not null;

-- ============================================================
-- 2. Ledger type 'refund'
-- ============================================================
do $$
declare
  v_name  text;
  v_def   text;
  v_types text[];
begin
  -- 0001 declared the check inline, so Postgres named it
  -- wallet_transactions_type_check; fall back to any check on "type".
  select c.conname, pg_get_constraintdef(c.oid) into v_name, v_def
    from pg_constraint c
   where c.conrelid = 'public.wallet_transactions'::regclass
     and c.contype  = 'c'
     and (c.conname = 'wallet_transactions_type_check'
          or pg_get_constraintdef(c.oid) like '%gift_sent%')
   order by (c.conname = 'wallet_transactions_type_check') desc
   limit 1;

  -- The definition reads either as a list of quoted values
  -- (... 'topup'::text, 'gift_sent'::text ...) or, once this file has run,
  -- as one array literal ('{gift_received,gift_sent,...}'::text[]). Split
  -- every quoted piece on commas and braces so both give the same list.
  select coalesce(array_agg(distinct v) filter (where v <> ''), '{}')
    into v_types
    from regexp_matches(coalesce(v_def, ''), '''([^'']+)''', 'g') as m,
         lateral unnest(regexp_split_to_array(m[1], '[{},"\s]+')) as v;

  if 'refund' = any (v_types) then return; end if;

  if cardinality(v_types) = 0 then
    v_types := array['topup', 'gift_sent', 'gift_received', 'withdrawal'];
  end if;
  v_types := v_types || array['refund'];

  if v_name is not null then
    execute format('alter table public.wallet_transactions drop constraint %I', v_name);
  end if;
  execute format(
    'alter table public.wallet_transactions add constraint wallet_transactions_type_check check (type = any (%L::text[]))',
    v_types);
end $$;

-- ============================================================
-- 3. iap_refunds (record + tombstones)
-- ============================================================
create table if not exists public.iap_refunds (
  store_transaction_id text primary key,
  platform             text not null check (platform in ('ios', 'android')),
  topup_id             uuid references public.wallet_topups (id) on delete set null,
  user_id              uuid references public.profiles (id) on delete set null,
  outcome              text not null,
  coins_reversed       integer not null default 0 check (coins_reversed >= 0),
  balance_after        integer,
  reason               text,
  store_order_id       text,
  refunded_at          timestamptz,           -- the store's time, when known
  recorded_at          timestamptz not null default now(),
  detail               jsonb not null default '{}'::jsonb
);

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.iap_refunds'::regclass
                    and conname  = 'iap_refunds_outcome_check') then
    alter table public.iap_refunds
      add constraint iap_refunds_outcome_check
      check (outcome in ('reversed', 'cancelled_pending', 'not_credited',
                         'not_found', 'blocked_before_credit'));
  end if;
end $$;

create index if not exists idx_iap_refunds_user on public.iap_refunds (user_id, recorded_at desc);
create index if not exists idx_iap_refunds_order on public.iap_refunds (store_order_id)
  where store_order_id is not null;

alter table public.iap_refunds enable row level security;
revoke all on public.iap_refunds from anon, authenticated;
grant select on public.iap_refunds to authenticated;          -- admins only, via RLS
grant all on public.iap_refunds to service_role;

drop policy if exists "iap refunds admin read" on public.iap_refunds;
create policy "iap refunds admin read" on public.iap_refunds
  for select to authenticated
  using (public.is_admin());

-- ============================================================
-- 4. wallet_flags (accounts to review)
-- ============================================================
create table if not exists public.wallet_flags (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  refund_count   integer not null default 0,
  refunded_coins integer not null default 0,
  reason         text,
  flagged_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  reviewed_at    timestamptz,
  reviewed_by    uuid references public.profiles (id) on delete set null,
  review_note    text
);

create index if not exists idx_wallet_flags_open
  on public.wallet_flags (updated_at desc) where reviewed_at is null;

alter table public.wallet_flags enable row level security;
revoke all on public.wallet_flags from anon, authenticated;
grant select on public.wallet_flags to authenticated;          -- admins only, via RLS
grant update (reviewed_at, reviewed_by, review_note) on public.wallet_flags to authenticated;
grant all on public.wallet_flags to service_role;

drop policy if exists "wallet flags admin read" on public.wallet_flags;
create policy "wallet flags admin read" on public.wallet_flags
  for select to authenticated
  using (public.is_admin());

drop policy if exists "wallet flags admin review" on public.wallet_flags;
create policy "wallet flags admin review" on public.wallet_flags
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- 5. Google poller state
-- ============================================================
create table if not exists public.iap_poll_state (
  source          text primary key,          -- 'google_voided'
  cursor_at       timestamptz,               -- everything voided before this has been processed
  window_start    timestamptz,               -- the window an interrupted run is paging through
  window_end      timestamptz,
  page_token      text,                      -- where that run stopped
  lease_until     timestamptz,               -- a run in progress
  last_run_at     timestamptz,
  last_success_at timestamptz,
  last_error      text,
  last_result     jsonb,
  updated_at      timestamptz not null default now()
);

insert into public.iap_poll_state (source) values ('google_voided')
on conflict (source) do nothing;

alter table public.iap_poll_state enable row level security;
revoke all on public.iap_poll_state from anon, authenticated;
grant all on public.iap_poll_state to service_role;

-- ============================================================
-- 6. reverse_wallet_topup - service role only
-- ============================================================
-- Returns { outcome, topup_id, user_id, coins_reversed, balance, flagged }.
-- outcome: reversed | cancelled_pending | not_credited | already_reversed |
--          not_found
-- p_platform is needed only to record a tombstone when nothing matches.
create or replace function public.reverse_wallet_topup(
  p_store_transaction_id text,
  p_reason               text,
  p_platform             text        default null,
  p_store_order_id       text        default null,
  p_refunded_at          timestamptz default null,
  p_detail               jsonb       default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- An account is flagged for review at this many refunded top-ups, or as
  -- soon as a refund leaves its balance below zero.
  c_flag_after_refunds constant integer := 2;

  v_txid    text := trim(coalesce(p_store_transaction_id, ''));
  v_reason  text := left(coalesce(nullif(trim(p_reason), ''), 'refund'), 200);
  v_order   text := nullif(trim(coalesce(p_store_order_id, '')), '');
  v_detail  jsonb := coalesce(p_detail, '{}'::jsonb);
  v_topup   public.wallet_topups%rowtype;
  v_balance integer;
  v_count   integer;
  v_coins   integer;
  v_flagged boolean := false;
begin
  if auth.uid() is not null then raise exception 'not allowed'; end if;
  if v_txid = '' then raise exception 'store transaction id required'; end if;
  if p_platform is not null and p_platform not in ('ios', 'android') then
    raise exception 'bad platform';
  end if;

  -- Serialises with trg_wallet_topups_refund_tombstone for the same id, so a
  -- refund and a first credit racing each other cannot both miss.
  perform pg_advisory_xact_lock(hashtextextended('iap-topup:' || v_txid, 0));

  select * into v_topup from public.wallet_topups
   where store_transaction_id = v_txid
   for update;

  -- Google: fall back to the order id (GPA.xxxx) when the token hash is not
  -- what was stored.
  if not found and v_order is not null then
    select * into v_topup from public.wallet_topups
     where store_order_id = v_order and platform = 'android'
     order by created_at
     limit 1
     for update;
  end if;

  if v_topup.id is null then
    -- Nothing to take back yet. Leave a tombstone so it can never be credited.
    if p_platform is null then
      raise exception 'platform required to record an unmatched refund';
    end if;
    insert into public.iap_refunds
           (store_transaction_id, platform, outcome, reason, store_order_id, refunded_at, detail)
    values (v_txid, p_platform, 'not_found', v_reason, v_order, p_refunded_at, v_detail)
    on conflict (store_transaction_id) do nothing;
    return jsonb_build_object('outcome', 'not_found', 'topup_id', null, 'user_id', null,
                              'coins_reversed', 0, 'balance', null, 'flagged', false);
  end if;

  if v_topup.refunded_at is not null then
    select balance into v_balance from public.wallets where user_id = v_topup.user_id;
    return jsonb_build_object('outcome', 'already_reversed', 'topup_id', v_topup.id,
                              'user_id', v_topup.user_id, 'coins_reversed', 0,
                              'balance', v_balance, 'flagged', false);
  end if;

  if v_topup.status = 'pending' or v_topup.status = 'rejected' then
    update public.wallet_topups
       set status = 'rejected', refunded_at = now(), refund_reason = v_reason
     where id = v_topup.id;

    insert into public.iap_refunds
           (store_transaction_id, platform, topup_id, user_id, outcome, reason,
            store_order_id, refunded_at, detail)
    values (v_topup.store_transaction_id, v_topup.platform, v_topup.id, v_topup.user_id,
            case when v_topup.status = 'pending' then 'cancelled_pending' else 'not_credited' end,
            v_reason, coalesce(v_order, v_topup.store_order_id), p_refunded_at, v_detail)
    on conflict (store_transaction_id) do update
       set topup_id = excluded.topup_id, user_id = excluded.user_id,
           outcome = excluded.outcome, reason = excluded.reason;

    return jsonb_build_object(
      'outcome', case when v_topup.status = 'pending' then 'cancelled_pending' else 'not_credited' end,
      'topup_id', v_topup.id, 'user_id', v_topup.user_id, 'coins_reversed', 0,
      'balance', null, 'flagged', false);
  end if;

  -- 'credited': take the coins back. Same lock order as credit_wallet_topup
  -- (top-up row, then wallet), so the two cannot deadlock.
  v_coins := v_topup.coins;

  insert into public.wallets (user_id, balance) values (v_topup.user_id, 0)
    on conflict (user_id) do nothing;
  perform 1 from public.wallets where user_id = v_topup.user_id for update;

  update public.wallets
     set balance = balance - v_coins, updated_at = now()
   where user_id = v_topup.user_id
  returning balance into v_balance;

  update public.wallet_topups
     set refunded_at = now(), refund_reason = v_reason
   where id = v_topup.id;

  insert into public.wallet_transactions (user_id, type, amount, reference, description)
  values (v_topup.user_id, 'refund', v_coins, v_topup.id,
          'استرداد — ' || coalesce(v_topup.product_id, v_topup.store_transaction_id));

  insert into public.iap_refunds
         (store_transaction_id, platform, topup_id, user_id, outcome, coins_reversed,
          balance_after, reason, store_order_id, refunded_at, detail)
  values (v_topup.store_transaction_id, v_topup.platform, v_topup.id, v_topup.user_id,
          'reversed', v_coins, v_balance, v_reason,
          coalesce(v_order, v_topup.store_order_id), p_refunded_at, v_detail)
  on conflict (store_transaction_id) do update
     set topup_id = excluded.topup_id, user_id = excluded.user_id,
         outcome = excluded.outcome, coins_reversed = excluded.coins_reversed,
         balance_after = excluded.balance_after, reason = excluded.reason;

  -- Flag for review.
  select count(*), coalesce(sum(coins_reversed), 0)::integer
    into v_count, v_coins
    from public.iap_refunds
   where user_id = v_topup.user_id and outcome = 'reversed';

  if v_count >= c_flag_after_refunds or v_balance < 0 then
    v_flagged := true;
    insert into public.wallet_flags (user_id, refund_count, refunded_coins, reason)
    values (v_topup.user_id, v_count, v_coins,
            case when v_balance < 0 then 'negative balance after refund'
                 else 'repeated refunds' end)
    on conflict (user_id) do update
       set refund_count   = excluded.refund_count,
           refunded_coins = excluded.refunded_coins,
           reason         = excluded.reason,
           updated_at     = now(),
           -- A new refund after a review reopens it.
           reviewed_at    = null;
  end if;

  return jsonb_build_object('outcome', 'reversed', 'topup_id', v_topup.id,
                            'user_id', v_topup.user_id, 'coins_reversed', v_topup.coins,
                            'balance', v_balance, 'flagged', v_flagged);
end;
$$;

revoke all on function public.reverse_wallet_topup(text, text, text, text, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.reverse_wallet_topup(text, text, text, text, timestamptz, jsonb)
  to service_role;

-- ============================================================
-- 7. A refund that arrived before the purchase was recorded
-- ============================================================
-- Fires on every insert into wallet_topups (credit_wallet_topup's claim and
-- verify-purchase's pending insert). When a tombstone exists, the row is
-- stored as 'rejected': credit_wallet_topup then refuses ("store transaction
-- was rejected") and verify-purchase answers invalid('rejected').
-- On an ON CONFLICT DO NOTHING that finds an existing row, the modified NEW
-- is simply discarded.
create or replace function public.wallet_topups_refund_tombstone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('iap-topup:' || new.store_transaction_id, 0));
  if exists (select 1 from public.iap_refunds
              where store_transaction_id = new.store_transaction_id
                and outcome in ('not_found', 'blocked_before_credit')) then
    new.status        := 'rejected';
    new.refunded_at   := coalesce(new.refunded_at, now());
    new.refund_reason := coalesce(new.refund_reason, 'refunded before credit');
    update public.iap_refunds
       set outcome = 'blocked_before_credit',
           user_id = coalesce(user_id, new.user_id),
           detail  = detail || jsonb_build_object('blocked_topup_id', new.id,
                                                  'blocked_at', now())
     where store_transaction_id = new.store_transaction_id;
  end if;
  return new;
end;
$$;

revoke all on function public.wallet_topups_refund_tombstone() from public, anon, authenticated;

drop trigger if exists trg_wallet_topups_refund_tombstone on public.wallet_topups;
create trigger trg_wallet_topups_refund_tombstone
  before insert on public.wallet_topups
  for each row execute function public.wallet_topups_refund_tombstone();

commit;

-- ============================================================
-- 8. Where the scheduled call points
-- ============================================================
-- Copied from send-push (0087): same x-reconcile-secret, same apikey.
-- If send-push is missing, media-reconcile's row is used instead.
insert into public.job_endpoints (name, url, headers)
select 'play-voided-purchases', replace(url, '/send-push', '/play-voided-purchases'), headers
  from public.job_endpoints where name = 'send-push'
on conflict (name) do update set url = excluded.url, headers = excluded.headers;

insert into public.job_endpoints (name, url, headers)
select 'play-voided-purchases', replace(url, '/media-reconcile', '/play-voided-purchases'), headers
  from public.job_endpoints where name = 'media-reconcile'
on conflict (name) do nothing;

-- ============================================================
-- 9. Schedule: every 6 hours at :41 (clear of the other jobs)
-- ============================================================
do $sched$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not enabled - NOTHING HAS BEEN SCHEDULED. Enable it in the Supabase dashboard (Database -> Extensions) and run this file again.';
    return;
  end if;

  perform cron.unschedule('play-voided-purchases')
   where exists (select 1 from cron.job where jobname = 'play-voided-purchases');

  perform cron.schedule(
    'play-voided-purchases',
    '41 */6 * * *',
    $job$ select public.call_job_endpoint('play-voided-purchases'); $job$
  );
end;
$sched$;

-- ── Verification ─────────────────────────────────────────────────────────
-- Run after applying. Every row should read OK.
select 'wallet_topups refund columns' as check,
       case when (select count(*) from information_schema.columns
                   where table_schema = 'public' and table_name = 'wallet_topups'
                     and column_name in ('refunded_at', 'refund_reason')) = 2
            then 'OK' else 'MISSING' end as result
union all select 'ledger allows refund',
       case when exists (select 1 from pg_constraint
                          where conrelid = 'public.wallet_transactions'::regclass
                            and conname = 'wallet_transactions_type_check'
                            -- Postgres prints the list as {a,b,refund}, unquoted.
                            and pg_get_constraintdef(oid) ~ '[{,'']refund[},'']')
            then 'OK' else 'MISSING' end
union all select 'ledger still allows the old types',
       case when (select pg_get_constraintdef(oid) from pg_constraint
                   where conrelid = 'public.wallet_transactions'::regclass
                     and conname = 'wallet_transactions_type_check')
                 ~ 'topup.*gift_sent|gift_sent.*topup'
            then 'OK' else 'CHECK BY HAND' end
union all select 'reverse_wallet_topup not callable by users',
       case when not has_function_privilege('authenticated',
                   'public.reverse_wallet_topup(text,text,text,text,timestamptz,jsonb)', 'execute')
             and not has_function_privilege('anon',
                   'public.reverse_wallet_topup(text,text,text,text,timestamptz,jsonb)', 'execute')
            then 'OK' else 'EXPOSED' end
union all select 'reverse_wallet_topup callable by service_role',
       case when has_function_privilege('service_role',
                   'public.reverse_wallet_topup(text,text,text,text,timestamptz,jsonb)', 'execute')
            then 'OK' else 'MISSING' end
union all select 'tombstone trigger',
       case when exists (select 1 from pg_trigger
                          where tgname = 'trg_wallet_topups_refund_tombstone'
                            and tgrelid = 'public.wallet_topups'::regclass)
            then 'OK' else 'MISSING' end
union all select 'iap tables have RLS',
       case when (select bool_and(relrowsecurity) from pg_class
                   where oid in ('public.iap_refunds'::regclass, 'public.wallet_flags'::regclass,
                                 'public.iap_poll_state'::regclass))
            then 'OK' else 'RLS OFF' end
union all select 'users cannot write refund tables',
       case when not has_table_privilege('authenticated', 'public.iap_refunds', 'insert')
             and not has_table_privilege('authenticated', 'public.wallet_flags', 'insert')
             and not has_table_privilege('authenticated', 'public.iap_poll_state', 'select')
             and not has_table_privilege('anon', 'public.iap_refunds', 'select')
            then 'OK' else 'EXPOSED' end
union all select 'send_gift still refuses a short balance',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'send_gift'
                            and p.prosrc like '%v_balance < v_price%')
            then 'OK' else 'CHECK send_gift BY HAND' end
union all select 'poller state row',
       case when exists (select 1 from public.iap_poll_state where source = 'google_voided')
            then 'OK' else 'MISSING' end
union all select 'job_endpoints row',
       case when exists (select 1 from public.job_endpoints
                          where name = 'play-voided-purchases'
                            and url like '%/functions/v1/play-voided-purchases')
            then 'OK' else 'MISSING (no send-push / media-reconcile row to copy)' end
order by 1;

-- Where pg_cron is enabled:
-- select jobname, schedule, active from cron.job where jobname = 'play-voided-purchases';
--
-- Poller status:
-- select source, cursor_at, page_token is not null as resuming, last_run_at,
--        last_success_at, last_error, last_result from public.iap_poll_state;
--
-- Recent refunds and accounts to review:
-- select * from public.iap_refunds order by recorded_at desc limit 50;
-- select f.*, w.balance from public.wallet_flags f
--   left join public.wallets w on w.user_id = f.user_id
--  where f.reviewed_at is null order by f.updated_at desc;
--
-- Trigger a poll by hand ('queued' only means pg_net accepted it):
-- select public.call_job_endpoint('play-voided-purchases');
