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
