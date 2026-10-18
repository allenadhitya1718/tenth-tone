# FLYP: handover for the testing Claude

You are the **tester** for **FLYP**, a TikTok-style social app for Saudi users
(short videos, audio live rooms, chat, calls, walkie-talkie, stories, gifts,
friends map). It was just rebuilt from an old Capacitor web app into **React
Native (Expo SDK 58, RN 0.88)** on a new **Supabase** backend.

**Your job:** install the app on Android emulators, then go through the whole
test plan **yourself, the way a real person would**: tap, type, swipe, record,
wait, read the screen. Record every result in the checklist page. Don't change
the app's code, the database or any service settings. Report bugs; Allen's own
Claude fixes them afterwards.

## 1. What to test against

**Test plan and results page:** https://claude.ai/artifact/PNwrbXALa9DTBtgE7FWNGz
- About 190 checks in 20 sections. Each has *what to do* and *what should
  happen*.
- Mark each one **Pass / Fail / Blocked** and write a note for every Fail or
  Blocked. Results save live and Allen sees them.
- Your account needs **Contributor** access (Allen shares it).
- If you can't click the page yourself, keep the same IDs (e.g. `FEED-04`) in
  a results file and give it to the human to enter.

**Repo:** https://github.com/allenadhitya1718/tenth-tone, branch
`feat/rn-phase1-foundation`. Useful when a result is unclear:
- `mobile/src/app/`: one file per screen.
- `mobile/src/features/`: the feature code.
- `mobile/BUILD_GUIDE.md` and `SECURITY_AUDIT.md`: intended behaviour and
  deliberate restrictions.

## 2. Get the app

Download the latest **flyp-test-apk** artifact from GitHub → Actions →
"Android test build" (branch above):

```bash
gh run download --repo allenadhitya1718/tenth-tone -n flyp-test-apk
```

- The APK contains **x86_64 and arm64**, so it runs on a standard x86_64
  emulator and on real phones.
- It's a standalone test ("preview") build: install and open, no computer
  or Metro server needed.
- Package `com.flyp.app`, version 2.0.0.

## 3. Emulator set-up

- **Two emulators (A and B):** many checks need two users (chat, ticks, calls,
  walkie-talkie, live guests, follows, push). Run two AVDs side by side.
- **Image:** Android 14 (API 34) **"Google Play"** x86_64 system images, so
  Google Play services (push notifications) and the Play Store (purchases)
  exist. Give each 4 GB RAM.
- **Install:** `adb -s emulator-5554 install flyp-test.apk` (and 5556 for B).
- **Camera:** set the AVD's back camera to **VirtualScene** or **Webcam0**
  so recording works.
- **Microphone:** enable the host mic in the emulator's extended controls,
  for voice notes, calls and live.
- **Location:** use the emulator's extended controls → Location (e.g.
  Riyadh 24.7136, 46.6753) for the friends map; give A and B different
  points.
- **Ways to act like a human:**
  - `adb shell input tap/swipe/text/keyevent`
  - `adb exec-out screencap -p > s.png` to see the screen
  - `adb shell uiautomator dump` to find elements
  - Or computer-use / Maestro if you have them.

  Always look at the screen after each action and judge it as a person
  would: is it readable, does it respond, does it look right?
- **Accounts:** sign up two **new** accounts with real inboxes you can read
  for the 6-digit codes (sender `no-reply@notify.flyp-sa.com`; check Spam).
  Both 18+ (location sharing is 18+). The backend is brand new, so no old
  accounts exist.

## 4. What emulators can't fully do

Mark these **Blocked** with the reason rather than Fail:
- **Real lock-screen ringing:** you can test it by locking the emulator
  (`adb shell input keyevent 26`), but full-screen intent behaviour can differ
  from real phones.
- **Coin purchases:** need the coin products in Google Play Console and the
  emulator's Google account added as a license tester. Until Allen confirms
  that, Blocked.
- **Realistic camera quality, battery, heat:** note "emulator" in the result.
- **iPhone-only checks** (Sign in with Apple): Blocked (Android only).

## 5. Backend and services (read-only for you)

- Supabase project "Mumbai" `vfkwipvinmnybilcrdzr`. Don't use any
  admin/service keys and don't change data except through the app.
- The old project `qnzgxihlrwanywndcmpf` is off-limits.
- Agora (live, calls, walkie-talkie), Cloudflare R2 (media), Gemini
  (moderation, AI hashtags), Firebase (push), Resend (emails).

## 6. Known behaviour (not bugs)

- **Stories:** there's **no button to post a story** right now (the feed's
  story tray was removed on request). Record this in Stories, check 1; the
  rest of Stories is Blocked unless you find an entry point.
- **Calls:** a first call to a stranger is refused (security). Calls need an
  existing relationship such as a chat or a follow.
- **"Friends" means a mutual follow:** that applies to location, friends-only
  lives and privacy settings.
- **Rate limits:** messages, comments, follows and uploads have per-user
  limits. If you hit one while testing fast, note it; that's expected.
- **Languages:** 9 languages (ar, en, zh, hi, ur, fr, es, tr, id). Arabic and
  Urdu restart the app into right-to-left.

## 7. Bug notes

For every Fail, the note must contain: **steps → expected → actual →
emulator A/B + API level → account → how often (e.g. 3/3)**. Save a
screenshot for each Fail with its check ID in the filename (e.g.
`CHAT-07.png`) and mention it in the note. For crashes, include
`adb logcat -d | grep -E "ReactNativeJS|AndroidRuntime" | tail -50`.

Work section by section in the page's order. At the end, write a short
summary: totals, the worst problems first, and anything you couldn't test and
why.
