# Past chat summary — Tenth Tone client changes and React Native rebuild

Date: 2026-10-18. Session with Claude Code on the `tenth-tone` repo.

## 1. Context

- **The project:** Tenth Tone, a social video app similar to TikTok. The default language is Arabic (right-to-left), with English also supported.
- **Where it stands:** we built it and delivered it, and the client sent a list of changes.
- **Current stack:**
  - `web/` is the real app: a vanilla-JS PWA with no build step. `web/js/views.js` (about 7,200 lines) holds every screen, `db.js` is the Supabase data layer, `i18n.js` is the Arabic→English dictionary, and `css/app.css` holds the styles.
  - Capacitor wraps `web/` into the iOS and Android apps (`capacitor.config.json` has `webDir: "web"`).
  - Supabase is the backend: Postgres with row-level security, auth, storage, realtime, plus the `supabase/migrations/0001–0040` files and the `agora-token` Edge Function.
  - Agora handles live streaming and calls.
  - `flutter/` holds an older, partial Flutter rewrite (27 screens, mock data only). It is not used.

## 2. Client notes (translated from the Arabic PDF, plus 26–31)

1. The app can only be found in the App Store and Play Store by searching in English. It should be findable in Arabic too. (This is store-listing metadata: localized Arabic title and keywords. It is not code.)
2. Tapping **+** to record or upload a video: the upload never finishes, and the video can't be published or saved as a draft.
3. Recording has no zoom and no filters, and video quality is poor.
4. Live streams show camera and background options, but the agreement was **audio-only** live.
5. The live stream screen layout is uneven once a stream starts.
6. The host can't add a person or guest to the live stream.
7. The share arrow doesn't share the live stream.
8. Comments: the keyboard closes after tapping send.
9. Emoji: there is no picker with multiple options.
10. Messages: the chat background needs patterns or drawings, the keyboard closes after send, and there are no sent/delivered/read ticks like WhatsApp.
11. There are too many annoying notifications on the lock screen. They should behave like WhatsApp's.
12. It isn't clear how to top up the wallet balance.
13. Privacy: "Who can message me", "Who can comment" and "Who can tag me" need **Friends** and **Everyone** options.
14. Only Arabic and English are available. The client wants Chinese, Hindi and other common languages.
15. Settings: after opening an item and going back, the list jumps to the top. It should keep the scroll position.
16. Friends map: friends aren't clearly visible, and the client wants a custom marker icon or shape.
17. Live gifts: the agreed gifts (horse, camel, etc.) haven't been added.
18. Dark mode should be **dark navy**, matching the logo.
19. Double-tapping the screen while recording should switch between the front and back cameras.
20. A short vibration (haptic) when recording starts.
21. When posting a video or photo: add a location and tag users or friends.
22. Add a song to a photo when posting it as a story/status.
23. Generate hashtags automatically from the photo's content using AI, plus location tagging.
24. The home tabs (Following / For You / Live) should switch by **swiping**, not only by tapping.
25. Add Stories/Status where video is allowed.
26. Voice messages should be **live**, playing instantly as soon as the button is pressed (walkie-talkie style).
27. Add tracking and follow-along navigation, such as following a friend on the map and getting directions to them.
28. Profiles should also show **audio clips and maps**, not only videos.
29. The emoji bar doesn't close when tapping elsewhere.
30. Searching for a user with "@" returns no results.
31. Videos are limited to Stories only. (Ambiguous.)

**Decision:** the video feed **stays as it is**, and nothing is removed. Notes 25, 28 and 31 mean adding Stories with video and adding Audio and Map tabs to profiles.

## 3. Findings from reading the code (root causes)

- **Note 30:** `API.searchProfiles` / `searchAll` in `db.js` search for `%@name%`, but handles are stored without the "@". The fix is to strip a leading "@" before searching.
- **Note 26:** the existing walkie-talkie sends 250 ms MediaRecorder WebM chunks over Supabase broadcast and plays each one as its own Blob. Only the first chunk has a WebM header, so live playback is effectively broken. It needs real PCM or native audio streaming.
- **Notes 8 and 10:** the inputs lose focus on send. Focus must be kept on the input after sending.
- **Note 13:** in `user_settings` (migration 0027), the check constraints only allow `everyone`, `following` and `nobody`. Adding `friends` needs a migration and an update to `may_message` / `may_comment_on`.
- **Note 4:** `V.liveStart` has Camera and "Background only" modes. Agora `startHost` publishes the mic and camera.
- **Note 17:** the gifts tables and the `send_gift` RPC exist (migrations 0001 and 0017), but there is no gift UI in the live viewer.
- **Note 12:** there is no wallet screen in the web app, even though the wallet tables exist.
- **Note 11:** there is no real native push setup. The `push_tokens` table exists but is unused.
- **Notes 3, 19 and 20:** the camera uses `getUserMedia` + `MediaRecorder` in the WebView. Zoom, filters, timer and flash are placeholder toasts.
- **Note 2:** uploads compress in the browser (`compress.js`) before uploading to Supabase storage, which is slow and fragile on phones.
- **Notes 21 and 23:** "Tag people" and "Add location" on the publish screen are just "under development" toasts.
- **Note 24:** the home tabs are plain buttons, with no swipe pager.
- **Note 18:** dark mode toggles `body.dark`. The colours need changing to a dark navy palette.
- **Note 14:** `i18n.js` is an exact-match Arabic→English dictionary of about 1,500 strings.

## 4. Decisions so far

- **Rebuild the whole app in React Native with Expo.** The user feels the Capacitor/WebView app isn't smooth enough. Claude recommended fixing the notes in Capacitor first and rebuilding later; the user chose to rebuild.
- **Keep the same Supabase backend** (database, migrations, storage, Agora token function). Only the app is rebuilt.
- **Build the client notes 1–31 into the new app.**
- **Defaults chosen for the open questions** (the user had no preference):
  - **Wallet:** a full wallet screen with balance, coin packages and history. Top-up goes through a server hook that's ready for a payment provider. Note that iOS requires in-app purchase for coins.
  - **Languages:** Chinese, Hindi, Urdu, French, Spanish, Turkish and Indonesian, on top of Arabic and English.
  - **Database:** write SQL migration files for the user to apply in the Supabase SQL editor. Do not touch the live database directly.
- **Rough timeline Claude gave:** writing the code is a few long sessions. Realistically it's 3–5 weeks of calendar time including device testing, EAS builds, store signing and review.

## 5. Proposed React Native plan (not started)

- **Location:** a new `mobile/` folder in this repo, using Expo SDK 58, expo-router and TypeScript. `web/` stays until the new app replaces it.
- **Libraries:**
  - `@supabase/supabase-js` with AsyncStorage
  - `react-native-vision-camera` for zoom, filters, double-tap flip and quality
  - `expo-video` for the feed
  - `react-native-pager-view` for the swipeable home tabs
  - `expo-audio` for voice messages
  - `react-native-agora` for audio-only live and calls
  - `react-native-maps` for the friends map
  - `expo-notifications`, `expo-haptics`, `expo-location`, `expo-image-picker`
  - i18next for translations, with RTL support
- **Builds:** this machine has no Android SDK, so device builds go through **EAS Build**. Agora and vision-camera need a dev build, not Expo Go.
- **Phases:**
  1. Foundation: Supabase client, auth, theme (navy dark mode), i18n and RTL, navigation.
  2. Port the `db.js` API to TypeScript.
  3. Screens in batches: auth and onboarding → feed with swipeable tabs → camera, editing and publish → chat with live voice and read receipts → profile with Videos, Audio and Map tabs → live (audio-only, guests, gifts) → map with tracking and directions → settings and privacy → wallet → Stories.
  4. A database migration for the new features: friends privacy option, read receipts, Stories, gifts, wallet top-up, and tags and location on posts.
  5. Build and run guide.

## 6. Current state

- No app code has been changed.
- A fresh, empty Expo starter was created at `tenth-tone/mobile/`, with nothing installed. It was **not pushed**; it exists only on the first laptop. The user asked Claude to stop before any real work started.
- **Next step:** confirm the plan above, then start Phase 1.
