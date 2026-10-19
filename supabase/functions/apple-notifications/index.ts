// =============================================================
// apple-notifications
//
// App Store Server Notifications V2 endpoint. Takes back the coins of an App
// Store coin purchase that Apple refunded AFTER verify-purchase credited it
// (migration 0127, reverse_wallet_topup).
//
// Apple POSTs { "signedPayload": "<JWS>" }. This endpoint is PUBLIC and
// unauthenticated (Apple sends no Supabase JWT and no shared secret), so the
// ONLY thing that makes a request trustworthy is the JWS: jws.ts verifies its
// x5c chain up to the pinned Apple Root CA - G3 and its ES256 signature, and
// the transaction inside (data.signedTransactionInfo) is verified the same
// way. Nothing in an unverified request is ever acted on.
//
// Handled notificationType:
//   REFUND               Apple refunded a purchase -> reverse it.
//   REVOKE               Family Sharing revoked an entitlement -> reverse it
//                        (does not happen for consumables; handled anyway).
//   CONSUMPTION_REQUEST  a customer asked for a refund of a consumable and
//                        Apple asks whether it was consumed. Answered 200;
//                        nothing is sent back (see "Later" below).
//   REFUND_DECLINED, REFUND_REVERSED, TEST, anything else: logged, 200.
//     REFUND_REVERSED (Apple took a refund back) does NOT re-credit coins
//     automatically; it is logged so an admin can re-credit by hand.
// Answers: 200 handled or ignored; 400 malformed; 401 signature / chain not
// valid (only a forgery fails this); 500 database error (Apple retries:
// after 1, 12, 24, 48 and 72 hours). Reversal is idempotent, so retries and
// duplicate deliveries are safe.
//
// Matching: data.signedTransactionInfo.transactionId ==
// wallet_topups.store_transaction_id (verify-purchase stores the App Store
// transactionId). A refund for a transaction never credited leaves a
// tombstone, so it cannot be credited later.
//
// ── Secrets ──
//   APPLE_BUNDLE_ID   com.flyp.social (same as verify-purchase). Notifications
//                     for another bundle are ignored.
//   APPLE_APP_ID      optional: the numeric Apple ID of the app (App Store
//                     Connect -> App Information). When set, production
//                     notifications must carry it (sandbox ones have none).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected.
//
// ── DEPLOY WITHOUT JWT VERIFICATION ──
//   npx supabase functions deploy apple-notifications --no-verify-jwt
// Apple cannot send a Supabase JWT; with JWT verification on, the gateway
// would answer 401 to every notification. The JWS check below replaces it.
//
// ── App Store Connect ──
// App Store Connect -> the app -> App Information -> App Store Server
// Notifications: set BOTH
//   Production Server URL  https://<project-ref>.supabase.co/functions/v1/apple-notifications
//   Sandbox Server URL     (the same URL)
// and choose Version 2. Test it with the App Store Server API
// "Request a Test Notification" (POST /inApps/v1/notifications/test): a TEST
// notification is logged here.
//
// ── Later ──
// CONSUMPTION_REQUEST can be answered with the App Store Server API
// "Send Consumption Information" (PUT /inApps/v1/transactions/consumption/
// {transactionId}) within 12 hours, e.g. consumptionStatus = fully consumed
// when the coins were gifted. Apple uses it to decide the refund. Needs the
// APPLE_IAP_* key from verify-purchase and the user's consent per Apple's
// rules; not done here.
// =============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { JwsError, verifyAppleJws } from './jws.ts';

const env = (k: string) => (Deno.env.get(k) ?? '').trim();

const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const APPLE_BUNDLE_ID = env('APPLE_BUNDLE_ID') || 'com.flyp.social';
const APPLE_APP_ID = env('APPLE_APP_ID');

const MAX_BODY = 64 * 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

// https://developer.apple.com/documentation/appstoreservernotifications/responsebodyv2decodedpayload
type NotificationPayload = {
  notificationType?: string;
  subtype?: string;
  notificationUUID?: string;
  version?: string;
  signedDate?: number;
  data?: {
    appAppleId?: number;
    bundleId?: string;
    bundleVersion?: string;
    environment?: string;               // 'Production' | 'Sandbox'
    signedTransactionInfo?: string;
    consumptionRequestReason?: string;
  };
};

// https://developer.apple.com/documentation/appstoreservernotifications/jwstransactiondecodedpayload
type TransactionPayload = {
  transactionId?: string;
  originalTransactionId?: string;
  bundleId?: string;
  productId?: string;
  type?: string;                        // 'Consumable'
  environment?: string;
  revocationDate?: number;
  revocationReason?: number;            // 0 other, 1 app issue
  appAccountToken?: string;
};

const REVERSING = new Set(['REFUND', 'REVOKE']);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'not_configured' }, 500);

  // ---- read a bounded body ----
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY) return json({ error: 'too large' }, 413);
  let raw: string;
  try {
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length > MAX_BODY) return json({ error: 'too large' }, 413);
    raw = new TextDecoder().decode(bytes);
  } catch {
    return json({ error: 'bad body' }, 400);
  }
  let signedPayload: unknown;
  try {
    signedPayload = (JSON.parse(raw) as { signedPayload?: unknown })?.signedPayload;
  } catch {
    return json({ error: 'bad body' }, 400);
  }
  if (typeof signedPayload !== 'string' || !signedPayload) return json({ error: 'signedPayload required' }, 400);

  // ---- verify: nothing below runs for an unverified request ----
  let n: NotificationPayload;
  try {
    n = await verifyAppleJws<NotificationPayload>(signedPayload);
  } catch (e) {
    if (e instanceof JwsError) {
      console.warn('apple-notifications: rejected signedPayload:', e.message);
      return json({ error: 'invalid signature' }, 401);
    }
    console.error('apple-notifications: verify', (e as Error).message);
    return json({ error: 'verification failed' }, 500);
  }

  const type = String(n.notificationType ?? '');
  const subtype = n.subtype ? String(n.subtype) : '';
  const environment = n.data?.environment === 'Production' ? 'production'
    : n.data?.environment === 'Sandbox' ? 'sandbox' : null;
  const tag = { type, subtype: subtype || undefined, uuid: n.notificationUUID, env: n.data?.environment };

  // TEST notifications have data with bundleId too; anything for another app
  // is not ours to act on.
  if (n.data?.bundleId !== APPLE_BUNDLE_ID) {
    console.warn('apple-notifications: other bundle', JSON.stringify({ ...tag, bundle: n.data?.bundleId }));
    return json({ ok: true, ignored: 'bundle' });
  }
  if (APPLE_APP_ID && environment === 'production' && n.data?.appAppleId != null &&
      String(n.data.appAppleId) !== APPLE_APP_ID) {
    console.warn('apple-notifications: other app id', JSON.stringify({ ...tag, app: n.data.appAppleId }));
    return json({ ok: true, ignored: 'app' });
  }

  if (!REVERSING.has(type)) {
    // CONSUMPTION_REQUEST, REFUND_DECLINED, REFUND_REVERSED, TEST, ...
    const level = type === 'REFUND_REVERSED' ? 'warn' : 'log';
    let txId: string | undefined;
    if (n.data?.signedTransactionInfo) {
      try {
        txId = (await verifyAppleJws<TransactionPayload>(n.data.signedTransactionInfo)).transactionId;
      } catch { /* informational only */ }
    }
    console[level]('apple-notifications:', JSON.stringify({
      ...tag, transactionId: txId, consumptionRequestReason: n.data?.consumptionRequestReason,
      note: type === 'REFUND_REVERSED' ? 'refund reversed by Apple: coins NOT re-credited automatically' : undefined,
    }));
    return json({ ok: true });
  }

  // ---- REFUND / REVOKE ----
  if (!n.data?.signedTransactionInfo) return json({ error: 'no transaction' }, 400);
  let tx: TransactionPayload;
  try {
    tx = await verifyAppleJws<TransactionPayload>(n.data.signedTransactionInfo);
  } catch (e) {
    if (e instanceof JwsError) {
      console.warn('apple-notifications: rejected signedTransactionInfo:', e.message);
      return json({ error: 'invalid signature' }, 401);
    }
    return json({ error: 'verification failed' }, 500);
  }
  if (tx.bundleId !== APPLE_BUNDLE_ID) return json({ ok: true, ignored: 'bundle' });
  const txId = String(tx.transactionId ?? '');
  if (!/^\d{1,32}$/.test(txId)) return json({ error: 'bad transaction id' }, 400);
  if (tx.type && tx.type !== 'Consumable') {
    console.log('apple-notifications: not a consumable', JSON.stringify({ ...tag, txId, kind: tx.type }));
    return json({ ok: true, ignored: 'not consumable' });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // A sandbox refund must not touch a production top-up (and the reverse).
  // Rows from before 0111 have no environment; those are matched as they are.
  const { data: topup, error: topErr } = await db.from('wallet_topups')
    .select('id, platform, environment')
    .eq('store_transaction_id', txId).maybeSingle();
  if (topErr) {
    console.error('apple-notifications: wallet_topups', topErr.message);
    return json({ error: 'database' }, 500);
  }
  if (topup && (topup.platform !== 'ios' || (topup.environment && environment && topup.environment !== environment))) {
    console.warn('apple-notifications: environment / platform mismatch, ignored',
      JSON.stringify({ ...tag, txId, topupEnv: topup.environment, platform: topup.platform }));
    return json({ ok: true, ignored: 'environment' });
  }

  const reason = ['apple', type.toLowerCase(), subtype ? subtype.toLowerCase() : null,
    tx.revocationReason === 1 ? 'app_issue' : tx.revocationReason === 0 ? 'other' : null]
    .filter(Boolean).join(':');

  const { data, error } = await db.rpc('reverse_wallet_topup', {
    p_store_transaction_id: txId,
    p_reason: reason,
    p_platform: 'ios',
    p_store_order_id: null,
    p_refunded_at: tx.revocationDate ? new Date(tx.revocationDate).toISOString() : null,
    p_detail: {
      source: 'app_store_notification',
      notificationUUID: n.notificationUUID ?? null,
      notificationType: type,
      subtype: subtype || null,
      environment: n.data?.environment ?? null,
      productId: tx.productId ?? null,
      originalTransactionId: tx.originalTransactionId ?? null,
      revocationReason: tx.revocationReason ?? null,
    },
  });
  if (error) {
    console.error('apple-notifications: reverse_wallet_topup', error.message);
    return json({ error: 'database' }, 500);   // Apple retries
  }
  const r = data as { outcome: string; user_id: string | null; coins_reversed: number; flagged: boolean };
  console.log('apple-notifications: refund', JSON.stringify({ ...tag, txId, ...r }));
  return json({ ok: true, outcome: r.outcome });
});
