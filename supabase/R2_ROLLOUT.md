# Moving media to Cloudflare R2

The order below is not arbitrary. Each step leaves the app working and the
billing ceiling honest. Doing them out of order — specifically, moving uploads
before moving the accounting — gives you an app that looks fine while the
storage ceiling silently stops existing.

---

## The one thing that must not go wrong

Every ceiling in this app is measured by `storage_used_bytes()`, which sums
`storage.objects` — **Supabase's** table. `within_upload_quota()` calls it
before every upload; the 07:00 storage alert calls it once a day.

Point uploads at R2 without changing that, and the function reports the same
~200 MB for ever. The quota never refuses anything, the alert never fires, and
R2 fills toward the 10 GB where the card on file starts being charged.

**A monitor pointed at the wrong storage is worse than no monitor, because it
reassures.** That is why step 1 is accounting, not uploads.

---

## Step 1 — accounting first (you run, ~1 min)

Run `migrations/0062_r2_media_ledger.sql` in the Supabase SQL editor.

It adds `media_objects` (the ledger) and rewrites `storage_used_bytes()` and
`user_uploads_today()` to sum Supabase **and** R2. `within_upload_quota()`,
`upload_quota_status()` and `check_storage_alert()` are not touched — they pick
this up for free.

Nothing should change yet. Confirm exactly that:

```sql
select public.storage_used_bytes()                                as used,
       (select global_max_bytes from public.app_limits where id=1) as ceiling,
       (select count(*) from public.media_objects)                 as ledger_rows,
       public.upload_quota_status() -> 'allowed'                   as still_allowed;
```

Expect `ledger_rows = 0`, `used` identical to before, `still_allowed = true`.
Write `used` down — step 8 checks against it.

---

## Step 2 — Cloudflare (you, ~10 min)

Only you can do these. I never handle the keys.

1. **R2 → Create bucket** → `flyp-media`.

   - **Location:** do *not* accept the Automatic guess if it says Asia Pacific.
     Click *Provide a location hint* and choose **Western Europe**. Saudi
     traffic routes west through the Red Sea cables — roughly 90–110 ms to
     Frankfurt against 140–170 ms to Singapore.

     This matters less than it looks: objects are stored with a year-long
     `Cache-Control`, so Cloudflare's edge (which has presence in Jeddah and
     Riyadh) serves almost every request and the bucket's region only affects
     the first miss per location. Set it right anyway — it is free to get
     right now and annoying to change later.

   - **Storage class: Standard.** Not Infrequent Access. IA charges a
     per-GB *retrieval* fee, which would put a meter back on exactly the reads
     that R2 was chosen to make free, and bills a 30-day minimum per object.

   - Leave **Specify jurisdiction** alone. It is a data-residency lock for
     GDPR-style requirements and only adds constraints here. (Saudi Arabia's
     PDPL has its own rules about personal data leaving the country, and user
     video would count — worth reviewing before public launch, not now.)
2. **R2 → Manage API Tokens → Create API token** → permission **Object Read &
   Write**, scoped to `flyp-media` only. Copy the Access Key ID and Secret —
   the secret is shown once.
3. **Bucket → Settings → CORS policy.** Easy to forget, and skipping it makes
   every upload fail from the phone while working fine in a desktop browser:

   ```json
   [{ "AllowedOrigins": ["https://localhost",
                         "capacitor://localhost",
                         "flyp://localhost",
                         "http://127.0.0.1:5599",
                         "http://localhost:5599"],
      "AllowedMethods": ["PUT"],
      "AllowedHeaders": ["*"],
      "MaxAgeSeconds": 3600 }]
   ```

   Every origin here is one the app actually runs from, taken from
   `capacitor.config.json`:

   - `https://localhost` — Android, because `androidScheme` is `https`
   - `flyp://localhost` — iOS, because `iosScheme` is `flyp` (not built yet,
     but free to allow now and invisible to debug later)
   - `capacitor://localhost` — older Capacitor iOS default
   - `127.0.0.1:5599` / `localhost:5599` — the local server used for browser
     testing, so `?r2=1` can be exercised before any APK is built

   A missing origin does not produce a useful error. The browser blocks the
   PUT before it leaves, so it surfaces as an opaque network failure that
   looks exactly like a bug in the Edge Function.

4. **Public access.** Either attach a custom domain (needs the domain's DNS on
   Cloudflare — `flyp-sa.com` is currently on HostCarts, so this means moving
   nameservers; carry the MX records across or `admin@flyp-sa.com` stops
   receiving the storage alerts), or enable the `r2.dev` URL for now.

   Whichever you pick, that URL is `R2_PUBLIC_BASE`. Switching later is one
   `update` per column, not a migration.

---

## Step 3 — secrets (you, ~2 min)

**Supabase → Edge Functions → Secrets.** Never in the repo, never in chat.

| Name | Value |
|---|---|
| `R2_ACCOUNT_ID` | Cloudflare account id |
| `R2_ACCESS_KEY_ID` | from step 2 |
| `R2_SECRET_ACCESS_KEY` | from step 2 |
| `R2_BUCKET` | `flyp-media` |
| `R2_PUBLIC_BASE` | serving URL, **no trailing slash** |

---

## Step 4 — deploy the gate (either of us)

```bash
npx supabase functions deploy media-upload
```

**With** JWT verification — do not add `--no-verify-jwt`. Unlike
`storage-alert`, which a scheduler calls, this one is called by a signed-in
person and the quota is per-user, so it has to know who is asking.

---

## Step 5 — prove the gate holds (before any real upload)

Three tests. The second is the one that matters.

**5a — a normal upload works.** Sign, PUT, confirm, then:

```sql
select bucket, status, size_bytes, created_at
  from public.media_objects order by created_at desc limit 5;
```

Expect one `stored` row whose `size_bytes` matches the file exactly.

**5b — the oversize test.** Ask to sign a 1 MB upload, then PUT a file much
larger than 1 MB to the returned URL.

- If R2 refuses with 403, the content-length binding is working.
- If R2 accepts it, that guard is not active on this runtime — expected, and
  the reason it is documented as a bonus rather than a defence. **Then call
  confirm**: it must return `413` with `reason: "larger_than_declared"`,
  delete the object from R2, and leave a `rejected` row.

Either outcome is acceptable. What is *not* acceptable is confirm returning
`ok` — that would mean a client can put unmeasured bytes in your bucket.

Confirm compares against the DECLARED size, not just the 60 MB bucket ceiling.
That distinction matters: the quota at sign time was evaluated against what the
caller claimed, so "declared 1 KB, stored 59 MB" passed a check that was
answering a different question, and a bucket-ceiling-only test would wave it
through.

**5c — the file is actually cacheable.** The single check that decides whether
your egress bill stays at zero:

```bash
curl -sI "https://<R2_PUBLIC_BASE>/<key from 5a>" | grep -i "cache-control\|cf-cache-status"
```

Expect `cache-control: public, max-age=31536000, immutable`. If that header is
missing, the object was uploaded without it — the PUT must send back every
header the sign step returned, because they were all part of the signature.
Nothing caches without it, every view goes to the bucket, and the region you
picked in step 2 suddenly matters a great deal.

Fetch it twice: `cf-cache-status` should go `MISS` then `HIT`.

**5d — the quota still bites.** Set the ceiling below current usage, ask to
sign, put it back:

```sql
update public.app_limits set global_max_bytes = 1 where id = 1;
-- sign request here must return 403 quota_exceeded, reason "global_full"
update public.app_limits set global_max_bytes = 8589934592 where id = 1;  -- 8 GB
```

---

## Step 6 — deploy the sweeper

```bash
npx supabase functions deploy media-reconcile --no-verify-jwt
```

Plus one more secret, `RECONCILE_SECRET` — any long random string.

This deletes bytes nobody is accounting for: a phone that uploaded and then
died before confirming leaves a real object behind a `pending` row, and after
15 minutes that row stops counting toward usage. Storage you are billed for
and cannot see — the exact blindness this whole design exists to prevent.

Run it **hourly**; that interval is the longest an unaccounted object can sit
in the bucket. Add it to `.github/workflows/storage-alert.yml` or call it from
pg_cron. Check the response: `list_truncated: true` means the bucket holds
more than one run could walk, and some orphans were not examined.

---

## Step 7 — switch uploads over

Already written and shipped inert. In `web/js/config.js`:

```js
let r2Uploads = false;   // -> true
```

`publishVideo` and `uploadLiveThumbnail` try R2 first and fall back to Supabase
when it is off or unreachable. A **deliberate refusal** — quota exceeded, file
too large — throws instead, so a person never sees a successful upload that the
quota just declined.

Test it without a rebuild first: open the app with **`?r2=1`** and post a clip.
Then check the ledger and the bucket before changing the file.

---

## Step 8 — move the ~200 MB that already exists

```bash
python tools/copy_media_to_r2.py --env r2-migrate.env            # dry run
python tools/copy_media_to_r2.py --env r2-migrate.env --copy     # do it
```

You run this, not me — it needs the `service_role` key. Put the values in
`r2-migrate.env`, run, then **delete that file**. Never commit it.

It copies, verifies each object by asking R2 its size, writes the ledger rows,
and emits `r2_url_rewrite.sql` for you to read and run. It deliberately does
not rewrite any URL itself and does not delete anything.

The rewrite covers **five** columns, not two:

| Table | Column | Why |
|---|---|---|
| `videos` | `video_url`, `thumbnail` | the clip and its poster |
| `sounds` | `audio_url`, `cover_url` | every public post gets an original sound carrying the video's own URL |
| `live_streams` | `thumbnail` | live covers are filed in the videos bucket |

Missing the last three would leave sounds and live covers pointing at files
that no longer exist.

Only after the SQL has run, the app has been opened, and video actually plays
should you come back with `--delete-source`.

Afterwards `used` from step 1 should be roughly unchanged — the same bytes,
counted on the other side of the ledger. **If it dropped, the ledger is not
seeing R2. Stop and fix that before anything else.**

---

## Step 9 — set the real ceiling

```sql
update public.app_limits set global_max_bytes = 8589934592 where id = 1;  -- 8 GB
```

8 GB, not 10. R2's free allowance is 10 GB and billing begins above it, so the
app's own ceiling must trip first with room to spare. The 07:00 alert then
warns at 5.6 GB (70%), 6.8 GB (85%) and 7.6 GB (95%).

---

## Step 10 — the leaks worth closing

Not blockers, but they cost money on a metered store in a way they did not on
a free one:

- ~~**`adminDeleteVideo` deletes the database row and leaves the file.**~~
  **Closed by `migrations/0081` + the `delete` action in `media-upload`.**
  Reclassified on the way: this was filed here as a cost problem, and it is a
  bigger privacy one. Step 11 below establishes that the bucket serves anything
  to anyone holding the URL, so an object left behind after its post is deleted
  is not an orphaned byte on a bill — it is a file the person was told they
  deleted, still world-readable for ever. An app store listing that claims
  deletion cannot stand on that.

  `deleteVideo` and `adminDeleteVideo` now call the Edge Function after the row
  delete succeeds, unawaited. It refuses unless the object is the caller's (or
  the caller is an admin) *and* no row in `videos.video_url`,
  `videos.thumbnail`, `sounds.audio_url`, `sounds.cover_url` or
  `live_streams.thumbnail` still references it — 0068's objection was that a
  delete path could remove the wrong file, so that check is the feature and a
  check that merely *errors* counts as a reference. Ledger rows go to status
  `deleted`, which drops them out of `storage_used_bytes()` while
  `user_uploads_today()` keeps counting them, so delete-and-reupload is not a
  way around the daily ceiling.

  The non-obvious half is in 0081 rather than the function: an original sound
  carries the video's own URL in `audio_url` (see step 11), and
  `origin_video_id` is `on delete set null`, so a deleted post left a sound row
  still pointing at its file. The reference check would have found it, refused,
  and collected nothing for any public post ever. 0081 scrubs those URLs on a
  `before delete` trigger and backfills the rows earlier deletes left behind.

  Still not collected: media orphaned by a `sounds` or `live_streams` row being
  deleted directly, and anything already orphaned by a video delete that
  happened before this shipped. Both need a sweeper that acts on the same
  five-column check — see the note in step 3 of `media-reconcile`, which
  deliberately looks without touching.
- **A phone that uploads and then dies before confirming** leaves a real object
  behind a `pending` row. Needs an hourly reconcile job: list R2, compare with
  the ledger, delete what nobody claims. `expire_pending_media()` is the
  database half of that and already exists.
- **Chat attachments store a 7-day signed URL in `messages.attachment_url`.**
  Pre-existing, unrelated to R2: after seven days the link is dead and the
  message keeps it for ever. Should store the path and sign on read instead.

---

## Step 11 — media privacy (found during App Store prep)

Three findings, verified against the live project rather than read off the
schema. Two are fixed; the third needs infrastructure that does not exist yet.

### Fixed: a private video's URL was published to an anon-readable table

`publishVideo` created an "original sound" for every post, and
`createOriginalSound` copies the **video's own URL** into `sounds.audio_url` —
there is no separate audio file, the browser plays the mp4's audio track.
`sounds` was `for select to authenticated, anon using (true)` since 0008.

So a clip marked `private` had `videos` RLS hiding its row and the sound row
handing the media URL back to any stranger with the public anon key — and the
bucket serves that URL with no authentication at all. One HTTP request, no
account. Closed in `db.js` (no sound row for a non-public post) and in
`migrations/0079` (RLS: a sound is exactly as visible as the video it came
from). Run 0079.

### Fixed: the object key carried the uploader's auth UUID

Keys were `videos/<auth uid>/<timestamp>-<uuid>.mp4`, and the key *is* the URL.
`media-upload` now mints 16 random bytes and nothing else. Nothing parsed keys
— `user_uploads_today()` sums by `media_objects.user_id`, `media-reconcile`
matches whole keys against the ledger — so this changes no behaviour.

Existing objects keep their old keys and keep working. To rekey them:
`python tools/rekey_media_r2.py --env r2-migrate.env` (dry run), `--copy`, run
the emitted `r2_rekey_urls.sql`, watch a video, then `--delete-old`. Server-side
copy, so no egress. Both copies count toward the ceiling until you finish.

### Fixed: the public buckets could be listed anonymously

`avatars public read` / `videos public read` are unconditional `select`
policies, and storage's LIST endpoint is a select. Listing `avatars` with the
anon key returned every user's auth UUID as a folder name. `migrations/0080`
scopes those policies to the owner. Reads are unaffected: a public bucket is
served through `/object/public/`, which does not evaluate policies, and the app
only ever reads through `getPublicUrl()`.

### Not fixed: anyone holding a media URL can still fetch it

This is the honest state of things. `videos.privacy` is enforced by Postgres;
the object store has never heard of it. A URL that leaks — through a share, a
former follower, a CDN log, a device cache — works for ever.

**Signed URLs are not the answer here, and it is worth writing down why:**

- The whole R2 design rests on `cache-control: …immutable` at Cloudflare's
  edge, which is what makes egress free and the bucket's region irrelevant. A
  presigned URL is unique per request, so it is a cache MISS every time —
  every view becomes an origin fetch.
- Worse, presigning does not work on the public base at all. `r2.dev` and a
  custom domain are the *public* endpoint; SigV4 GETs go to
  `<account>.r2.cloudflarestorage.com`, which is not the cached path. Signing
  means abandoning the CDN, not merely warming it less.
- The feed cache persists fully-formed URLs to `localStorage` for 24 hours and
  renders from them on cold start (`tt-cache-v2`). Any signature short enough
  to be meaningful is dead before that cache is; any signature long enough to
  survive it is a permanent bearer token, which is what we already have.
- `sounds.audio_url` and `messages.attachment_url` store URLs in columns for
  ever. Chat already demonstrates the failure mode — see the 7-day note above.
- Signing costs a round trip on the hot path: measured sign latency in this
  project is 1.3–3.0s.

Seeking, for the record, is *not* a reason — R2 presigned GETs honour `Range`
fine. The reasons above are enough on their own.

**What actually fixes it**, when there is time: a Cloudflare Worker on a custom
domain in front of the bucket. Public objects pass straight through and stay
edge-cached exactly as now; a non-public one is served only after the Worker
validates a Supabase JWT and checks the viewer against `videos.privacy`. It
needs `flyp-sa.com`'s DNS on Cloudflare first (step 2), so it cannot ship
today. Until then, treat rekeying as the revocation mechanism: it is the only
way to make an already-leaked URL stop working.

---

## Free-tier note

Supabase Free gives ~5 GB egress/month across everything. A feed load is
~5.7 MB, so that is roughly 900 feed loads a month — about 30 people opening
the app once a day. Video is ~98% of it.

Moving `videos` to R2 is what makes the free tier viable: what remains is JSON
and avatars, roughly 50 KB per feed load instead of 5.7 MB.

R2's own free allowance is 10 GB stored, 1M writes/month, 10M reads/month, and
**zero egress** — the reason the read side costs nothing no matter how much the
app is watched.
