# FLYP: handover for the tester's Claude

You're helping test **FLYP**, a TikTok-style social app for Saudi users
(short videos, audio live rooms, chat, calls, stories, gifts). It was just
rebuilt from an old Capacitor web app into **React Native (Expo SDK 58,
RN 0.88)** with a new **Supabase** backend. Your job is to help a human
tester run the manual test plan, record results, and turn failures into clear
bug reports. **Don't change code, the database or any settings unless the
owner (Allen) asks you to.**

## Where things are

- **Repo:** https://github.com/allenadhitya1718/tenth-tone, branch
  `feat/rn-phase1-foundation` (public repo).
  - `mobile/`: the app (Expo Router, TypeScript, TanStack Query, i18next).
  - `supabase/migrations/0001–0125`: database schema, RLS, RPCs.
  - `supabase/functions/`: Edge Functions (agora-token, media-upload,
    send-push, moderate-content, suggest-tags, verify-purchase,
    media-delete-queue, storage-alert).
  - `web/`: the old app. Not used any more.
- **Docs to read first:**
  - `mobile/BUILD_GUIDE.md`: builds, store setup, release test list.
  - `SECURITY_AUDIT.md`: 27 security findings, all fixed and applied.
  - `supabase/PHASE4_APPLY.md`: what's applied to the database.
  - `CLIENT_NOTES_STATUS.md`: the client's 31 change requests.
- **Test checklist (record results here):**
  https://claude.ai/artifact/PNwrbXALa9DTBtgE7FWNGz. About 190 checks in 20
  sections. Each one is Pass / Fail / Blocked with a note, and results save
  live. The tester needs Contributor access (Allen shares it).

## The app build

- Android development APK, built by GitHub Actions: workflow "Android dev
  build" on the branch above. Download it from the run's **flyp-dev-apk**
  artifact.
- It's a **development build**. It runs standalone, but for live code changes
  it can connect to a Metro server (`cd mobile && npx expo start --dev-client`).
  For normal testing just open the app.
- Package `com.flyp.app`, app name FLYP, version 2.0.0.

## Backend

- **New Supabase project "Mumbai":** `vfkwipvinmnybilcrdzr`
  (https://vfkwipvinmnybilcrdzr.supabase.co). It's fresh and has **no users
  yet**: every tester signs up a new account. Sign-up codes come from
  `no-reply@notify.flyp-sa.com` (Resend); check Spam.
- **The old project `qnzgxihlrwanywndcmpf` must never be touched.** Moving
  its real users to Mumbai is a separate step planned just before the public
  release.
- **Third-party services:** Agora (live, calls, walkie-talkie), Cloudflare R2
  (videos/photos, bucket `flyp-media` shared with the old app), Gemini
  (moderation, AI hashtags), Firebase FCM (Android push).
- **Media sweeper:** the `media-reconcile` job is deliberately **off**. It
  would delete the old app's videos from the shared bucket.

## What a tester needs

- Two Android phones (calls, walkie-talkie, live guests, chat ticks all need
  two accounts).
- Real email addresses for sign-up codes.
- Both accounts 18+ for the friends map (location sharing is 18+).
- Wallet / coin purchases only work once the coin products exist in Google
  Play Console and the tester is a license tester. Until then, mark those
  checks Blocked.

## Known limits (not bugs)

- **Stories:** there's currently **no button to post a story**. The story
  tray was removed from the feed on request. Record it in the checklist
  (Stories, check 1); Allen will choose where the entry point goes.
- **Calls:** a first call to a stranger is refused (security). Calls need an
  existing relationship such as a chat or follow.
- **"Friends" means a mutual follow:** that applies to location, friends-only
  lives and privacy settings.
- **Locked phone:** on a locked Android phone, Accept on an incoming call asks
  to unlock first.
- **iPhone:** calls show as time-sensitive notifications (no CallKit yet).
- **Languages:** 9 languages (ar, en, zh, hi, ur, fr, es, tr, id). Arabic and
  Urdu switch the layout to right-to-left after a restart.

## How to write a bug report

For every Fail, write in the checklist note: **steps → expected → actual →
phone model / Android version → account used**. Include a screenshot or
screen recording if possible. Crashes: say what screen and what tap. If it's
reproducible, say how often (e.g. 3/3).

When testing is done, Allen will ask his own Claude to read the checklist
results and fix every Fail.
