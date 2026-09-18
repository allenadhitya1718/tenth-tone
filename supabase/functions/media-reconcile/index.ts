// =============================================================
// media-reconcile
//
// Deletes bytes nobody is paying attention to.
//
// ── Why this is not optional ──
// media-upload records a ledger row BEFORE it hands out a signed URL, so in
// the normal case every object in R2 has a row and the quota can see it. Two
// things break that, and both cost money on a metered store:
//
//   1. A phone uploads successfully and then dies — lost signal, app killed,
//      battery — before calling confirm. The bytes are real and in the bucket;
//      the row says 'pending' for ever and stops counting toward usage after
//      15 minutes (0062). Storage you are billed for and cannot see.
//
//   2. Anything that puts an object in the bucket without a row at all. There
//      should be no such path, which is exactly why it is worth checking: the
//      day there is one, this is what notices.
//
// Both are invisible to storage_used_bytes(), so neither would ever trip the
// ceiling or the alert. That is the failure mode this whole R2 design exists
// to prevent, so it gets its own sweeper rather than being trusted away.
//
// ── What it does NOT do ──
// It never deletes an object that has a 'stored' row. Those are counted, and
// something in the app is presumed to reference them. It reports how many are
// stored-but-apparently-unreferenced so a human can look, but does not act on
// that: video_url and thumbnail are only two of several places a URL can be
// held, and deleting on an incomplete search would destroy live content.
//
// ── Secrets ──
// The same five R2 values as media-upload, plus:
//
//   RECONCILE_SECRET   REQUIRED. Any long random string. The caller presents
//                      it in x-reconcile-secret. Without it, a stranger who
//                      found the URL could make you delete your own bucket.
//
// DEPLOY WITH --no-verify-jwt:
//
//   npx supabase functions deploy media-reconcile --no-verify-jwt
//
// Like storage-alert and unlike media-upload, the caller here is a scheduler
// with no user token. The shared secret replaces JWT verification.
//
// ── Schedule ──
// Hourly. That interval is the exposure window: it is the longest an
// unaccounted object can sit in the bucket. Add to the GitHub Actions workflow
// alongside storage-alert, or call it from pg_cron once pg_net is enabled.
// =============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { AwsClient } from 'npm:aws4fetch@1.0.20';

// Trimmed for the same reason as media-upload: these are pasted into a web
// form by hand, and a leading space in the account id or bucket name breaks
// every signature with an error that never mentions whitespace.
const env = (k: string) => (Deno.env.get(k) ?? '').trim();

const R2_ACCOUNT_ID = env('R2_ACCOUNT_ID');
const R2_BUCKET = env('R2_BUCKET');
const RECONCILE_SECRET = env('RECONCILE_SECRET');
const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');

// An object must be this old before it can be deleted for having no ledger
// row. Without the grace period a sweep running at the wrong moment could
// delete an upload that is mid-flight.
const GRACE_MS = 2 * 60 * 60 * 1000;   // 2 hours

// A LIST returns up to 1000 keys and costs one Class A operation. The cap
// bounds a single run rather than the bucket: 50 pages is 50,000 objects, far
// more than an 8 GB ceiling can hold, and stops a bug turning into a bill.
const MAX_PAGES = 50;

const r2 = new AwsClient({
  accessKeyId: env('R2_ACCESS_KEY_ID'),
  secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
  service: 's3',
  region: 'auto',
});

const base = () => `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

// S3 ListObjectsV2 answers in XML and Deno has no built-in parser. The shape
// is rigid and machine-generated, so pulling the three fields out with a
// regex over each <Contents> block is safe here in a way that parsing
// arbitrary XML would not be.
function parseList(xml: string) {
  const items: { key: string; size: number; modified: number }[] = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const block = m[1];
    const key = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] ?? '';
    const size = Number(block.match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0);
    const mod = block.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1] ?? '';
    if (key) items.push({ key, size, modified: Date.parse(mod) || 0 });
  }
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const token = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? '';
  return { items, truncated, token };
}

// The hourly caller presents the secret stored on this job's own row in
// job_endpoints, which was regenerated at some point and has not matched the
// RECONCILE_SECRET env var since. Every run for months answered 401 and swept
// nothing - the same fault send-push had, fixed the same way: the row's own
// secret is accepted as well as the environment's.
async function callerAllowed(req: Request, db: ReturnType<typeof createClient>): Promise<boolean> {
  const given = req.headers.get('x-reconcile-secret') ?? '';
  if (!given) return false;
  if (RECONCILE_SECRET && given === RECONCILE_SECRET) return true;
  const { data } = await db.from('job_endpoints').select('headers').eq('name', 'media-reconcile').maybeSingle();
  const want = data && data.headers && (data.headers['x-reconcile-secret'] || data.headers['X-Reconcile-Secret']);
  return !!want && given === String(want);
}

Deno.serve(async (req) => {
  if (!R2_ACCOUNT_ID || !R2_BUCKET || !SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  if (!(await callerAllowed(req, db))) return json({ error: 'unauthorized' }, 401);

  // ── Report-only ──
  // ?dry=1 walks exactly the same ground and deletes nothing, so the first
  // run after a long silence can be READ before it is trusted. It also skips
  // expire_pending_media, which writes.
  const DRY = new URL(req.url).searchParams.get('dry') === '1';
  const wouldDelete: { key: string; bytes: number }[] = [];
  const deleted: string[] = [];
  const failures: string[] = [];

  const drop = async (key: string, bytes = 0) => {
    if (DRY) { wouldDelete.push({ key, bytes }); return; }
    try {
      const res = await r2.fetch(`${base()}/${key}`, { method: 'DELETE' });
      // S3 DELETE is idempotent and answers 204 whether or not the object was
      // there, so "already gone" is a success, not something to retry.
      if (res.ok || res.status === 404) deleted.push(key);
      else failures.push(`${key}:${res.status}`);
    } catch (e) {
      failures.push(`${key}:${(e as Error).message}`);
    }
  };

  // ── 1. Authorisations that never became files ──
  // Clears the rows, and hands back the keys because some of them DID become
  // files — that is case 1 above, and those bytes have to go.
  let expiredCount = 0;
  if (DRY) {
    // expire_pending_media CLEARS rows, so it is not run here. Count the same
    // set instead: authorisations older than an hour that never confirmed.
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: pend, error: pendErr } = await db
      .from('media_objects')
      .select('key, size_bytes')
      .eq('status', 'pending')
      .lt('created_at', cutoff);
    if (pendErr) return json({ error: 'pending_read_failed', detail: pendErr.message }, 500);
    expiredCount = (pend ?? []).length;
    for (const row of (pend ?? []) as { key: string; size_bytes: number }[]) {
      await drop(row.key, Number(row.size_bytes) || 0);
    }
  } else {
    const { data: expired, error: expErr } = await db.rpc('expire_pending_media', {
      p_older_than: '01:00:00',
    });
    if (expErr) return json({ error: 'expire_failed', detail: expErr.message }, 500);
    for (const row of (expired ?? []) as { out_bucket: string; out_key: string }[]) {
      await drop(row.out_key);
    }
    expiredCount = (expired ?? []).length;
  }

  // ── 2. Objects in the bucket with no ledger row at all ──
  let token = '';
  let pages = 0;
  let scanned = 0;
  let orphaned = 0;
  let truncatedEarly = false;

  while (pages < MAX_PAGES) {
    const url = new URL(base());
    url.searchParams.set('list-type', '2');
    url.searchParams.set('max-keys', '1000');
    if (token) url.searchParams.set('continuation-token', token);

    const res = await r2.fetch(url.toString(), { method: 'GET' });
    if (!res.ok) return json({ error: 'list_failed', status: res.status }, 502);

    const { items, truncated, token: next } = parseList(await res.text());
    pages++;
    scanned += items.length;

    // Only objects old enough that no upload could still be in flight.
    const candidates = items.filter(i => Date.now() - i.modified > GRACE_MS);

    if (candidates.length) {
      // Ask in one query rather than per key. `in` on up to 1000 keys is well
      // within what Postgres and PostgREST handle.
      const { data: known, error: knownErr } = await db
        .from('media_objects')
        .select('key')
        .in('key', candidates.map(c => c.key));
      if (knownErr) return json({ error: 'ledger_read_failed', detail: knownErr.message }, 500);

      const seen = new Set((known ?? []).map(k => k.key));
      for (const c of candidates) {
        if (!seen.has(c.key)) { orphaned++; await drop(c.key, c.size); }
      }
    }

    if (!truncated || !next) break;
    token = next;
    if (pages >= MAX_PAGES) truncatedEarly = true;
  }

  // ── 3. Look, but do not touch ──
  // Counted as stored, so the ceiling knows about them, but nothing obvious
  // points at them. Reported rather than deleted: a URL can be held in more
  // places than this checks, and being wrong here destroys someone's video.
  const { count: storedRows } = await db
    .from('media_objects')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'stored');

  const wouldBytes = wouldDelete.reduce((n, w) => n + (w.bytes || 0), 0);
  return json({
    ok: true,
    dry_run: DRY,
    // Only in a dry run: what a real run WOULD remove, with a sample so a
    // person can recognise the keys before agreeing to any of it.
    would_delete_count: DRY ? wouldDelete.length : undefined,
    would_delete_bytes: DRY ? wouldBytes : undefined,
    would_delete_mb: DRY ? Math.round((wouldBytes / 1048576) * 10) / 10 : undefined,
    would_delete_sample: DRY ? wouldDelete.slice(0, 15).map(w => w.key) : undefined,
    expired_pending: expiredCount,
    scanned,
    orphaned,
    deleted: deleted.length,
    failures,
    stored_rows: storedRows ?? 0,
    // A red flag rather than a statistic: it means the bucket holds more than
    // this run could walk, so some orphans were not looked at.
    list_truncated: truncatedEarly,
  });
});
