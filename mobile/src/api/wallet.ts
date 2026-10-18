// Wallet (client note 12): the coin balance, its ledger, the coin packages on
// sale, and the user's store top-ups.
//
// This module can only READ money. Coins are spent through send_gift (see
// ./gifts) and credited ONLY on the server: credit_wallet_topup (0104) is
// granted to service_role alone and is called by an Edge Function after it
// has verified the store receipt with Apple / Google itself. The app must
// never be given a way to credit coins, so there is no such function here;
// submitStorePurchase only hands a store purchase to that server-side check
// (supabase/functions/verify-purchase). The store flow itself lives in
// src/features/wallet/store.ts.
//
// coin_packages and wallet_topups arrive with 0104, which is not applied to
// any database yet; until then both fetches return [].
//
// ApiError codes introduced in this file:
//   purchase_verification_unavailable  the verify-purchase Edge Function is
//                                      unreachable, not deployed (404) or
//                                      failed (5xx): try again later
//   purchase_verification_failed       it refused the request (4xx); the
//                                      message is its reason
// Shared code also thrown here: 'not_signed_in' (requireUid, or a 401).
import type { PostgrestError } from '@supabase/supabase-js';

import { ApiError, must, requireUid, supabase } from './client';
import type { Iso, Uuid } from './types';

export const walletKeys = {
  all: () => ['wallet'] as const,
  balance: () => ['wallet', 'balance'] as const,
  transactions: (limit = 50) => ['wallet', 'transactions', limit] as const,
  packages: () => ['wallet', 'packages'] as const,
  topups: () => ['wallet', 'topups'] as const,
};

// public.wallets. A missing row means 0 coins: send_gift and the top-up
// create it on first use (and signup seeds one, 0003).
export type Wallet = {
  user_id: Uuid;
  balance: number;
  updated_at: Iso | null;
};

export type WalletTransactionType = 'topup' | 'gift_sent' | 'gift_received' | 'withdrawal';

// public.wallet_transactions. amount is always positive; type says which way
// it went. reference is the gift_transactions id for gifts and the
// wallet_topups id for top-ups.
export type WalletTransaction = {
  id: Uuid;
  user_id: Uuid;
  type: WalletTransactionType;
  amount: number;
  reference: Uuid | null;
  description: string | null;
  created_at: Iso;
};

// public.coin_packages. product_id is the App Store / Play product id; show
// the localized price the store returns for it, price_label only as a
// fallback.
export type CoinPackage = {
  id: Uuid;
  product_id: string;
  coins: number;
  bonus_coins: number;
  price_label: string | null;
  active: boolean;
  sort_order: number;
};

export type WalletTopupStatus = 'pending' | 'credited' | 'rejected';

// public.wallet_topups: one row per store transaction.
export type WalletTopup = {
  id: Uuid;
  user_id: Uuid;
  package_id: Uuid | null;
  platform: 'ios' | 'android';
  store_transaction_id: string;
  status: WalletTopupStatus;
  coins: number;
  created_at: Iso;
  credited_at: Iso | null;
};

// A table that does not exist yet (0104 not applied).
function isMissingTable(e: PostgrestError) {
  return e.code === 'PGRST205' || e.code === '42P01';
}

export async function fetchWallet(): Promise<Wallet> {
  const me = await requireUid();
  // Filtered by our id, not left to RLS: an admin may read every wallet.
  const data = must(
    await supabase.from('wallets').select('user_id, balance, updated_at').eq('user_id', me).maybeSingle<Wallet>(),
  );
  return data ?? { user_id: me, balance: 0, updated_at: null };
}

// Newest first.
export async function fetchWalletTransactions(limit = 50): Promise<WalletTransaction[]> {
  const me = await requireUid();
  const data = must(
    await supabase
      .from('wallet_transactions')
      .select('id, user_id, type, amount, reference, description, created_at')
      .eq('user_id', me)
      .order('created_at', { ascending: false })
      .limit(limit),
  ) as WalletTransaction[] | null;
  return data ?? [];
}

// What can be bought, in shop order. The read policy only returns active rows.
export async function fetchCoinPackages(): Promise<CoinPackage[]> {
  const { data, error } = await supabase
    .from('coin_packages')
    .select('id, product_id, coins, bonus_coins, price_label, active, sort_order')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return (data ?? []) as CoinPackage[];
}

// My purchase history, newest first.
export async function fetchMyTopups(): Promise<WalletTopup[]> {
  const me = await requireUid();
  const { data, error } = await supabase
    .from('wallet_topups')
    .select('id, user_id, package_id, platform, store_transaction_id, status, coins, created_at, credited_at')
    .eq('user_id', me)
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return (data ?? []) as WalletTopup[];
}

// ---------- Store purchase verification ----------
// The 'verify-purchase' Edge Function checks the purchase with the store
// itself (App Store Server API / Google Play Developer API), checks product,
// app and refund state, then calls credit_wallet_topup with the service role
// key. Crediting is idempotent on the store transaction id, so resubmitting
// the same purchase is always safe.
//
// Its answer (HTTP 200) is a verdict in the shape expo-iap's
// createPurchaseFlow understands (PurchaseConfirmation); the flow decides from
// it whether the store transaction may be finished. Only 'entitled' means
// coins were added to this account. The app must NOT finish a purchase on a
// thrown error: the store redelivers it and it is verified again later.

export type StorePurchase = {
  platform: 'ios' | 'android';
  productId: string;
  /** iOS: the StoreKit transaction id. Not needed on Android. */
  transactionId?: string | null;
  /** iOS: the signed JWS transaction. Android: the Play purchase token. */
  purchaseToken: string;
};

export type StorePurchaseVerdict =
  | { status: 'entitled'; alreadyGranted: boolean; coins: number; balance: number; topup_id: Uuid }
  | { status: 'store_pending' }
  | { status: 'ownership_conflict'; alreadyGranted: boolean }
  | { status: 'test_account_restricted' }
  | { status: 'invalid'; reason?: string }
  | { status: 'verification_delayed'; retryAfterMs: number };

type FunctionsErrorLike = { message?: string; context?: Response };

// Throws ApiError:
//   purchase_verification_unavailable  network failure, function not
//                                      deployed (404) or a server / store
//                                      outage (5xx): retry later
//   purchase_verification_failed       any other refusal (bad request)
//   not_signed_in                      401
export async function submitStorePurchase({
  platform,
  productId,
  transactionId,
  purchaseToken,
}: StorePurchase): Promise<StorePurchaseVerdict> {
  await requireUid();
  const { data, error } = await supabase.functions.invoke<StorePurchaseVerdict>('verify-purchase', {
    body: { platform, productId, transactionId: transactionId ?? undefined, purchaseToken },
  });
  if (error) {
    const ctx = (error as FunctionsErrorLike).context;
    // A network failure has no Response.
    const status = ctx instanceof Response ? ctx.status : 0;
    let detail = '';
    try {
      detail = ((await ctx?.json()) as { error?: string } | undefined)?.error ?? '';
    } catch {}
    if (status === 0 || status === 404 || status >= 500) {
      throw new ApiError(
        'purchase_verification_unavailable',
        detail || 'purchase verification is not available right now',
        { status },
      );
    }
    if (status === 401) throw new ApiError('not_signed_in', detail || 'not signed in', { status });
    throw new ApiError(
      'purchase_verification_failed',
      detail || (error as FunctionsErrorLike).message || 'purchase could not be verified',
      { status },
    );
  }
  if (!data || typeof data !== 'object' || !('status' in data)) {
    throw new ApiError('purchase_verification_unavailable', 'verification returned nothing');
  }
  return data;
}
