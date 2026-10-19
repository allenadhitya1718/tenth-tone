// =============================================================
// media-reconcile  (rewritten, F08)
//
// Deletes the bytes of uploads that were signed but never confirmed - and
// NOTHING else.
//
// ── The bucket is SHARED with the old project ──
// So this function NEVER lists the bucket and never deletes a key it did not
// read from THIS project's own ledger (public.media_objects). An object with
// no ledger row is not ours to judge and is left alone. (The previous version
// listed the bucket and deleted unledgered objects; that would have destroyed
// the other project's files, which is why it was never deployed.)
//
// A key is deleted only if ALL hold (enforced in SQL by migration 0138 and
// re-checked atomically when the row is claimed):
//   * the ledger row is status 'pending' and older than min_age_hours (>= 24)
//   * the key has exactly the shape media-upload generates
//     (<bucket>/<2 hex>/<32 hex>.<ext>) and its prefix matches the row's bucket
//   * no URL column anywhere points at it (videos incl. drafts, stories,
//     sounds, avatars, messages, chats, lives, ads, gifts, delete queue)
//
// ── Controls (table public.reconcile_config) ──
//   enabled=false  kill switch: the function does nothing
//   live=false     DEFAULT. Dry run: counts and a sample, nothing deleted.
//                  Deletion happens only when live=true AND ?dry=1 is absent.
//   batch_limit    at most this many objects per run (<= 500)
//   ?dry=1         forces a dry run even when live=true
//   env RECONCILE_KILL=1 also stops it.
//
// Every run (dry or live) writes one admin_logs row, action 'media_reconcile'.
//
// ── Secrets / deploy ──
// Same R2_* values as media-upload and RECONCILE_SECRET (the job_endpoints row
// secret is accepted as well). Deploy with --no-verify-jwt; the caller is
// pg_cron (public.run_media_reconcile(), daily 04:10 UTC).
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

// The hourly caller presents the secret stored on this job's own row in
// job_endpoints, which was regenerated at some point and has not matched the
// RECONCILE_SECRET env var since. Every run for months answered 401 and swept
// nothing - the same fault send-push had, fixed the same way: the row's own
// secret is accepted as well as the environment's.
async function callerAllowed(req: Request, db: ReturnType<typeof createClient>): Promise<boolean> {
  const given = req.headers.get('x-reconcile-secret') ?? '';
  if (!given) return false;
  if (RECONCILE_SECRET && (await safeEqual(given, RECONCILE_SECRET))) return true;
  const { data } = await db.from('job_endpoints').select('headers').eq('name', 'media-reconcile').maybeSingle();
  const want = data && data.headers && (data.headers['x-reconcile-secret'] || data.headers['X-Reconcile-Secret']);
  return !!want && (await safeEqual(given, String(want)));
}

Deno.serve(async (req) => {
  if (!R2_ACCOUNT_ID || !R2_BUCKET || !SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  if (!(await callerAllowed(req, db))) return json({ error: 'unauthorized' }, 401);

  if (env('RECONCILE_KILL') === '1') return json({ ok: true, disabled: true, by: 'env' });

  const { data: cfg, error: cfgErr } = await db.from('reconcile_config').select('*').eq('id', true).maybeSingle();
  if (cfgErr || !cfg) return json({ error: 'config_unavailable', detail: cfgErr?.message }, 500);
  if (!cfg.enabled) return json({ ok: true, disabled: true, by: 'reconcile_config.enabled' });

  const url = new URL(req.url);
  const forcedDry = url.searchParams.get('dry') === '1';
  const live = cfg.live === true && !forcedDry;
  const minAge = Math.max(Number(cfg.min_age_hours) || 24, 24);
  const reqLimit = Number(url.searchParams.get('limit')) || Infinity;
  const limit = Math.min(Math.max(Number(cfg.batch_limit) || 100, 1), 500, reqLimit);

  const { data: scan, error: scanErr } = await db.rpc('media_orphan_scan', {
    p_limit: limit, p_min_age_hours: minAge,
  });
  if (scanErr || !scan) return json({ error: 'scan_failed', detail: scanErr?.message }, 500);

  const cands = (scan.candidates ?? []) as { id: string; bucket: string; key: string; size_bytes: number }[];
  const deleted: string[] = [];
  const failures: string[] = [];
  let deletedBytes = 0;

  if (live && cands.length) {
    // Claim first (pending -> deleted, atomic, conditions re-checked in SQL),
    // then remove the bytes; hand the claim back for anything R2 refused.
    const { data: claimed, error: claimErr } = await db.rpc('media_orphan_claim', {
      p_ids: cands.map((c) => c.id), p_min_age_hours: minAge,
    });
    if (claimErr) return json({ error: 'claim_failed', detail: claimErr.message }, 500);
    const failedIds: string[] = [];
    for (const c of (claimed ?? []) as { out_id: string; out_bucket: string; out_key: string; out_size: number }[]) {
      // Last line of defence, independent of the SQL: only our own key shape.
      if (!/^(videos|chat-media|avatars|group-photos)\/[0-9a-f]{2}\/[0-9a-f]{32}\.[a-z0-9]{1,6}$/.test(c.out_key)
          || c.out_key.split('/')[0] !== c.out_bucket) {
        failedIds.push(c.out_id); failures.push(`${c.out_id}:bad_key`); continue;
      }
      try {
        const res = await r2.fetch(`${base()}/${c.out_key}`, { method: 'DELETE' });
        // S3 DELETE answers 204 whether or not the object existed.
        if (res.ok || res.status === 404) { deleted.push(c.out_key); deletedBytes += Number(c.out_size) || 0; }
        else { failedIds.push(c.out_id); failures.push(`${c.out_id}:${res.status}`); }
      } catch (e) {
        failedIds.push(c.out_id); failures.push(`${c.out_id}:${(e as Error).message}`);
      }
    }
    if (failedIds.length) await db.rpc('media_orphan_release', { p_ids: failedIds });
  }

  const summary = {
    dry_run: !live,
    live_flag: cfg.live === true,
    min_age_hours: minAge,
    batch_limit: limit,
    pending_total: scan.pending_total,
    pending_older_than_min_age: scan.pending_older_than_min_age,
    eligible_orphans: scan.eligible,
    eligible_bytes: scan.eligible_bytes,
    skipped_referenced: scan.skipped_referenced,
    skipped_unrecognised_key: scan.skipped_unrecognised_key,
    this_batch: cands.length,
    deleted: deleted.length,
    deleted_bytes: deletedBytes,
    failures: failures.length,
  };

  try {
    await db.from('admin_logs').insert({
      action: 'media_reconcile', target_type: 'system', payload: summary,
    });
  } catch (_e) { /* best effort */ }

  return json({
    ok: true, ...summary,
    // A dry run shows enough to recognise the keys, never more than 15.
    sample: !live ? cands.slice(0, 15).map((c) => c.key) : undefined,
    failure_detail: failures.slice(0, 10),
  });
});
