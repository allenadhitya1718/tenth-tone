-- ============================================================
-- 0131 - gifts earn the receiver diamonds only (no coins); VAT-aware rate
--
-- MUMBAI PROJECT ONLY (vfkwipvinmnybilcrdzr). Apply AFTER 0130.
-- Safe to re-run: send_gift and the rate helper are re-created, the default
-- is restated, and the rate row is only touched while it still holds the
-- old auto-seeded value (an admin's edit is never overwritten).
--
-- ============================================================
-- 1. A GIFT NO LONGER CREDITS COINS TO THE RECEIVER
-- ============================================================
-- Until now send_gift (0104) debited the sender AND credited the same coins
-- to the receiver's wallet; 0130 then also gave the receiver diamonds. From
-- here on the receiver earns ONLY diamonds (creator_earnings, made by 0130's
-- trigger trg_creator_earnings_on_gift on gift_transactions). Coins stay a
-- pure spend currency: bought from the store, spent on gifts, never earned.
--
-- send_gift is re-created from 0104 line for line except:
--   - the receiver's wallet is no longer created / credited;
--   - the receiver's 'gift_received' ledger row is still written (so their
--     wallet history keeps listing gifts they received) but with amount 0:
--     the ledger keeps summing to the coin balance. The app shows these rows
--     as "Gift received · +N diamonds", reading N from creator_earnings
--     (same gift_transactions id in wallet_transactions.reference). Older
--     rows (amount > 0, before 0131) keep showing the coins they credited.
-- Everything else is unchanged: signature and return value, active gift,
-- block check, live-stream checks, sender wallet lock + 'insufficient
-- balance', the sender's 'gift_sent' row, gift_transactions insert (so the
-- 'gift' notification trigger, realtime live banners and the 0130 earnings
-- trigger all fire exactly as before).
--
-- Coins received BEFORE 0131 stay in receivers' wallets and remain
-- spendable; nothing is clawed back.
--
-- 0130's "funded" rule (payout_gift_funded: a gift earns withdrawable
-- diamonds only while the sender's production, non-refunded top-ups cover
-- every coin they have ever given away) is KEPT. Since receivers no longer
-- get coins, "re-gifted received coins" can no longer arise going forward;
-- the rule still covers coins received before 0131, sandbox / tester coins,
-- admin grants and pre-0111 top-ups, and is otherwise harmless.
--
-- ============================================================
-- 2. THE DIAMOND RATE ACCOUNTS FOR 15% VAT
-- ============================================================
-- Store prices (coin_packages.price_label, SAR) include 15% VAT. The rate
-- is now
--   sar_per_diamond = floor4( cheapest price per coin (bonus included)
--                             / 1.15 x 0.70 (after the store fee)
--                             x 0.50 (creator share) )
-- With the 0104 packages: 219.99 / 7500 = 0.029332 / 1.15 = 0.025506
--   x 0.35 = 0.008927 -> 0.0089 SAR per diamond (100 SAR = 11,236 diamonds).
-- 0130 seeded 0.0102 (no VAT). The row is moved to the new value ONLY when
-- it still equals 0.0102 and no admin ever set 0.0102 by hand (admin_logs
-- 'payout_config'). Withdrawals already requested keep the rate they locked.
-- ============================================================

begin;

-- ── 1. send_gift: receiver earns diamonds only ──────────────────────────
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

  -- Retired gifts cannot be sent (0104).
  select price, name into v_price, v_name from public.gifts
   where id = p_gift_id and active;
  if v_price is null then raise exception 'gift not found'; end if;
  if v_price <= 0 then raise exception 'invalid gift price'; end if;

  -- No gifts across a block, in either direction (0104).
  if public.is_blocked_between(v_me, p_to_user_id) then
    raise exception 'cannot send a gift to this account';
  end if;

  -- A live gift must go to someone in that live (0104).
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

  -- 0131: the receiver's wallet is NOT credited. They earn diamonds through
  -- trg_creator_earnings_on_gift (0130), which fires on this insert.
  insert into public.gift_transactions (from_user_id, to_user_id, gift_id, live_stream_id, amount)
  values (v_me, p_to_user_id, p_gift_id, p_live_stream_id, v_price)
  returning id into v_tx;

  -- Sender: the coins spent. Receiver: a 0-coin row so the gift still shows
  -- in their wallet history (the app reads the diamonds via reference).
  insert into public.wallet_transactions (user_id, type, amount, reference, description)
  values (v_me,          'gift_sent',     v_price, v_tx, v_name),
         (p_to_user_id,  'gift_received', 0,       v_tx, v_name);

  return v_tx;
end;
$$;

revoke all on function public.send_gift(uuid, text, uuid) from public, anon;
grant execute on function public.send_gift(uuid, text, uuid) to authenticated;


-- ── 2. The rate: cheapest price per coin, VAT out, store fee, 50% share ─
drop function if exists public.payout_auto_sar_per_diamond();
create function public.payout_auto_sar_per_diamond()
returns numeric
language sql
stable
security definer
set search_path = public
as $fn$
  select greatest(0.0001, coalesce(
    (select trunc(min(price / (coins + bonus_coins)) / 1.15 * 0.70 * 0.50, 4)
       from (select nullif(substring(price_label from '([0-9]+(?:\.[0-9]+)?)'), '')::numeric as price,
                    coins, bonus_coins
               from public.coin_packages
              where active and coins + bonus_coins > 0) p
      where price > 0),
    0.0089));
$fn$;
revoke all on function public.payout_auto_sar_per_diamond() from public, anon, authenticated;

comment on function public.payout_auto_sar_per_diamond() is
  'Default SAR per diamond: floor4(cheapest active coin package price per coin (bonus included) / 1.15 VAT x 0.70 store x 0.50 creator share). Used to seed payout_config; admins set the live value.';

alter table public.payout_config alter column sar_per_diamond set default 0.0089;

-- A fresh database (0130 inserted nothing yet): seed with the VAT rule.
insert into public.payout_config (id, sar_per_diamond)
values (true, public.payout_auto_sar_per_diamond())
on conflict (id) do nothing;

-- Move the old auto-seeded 0.0102 to the new value, never an admin's edit.
update public.payout_config
   set sar_per_diamond = public.payout_auto_sar_per_diamond(),
       updated_at = now()
 where id
   and sar_per_diamond = 0.0102
   and public.payout_auto_sar_per_diamond() <> 0.0102
   and not exists (
     select 1 from public.admin_logs l
      where l.action = 'payout_config'
        and (l.payload->'new'->>'sar_per_diamond')::numeric = 0.0102
        and (l.payload->'old'->>'sar_per_diamond')::numeric is distinct from 0.0102);

comment on function public.payout_gift_funded(uuid, timestamptz) is
  'Kept from 0130. Since 0131 receivers earn no coins, so re-gifted received coins only exist from before 0131; still covers sandbox/tester coins, admin grants and pre-0111 top-ups.';

commit;


-- ============================================================
-- VERIFY - every row should read OK (dry: inspects definitions only)
-- ============================================================
with sg as (
  select p.prosrc as src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'send_gift'
     and pg_get_function_identity_arguments(p.oid) = 'p_to_user_id uuid, p_gift_id text, p_live_stream_id uuid'
)
select 'send_gift exists (one overload)' as check,
       case when (select count(*) from sg) = 1 then 'OK' else 'CHECK BY HAND' end as result
union all select 'send_gift no longer credits the receiver''s wallet',
       case when exists (select 1 from sg)
             and not exists (select 1 from sg
                              where src ilike '%public.wallets.balance + %'
                                 or src ilike '%balance = balance +%'
                                 or src ~* 'insert\s+into\s+public\.wallets\s*\(user_id,\s*balance\)\s*values\s*\(\s*p_to_user_id')
             and (select (length(src) - length(replace(lower(src), 'update public.wallets', '')))
                         / length('update public.wallets') from sg) = 1
            then 'OK' else 'RECEIVER STILL CREDITED' end
union all select 'send_gift still debits the sender and refuses a short balance',
       case when exists (select 1 from sg where src like '%v_balance < v_price%'
                                            and src like '%balance = balance - v_price%')
            then 'OK' else 'CHECK BY HAND' end
union all select 'send_gift keeps checks (active gift, block, live)',
       case when exists (select 1 from sg where src like '%and active%'
                                            and src like '%is_blocked_between%'
                                            and src like '%recipient is not in this live stream%')
            then 'OK' else 'CHECK BY HAND' end
union all select 'ledger: gift_sent = price, gift_received = 0',
       case when exists (select 1 from sg where src ~ '''gift_sent'',\s*v_price'
                                            and src ~ '''gift_received'',\s*0\s*,')
            then 'OK' else 'CHECK BY HAND' end
union all select 'diamonds trigger on gift_transactions',
       case when exists (select 1 from pg_trigger where tgname = 'trg_creator_earnings_on_gift'
                          and tgrelid = 'public.gift_transactions'::regclass and not tgisinternal)
            then 'OK' else 'MISSING (apply 0130)' end
union all select 'gift notification trigger',
       case when exists (select 1 from pg_trigger where tgname = 'trg_notify_on_gift'
                          and tgrelid = 'public.gift_transactions'::regclass)
            then 'OK' else 'MISSING' end
union all select 'auto rate = ' || public.payout_auto_sar_per_diamond()::text || ' (expected ~0.0089)',
       case when public.payout_auto_sar_per_diamond() between 0.0001 and 1 then 'OK' else 'CHECK BY HAND' end
union all select 'sar_per_diamond in force = ' || (select sar_per_diamond::text from public.payout_config where id),
       case when (select sar_per_diamond from public.payout_config where id) = public.payout_auto_sar_per_diamond()
            then 'OK'
            when (select sar_per_diamond from public.payout_config where id) = 0.0102
            then 'STILL OLD 0.0102 (an admin set it by hand?)'
            else 'OK (admin-set value kept)' end
union all select 'rate helper not callable by users',
       case when not has_function_privilege('authenticated', 'public.payout_auto_sar_per_diamond()', 'execute')
             and not has_function_privilege('anon', 'public.payout_auto_sar_per_diamond()', 'execute')
            then 'OK' else 'EXPOSED' end
order by 1;

-- Behavioural test (as a signed-in tester with coins, on a staging copy):
--   select balance from wallets where user_id = '<receiver>';      -- note it
--   select send_gift('<receiver>', 'rose', null);
--   select balance from wallets where user_id = '<receiver>';      -- unchanged
--   select diamonds, status from creator_earnings
--    where gift_transaction_id = '<returned id>';                  -- one row
--   select type, amount from wallet_transactions
--    where reference = '<returned id>';      -- gift_sent = price, gift_received = 0
