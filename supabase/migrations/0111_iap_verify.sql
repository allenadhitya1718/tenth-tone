-- 0111 - store purchase verification details on wallet_topups
--
-- The verify-purchase Edge Function (supabase/functions/verify-purchase)
-- checks an App Store / Google Play coin purchase with the store itself and
-- then calls credit_wallet_topup (0104) with the service role. 0104's
-- wallet_topups row records who, which package, which platform and the store
-- transaction id - enough to credit exactly once, not enough to answer a
-- support ticket or to tell a test purchase from a paid one. This adds:
--
--   product_id      the store product id as the store reported it. package_id
--                   is "on delete set null", so this keeps the history readable
--                   if a package row is ever removed.
--   store_order_id  Google Play order id (GPA.xxxx-...), the number the buyer
--                   sees on their Google receipt. Empty for Apple, whose
--                   transactionId is already store_transaction_id (the
--                   Order ID on an Apple receipt email can be matched with
--                   App Store Server API "Look Up Order ID").
--                   store_transaction_id stays the idempotency key: the
--                   Apple transactionId, or for Google
--                   'gp:' + sha256(purchase token) (a pending Google purchase
--                   has no order id yet, the token is there from the start).
--   environment     'production' or 'sandbox'. Sandbox = Apple Sandbox /
--                   TestFlight / App Review, or a Google Play license-tester
--                   (test card) purchase. These coins were NOT paid for: any
--                   creator payout / withdrawal must exclude gifts bought with
--                   them, or simply refuse sandbox top-ups on a live server
--                   (verify-purchase secret IAP_ALLOW_SANDBOX=false - but App
--                   Review tests in the sandbox, so keep it true while a build
--                   is in review).
--   verified_at     when the store last confirmed it.
--
-- Rows are still written only by the service role (credit_wallet_topup and
-- the Edge Function); 0104's grants and RLS are unchanged and re-checked
-- below. No new function: credit_wallet_topup stays the only way to add coins.
--
-- Depends on: 0104. Safe to run more than once. Not applied by the app.

begin;

alter table public.wallet_topups add column if not exists product_id     text;
alter table public.wallet_topups add column if not exists store_order_id text;
alter table public.wallet_topups add column if not exists environment    text;
alter table public.wallet_topups add column if not exists verified_at    timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.wallet_topups'::regclass
                    and conname  = 'wallet_topups_environment_check') then
    alter table public.wallet_topups
      add constraint wallet_topups_environment_check
      check (environment is null or environment in ('production', 'sandbox'));
  end if;
end $$;

-- Support looks purchases up by the order number on the buyer's receipt.
create index if not exists idx_wallet_topups_order
  on public.wallet_topups (store_order_id)
  where store_order_id is not null;

-- Backfill product_id for rows written before this migration.
update public.wallet_topups t
   set product_id = p.product_id
  from public.coin_packages p
 where t.product_id is null
   and t.package_id = p.id;

-- 0104 already did this; restated so re-running 0104 out of order or a
-- dashboard grant cannot leave users able to write their own top-ups.
revoke insert, update, delete, truncate on public.wallet_topups from anon, authenticated;
revoke all on function public.credit_wallet_topup(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.credit_wallet_topup(uuid, text, text, text) to service_role;

commit;

-- -- Verification ---------------------------------------------------------
-- Run after applying. Every row should read OK.
select 'wallet_topups verification columns' as check,
       case when (select count(*) from information_schema.columns
                   where table_schema = 'public' and table_name = 'wallet_topups'
                     and column_name in ('product_id', 'store_order_id', 'environment', 'verified_at')) = 4
            then 'OK' else 'MISSING' end as result
union all select 'environment check constraint',
       case when exists (select 1 from pg_constraint
                          where conrelid = 'public.wallet_topups'::regclass
                            and conname  = 'wallet_topups_environment_check')
            then 'OK' else 'MISSING' end
union all select 'store_transaction_id still unique',
       case when exists (select 1 from pg_index i
                           join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
                          where i.indrelid = 'public.wallet_topups'::regclass
                            and i.indisunique and i.indnatts = 1
                            and a.attname = 'store_transaction_id')
            then 'OK' else 'MISSING' end
union all select 'users cannot write wallet_topups',
       case when not has_table_privilege('authenticated', 'public.wallet_topups', 'insert')
             and not has_table_privilege('authenticated', 'public.wallet_topups', 'update')
             and not has_table_privilege('anon', 'public.wallet_topups', 'insert')
            then 'OK' else 'EXPOSED' end
union all select 'credit_wallet_topup not callable by users',
       case when not has_function_privilege('authenticated',
                   'public.credit_wallet_topup(uuid,text,text,text)', 'execute')
             and not has_function_privilege('anon',
                   'public.credit_wallet_topup(uuid,text,text,text)', 'execute')
            then 'OK' else 'EXPOSED' end
union all select 'credit_wallet_topup callable by service_role',
       case when has_function_privilege('service_role',
                   'public.credit_wallet_topup(uuid,text,text,text)', 'execute')
            then 'OK' else 'MISSING' end
union all select 'coin packages on sale',
       (select count(*)::text from public.coin_packages where active);
