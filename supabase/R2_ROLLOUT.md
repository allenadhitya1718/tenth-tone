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
Write `used` down — step 7 checks against it.

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
   [{ "AllowedOrigins": ["https://localhost", "capacitor://localhost"],
      "AllowedMethods": ["PUT"],
      "AllowedHeaders": ["*"],
      "MaxAgeSeconds": 3600 }]
   ```

   `https://localhost` is what Capacitor serves the Android app from.

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
  confirm**: it must return `413 file_too_large`, delete the object from R2,
  and leave a `rejected` row.

Either outcome is acceptable. What is *not* acceptable is confirm returning
`ok` — that would mean a client can put unmeasured bytes in your bucket.

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

## Step 6 — switch uploads over (me)

`db.js` `createVideo` and `uploadLiveThumbnail` move from
`c.storage.from('videos').upload(...)` to sign → PUT → confirm, behind a flag
so it can be turned off without a rebuild if anything misbehaves.

---

## Step 7 — move the ~200 MB that already exists (script by me, run by you)

Needs the `service_role` key, so you run it and delete the file afterwards.
It copies each object to R2, rewrites `videos.video_url` / `videos.thumbnail`,
and only then removes the Supabase copy.

Afterwards, `used` from step 1 should be roughly unchanged — the same bytes,
counted on the other side of the ledger. **If it dropped, the ledger is not
seeing R2 and you must stop and fix that before anything else.**

---

## Step 8 — set the real ceiling

```sql
update public.app_limits set global_max_bytes = 8589934592 where id = 1;  -- 8 GB
```

8 GB, not 10. R2's free allowance is 10 GB and billing begins above it, so the
app's own ceiling must trip first with room to spare. The 07:00 alert then
warns at 5.6 GB (70%), 6.8 GB (85%) and 7.6 GB (95%).

---

## Step 9 — the leaks worth closing

Not blockers, but they cost money on a metered store in a way they did not on
a free one:

- **`adminDeleteVideo` deletes the database row and leaves the file.** Orphaned
  bytes you pay to keep.
- **A phone that uploads and then dies before confirming** leaves a real object
  behind a `pending` row. Needs an hourly reconcile job: list R2, compare with
  the ledger, delete what nobody claims. `expire_pending_media()` is the
  database half of that and already exists.
- **Chat attachments store a 7-day signed URL in `messages.attachment_url`.**
  Pre-existing, unrelated to R2: after seven days the link is dead and the
  message keeps it for ever. Should store the path and sign on read instead.

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
