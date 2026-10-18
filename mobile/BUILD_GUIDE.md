# FLYP mobile: build and release guide (Phase 5)

The React Native app in `mobile/` (Expo SDK 58, RN 0.88). Everything is
built in the cloud with EAS: no Xcode or Android Studio needed.

- Expo account: **allen18**, project **@allen18/flyp**
  (`9a8329f5-b423-4671-8f3d-fd563c113f34`)
- iOS bundle id `com.flyp.social`, Android package `com.flyp.app`
- Version **2.0.0**; build numbers come from EAS (`appVersionSource: remote`)
- Backend: Supabase Mumbai `vfkwipvinmnybilcrdzr`
  (see `../supabase/NEW_PROJECT_MUMBAI.md` and `../supabase/PHASE4_APPLY.md`)

---

## 0. One-time setup on your computer

```bash
cd ~/Documents/tenth-tone/mobile
npm install            # also runs patch-package (vision-camera 16:9 fix)
npx eas-cli@latest login
```

Node 24 (`~/.nvm/versions/node/v24.22.0`). Check the project before any build:

```bash
npx tsc --noEmit && npx expo lint && npx expo-doctor
```

All three must be clean.

## 1. Things that must exist before the first real build

| # | What | Why | Status |
|---|---|---|---|
| 1 | `google-services.json` from Firebase project `flyp-4a726` (Android app `com.flyp.app`) | Android push notifications. Without it the app gets no push token | **Missing**. Download it (Firebase → Project settings → Your apps → Android → google-services.json), put it in `mobile/`, and add `"googleServicesFile": "./google-services.json"` under `expo.android` in `app.json` |
| 2 | Google Maps Android API key | Friends map and profile Map tab on Android | **Missing**. Google Cloud → APIs → Maps SDK for Android → Create key, restrict to `com.flyp.app` + the app's SHA-1 (EAS → Credentials shows it). Add under `expo.android`: `"config": { "googleMaps": { "apiKey": "…" } }` |
| 3 | Supabase project the build talks to | The app falls back to the OLD project if nothing is set | Set the EAS environment variables in step 2 |
| 4 | Over-the-air updates | Ship JS fixes without a store release | Optional. Run `npx eas-cli@latest update:configure` once; it adds `runtimeVersion` and the updates URL |

## 2. Environment variables (point the app at Mumbai)

`src/lib/config.ts` reads `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_ANON_KEY`, falling back to Mumbai's public URL and
publishable key (never the old project; a malformed value stops the app at
startup). `eas.json` sets both for every build profile. To override them
per EAS environment (the anon/publishable key is public, safe in the app):

```bash
npx eas-cli@latest env:create --environment development --name EXPO_PUBLIC_SUPABASE_URL --value https://vfkwipvinmnybilcrdzr.supabase.co --visibility plaintext
npx eas-cli@latest env:create --environment development --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <Mumbai publishable key> --visibility plaintext
```

Repeat with `--environment preview` and `--environment production`. The
publishable key is in Supabase → Project Settings → API Keys.

`EXPO_PUBLIC_AGORA_APP_ID` is optional: the app already has
`8d15ed4d11f84365aea8f1d78ee2c713`, which matches the Agora account.

Until Mumbai has users and videos, a build pointed at it starts empty. Keep
the development build on the old project while testing with real content,
then switch.

## 3. Server side that must be live (Mumbai)

Done already: migrations 0001–0111, functions agora-token, media-upload,
moderate-content, suggest-tags, storage-alert, send-push,
media-delete-queue, verify-purchase. `media-reconcile` stays undeployed and
unscheduled (shared R2 bucket).

Still needed:

1. The internal-secrets command (job_endpoints, alert_config,
   `RECONCILE_SECRET`, `ALERT_SECRET`).
2. Provider secrets in Supabase → Edge Functions → Secrets:
   `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`, `R2_ACCOUNT_ID`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE`,
   `GEMINI_API_KEY`, `FCM_SERVICE_ACCOUNT_JSON`, `RESEND_API_KEY`,
   `ALERT_FROM`; later `APNS_*`, `APPLE_IAP_*`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`.
3. Auth settings, email templates, SMTP and redirect URLs
   (`NEW_PROJECT_MUMBAI.md` §6).

## 4. Development build (testing on a phone)

Includes the dev client, so JavaScript changes load live from your
computer.

```bash
npx eas-cli@latest build --profile development --platform android
```

~15–25 minutes. Install the APK from the link EAS prints (or the QR code).
Then on the computer:

```bash
npx expo start --dev-client
```

With the phone on USB: `adb reverse tcp:8081 tcp:8081`, open FLYP.
`scripts/phone.sh` wraps connect / restart / screenshot / install.

**A new development build is needed whenever native code changes.** Since
the last build these were added: camera filters (Skia, vision-camera
worklets, local `modules/flyp-video-filter`), call pop-ups
(`react-native-notify-kit`, `expo-task-manager`, new `index.js` entry),
coin purchases (`expo-iap`). Until that build is installed, those features
hide themselves.

iOS development build: same command with `--platform ios`. It needs an
Apple Developer account and the device registered
(`npx eas-cli@latest device:create`).

## 5. Preview build (share with the client / testers)

Standalone APK, no computer needed:

```bash
npx eas-cli@latest build --profile preview --platform android
```

## 6. Production builds

```bash
npx eas-cli@latest build --profile production --platform android   # .aab for Google Play
npx eas-cli@latest build --profile production --platform ios       # .ipa for the App Store
```

`autoIncrement` raises the build number each time. Raise
`expo.version` in `app.json` (2.0.0 → 2.0.1 …) for each store release.

Google Play requires target API 36 (the old app hit this in 1.4.24); Expo
SDK 58 already targets it.

## 7. Submitting to the stores

```bash
npx eas-cli@latest submit --platform android --latest
npx eas-cli@latest submit --platform ios --latest
```

The first Android upload must be done by hand in Play Console (internal
testing track); after that `submit` works with a Play service account key.

### Store setup checklist

**Both stores**
- Coin products, consumables, exact ids: `flyp.coins.100`, `flyp.coins.500`,
  `flyp.coins.1200`, `flyp.coins.2500`, `flyp.coins.6500` (prices in
  `PHASE4_APPLY.md`). Apple requires In-App Purchase for coins.
- Privacy policy URL, account deletion (the app has it in Settings →
  Account status), age rating 17+/18+ (location sharing is 18+).

**Google Play**
- **Full-screen intent declaration** (App content): declare FLYP as a calling
  app, or Android 14+ shows calls as a banner instead of full screen.
- Data safety form: location, contacts (none), photos/videos, audio,
  purchase history.
- Foreground service: none used.
- In-app products: activate them after the first upload; add license
  testers.

**App Store Connect**
- Paid Apps agreement, banking and tax active (needed for purchases).
- Push: APNs key (`.p8`) → `APNS_*` secrets; turn on Time Sensitive
  Notifications for `com.flyp.social`.
- In-App Purchase key → `APPLE_IAP_*` secrets.
- **Sandbox purchases during review** (verify-purchase secrets). Reviewers
  and TestFlight buy in the store sandbox, and a sandbox purchase credits
  coins only when BOTH `IAP_ALLOW_SANDBOX=true` AND the buyer's FLYP user id
  is in `IAP_SANDBOX_USER_IDS` (comma-separated uuids). Before submitting:
  create the demo account you give Apple/Google, copy its id from Supabase →
  Authentication → Users, set
  `npx supabase secrets set IAP_ALLOW_SANDBOX=true IAP_SANDBOX_USER_IDS=<uuid>[,<uuid>]`.
  After approval set `IAP_ALLOW_SANDBOX=false` and clear the list. With the
  secrets unset, sandbox purchases are answered `test_account_restricted` and
  nothing is credited.
- Sign in with Apple is enabled in the app; configure it per
  `../APPLE_SIGNIN_SETUP.md`.

## 8. Over-the-air updates (after step 1 #4)

```bash
npx eas-cli@latest update --channel production --message "Fix …"
```

Only JavaScript and assets change this way. Anything that adds a native
library needs a new build and store release.

## 9. Test before each release

1. Sign up with a new email → 6-digit code → profile set-up.
2. Record a video with a filter → post → it appears in For You and on the
   profile; tap it on the profile → opens in the feed.
3. Comments, likes, saves, share, Following / For You / Live tabs.
4. Chat: text, photo, voice note, read ticks; walkie-talkie between two
   phones.
5. Voice and video call between two phones: app open, app in background,
   app closed and phone locked (Accept / Decline on the lock screen).
6. Go live (audio), a second phone requests to speak, host accepts; send a
   gift.
7. Wallet: prices show, buy a package with a test account, coins arrive
   once.
8. Stories: post a photo with a song and a video; another account sees the
   ring and the viewer.
9. Friends map: share location, see a friend, directions.
10. Switch language to Arabic and to Urdu (right-to-left) and back; push
    notifications arrive in the chosen language.
11. Settings → privacy options, block, report, delete account.

## Known limits (as built)

- iOS calls use time-sensitive notifications, not CallKit.
- On a locked Android phone, Accept asks to unlock before the call screen.
- Refunds after coins are credited are not clawed back yet (needs App Store
  Server Notifications / Play voided purchases).
- `media-reconcile` (orphan sweeper) is off on Mumbai until the R2 ledger is
  migrated or a new bucket is used.
