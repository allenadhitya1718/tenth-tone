// Buying coins through the App Store / Google Play (client note 12).
//
// Coins are a consumable In-App Purchase (App Review 3.1.1, Play Billing).
// expo-iap talks to StoreKit 2 / Play Billing; its createPurchaseFlow decides
// when a transaction may be finished, from the verdict of our own server
// (verify-purchase Edge Function, via submitStorePurchase):
//
//   1. requestPurchase (the buyer's FLYP user id rides along as
//      appAccountToken / obfuscatedAccountId, so the server credits the
//      account that paid even if someone else is signed in later);
//   2. purchaseUpdatedListener delivers the purchase -> processPurchase sends
//      it to verify-purchase, which checks it with Apple / Google and credits
//      the wallet (credit_wallet_topup, idempotent);
//   3. only on a settled verdict is finishTransaction({ isConsumable: true })
//      called (consumes on Android) - never before the server confirmed.
//
// The app never credits coins. A network failure or server outage leaves the
// transaction unfinished: the store keeps it and recovery (on connect, when
// the app comes back to the foreground, and on a backoff timer) sends it
// again. Android "pending" payments are not finished either; Play redelivers
// them once paid. Consumables have nothing to restore.
//
// One store connection for the whole app, shared by every screen. The wallet
// screen starts it; call startStorePurchaseRecovery() once after sign-in
// (e.g. in the signed-in layout) to also settle unfinished purchases at app
// start.
import * as Device from 'expo-device';
import {
  createPurchaseFlow,
  ErrorCode,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  getPendingTransactionsIOS,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  type Product,
  type Purchase,
  type PurchaseConfirmation,
  type PurchaseFlowStatus,
} from 'expo-iap';
import { AppState, Platform } from 'react-native';

import { requireUid } from '@/api/client';
import { submitStorePurchase } from '@/api/wallet';

export const COIN_PRODUCT_PREFIX = 'flyp.coins.';

export type StoreStatus =
  | 'idle'
  | 'connecting'
  | 'ready'
  // No store on this platform (web).
  | 'unsupported'
  // Simulator / emulator: Buy is hidden.
  | 'simulator'
  // The store could not be reached or billing is not available.
  | 'unavailable';

// What the screen shows after a purchase settles (or fails).
export type PurchaseNotice =
  | { kind: 'credited'; coins: number; userInitiated: boolean }
  | { kind: 'pending'; userInitiated: boolean }
  | { kind: 'retryLater'; userInitiated: boolean }
  | { kind: 'otherAccount'; granted: boolean; userInitiated: boolean }
  | { kind: 'testRestricted'; userInitiated: boolean }
  | { kind: 'invalid'; userInitiated: boolean }
  // The store refused before any payment (not a cancel).
  | { kind: 'failed'; userInitiated: boolean };

export type StoreSnapshot = {
  status: StoreStatus;
  /** Store products by product id; missing = not set up in the store. */
  products: Record<string, Product>;
  /** Product id of the purchase the user started and is waiting on. */
  buying: string | null;
};

let snapshot: StoreSnapshot = { status: 'idle', products: {}, buying: null };
const listeners = new Set<() => void>();
const noticeListeners = new Set<(n: PurchaseNotice) => void>();

function set(patch: Partial<StoreSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeStore(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export const getStoreSnapshot = () => snapshot;

/** Purchase results, for the wallet sheet and for refreshing the balance. */
export function onPurchaseNotice(l: (n: PurchaseNotice) => void) {
  noticeListeners.add(l);
  return () => {
    noticeListeners.delete(l);
  };
}
function notify(n: PurchaseNotice) {
  noticeListeners.forEach((l) => l(n));
}

const isCoin = (productId: string) => productId.startsWith(COIN_PRODUCT_PREFIX);

// ---------- server confirmation ----------

// Coins credited per transaction id, read back when the outcome is reported.
const lastCoins = new Map<string, number>();

// Settles nothing on its own: createPurchaseFlow finishes the transaction
// only for 'entitled', 'ownership_conflict' with alreadyGranted, and (iOS)
// settled rejections. A thrown error = 'failed' = left for recovery.
async function confirmWithBackend(p: Purchase): Promise<PurchaseConfirmation> {
  if (!p.purchaseToken) throw new Error('purchase has no token');
  const verdict = await submitStorePurchase({
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    productId: p.productId,
    transactionId: Platform.OS === 'ios' ? p.id : null,
    purchaseToken: p.purchaseToken,
  });
  if (verdict.status === 'entitled') lastCoins.set(p.id, verdict.coins);
  return verdict;
}

const flow = createPurchaseFlow<Purchase>({
  confirmWithBackend,
  confirmTimeoutMs: 30_000,
  finishTransaction: (args) => finishTransaction(args),
  isConsumable: isCoin,
  getAvailablePurchases: () => getAvailablePurchases(),
  getPendingTransactionsIOS: Platform.OS === 'ios' ? () => getPendingTransactionsIOS() : undefined,
});

// ---------- retry ----------

const RETRY_STEPS_MS = [30_000, 2 * 60_000, 10 * 60_000];
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryStep = 0;

function scheduleRetry(afterMs?: number) {
  if (retryTimer) return;
  const ms = Math.min(afterMs ?? RETRY_STEPS_MS[Math.min(retryStep, RETRY_STEPS_MS.length - 1)], 10 * 60_000);
  retryStep++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void recover();
  }, ms);
}

function handleOutcome(p: Purchase, status: PurchaseFlowStatus) {
  if (!isCoin(p.productId)) return;
  const userInitiated = snapshot.buying === p.productId;
  if (userInitiated) set({ buying: null });
  switch (status.status) {
    case 'entitled':
      retryStep = 0;
      notify({ kind: 'credited', coins: lastCoins.get(p.id) ?? 0, userInitiated });
      lastCoins.delete(p.id);
      // finishError: the coins are in; finishing is retried by recovery.
      if (status.finishError) scheduleRetry();
      return;
    case 'store_pending':
      notify({ kind: 'pending', userInitiated });
      return;
    case 'ownership_conflict':
      notify({ kind: 'otherAccount', granted: status.alreadyGranted, userInitiated });
      return;
    case 'test_account_restricted':
      notify({ kind: 'testRestricted', userInitiated });
      return;
    case 'invalid':
      notify({ kind: 'invalid', userInitiated });
      return;
    case 'verification_delayed':
      notify({ kind: 'retryLater', userInitiated });
      scheduleRetry(status.retryAfterMs);
      return;
    case 'verified':
    case 'linked':
    case 'failed':
      if (status.status === 'failed') console.warn('coin purchase not confirmed yet:', (status.error as Error)?.message ?? status.error);
      notify({ kind: 'retryLater', userInitiated });
      scheduleRetry();
      return;
  }
}

async function process(p: Purchase) {
  if (!isCoin(p.productId)) return;
  handleOutcome(p, await flow.processPurchase(p));
}

let recovering: Promise<void> | null = null;
let lastRecover = 0;

// Sends every unfinished coin purchase to the server again.
function recover(): Promise<void> {
  if (snapshot.status !== 'ready') return Promise.resolve();
  if (recovering) return recovering;
  lastRecover = Date.now();
  recovering = (async () => {
    try {
      await requireUid();
      const outcomes = await flow.recoverPurchases();
      for (const o of outcomes) handleOutcome(o.purchase, o.status);
    } catch (e) {
      // Not signed in, or the store list failed: try again later.
      console.warn('coin purchase recovery:', (e as Error)?.message ?? e);
    } finally {
      recovering = null;
    }
  })();
  return recovering;
}

// ---------- connection ----------

let connecting: Promise<void> | null = null;

/** Connects once, loads the coin products, then settles unfinished purchases. */
export function connectStore(productIds: string[] = []): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    set({ status: 'unsupported' });
    return Promise.resolve();
  }
  if (!Device.isDevice) {
    set({ status: 'simulator' });
    return Promise.resolve();
  }
  if (snapshot.status === 'ready') return loadProducts(productIds);
  if (connecting) return connecting.then(() => loadProducts(productIds));

  set({ status: 'connecting' });
  connecting = (async () => {
    try {
      const ok = await initConnection();
      if (!ok) throw new Error('store not connected');
      purchaseUpdatedListener((p) => void process(p));
      purchaseErrorListener(onPurchaseError);
      AppState.addEventListener('change', (s) => {
        // Back from the store's payment sheet, a bank app, etc.
        if (s === 'active' && Date.now() - lastRecover > 15_000) void recover();
      });
      set({ status: 'ready' });
      void recover();
    } catch (e) {
      console.warn('store connection:', (e as Error)?.message ?? e);
      set({ status: 'unavailable' });
    } finally {
      connecting = null;
    }
  })();
  return connecting.then(() => loadProducts(productIds));
}

let loadedFor = '';

async function loadProducts(productIds: string[]) {
  const skus = [...new Set(productIds.filter(isCoin))].sort();
  const key = skus.join(',');
  if (snapshot.status !== 'ready' || !skus.length || key === loadedFor) return;
  try {
    const found = (await fetchProducts({ skus, type: 'in-app' })) ?? [];
    const products: Record<string, Product> = {};
    for (const p of found) if (p.type === 'in-app') products[p.id] = p as Product;
    loadedFor = key;
    set({ products });
  } catch (e) {
    console.warn('store products:', (e as Error)?.message ?? e);
  }
}

/** For a "Try again" after the store was unavailable. */
export function reconnectStore(productIds: string[]) {
  if (snapshot.status === 'unavailable') set({ status: 'idle' });
  loadedFor = '';
  return connectStore(productIds);
}

/**
 * Settle unfinished coin purchases at app start (signed-in only). Safe to
 * call many times; it does nothing on simulators or without a store.
 */
export function startStorePurchaseRecovery() {
  return connectStore();
}

// ---------- buying ----------

// expo-iap's listener error (utils/errorMapping) or a rejected requestPurchase.
type StoreError = { code?: ErrorCode | string; message?: string };

function onPurchaseError(e: StoreError) {
  const product = snapshot.buying;
  if (!product) return;
  set({ buying: null });
  switch (e.code) {
    case ErrorCode.UserCancelled:
      return; // nothing to say
    case ErrorCode.Pending:
    case ErrorCode.DeferredPayment:
      // Ask to Buy / slow payment: the purchase arrives later through the
      // listener (or recovery).
      notify({ kind: 'pending', userInitiated: true });
      return;
    case ErrorCode.AlreadyOwned:
    case ErrorCode.DuplicatePurchase:
      // An earlier purchase of this package was never consumed (Android):
      // settle it, which consumes it so it can be bought again.
      notify({ kind: 'retryLater', userInitiated: true });
      void recover();
      return;
    default:
      console.warn('coin purchase error:', e.code, e.message);
      notify({ kind: 'failed', userInitiated: true });
  }
}

/** Starts the store's payment sheet. The result arrives as a PurchaseNotice. */
export async function buyCoins(productId: string) {
  if (snapshot.status !== 'ready' || snapshot.buying || !snapshot.products[productId]) return;
  const uid = await requireUid();
  set({ buying: productId });
  try {
    await requestPurchase({
      type: 'in-app',
      request: {
        apple: { sku: productId, quantity: 1, appAccountToken: uid },
        google: { skus: [productId], obfuscatedAccountId: uid },
      },
    });
    // The outcome comes through purchaseUpdatedListener / purchaseErrorListener.
  } catch (e) {
    onPurchaseError((e ?? {}) as StoreError);
  }
}
