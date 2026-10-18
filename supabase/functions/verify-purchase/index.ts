// =============================================================
// verify-purchase
//
// Credits coins for an App Store / Google Play coin purchase (client note 12)
// after checking it with the store itself. The app never credits coins; this
// is the only caller of credit_wallet_topup (0104), which only the service
// role may execute.
//
// POST, signed-in user (JWT). Body:
//   { platform: 'ios' | 'android',
//     productId: 'flyp.coins.500',
//     transactionId?: string,   // iOS: StoreKit transaction id (required if
//                               //      purchaseToken is not the JWS)
//     purchaseToken: string }   // iOS: the signed JWS transaction
//                               // Android: the Play purchase token
//
// Answer (HTTP 200) - the shape expo-iap's createPurchaseFlow expects, which
// is what decides whether the app may finish the store transaction:
//   { status: 'entitled', alreadyGranted, coins, balance, topup_id }
//        credited now, or already credited earlier (alreadyGranted = true);
//        the app finishes (consumes) the transaction.
//   { status: 'store_pending' }
//        Google Play "pending" payment (cash, bank transfer...). A 'pending'
//        wallet_topups row is recorded; nothing is credited; the app does not
//        finish. Play redelivers the purchase once it is paid.
//   { status: 'ownership_conflict', alreadyGranted }
//        the purchase belongs to another FLYP account (the store says so via
//        appAccountToken / obfuscatedAccountId, or another account already
//        claimed this transaction). alreadyGranted = true means that account
//        has its coins, so the app may finish it.
//   { status: 'test_account_restricted' }
//        a sandbox / test purchase while IAP_ALLOW_SANDBOX is not 'true' (the
//        default) or from an account not listed in IAP_SANDBOX_USER_IDS.
//   { status: 'invalid', reason }
//        refunded, cancelled, wrong app, wrong product... never credited.
//   { status: 'verification_delayed', retryAfterMs }
//        could not be settled yet (store not found yet, product missing from
//        coin_packages); the app keeps the transaction and retries.
// Any non-200 answer (bad secrets, store outage) is a failure the app also
// retries later. Nothing is ever credited on a failure.
//
// Idempotent: crediting goes through credit_wallet_topup, keyed on the
// unique wallet_topups.store_transaction_id:
//   iOS      the App Store transactionId
//   Android  'gp:' + sha256(purchase token)   (pending purchases have no
//            order id yet; the token exists from the start)
// so a retry, a second device, or a replayed receipt never credits twice.
//
// Secrets (Supabase -> Edge Functions -> Secrets):
//   APPLE_IAP_KEY_ID           App Store Connect -> Users and Access ->
//   APPLE_IAP_ISSUER_ID          Integrations -> In-App Purchase key: Key ID,
//   APPLE_IAP_PRIVATE_KEY        Issuer ID, and the downloaded .p8 contents
//   APPLE_BUNDLE_ID            com.flyp.social
//   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON  service account key (JSON) with
//                              "View financial data" + "Manage orders and
//                              subscriptions" on the app in Play Console
//   GOOGLE_PLAY_PACKAGE_NAME   optional, default com.flyp.app
//   IAP_ALLOW_SANDBOX          optional, default 'false'. Only the exact
//                              value 'true' lets a sandbox / test purchase
//                              credit coins. App Review buys in the Apple
//                              sandbox with the production build, so set it
//                              to 'true' ONLY while a build is in review and
//                              back to 'false' after. Sandbox top-ups are
//                              marked environment = 'sandbox' (0111). An
//                              unset secret must never mean "free coins":
//                              anyone with a sandbox tester account could
//                              otherwise mint real balance.
//   IAP_SANDBOX_USER_IDS       optional, comma-separated FLYP user ids (uuids).
//                              A sandbox purchase credits coins ONLY when
//                              IAP_ALLOW_SANDBOX is 'true' AND the buyer is in
//                              this list. Empty = no sandbox purchase is ever
//                              credited. For App Review: create the demo
//                              account you give Apple / Google, put its user
//                              id here (Supabase -> Authentication -> Users),
//                              set IAP_ALLOW_SANDBOX=true while the build is in
//                              review, and set it back to 'false' (and remove
//                              the id) once it is approved. Your own test
//                              accounts can be listed the same way.
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected.
//
// Deploy normally (JWT verified). Never --no-verify-jwt: crediting is per
// user. Apply 0104 and 0111 first.
//
// Apple: the transaction is fetched from the App Store Server API
// (GET /inApps/v1/transactions/{id}) over TLS with our own API key, so its
// signedTransactionInfo is trusted as Apple's answer; the JWS the app sends
// is only used to find the transaction id. Production is asked first and the
// sandbox on "not found", as Apple recommends (TestFlight and App Review
// purchases live in the sandbox).
//
// Refunds after crediting are not handled here: that needs App Store Server
// Notifications V2 (REFUND) and the Play Voided Purchases API / RTDN.
// =============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const env = (k: string) => Deno.env.get(k) ?? '';

const SUPABASE_URL = env('SUPABASE_URL');
const ANON_KEY = env('SUPABASE_ANON_KEY');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');

const APPLE_KEY_ID = env('APPLE_IAP_KEY_ID');
const APPLE_ISSUER_ID = env('APPLE_IAP_ISSUER_ID');
const APPLE_PRIVATE_KEY = env('APPLE_IAP_PRIVATE_KEY').replace(/\\n/g, '\n');
const APPLE_BUNDLE_ID = env('APPLE_BUNDLE_ID') || 'com.flyp.social';

const GOOGLE_SA_JSON = env('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON');
const GOOGLE_PACKAGE = env('GOOGLE_PLAY_PACKAGE_NAME') || 'com.flyp.app';

const ALLOW_SANDBOX = env('IAP_ALLOW_SANDBOX').trim().toLowerCase() === 'true';
const SANDBOX_USER_IDS = new Set(
  env('IAP_SANDBOX_USER_IDS')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)),
);

const PRODUCT_PREFIX = 'flyp.coins.';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

type Verdict =
  | { status: 'entitled'; alreadyGranted: boolean; coins: number; balance: number; topup_id: string }
  | { status: 'store_pending' }
  | { status: 'ownership_conflict'; alreadyGranted: boolean }
  | { status: 'test_account_restricted' }
  | { status: 'invalid'; reason: string }
  | { status: 'verification_delayed'; retryAfterMs: number };

const invalid = (reason: string): Verdict => ({ status: 'invalid', reason });
const delayed = (retryAfterMs: number): Verdict => ({ status: 'verification_delayed', retryAfterMs });

// A store or configuration failure: answered as HTTP 5xx, retried by the app.
class StoreError extends Error {}

// ---------- small crypto helpers (same as send-push) ----------
const enc = new TextEncoder();
function b64url(data: ArrayBuffer | Uint8Array | string) {
  const bytes = typeof data === 'string' ? enc.encode(data) : new Uint8Array(data);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(out);
}
function pemToDer(pem: string) {
  const b64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
async function signJwt(header: object, claims: object, key: CryptoKey, alg: 'RS256' | 'ES256') {
  const input = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claims));
  const params = alg === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' };
  // WebCrypto ECDSA returns r||s (IEEE P1363), which is what JWS ES256 wants.
  const sig = await crypto.subtle.sign(params, key, enc.encode(input));
  return input + '.' + b64url(sig);
}
// Payload of a JWS / JWT, without checking its signature. Only used on the
// app's JWS to find the transaction id, and on Apple's own TLS answer.
function jwsPayload<T>(jws: string): T | null {
  const parts = jws.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(b64urlDecode(parts[1])) as T;
  } catch {
    return null;
  }
}
async function sha256Hex(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- what a verified store purchase looks like ----------
type StorePurchase = {
  platform: 'ios' | 'android';
  storeTransactionId: string;      // wallet_topups.store_transaction_id
  productId: string;
  state: 'purchased' | 'pending';
  environment: 'production' | 'sandbox';
  orderId: string | null;
  quantity: number;
  // The FLYP user id the app attached when buying (appAccountToken /
  // obfuscatedAccountId), as the store reports it. null = not attached.
  accountId: string | null;
  // Android: still to be consumed on Play's side.
  googleToken?: string;
  googleNeedsConsume?: boolean;
};

// ---------- Apple: App Store Server API ----------
let appleJwt: { value: string; iat: number } | null = null;
async function appleBearer() {
  const now = Math.floor(Date.now() / 1000);
  if (appleJwt && now - appleJwt.iat < 30 * 60) return appleJwt.value;
  if (!APPLE_KEY_ID || !APPLE_ISSUER_ID || !APPLE_PRIVATE_KEY) {
    throw new StoreError('APPLE_IAP_KEY_ID / APPLE_IAP_ISSUER_ID / APPLE_IAP_PRIVATE_KEY not set');
  }
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToDer(APPLE_PRIVATE_KEY), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  );
  // Apple: exp at most 60 minutes after iat.
  const value = await signJwt(
    { alg: 'ES256', kid: APPLE_KEY_ID, typ: 'JWT' },
    { iss: APPLE_ISSUER_ID, iat: now, exp: now + 50 * 60, aud: 'appstoreconnect-v1', bid: APPLE_BUNDLE_ID },
    key, 'ES256',
  );
  appleJwt = { value, iat: now };
  return value;
}

const APPLE_HOSTS = {
  production: 'https://api.storekit.itunes.apple.com',
  sandbox: 'https://api.storekit-sandbox.itunes.apple.com',
} as const;

type AppleTransaction = {
  transactionId: string;
  originalTransactionId?: string;
  bundleId: string;
  productId: string;
  type: string;                 // 'Consumable'
  quantity?: number;
  revocationDate?: number;
  revocationReason?: number;
  environment: 'Production' | 'Sandbox' | 'Xcode' | string;
  appAccountToken?: string;
};

// null = Apple does not know this transaction in that environment.
async function appleLookup(host: keyof typeof APPLE_HOSTS, transactionId: string): Promise<AppleTransaction | null> {
  const r = await fetch(`${APPLE_HOSTS[host]}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`, {
    headers: { Authorization: 'Bearer ' + (await appleBearer()) },
  });
  if (r.status === 404) return null;
  const body = await r.json().catch(() => ({}));
  if (r.status === 400) {
    // 4000006 InvalidTransactionIdError: not a transaction id at all.
    return { transactionId, bundleId: '', productId: '', type: '', environment: 'invalid' };
  }
  if (r.status === 401) {
    appleJwt = null;
    throw new StoreError('Apple rejected the API key (401): check APPLE_IAP_* secrets');
  }
  if (!r.ok) throw new StoreError(`Apple ${host} ${r.status} ${JSON.stringify(body).slice(0, 200)}`);
  const tx = jwsPayload<AppleTransaction>(String(body.signedTransactionInfo ?? ''));
  if (!tx) throw new StoreError('Apple answered without a readable signedTransactionInfo');
  return tx;
}

async function verifyApple(transactionId: string): Promise<StorePurchase | Verdict> {
  if (!/^\d{1,32}$/.test(transactionId)) return invalid('bad transaction id');
  // Production first, the sandbox on "not found" (Apple's recommendation).
  let tx = await appleLookup('production', transactionId);
  if (!tx) tx = await appleLookup('sandbox', transactionId);
  // Unknown to both. A real transaction is always found, so this is a local
  // Xcode StoreKit test or a forged id; keep it, try again later, never credit.
  if (!tx) return delayed(10 * 60_000);
  if (tx.environment === 'invalid') return invalid('bad transaction id');

  if (tx.bundleId !== APPLE_BUNDLE_ID) return invalid('purchase is for another app');
  if (tx.type && tx.type !== 'Consumable') return invalid('not a consumable');
  if (tx.revocationDate) return invalid('refunded');

  return {
    platform: 'ios',
    storeTransactionId: String(tx.transactionId),
    productId: tx.productId,
    state: 'purchased',
    environment: tx.environment === 'Production' ? 'production' : 'sandbox',
    orderId: null,
    quantity: tx.quantity ?? 1,
    accountId: tx.appAccountToken ? tx.appAccountToken.toLowerCase() : null,
  };
}

// ---------- Google: Play Developer API ----------
let googleToken: { value: string; exp: number } | null = null;
async function googleAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (googleToken && googleToken.exp > now + 60) return googleToken.value;
  if (!GOOGLE_SA_JSON) throw new StoreError('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON not set');
  let sa: { client_email: string; private_key: string; token_uri?: string };
  try {
    sa = JSON.parse(GOOGLE_SA_JSON);
  } catch {
    throw new StoreError('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON');
  }
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
  const jwt = await signJwt({ alg: 'RS256', typ: 'JWT' }, {
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: tokenUri, iat: now, exp: now + 3600,
  }, key, 'RS256');
  const r = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + encodeURIComponent(jwt),
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) throw new StoreError('Google oauth: ' + JSON.stringify(t).slice(0, 200));
  googleToken = { value: t.access_token, exp: now + (t.expires_in || 3600) };
  return googleToken.value;
}

const playUrl = (productId: string, token: string, action = '') =>
  `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(GOOGLE_PACKAGE)}` +
  `/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}${action}`;

// purchases.products resource (v3)
type PlayProductPurchase = {
  purchaseState?: number;       // 0 purchased, 1 cancelled (incl. refunded), 2 pending
  consumptionState?: number;    // 0 not yet consumed, 1 consumed
  acknowledgementState?: number;
  orderId?: string;
  purchaseType?: number;        // absent = real purchase, 0 test, 1 promo code, 2 rewarded
  quantity?: number;
  productId?: string;
  obfuscatedExternalAccountId?: string;
};

async function verifyGoogle(productId: string, token: string): Promise<StorePurchase | Verdict> {
  if (token.length < 20 || token.length > 4096) return invalid('bad purchase token');
  const r = await fetch(playUrl(productId, token), {
    headers: { Authorization: 'Bearer ' + (await googleAccessToken()) },
  });
  const body = (await r.json().catch(() => ({}))) as PlayProductPurchase & { error?: { message?: string } };
  // 400 / 404 / 410: the token does not exist for this app and product, or
  // is no longer valid. Settled.
  if (r.status === 400 || r.status === 404 || r.status === 410) {
    return invalid(body.error?.message ?? 'unknown purchase token');
  }
  if (r.status === 401 || r.status === 403) {
    googleToken = null;
    throw new StoreError(`Google Play ${r.status}: the service account has no access to ${GOOGLE_PACKAGE}`);
  }
  if (!r.ok) throw new StoreError(`Google Play ${r.status} ${JSON.stringify(body).slice(0, 200)}`);

  if (body.productId && body.productId !== productId) return invalid('product mismatch');
  if (body.purchaseState === 1) return invalid('cancelled or refunded');
  if (body.purchaseType === 2) return invalid('rewarded purchases do not buy coins');
  const tokenHash = await sha256Hex(token);
  return {
    platform: 'android',
    storeTransactionId: 'gp:' + tokenHash,
    productId,
    state: body.purchaseState === 0 ? 'purchased' : 'pending',
    // purchaseType 0 = license tester / test card.
    environment: body.purchaseType === 0 ? 'sandbox' : 'production',
    orderId: body.orderId || null,
    quantity: body.quantity ?? 1,
    accountId: body.obfuscatedExternalAccountId ? body.obfuscatedExternalAccountId.toLowerCase() : null,
    googleToken: token,
    googleNeedsConsume: body.consumptionState !== 1,
  };
}

// Consuming on the server too means Play cannot auto-refund (unacknowledged
// after 3 days) even if the app never comes back to finish. A failure here is
// harmless: the app's finishTransaction consumes, and recovery retries.
async function googleConsume(p: StorePurchase) {
  if (!p.googleToken || !p.googleNeedsConsume) return;
  try {
    const r = await fetch(playUrl(p.productId, p.googleToken, ':consume'), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + (await googleAccessToken()) },
    });
    if (!r.ok) console.warn('play consume', r.status, (await r.text()).slice(0, 200));
  } catch (e) {
    console.warn('play consume', (e as Error).message);
  }
}

// ---------- handler ----------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'server not configured' }, 500);

  // ---- who is asking ----
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'not signed in' }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'not signed in' }, 401);
  const me = userData.user.id.toLowerCase();

  // ---- what they bought ----
  let body: { platform?: unknown; productId?: unknown; transactionId?: unknown; purchaseToken?: unknown; receipt?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  const platform = body.platform;
  const productId = String(body.productId ?? '').trim();
  // `receipt` is the older name of purchaseToken (api/wallet.ts before 0111).
  const token = String(body.purchaseToken ?? body.receipt ?? '').trim();
  let transactionId = String(body.transactionId ?? '').trim();
  if (platform !== 'ios' && platform !== 'android') return json({ error: 'bad platform' }, 400);
  if (!productId.startsWith(PRODUCT_PREFIX) || productId.length > 100) return json({ error: 'bad product id' }, 400);
  if (!token && !transactionId) return json({ error: 'purchase token required' }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  try {
    // ---- ask the store ----
    let verified: StorePurchase | Verdict;
    if (platform === 'ios') {
      // The app's JWS is only a pointer to the transaction; Apple's own answer
      // is what is checked.
      const fromJws = token ? jwsPayload<{ transactionId?: string | number }>(token)?.transactionId : undefined;
      if (fromJws != null) {
        if (transactionId && transactionId !== String(fromJws)) return json(invalid('transaction id mismatch'));
        transactionId = String(fromJws);
      }
      if (!transactionId) return json(invalid('no transaction id'));
      verified = await verifyApple(transactionId);
    } else {
      if (!token) return json(invalid('no purchase token'));
      verified = await verifyGoogle(productId, token);
    }
    if ('status' in verified) return json(verified);
    const p = verified;

    if (p.productId !== productId) return json(invalid('product mismatch'));
    if (p.quantity !== 1) {
      // The app always buys one. Never credit a different amount silently.
      console.error('verify-purchase: quantity', p.quantity, p.storeTransactionId);
      return json(delayed(60 * 60_000));
    }
    // Sandbox money is not money: only listed test / review accounts, and only
    // while sandbox crediting is switched on.
    if (p.environment === 'sandbox' && !(ALLOW_SANDBOX && SANDBOX_USER_IDS.has(me))) {
      return json({ status: 'test_account_restricted' });
    }

    // ---- the package ----
    // Deactivated packages are still honoured: the purchase was paid for.
    const { data: pkg, error: pkgErr } = await db
      .from('coin_packages').select('id, coins, bonus_coins').eq('product_id', p.productId).maybeSingle();
    if (pkgErr) throw new StoreError('coin_packages: ' + pkgErr.message);
    if (!pkg) {
      // A real purchase of a product the database does not sell: a setup
      // mistake. Keep it unfinished so it can be credited once fixed.
      console.error('verify-purchase: product not in coin_packages', p.productId);
      return json(delayed(60 * 60_000));
    }

    // ---- whose coins ----
    // The app attaches the buyer's user id to the purchase. If someone else
    // is signed in now (shared phone, account switch), the coins still go to
    // the account that paid.
    let owner = me;
    if (p.accountId && UUID_RE.test(p.accountId) && p.accountId !== me) {
      const { data: prof } = await db.from('profiles').select('id').eq('id', p.accountId).maybeSingle();
      if (!prof) return json({ status: 'ownership_conflict', alreadyGranted: false });
      owner = p.accountId;
    }
    // A sandbox purchase is only credited to the listed account that is
    // signed in now. appAccountToken / obfuscatedAccountId are set by the
    // client, so without this a listed tester could direct sandbox coins to
    // any other account.
    if (p.environment === 'sandbox' && owner !== me) {
      return json({ status: 'test_account_restricted' });
    }

    const { data: existing, error: exErr } = await db
      .from('wallet_topups').select('id, user_id, status')
      .eq('store_transaction_id', p.storeTransactionId).maybeSingle();
    if (exErr) throw new StoreError('wallet_topups: ' + exErr.message);
    if (existing && existing.status === 'rejected') return json(invalid('rejected'));
    if (existing && String(existing.user_id).toLowerCase() !== owner) {
      // Claimed by another account first (no account id on the purchase).
      const granted = existing.status === 'credited';
      if (granted && platform === 'android') await googleConsume(p);
      return json({ status: 'ownership_conflict', alreadyGranted: granted });
    }

    const meta = {
      product_id: p.productId,
      store_order_id: p.orderId,
      environment: p.environment,
      verified_at: new Date().toISOString(),
    };

    // ---- still being paid (Google pending) ----
    if (p.state === 'pending') {
      if (!existing) {
        const { error } = await db.from('wallet_topups').upsert({
          user_id: owner,
          package_id: pkg.id,
          platform: p.platform,
          store_transaction_id: p.storeTransactionId,
          status: 'pending',
          coins: pkg.coins + pkg.bonus_coins,
          ...meta,
        }, { onConflict: 'store_transaction_id', ignoreDuplicates: true });
        if (error) console.warn('pending topup', error.message);
      }
      return json({ status: 'store_pending' });
    }

    // ---- credit (idempotent) ----
    const { data: credit, error: creditErr } = await db.rpc('credit_wallet_topup', {
      p_user: owner,
      p_product_id: p.productId,
      p_platform: p.platform,
      p_store_transaction_id: p.storeTransactionId,
    });
    if (creditErr) {
      if (/belongs to another account/.test(creditErr.message)) {
        return json({ status: 'ownership_conflict', alreadyGranted: true });
      }
      if (/was rejected/.test(creditErr.message)) return json(invalid('rejected'));
      throw new StoreError('credit_wallet_topup: ' + creditErr.message);
    }
    const c = credit as { topup_id: string; credited: boolean; coins: number; balance: number };

    // Details for support / payouts (0111). Not part of the money path.
    const { error: metaErr } = await db.from('wallet_topups').update(meta).eq('id', c.topup_id);
    if (metaErr) console.warn('topup meta', metaErr.message);

    if (platform === 'android') await googleConsume(p);

    if (owner !== me) return json({ status: 'ownership_conflict', alreadyGranted: true });
    return json({
      status: 'entitled',
      alreadyGranted: !c.credited,
      coins: c.coins,
      balance: c.balance,
      topup_id: c.topup_id,
    } satisfies Verdict);
  } catch (e) {
    console.error('verify-purchase', (e as Error).message);
    return json({ error: 'verification unavailable, try again later' }, 503);
  }
});
