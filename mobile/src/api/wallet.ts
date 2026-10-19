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
import { uploadToBucket, type LocalMedia } from './upload';

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

// public.wallet_transactions. amount is positive; type says which way it
// went. reference is the gift_transactions id for gifts and the
// wallet_topups id for top-ups.
//
// Since 0131 a received gift credits NO coins: the receiver earns diamonds
// only (creator_earnings, 0130), and their 'gift_received' row has amount 0.
// fetchWalletTransactions fills `diamonds` for those rows from
// creator_earnings (null when unknown, e.g. 0130 not applied). Older
// 'gift_received' rows (amount > 0) are coins that were credited back then.
export type WalletTransaction = {
  id: Uuid;
  user_id: Uuid;
  type: WalletTransactionType;
  amount: number;
  reference: Uuid | null;
  description: string | null;
  created_at: Iso;
  diamonds?: number | null;
};

// A received gift that earned diamonds instead of coins (0131).
export const isDiamondGift = (x: WalletTransaction) => x.type === 'gift_received' && x.amount === 0;

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
  const rows = data ?? [];
  const refs = rows.filter((x) => isDiamondGift(x) && x.reference).map((x) => x.reference as Uuid);
  if (!refs.length) return rows;
  // Own rows only (RLS "creator earnings own read"). Best effort: without
  // 0130, or on any error, the rows simply show no diamond count.
  const { data: earned, error } = await supabase
    .from('creator_earnings')
    .select('gift_transaction_id, diamonds')
    .in('gift_transaction_id', refs);
  if (error || !earned) return rows;
  const byGift = new Map((earned as { gift_transaction_id: Uuid; diamonds: number }[]).map((e) => [e.gift_transaction_id, e.diamonds]));
  return rows.map((x) => (isDiamondGift(x) && x.reference ? { ...x, diamonds: byGift.get(x.reference) ?? null } : x));
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

// ---------- Creator earnings and withdrawals (0130) ----------
// Gifts you RECEIVE earn diamonds (payout_config.diamonds_per_coin per coin;
// since 0131 that is ALL they earn: no coins are credited to the receiver);
// after a hold they can be withdrawn to a Saudi IBAN in your own name, paid
// by bank transfer by an admin. Everything goes through SECURITY DEFINER
// RPCs: creator_kyc / creator_withdrawals have no table grants at all, and
// what comes back to the app is masked (IBAN and ID number). The app never
// computes a balance it acts on: limits are re-checked on the server.
//
// Until 0130 is applied, fetchCreatorEarnings returns null (the section is
// hidden) and fetchMyWithdrawals [].
//
// Errors from the payout RPCs carry a stable code as their message
// (payoutErrorCode); screens translate it.

export type PayoutBlockReason =
  | 'payouts_paused'
  | 'no_birth_date'
  | 'under_age'
  | 'account_too_new'
  | 'account_restricted'
  | 'account_flagged'
  | 'on_hold'
  | 'kyc_missing'
  | 'kyc_pending'
  | 'kyc_rejected'
  | 'no_account';

export type KycStatus = 'pending' | 'approved' | 'rejected';

export type CreatorKyc = {
  status: KycStatus;
  legal_name: string;
  id_type: 'national_id' | 'iqama';
  id_masked: string;
  iban_masked: string;
  bank_name: string;
  reject_reason: string | null;
  submitted_at: Iso;
  reviewed_at: Iso | null;
};

export type CreatorEarnings = {
  active: boolean;
  config: {
    sar_per_diamond: number;
    diamonds_per_coin: number;
    min_withdraw_sar: number;
    hold_days: number;
    min_age: number;
    min_account_age_days: number;
  };
  diamonds: { total: number; pending: number; available: number; withheld: number; reserved: number; withdrawn: number };
  next_release_at: Iso | null;
  next_release_diamonds: number;
  sar: { available: number; pending: number; withheld: number; reserved: number; withdrawn: number };
  max_withdraw_sar: number;
  eligibility: { eligible: boolean; reasons: PayoutBlockReason[]; account_days_left: number };
  open_withdrawal_id: Uuid | null;
  can_request: boolean;
  kyc: CreatorKyc | null;
};

export type WithdrawalStatus = 'requested' | 'approved' | 'paid' | 'rejected' | 'cancelled';

export type CreatorWithdrawal = {
  id: Uuid;
  amount_sar: number;
  diamonds: number;
  status: WithdrawalStatus;
  iban_masked: string;
  bank_name: string;
  bank_reference: string | null;
  reject_reason: string | null;
  requested_at: Iso;
  approved_at: Iso | null;
  paid_at: Iso | null;
  rejected_at: Iso | null;
  cancelled_at: Iso | null;
};

export const creatorKeys = {
  all: () => ['wallet', 'creator'] as const,
  summary: () => ['wallet', 'creator', 'summary'] as const,
  withdrawals: () => ['wallet', 'creator', 'withdrawals'] as const,
};

// The RPC does not exist yet (0130 not applied).
function isMissingFunction(e: PostgrestError) {
  return e.code === 'PGRST202' || e.code === '42883';
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0) || 0);

export async function fetchCreatorEarnings(): Promise<CreatorEarnings | null> {
  await requireUid();
  const { data, error } = await supabase.rpc('my_creator_earnings');
  if (error) {
    if (isMissingFunction(error)) return null;
    throw error;
  }
  if (!data || typeof data !== 'object') return null;
  const d = data as CreatorEarnings;
  // numeric columns arrive as numbers or strings depending on size.
  return {
    ...d,
    config: {
      sar_per_diamond: num(d.config?.sar_per_diamond),
      diamonds_per_coin: num(d.config?.diamonds_per_coin),
      min_withdraw_sar: num(d.config?.min_withdraw_sar),
      hold_days: num(d.config?.hold_days),
      min_age: num(d.config?.min_age),
      min_account_age_days: num(d.config?.min_account_age_days),
    },
    diamonds: {
      total: num(d.diamonds?.total),
      pending: num(d.diamonds?.pending),
      available: num(d.diamonds?.available),
      withheld: num(d.diamonds?.withheld),
      reserved: num(d.diamonds?.reserved),
      withdrawn: num(d.diamonds?.withdrawn),
    },
    next_release_diamonds: num(d.next_release_diamonds),
    sar: {
      available: num(d.sar?.available),
      pending: num(d.sar?.pending),
      withheld: num(d.sar?.withheld),
      reserved: num(d.sar?.reserved),
      withdrawn: num(d.sar?.withdrawn),
    },
    max_withdraw_sar: num(d.max_withdraw_sar),
    eligibility: {
      eligible: !!d.eligibility?.eligible,
      reasons: (d.eligibility?.reasons ?? []) as PayoutBlockReason[],
      account_days_left: num(d.eligibility?.account_days_left),
    },
  };
}

export async function fetchMyWithdrawals(limit = 50): Promise<CreatorWithdrawal[]> {
  await requireUid();
  const { data, error } = await supabase.rpc('my_creator_withdrawals', { p_limit: limit });
  if (error) {
    if (isMissingFunction(error)) return [];
    throw error;
  }
  return ((data ?? []) as CreatorWithdrawal[]).map((w) => ({ ...w, amount_sar: num(w.amount_sar) }));
}

// IBAN: spaces removed, upper case.
export const normalizeIban = (s: string) => s.replace(/\s+/g, '').toUpperCase();

// SA + 22 digits with the ISO 13616 mod-97 check. The server checks again.
export function isValidSaudiIban(input: string): boolean {
  const v = normalizeIban(input);
  if (!/^SA\d{22}$/.test(v)) return false;
  const r = v.slice(4) + '2810' + v.slice(2, 4); // S = 28, A = 10
  let m = 0;
  for (const ch of r) m = (m * 10 + Number(ch)) % 97;
  return m === 1;
}

// Saudi national ID (starts with 1) or Iqama (starts with 2), 10 digits.
export const isValidSaudiId = (s: string) => /^[12]\d{9}$/.test(s.replace(/\s+/g, ''));

export type KycSubmission = {
  legalName: string;
  idNumber: string;
  idPhoto: LocalMedia;
  iban: string;
  bankName: string;
  ownerAttested: boolean;
};

// Uploads the ID photo to the private 'kyc' bucket (<uid>/id-<time>.jpg;
// only you and admins can read it), then submits the details for review.
export async function submitKyc(k: KycSubmission): Promise<void> {
  const path = await uploadToBucket('kyc', k.idPhoto, { prefix: 'id' });
  const { error } = await supabase.rpc('creator_submit_kyc', {
    p_legal_name: k.legalName.trim(),
    p_id_number: k.idNumber.replace(/\s+/g, ''),
    p_id_photo_path: path,
    p_iban: normalizeIban(k.iban),
    p_bank_name: k.bankName.trim(),
    p_owner_attested: k.ownerAttested,
  });
  if (error) throw error;
}

export async function requestWithdrawal(amountSar: number): Promise<{ id: Uuid; amount_sar: number; diamonds: number }> {
  const { data, error } = await supabase.rpc('creator_request_withdrawal', { p_amount_sar: amountSar });
  if (error) throw error;
  const d = data as { id: Uuid; amount_sar: number; diamonds: number };
  return { id: d.id, amount_sar: num(d.amount_sar), diamonds: num(d.diamonds) };
}

export async function cancelWithdrawal(id: Uuid): Promise<void> {
  const { error } = await supabase.rpc('creator_cancel_withdrawal', { p_id: id });
  if (error) throw error;
}

// The stable codes the payout RPCs raise. Anything else is 'unknown'.
export const PAYOUT_ERROR_CODES = [
  'not_signed_in',
  'account_restricted',
  'no_birth_date',
  'under_age',
  'invalid_name',
  'invalid_id_number',
  'invalid_iban',
  'invalid_bank',
  'must_confirm_owner',
  'photo_missing',
  'id_in_use',
  'iban_in_use',
  'kyc_locked',
  'too_many_submissions',
  'open_withdrawal',
  'bad_amount',
  'below_minimum',
  'above_available',
  'not_eligible',
  'cannot_cancel',
  'upload_failed',
] as const;
export type PayoutErrorCode = (typeof PAYOUT_ERROR_CODES)[number] | 'unknown';

export function payoutErrorCode(e: unknown): PayoutErrorCode {
  if (e instanceof ApiError && e.code === 'not_signed_in') return 'not_signed_in';
  const msg = String((e as { message?: string } | null)?.message ?? '');
  const head = msg.split(':')[0].trim();
  if ((PAYOUT_ERROR_CODES as readonly string[]).includes(head)) return head as PayoutErrorCode;
  // Storage refusals (size / type / quota) while uploading the ID photo.
  if (/storage|bucket|payload|mime|row-level security|exceeded/i.test(msg)) return 'upload_failed';
  return 'unknown';
}
