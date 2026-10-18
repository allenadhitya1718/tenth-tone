# New Supabase project (Mumbai): setup checklist

The current backend (`qnzgxihlrwanywndcmpf`, Tokyo) belongs to a friend's
account. FLYP moves to a new project owned by us (ideally by the client
company), in **Mumbai (`ap-south-1`)**, which is roughly 150–200 ms closer to
Saudi users on every request. See `MOVE_TO_MUMBAI.md` for the reasoning, and
for how to move existing data if it is worth keeping.

Steps marked **[CLI]** can be done by Claude through the Supabase CLI once it
is linked. Claude asks before each one. Steps marked **[You]** are dashboard
toggles or secrets that only you should enter.

---

## 0. Read first: the shared R2 bucket can be wiped

Agora and Cloudflare R2 are separate accounts. The new project only needs the
same secret values, and nothing about them changes. But **`media-reconcile`
deletes every R2 object older than 2 hours that has no `media_objects` row in
ITS OWN database** (`functions/media-reconcile/index.ts`). With two projects
on one bucket:

- The **new** project's sweeper sees every existing file as an orphan
  (empty ledger) and deletes the whole library.
- The **old** project's sweeper (hourly, from 0064) deletes every upload made
  through the new project two hours after it lands.

Safe order:

- [ ] Before the new app uploads anything, **stop the old project's sweeper**:
      on the old project, `select cron.unschedule('media-reconcile');`. That
      needs the friend's access, or someone with it.
- [ ] On the new project, **apply 0064 anyway**: it creates `job_endpoints`
      and the shared secret that push notifications (0087) copy, so skipping
      it breaks push. Then immediately pause its sweep with
      `select cron.unschedule('media-reconcile');`, and leave it paused until
      the old `media_objects` rows are copied across (`MOVE_TO_MUMBAI.md`) or
      you have decided to start with a fresh bucket. Before re-scheduling, a
      dry run (`?dry=1`) must report 0 would-delete.
- [ ] Alternative that avoids all of this: give the new project its own R2
      bucket (e.g. `flyp-media-v2`) and leave the old bucket read-only.

## 1. Create the projects **[You]**

- [ ] `flyp` in **ap-south-1 (Mumbai)**, the real one.
- [ ] Optional, recommended: `flyp-staging` in the same region. Replay the
      migrations there first; it is the only real test that they run clean
      from zero.
- [ ] Save, for each project: the **Project URL**, the **publishable (anon)
      key** and the **project ref**. Never paste the service_role key into
      chat or into the app.

## 2. Turn on extensions BEFORE the migrations **[You]**

Database → Extensions, toggle on:

- [ ] **pg_cron**. Running `create extension pg_cron` in SQL did nothing on
      the old project. It must be the dashboard toggle (see
      `MIGRATION_STATE.md`).
- [ ] **pg_net**. Push notifications, the storage alert and the media sweeper
      all call Edge Functions through it. Without it they silently do nothing.
- [ ] pgcrypto and uuid-ossp are normally on already. Check them.

## 3. Apply the migrations **[CLI]**

Run `supabase/migrations/0001` → `0096` in numeric order (there is no 0078),
with these exceptions:

| File | What to do |
|---|---|
| `0015_ai_moderation` | **Skip.** Superseded by 0066. |
| `0040_seed_accounts` | Decide: it creates the branded seed accounts that hold demo content. Skip for a clean production start. |
| `0052_fix_counter_guard` | **Skip.** Superseded by 0053. |
| `0060_alert_email_recipients` | Edit first: the function URL is hard-coded to the OLD project ref, and the recipient list includes a personal Gmail. Point it at the new ref and the right inboxes. |
| `0064_schedule_media_reconcile` | Edit first: old project ref hard-coded, plus `<RECONCILE_SECRET>` and `<ANON_KEY>` placeholders. Apply it (push depends on it), then **unschedule `media-reconcile` straight away** (see section 0). |
| `RUN_NOW.sql`, `RUN_NOW_group_calls.sql`, `../APPLY_*.sql`, `../REMAINING.sql`, `../RUN_00*.sql` | **Skip.** Old paste bundles; everything in them is in the numbered files. |

Then:

- [ ] Run the re-verification query at the bottom of `MIGRATION_STATE.md`.
      Every row should come back populated.
- [ ] Check the cron jobs exist: `select jobname, schedule from cron.job;`.
      Expect `purge-scheduled-deletions`, `purge-stale-locations`,
      `recount-profile-counters`, and **not** `media-reconcile` while it is paused.
- [ ] Check storage buckets were created (avatars, videos, chat-media,
      group-photos and the others the migrations add).
- [ ] Make your own account an admin afterwards
      (`update profiles set is_admin = true where id = '<your user id>'`).
      The storage alert needs at least one admin.

Known risk: some migrations were applied to the old project by hand and
never recorded (0083, 0084 among them), so nobody has ever run the full
sequence from zero. Expect to fix an ordering issue or two. That is what
staging is for.

## 4. Deploy the Edge Functions **[CLI]**

```
agora-token  media-upload  send-push  media-reconcile  moderate-content  storage-alert
```

`send-push` was deployed with `--no-verify-jwt` on the old project. Keep that
flag for send-push, media-reconcile and storage-alert, which are called by the
database rather than by a signed-in user.

## 5. Function secrets **[You]**

Project Settings → Edge Functions → Secrets. `SUPABASE_URL`,
`SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided
automatically. Everything else:

| Secret | For | Where it comes from |
|---|---|---|
| `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE` | live + calls | Agora console (same values as today) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE` | video/photo uploads | Cloudflare R2 (`flyp-media`, `https://media.flyp-sa.com`) |
| `FCM_SERVICE_ACCOUNT_JSON` | Android push | Firebase project `flyp-4a726` → service account |
| `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC`, `APNS_HOST` | iOS push | Apple Developer → Keys. Topic is the iOS bundle id `com.flyp.social` |
| `GEMINI_API_KEY` | content moderation (App Review 1.2) | Google AI Studio |
| `RESEND_API_KEY`, `ALERT_FROM`, `ALERT_SECRET` | storage alert email | Resend; `ALERT_SECRET` is any long random string, matching 0060 |
| `RECONCILE_SECRET` | media sweeper | any long random string, matching 0064 |

Confirm who owns the Cloudflare account with the R2 bucket. If it is also the
friend's, that needs moving too, or uploads break the day it goes away.

## 6. Authentication settings **[You]**

- [ ] Sign In / Providers → Email: enabled, **Confirm email on**, **Email OTP
      length = 6** (the app draws six boxes).
- [ ] Apple provider: enabled, with the service ID / key from
      `APPLE_SIGNIN_SETUP.md`. Add `com.flyp.social` to the client IDs, since
      the native iOS button sends that as the token's audience.
- [ ] Email templates: paste all six from `supabase/email_templates/`
      (`EMAIL_TEMPLATES.md` says which goes where). Each must contain
      `{{ .Token }}`, since the app verifies by code, not by link.
- [ ] SMTP: Resend, sender name `FLYP`, sender on `flyp-sa.com`. The built-in
      sender allows only a few emails an hour.
- [ ] URL Configuration → Site URL and redirect URLs (see
      `EMAIL_TEMPLATES.md`), plus `flyp://` for the app's deep links.

## 7. Point the apps at it

- [ ] **New app (`mobile/`)**: set `EXPO_PUBLIC_SUPABASE_URL` and
      `EXPO_PUBLIC_SUPABASE_ANON_KEY` (EAS environment variables), or change
      the fallbacks in `mobile/src/lib/config.ts`.
- [ ] **Old web/Capacitor app**, if it stays live during the rebuild:
      `web/js/supabase.js`. Otherwise leave it on the old project.
- [ ] Admin panel (`web/admin.html`) uses the same `supabase.js`.

## 8. Smoke test

- [ ] Sign up with a fresh email → code arrives → verify → lands in the app.
- [ ] Forgot password → code → new password.
- [ ] Upload a video (R2 path) and see it in the feed.
- [ ] Send a message between two accounts; a push arrives on the other phone.
- [ ] Start an audio call (Agora token issued).
- [ ] `select * from net._http_response order by created desc limit 5;` shows
      200s from send-push.
