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
//   4. delete   — remove an object whose last reference is gone. Refuses
//                 unless the caller owns it (or is an admin) AND nothing in
//                 the app still points at its URL. See the action itself for
//                 why that check is the entire feature.
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

// Every column in the app that can hold an R2 media URL. The delete action
// refuses to remove an object while any of them still points at it, so this
// list being COMPLETE is the whole safety property — a column missing from
// here is a way to delete a file something is still serving.
//
// Derived by following the only three uploadMedia() call sites in db.js, all
// of which pass bucket 'videos': the clip and its poster (videos.video_url,
// videos.thumbnail), the "original sound" publishVideo mints from them
// (sounds.audio_url, sounds.cover_url — there is no separate audio file, the
// sound row carries the video's own URL, see 0079), and the live cover
// (live_streams.thumbnail).
//
// Avatars, group photos and chat attachments are NOT here because they are
// still Supabase Storage, not R2. Add to this list before pointing any of them
// at uploadMedia().
const REFERENCED_BY: { table: string; column: string }[] = [
  { table: 'videos',       column: 'video_url' },
  { table: 'videos',       column: 'thumbnail' },
  { table: 'sounds',       column: 'audio_url' },
  { table: 'sounds',       column: 'cover_url' },
  { table: 'live_streams', column: 'thumbnail' },
];

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

    // ── The key is chosen HERE, never by the client, and it says NOTHING ──
    //
    // A client-supplied key is an overwrite primitive: pass someone else's
    // path and you replace their video. So the server picks it. That much was
    // always true. What changed is WHAT it picks.
    //
    // It used to be `videos/<auth uid>/<timestamp>-<uuid>.mp4`, mirroring the
    // folder-per-owner shape the Supabase storage policies needed. On R2 there
    // are no policies, so that shape bought nothing — and it cost something.
    // The bucket is served from a public base, so the key IS the URL, and a
    // URL travels much further than the database row it came from: into share
    // sheets, into other people's chat apps, into CDN and referer logs, into
    // whatever a phone's WebView caches. Every one of those places was being
    // handed a stable identifier that groups all of one person's media, plus
    // the exact minute each file was made.
    //
    // Now it is 16 random bytes and nothing else. No owner, no clock, no
    // ordering. Ownership lives in media_objects.user_id, which is where every
    // consumer already looks: user_uploads_today() sums by user_id, and
    // media-reconcile matches whole keys against the ledger. Neither has ever
    // parsed a key, so neither notices this.
    //
    // The two-character shard is only there to keep a bucket listing navigable
    // by hand; it is the first byte of the same random value and carries no
    // information about who uploaded.
    const rand = crypto.getRandomValues(new Uint8Array(16));
    const oid = Array.from(rand, (b) => b.toString(16).padStart(2, '0')).join('');
    const key = `${bucket}/${oid.slice(0, 2)}/${oid}.${ext}`;

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

  // =========================================================
  // delete — remove an object whose last reference is gone
  //
  // 0068 declined to build this, and the reason it gave is still the design
  // constraint rather than an objection that has been overruled:
  //
  //   "Storing a few orphaned megabytes is the right trade against a delete
  //    path that could remove the wrong file."
  //
  // What changed is not the trade, it is what sat on the other side of it.
  // R2 is served from a public base with no authentication (R2_ROLLOUT step
  // 11), so an object left behind after its post is deleted is not merely a
  // few megabytes on a bill — it is a file the person was told they deleted,
  // still fetchable for ever by anyone who ever held the URL.
  //
  // So the bytes go, and every way this could remove the WRONG file refuses
  // first. Doubt always resolves to "leave it alone":
  //
  //   * no ledger row                → skipped, not deleted
  //   * not yours and not an admin   → 403
  //   * anything still references it → 409
  //   * a reference check that ERRORED counts as a reference → 500
  //
  // Note what is not trusted: the caller says which object, and nothing else.
  // Ownership and every reference are re-derived here against the database. A
  // client claiming "nothing points at this any more" is never asked.
  // =========================================================
  if (action === 'delete') {
    // Three ways to name the object, because the callers differ. The app holds
    // URLs and never sees a key; an operator has a key; anything holding a
    // ledger row has an id.
    const id = String(body.id ?? '').trim();
    const url = String(body.url ?? '').trim();
    let key = String(body.key ?? '').trim();

    if (url) {
      // A URL not served from our bucket is not ours to delete, and saying so
      // is not an error. Posts published before the R2 switch still carry
      // Supabase Storage URLs, and the app calls this on every delete without
      // knowing which era a post came from. Failing loudly would turn an
      // ordinary delete into a stream of errors about nothing.
      const prefix = `${R2_PUBLIC_BASE}/`;
      if (!url.startsWith(prefix)) return json({ ok: true, skipped: 'not_r2_media' });
      // Sliced, not decoded. The public URL is built by plain concatenation in
      // the sign step (`${R2_PUBLIC_BASE}/${key}`) with no escaping applied,
      // so the tail IS the key byte for byte. Running decodeURIComponent over
      // it would corrupt any key holding a literal '%' and throw outright on a
      // malformed escape — undoing an encoding that was never performed.
      key = url.slice(prefix.length);
    }

    if (!id && !key) return json({ error: 'bad_request' }, 400);

    const lookup = db.from('media_objects').select('id, bucket, key, user_id, status');
    const { data: row, error: rowErr } = await (id ? lookup.eq('id', id) : lookup.eq('key', key))
      .maybeSingle();
    if (rowErr) return json({ error: 'ledger_read_failed', detail: rowErr.message }, 500);

    // No ledger row means nothing here knows what this object is or who owns
    // it — so there is no ownership check to pass, and this is not the place
    // to guess. Unledgered objects belong to media-reconcile, which handles
    // them deliberately and behind a two-hour grace period.
    if (!row) return json({ ok: true, skipped: 'no_ledger_row' });

    // ── Whose is it ──
    // An admin may delete anyone's media — that is what adminDeleteVideo is —
    // but the flag is read through `asUser`, the CALLER's own token, so saying
    // you are one is not enough. Read via `db` it would be worthless: the
    // service role can see every profile, including a flag that is not the
    // caller's.
    //
    // The profiles column rather than the is_admin() RPC. Both are correct;
    // this one is the path API.isAdmin() in db.js already uses on every admin
    // screen, so it is known to be exposed and known to work here. 0074 revoked
    // SELECT on this column from `anon` only, and an anonymous caller was
    // turned away with a 401 long before this line.
    if (row.user_id !== user.id) {
      const { data: me, error: adminErr } = await asUser
        .from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
      if (adminErr) return json({ error: 'admin_check_failed', detail: adminErr.message }, 500);
      if (!me || me.is_admin !== true) return json({ error: 'forbidden' }, 403);
    }

    // Idempotent for the same reason confirm is: a phone retrying after a
    // dropped response gets the same answer instead of a 502 from deleting one
    // object twice. 'rejected' is already-gone as well — confirm measured it,
    // refused it and removed the bytes at the time.
    if (row.status === 'deleted' || row.status === 'rejected') {
      return json({ ok: true, already: true });
    }

    // ── Nothing may still point at it ──
    // This check IS the feature; the delete below it is three lines.
    //
    // Run through `db`, the service-role client, on purpose. RLS would hide
    // other people's rows from the caller, and a reference check that cannot
    // SEE a reference reports "unreferenced" and deletes a file somebody else
    // is still serving. This is the one place where seeing everything is the
    // safe choice rather than the dangerous one.
    //
    // Matched on the KEY as a suffix rather than on the whole public URL.
    // R2_PUBLIC_BASE is a deployment setting: moving from the r2.dev URL to
    // cdn.flyp-sa.com (rollout step 2) changes what a freshly built URL looks
    // like, while every URL already sitting in these columns keeps the old
    // base. An exact-URL comparison would then match nothing, report every
    // object unreferenced, and delete live media — precisely the failure 0068
    // refused to risk. A key is 16 random bytes and unique, so a suffix match
    // is exact in practice and survives the base changing underneath it.
    //
    // LIKE wildcards inside a key cannot make this less safe: '%' and '_' can
    // only match MORE rows, and a spurious match refuses a delete. No pattern
    // turns a real reference into a miss.
    const checks = await Promise.all(REFERENCED_BY.map(async (ref) => {
      const { count, error } = await db
        .from(ref.table)
        .select('id', { count: 'exact', head: true })
        .like(ref.column, `%${row.key}`);
      return { ref, count: count ?? 0, error };
    }));

    // An unanswered question is not a "no". If any of the five could not be
    // asked, the object keeps its bytes and somebody gets to look at why.
    const unchecked = checks.filter((c) => c.error);
    if (unchecked.length) {
      return json({
        error: 'reference_check_failed',
        detail: unchecked
          .map((c) => `${c.ref.table}.${c.ref.column}: ${c.error!.message}`)
          .join('; '),
      }, 500);
    }

    const held = checks.filter((c) => c.count > 0);
    if (held.length) {
      // Expected rather than exceptional: the caller deleted a row and asked
      // for cleanup, and something else legitimately still uses the file. The
      // usual cause of a SURPRISING one is a video deleted on a database
      // without 0081, whose original sound row still carries the URL.
      return json({
        error: 'still_referenced',
        by: held.map((c) => `${c.ref.table}.${c.ref.column}`),
      }, 409);
    }

    // ── The bytes ──
    const res = await r2.fetch(objectUrl(row.key), { method: 'DELETE' });
    // S3 DELETE is idempotent and answers 204 whether or not the object was
    // there, so a 404 means something got there first. Both are "gone".
    if (!res.ok && res.status !== 404) {
      // The ledger is deliberately left alone. The row stays 'stored', the
      // bytes stay counted against the ceiling, and the object stays in
      // reconcile's stored_rows — all of which remain true. Marking it deleted
      // here would hide real, billed bytes from the only thing counting them.
      return json({ error: 'r2_delete_failed', status: res.status }, 502);
    }

    const { error: updErr } = await db
      .from('media_objects')
      .update({ status: 'deleted', deleted_at: new Date().toISOString() })
      .eq('id', row.id);
    if (updErr) {
      // The bytes are already gone, so the delete did not fail — the
      // bookkeeping did. The row still reads 'stored' for an object that is
      // not there, which over-states usage slightly and shows up in
      // reconcile's stored_rows. Reported rather than retried, and wrong in
      // the safe direction: it over-counts storage, never under-counts.
      return json({ ok: true, deleted: true, ledger_warning: updErr.message });
    }

    return json({ ok: true, deleted: true, key: row.key });
  }

  return json({ error: 'unknown_action' }, 400);
});
