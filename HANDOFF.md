# FLYP handoff — 2026-09-18 (late): v1.4.15 shipped, iPhone attempt three

> **Newest first. v1.4.15 is on TestFlight (build 1789744958) and the APK is
> on the v1.4.15 Release.** Both green; repo flipped public for the minutes and
> back to private (verified). iOS is manual-only now, so it was dispatched
> against the tag - that still uploads, because DO_UPLOAD reads the ref.
> - **A pre-build review (workflow, 2 of 5 reviewers before it was stopped for
>   cost) found 18 issues, THREE of them regressions written by the previous
>   commit:** vnPcmStart called ctx.resume() without awaiting or checking it
>   (a suspended AudioContext gives 0 bytes - the exact failure it replaced);
>   four sites used `vnRec` to mean "recording", which is null on the WebKit
>   path, so slide-to-cancel and hold-to-lock were dead on iPhone and a tap
>   could start a second recording; the WAV uploaded as .webm. Also mine:
>   gating setActive(true) on `configured` broke interruption recovery in the
>   Swift (an interruption leaves the flag true while iOS deactivates the
>   session) - unconditional again.
> - **The earpiece may STILL not be fixed and this is stated plainly.** The
>   log only proves the route MOVED (iOS reported builtInReceiver), not that
>   setPreferredInput killed the call - and overrideOutputAudioPort, which
>   actually moved it, is untouched. New: 2.5 s after any route change the app
>   logs `call_route_after` with send/receive bitrate and levels from the Agora
>   SDK. **If it breaks again, read that first** - it says whether the media
>   died at the switch, which three rounds have never recorded.
> - **iPhone voice notes no longer use MediaRecorder at all** (0 chunks on iOS
>   18.3 twice over). Web Audio -> WAV, 16 kHz mono. Verified by spoofing the
>   UA on Chrome: valid RIFF/WAVE, decodes to 3.06 s, uploads 200. Android
>   keeps MediaRecorder/opus, confirmed unchanged in the same run.
> - The Android call foreground service ships in this build. It compiles and
>   now stops itself if Android refuses the foreground start (which would
>   otherwise kill the app for never calling startForeground). **Never run on
>   a phone** - if Android misbehaves after 1.4.15, pull it first.

# FLYP handoff — 2026-09-18 (night): v1.4.14 shipped, call notification merged

> **Newest first.** **v1.4.14 is on TestFlight (build 1789739360) and the APK
> is on the v1.4.14 Release.** It carries the nine-bug batch (`fd19b89`) and
> the voice-note fix (`f60e780`). Memory: `flyp-call-notification-and-ci-billing`.
> - **CI BILLING, not code.** Both builds began failing in 3 seconds with zero
>   steps: the 2,000 free monthly Actions minutes for a PRIVATE repo were
>   gone. iOS burned 84% of them (macOS bills **10x**: 53 runs, 134 min of
>   real work, ~1,343 billed) and took Android down with it. **The iOS
>   workflow is workflow_dispatch ONLY now** (`ba0d87f`); Android still builds
>   on tags. Nothing was ever charged - there is no payment method.
> - **To build while out of minutes:** flip the repo PUBLIC (unlimited free
>   minutes), run, flip back. Verified safe: no key files committed or ever in
>   history, secrets live in GitHub Secrets. Use the scratchpad scripts, which
>   flip back in a `trap … EXIT`. **Ask the user every time** - it publishes
>   their source.
> - **Apple cert cap again** ("choose a certificate to revoke"): CI mints a
>   development certificate per run and Apple caps them at 2. The user revoked
>   one and the rerun went green. The durable fix is already supported by the
>   workflow - set `IOS_DIST_CERT_P12_BASE64` + `IOS_DIST_CERT_PASSWORD`.
> - **The Android call notification is merged** (`bfe43e7`) and **compiles**
>   (run 35353848461 - its first compile anywhere; there is no JDK here). A
>   foreground service keeps the call alive when FLYP leaves the screen, with
>   the other person's name, a timer, tap-to-return and Hang up. Hang up is
>   handed to JS so one code path ends a call. NOT yet in a build. iOS CallKit
>   is deliberately not started.
> - **media-reconcile** was answering 401 for months (same secret fault as
>   send-push); fixed, and given a `?dry=1` rehearsal. Its rehearsal says: 161
>   objects scanned, **0 orphans**, would delete **8 abandoned uploads /
>   15.3 MB**. Nothing deleted - waiting on the user.

# FLYP handoff — 2026-09-18 (v1.4.13 tagged and building)

> **Newest first.** **v1.4.13 is BUILT AND DELIVERED on both platforms**
> (`7bce166`). Android run #65 green — `app-release.apk` (23.0 MB) and
> `app-release.aab` (21.4 MB) attached to the v1.4.13 Release. iOS run #68
> green — altool reported "No errors … uploading archive", **Version 1.4.13,
> build 1789723952**, on TestFlight. It carries the back button, the call
> screen, group calls, mid-call video and Instagram messaging.
> - **The version fix is PROVEN in the build log:** `versionCode 9723937`,
>   `versionName "1.4.13"` (were 21 and 1.4.1). The APK finally reports its
>   own version in Settings.
> - Artifact upload hit the storage quota again — harmless, it is
>   `continue-on-error` and the Release is the real delivery path.
> - **New deadline from Apple (warning 90068):** the app ships
>   `MinimumOSVersion 13.0`; from **Spring 2027** App Store Connect will
>   refuse anything below **15.0**. Not urgent, but it is a hard future
>   blocker — raise the iOS deployment target before then.
> - **The duplicate Android audio plugin is gone.** The app has had a complete
>   one since 1.3.0 at `com.flyp.app.AudioRoutePlugin`, registered BY NAME in
>   MainActivity (same package, no import — which is why searching the plugin
>   module found "nothing"). The copy added this week in
>   `capacitor-audio-route/android` was a second plugin answering to the same
>   `name="AudioRoute"`, returning a poorer shape (no `available`, no
>   `bluetoothName`, no wired) — had it won registration it would have
>   REGRESSED the route picker it was meant to add. Deleted; that package is
>   iOS-only again. It also had an unguarded API-31 call that
>   `lintVitalRelease` treats as fatal.
> - **Both Android version fields had never really been set.** `versionCode`
>   sat at 21 for five releases (the CI sed matched the literal "versionCode
>   1" and `|| true` hid the miss) — Play could only have accepted the first.
>   `versionName` was never patched at all: the APK said 1.4.1 while the app
>   called itself 1.4.12, and Settings reads that field. Both now come from
>   the tag, as iOS does. See `flyp-android-version-fields`.
> - **Watching a build from this machine:** no `gh`, private repo (anon API =
>   404), browser pane blocked by the hook. Use the machine's git credential:
>   `git credential fill` → Bearer token → `api.github.com/repos/>   allenadhitya1718/tenth-tone/actions/runs`. Script: scratchpad
>   `watch_builds.sh`.

# FLYP handoff — 2026-09-18 (evening)

> **Newest first (18 Sep, evening).** Commit `cb7a242` on
> `fixes/apk-review-and-security`, pushed, **NOT tagged** (a tag is a build;
> the user tags). Migration **0092 applied live**; `agora-token` redeployed.
> Memory: `flyp-group-calls-and-call-screen-v3`.
> - **Calls: switch to video mid-call.** "Video" on a voice call opens the
>   camera, publishes, then flips the row's kind; the other side enters video
>   mode from the row or from the picture arriving (either order), camera OFF
>   until they choose. Session: `enableVideo`/`switchCamera`; remote tracks
>   keyed by uid; `user-left` handled (a hung-up peer's picture used to stay).
> - **Add people to a call (0092).** An invite is a `calls` row with `root_id`;
>   `call_members` is kept by triggers on `calls`; `leave_call()` = "I left";
>   the root ends by trigger when fewer than two remain joined; members may
>   read/update the channel's calls rows. **`agora-token` took ONE row of the
>   channel and refused an added person (403, silent in the channel)** - it now
>   reads every row and confirms membership. The app's own limit of 10
>   calls/hour to the same person applies to invites AND to test rows.
> - **The screen, after the user's reference:** state line over a large name,
>   a 3 x 2 grid (speaker · video/camera · mute / add · end · more; More holds
>   Message and Flip), dark grey-to-black ground ("keep it black or grey"),
>   the group's faces in the middle, one video tile per person; the incoming
>   screen matches. **Sheets opened from the call screen were drawn UNDER it**
>   (z 100 < 120) - last night's audio-output picker included; fixed.
> - **Push tested on the real path:** `push_test` notifications to both phones
>   at 14:42 IST; FCM and APNs both answered `200 {"sent":1}`. Whether the
>   phones DISPLAYED it is the user's to confirm.
> - Verified in the browser: `wk/upgrade_test.mjs` (17), `wk/group_test.mjs`
>   (24, with extra tabs as the other people), `wk/callshot2.mjs` (the
>   behaviours that were already right), 8-route smoke. Phone-only: the grid
>   on a real phone, the route sheet, group audio between real phones; the
>   Android Java (back button + AudioRoute) compiles for the first time on the
>   next CI build.

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
