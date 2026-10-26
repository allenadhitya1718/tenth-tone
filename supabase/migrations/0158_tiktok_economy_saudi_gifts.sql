-- ============================================================
-- 0158 - TikTok-style economy with Saudi gifts (client round 4)
--
-- MUMBAI PROJECT ONLY (vfkwipvinmnybilcrdzr). Apply AFTER 0156.
-- Safe to re-run: every insert is an upsert, functions are re-created.
--
-- The client asked for gifts and the wallet to work exactly like TikTok,
-- with gift designs that carry a Saudi identity. TikTok's model, which the
-- app already follows (0104 / 0130 / 0131), with TikTok's numbers:
--
--   coins     bought only through the App Store / Google Play, in TikTok's
--             pack sizes (65 ... 6,607), no bonus coins, about 0.04 SAR each
--             (TikTok: about $0.0106 a coin).
--   gifts     cost coins; the receiver earns 1 diamond per coin.
--   diamonds  are worth 0.0188 SAR each (TikTok: about $0.005 = half a
--             coin's price, the creator's 50% share).
--   payouts   from 40 SAR (TikTok: $10 minimum), KYC and admin approval
--             as before (0130).
--
-- Every number stays editable: gifts and coin packs through the new
-- admin_v2_economy / admin_v2_gift_save / admin_v2_coin_package_save, the
-- rate and minimum through the existing admin_v2_payout_set_config.
--
-- Gifts stay switched off (0156: app_limits.gifts_enabled) until launch.
-- ============================================================

begin;

-- ── 1. The Saudi gift catalogue on TikTok's price ladder ──────────────
-- Existing ids are kept (rose, dates, dallah, falcon, camel, horse) so past
-- gift_transactions still point at a gift. Gifts with no Saudi meaning are
-- retired, not deleted: old history keeps its name.
insert into public.gifts (id, name, name_en, emoji, price, active, sort_order) values
  ('rose',       'وردة طائفية',  'Taif rose',       '🌹',     1, true,  10),
  ('finjan',     'فنجان قهوة',   'Coffee cup',      '🍵',     1, true,  20),
  ('palm_frond', 'سعفة نخل',     'Palm frond',      '🌿',     5, true,  30),
  ('dates',      'تمر',          'Dates',           '🌰',    10, true,  40),
  ('bakhoor',    'مبخرة',        'Bakhoor',         '🪔',    30, true,  50),
  ('dallah',     'دلة قهوة',     'Coffee dallah',   '☕',    99, true,  60),
  ('sadu',       'سدو',          'Sadu weaving',    '🧶',   199, true,  70),
  ('palm_tree',  'نخلة',         'Palm tree',       '🌴',   299, true,  80),
  ('tent',       'بيت شعر',      'Desert tent',     '⛺',   499, true,  90),
  ('falcon',     'صقر',          'Falcon',          '🦅',   999, true, 100),
  ('camel',      'جمل',          'Camel',           '🐪',  1999, true, 110),
  ('horse',      'خيل عربية',    'Arabian horse',   '🐎',  4999, true, 120),
  ('caravan',    'قافلة',        'Camel caravan',   '🐫',  9999, true, 130),
  ('masmak',     'قصر المصمك',   'Masmak Palace',   '🏰', 19999, true, 140),
  ('riyadh',     'سماء الرياض',  'Riyadh skyline',  '🏙️', 29999, true, 150)
on conflict (id) do update
  set name       = excluded.name,
      name_en    = excluded.name_en,
      emoji      = excluded.emoji,
      price      = excluded.price,
      active     = excluded.active,
      sort_order = excluded.sort_order;
      -- asset_url not touched: artwork is uploaded and set by hand.

update public.gifts set active = false
 where id in ('heart', 'star', 'trophy', 'crown', 'rocket', 'yacht', 'car');


-- ── 2. TikTok's coin packs ────────────────────────────────────────────
-- Product ids must be created with exactly these names in App Store Connect
-- (consumable) and the Play Console (one-time product). price_label is the
-- intended SAR price and only a fallback: the app shows the store's price.
insert into public.coin_packages (product_id, coins, bonus_coins, price_label, active, sort_order) values
  ('flyp.coins.65',     65, 0,   '2.99 SAR', true, 10),
  ('flyp.coins.330',   330, 0,  '12.99 SAR', true, 20),
  ('flyp.coins.660',   660, 0,  '25.99 SAR', true, 30),
  ('flyp.coins.1321', 1321, 0,  '52.99 SAR', true, 40),
  ('flyp.coins.3303', 3303, 0, '129.99 SAR', true, 50),
  ('flyp.coins.6607', 6607, 0, '259.99 SAR', true, 60)
on conflict (product_id) do update
  set coins       = excluded.coins,
      bonus_coins = excluded.bonus_coins,
      price_label = excluded.price_label,
      active      = excluded.active,
      sort_order  = excluded.sort_order;

-- The 0104 packs are retired (never sold: no store products were made).
update public.coin_packages set active = false
 where product_id in ('flyp.coins.100', 'flyp.coins.500', 'flyp.coins.1200',
                      'flyp.coins.2500', 'flyp.coins.6500');


-- ── 3. TikTok's creator share ─────────────────────────────────────────
-- 1 coin of gift = 1 diamond, worth half a coin's price (TikTok's 50%):
-- 0.0188 SAR = $0.005 at 3.75. Unlike 0131 the share is of the price the
-- buyer paid, as on TikTok, so FLYP carries the VAT and the store fee out of
-- its own half. Withdrawals already requested keep the rate they locked.
create or replace function public.payout_auto_sar_per_diamond()
returns numeric
language sql
immutable
security definer
set search_path = public
as $fn$
  select 0.0188::numeric;
$fn$;
revoke all on function public.payout_auto_sar_per_diamond() from public, anon, authenticated;

comment on function public.payout_auto_sar_per_diamond() is
  '0158: TikTok''s diamond value, $0.005 = 0.0188 SAR (half of a coin''s price). Seed only; admins set the live value.';

alter table public.payout_config alter column sar_per_diamond set default 0.0188;

update public.payout_config
   set diamonds_per_coin = 1,
       sar_per_diamond   = 0.0188,
       min_withdraw_sar  = 40,
       updated_at        = now()
 where id;

insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
select null, 'payout_config', 'payout_config', null,
       jsonb_build_object('note', '0158 TikTok economy', 'new',
         jsonb_build_object('diamonds_per_coin', 1, 'sar_per_diamond', 0.0188, 'min_withdraw_sar', 40))
 where not exists (select 1 from public.admin_logs
                    where action = 'payout_config' and payload->>'note' = '0158 TikTok economy');


-- ── 4. Admin: read and edit gifts and coin packs ──────────────────────
drop function if exists public.admin_v2_economy();
create function public.admin_v2_economy()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  return jsonb_build_object(
    'gifts', coalesce((select jsonb_agg(to_jsonb(g) || jsonb_build_object(
                         'sent', (select count(*) from public.gift_transactions t where t.gift_id = g.id))
                       order by g.sort_order, g.price)
                       from public.gifts g), '[]'::jsonb),
    'packages', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort_order, p.coins)
                          from public.coin_packages p), '[]'::jsonb),
    'config', (select to_jsonb(c) from public.payout_config c where c.id));
end;
$fn$;
revoke all on function public.admin_v2_economy() from public, anon;
grant execute on function public.admin_v2_economy() to authenticated;

drop function if exists public.admin_v2_gift_save(text, text, text, text, integer, boolean, integer, text);
create function public.admin_v2_gift_save(
  p_id         text,
  p_name       text,
  p_name_en    text,
  p_emoji      text,
  p_price      integer,
  p_active     boolean,
  p_sort_order integer,
  p_asset_url  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_old public.gifts;
  v_new public.gifts;
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_id is null or p_id !~ '^[a-z0-9_]{2,32}$' then
    raise exception 'gift id must be 2-32 lowercase letters, digits or _' using errcode = '22023';
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Arabic name required' using errcode = '22023'; end if;
  if p_price is null or p_price < 1 or p_price > 1000000 then
    raise exception 'price must be between 1 and 1000000 coins' using errcode = '22023';
  end if;
  if p_asset_url is not null and p_asset_url <> '' and p_asset_url !~ '^https://' then
    raise exception 'artwork must be an https link' using errcode = '22023';
  end if;

  select * into v_old from public.gifts where id = p_id;

  insert into public.gifts (id, name, name_en, emoji, price, active, sort_order, asset_url)
  values (p_id, btrim(p_name), nullif(btrim(p_name_en), ''), nullif(btrim(p_emoji), ''),
          p_price, coalesce(p_active, true), coalesce(p_sort_order, 0), nullif(btrim(p_asset_url), ''))
  on conflict (id) do update
     set name = excluded.name, name_en = excluded.name_en, emoji = excluded.emoji,
         price = excluded.price, active = excluded.active, sort_order = excluded.sort_order,
         asset_url = excluded.asset_url
  returning * into v_new;

  insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
  values (auth.uid(), 'gift_save', 'gift', null,
          jsonb_build_object('id', p_id, 'old', to_jsonb(v_old), 'new', to_jsonb(v_new)));
  return to_jsonb(v_new);
end;
$fn$;
revoke all on function public.admin_v2_gift_save(text, text, text, text, integer, boolean, integer, text) from public, anon;
grant execute on function public.admin_v2_gift_save(text, text, text, text, integer, boolean, integer, text) to authenticated;

drop function if exists public.admin_v2_coin_package_save(text, integer, integer, text, boolean, integer);
create function public.admin_v2_coin_package_save(
  p_product_id  text,
  p_coins       integer,
  p_bonus_coins integer,
  p_price_label text,
  p_active      boolean,
  p_sort_order  integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_old public.coin_packages;
  v_new public.coin_packages;
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_product_id is null or p_product_id !~ '^flyp\.coins\.[a-z0-9_]{1,32}$' then
    raise exception 'product id must look like flyp.coins.<name>' using errcode = '22023';
  end if;
  if p_coins is null or p_coins < 1 or p_coins > 1000000 then
    raise exception 'coins must be between 1 and 1000000' using errcode = '22023';
  end if;
  if coalesce(p_bonus_coins, 0) < 0 or coalesce(p_bonus_coins, 0) > p_coins then
    raise exception 'bonus coins must be between 0 and the coins' using errcode = '22023';
  end if;

  select * into v_old from public.coin_packages where product_id = p_product_id;

  insert into public.coin_packages (product_id, coins, bonus_coins, price_label, active, sort_order)
  values (p_product_id, p_coins, coalesce(p_bonus_coins, 0), nullif(btrim(p_price_label), ''),
          coalesce(p_active, true), coalesce(p_sort_order, 0))
  on conflict (product_id) do update
     set coins = excluded.coins, bonus_coins = excluded.bonus_coins, price_label = excluded.price_label,
         active = excluded.active, sort_order = excluded.sort_order
  returning * into v_new;

  insert into public.admin_logs (admin_id, action, target_type, target_id, payload)
  values (auth.uid(), 'coin_package_save', 'coin_package', v_new.id,
          jsonb_build_object('old', to_jsonb(v_old), 'new', to_jsonb(v_new)));
  return to_jsonb(v_new);
end;
$fn$;
revoke all on function public.admin_v2_coin_package_save(text, integer, integer, text, boolean, integer) from public, anon;
grant execute on function public.admin_v2_coin_package_save(text, integer, integer, text, boolean, integer) to authenticated;

commit;


-- ── Checks (SELECT only) ──
select 'active gifts = ' || count(*) as check, case when count(*) = 15 then 'OK' else 'CHECK' end as result
  from public.gifts where active
union all
select 'active coin packs = ' || count(*), case when count(*) = 6 then 'OK' else 'CHECK' end
  from public.coin_packages where active
union all
select 'rate ' || sar_per_diamond || ' SAR/diamond, min ' || min_withdraw_sar || ' SAR',
       case when sar_per_diamond = 0.0188 and min_withdraw_sar = 40 and diamonds_per_coin = 1 then 'OK' else 'ADMIN-SET' end
  from public.payout_config where id
union all
select 'admin economy functions not callable by anon',
       case when not has_function_privilege('anon', 'public.admin_v2_economy()', 'execute')
             and not has_function_privilege('anon', 'public.admin_v2_gift_save(text,text,text,text,integer,boolean,integer,text)', 'execute')
             and not has_function_privilege('anon', 'public.admin_v2_coin_package_save(text,integer,integer,text,boolean,integer)', 'execute')
            then 'OK' else 'EXPOSED' end;
