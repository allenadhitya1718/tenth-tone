# FLYP: overnight report (6 Nov 2026)

## Verdict
- **The app is ready to submit as an update, on both stores.** Everything below was fixed and tested on the Redmi, and both store builds are made and signed.
- **The submission itself needs you**, because it uses your Apple and Google accounts. It takes about 15 minutes; see "What you do this morning".
- **Not tested:** anything that needs two phones (calls, receiving messages and notifications, live guests). The iPhone was tested only through the store build (it compiles and uploads); nobody has tapped through it.

## Store builds
| | Build | Status |
|---|---|---|
| iPhone | TestFlight **2.0.0 (11)** | Processed by Apple and ready. It contains the new CallKit call screen and notification code, which compiled. It is not in a tester group yet: in TestFlight, add it to "tester" to install it. |
| Android | **flyp-release.aab**, versionCode 100, version 2.0.0 | Signed with the **same upload key** as the app already on Google Play. GitHub → Actions → "Android store build (Play AAB)" → artifact `flyp-release-aab`. |

## Fixed and tested on the Redmi tonight
| # | Problem | Fix | Tested |
|---|---|---|---|
| 1 | Friend's video "not loading" | The file had been deleted from storage (see Storage). The feed now says **"This video isn't available"** instead of a black screen. | Yes |
| 2 | Friend's story "can't view" | Same missing file. The story now shows **"This story is no longer available"** and moves on by itself after 3 s. | Yes |
| 3 | Any screen error closed the whole app | A **recovery screen** ("Something went wrong", with Try again and Go to home) for any screen that fails. | Yes, with a deliberate test crash |
| 4 | Errors in the background could close or freeze the app | The app reloads itself (no crash) and says "Something went wrong" once. | Yes, with a deliberate test crash |
| 5 | Media could be deleted by the old app | FLYP now has **its own storage** (see Storage). | Yes: upload, play, delete |
| 6 | Gifts and wallet showed data | Back to **"Coming soon"**, with no balances, packs, ranking or earnings. | Yes |
| 7 | Group: no way to add members | Like WhatsApp: **every member can add people**, and admins can switch it to "only admins". | Yes |
| 8 | Popups looked unprofessional | Menus now open as a **bottom sheet** (clean rows, Cancel apart at the bottom). Yes/No questions keep the centred card. | Yes |
| 9 | "New story" title sat under the phone clock | Fixed. | Yes |
| 10 | Story camera did nothing | It was frozen by bug 4; it works now. | Yes |
| 11 | "Your story is up" needed an OK tap | Now a short toast at the top with a green tick. | Yes |
| 12 | **Story camera photo lost** on phones low on memory: Android closed FLYP while the camera was open, and FLYP reopened on the feed with no photo. Found while testing; it would happen often on cheaper Android phones. | FLYP now reopens the story screen with the photo in place. The same fix covers the chat camera. | Yes, story camera (FLYP killed while the camera was open). Chat camera not tested: it would send a photo to a real person. |
| 13 | Your own story moved on into a friend's after 5 s, and their heart sits where your delete button is: a tap a moment late **liked their story** (it happened once in testing; I undid it, and no notification was sent). | Like WhatsApp, the viewer closes after your own stories. | Yes |

Also tested and working:
- **Chat mute:** 8 hours / 1 week / always, the bell-off icon in the inbox, and unmute.
- **Live room:** the TikTok-style layout, "1/30 on stage", comments, the end-of-live summary, and "Only me" lives.
- **Story upload and delete** on the new storage.
- **Wallet:** "Coming soon".

## Storage (what happened, and what changed)
- **What happened:** FLYP's videos and photos were in a Cloudflare bucket shared with the old live app. All 6 of FLYP's files were deleted from it, and not by FLYP: our delete log never had them. The old app's key is the likely cause.
- **New bucket:** FLYP now uploads to its own bucket, **`flyp-app-media`**, served at **`cdn.flyp-sa.com`**, with a key that can reach only that bucket. Tested: upload, playback and delete.
- **Security on the new bucket:**
  - TLS 1.2;
  - no public test link;
  - no browser access from other websites;
  - a **rate limit** that blocks an address making more than 300 requests in 10 s;
  - a `nosniff` header, so an uploaded file can't be opened as a web page.
- **The app's own upload checks are unchanged:** sign-in, a quota per person, size and type limits, and 2-minute upload links.

## What you do this morning
0. ~~Send fixes 12 and 13 to the store builds~~ **Done**: published to the "production" channel at your OK. TestFlight 11 and the Play AAB pick them up on first launch.
1. **Google Play** (Play Console → FLYP → Production → Create new release):
   - Upload `flyp-release.aab` from the GitHub run, write the release notes and roll out.
   - If Play rejects the version number, tell me the number it reports and I'll rebuild with a higher one.
2. **App Store** (App Store Connect → FLYP):
   - When build 2.0.0 (11) is ready, add it to the version, fill in "What's New" and submit for review.
   - First, open it from TestFlight on an iPhone and make a call and send a message.
3. **Cloudflare (2 min), so deleted stories and videos disappear instantly:**
   - Create an API token with only **Zone → Cache Purge** for flyp-sa.com.
   - Add Supabase secrets `CF_PURGE_TOKEN` (the token) and `CF_ZONE_ID` (the zone ID from the flyp-sa.com overview page).
   - Until then, a deleted file can still show from Cloudflare's cache for a while.
4. **Delete the old key `flyp-mumbai`** in Cloudflare R2 → API tokens. Keep `flyp-media-token`, because the old live app needs it.
5. **Ask your friend** to re-upload the video and story.
6. **Old app:** find what deletes files in the shared bucket, so it can't delete other things.

## UX findings not fixed yet (recommended)
- The "Something went wrong" toast uses the green success icon; red or neutral would be clearer.
- The live room shows a large empty space while nobody is on stage. A cover photo or a short hint would help.
- The story viewer closes your own story after 5 s, even while you're reading "Seen by". Pausing while that sheet is open would help.

## Tested on
Redmi Note (Android 12), FLYP test build with the latest over-the-air update. Screenshots are on the laptop in `test-results/2026-11-06/` (not committed: the repo is public and they show people's names).
