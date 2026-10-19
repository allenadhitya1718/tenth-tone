# Client notes 1-31: verification against the React Native app

Branch `feat/rn-phase1-foundation`, working tree as of 2026-10-19 (including the uncommitted wallet/payout files). This was a read-only check: nothing was built or run on a device and no server was called. "DONE" means the code is there and wired into the UI. Paths are relative to the repo root; `m/` = `mobile/src/`, `sql/` = `supabase/migrations/`, `fn/` = `supabase/functions/`.

Verdicts: **DONE**, **PARTIAL**, **MISSING**, **excluded (wallet)**, **NEEDS CLARIFICATION**.

## Summary table

| # | Request (plain words) | Verdict | Key evidence | Gap / fix size |
|---|---|---|---|---|
| 1 | App findable in the stores by Arabic search | MISSING (store metadata) | `store-assets/LISTING.md:12-16` has the title `FLYP` only | No Arabic title or keywords. S (not code) |
| 2 | Upload finishes; can publish or save a draft | PARTIAL | `m/api/upload.ts:76-93`, `m/features/publish/PublishScreen.tsx:84-123,204-213` | You can save a draft but never post it later: `publishDraft` (`m/api/videos.ts:483`) is not called anywhere in the UI. S |
| 3 | Recording: zoom, filters, quality | DONE | `m/features/camera/CameraScreen.tsx:79,151-153,258,375-390`; filters `filters.ts`, `FilteredCamera.tsx`, `videoFilter.ts` | Caveat: "Beauty" only changes colour; it does not smooth skin |
| 4 | Live is audio-only | DONE | `m/features/live/GoLive.tsx:19-22`, `useAgoraAudio.ts:197-223` | — |
| 5 | Live layout even | DONE (needs a device check) | `m/features/live/LiveRoom.tsx:482-646`, `Stage.tsx` | Look at it on a small phone |
| 6 | Host adds a guest to the live | DONE | `LiveRoom.tsx:216-239,656-699`, `StageManager.tsx:23-58`, `sql/0103_live_guests.sql`, `fn/agora-token/index.ts:246-259` | — |
| 7 | Share arrow shares the live | PARTIAL | `LiveRoom.tsx:426-440`, `m/features/live/config.ts:11-12` | The share sheet works, but the link `https://flyp-sa.com/live/<id>` does not open the app: there are no intentFilters or associatedDomains, the `.well-known` files hold placeholders, and the site has no `/live/*` page. M |
| 8 | Comments: keyboard stays open after send | DONE | `m/features/comments/CommentsSheet.tsx:77-85,143-160`; live chat `LiveRoom.tsx:249-254,586-590`; chat `Composer.tsx:104-116,236-240` | — |
| 9 | Emoji picker with many options | DONE | `m/components/emoji/EmojiPanel.tsx:24-57`; used in `CommentsSheet.tsx:139-175`, `Composer.tsx:306-311`, `MessageMenu.tsx:61-90` | Live chat has only the 6-emoji reaction tray (by design) |
| 10 | Chat: patterned background, keyboard stays open, WhatsApp ticks | PARTIAL | Background `ChatBackground.tsx`; keyboard `Composer.tsx:104-116`; ticks `MessageBubble.tsx:212-222`, `m/api/chat.ts:15-21,354+`, `sql/0099` | Two grey ticks appear only while the recipient's app is open. If their app is closed, the sender sees one tick until they open it. M |
| 11 | Fewer, WhatsApp-like lock-screen notifications | PARTIAL | `fn/send-push/index.ts:209-220,285-310,510-519`; channels `m/features/notifications/push.ts:134-180`; dedupe `sql/0121` | Messages collapse per chat with a count. Likes, comments and follows are silent but still one notification each, with no grouping or summary. S-M |
| 12 | Wallet top-up unclear | excluded (wallet) | — | — |
| 13 | Privacy: Friends / Everyone for message, comment, tag | DONE | `m/features/settings/WhoCanScreen.tsx:16`, `sql/0097_friends_privacy.sql`, kept in `sql/0112:242`, `sql/0122:115,156` | — |
| 14 | More languages | DONE | `m/i18n/index.ts:132-142` (9 languages, RTL for ar/ur), `LanguageScreen.tsx`, `fn/send-push/strings.ts:8` | Minor: iOS `CFBundleLocalizations` lists only ar and en (`mobile/app.json`). Untranslated keys are wallet-only (excluded) |
| 15 | Settings keeps its scroll position after going back | DONE | Native stack `m/app/(app)/_layout.tsx:25`; rows `router.push` (`m/features/settings/components.tsx:22`) | — |
| 16 | Friends map: friends clearly visible, custom marker | DONE | `m/features/map/AvatarMarker.tsx:34-95`, `FriendsSheet.tsx`, `LocationConsent.tsx` | UX: the map opens only from Settings (`SettingsHome.tsx:74`). S |
| 17 | Live gifts incl. horse, camel | DONE | `m/features/live/Gifts.tsx:41-68`, `LiveRoom.tsx:311-360,630-654`, `sql/0104:117-125` | Sending needs coins (the wallet is out of scope) |
| 18 | Dark mode = dark navy | DONE | `m/theme/colors.ts:32-56` (`#000421`) | — |
| 19 | Double-tap flips the camera while recording | PARTIAL / NEEDS CLARIFICATION | `CameraScreen.tsx:109-116,154` | Double-tap works before recording but is **ignored during recording** (`if (recording) return`). L for a true mid-recording flip |
| 20 | Haptic when recording starts | DONE | `CameraScreen.tsx:207` (start), `:198` (stop) | — |
| 21 | Location + tag people when posting | MISSING (UI) | Backend done: `sql/0101`, `m/api/videos.ts:91-105,180-190`, `m/api/tags.ts:54-77`. The UI says so itself: `PublishScreen.tsx:30-32` ("no place picker yet"); `publish.tsx` passes no place or tags | No place picker, no people picker, nothing shown on the post. M |
| 22 | Song on a photo story | DONE | `m/features/stories/StoryComposer.tsx:153-189,301-326,400`, `SoundPicker.tsx`, `StoryViewer.tsx:150-195` | — |
| 23 | AI hashtags from the photo, plus location | PARTIAL | `PublishScreen.tsx:266-370` (on-demand button `:301-312`), `StoryComposer.tsx:293-296`, `m/api/suggestTags.ts`, `fn/suggest-tags`, `sql/0107` | AI part done. The location half never fires because `place` is always null (see 21). Solved by 21 |
| 24 | Home tabs switch by swiping | DONE | `m/features/feed/HomeFeed.tsx:45-62` (PagerView, RTL-aware) | — |
| 25 | Stories with video | DONE | `StoryComposer.tsx:101-140`, `sql/0102_stories.sql:114,242`, `ProfileStoryAvatar.tsx`, camera switch `CameraScreen.tsx:408-427` | Caveats: Story mode only picks from the gallery (no in-camera capture). With the home tray gone, you see friends' stories only by opening their profiles. S-M |
| 26 | Live walkie-talkie voice | DONE | `m/features/chat/walkie/useWalkie.ts`, `PushToTalkButton.tsx`, `Composer.tsx:243-256,281-291`, `sql/0106`, `fn/agora-token/index.ts:149-189` | It works only when both people have the chat open (nothing is stored). Expected |
| 27 | Follow a friend on the map + directions | DONE | `m/features/map/FriendCard.tsx:34-36,67,123-129`, `geo.ts:33-52`, `FriendsMap.tsx:177`, tracking permits `MapSettingsSheet.tsx:185-210` | — |
| 28 | Profile shows audio clips and maps | PARTIAL / NEEDS CLARIFICATION | Tabs `m/features/profile/ProfileView.tsx:43-55,133-148`; audio `m/api/sounds.ts:140-149`; map `ProfilePlacesMap.tsx`, `m/api/tags.ts:144` | The Map tab is always empty because no post can carry a place (21). The Audio tab only lists auto-made "original sounds" of public videos; there is no way to post an audio clip |
| 29 | Emoji bar closes when tapping elsewhere | PARTIAL | Chat ok `ChatThread.tsx:343-344`; live tray ok `Reactions.tsx:102-108`; message menu ok `MessageMenu.tsx:50`; comments `CommentsSheet.tsx:123,132-136` | Comments: tapping a comment or the empty list does **not** close the panel (the inner Pressable takes the touch). Only scrolling, focusing the field or the toggle closes it. S |
| 30 | Search with "@" finds people | DONE | `m/api/search.ts:10-12,48-51`, `sql/0098_search_strips_at.sql:54` | — |
| 31 | "Videos limited to Stories only" (ambiguous) | NEEDS CLARIFICATION | Read as "stories support video" = 25 (DONE) | Confirm the meaning with the client |

### Two app bugs found earlier

| Bug | Verdict | Evidence | Fix |
|---|---|---|---|
| (a) A deactivated account reactivates on sign-in | **MISSING (bug confirmed)** | `reactivateAccount()` (`m/api/settings.ts:490`) is never called. Nothing in `m/lib/auth.ts` or `m/providers/AuthProvider.tsx` checks the account status at sign-in. The UI promises it: `settings2.en.json:220,222` ("Just sign in again to reactivate it"), `:233` (sign-in cancels deletion). `AccountStatusScreen.tsx:88-96` only offers "Keep" for a scheduled deletion and has no Reactivate for a plain deactivation | S |
| (b) The terms promise an appeal in Settings → Account status | **MISSING** | `site/terms.html:434` (already in HEAD). `AccountStatusScreen.tsx` has only deactivate/delete. No "appeal" anywhere in `mobile/src`, `supabase/migrations` or admin-v2 | M (L with the admin queue) |

---

## Per-note detail

### 1. Arabic store search: MISSING (not code)
- **Evidence:** `store-assets/LISTING.md:12-16` gives the app name `FLYP` only. The descriptions are Arabic, but there is no Arabic title, iOS subtitle or keyword set. `mobile/app.json` `name: "FLYP"` has no localized display name. The listing is also stale: lines 7-8 say filters were removed, but the app has them again.
- **Fix (S):** set the Play `ar` title to something like "FLYP - فلايب: فيديو وبث مباشر" and add an App Store `ar` subtitle and keywords (فلايب، فيديو، بث مباشر، دردشة…). Optionally set the localized `CFBundleDisplayName` for ar through an Expo `locales` file. Update LISTING.md to match the current features.

### 2. Upload and drafts: PARTIAL
- **Done:** a native background-capable upload (`File.createUploadTask`, `m/api/upload.ts:87-93`) with real progress (`PublishScreen.tsx:98,193-201`). On failure, an alert offers Retry and keeps everything on screen (`:108-119`). Save draft uses the same path (`:204-212`). Moderation runs in parallel (`m/api/videos.ts:131-160`).
- **Missing:** a saved draft can never be published. `publishDraft()` exists (`m/api/videos.ts:483`) but nothing in `m/features` or `m/app` calls it. A draft tile (`ProfileView.tsx:118`) opens `/video/<id>`, which plays it in the For You feed as if it were posted, with no "Post" or "Delete draft" action.
- **Fix (S):** in `ProfileView.tsx`, when `tab === 'drafts'`, open an action sheet on tile press: "Post now" calls `publishDraft` and invalidates drafts and userVideos; also "Preview" and "Delete". Optionally route to a light publish screen to edit the caption first.

### 3. Zoom, filters, quality: DONE
- Pinch zoom (`CameraScreen.tsx:151-153`, works during recording too). 0.5x/1x/2x chips (`:258,375-390`, 0.5x only on lenses that support it), and the active chip shows the live value.
- 1080p: `useVideoOutput` defaults to `FHD_16_9` (vision-camera `useVideoOutput.ts:39`), 6 Mbps H.264 (`:34,79`), 30 fps, stabilization off so the frame is not cropped (`:80-90`). The preview uses `resizeMode="cover"` with the format chosen for the video. The filtered preview runs at 720p (`FilteredCamera.tsx:50`); the file stays 1080p.
- Instagram-style looks: 12 colour matrices (`filters.ts:13-26`), a swipe on the preview and a strip (`CameraScreen.tsx:136-146,339-374`), and the same look baked into the file natively (`videoFilter.ts`, `mobile/modules/flyp-video-filter`).
- Caveats for a hand test: filters appear only in a binary that includes the native module (`videoFilter.ts:18`; an older APK shows no strip). "Beauty" is a colour matrix, not skin smoothing.

### 4. Audio-only live: DONE
`GoLive.tsx:19-22` (no camera). Agora: `enableAudio(); disableVideo()`, `publishCameraTrack: false`, `autoSubscribeVideo: false` (`useAgoraAudio.ts:197-223`).

### 5. Live layout: DONE (needs a device check)
Header, stage grid, chat over a gradient, and an action bar (`LiveRoom.tsx:482-646`, `Stage.tsx`). Not checked on a small screen.

### 6. Guests on live: DONE
Viewers can raise a hand and request (`LiveRoom.tsx:216-233,614-628`). The host can invite (`:379,666`) and use the stage manager (`StageManager.tsx`). Invite sheet `:674-699`. Up to 4 guests (`config.ts:19`). The publisher token is granted only to accepted guests (`fn/agora-token/index.ts:246-259`). Push for invites (`fn/send-push/index.ts:179,263-266`).

### 7. Share the live: PARTIAL
- **Done:** `Share.share` with the live URL, without leaving the room (`LiveRoom.tsx:426-440`).
- **Missing:** the recipient cannot open the shared link in the app. `mobile/app.json` has no `android.intentFilters` (autoVerify) and no `ios.associatedDomains`. `site/.well-known/assetlinks.json` contains `REPLACE_WITH_RELEASE_SIGNING_SHA256_FINGERPRINT`, and `apple-app-site-association` contains `REPLACE_WITH_TEAMID.com.flyp.app`, which is also the wrong bundle id: iOS is `com.flyp.social`. The site has no `/live/*` page, so the link lands on `404.html`.
- **Fix (M):** add `intentFilters` for `https://flyp-sa.com` paths `/live`, `/v`, `/u` with `autoVerify: true`, and `associatedDomains: ["applinks:flyp-sa.com"]`. Fill in the real SHA-256 (from the EAS credentials) and `TEAMID.com.flyp.social`. Add a site fallback for `/live/*` (and `/v/*`, `/u/*`) that tries `flyp://live/<id>` and shows store buttons.

### 8. Keyboard stays open after send: DONE in all three places
- Comments: `submit()` refocuses (`CommentsSheet.tsx:77-85`); `submitBehavior="submit"` (`:156`); the send button is not inside a ScrollView.
- Live chat: `LiveRoom.tsx:249-254` refocuses; `:587-588`.
- Chat: `Composer.tsx:104-116` refocuses; `submitBehavior="submit"` (`:236`).

### 9. Emoji picker: DONE
A categorized panel replaces the keyboard (`EmojiPanel.tsx:24-57`) with a quick row (`:9-19`). Comments `CommentsSheet.tsx:139-142,175`; chat `Composer.tsx:218-227,306-311`; message reactions `MessageMenu.tsx:61-90`. Live chat has no picker (reaction tray only), which matches the design.

### 10. Chat background, keyboard, ticks: PARTIAL
- **Done:** a patterned doodle wallpaper that follows the theme (`ChatBackground.tsx:13-56`). Keyboard as in 8. Ticks: clock while pending, then ✓ sent, ✓✓ grey delivered, ✓✓ blue read (`MessageBubble.tsx:212-222`), driven by `last_delivered_at`/`last_read_at` (`sql/0099`, `m/api/chat.ts:15-21,354+`).
- **Gap:** "delivered" is stamped only when the recipient's app is running: a realtime insert (`chat.ts:800-806,846`), the inbox load (`:208`), or opening the thread (`useThread.ts:90,105`). The push background task handles calls only (`m/features/call/background.ts:153-176`). So when the recipient's app is closed, the sender sees one tick until they open the app, unlike WhatsApp.
- **Fix (M):** in `background.ts` `onPush`, call `markChatDelivered(chat_id)` when `type === 'message'`. On Android that needs message pushes sent data-only and drawn locally (notify-kit), because the JS task does not run for FCM notification messages in the background. On iOS, add `content-available: 1` (best-effort) or a Notification Service Extension. Files: `fn/send-push/index.ts` (fcmNotification/apnsAlert for messages), `m/features/call/background.ts`, `m/features/notifications/push.ts`.

### 11. Calmer notifications: PARTIAL
- **Done:** Android channels, with social set to LOW importance, no sound and no vibration (`push.ts:157-166`). Messages: per-chat `tag`/`collapse_key`/`thread-id` and "N messages" (`fn/send-push/index.ts:209-220,298-308,510-519`). No sound for social on iOS (`:306`). Repeat like/follow notifications deduped for 24 h (`sql/0121`). Messages hidden in front of the open chat (`push.ts:100-102`). Lock-screen privacy (`:146`).
- **Gap:** each like, comment and follow from a different person is still a separate notification on the lock screen, with no grouping or summary ("Sara and 4 others liked your video") on either platform.
- **Fix (S-M):** in `compose()` set `group` for social types (for example `likes_<video_id>`, `comments_<video_id>`, `follows`) so Android replaces via `tag` and iOS stacks via `thread-id`. Count unread notifications of the same group the way it is done for messages (`:510-519`) and use a plural title. Add `thread-id` for all social pushes even without a count. Strings go in `strings.ts`.

### 12. Wallet top-up: excluded (wallet)

### 13. Friends / Everyone privacy: DONE
Everyone / Friends (mutual follow) / Nobody (`WhoCanScreen.tsx:13-16`); legacy "following" is kept for old accounts. SQL: the constraints and `is_friend` (`sql/0097:82-122`), `may_comment_on` (`sql/0122:115`), `may_message` (`sql/0112:242`), tag check (`sql/0122:156,187`; `sql/0101` `check_video_tag`).

### 14. More languages: DONE
Nine languages (`m/i18n/index.ts:132-142`), with RTL switching for ar and ur (`:163-182`), the settings picker (`LanguageScreen.tsx:43`), the pre-login switch (`m/components/LanguageSwitch.tsx`) and push text in 9 languages (`fn/send-push/strings.ts:8`). A key diff shows only `live.wallet.*` (excluded) and plural variants missing.
- Minor (S): `mobile/app.json` `CFBundleLocalizations: ["ar","en"]`. Add the other 7 so iOS Settings → FLYP → Language lists them.

### 15. Settings scroll kept: DONE
Settings is a stack screen and items `router.push` (`components.tsx:22`), so the list stays mounted with its ScrollView offset. Device check recommended.

### 16. Friends map: DONE
Avatar pins with a coloured status ring, a name label and a pointer (`AvatarMarker.tsx:34-95`); a bigger pin when selected or for me. A friends list sheet (`FriendsSheet.tsx`), consent before sharing (`LocationConsent.tsx`, `FriendsMap.tsx:101,157`), and a dark map style (`mapConfig.ts`).
- UX (S): the map is reachable only from Settings → Privacy → Map (`SettingsHome.tsx:74`). Add an entry on the Inbox header or the profile, where a tester would look.

### 17. Gifts: DONE
Gift tray, recipients (host and guests), animated banner and realtime for everyone (`Gifts.tsx`, `LiveRoom.tsx:311-360,630-654`). Horse 🐎 and camel 🐪 plus dates, dallah and falcon are seeded (`sql/0104:117-125`). Sending depends on coin balance (wallet, excluded).

### 18. Dark navy: DONE
`colors.ts:32-56`: bg `#000421`, cards `#0A1236`/`#121C4A`, tab bar navy, and a "system/light/dark" choice (`SettingsHome.tsx:110-114`).

### 19. Double-tap flip while recording: PARTIAL / NEEDS CLARIFICATION
- Double-tap anywhere flips (`CameraScreen.tsx:154`), with haptics (`:112`). But `flip()` returns early while recording (`:109-111`, "Switching lenses mid-recording would end the recorder's session"). The flip button is also disabled while recording (`:313`).
- If the client means literally *during* a recording (TikTok-style), it is missing. **Fix (L):** segmented recording: stop the current segment on flip, start a new one on the other lens, then concatenate natively (extend `modules/flyp-video-filter` with a concat). Otherwise confirm that "on the record screen" is enough.

### 20. Haptic on record: DONE
Medium impact on start (`CameraScreen.tsx:207`), light on stop (`:198`).

### 21. Location + tag people when posting: MISSING (UI only)
- Backend ready: `videos.place_name/lat/lng`, `video_tags` with the who_can_tag/block trigger and notifications (`sql/0101`). The API accepts `place` and `tags` (`m/api/videos.ts:91-105,165-190`), `addVideoTags` (`m/api/tags.ts:54`), `fetchVideoTags` (`:89`).
- The UI has none of it: `PublishScreen.tsx:30-32` says "There is no place picker on this screen yet". The `@` chip only inserts the text "@" (`:158`). `publish.tsx` passes neither. `VideoCard.tsx` never shows a place or tagged people. The story composer has neither.
- **Fix (M):** (1) An "Add location" row in `PublishScreen.tsx` that uses expo-location (already a dependency, with a when-in-use permission) for the current position, plus `reverseGeocodeAsync` or a place search, into `place` state. (2) A "Tag people" row with a modal picker using `searchHandles`/following; pass `tags` to `publishVideo`, then show `tagRefusals` in a toast. (3) Show "📍 place" and "with @a, @b" in `m/features/feed/VideoCard.tsx`; a tap on the place opens the map. (4) Optionally the same in `StoryComposer.tsx`. New i18n keys in all 9 languages.

### 22. Song on a photo story: DONE
Sound picker for photos with a start offset (`StoryComposer.tsx:153-189,301-326,400`); the viewer plays it from `sound_start_ms` for 15 s (`StoryViewer.tsx:48,150-195`).

### 23. AI hashtags + location: PARTIAL
- On-demand "Suggest hashtags" button (`PublishScreen.tsx:286-312`) with a skeleton, rate-limit message and tap-to-append (`:314-368`). Also on stories (`StoryComposer.tsx:293-296`). Edge Function `fn/suggest-tags` with a limit (`sql/0107`).
- The location half: `placeTag` is only produced when `place` is passed (`:166`), and it is always null (note 21). It is fixed by 21 with no extra work.

### 24. Swipeable home tabs: DONE
`HomeFeed.tsx:45-62` (PagerView, RTL layoutDirection, haptic on page change; the tabs also respond to taps).

### 25. Stories with video: DONE
Photo or video up to 60 s (`StoryComposer.tsx:39,120-140`), 24 h expiry set by the database (`sql/0102:114,242`), a cron purge, viewers sheet, close friends ring, and posting from the profile photo "+" (`ProfileStoryAvatar.tsx`) and the camera's Video|Story switch (`CameraScreen.tsx:408-427`).
- Caveats a tester will notice (S-M): Story mode does not use the camera; it opens a gallery chooser (`StoryComposer.tsx:123`). Consider `launchCameraAsync` or reusing CameraScreen in story mode. With the tray removed (an agreed decision), others' stories are visible only from their profile avatar; also ringing avatars in the feed (`VideoCard.tsx`) would help discovery.

### 26. Walkie-talkie: DONE
Push-to-talk over a per-chat Agora channel (`useWalkie.ts:33-45`), a toggle in the composer (`Composer.tsx:243-256`), the hold button (`PushToTalkButton.tsx`), a "X is talking" banner (`WalkieBanner.tsx`), and server membership checks (`sql/0106`, `fn/agora-token/index.ts:149-189`). The normal voice note is still there. It works only while both people have the thread open in the foreground (by design: nothing is stored).

### 27. Follow a friend + directions: DONE
Follow mode keeps the camera on the friend (`FriendCard.tsx:123-127,143-145`; `FriendsMap.tsx:177`), shows distance and last update (`:67-68`), and offers Directions through Apple or Google Maps (`geo.ts:33-52`). Tracking requests and approvals (`FriendCard.tsx:73-88`, `MapSettingsSheet.tsx:185-210`).

### 28. Profile audio and maps: PARTIAL / NEEDS CLARIFICATION
- The tabs exist: Videos / Audio / Map (+ Saved, Drafts for me) (`ProfileView.tsx:43-55`).
- Map tab: `ProfilePlacesMap` reads `fetch_profile_places`, the places on posts. Since no post can get a place (21), it is **always empty** for everyone.
- Audio tab: `fetchUserSounds` lists the "original sound" rows auto-created for the user's *public* videos (`m/api/videos.ts:203-215`, `m/api/sounds.ts:140-149`). There is no way to post an audio clip on its own.
- **Fix:** the Map tab is solved by 21 (or also plot the user's shared live location if they share with the viewer, S). For audio, ask the client whether "audio clips" means standalone voice/audio posts. If yes: L (an `audio_posts` table or `videos.kind='audio'`, a recorder and publish flow, a player row, moderation of the title).

### 29. Emoji bar closes on outside tap: PARTIAL
- Chat thread: any touch on the thread closes it (`ChatThread.tsx:343-344`), and so do the keyboard and focus (`Composer.tsx:94-97,233`). OK.
- Live reaction tray: a full-screen catcher plus a 4 s timer (`Reactions.tsx:85-108`). OK.
- Message menu: the modal backdrop closes it (`MessageMenu.tsx:50`). OK.
- **Comments: not OK.** Each row is wrapped in `<Pressable onPress={() => setEmojiOpen(false)}>` (`CommentsSheet.tsx:132-136`), but `CommentRow` is itself a `Pressable` (`:235`), which claims the touch even without `onPress`, so the outer handler never runs. The blank area of the list and the header have no handler either. Only a scroll drag (`:123`), focusing the field or the toggle closes the panel.
- **Fix (S):** wrap the FlatList (and header) in `<View style={{flex:1}} onTouchStart={emojiOpen ? () => setEmojiOpen(false) : undefined}>` as `ChatThread.tsx:344` does, and drop the outer row Pressable.

### 30. "@" search: DONE
Client strip (`m/api/search.ts:10-12`, used by every people search `:48-51`, including `searchProfiles` in New chat) and server strip (`sql/0098:54`).

### 31. "Videos limited to Stories only": NEEDS CLARIFICATION
Implemented as "Stories also accept video" (25, DONE), as agreed earlier. Confirm with the client that they did not mean something else, such as a cap on video length or a separate rule.

---

## Fix list (PARTIAL / MISSING)

| Item | Size | Files |
|---|---|---|
| 21 Location + tag people on posts (also completes 23 and the 28 Map tab) | M | `m/features/publish/PublishScreen.tsx`, `m/app/(app)/publish.tsx`, `m/features/feed/VideoCard.tsx`, new picker components, i18n ×9 |
| 2 Post or delete a saved draft | S | `m/features/profile/ProfileView.tsx` (uses the existing `publishDraft`) |
| 7 Shared links open the app | M | `mobile/app.json`, `site/.well-known/*`, new site fallback for `/live/*`, `/v/*`, `/u/*` |
| 10 Delivered tick when the recipient's app is closed | M | `fn/send-push/index.ts`, `m/features/call/background.ts`, `m/features/notifications/push.ts` |
| 11 Group or summarize social notifications | S-M | `fn/send-push/index.ts`, `fn/send-push/strings.ts` |
| 19 Flip during recording (if the client means it) | L | `m/features/camera/CameraScreen.tsx`, `mobile/modules/flyp-video-filter` (concat) |
| 28 Audio clips as posts (if confirmed) | L | new migration, recorder/publish UI, profile Audio tab |
| 29 Comments emoji panel closes on tap | S | `m/features/comments/CommentsSheet.tsx` |
| 1 Arabic store title/keywords | S (not code) | Play Console / App Store Connect, `store-assets/LISTING.md` |
| Bug (a) Reactivate on sign-in | S | `m/providers/AuthProvider.tsx` (on SIGNED_IN: `fetchAccountStatus` → `reactivateAccount` + toast), `AccountStatusScreen.tsx` (Reactivate button) |
| Bug (b) Appeals screen | M (L with admin) | new migration (`appeals` table, RLS, `submit_appeal` RPC, a moderation-actions view), `m/features/settings/AccountStatusScreen.tsx` (actions on my account + appeal form), `m/api/settings.ts`, `web/js/admin-v2/*` queue |

Optional polish: a map entry outside Settings (16, S), in-camera story capture (25, S-M), iOS `CFBundleLocalizations` for all 9 languages (14, S).

## Counts

- DONE: 19 (3, 4, 5, 6, 8, 9, 13, 14, 15, 16, 17, 18, 20, 22, 24, 25, 26, 27, 30)
- PARTIAL: 8 (2, 7, 10, 11, 19, 23, 28, 29). Notes 19 and 28 also need clarification.
- MISSING: 2 (1 store metadata, 21 UI)
- excluded (wallet): 1 (12)
- NEEDS CLARIFICATION: 1 (31)
- App bugs: (a) MISSING, (b) MISSING
