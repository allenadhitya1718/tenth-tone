-- ============================================================
-- 0156 — Wallet and live gifts are "coming soon"
--
-- 1. New accounts start with 0 coins. 0003's init_wallet gave every signup
--    100 free coins plus a "welcome gift" ledger row. Coins are only sold
--    through the stores (verify-purchase), so free coins would turn into
--    diamonds and then payouts (0130) without anyone paying.
-- 2. Gifts are paused on the server, not only hidden in the app: a
--    BEFORE INSERT trigger on gift_transactions refuses every gift while
--    app_limits.gifts_enabled is false, so send_gift (0131) aborts as a
--    whole and no coins move. Launch with:
--      update public.app_limits set gifts_enabled = true where id = 1;
--    and set WALLET_LAUNCHED = true in mobile/src/features/wallet/launch.ts.
--
-- Safe to re-run. Mumbai (vfkwipvinmnybilcrdzr) only.
-- ============================================================
begin;

-- ── 1. No starter coins ──
create or replace function public.init_wallet()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 0156: wallet row only, balance 0, no welcome ledger entry.
  insert into public.wallets (user_id, balance) values (new.id, 0)
  on conflict (user_id) do nothing;
  return new;
end; $$;

revoke all on function public.init_wallet() from public, anon, authenticated;

alter table public.wallets alter column balance set default 0;

-- ── 2. Gifts switch, off by default ──
alter table public.app_limits add column if not exists gifts_enabled boolean not null default false;

create or replace function public.guard_gifts_enabled()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not coalesce((select gifts_enabled from public.app_limits where id = 1), false) then
    raise exception 'gifts_coming_soon' using errcode = 'P0001';
  end if;
  return new;
end; $$;

revoke all on function public.guard_gifts_enabled() from public, anon, authenticated;

drop trigger if exists trg_guard_gifts_enabled on public.gift_transactions;
create trigger trg_guard_gifts_enabled before insert on public.gift_transactions
  for each row execute function public.guard_gifts_enabled();

commit;

-- ── Optional, NOT run by this file: take back free coins already handed out ──
-- Zeroes the balance of every account that never had a store top-up credited.
-- Review the count first; purchased coins are untouched.
--
--   select count(*), sum(w.balance) from public.wallets w
--   where w.balance > 0
--     and not exists (select 1 from public.wallet_topups t
--                     where t.user_id = w.user_id and t.status = 'credited');
--
--   update public.wallets w set balance = 0
--   where w.balance > 0
--     and not exists (select 1 from public.wallet_topups t
--                     where t.user_id = w.user_id and t.status = 'credited');

-- ── Checks (SELECT only) ──
-- Expect: true (init_wallet no longer grants 100)
select position('values (new.id, 0)' in pg_get_functiondef('public.init_wallet()'::regprocedure)) > 0 as init_wallet_zero;
-- Expect: '0'
select column_default from information_schema.columns
where table_schema = 'public' and table_name = 'wallets' and column_name = 'balance';
-- Expect: false
select gifts_enabled from public.app_limits where id = 1;
-- Expect: 1 row
select tgname from pg_trigger
where tgrelid = 'public.gift_transactions'::regclass and tgname = 'trg_guard_gifts_enabled';
