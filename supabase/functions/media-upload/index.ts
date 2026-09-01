// =============================================================
// media-upload
//
// The gate in front of Cloudflare R2.
//
// ── Why this exists ──
// Today an upload is protected by a Postgres storage policy: the browser talks
// to Supabase Storage, and the INSERT into storage.objects is refused by
// within_upload_quota() running inside the database. That is genuinely
// un-bypassable — someone hitting the storage API directly with the public key
// still gets refused, because the refusal happens in Postgres.
//
// R2 has none of that. No database, no policies, no auth.uid(). It is a plain
// object store: whoever holds the credentials can write whatever they like,
// for ever. So the gate has to be rebuilt somewhere R2-shaped, and this is it.
//
// The R2 credentials live ONLY here. They are never sent to the app, so the
// only way to put a byte in the bucket is to ask this function first, and this
// function runs the same within_upload_quota() check the storage policy used
// to run.
//
// ── The flow ──
//   1. sign     — app says "I want to upload N bytes". Quota is checked, a key
//                 is chosen BY THE SERVER, a ledger row is written, and a
//                 signed PUT valid for 2 minutes is handed back.
//   2. (app PUTs the bytes straight to R2 — they never pass through Supabase,
//      which is the whole point: no egress on either side.)
//   3. confirm  — this function asks R2 how big the object ACTUALLY is and
//                 writes that number to the ledger.
//
// Step 3 is what makes the accounting honest. The size that ends up in
// media_objects comes from R2, not from the app, so a client that lies about
// its file size cannot corrupt the quota. It can sneak exactly one oversized
// file in before being measured, refused and deleted.
//
// ── Secrets (Supabase -> Edge Functions -> Secrets) ──
//   R2_ACCOUNT_ID          Cloudflare account id
//   R2_ACCESS_KEY_ID       from R2 -> Manage API Tokens, Object Read & Write
//   R2_SECRET_ACCESS_KEY   shown once at creation
//   R2_BUCKET              e.g. flyp-media
//   R2_PUBLIC_BASE         where files are SERVED from, no trailing slash.
//                          e.g. https://cdn.flyp-sa.com  (or the r2.dev URL)
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
//
// ── Deploy WITH jwt verification (the default) ──
//
//   npx supabase functions deploy media-upload
//
// Deliberately unlike storage-alert, which is called by a scheduler and so
// uses --no-verify-jwt. This one is called by a signed-in person and must know
// WHO, because the quota is per-user. Never add --no-verify-jwt here.
//
// ── R2 bucket CORS ──
// The browser PUTs directly to R2, so the BUCKET needs CORS or every upload
// fails with an opaque network error that looks like a bug in this function.
// In Cloudflare: R2 -> your bucket -> Settings -> CORS policy:
//
//   [{ "AllowedOrigins": ["https://localhost", "capacitor://localhost",
//                         "flyp://localhost", "http://127.0.0.1:5599",
//                         "http://localhost:5599"],
//      "AllowedMethods": ["PUT"],
//      "AllowedHeaders": ["*"],
//      "MaxAgeSeconds": 3600 }]
//
// https://localhost is what Capacitor serves the Android app from
// (androidScheme: 'https' in capacitor.config). Without it the app uploads
// nothing while a desktop browser works fine, which is a miserable thing to
// debug.
// =============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { AwsClient } from 'npm:aws4fetch@1.0.20';

// Every one of these is .trim()ed. Secrets are pasted by hand into a web form,
// and a stray leading space survives that journey silently: the first live test
// returned " https://pub-....r2.dev/videos/..." with a space on the front,
// which would have been written into videos.video_url for every clip. Browsers
// mostly forgive it in a src attribute, so it would not have failed loudly —
// it would have sat in the database looking almost right.
//
// A space in the account id or the key would instead break every signature
// with an error that says nothing about whitespace.
const env = (k: string) => (Deno.env.get(k) ?? '').trim();

const R2_ACCOUNT_ID = env('R2_ACCOUNT_ID');
const R2_ACCESS_KEY_ID = env('R2_ACCESS_KEY_ID');
const R2_SECRET_ACCESS_KEY = env('R2_SECRET_ACCESS_KEY');
const R2_BUCKET = env('R2_BUCKET');
const R2_PUBLIC_BASE = env('R2_PUBLIC_BASE').replace(/\/+$/, '');

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Buckets this function is willing to write to. An allowlist rather than
// "whatever the client sent", so a caller cannot invent a bucket name and
// escape the per-bucket rules below.
const BUCKETS: Record<string, { exts: string[]; types: string[]; max: number }> = {
  videos: {
    exts: ['mp4', 'webm', 'mov', 'jpg', 'jpeg'],   // jpg: poster + live cover
    types: ['video/mp4', 'video/webm', 'video/quicktime', 'image/jpeg'],
    max: 62914560,                                  // 60 MB, matches app_limits
  },
};

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

const r2 = new AwsClient({
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  service: 's3',
  region: 'auto',
});

const objectUrl = (key: string) =>
  `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${key}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    return json({ error: 'r2_not_configured' }, 500);
  }
  if (!R2_PUBLIC_BASE) return json({ error: 'r2_public_base_not_set' }, 500);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'not_configured' }, 500);

  // ── Who is asking ──
  // The caller's own token, so auth.uid() inside the database is the person
  // uploading. Everything about the quota is per-person; an anonymous caller
  // has no quota to check and is refused outright.
  const authHeader = req.headers.get('Authorization') ?? '';
  const asUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await asUser.auth.getUser();
  const user = userData?.user;
  if (userErr || !user) return json({ error: 'unauthorized' }, 401);

  // Service role for the ledger. media_objects has no write policy at all, so
  // this is the only thing in the system that can record an upload.
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const action = String(body.action ?? '');

  // =========================================================
  // sign — authorise an upload
  // =========================================================
  if (action === 'sign') {
    const bucket = String(body.bucket ?? 'videos');
    const rules = BUCKETS[bucket];
    if (!rules) return json({ error: 'unknown_bucket' }, 400);

    const size = Number(body.size ?? 0);
    // A MIME type's PARAMETERS are not part of the type. MediaRecorder hands
    // back the codecs it actually chose, so a recorded clip arrives as
    //   video/mp4;codecs=avc1.42001f,mp4a.40.2
    // and an exact-match whitelist rejected it as bad_content_type - which
    // failed EVERY publish from the in-app camera. Compare on the base type and
    // store the base type; the codecs string is information for a player, not
    // something to authorise on.
    const rawContentType = String(body.contentType ?? '');
    const contentType = rawContentType.split(';')[0].trim().toLowerCase();
    const ext = String(body.ext ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

    if (!Number.isFinite(size) || size <= 0) return json({ error: 'bad_size' }, 400);
    if (!rules.exts.includes(ext)) return json({ error: 'bad_extension' }, 400);
    if (!rules.types.includes(contentType)) return json({ error: 'bad_content_type' }, 400);

    // ── The ceilings ──
    // upload_quota_status() runs as the caller and returns WHICH limit was hit,
    // so the app can show a real message instead of a generic refusal. It is
    // the same function the app already calls before an upload; calling it here
    // too is what makes the check authoritative rather than advisory, because
    // this is the only path to a signed URL.
    const { data: quota, error: quotaErr } = await asUser.rpc('upload_quota_status');
    if (quotaErr) return json({ error: 'quota_check_failed', detail: quotaErr.message }, 500);
    if (quota && quota.allowed === false) {
      return json({ error: 'quota_exceeded', reason: quota.reason, quota }, 403);
    }

    // Checked against BOTH the per-bucket ceiling and the configured one, so a
    // change to app_limits takes effect without redeploying this function.
    const maxBytes = Math.min(rules.max, Number(quota?.max_video_bytes ?? rules.max));
    if (size > maxBytes) {
      return json({ error: 'file_too_large', max_bytes: maxBytes }, 413);
    }

    // ── The key is chosen HERE, never by the client ──
    // A client-supplied key is an overwrite primitive: pass someone else's
    // path and you replace their video. The user id keeps the folder-per-owner
    // shape the Supabase policies used, and the random suffix makes the key
    // unguessable and impossible to collide with.
    const key = `${bucket}/${user.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

    // ── Cap how many uploads one person can have in flight ──
    // A pending row counts toward usage at its DECLARED size, so a caller who
    // declares 1 MB and then pushes 500 MB is invisible to the ceiling until
    // the confirm step measures it. This is the bound on that gap: at most a
    // handful of unmeasured objects per person at any moment, rather than
    // thousands. A real upload needs two (the clip and its poster).
    const { count: inflight, error: inflightErr } = await db
      .from('media_objects')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .gt('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString());

    // A failed count must not read as "nothing in flight". Destructuring only
    // `count` made this cap fail OPEN on any query error - and it is a
    // count:'exact' head scan, so it is the query most likely to time out under
    // exactly the load the cap exists for.
    if (inflightErr) return json({ error: 'inflight_check_failed', detail: inflightErr.message }, 500);
    if ((inflight ?? 0) >= 4) {
      return json({ error: 'too_many_pending' }, 429);
    }

    // Recorded BEFORE the URL is handed out. A pending row counts toward usage
    // (see 0062), which is what stops a thousand parallel sign requests from
    // each seeing an empty bucket and all being approved.
    const { data: row, error: insErr } = await db
      .from('media_objects')
      .insert({
        bucket, key, user_id: user.id,
        size_bytes: size, content_type: contentType, status: 'pending',
      })
      .select('id')
      .single();
    if (insErr) return json({ error: 'ledger_insert_failed', detail: insErr.message }, 500);

    // ── Sign it ──
    // Two minutes. Long enough for a phone on a poor connection to start the
    // upload, short enough that a leaked URL is worthless. aws4fetch reads the
    // lifetime from the X-Amz-Expires query parameter, not from a header.
    const signUrl = new URL(objectUrl(key));
    signUrl.searchParams.set('X-Amz-Expires', '120');

    // allHeaders puts content-length into the signature, so a client that asks
    // for 1 MB and then sends 500 MB should fail signature verification at R2.
    //
    // Treated as a bonus, NOT as the defence. Content-Length is a forbidden
    // header name in the Fetch spec, so whether it survives into the signed
    // request depends on the runtime, and a guard you cannot see failing is not
    // a guard. The real protections are the confirm step (which measures the
    // object instead of trusting anyone), the in-flight cap above, and the
    // reconcile job. Verify this one explicitly with the oversize test in
    // R2_ROLLOUT.md before relying on it for anything.
    // ── Cache-Control is stored ON the object ──
    // R2 replays this header on every GET, and it is what lets Cloudflare's
    // edge hold the file. Without it nothing caches: every view in Saudi
    // Arabia would travel to wherever the bucket physically lives, and the
    // bucket's region would suddenly matter enormously. With it, the region
    // only affects the first request per edge location.
    //
    // A year, and immutable, for the same reason the Supabase uploads use one:
    // the key carries a timestamp and a uuid and is never reused, so the bytes
    // behind a URL can never change. `immutable` additionally stops browsers
    // revalidating on refresh.
    const cacheControl = 'public, max-age=31536000, immutable';

    const putHeaders: Record<string, string> = {
      'content-length': String(size),
      'content-type': contentType,
      'cache-control': cacheControl,
    };

    const signed = await r2.sign(
      new Request(signUrl, { method: 'PUT', headers: putHeaders }),
      { aws: { signQuery: true, allHeaders: true } },
    );

    return json({
      id: row.id,
      key,
      uploadUrl: signed.url,
      publicUrl: `${R2_PUBLIC_BASE}/${key}`,
      expiresIn: 120,
      // Returned rather than hardcoded in the app: every header named here was
      // part of the signature, so the PUT must send them back byte for byte or
      // R2 rejects it. Handing them over means the cache policy can change here
      // without shipping a new build.
      headers: putHeaders,
    });
  }

  // =========================================================
  // confirm — measure what actually landed
  // =========================================================
  if (action === 'confirm') {
    const id = String(body.id ?? '');
    if (!id) return json({ error: 'bad_request' }, 400);

    const { data: row, error: rowErr } = await db
      .from('media_objects')
      .select('id, bucket, key, user_id, size_bytes, status')
      .eq('id', id)
      .single();
    if (rowErr || !row) return json({ error: 'not_found' }, 404);

    // Somebody else's upload is none of this caller's business.
    if (row.user_id !== user.id) return json({ error: 'forbidden' }, 403);

    // Idempotent: a phone retrying on a flaky connection gets the same answer
    // rather than a second count against its quota.
    if (row.status === 'stored') {
      return json({ ok: true, size: row.size_bytes, publicUrl: `${R2_PUBLIC_BASE}/${row.key}` });
    }
    if (row.status === 'rejected') return json({ error: 'rejected' }, 409);

    // ── Ask R2, do not ask the app ──
    const head = await r2.fetch(objectUrl(row.key), { method: 'HEAD' });
    if (head.status === 404) {
      return json({ error: 'not_uploaded' }, 409);
    }
    if (!head.ok) {
      return json({ error: 'head_failed', status: head.status }, 502);
    }

    const actual = Number(head.headers.get('content-length') ?? 0);
    const rules = BUCKETS[row.bucket];
    const max = rules?.max ?? 0;
    const declared = Number(row.size_bytes ?? 0);

    // ── Did they upload what they asked to upload? ──
    // Checking only against the bucket maximum is not enough. The quota at
    // sign time was evaluated against the DECLARED size, so a caller who says
    // "1 KB" and then stores 59 MB passed a check that was answering a
    // different question. The bucket ceiling alone would wave that through.
    //
    // declared is file.size, which is exact, so this should match to the byte.
    // The slack is for transfer-layer differences rather than for tolerating
    // a discrepancy — anything beyond it is a lie, not a rounding error.
    const slack = Math.max(1024, Math.ceil(declared * 0.01));
    const overDeclared = declared > 0 && actual > declared + slack;

    if (!actual || (max && actual > max) || overDeclared) {
      // Measured and refused. The bytes go immediately — an oversized object
      // left in the bucket is a bill. The row stays as 'rejected' rather than
      // being deleted, so the attempt still counts against the daily quota and
      // the pattern is visible to an operator afterwards.
      await r2.fetch(objectUrl(row.key), { method: 'DELETE' });
      await db.from('media_objects')
        .update({ status: 'rejected', size_bytes: actual, confirmed_at: new Date().toISOString() })
        .eq('id', row.id);
      return json({
        error: 'file_too_large',
        reason: overDeclared ? 'larger_than_declared' : 'over_bucket_max',
        actual, declared, max,
      }, 413);
    }

    const { error: updErr } = await db
      .from('media_objects')
      .update({ status: 'stored', size_bytes: actual, confirmed_at: new Date().toISOString() })
      .eq('id', row.id);
    if (updErr) return json({ error: 'ledger_update_failed', detail: updErr.message }, 500);

    return json({ ok: true, size: actual, publicUrl: `${R2_PUBLIC_BASE}/${row.key}` });
  }

  return json({ error: 'unknown_action' }, 400);
});
