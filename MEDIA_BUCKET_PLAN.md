# Plan: FLYP media in its own Cloudflare bucket

## Why
FLYP's videos, stories and photos are stored in the Cloudflare R2 bucket `flyp-media`, which the old live app also uses. Two keys can delete files there:

| Key | Since | Belongs to |
|---|---|---|
| `flyp-media-token` | Aug 31 | the old live app |
| `flyp-mumbai` | Oct 18 | the new app |

All 6 of the new app's files vanished from that bucket. That covers both test videos and their thumbnails, which are also used by the friend's story. The new app's own delete queue and cleanup job never touched them, so the removal came from outside the new app. The bucket has no lifecycle rule that expires files.

With its own bucket and its own key, nothing from the old app can reach FLYP's media.

## What changes
- **New bucket:** `flyp-app-media`, located in Asia-Pacific like the old one.
- **New public address:** `cdn.flyp-sa.com`. `media.flyp-sa.com` stays on the old bucket, so the old live app keeps working.
- **New key:** an R2 key scoped to `flyp-app-media` only, with Object Read & Write. The old app's key cannot see the new bucket.
- **No file copying:** none of the new app's files survive in the old bucket, so it is a clean switch. Everything uploaded after the switch goes to the new bucket.
- **No app build or update for the switch itself:** the app gets each file's address from the upload function. The privacy-policy text and the old links on the 2 test videos and the story are the only follow-ups.

## Steps
| # | What | Who | Time |
|---|---|---|---|
| 1 | Cloudflare → R2 → Create bucket `flyp-app-media`, location Asia-Pacific | You, or me in your Brave with your OK | 2 min |
| 2 | Bucket → Settings → Custom Domains → Add `cdn.flyp-sa.com` (Cloudflare creates the DNS record) | Same | 2 min |
| 3 | Bucket → Settings → CORS: copy the rules from `flyp-media` (the localhost, capacitor and flyp origins, PUT and GET) | Same | 2 min |
| 4 | R2 → Manage API tokens → Create Account API token `flyp-app-media-token`, Object Read & Write, **only** `flyp-app-media`. Copy the Access Key ID and Secret **once**. | You (the secret must not pass through me) | 2 min |
| 5 | Supabase → Edge Functions → Secrets: set `R2_BUCKET=flyp-app-media`, `R2_PUBLIC_BASE=https://cdn.flyp-sa.com`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (from step 4). Keep `R2_PUBLIC_BASE_ALIASES` with `https://media.flyp-sa.com`, so deleting an old post still matches its old address. | You | 3 min |
| 6 | Redeploy `media-upload`, `media-delete-queue` and `media-reconcile` so they pick up the new settings | Me | 3 min |
| 7 | Test on the Redmi: upload a video and a story, check they play from `cdn.flyp-sa.com`, delete them, and check the files are removed | Me | 10 min |
| 8 | Privacy policy (`mobile/src/lib/legal.ts`, 9 languages): `media.flyp-sa.com` → `cdn.flyp-sa.com`, published with the next update | Me | 5 min |
| 9 | Once 7 passes: delete our old key `flyp-mumbai`, so the new app has no access to the old bucket either | You | 1 min |
| 10 | Ask the friends to re-upload the video and story | You | — |

## Security for the new bucket
**Already in place in the app and upload function (unchanged):**
- **Sign-in:** every upload needs a signed-in account (JWT checked).
- **Limits per person:** a storage quota, a 60 MB per-file limit, and 200 upload links per day.
- **File types:** only `video/mp4`, `video/webm`, `video/quicktime` and `image/jpeg`. The type is part of the upload signature, so it can't be swapped for HTML or SVG.
- **Upload links:** they last 2 minutes and the server picks every file name (32 random hex characters), so names can't be guessed or overwritten.
- **Real size:** after each upload the server measures the file in R2 and deletes it if it's over the limit.
- **Deletes:** only the owner or an admin can delete, and only when nothing in the app still uses the file.
- **The storage key** lives only in the upload function and is never sent to the app.

**Added with the new bucket:**
| Setting | Value | Protects against |
|---|---|---|
| Key scope | Object Read & Write on `flyp-app-media` only | another app's key deleting FLYP files (what just happened) |
| Public Development URL (r2.dev) | **Disabled** | a second, unprotected way to read files, outside the rules below |
| CORS | **none** (the phone apps upload natively and need none) | web pages on other sites using the bucket from a browser |
| Rate limit on `cdn.flyp-sa.com` | block an IP for 60 s after 300 requests in 10 s | scraping and download floods that run up the bill |
| `X-Content-Type-Options: nosniff` on `cdn.flyp-sa.com` | response header rule | a browser treating an uploaded file as a web page |
| Caching | `cdn.flyp-sa.com` responses cached at the edge (files already carry a one-year cache header) | repeated reads hitting R2 and costing money |
| Bucket lock | none | (a lock would also block legitimate deletes such as account deletion) |

## Risk and rollback
- **Rollback:** put the old four secret values back. Uploads then go to `flyp-media` again; nothing else changes.
- **During the switch:** an upload started in the minute the secrets change may fail once and need a retry.
- **Old app:** the old live app is not touched at all; its key and its bucket stay as they are.

## Still worth doing on the old app's side
Find what deleted the files: a cleanup job in the old app's backend that lists the bucket and removes files it doesn't recognise would explain it. Even with separate buckets, it should not delete files it doesn't own.
