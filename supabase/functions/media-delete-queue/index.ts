// =============================================================
// media-delete-queue
//
// Empties public.media_delete_queue: removes from R2 the bytes of media whose
// row has gone (today: deleted and purged stories, 0102), and only those.
//
// ── Why this exists ──
// A story's file is 'stored' in the ledger, so media-reconcile never touches
// it (it deletes only unconfirmed uploads and unledgered objects). 0102 made
// every story delete queue the story's media_url and poster_url instead, and
// until now nothing read the queue: expired stories stayed in the bucket,
// billed and still world-readable at their URLs.
//
// ── What it will and will not delete ──
// It works ONLY from the queue. It never lists the bucket and never derives a
// key from anywhere else, so the worst a bug here can do is mishandle a URL
// that was already handed over for deletion. For each queued URL, doubt
// always resolves to "leave it alone":
//
//   * not served from our R2 public base (or an alias) → 'skipped'
//   * a key that is not a plain object key             → 'skipped'
//   * ledger row 'deleted' / 'rejected'                → 'done', no call
//   * ledger row 'pending' and younger than GRACE_MS   → retried later
//   * ANY column in REFERENCED_BY still holds the key  → 'kept'
//   * a reference check that ERRORED                   → retried, not deleted
//   * R2 DELETE failed                                 → retried with backoff
//
// A queued key with no ledger row at all is still deleted once nothing
// references it. Unlike media-upload's delete action there is no caller whose
// ownership needs checking (the queue is written only by a database trigger),
// and an account deletion cascades media_objects away, so "no ledger row" is
// the normal state for the stories of a deleted account.
//
// REFERENCED_BY is a copy of media-upload's list and MUST be kept in step with
// it: a column missing from either list is a way to delete a file something is
// still serving.
//
// ── Independent of media-reconcile ──
// It shares the secret and the R2 credentials, nothing else. Pausing or
// resuming the reconcile sweep does not affect this job, and this job never
// touches an object that is not in the queue.
//
// ── Secrets ──
// R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
// R2_PUBLIC_BASE (as media-upload), RECONCILE_SECRET (as media-reconcile), and
// optionally:
//
//   R2_PUBLIC_BASE_ALIASES   comma-separated earlier public bases (e.g. the
//                            r2.dev URL used before cdn.flyp-sa.com), so a
//                            story stored under an old base still resolves to
//                            its key. Without it such URLs are 'skipped'.
//
// DEPLOY WITH --no-verify-jwt (the caller is pg_cron, with no user token):
//
//   npx supabase functions deploy media-delete-queue --no-verify-jwt
//
// ── Calling it ──
//   POST/GET  ...?dry=1     report what WOULD be deleted; claims nothing,
//                           changes nothing in R2 or the database.
//   POST/GET  ...?limit=N   batch size, default 100, at most 500.
// Header x-reconcile-secret is required either way. Scheduled every 30
// minutes by migration 0110.
// =============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { AwsClient } from 'npm:aws4fetch@1.0.20';

// Trimmed for the same reason as media-upload: these are pasted into a web
// form by hand, and a leading space breaks every signature or URL silently.
const env = (k: string) => (Deno.env.get(k) ?? '').trim();

const R2_ACCOUNT_ID = env('R2_ACCOUNT_ID');
const R2_BUCKET = env('R2_BUCKET');
const R2_PUBLIC_BASE = env('R2_PUBLIC_BASE').replace(/\/+$/, '');
const R2_PUBLIC_BASE_ALIASES = env('R2_PUBLIC_BASE_ALIASES')
  .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
const RECONCILE_SECRET = env('RECONCILE_SECRET');
const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');

const DEFAULT_BATCH = 100;
const MAX_BATCH = 500;

// After this many failed tries a row is marked 'failed' and left for a human.
// With the backoff in settle_media_delete (30 min doubling, capped at 24 h)
// eight tries span roughly three days.
const MAX_ATTEMPTS = 8;

// A 'pending' ledger row younger than this may be an upload still in flight.
// Same grace media-reconcile gives unledgered objects.
const GRACE_MS = 2 * 60 * 60 * 1000;   // 2 hours

// Edge Functions are stopped after a wall-clock limit. Stop taking new rows
// well before it and hand the rest back unclaimed, so a slow run never leaves
// rows stuck in 'processing' (the claim RPC also recovers those after 15 min).
const TIME_BUDGET_MS = 100 * 1000;

// Every column that can hold an R2 media URL. COPY of media-upload's list;
// keep the two identical.
const REFERENCED_BY: { table: string; column: string }[] = [
  { table: 'videos',       column: 'video_url' },
  { table: 'videos',       column: 'thumbnail' },
  { table: 'sounds',       column: 'audio_url' },
  { table: 'sounds',       column: 'cover_url' },
  { table: 'live_streams', column: 'thumbnail' },
  { table: 'stories',      column: 'media_url' },
  { table: 'stories',      column: 'poster_url' },
];

const r2 = new AwsClient({
  accessKeyId: env('R2_ACCESS_KEY_ID'),
  secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
  service: 's3',
  region: 'auto',
});

const objectUrl = (key: string) =>
  `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${key}`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

// Constant-time secret comparison (F19). Both sides are hashed first so the
// comparison always walks 32 bytes, whatever the lengths, and a plain `===`
// cannot leak how many leading characters matched through its timing.
async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
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

// Same check as media-reconcile. The job_endpoints row for this job is copied
// from send-push's, which carries media-reconcile's secret, so the env value
// and both rows are accepted.
async function callerAllowed(req: Request, db: ReturnType<typeof createClient>): Promise<boolean> {
  const given = req.headers.get('x-reconcile-secret') ?? '';
  if (!given) return false;
  if (RECONCILE_SECRET && (await safeEqual(given, RECONCILE_SECRET))) return true;
  const { data } = await db.from('job_endpoints').select('name, headers')
    .in('name', ['media-delete-queue', 'media-reconcile']);
  for (const row of (data ?? []) as { headers: Record<string, unknown> | null }[]) {
    const want = row.headers && (row.headers['x-reconcile-secret'] || row.headers['X-Reconcile-Secret']);
    if (want && (await safeEqual(given, String(want)))) return true;
  }
  return false;
}

// URL -> key, or null when it is not ours. Sliced, not decoded: the public URL
// is built by plain concatenation in media-upload's sign step, so the tail IS
// the key byte for byte (see media-upload's delete action).
function keyFrom(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  let key: string | null = null;
  if (/^https?:\/\//i.test(v)) {
    for (const base of [R2_PUBLIC_BASE, ...R2_PUBLIC_BASE_ALIASES]) {
      if (base && v.startsWith(`${base}/`)) { key = v.slice(base.length + 1); break; }
    }
  } else {
    key = v;   // a bare key, as an operator might queue one
  }
  if (!key) return null;
  // Only a plain object key. Anything that could address something other than
  // one object in our bucket (a query, a fragment, a path climb, an absolute
  // path, whitespace) is refused rather than interpreted.
  if (key.startsWith('/') || key.includes('..') || /[?#\s\\]/.test(key)) return null;
  if (key.length > 1024) return null;
  return key;
}

type QueueRow = { id: number; url: string; source: string; attempts: number };
type Outcome = 'done' | 'kept' | 'skipped' | 'retry' | 'release';

Deno.serve(async (req) => {
  if (!R2_ACCOUNT_ID || !R2_BUCKET || !R2_PUBLIC_BASE || !SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  if (!(await callerAllowed(req, db))) return json({ error: 'unauthorized' }, 401);

  const params = new URL(req.url).searchParams;
  // ── Report-only ──
  // ?dry=1 reads the same due rows WITHOUT claiming them and runs every check,
  // but issues no R2 call and writes nothing.
  const DRY = params.get('dry') === '1';
  const limit = Math.min(MAX_BATCH, Math.max(1, Number(params.get('limit')) || DEFAULT_BATCH));
  const started = Date.now();

  const { data: claimed, error: claimErr } = await db.rpc('claim_media_delete_batch', {
    p_limit: limit, p_dry: DRY,
  });
  if (claimErr) return json({ error: 'claim_failed', detail: claimErr.message }, 500);
  const rows = (claimed ?? []) as QueueRow[];

  const counts = { deleted: 0, already_gone: 0, kept: 0, skipped: 0, retry: 0, failed: 0, released: 0 };
  const wouldDelete: { url: string; key: string; ledgered: boolean }[] = [];
  const kept: { url: string; by: string[] }[] = [];
  const errors: string[] = [];

  const settle = async (row: QueueRow, outcome: Outcome, result: string | null, err: string | null = null) => {
    if (DRY) {
      // Nothing is written; still say why a row would not be deleted.
      if (outcome === 'retry') counts.retry++;
      if (err) errors.push(`${row.id}:${err}`);
      return;
    }
    const { data, error } = await db.rpc('settle_media_delete', {
      p_id: row.id, p_outcome: outcome, p_result: result, p_error: err, p_max_attempts: MAX_ATTEMPTS,
    });
    if (error) { errors.push(`${row.id}:settle:${error.message}`); return; }
    if (outcome === 'retry') {
      if (data === 'failed') counts.failed++; else counts.retry++;
    }
    if (err) errors.push(`${row.id}:${err}`);
  };

  for (const row of rows) {
    if (!DRY && Date.now() - started > TIME_BUDGET_MS) {
      await settle(row, 'release', null);
      counts.released++;
      continue;
    }

    // ── 1. Is it ours at all ──
    const key = keyFrom(row.url);
    if (!key) {
      counts.skipped++;
      await settle(row, 'skipped', 'not_r2_media');
      continue;
    }

    // ── 2. What the ledger says ──
    const { data: ledger, error: ledgerErr } = await db
      .from('media_objects')
      .select('id, status, created_at')
      .eq('key', key);
    if (ledgerErr) { await settle(row, 'retry', null, `ledger_read_failed: ${ledgerErr.message}`); continue; }
    const ledgerRows = (ledger ?? []) as { id: string; status: string; created_at: string }[];

    const live = ledgerRows.filter((l) => l.status === 'stored' || l.status === 'pending');
    if (ledgerRows.length && !live.length) {
      // Every row says the bytes are already gone ('deleted' or 'rejected').
      counts.already_gone++;
      await settle(row, 'done', 'already_deleted');
      continue;
    }
    const fresh = live.find((l) => l.status === 'pending' && Date.now() - Date.parse(l.created_at) < GRACE_MS);
    if (fresh) {
      await settle(row, 'retry', null, 'ledger_pending_in_grace');
      continue;
    }

    // ── 3. Nothing may still point at it ──
    // Service-role client on purpose: a check that cannot SEE a reference
    // reports "unreferenced". Suffix match on the key, as media-upload does,
    // so a URL stored under an older public base still counts. LIKE wildcards
    // in a key can only match MORE rows, which refuses a delete, never allows.
    const checks = await Promise.all(REFERENCED_BY.map(async (ref) => {
      const { count, error } = await db
        .from(ref.table)
        .select('id', { count: 'exact', head: true })
        .like(ref.column, `%${key}`);
      return { ref, count: count ?? 0, error };
    }));

    const unchecked = checks.filter((c) => c.error);
    if (unchecked.length) {
      // An unanswered question is not a "no".
      await settle(row, 'retry', null, 'reference_check_failed: ' + unchecked
        .map((c) => `${c.ref.table}.${c.ref.column}: ${c.error!.message}`).join('; '));
      continue;
    }

    const held = checks.filter((c) => c.count > 0).map((c) => `${c.ref.table}.${c.ref.column}`);
    if (held.length) {
      counts.kept++;
      kept.push({ url: row.url, by: held });
      await settle(row, 'kept', `referenced_by:${held.join(',')}`);
      continue;
    }

    if (DRY) {
      wouldDelete.push({ url: row.url, key, ledgered: live.length > 0 });
      continue;
    }

    // ── 4. The bytes ──
    let res: Response;
    try {
      res = await r2.fetch(objectUrl(key), { method: 'DELETE' });
    } catch (e) {
      await settle(row, 'retry', null, `r2_delete_error: ${(e as Error).message}`);
      continue;
    }
    // S3 DELETE is idempotent; 404 means something got there first. Both are
    // "gone". Any other failure leaves the ledger alone, so the bytes stay
    // counted against the ceiling while they still exist.
    if (!res.ok && res.status !== 404) {
      await settle(row, 'retry', null, `r2_delete_failed: ${res.status}`);
      continue;
    }

    // ── 5. The ledger ──
    // Marked 'deleted' as media-upload's delete action does (0081), so the
    // bytes stop counting. Only rows still claiming the bytes are touched. A
    // failure here is reported, not retried: the bytes are gone, and a stale
    // 'stored' row over-counts storage, never under-counts.
    let warning: string | null = null;
    if (live.length) {
      const { error: updErr } = await db
        .from('media_objects')
        .update({ status: 'deleted', deleted_at: new Date().toISOString() })
        .in('id', live.map((l) => l.id))
        .in('status', ['stored', 'pending']);
      if (updErr) warning = `ledger_update_failed: ${updErr.message}`;
    }

    counts.deleted++;
    await settle(row, 'done', live.length ? 'deleted' : 'deleted_unledgered', warning);
  }

  return json({
    ok: true,
    dry_run: DRY,
    batch: rows.length,
    // Only in a dry run: what a real run WOULD remove, so a person can read
    // the keys before trusting it.
    would_delete_count: DRY ? wouldDelete.length : undefined,
    would_delete_sample: DRY ? wouldDelete.slice(0, 25) : undefined,
    ...counts,
    kept_sample: kept.slice(0, 15),
    errors,
  });
});
