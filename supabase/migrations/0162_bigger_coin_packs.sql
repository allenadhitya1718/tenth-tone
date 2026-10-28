-- ============================================================
-- 0162 - two bigger coin packs  (Mumbai, vfkwipvinmnybilcrdzr)
--
-- The top gifts cost up to 29,999 coins (0158) but the biggest pack was
-- 6,607, so a big gifter had to buy five packs in a row. Two more packs on
-- the same per-coin price as the 6,607 pack (259.99 / 6,607 = 0.03935 SAR,
-- above the 0.0376 SAR a coin needs so that half its price can be paid to the
-- creator at 0.0188 SAR per diamond):
--
--   flyp.coins.13214   13,214 coins    519.99 SAR
--   flyp.coins.33035   33,035 coins  1,299.99 SAR
--
-- With the six 0158 packs that is eight suggestions, and the app's Custom
-- tile picks the smallest pack that covers the amount typed. Create both
-- product ids in App Store Connect (consumable) and the Play Console
-- (one-time product) before they can be sold; until then the app shows them
-- with this price label and the store refuses the purchase.
--
-- Safe to re-run: upsert on product_id, like 0158.
-- ============================================================
insert into public.coin_packages (product_id, coins, bonus_coins, price_label, active, sort_order) values
  ('flyp.coins.13214', 13214, 0,   '519.99 SAR', true, 70),
  ('flyp.coins.33035', 33035, 0, '1,299.99 SAR', true, 80)
on conflict (product_id) do update
  set coins       = excluded.coins,
      bonus_coins = excluded.bonus_coins,
      price_label = excluded.price_label,
      active      = excluded.active,
      sort_order  = excluded.sort_order;

-- Check (SELECT only). Expect 8 active packs, 65 ... 33,035.
select product_id, coins, price_label, sort_order
  from public.coin_packages where active order by sort_order;
