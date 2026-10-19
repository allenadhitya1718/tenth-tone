# FLYP test plan

Every feature of FLYP 2.0.0, tested the way a real person would use it. Same check IDs as the live checklist page (https://claude.ai/artifact/PNwrbXALa9DTBtgE7FWNGz).

**How to record a result:** tick the box when the check has been run, and replace _not tested_ with **PASS**, **FAIL** or **BLOCKED**. For every FAIL or BLOCKED, write the note as: steps → expected → actual → device (emulator A/B + API level, or phone model) → account → how often. Name screenshots by check ID (e.g. `CHAT-07.png`) and put them in `test-results/`.

**183 checks in 18 sections.** Setup and known limits: see [HANDOFF.md](HANDOFF.md).

## Summary

| | Count |
|---|---|
| Pass | 40 |
| Fail | 4 |
| Blocked | 23 |
| Not tested | 116 |

## Sections

- [Install and first launch](#install-and-first-launch)
- [Sign up, log in and password](#sign-up-log-in-and-password)
- [Home feed](#home-feed)
- [Comments](#comments)
- [Camera and posting](#camera-and-posting)
- [Profile](#profile)
- [Discover and search](#discover-and-search)
- [Notifications (in the app)](#notifications-in-the-app)
- [Chat](#chat)
- [Walkie-talkie](#walkie-talkie)
- [Voice and video calls](#voice-and-video-calls)
- [Live (audio rooms)](#live-audio-rooms)
- [Wallet and coins](#wallet-and-coins)
- [Stories](#stories)
- [Friends map](#friends-map)
- [Settings](#settings)
- [Push notifications (app closed)](#push-notifications-app-closed)
- [Look, feel and edge cases](#look-feel-and-edge-cases)

## Install and first launch

_The app opens cleanly and asks for permissions at the right moment._


- [x] **INSTALL-01** Install the APK and open FLYP  
  Expected: Splash screen, then the welcome or tour screen. No crash, no blank white screen.  
  Result: **PASS** · Note: Cold launch showed the welcome tour (Arabic, RTL) with no crash or blank screen. A System UI ANR dialog appeared once right after first boot (emulator A, API 34, software GPU), unrelated to FLYP; dismissed with Wait. Screenshot: test-results/INSTALL-01.png
- [x] **INSTALL-02** Kill the app and open it again  
  Expected: Opens straight to where you were (or welcome if signed out).  
  Result: **PASS** · Note: Force-stop then relaunch while signed out returned to the welcome tour. Screenshot: test-results/INSTALL-02.png
- [x] **INSTALL-03** Turn on airplane mode and open the app  
  Expected: A clear offline message or cached content; no crash.  
  Result: **PASS** · Note: Airplane mode on (icon visible), cold launch showed the welcome tour; no crash, no blank screen. Tour is static so no offline message needed. Screenshot: test-results/INSTALL-03.png
- [x] **INSTALL-04** Lock and unlock the phone with FLYP open  
  Expected: App comes back on the same screen.  
  Result: **PASS** · Note: Power button lock then unlock with swipe: app returned on the same tour slide. Screenshot: test-results/INSTALL-04.png

## Sign up, log in and password

_Accounts on the Mumbai server. Codes arrive from no-reply@notify.flyp-sa.com._


- [x] **AUTH-01** Change language on the welcome screen with the globe pill  
  Expected: A list of 9 languages opens; picking Arabic flips the layout to right-to-left after a restart.  
  Result: **PASS** · Note: Globe pill opens a sheet with all 9 languages (ar, en, zh, hi, ur, fr, es, tr, id); current one ticked. English -> app reloads LTR on slide 1; Arabic -> app reloads RTL. Observation: app defaults to Arabic/RTL although the emulator system language is English. Screenshots: test-results/AUTH-01*.png
- [x] **AUTH-02** Sign up with a new email and password  
  Expected: A 6-digit code email arrives within a minute (check Spam).  
  Result: **FAIL** · Note: Steps: sign up with new email+password on emulator A. Expected: email with a 6-digit code. Actual: app shows "Enter verification code" screen, but the email from no-reply@notify.flyp-sa.com ("Confirm your email address") contains only a "Confirm email address" link, no code. Link opens http://localhost:3000/#access_token=... (browser: cannot be reached), i.e. backend Site URL/redirect points at localhost. Device: emulator A, API 34 (Play x86_64). Account: tester inbox (user-created). Frequency: 1/1 (Resend tried, see AUTH-04). Screenshot: test-results/AUTH-02.png (+ user-supplied email screenshot not stored)
- [x] **AUTH-03** Enter the 6-digit code  
  Expected: Account verified; profile set-up starts (name, username, birth date, gender, country).  
  Result: **BLOCKED** · Note: No 6-digit code can be obtained: the only email from no-reply@notify.flyp-sa.com (11:40) is link-only (see AUTH-02), and Resend at 11:43 produced no second email in the inbox within ~6 min (also checked all folders). Device: emulator A, API 34. Frequency: 1/1.
- [x] **AUTH-04** Enter a wrong code, then an expired one  
  Expected: Clear error message each time; you can request a new code.  
  Result: **FAIL** · Note: Wrong code 000000 -> red boxes + "The code is wrong or has expired" (good). But "request a new code" does not work end to end: tapping Resend shows "Code sent again" (60 s cooldown) yet no new email arrived in ~6 min, so a valid code is never available. Expired-code case could not be tested. Device: emulator A, API 34. Frequency: 1/1 (resend). Screenshot: test-results/AUTH-04.png
- [ ] **AUTH-05** Try a username that's already taken  
  Expected: Error shown before saving.  
  Result: _not tested_ · Note: 
- [ ] **AUTH-06** Sign up with an age under 18  
  Expected: App rules applied (some features such as location sharing locked).  
  Result: _not tested_ · Note: 
- [ ] **AUTH-07** Log out, then log in with email and password  
  Expected: Lands on the home feed.  
  Result: _not tested_ · Note: 
- [ ] **AUTH-08** Log in with a wrong password  
  Expected: Error message; account not locked after one try.  
  Result: _not tested_ · Note: 
- [ ] **AUTH-09** Forgot password: request a code, set a new password  
  Expected: Code email arrives; new password works, old one doesn't.  
  Result: _not tested_ · Note: 
- [ ] **AUTH-10** Sign in with Apple (iPhone only) _(iPhone only)_  
  Expected: Signs in or creates the account.  
  Result: _not tested_ · Note: 

## Home feed

_Following, For You and Live tabs._


- [x] **FEED-01** Open the app on For You  
  Expected: A video plays full screen with sound.  
  Result: **PASS** · Note: For You opens straight on the only video (my own post) full screen with the right-side action column, caption and sound line. Audio cannot be heard on the emulator host capture, so "with sound" is unverified. Screenshot: FEED-01.png
- [x] **FEED-02** Swipe up and down between videos  
  Expected: One video per swipe; the previous one stops; no double audio.  
  Result: **BLOCKED** · Note: Only one video exists on the brand-new backend, so one-video-per-swipe and no double audio cannot be checked. Needs more content / account B posts.
- [x] **FEED-03** Swipe left and right between Following, For You and Live  
  Expected: Tabs change by swipe and by tapping their names.  
  Result: **PASS** · Note: Swipe left/right moves For You <-> Live (and Following), and tapping the tab names works; the white underline follows. Following shows an empty state, Live shows "Nobody is live right now" + Go live button. Screenshots: FEED-03-*.png, FEED-15.png
- [x] **FEED-04** Tap the video once  
  Expected: Sound toggles; a small muted pill appears.  
  Result: **PASS** · Note: Single tap on the video shows a "Tap for sound" (muted icon) pill at the top. Screenshot: FEED-04.png
- [x] **FEED-05** Double-tap the video  
  Expected: Big heart animation; like count goes up by one. Double-tap again doesn't unlike.  
  Result: **PASS** · Note: Double-tap shows the big red heart and the like count goes 0 -> 1. Second double-tap (should not unlike) not run. Screenshot: FEED-05.png
- [x] **FEED-06** Tap the heart button twice  
  Expected: Likes, then unlikes; count follows.  
  Result: **PASS** · Note: Heart button toggles: 1 -> 0 (outline) -> 1 (red); count follows. Screenshots: FEED-06-a/b.png
- [x] **FEED-07** Tap the bookmark  
  Expected: Saved; appears under Profile → Saved.  
  Result: **PASS** · Note: Bookmark turns yellow and its count goes 0 -> 1. "Appears under Profile -> Saved" is checked in the PROFILE section. Screenshot: FEED-07.png
- [x] **FEED-08** Tap share  
  Expected: Phone share sheet opens with a flyp-sa.com link; share count updates.  
  Result: **PASS** · Note: Share opens the Android share sheet "Sharing link" with https://flyp-sa.com/v/<id>. Observation: the share count went 0 -> 1 as soon as the sheet opened, even though I dismissed it without sharing. Screenshot: FEED-08.png
- [x] **FEED-09** Tap the creator's photo or name next to the caption  
  Expected: Opens their profile. The name shows with their profile photo (no @).  
  Result: **PASS** · Note: Tapping the creator name/photo under the caption opens the profile page (@devesh19, Devesh). The feed shows the name without "@". Screenshot: FEED-09.png (own video, so no Follow state tested)
- [x] **FEED-10** Tap the + on the creator's photo on the right  
  Expected: Follows them; the + disappears.  
  Result: **BLOCKED** · Note: Own video has no "+" on the avatar (correct). Needs a video from another account (B) to test follow-from-feed.
- [x] **FEED-11** Read caption and sound line  
  Expected: Caption shows up to 3 lines; sound line shows the song or Original sound.  
  Result: **PASS** · Note: Caption "First test video" and the line "Original sound · @devesh19" are shown. 3-line truncation not tested (caption is short).
- [x] **FEED-12** Keep scrolling past 20 videos  
  Expected: More videos load without a spinner stuck.  
  Result: **BLOCKED** · Note: Cannot scroll past 20 videos: only one video exists.
- [x] **FEED-13** Pull down at the top  
  Expected: Feed refreshes.  
  Result: **BLOCKED** · Note: Pull-down on the single video shows no visible refresh indicator via adb swipe and nothing changes; cannot tell if a refresh ran. Retest with more content on a real swipe.
- [x] **FEED-14** Switch to another tab and back  
  Expected: Video pauses when you leave and resumes when you return.  
  Result: **BLOCKED** · Note: Pause/resume on tab switch cannot be told apart from a screenshot (video is near-static and audio is not captured). Returning to For You shows the video again.
- [x] **FEED-15** Following tab with nobody followed  
  Expected: Friendly empty message.  
  Result: **PASS** · Note: Following with nobody followed shows "Follow people to see their videos here". Screenshot: FEED-15.png
- [x] **FEED-16** Watch videos fully, then reopen For You later  
  Expected: Feed changes based on what you watched; you don't keep seeing the same videos.  
  Result: **BLOCKED** · Note: Needs many videos and watch history to judge the algorithm.

## Comments


- [x] **COMMENTS-01** Open comments on a video  
  Expected: Sheet slides up over the video; composer visible above the keyboard.  
  Result: **PASS** · Note: Comment icon opens a bottom sheet over the video: "Comments (0)", empty state "No comments yet. Be the first!", emoji quick-reactions row and composer. Screenshot: COMMENTS-01.png
- [x] **COMMENTS-02** Post a comment  
  Expected: Appears at once; keyboard stays open for the next one.  
  Result: **PASS** · Note: Typed "Nice one" and sent: it appears at once, count becomes Comments (1), composer clears. The soft keyboard was not visible in the screenshot right after sending (adb Enter key), so "keyboard stays open" is unverified. Screenshot: COMMENTS-02.png
- [x] **COMMENTS-03** Reply to a comment  
  Expected: Reply shows under it.  
  Result: **BLOCKED** · Note: No Reply control is visible on my own comment (tap does nothing, long-press only offers Delete). Replies probably only show on others comments; retest with account B.
- [x] **COMMENTS-04** Like a comment  
  Expected: Heart fills; count changes.  
  Result: **PASS** · Note: Tapping the comment heart fills it red and the count goes 0 -> 1. Screenshot: COMMENTS-04.png
- [x] **COMMENTS-05** @mention someone in a comment  
  Expected: Suggestion list appears; they get a notification.  
  Result: **BLOCKED** · Note: Needs a second user (B) to mention and to receive the notification.
- [x] **COMMENTS-06** Delete your own comment  
  Expected: Removed after confirming.  
  Result: **PASS** · Note: Long-press on my own comment shows a "Delete this comment?" dialog with CANCEL / DELETE; DELETE removes it (count back to 0). Screenshots: COMMENTS-06-long.png, COMMENTS-06.png
- [x] **COMMENTS-07** Report someone's comment  
  Expected: Report options; confirmation shown.  
  Result: **BLOCKED** · Note: Needs a comment from another account (B) to report.
- [x] **COMMENTS-08** Open comments on a video with comments turned off  
  Expected: Clear message that comments are off.  
  Result: **BLOCKED** · Note: Needs a video posted with Allow comments off and opened from B. Retest later.
- [x] **COMMENTS-09** Post a comment with a banned or rude word  
  Expected: Blocked or hidden by moderation.  
  Result: **FAIL** · Note: Steps: post comment "fuck you bitch" (and earlier "you are a stupid idiot") on my video. Expected: blocked or hidden by moderation. Actual: both posted and stayed visible after 14 s, no warning. Possible: flagged comments are hidden only for other viewers; check from B. Emulator A, API 34, account A, 2/2. Screenshots: COMMENTS-09*.png

## Camera and posting

_Needs the new build for filters._


- [x] **CAMERA-01** Tap Create (+)  
  Expected: Camera opens; asks for camera and microphone the first time.  
  Result: **PASS** · Note: Create (+) shows an in-app "Allow camera and microphone" explainer; Allow triggers the system camera prompt then the mic prompt. Screenshots: CAMERA-01.png, CAMERA-01-sys.png
- [x] **CAMERA-02** Deny camera permission, then try again  
  Expected: Explains why and offers Open settings.  
  Result: **PASS** · Note: Denied camera + mic: explainer stays with its reason text; after the 2nd denial (permanent) the button changes to "Open settings", which opens FLYP App info. Screenshots: CAMERA-02*.png
- [x] **CAMERA-03** Flip camera with the button and by double-tapping the preview  
  Expected: Switches front and back.  
  Result: **PASS** · Note: Flip button switches back (VirtualScene room) <-> front (emulated pattern). Double-tap on preview could not be verified: adb cannot send a true fast double-tap (two separate taps did not visibly flip). Screenshots: CAMERA-03*.png
- [x] **CAMERA-04** Pinch to zoom and tap 1x / 2x  
  Expected: Zoom changes smoothly.  
  Result: **PASS** · Note: Tapping 2x zooms in visibly and the 2x chip highlights; 1x returns. Pinch-to-zoom not testable with adb (no multi-touch). Screenshot: CAMERA-04-2x.png
- [x] **CAMERA-05** Turn on the flash / torch (back camera)  
  Expected: Torch lights up.  
  Result: **BLOCKED** · Note: No torch button is shown on the back camera. logcat: "IllegalStateException: No flash unit" - the emulator virtual camera has no flash. Needs a real phone. Emulator A, API 34.
- [x] **CAMERA-06** Swipe left and right on the preview  
  Expected: Filter changes; its name fades in at the centre; a small vibration.  
  Result: **BLOCKED** · Note: Not testable: choosing any filter blacks out the live preview on this emulator (see CAMERA-07), so swipe-to-change-filter, name fade and haptic could not be judged. Real phone needed.
- [x] **CAMERA-07** Tap filters in the strip below  
  Expected: Same filter shows live; the selected one is ringed.  
  Result: **BLOCKED** · Note: Filter strip opens (Normal, Crisp, Golden Hour, Breeze, Faded Film, ...) and the tapped one is ringed, but the live preview goes BLACK as soon as a filter is chosen. logcat: IllegalArgumentException "PRIVATE format with resolution 1280x720 is not supported for ImageAnalysis on the device" - likely emulator camera limitation, but the app does not recover or show an error (preview stays black until the camera is reopened). Re-test on a real phone. Emulator A, API 34, 2/2. Screenshots: CAMERA-07*.png
- [x] **CAMERA-08** Turn on Beauty  
  Expected: Softer look on the preview.  
  Result: **BLOCKED** · Note: Same as CAMERA-07: tapping Beauty turns the preview black (same ImageAnalysis 1280x720 error in logcat); tapping Beauty again brings the preview back. Re-test on a real phone. Emulator A, API 34. Screenshots: CAMERA-08*.png
- [x] **CAMERA-09** Start recording  
  Expected: Vibration when recording starts; timer runs.  
  Result: **PASS** · Note: Record button turns into a stop square and the red timer runs (00:05 seen at ~6 s). Vibration cannot be felt on an emulator. Screenshot: CAMERA-09.png
- [x] **CAMERA-10** Stop recording with a filter on  
  Expected: "Applying filter…" then the post screen; the clip has the filter.  
  Result: **BLOCKED** · Note: Recording with a filter on could not be done: filters black out the preview on this emulator (see CAMERA-07). Recording without a filter goes straight to the Post screen (no "Applying filter" step).
- [ ] **CAMERA-11** Upload a video from the gallery  
  Expected: Opens the post screen with that video.  
  Result: _not tested_ · Note: 
- [x] **CAMERA-12** Tap the small video preview on the post screen  
  Expected: Plays full screen with sound; tap pauses; X closes.  
  Result: **PASS** · Note: Tapping the thumbnail opens the clip full screen with an X to close; X returns to the Post screen. Sound/pause-on-tap not verifiable from screenshots (emulator audio). Screenshot: CAMERA-12.png
- [x] **CAMERA-13** Wait on the post screen  
  Expected: Suggested hashtags appear; tapping one adds it to the caption.  
  Result: **PASS** · Note: Shimmer placeholders first, then 7 suggested hashtags appear within ~10 s (#interiordesign, #livingroom, #woodendecor, ...). Tapping one adds it to the caption and ticks the chip. Screenshots: CAMERA-13*.png
- [x] **CAMERA-14** Use # Hashtag and @ Mention buttons  
  Expected: Inserts and suggests.  
  Result: **PASS** · Note: # Hashtag and @ Mention buttons each insert their character at the cursor (counter updates). No @ user suggestions list was seen with an empty @ (not tested further). Screenshot: CAMERA-14-at.png
- [x] **CAMERA-15** Type more than 300 characters  
  Expected: Stops at 300; counter shows it.  
  Result: **PASS** · Note: Typing past the limit stops at exactly 300 and the counter shows 300/300. Screenshot: CAMERA-15.png
- [x] **CAMERA-16** Choose Everyone / Followers / Only me  
  Expected: Choice saved with the post.  
  Result: **PASS** · Note: Everyone / Followers / Only me radios switch correctly (Only me ringed in CAMERA-16-onlyme.png). That the choice is stored with the post is not yet verified from a second account.
- [x] **CAMERA-17** Turn off Allow comments and Allow saving  
  Expected: Video shows comments off and no save option to others.  
  Result: **PASS** · Note: Allow comments and Allow saving toggle off (grey). Effect on other viewers not yet verified (needs account B). Screenshot: CAMERA-17.png
- [x] **CAMERA-18** Tap Post  
  Expected: Upload progress; a "Your video is posted" toast; lands on your profile.  
  Result: **PASS** · Note: Post shows "Uploading... 0%" bar with buttons disabled, then lands on own profile (@devesh19) with the new video in the grid. The "Your video is posted" toast was not captured by screenshots. Screenshots: CAMERA-18-a/c.png
- [ ] **CAMERA-19** Tap Save draft  
  Expected: "Saved to your drafts"; appears under Profile → Drafts.  
  Result: _not tested_ · Note: 
- [ ] **CAMERA-20** Turn off internet during upload  
  Expected: Error with Retry; nothing lost.  
  Result: _not tested_ · Note: 
- [ ] **CAMERA-21** Post a video with inappropriate content  
  Expected: Blocked by moderation with a message.  
  Result: _not tested_ · Note: 

## Profile

_Your own profile and other people's._


- [x] **PROFILE-01** Open your profile tab  
  Expected: Photo, name, username, following / followers / likes, bio.  
  Result: **PASS** · Note: Profile tab shows avatar (initial letter), name "Devesh", @devesh19, Following/Followers/Likes counts, Edit/Share buttons and 5 content tabs. No bio set so none shown. Screenshot: PROFILE-01.png
- [x] **PROFILE-02** Edit profile: change photo, name, username, bio, link, gender, country  
  Expected: Saved and shown everywhere.  
  Result: **PASS** · Note: Edit profile screen has photo, name, username, bio, link, gender, country. Changed name -> "Devesh Tester" and bio -> text; Save shows a spinner, returns to the profile which now shows the new name and bio. NOT exercised: photo upload, username change, link (my link text went into Bio because the keyboard shifted the layout - test error), gender, country. Gender/Country still read "Choose" (profile set-up from AUTH-03 was not shown after login). Screenshots: PROFILE-02*.png
- [x] **PROFILE-03** Set an inappropriate profile photo  
  Expected: Rejected by moderation.  
  Result: **BLOCKED** · Note: Would need an inappropriate image on the emulator gallery; not sourcing one. Needs a manual check by Allen or a safe test image from moderation team.
- [x] **PROFILE-04** Open each tab: Videos, Audio, Map, Saved, Drafts  
  Expected: Each shows its content or a friendly empty message.  
  Result: **PASS** · Note: Videos (my post), Audio, Map ("Add a place when you post and it will show on your map."), Saved (shows the video I bookmarked, confirming FEED-07) and Drafts ("Clips you save as drafts appear here before you post them.") all show content or a friendly empty state. OBSERVATION: Audio tab lists the original sound as "Used 2 times" although I posted exactly 1 video (possible off-by-one count). Screenshots: PROFILE-04-tab*.png
- [x] **PROFILE-05** Tap one of your videos  
  Expected: Opens in the home feed with that video first; swiping continues into normal videos.  
  Result: **PASS** · Note: Tapping my video in the grid opens Home/For You on that video (likes 1, comments 2, saved 1, shares 1). Swiping into other videos untested (only one exists). Screenshot: PROFILE-05.png
- [x] **PROFILE-06** Share profile  
  Expected: Share sheet with your profile link.  
  Result: **PASS** · Note: Share profile opens the Android share sheet with https://flyp-sa.com/u/devesh19. Screenshot: PROFILE-06.png
- [x] **PROFILE-07** Tap Followers and Following  
  Expected: Lists open; you can follow or remove from there.  
  Result: **PASS** · Note: Tapping Followers opens a Followers screen with a Search box and the empty state "No followers yet". Follow/remove actions need account B. Screenshot: PROFILE-07.png
- [x] **PROFILE-08** Open someone else's profile  
  Expected: Follow, Message buttons; their videos.  
  Result: **BLOCKED** · Note: Needs account B (someone else profile).
- [x] **PROFILE-09** Follow and unfollow them  
  Expected: Counts update on both sides.  
  Result: **BLOCKED** · Note: Needs account B.
- [x] **PROFILE-10** Follow a private account  
  Expected: Shows Requested; they get a follow request.  
  Result: **BLOCKED** · Note: Needs account B set to a private account.
- [x] **PROFILE-11** Block a user from their profile  
  Expected: They disappear from your feed and can't message you.  
  Result: **BLOCKED** · Note: Needs account B.
- [x] **PROFILE-12** Report a user  
  Expected: Report options and confirmation.  
  Result: **BLOCKED** · Note: Needs account B.

## Discover and search


- [x] **DISCOVER-01** Open Discover  
  Expected: Trending hashtags, sounds and videos load.  
  Result: **PASS** · Note: Discover opens with a search box, a notification bell and "Popular videos" (only my 1 video). No trending hashtags or sounds sections are shown - likely because no hashtag exists yet on the new backend. Screenshot: DISCOVER-01.png
- [x] **DISCOVER-02** Search a name, @username, #hashtag and a word  
  Expected: People, hashtags, sounds and videos results; @ and # both work.  
  Result: **PASS** · Note: Searching "devesh" gives tabs Top / People / Videos / Sounds / Hashtags with the person and the sound; "@devesh19" shows People. "#" search not verified (no hashtags exist). Screenshots: DISCOVER-02-name.png, DISCOVER-02-at.png
- [x] **DISCOVER-03** Open a hashtag page  
  Expected: Videos with that hashtag and a count (1 video / 2 videos).  
  Result: **BLOCKED** · Note: No hashtag exists yet (my caption has none). Needs a post containing a hashtag; retest after posting one.
- [x] **DISCOVER-04** Open a sound page  
  Expected: Videos using it; Use this sound.  
  Result: **FAIL** · Note: Steps: Discover -> search "devesh" -> tap the sound. Expected: videos using it, count matches. Actual: page shows "Use this sound" and "Favourite", but the header says "2 videos" while only 1 video is listed (Profile -> Audio also says "Used 2 times"); I only posted one video. Emulator A, API 34, account A, 3/3. Screenshot: DISCOVER-04.png
- [x] **DISCOVER-05** Search something with no results  
  Expected: Clear empty state.  
  Result: **PASS** · Note: Searching "zzqqxx" shows an icon, "No results" and "Try a different spelling or a shorter word." Screenshot: DISCOVER-05.png

## Notifications (in the app)


- [ ] **NOTIF-01** Get a like, comment, follow, mention from phone B  
  Expected: Each appears in Notifications with the right text.  
  Result: _not tested_ · Note: 
- [ ] **NOTIF-02** Tap each notification  
  Expected: Opens the right video, profile or chat.  
  Result: _not tested_ · Note: 
- [ ] **NOTIF-03** Accept and decline follow requests (private account)  
  Expected: Requester becomes a follower or the request disappears.  
  Result: _not tested_ · Note: 
- [ ] **NOTIF-04** Unread badge  
  Expected: Badge shows and clears after opening.  
  Result: _not tested_ · Note: 

## Chat

_Use phones A and B._


- [ ] **CHAT-01** Start a new chat from the pencil icon  
  Expected: Search people and open a chat.  
  Result: _not tested_ · Note: 
- [ ] **CHAT-02** Send a text message  
  Expected: Appears instantly on both phones.  
  Result: _not tested_ · Note: 
- [ ] **CHAT-03** Check the ticks  
  Expected: One tick sent, two ticks delivered, blue ticks when read.  
  Result: _not tested_ · Note: 
- [ ] **CHAT-04** Send a photo  
  Expected: Uploads and shows; tapping opens full screen.  
  Result: _not tested_ · Note: 
- [ ] **CHAT-05** Open a chat with an old photo (older than a week)  
  Expected: Photo still loads (not a blank box).  
  Result: _not tested_ · Note: 
- [ ] **CHAT-06** Record a voice note: hold to record, release to send  
  Expected: Sends; plays on the other phone.  
  Result: _not tested_ · Note: 
- [ ] **CHAT-07** Voice note: slide to cancel, and tap to lock  
  Expected: Cancel discards; lock keeps recording hands-free.  
  Result: _not tested_ · Note: 
- [ ] **CHAT-08** Long-press a message: react, reply, copy, delete  
  Expected: Each works; delete removes it for you.  
  Result: _not tested_ · Note: 
- [ ] **CHAT-09** Emoji picker  
  Expected: Opens and inserts emoji; closes when tapping elsewhere.  
  Result: _not tested_ · Note: 
- [ ] **CHAT-10** Message someone who doesn't follow you  
  Expected: Goes to their Message requests; they can accept or decline.  
  Result: _not tested_ · Note: 
- [ ] **CHAT-11** Create a group chat, add and remove people  
  Expected: Members update; group name and photo shown.  
  Result: _not tested_ · Note: 
- [ ] **CHAT-12** Unread chat badge on the Chat tab  
  Expected: Counts unread chats; clears after reading.  
  Result: _not tested_ · Note: 
- [ ] **CHAT-13** Search conversations  
  Expected: Filters the inbox.  
  Result: _not tested_ · Note: 

## Walkie-talkie

_Phones A and B in the same chat._


- [ ] **WALKIE-01** Tap the radio icon in the chat composer on both phones  
  Expected: Walkie bar shows "listening"; mic button changes to push-to-talk.  
  Result: _not tested_ · Note: 
- [ ] **WALKIE-02** Hold the button on phone A and speak  
  Expected: Phone B hears you live; shows "A is talking".  
  Result: _not tested_ · Note: 
- [ ] **WALKIE-03** Quick-tap instead of holding  
  Expected: Mic stays open until you tap again.  
  Result: _not tested_ · Note: 
- [ ] **WALKIE-04** Phone B has walkie off while A talks  
  Expected: B sees "A is talking" with a Listen button.  
  Result: _not tested_ · Note: 
- [ ] **WALKIE-05** Talk for over 60 seconds  
  Expected: Stops automatically.  
  Result: _not tested_ · Note: 
- [ ] **WALKIE-06** Turn walkie off  
  Expected: Normal voice-note button comes back.  
  Result: _not tested_ · Note: 

## Voice and video calls

_Phones A and B. Test with B's app open, in the background, and closed with the screen locked._


- [ ] **CALLS-01** Tap the phone icon in a chat  
  Expected: Calling screen; B rings.  
  Result: _not tested_ · Note: 
- [ ] **CALLS-02** Tap the video icon  
  Expected: Video call; your camera shows.  
  Result: _not tested_ · Note: 
- [ ] **CALLS-03** B: answer with the app open  
  Expected: Connected; timer starts; you hear each other.  
  Result: _not tested_ · Note: 
- [ ] **CALLS-04** B: app in background  
  Expected: Full-screen or heads-up call notification with Accept and Decline.  
  Result: _not tested_ · Note: 
- [ ] **CALLS-05** B: app closed and phone locked  
  Expected: Phone rings on the lock screen; Accept opens the call after unlocking.  
  Result: _not tested_ · Note: 
- [ ] **CALLS-06** Decline from the notification  
  Expected: A sees declined; B's ring stops.  
  Result: _not tested_ · Note: 
- [ ] **CALLS-07** A hangs up before B answers  
  Expected: B's ringing notification disappears; B sees a Missed call.  
  Result: _not tested_ · Note: 
- [ ] **CALLS-08** Nobody answers for 45 seconds  
  Expected: Shows No answer; Missed call in chat.  
  Result: _not tested_ · Note: 
- [ ] **CALLS-09** Mute, speaker, camera on/off, flip camera  
  Expected: Each works on both sides.  
  Result: _not tested_ · Note: 
- [ ] **CALLS-10** Drag your small video around  
  Expected: Snaps to a corner.  
  Result: _not tested_ · Note: 
- [ ] **CALLS-11** Press back during a call  
  Expected: Call minimises to a green bar; tapping it returns.  
  Result: _not tested_ · Note: 
- [ ] **CALLS-12** Turn off Wi-Fi briefly during a call  
  Expected: Shows Reconnecting…, then recovers.  
  Result: _not tested_ · Note: 
- [ ] **CALLS-13** Call someone who blocked you  
  Expected: Call refused with a message.  
  Result: _not tested_ · Note: 

## Live (audio rooms)

_Host on phone A, listener on phone B._


- [ ] **LIVE-01** Go live: title, cover photo, Everyone / Friends / Only me  
  Expected: Room opens as host; asks for the microphone.  
  Result: _not tested_ · Note: 
- [ ] **LIVE-02** B joins the live  
  Expected: B hears the host; listener count goes up.  
  Result: _not tested_ · Note: 
- [ ] **LIVE-03** Send comments in the live  
  Expected: Appear for everyone; keyboard stays open.  
  Result: _not tested_ · Note: 
- [ ] **LIVE-04** Tap hearts and the reaction tray  
  Expected: Floating hearts; tray closes when tapping elsewhere.  
  Result: _not tested_ · Note: 
- [ ] **LIVE-05** B: Request to speak  
  Expected: Host sees the request; Approve puts B on stage; B can talk.  
  Result: _not tested_ · Note: 
- [ ] **LIVE-06** Host: invite a listener to speak  
  Expected: Listener gets Accept / Not now.  
  Result: _not tested_ · Note: 
- [ ] **LIVE-07** Host: remove a guest from the stage  
  Expected: Guest goes back to listening.  
  Result: _not tested_ · Note: 
- [ ] **LIVE-08** B: send a gift (horse, camel, falcon, dallah, dates)  
  Expected: Gift banner shows for everyone; coins deducted.  
  Result: _not tested_ · Note: 
- [ ] **LIVE-09** Send a gift without enough coins  
  Expected: Offers to open the wallet.  
  Result: _not tested_ · Note: 
- [ ] **LIVE-10** Share the live  
  Expected: Share sheet with the live link.  
  Result: _not tested_ · Note: 
- [ ] **LIVE-11** Report the live or a comment  
  Expected: Report options; confirmation.  
  Result: _not tested_ · Note: 
- [ ] **LIVE-12** Host ends the live  
  Expected: Summary with duration and peak listeners; B sees Live ended.  
  Result: _not tested_ · Note: 
- [ ] **LIVE-13** Press back as host  
  Expected: Asks to end the live first.  
  Result: _not tested_ · Note: 

## Wallet and coins

_Needs Google Play test products set up._


- [ ] **WALLET-01** Open Settings → Wallet  
  Expected: Balance, how-to-top-up steps, coin packages, history.  
  Result: _not tested_ · Note: 
- [ ] **WALLET-02** Coin packages show prices  
  Expected: Prices in your local currency from Google Play.  
  Result: _not tested_ · Note: 
- [ ] **WALLET-03** Buy a package with a test account  
  Expected: Google Play sheet; coins arrive once; Purchase history shows it.  
  Result: _not tested_ · Note: 
- [ ] **WALLET-04** Cancel the purchase sheet  
  Expected: Nothing happens; no coins.  
  Result: _not tested_ · Note: 
- [ ] **WALLET-05** Buy, then turn off internet straight away  
  Expected: Shows Almost there; coins arrive once you're back online.  
  Result: _not tested_ · Note: 
- [ ] **WALLET-06** Buy the same package again  
  Expected: Works again (not "already owned").  
  Result: _not tested_ · Note: 

## Stories


- [ ] **STORIES-01** Find where to post a story in the app  
  Expected: Note where it is, or Fail if there's no way to reach it.  
  Result: _not tested_ · Note: 
- [ ] **STORIES-02** Post a photo story with a song and a caption  
  Expected: Uploads with progress; song plays when viewed.  
  Result: _not tested_ · Note: 
- [ ] **STORIES-03** Post a video story (under 60 s)  
  Expected: Plays in the viewer.  
  Result: _not tested_ · Note: 
- [ ] **STORIES-04** Choose audience Everyone / Followers / Close friends  
  Expected: Only that audience can see it.  
  Result: _not tested_ · Note: 
- [ ] **STORIES-05** View a story: tap right/left, hold to pause, swipe down to close  
  Expected: Moves forward/back, pauses, closes.  
  Result: _not tested_ · Note: 
- [ ] **STORIES-06** Own story: Seen by  
  Expected: List of viewers.  
  Result: _not tested_ · Note: 
- [ ] **STORIES-07** Delete your story  
  Expected: Removed after confirming.  
  Result: _not tested_ · Note: 
- [ ] **STORIES-08** Wait 24 hours  
  Expected: Story disappears.  
  Result: _not tested_ · Note: 

## Friends map

_Two accounts that follow each other, both 18+._


- [ ] **MAP-01** Open Settings → Friends map  
  Expected: Consent screen explains who can see you.  
  Result: _not tested_ · Note: 
- [ ] **MAP-02** Tap Not now  
  Expected: Map opens without using your location.  
  Result: _not tested_ · Note: 
- [ ] **MAP-03** Share my location (Friends)  
  Expected: Asks for location permission; your pin shows.  
  Result: _not tested_ · Note: 
- [ ] **MAP-04** Friend shares too  
  Expected: Their avatar pin appears; moves live.  
  Result: _not tested_ · Note: 
- [ ] **MAP-05** Tap a friend's pin  
  Expected: Card with distance, Directions, Message, Follow.  
  Result: _not tested_ · Note: 
- [ ] **MAP-06** Directions  
  Expected: Opens Google Maps to them.  
  Result: _not tested_ · Note: 
- [ ] **MAP-07** Follow mode  
  Expected: Map keeps the friend centred until you move the map.  
  Result: _not tested_ · Note: 
- [ ] **MAP-08** Ask to see someone's location / allow / deny  
  Expected: Request arrives; allow grants access; deny doesn't.  
  Result: _not tested_ · Note: 
- [ ] **MAP-09** Stop sharing  
  Expected: Your pin disappears for friends.  
  Result: _not tested_ · Note: 
- [ ] **MAP-10** Profile → Map tab  
  Expected: Shows places from your posts.  
  Result: _not tested_ · Note: 

## Settings

_Open every row once._


- [ ] **SETTINGS-01** Privacy → Private account on and off  
  Expected: New followers need approval when on.  
  Result: _not tested_ · Note: 
- [ ] **SETTINGS-02** Who can message / comment / tag me: Everyone, Friends, People I follow, Nobody  
  Expected: Each rule enforced when phone B tries.  
  Result: _not tested_ · Note: 
- [ ] **SETTINGS-03** Close friends: add and remove  
  Expected: List updates; close-friends story audience uses it.  
  Result: _not tested_ · Note: 
- [ ] **SETTINGS-04** Hidden words: add a word  
  Expected: Comments with it are hidden.  
  Result: _not tested_ · Note: 
- [ ] **SETTINGS-05** Restricted, Muted and Blocked accounts  
  Expected: Add, see in the list, remove.  
  Result: _not tested_ · Note: 
- [ ] **SETTINGS-06** Notifications: turn each type off  
  Expected: That type stops arriving.  
  Result: _not tested_ · Note: 
- [ ] **SETTINGS-07** Language: try all 9 (Arabic and Urdu right-to-left)  
  Expected: Whole app translated; layout flips for Arabic and Urdu.  
  Result: _not tested_ · Note: 
- [ ] **SETTINGS-08** Theme: light, dark, system  
  Expected: Dark mode uses navy; everything readable.  
  Result: _not tested_ · Note: 
- [ ] **SETTINGS-09** Change password  
  Expected: Old password required; new one works.  
  Result: _not tested_ · Note: 
- [ ] **SETTINGS-10** Change email  
  Expected: Code to the new email; email updated.  
  Result: _not tested_ · Note: 
- [ ] **SETTINGS-11** Devices  
  Expected: Shows signed-in phones; sign out another device.  
  Result: _not tested_ · Note: 
- [ ] **SETTINGS-12** Download my data  
  Expected: Request accepted; data export arrives.  
  Result: _not tested_ · Note: 
- [ ] **SETTINGS-13** Activity (your comments, likes, time)  
  Expected: Lists load; tapping opens the item.  
  Result: _not tested_ · Note: 
- [ ] **SETTINGS-14** Report a problem and Contact support  
  Expected: Sends; confirmation shown.  
  Result: _not tested_ · Note: 
- [ ] **SETTINGS-15** Community guidelines and Legal  
  Expected: Text opens and scrolls.  
  Result: _not tested_ · Note: 
- [ ] **SETTINGS-16** Deactivate account  
  Expected: Profile hidden; logging in again reactivates.  
  Result: _not tested_ · Note: 
- [ ] **SETTINGS-17** Delete account  
  Expected: Confirms twice; account gone; can't log in.  
  Result: _not tested_ · Note: 
- [ ] **SETTINGS-18** Log out  
  Expected: Back to welcome; notifications stop for that phone.  
  Result: _not tested_ · Note: 

## Push notifications (app closed)

_Close FLYP on phone A, act from phone B._


- [ ] **PUSH-01** Message from B  
  Expected: Notification with sender name and text; tapping opens the chat.  
  Result: _not tested_ · Note: 
- [ ] **PUSH-02** Several messages from the same chat  
  Expected: Grouped: N new messages from B.  
  Result: _not tested_ · Note: 
- [ ] **PUSH-03** Voice note, photo  
  Expected: Says Voice message / Photo.  
  Result: _not tested_ · Note: 
- [ ] **PUSH-04** Like, comment, follow, mention, follow request  
  Expected: Each arrives with the right text and opens the right screen.  
  Result: _not tested_ · Note: 
- [ ] **PUSH-05** B goes live  
  Expected: "B is live now"; tapping opens the live.  
  Result: _not tested_ · Note: 
- [ ] **PUSH-06** Gift and live invite  
  Expected: Arrive with the right text.  
  Result: _not tested_ · Note: 
- [ ] **PUSH-07** Switch the app to Arabic, then get a notification  
  Expected: Notification text is in Arabic. Repeat for one more language.  
  Result: _not tested_ · Note: 
- [ ] **PUSH-08** Turn a notification type off in Settings  
  Expected: That type no longer arrives.  
  Result: _not tested_ · Note: 

## Look, feel and edge cases


- [ ] **GENERAL-01** Android back button on every screen  
  Expected: Goes back one step; never exits the app unexpectedly.  
  Result: _not tested_ · Note: 
- [ ] **GENERAL-02** Open a flyp-sa.com video or profile link from WhatsApp  
  Expected: Opens in FLYP on that video or profile.  
  Result: _not tested_ · Note: 
- [ ] **GENERAL-03** Slow network (mobile data, weak signal)  
  Expected: Spinners, no frozen screens; videos start within a few seconds.  
  Result: _not tested_ · Note: 
- [ ] **GENERAL-04** Use the app for 15 minutes  
  Expected: No crash, phone doesn't overheat, battery drain reasonable.  
  Result: _not tested_ · Note: 
- [ ] **GENERAL-05** Large font size in phone settings  
  Expected: Text still fits; buttons readable.  
  Result: _not tested_ · Note: 
- [ ] **GENERAL-06** Screen reader (TalkBack) on the feed and buttons  
  Expected: Buttons announce what they do.  
  Result: _not tested_ · Note: 
- [ ] **GENERAL-07** Texts and buttons in the dark theme  
  Expected: Everything readable; no white flashes.  
  Result: _not tested_ · Note: 

