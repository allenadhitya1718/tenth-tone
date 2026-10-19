// =============================================================
// play-voided-purchases
//
// Takes back the coins of Google Play coin purchases that were refunded,
// cancelled or charged back AFTER verify-purchase credited them (0127).
//
// ── How ──
// Google Play Developer API purchases.voidedpurchases.list returns every
// one-time purchase of this app voided in a time window (at most the last
// 30 days). Each run:
//   1. takes a 10-minute lease on iap_poll_state 'google_voided', so a manual
//      call and the cron call never page at the same time;
//   2. resumes the window + page token an earlier run stopped at, or opens a
//      new window [cursor_at - 3 days, now] (clamped to the 30 days Google
//      keeps). The 3-day overlap catches voids Google lists late; reversing
//      is idempotent, so seeing one twice changes nothing;
//   3. for every voided purchase calls reverse_wallet_topup with
//        'gp:' + sha256(purchaseToken)   (wallet_topups.store_transaction_id,
//                                         exactly as verify-purchase stores it)
//        orderId                         (fallback match on store_order_id)
//      Unmatched voids leave a tombstone so the purchase can never be
//      credited later (0127 section 7);
//   4. saves the next page token after every fully processed page, and when
//      the window is done moves cursor_at to the window's end.
// A database error stops the run on that page; the next run repeats it.
//
// ── Secrets ──
//   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON  the SAME service account as
//                                     verify-purchase. It needs "View
//                                     financial data, orders, and cancellation
//                                     survey responses" in Play Console ->
//                                     Users and permissions (the voided
//                                     purchases API refuses without it).
//   GOOGLE_PLAY_PACKAGE_NAME          optional, default com.flyp.app
//   RECONCILE_SECRET                  optional: the x-reconcile-secret value.
//                                     The job_endpoints rows 'play-voided-
//                                     purchases' and 'media-reconcile' are
//                                     accepted too (0127 copies send-push's
//                                     row, which carries the same secret).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected.
//
// DEPLOY WITH --no-verify-jwt (the caller is pg_cron, with no user token):
//   npx supabase functions deploy play-voided-purchases --no-verify-jwt
// The x-reconcile-secret header is what protects it.
//
// ── Calling it ──
//   POST/GET  ...           scheduled every 6 hours by migration 0127
//   POST/GET  ...?dry=1     list and match only: reverses nothing, moves no
//                           cursor (and takes no lease)
//   POST/GET  ...?full=1    ignore the cursor: rescan the whole 30 days
// Header x-reconcile-secret is required either way.
//
// ── Later: Real-Time Developer Notifications ──
// RTDN (Pub/Sub) sends a voidedPurchaseNotification { purchaseToken,
// orderId, productType, refundType } within seconds instead of up to 6 hours.
// It can call reverse_wallet_topup exactly as handleVoided() does below; the
// Pub/Sub push endpoint must then verify Google's OIDC token (audience +
// service account email) since it would be another public endpoint. Keep
// this poller anyway: Pub/Sub delivery is not guaranteed.
// =============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const env = (k: string) => (Deno.env.get(k) ?? '').trim();

const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const RECONCILE_SECRET = env('RECONCILE_SECRET');
// Not trimmed by env(): JSON with newlines in the key is fine either way.
const GOOGLE_SA_JSON = Deno.env.get('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON') ?? '';
const GOOGLE_PACKAGE = env('GOOGLE_PLAY_PACKAGE_NAME') || 'com.flyp.app';

const SOURCE = 'google_voided';
const DAY_MS = 24 * 60 * 60 * 1000;
// Google: startTime may be at most 30 days back. Keep a margin so a window
// opened now is still valid when a later run resumes its page token.
const MAX_LOOKBACK_MS = 29 * DAY_MS;
const OVERLAP_MS = 3 * DAY_MS;
const LEASE_MS = 10 * 60 * 1000;
// Stop taking new pages well before the Edge Function wall-clock limit.
const TIME_BUDGET_MS = 100 * 1000;
const MAX_PAGES_PER_RUN = 50;

class StoreError extends Error {}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

// ---------- constant-time secret compare (same as media-delete-queue, F19) ----------
const enc = new TextEncoder();
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function callerAllowed(req: Request, db: ReturnType<typeof createClient>): Promise<boolean> {
  const given = req.headers.get('x-reconcile-secret') ?? '';
  if (!given) return false;
  if (RECONCILE_SECRET && (await safeEqual(given, RECONCILE_SECRET))) return true;
  const { data } = await db.from('job_endpoints').select('name, headers')
    .in('name', ['play-voided-purchases', 'media-reconcile']);
  for (const row of (data ?? []) as { headers: Record<string, unknown> | null }[]) {
    const want = row.headers && (row.headers['x-reconcile-secret'] || row.headers['X-Reconcile-Secret']);
    if (want && (await safeEqual(given, String(want)))) return true;
  }
  return false;
}

// ---------- small crypto helpers (same as verify-purchase) ----------
function b64url(data: ArrayBuffer | Uint8Array | string) {
  const bytes = typeof data === 'string' ? enc.encode(data) : new Uint8Array(data);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function pemToDer(pem: string) {
  const b64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
async function signJwtRS256(header: object, claims: object, key: CryptoKey) {
  const input = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, enc.encode(input));
  return input + '.' + b64url(sig);
}
async function sha256Hex(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Google OAuth (same as verify-purchase) ----------
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
  const jwt = await signJwtRS256({ alg: 'RS256', typ: 'JWT' }, {
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: tokenUri, iat: now, exp: now + 3600,
  }, key);
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

// ---------- purchases.voidedpurchases.list ----------
type VoidedPurchase = {
  purchaseToken?: string;
  orderId?: string;
  purchaseTimeMillis?: string;
  voidedTimeMillis?: string;
  voidedSource?: number;     // 0 user, 1 developer, 2 Google
  voidedReason?: number;     // see REASONS
  voidedQuantity?: number;
};
type VoidedPage = {
  voidedPurchases?: VoidedPurchase[];
  tokenPagination?: { nextPageToken?: string };
};

const SOURCES = ['user', 'developer', 'google'];
const REASONS = [
  'other', 'remorse', 'not_received', 'defective', 'accidental_purchase',
  'fraud', 'friendly_fraud', 'chargeback', 'unacknowledged_purchase',
];

async function listVoided(startMs: number, endMs: number, pageToken: string | null): Promise<VoidedPage> {
  const q = new URLSearchParams({
    startTime: String(startMs),
    endTime: String(endMs),
    type: '0',               // one-time products only (coins); no subscriptions
  });
  if (pageToken) q.set('token', pageToken);
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(GOOGLE_PACKAGE)}/purchases/voidedpurchases?${q}`;
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + (await googleAccessToken()) } });
  const body = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) {
    googleToken = null;
    throw new StoreError(`Google Play ${r.status}: the service account needs "View financial data" on ${GOOGLE_PACKAGE}`);
  }
  if (!r.ok) throw new StoreError(`Google Play voidedpurchases ${r.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body as VoidedPage;
}

type State = {
  source: string;
  cursor_at: string | null;
  window_start: string | null;
  window_end: string | null;
  page_token: string | null;
  lease_until: string | null;
};

const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
const iso = (t: number) => new Date(t).toISOString();

Deno.serve(async (req) => {
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'not_configured' }, 500);
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  if (!(await callerAllowed(req, db))) return json({ error: 'unauthorized' }, 401);

  const params = new URL(req.url).searchParams;
  const DRY = params.get('dry') === '1';
  const FULL = params.get('full') === '1';
  const started = Date.now();

  // ---- state + lease ----
  const { data: st, error: stErr } = await db.from('iap_poll_state')
    .select('source, cursor_at, window_start, window_end, page_token, lease_until')
    .eq('source', SOURCE).maybeSingle();
  if (stErr || !st) return json({ error: 'state_missing', detail: stErr?.message ?? 'apply 0127' }, 500);
  const state = st as State;

  if (!DRY) {
    const nowIso = iso(started);
    const { data: leased, error: leaseErr } = await db.from('iap_poll_state')
      .update({ lease_until: iso(started + LEASE_MS), last_run_at: nowIso, updated_at: nowIso })
      .eq('source', SOURCE)
      // Quoted: an ISO time holds ':' and '.', which or() would split on.
      .or(`lease_until.is.null,lease_until.lt."${nowIso}"`)
      .select('source');
    if (leaseErr) return json({ error: 'state_error', detail: leaseErr.message }, 500);
    if (!leased || leased.length === 0) return json({ skipped: 'another run holds the lease' });
  }

  // ---- the window ----
  const now = started;
  const oldestAllowed = now - MAX_LOOKBACK_MS;
  let windowStart: number;
  let windowEnd: number;
  let pageToken: string | null = null;
  const resumable = !FULL && state.page_token && ms(state.window_start) >= oldestAllowed &&
    ms(state.window_end) > ms(state.window_start);
  if (resumable) {
    windowStart = ms(state.window_start);
    windowEnd = ms(state.window_end);
    pageToken = state.page_token;
  } else {
    const cursor = FULL ? NaN : ms(state.cursor_at);
    windowStart = Number.isFinite(cursor) ? Math.max(oldestAllowed, cursor - OVERLAP_MS) : oldestAllowed;
    windowEnd = now;
  }

  const counts: Record<string, number> = { seen: 0, pages: 0 };
  const bump = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };
  const matches: unknown[] = [];
  let finished = false;
  let failure: string | null = null;

  const saveState = async (patch: Record<string, unknown>) => {
    if (DRY) return;
    const { error } = await db.from('iap_poll_state')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('source', SOURCE);
    if (error) throw new Error('iap_poll_state: ' + error.message);
  };

  try {
    // Record the window first so an interrupted run resumes the same one.
    await saveState({ window_start: iso(windowStart), window_end: iso(windowEnd), page_token: pageToken });

    while (true) {
      if (Date.now() - started > TIME_BUDGET_MS || counts.pages >= MAX_PAGES_PER_RUN) break;
      const page = await listVoided(windowStart, windowEnd, pageToken);
      counts.pages++;

      for (const v of page.voidedPurchases ?? []) {
        counts.seen++;
        if (!v.purchaseToken) { bump('no_token'); continue; }
        const txId = 'gp:' + (await sha256Hex(v.purchaseToken));
        const reason = [
          'google',
          SOURCES[v.voidedSource ?? -1] ?? `source_${v.voidedSource}`,
          REASONS[v.voidedReason ?? -1] ?? `reason_${v.voidedReason}`,
        ].join(':');
        const voidedAt = v.voidedTimeMillis ? iso(Number(v.voidedTimeMillis)) : null;

        if (DRY) {
          const { data: row } = await db.from('wallet_topups')
            .select('id, user_id, status, coins, refunded_at')
            .or(`store_transaction_id.eq."${txId}"` +
              (v.orderId && /^[A-Za-z0-9.\-]{1,100}$/.test(v.orderId) ? `,store_order_id.eq."${v.orderId}"` : ''))
            .limit(1).maybeSingle();
          bump(row ? (row.refunded_at ? 'would_skip_already_reversed' : `would_reverse_${row.status}`) : 'would_tombstone');
          if (matches.length < 50) matches.push({ orderId: v.orderId ?? null, voidedAt, reason, topup: row ?? null });
          continue;
        }

        const { data, error } = await db.rpc('reverse_wallet_topup', {
          p_store_transaction_id: txId,
          p_reason: reason,
          p_platform: 'android',
          p_store_order_id: v.orderId ?? null,
          p_refunded_at: voidedAt,
          p_detail: {
            source: 'play_voided_purchases',
            orderId: v.orderId ?? null,
            voidedSource: v.voidedSource ?? null,
            voidedReason: v.voidedReason ?? null,
            voidedQuantity: v.voidedQuantity ?? null,
            purchaseTimeMillis: v.purchaseTimeMillis ?? null,
            voidedTimeMillis: v.voidedTimeMillis ?? null,
          },
        });
        // Stop on the first failure; this page is repeated next run.
        if (error) throw new Error('reverse_wallet_topup: ' + error.message);
        const r = data as { outcome: string; user_id: string | null; coins_reversed: number; flagged: boolean };
        bump(r.outcome);
        if (r.flagged) bump('flagged');
        if (r.outcome === 'reversed') {
          console.log('refund reversed', JSON.stringify({ orderId: v.orderId, user: r.user_id, coins: r.coins_reversed, reason }));
        }
      }

      pageToken = page.tokenPagination?.nextPageToken || null;
      if (!pageToken) { finished = true; break; }
      await saveState({ page_token: pageToken });
    }

    if (finished) {
      await saveState({
        cursor_at: iso(windowEnd), window_start: null, window_end: null, page_token: null,
        last_success_at: new Date().toISOString(), last_error: null,
      });
    }
  } catch (e) {
    failure = (e as Error).message;
    console.error('play-voided-purchases', failure);
  }

  const result = {
    dry: DRY, finished, window: { start: iso(windowStart), end: iso(windowEnd) }, counts,
    ...(failure ? { error: failure } : {}),
    ...(DRY ? { matches } : {}),
  };
  if (!DRY) {
    try {
      await saveState({ lease_until: null, last_result: result, ...(failure ? { last_error: failure.slice(0, 500) } : {}) });
    } catch (e) {
      console.error('play-voided-purchases state', (e as Error).message);
    }
  }
  return json(result, failure ? 502 : 200);
});
