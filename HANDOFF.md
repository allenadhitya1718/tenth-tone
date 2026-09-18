# FLYP handoff — 2026-09-18 (afternoon)

> **Newest first (18 Sep, afternoon).** Three more commits on
> `fixes/apk-review-and-security`, pushed, **NOT tagged** (a tag is a build; the
> user tags): `820154d` messaging like Instagram, `085edf0` back button,
> `13f3c8f` call screen. Memory notes: `flyp-back-button-and-call-screen`,
> `flyp-call-inbox-feed-batch`.
> - **Messaging = Instagram (0091 applied live):** the 0089 default of
>   'following' was the wrong lever — it refused strangers at the door. FLYP
>   already trays them (Requests tab, `chat_request_flags()`, `accept_on_reply`);
>   the default is back to 'everyone'. The dev account (`user_d6aceb49`) still
>   has 'following' saved by hand — change it in Settings if "not accepting
>   messages" shows for that account.
> - **Back from the feed → login page (Android), reported a third time.** The
>   sessions table caught it live on 1.4.12 (two sign-ins on the Android phone
>   six minutes apart, 00:52 / 00:58 IST). The 1.4.11 JS listener is provably
>   correct in a browser; why the phone walked history could not be found by
>   reading, so the fix no longer depends on that path: the whole sign-in
>   funnel now REPLACES history entries (one entry for tour → welcome → login
>   → feed), `render()` bounces a signed-in person off any auth screen reached
>   from history, and **MainActivity.java handles back natively** (registered
>   after the plugins, so it outranks them; asks the page `window.__ttBack`).
>   Every press leaves a receipt that the next sign-in logs to `client_logs` as
>   `back_prev` — **read that first if the phone still misbehaves.** The Java is
>   uncompiled here (no JDK): the next Android CI build compiles it AND the
>   AudioRoute plugin for the first time. Watch both.
> - **Call screen redesigned** ("looks bad, only 3 options"): blurred photo
>   backdrop, top bar (minimise · kind · message on video), frosted dock:
>   voice = Mute · Speaker · Message · End; video = Mute · Camera · Flip ·
>   Speaker · End. Minimise/Message appear once connected (leaving a ringing
>   call cancels it). `switchCamera` added to the call session. Screenshots in
>   scratchpad `5fc2c807…/shots/call_*.png`.
> - Whole-app smoke clean after all of it (8 routes, 0 console errors).
> - Tooling: `graphify.exe` is blocked by Windows Application Control (same
>   policy as WebKit) — try once, then read source. Playwright CDP: run scripts
>   one at a time; stray pages from a crashed script wedge the attach
>   (`/json/close/<id>`). Details in `flyp-playwright-testing`.

# FLYP handoff — 2026-09-18 (morning)

> **Newest first (18 Sep).** A large call/chat/feed/push batch is committed as
> `da8c123` on `fixes/apk-review-and-security`, **NOT tagged** (a tag is a
> build; the user tags). Browser-verified, whole-app smoke test clean (8
> routes, 0 console errors). Details in memory note `flyp-call-inbox-feed-batch`.
> - **Calls** survive back (green "Call in progress" pill, tap to return),
>   iOS earpiece no longer kills the call, audio starts without the silent
>   seconds, and Bluetooth routing + an output picker were added. The **Android
>   call plugin has never compiled here (no JDK)** — the first CI Android build
>   is its first compile; watch that step (AudioDeviceInfo APIs vs minSdk 22).
> - **Chat:** who-can-message default was set to 'following' (0089) — **reverted
>   to 'everyone' by 0091, see the afternoon block above**; the inbox
>   preview, unread dot and Chat-tab badge update live without opening the chat.
> - **Push actually works now:** the trigger had been calling the wrong schema's
>   http_post, so EVERY push (and the hourly media-reconcile cron) silently made
>   zero calls. 0090 fixes it; a test notification returned `sent:1`. Displaying
>   on the phone is the only unproven step left.
> - **Feed:** pull down at the top to reload.
> - Migrations 0088–0090 applied live; send-push redeployed. Still phone-only:
>   the voice-note send (client_logs 0088 will report the cause) and the camera
>   black-preview watchdog.

# FLYP handoff — 2026-09-17

Read this first in a new session. It is the complete state of the work as of the end of the 17 Sep session; the repo, git history and the memory folder hold the details.

> **Update, 17 Sep evening — read this block, the rest is history.**
>
> - **v1.4.11 is built on both platforms** (Android run #63 → APK on the GitHub
>   Release page; iOS run #66 → TestFlight). It carries eleven fixes, each
>   measured before and after; the full list and the root causes are in the
>   commit message of `f14d331` and in the memory note `flyp-v1411-fix-batch`.
> - **A second batch is committed to the branch but NOT tagged, on the user's
>   instruction: push notifications must be set up before the next build.**
>   In it: "Replying to" rendered as its own node so it translates; a reply to
>   a shared reel quotes "🎥 فيديو" instead of nothing; and the **Android half of
>   the earpiece plugin, which had never existed** (iOS only; agora.js fell back
>   to "earpiece = loudspeaker at 55%"). The Android plugin is untested — no
>   JDK here; the next CI run is its first compile.
> - **Not reproducible here, needs the phone:** voice note "records but will
>   not send" (passes end to end on Chromium with a fake mic, upload 200);
>   the black camera preview; the ~3 s silence at the start of calls.
> - **Push notifications are deployed and tagged as v1.4.12 (18 Sep, early).**
>   Secrets set, `send-push` deployed (`npx.cmd supabase functions deploy
>   send-push --no-verify-jwt`), 0087 applied. **Android run #64 is green** and
>   its log shows `google-services.json: project flyp-4a726` — the APK on the
>   Release page has push. iOS run #67 first failed at signing with Apple's
>   certificate cap ("Choose a certificate to revoke") — the recurring CI
>   issue, not the push change; the user revoked a stale Development cert and
>   ticked Push Notifications on `com.flyp.social`, and **attempt #2 went green:
>   1.4.12 is on TestFlight.** Still unproven: a real push arriving on a phone —
>   needs a tester on 1.4.12 who allowed notifications, then check
>   `push_tokens` and `net._http_response`. Details in `flyp-push-notifications`.
>
> **Earlier update the same day — sections 1 and 4 below are out of date.**
>
> - **v1.4.8 was tagged and pushed, and both builds failed.** v1.4.9 (`45885cd`)
>   fixes the CI and is pushed. **iOS v1.4.9 succeeded and is on TestFlight.**
>   Android v1.4.9 *builds* (signed Play-Store AAB) but the run still fails at the
>   last step because GitHub's **artifact storage quota is full** — free it and
>   re-run, no code change needed. See [[flyp-ci-build-fixes]] in the memory
>   folder for all three root causes, including that **every iOS build before
>   v1.4.9 went to Apple as version 1.0**.
> - **The Cloudflare/R2 migration in section 4 is finished.** Nameservers cut
>   over, bucket CORS now allows GET/HEAD, `media.flyp-sa.com` is connected and
>   caching (`cf-cache-status: HIT`), `R2_PUBLIC_BASE` is set, and the stored
>   links are rewritten — **80 of them across five columns, not the 73 across
>   three that section 4 claims.** The missing two were `sounds.cover_url` and
>   `live_streams.thumbnail`; the authoritative list is `REFERENCED_BY` in
>   `supabase/functions/media-upload/index.ts`.
> - **The "no sound on any reel" report is the upload bug**, one of the six in
>   `a3c232e`: reels filmed through FLYP on 15 and 17 Sep have no audio track at
>   all (`handlers vide`, no `mp4a`), while 31 of the other 35 do. Untested on a
>   phone until someone opens TestFlight build 1.4.9.

## 1. Code state — committed, NOT tagged, NOT pushed

Branch `fixes/apk-review-and-security` (repo `C:\dev\TenthTone\Tiktok`). Three commits are waiting for the user's go:

| Commit | What |
|---|---|
| `a3c232e` | Six iPhone bugs: sound in uploads (Web Audio tap, WebKit has no `captureStream()` on media elements), 720p→ back to sane target, own/saved/draft video tap opens that video, play badge icon size, camera with a reel's sound (Web Audio mix), next clip pre-buffer |
| `d983cec` | Version 1.4.8 (`config.js` appVersion, cache pins bumped in `index.html`) |
| `99d7291` | Feed in one round trip (migration 0084 + `db.js`/`views.js`), comments backdrop = one still and no feed call, incoming-call poll debounced, uploads 720x1280 @ 1.2 Mbps with H.264 High where available, iPhone clips already at 720p are not re-encoded, persisted cache key v3 |

Rule from the user: **a tag is a build; never tag or push without the user saying so in that message.** When they say go:

```bash
cd C:/dev/TenthTone/Tiktok && git push origin fixes/apk-review-and-security && git tag v1.4.8 && git push origin v1.4.8
```

Cache-bust pins currently: `app.css?v=154`, `config.js?v=36`, `compress.js?v=9`, `db.js?v=98`, `views.js?v=207`, `i18n.js?v=134`, `app.js?v=44`. Bump the pin of every file you change.

## 2. Database — applied live through `q.mjs`

- `0083_recount_profile_counters.sql` — nightly counter recount (03:45), applied earlier.
- `0084_feed_in_one_round_trip.sql` — `fetch_fyp_feed` now also returns `saves_count`, `liked`, `saved`, `following` for `auth.uid()`. Applied and verified against the tables for two accounts (`wk/verify84.mjs`).
- Neither is recorded in Supabase's migration table (they were run as plain SQL). Project region is **Tokyo (ap-northeast-1)** — every API call costs ~0.15-0.3 s of pure distance; moving region is a full project migration, not done.

## 3. Verified like a human (screenshots in scratchpad `shots/`)

- Chromium with the iPhone 13 profile against the LIVE backend: feed cold open, upload → publish (audio kept, 720p), deep link from profile/saved/drafts, play badge, camera with a sound (mixed and out-loud routes).
- The user's OWN signed-in Chrome (profile `scratchpad/chrome-signin`, debug port 9222, relaunch with the same profile keeps the session): feed 18 → 5 backend calls, comments backdrop, own video tap, discover/inbox/notifications/settings/create, and **both follower lists** (own row has no button, states and counts match the database).
- **Playwright WebKit is blocked** on this PC by Windows Smart App Control (unsigned `WebKitWebProcess.exe`). The real iOS engine was NOT exercised; the friend's iPhone is the final proof.

## 4. Cloudflare DNS migration — done on Cloudflare's side, waiting on the registrar

Goal: put Cloudflare's cache in front of R2 (videos come from `pub-4c6ffb7f17b94966ba58385f4663c40a.r2.dev`, never CDN-cached, 0.5-0.9 s first byte).

Done (Free plan, no billing touched, "Connect a domain" not buy/transfer):
- Zone `flyp-sa.com` added to the user's Cloudflare account (account id `93045b1e301baa37d6fda8b4e77250e5`).
- Cloudflare imported all 30 records; all 14 A/CNAME rows switched to **DNS only** (mail, ftp, cpanel, webmail, whm, ns1/ns2, root and www on Netlify stay exactly as today).
- Added the missing `send` CNAME → `send.forge.rmta.net` (Resend), DNS only. 31 records total.
- Assigned nameservers: **`jaziel.ns.cloudflare.com`** and **`naya.ns.cloudflare.com`**. They already answer correctly for the zone. DNSSEC is off (no DS record).

Pending (user side): change the domain's nameservers at the registrar. Registrar is NameSilo; the domain was bought by a teammate, likely through the host HostCarts (`https://www.hostcarts.in/myaccount` → Domains → flyp-sa.com → Nameservers). The user only has cPanel credentials and has sent the teammate a message with the two names. cPanel cannot do this. Rollback at any time: put `ns1.flyp-sa.com` / `ns2.flyp-sa.com` back; do not delete the cPanel DNS zone for a week.

After Cloudflare shows the domain **Active** (check with `nslookup -type=NS flyp-sa.com`):
1. Test: website opens, mail from webmail to Gmail and back, Resend domain still verified.
2. R2 → bucket `flyp-media` → Settings → Custom Domains → connect `media.flyp-sa.com` (Cloudflare creates the record, proxied).
3. R2 bucket CORS policy: add `"GET"` and `"HEAD"` to AllowedMethods (keep the existing PUT and origins) — this is what lets the camera fetch a reel's sound and mix it in.
4. User sets `R2_PUBLIC_BASE=https://media.flyp-sa.com` in Supabase → Edge Functions → media-upload → Secrets.
5. Rewrite stored links so old reels use the new address and deletes keep matching (`media-upload` matches URLs by that prefix): `videos.video_url` (35), `videos.thumbnail` (35), `sounds.audio_url` (3) — `update ... set col = replace(col, 'https://pub-4c6ffb7f17b94966ba58385f4663c40a.r2.dev/', 'https://media.flyp-sa.com/')`. Keep the r2.dev public URL switched on until this is done.

## 5. Facts worth not re-deriving

- Old reels in the library are video-only and 720p; they stay that way until re-uploaded. "Original sound" rows point at those files, so sounds from old reels are silent by construction.
- iPhone MediaRecorder ignores `videoBitsPerSecond` (~2.0 Mbps at 720p); only the WebCodecs path (Android/desktop) honours 1.2 Mbps. Instagram's "200-300" on a data monitor is KB/s = 1.6-2.4 Mbps, which FLYP already matches. Lower on iOS needs server-side transcoding (Cloudflare Stream, ~$5/1000 min stored) — offered, not built.
- Redis was evaluated with numbers and rejected: the feed function runs in 2 ms; the cost is round trips and distance, not computation. The app's own cache (`cached()`/`swr()` in db.js) works; the service worker is deliberately a no-op.
- The auto-mode classifier blocks page scripts that save settings and some batched clicks on dashboards; plain single clicks and read-only scripts pass.

## 6. Tools (scratchpad `C:\Users\allen\AppData\Local\Temp\claude\C--dev-TenthTone\888119cd-0b95-4ad8-8c5e-bdf904c47b26\scratchpad`)

- `serve_live.py` — serves `Tiktok/web` on 5599 (start with PowerShell `Start-Process python serve_live.py`). It dies sometimes; `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5599/index.html` first.
- `wk/q.mjs "<sql>"` / `-f file.sql` — database queries; connection string in `~/.flyp-db-url`, **never print it**. `wk/qtime.mjs N "<sql>"` times a query.
- `wk/measure_feed2.mjs` (feed timing breakdown), `wk/walk_upload.mjs` (MODE=webkitlike|chrome), `wk/walk_camera.mjs` (MODE=cors|nocors|nosound), `wk/walk_deeplink.mjs`, `wk/walk_feed.mjs`, `wk/drive_signed_in.mjs`, `wk/drive_follow_lists.mjs` (the last two need the user's Chrome on port 9222), `mp4info.mjs` (resolution/codecs/audio/bitrate of an MP4), `vids/` test clips.
- Shell PATH sometimes loses `/usr/bin`; prefix commands with `export PATH=/usr/bin:/mingw64/bin:$PATH` and the Node path.

## 7. Standing rules from the user

- Never tag/push a build without being told in that message. All bugs, then one build.
- Verify by driving the app in a real browser and looking at screenshots, not by reading code.
- No Arabic text in the English UI. Do not change what was not asked. No new bugs.
- Never enter passwords; the user signs in. Never handle the service_role key. Anon key is public by design.
- Never load a Cloudflare Turnstile page in the in-app Browser pane (corrupts the app). Claude in Chrome / Playwright are fine.
- Free tier only; never touch billing. Do not use the user's personal Gmail for test accounts.
- The knowledge-graph tool (`graphify`) is not runnable here; note it, do not install things unasked.
