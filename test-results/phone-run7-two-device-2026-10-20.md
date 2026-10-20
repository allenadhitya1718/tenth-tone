# Phone run 7: two devices (2026-10-20), build 06e2353
A = Redmi 9 Power (Android 12), tester account, username user_59db0ede. B = emulator-5554 (Android 14), owner main account, @allen1 "Allen". Method: adb + uiautomator dump (few screenshots, deleted after use).

| id | status | note |
|---|---|---|
| FRIENDS setup | PASS (label nit) | B tapped Follow on A (public, direct follow), A followed B back from A's Followers list. Both profiles show 1 Following / 1 Followers. Button just says "Following" (no explicit "Friends" label) |
| CHAT-02 | PASS | text A->B and B->A arrive live in the open thread; B's inbox row shows preview + unread badge "1" live |
| CHAT-03 | PASS | A's bubble a11y label went "Delivered" -> "Read" right after B opened the thread (double tick icon, blue not separately verified by colour) |
| CHAT-06 | PASS | A hold-mic 3 s -> voice note (0:02) appears on B with play button; tap plays through (0:02/0:02). Audio itself not audible on emulator |
| CHAT-08 (reply) | PASS | reply from A to B's message: quoted block "Allen / reply_from_B_1" on A, and on B shows "You / reply_from_B_1" |
| CHAT-08 (react) | FAIL (low-med) | A reacted with fire on B's message: shows on A at once; B did NOT show it live (only after leaving and re-opening the thread) -> chat reactions not realtime |
| CHAT-08 (delete) | PARTIAL/FAIL (low-med) | A "Delete for everyone": gone on A at once; B still showed it until the thread was left and re-opened (not realtime). Dialog text: "deleted for everyone in this chat" with CANCEL / DELETE FOR EVERYONE |
| CHAT-12 | PARTIAL | B inbox unread badge appears live ("1 unread message"), tab badge counts up. NOTE: missed/declined/ended call events increment the Chat tab badge (reached 9 with 1 real message + calls), badge not cleared since B did not open the thread afterwards |
| CALLS-01/03 voice | PASS | A "Calling..." -> B full screen "Incoming voice call" (Decline/Accept) -> accept -> both show timer 0:0x, Mute/Speaker/Camera/End. First accept on the emulator raised the RECORD_AUDIO permission dialog and the call was dropped (caller got "Missed call"): after granting it worked. NOTE: mic permission should be requested before/while ringing so the first call is not lost (low-med) |
| CALLS-09 | PASS (voice) | B Mute: banner "You're muted" + logcat RtcEngine_muteLocalAudioStream mute=true; Speaker: setEnableSpeakerphone true. Camera/flip on video call: flip pressed on B, local PIP changed |
| CALLS-02 video | PASS (partial) | A video-call -> B accept (camera permission dialog first, ok) -> connected. A sees B's virtual scene full screen; B's PIP shows the scene. A's own PIP and B's remote view of A stay black (the phone lies flat: probably dark front camera; camera 1 opened in logcat) |
| CALLS-06 decline | PASS | B Decline -> A chat shows "Declined call" |
| End from either side | PASS | ended from B (A returned to chat, "Voice call 0:46") and from A (B returned to Home feed, "Video call 0:36") |
| CALLS-07 | PASS | A cancels while B ringing: heads-up call notification (Decline/Accept, channel calls, category call) removed on B (0 call notifications). With B's app open, B sees a blank dark screen with spinner for a few seconds (<10 s) and then Home: no permanent stuck spinner, but a brief spinner flash (low) |
| CALLS-08 | PASS | no answer: A's screen auto-ended, "Missed call" row in chat after ~50 s; B returned to Home normally, no stuck spinner |
| CALLS-04 | PASS | B app in background: heads-up "user_59db0ede is calling you / Voice call" with Decline and Accept (FCM works on the emulator, no SERVICE_NOT_AVAILABLE) |
| Call rate limit | PASS (note) | after ~10 calls in a few minutes A got "Too many calls in a short time. Please wait a little and try again." + Close |
| Cancelled-before-answer log | NOTE | A caller cancelling shows a neutral "Voice call" row in A's chat (no duration) while the callee gets no missed-call row in the same style |
| NOTIF-01 / PUSH-04 (like, comment, follow) | PASS | B followed, liked and commented (with an @mention of A) while A's app was in background: 3 system notifications arrived on A (channel messages: "Allen started following you", "Allen liked your video", "Allen commented on your video / bcomment @user_59db0ede"), and the in-app Notifications list (Discover bell, badge "3 unread") shows the same 3 rows with times, badge cleared after opening |
| NOTIF-02 | PASS (comment) | tapping the comment row opens that video's comments sheet showing the comment (Comments (3)). Like/follow rows not tapped |
| Mention notification | NOTE | the comment with an @mention of the video owner produced only the comment notification (no separate mention row): mention to a third person not testable (only 2 accounts) |
| COMMENTS-05 | PASS | typing " @user_59" on B shows suggestion "@user_59db0ede"; tapping inserts it. NOTE: no suggestion when "@" is typed directly after a word without a space |
| LIVE (Go live) | PASS | A: Go live (title A_test_live, Friends audience selected) -> room as host; B sees the card in Home > Live tab ("Live", viewers) |
| LIVE-02 | PASS | B joined: shows "Connecting audio..." for a few seconds, listener count 1 on both devices, host timer in sync |
| LIVE-03 | PASS | B comment appears on A and B within 2 s |
| LIVE-05 | PASS | B hand icon -> A Stage sheet "Requests to speak (1)" Allen Decline/Approve -> Approve -> B gets "You're on stage" dialog, avatar on stage on both |
| LIVE-07 | PASS | A "Remove from stage" -> B dialog "You're off stage". After removal, B's hand shows "The host removed you from the stage. You can't ask again in this live." (dialog titled "Something went wrong": title wording low) |
| LIVE-06 | PASS | A Invite -> B sheet "Invitation to speak" Join the stage / Not now; Join works. First two Invite attempts returned "Something went wrong / Please wait a minute before trying again." (rate limit shared with the earlier call burst; generic title) |
| LIVE-08 | PASS | B test coin balance 100; Rose (1 coin) sent twice: balance 99 -> 98 (updates ~10 s after the tap, slow) and A (host) showed banner "Allen sent rose x1" for ~3 s. No purchase made |
| LIVE-12 | PASS | A End live (confirm dialog) -> A "Your live has ended: Duration 5:27 - Most listeners 1"; B "This live has ended / Thanks for listening / More lives" |
| NOTIF (live/invite) | PASS | B's in-app list shows "started a live: A_test_live", "approved your request to join the live", "removed you from the live", "invited you to join their live", "started following you" (all unread, correct times) |
| WALKIE-01 | PASS | radio icon in the composer on both: bar "Walkie-talkie / 1 other person is listening. Hold the button to talk." and the mic becomes a green push-to-talk |
| WALKIE-02 | PASS | A holds the button: A's mic indicator + joinChannel in logcat; B shows red banner "user_59db0ede is talking" (audio itself not judged on emulator) |
| WALKIE-03 | PASS | quick tap on A: bar "You're live. Release or tap to stop." and red button stays on |
| WALKIE-04 | PASS | B walkie off while A talks: B banner "user_59db0ede is talking" with a Listen button |
| WALKIE-05 | PASS (weak) | latched mic on A was off again (bar back to "On...") when checked about 70 s later; exact 60 s cut-off not timed |
| WALKIE-06 | PASS | B turned walkie off: normal blue voice-note mic returns |
| PUSH-01 | PASS | B app in background, A sent text: B system notification (channel messages, grouped by chat) ; tapping it opens the A thread |
| PUSH-02 | PASS | 4 messages in a row -> title "4 new messages from user_59db0ede", text = last message; 5th (voice) -> "5 new messages" |
| PUSH-03 (voice) | PASS | voice note shows "Voice message" with mic glyph in the push. Photo push NOT TESTED (needs library, privacy) |
| PUSH-01 reverse (to phone) | PASS | B text arrived on the phone as "Allen sent you a message / b_push_1"; also "Allen joined your live" (host push) |
| PUSH-05/06 (live, invite, removal) | PASS | B got system notifications on the "live" channel: "user_59db0ede invited you to join their live" and "removed you from the live" (A_test_live). "is live now" push for the start was in the in-app list; its system push not separately captured |
| Chat Enter key double send | FAIL (low-med, needs human recheck) | typing text in A's composer + hardware Return (adb keyevent 66) sent each message TWICE (push_msg_1 x2, push_msg_2 x2). The live-room comment box does not. Suspected mobile/src/features/chat/Composer.tsx:309-310 onSubmitEditing={submit} firing twice. CHANGE MADE: added a 600 ms same-text guard in Composer.tsx submit() (see Changes). Not built or tested on device; please confirm with the real keyboard Send key whether it also happens |
| Walkie bar default | NOTE | opening a chat re-enables walkie "On" by itself; on the phone the system mic indicator stays green while the walkie is on in the chat (mic held open). Worth a human look (battery/privacy) |
| STORIES create | PASS | B (emulator) story via system camera "Take a photo" -> New story page: caption, song, audience Everyone/Followers/Close friends, "Share to story" -> "Your story is up". (Story audience default is Followers) |
| STORIES-04 | BLOCKED (admin) | B posted audience "Close friends" (B's close friends list = 0 people). A still sees Allen's story (green close-friends ring in the Chat tray, opens with green star). BOTH test accounts are admin and supabase/migrations/0102_stories.sql:208 "stories admin read" lets admins read every story, so this is not a proven leak. NEEDS-HUMAN with a non-admin second account |
| SETTINGS-02 (message) | PASS | B "Who can message me: Nobody": A's send fails with dialog "Couldn't send the message" (no reason given; nit) and the text stays in the field |
| CALLS-13 | PASS | with Nobody set, A's voice call shows the refusal screen "You can't call this person. They may have blocked you, limited who can contact them, or you may not be connected yet. Try sending a message first." + Close |
| MAP-01/02 | PASS (phone) | Friends map consent screen (who can see you: Friends/Everyone, 8 h expiry, 18+ note); "Not now, just look at the map" opens the Google map (Riyadh default), pill "Not sharing - tap to start", sheet "No friends on the map". Phone did NOT share |
| MAP-03..09 | NEEDS-HUMAN | owner's main account (B) has no date of birth: Settings > Location sharing > switch asks "Choose your date of birth" ("can't be changed later"), which I will not enter for the owner. Sharing from the phone not allowed by the brief. Needs a human with an adult profile (mock location set on emulator via `emu geo fix` worked: OK) |
| PROFILE-10 / follow requests | PASS | B set Private account ON; A (unfollowed first from Discover card: instant) opened B: lock icon, Follow -> "Requested". B got a SYSTEM push "user_59db0ede requested to follow you"; tapping it opens Follow requests (Approve / Decline) |
| NOTIF-03 | PASS | Decline: row disappears ("No follow requests"), A's profile showed Follow again after re-opening (while still on screen A kept showing "Requested": not realtime, low). A re-requested, B Approve: A became Following (B followers 2). Private switch restored OFF afterwards |
| PROFILE-11 / block effects | PASS (with notes) | A blocked B from B's profile "More options" > "Block account" > dialog > "Allen is blocked". On B: chat with A still lists but the name is hidden ("Chat", avatar "C"); sending fails with "Couldn't send the message" (no reason); the call and video icons are gone from that thread header (CALLS-13 by block: PASS); B's For You still shows A's video with the author hidden ("?" avatar, empty handle) |
| Block: Discover suggestion | FAIL (low) | right after the block, A's Discover "Suggested for you" still listed the blocked Allen with a Follow button (screenshot at 2:23, may be stale cache; recheck) |
| Block: B inbox stale | NOTE | after A unblocked, B's inbox row still said "Chat" until restarted/refetched |
| Unblock | PASS | A Settings > Blocked accounts > Unblock Allen > confirm: list empty |
| STORIES-05/06 | PASS (viewers) | B (owner) opened own story: footer "Seen by 1" -> sheet lists user_59db0ede with time. STORIES-07 delete: trash -> "Delete this story? It will be removed for everyone straight away" -> gone from A's tray. Tap-left/right gestures not run (single item) |
| STORIES-03 | PASS (photo only) | story created and viewed on both; 60 s video story NOT run |
| STORIES-08 | NEEDS-24H | not run |
| SETTINGS-02 (comment) | PASS | A "Who can comment: Nobody": B posts on A's video -> "Could not send the comment" (no reason shown), nothing added. Restored to Everyone. Tag rule NOT run (B could not post, see below) |
| COMMENTS-01 keyboard | PASS (emulator) | comments sheet: composer + emoji row stay above the keyboard on the emulator; B comment with blue mention rendered, Delete confirm dialog works, comment deleted |
| CAMERA filters on emulator (virtual scene) | PASS | Create: live virtual-scene preview. Effects tray = None + 10 face effects (need a face, none in virtual scene) then looks (Faded Film, Dusk, Pastel, Retro, Cinema, Vivid, Silver, Ink, Sunset...). Silver turns the live preview greyscale, Cinema changes contrast; a 5 s recording with Silver reached the Post screen with a grey thumbnail. NOTE: at this build there is no separate Filters button (that split is in 248c3ad, not in this build); swipe on the preview did not change the filter in this build |
| Post from emulator | BLOCKED/FAIL (unclear) | Post (Followers, caption b_test_video) twice -> "Could not post / Check your connection and try again. Nothing was lost." with working network (everything else on B works). No error line in logcat. Not posted, nothing to clean. Needs a human retry (maybe emulator codec/upload path) |
| CHAT-04 | PASS | B sent a photo (test image pushed to the emulator gallery): appears on A's thread, tap opens full screen with X. (Phone library not used) |
| CHAT-05 | NOT RUN | needs a >1 week old photo |
| CHAT-10 | NOT RUN (partial) | both accounts already had an accepted thread; unfollowed each other and sent "req_test": it landed in the normal inbox (no new request), so request flow needs two accounts with no history |
| CHAT-11 | BLOCKED | group needs 3+ accounts; only 2 exist |
| LIVE-09 | PASS | B (96 test coins) selects Camel (300): dialog "Not enough coins / Top up your wallet to send this gift." CANCEL / TOP UP (Top up not pressed) |
| LIVE-10 | PARTIAL | share icon pressed on B: a dark overlay with a white bottom sliver appeared (system share sheet not captured). Not verified |
| LIVE-11 | PASS (UI only) | B "..." Options: View profile, Report this live, Report the host, Block user: none sent (the single test report was used on the profile flow) |
| LIVE-13 | PASS | host presses Back: "End your live? The live ends for everyone and can't be resumed." CANCEL / END LIVE |
| REPORT flow | PASS (1 report sent) | ONE test report sent: A reported account @allen1 (Allen), reason "Other" -> "Thanks, we received your report". This cannot be removed in the UI: the owner/admin should dismiss it in the reports queue |
| Follow after block | NOTE | blocking then unblocking removes the follow relationship both ways (counts 0/0 afterwards); I re-followed both ways by hand |
| Deep link flyp://home | NOTE (low) | unknown route shows the raw expo-router "Unmatched Route / Page could not be found / Sitemap" screen with a Go back link (dev-style page for users) |
| CALLS-04/05 | PASS | with B's screen locked (emulator has no PIN, so no keyguard) the call wakes the screen and shows the heads-up "user_59db0ede is calling you" with Decline/Accept; Accept from the notification starts the app (splash) and the call connects after about 20 s (slow cold start; "Connecting..." screen in between) |
| CALLS-04 intermittent | FAIL (medium, intermittent) | once (A called right after B left a live room via Back, B on the launcher) NO call notification arrived on B for 20+ s while A kept ringing; the next attempt (and all others) arrived within 6 s. Logcat shows nothing for the lost one. Suspect FCM delivery/doze on the emulator or the live-room exit; needs a repeat on a real second phone |
| CALLS-11 | PASS | A presses Back during a call: toast "The call continues. Tap the green bar to go back." |
| CALLS-12 | PASS | B Wi-Fi/data disabled (emulator only): call screen "Reconnecting... / Your connection dropped. Trying to get you back..."; after re-enabling the timer resumed (0:55) |
| Busy line | NOT RUN | needs a third account to occupy B |
| Call rate limit | NOTE | 10 calls/hour/pair (supabase 0094 line 102): refused attempts and cancelled calls also count, so a tester hits "Too many calls in a short time" after ~10 attempts |
| PUSH-05 | PASS | B received "user_59db0ede is live now" system notification (channel live) when A went live |
| SETTINGS-06 / PUSH-08 | INCONCLUSIVE | A turned Likes off then on; B unliked/liked A's video each time and no "liked your video" system push appeared in either state (a first like earlier did produce one), so a repeated like of the same video is probably de-duplicated server-side. Not a proof either way |
| NOT RUN (time/needs) | NOT RUN | PUSH-07 (Arabic push), CHAT-05, CHAT-07 on phone again, STORIES-08 (24 h), tag rule, 60 s video story, walkie exact 60 s, who-can-tag, hidden words from the 2nd side, map sharing both sides, busy line, group chat |

## Summary (approximate: sub-checks counted once each)
PASS about 40, FAIL/partial FAIL 6 (reaction and delete-for-everyone not realtime, Enter double send, intermittent missed call push, first-call mic permission, post from emulator), BLOCKED/NEEDS-HUMAN 5 (STORIES-04 admin bypass, MAP-03..09, CHAT-11, busy line, post upload), NEEDS-24H 1.

## Changes made to code
- mobile/src/features/chat/Composer.tsx: submit() ignores the same text submitted twice within 600 ms (lastSubmit ref). typecheck + eslint clean; NOT built or tested on a device.

## Leftovers
- Support/report: 1 account report on @allen1 (reason Other) from the tester account.
- Chat messages left in the A<->B thread (push_msg_1 x2, push_msg_2 x2, voice notes, photo, b_push_1, req_test, reaction, call rows); the "A_test_live"/"live2" lives (ended) and their notifications on both accounts.
- Tester account A: Who can comment restored Everyone; Likes notifications on. Owner account B: private OFF, who can message Everyone (both restored), 3 roses sent (test coins 100 -> about 96, test balance only), B's like on A's video removed, unfollow/follow churn restored (A and B follow each other).
- Emulator permissions granted to FLYP: microphone and camera.
- Story created on B was deleted. No video was posted (post failed).
