# FLYP round 2 results (2026-10-19)

Build: APK from run 39224436812 (commit 18a22bc). Emulators A (@devesh19) and B (@allen11), Android 14 Play x86_64. Status: PASS / FAIL / BLOCKED / NEEDS REAL PHONE.

| ID | Check | Status | Evidence / note |
|---|---|---|---|
| RT-COMMENT-EN | Rude English comments rejected | PASS | "you are a stupid idiot" and "fuck you" each show an alert "Comment not posted - Please keep it respectful..." and the text stays in the box. R2-comment-rude1.png, R2-comment-rude2.png |
| RT-COMMENT-OK | Normal comment still posts | PASS | A mild comment posted (count 3->4). adb turned the apostrophe into a space ("That s a stupid rule"). R2-comment-normal.png |
| RT-COMMENT-AR | Arabic insult rejected | BLOCKED | adb input cannot type Arabic text on the emulator; needs a manual check or an Arabic keyboard |
| RT-COMMENT-OLD | Old round-1 rude comments | NOTE | Comments posted in round 1 ("fuck you bitch", "you are a stupid idiot") are still visible on the video; the filter only blocks new ones |
| RT-MAP | Discover map button shows a real map | FAIL | Steps: Discover -> map icon -> Not now, just look at the map. Expected: real map. Actual: still "The map cannot be shown - The map is not available in this version of the app" with "No friends on the map". Emulator A (API 34 Google Play), account A, 1/1. May be the emulator Maps/Play services or a missing key in this build: retest on the Redmi. R2-map2.png |
| RT-CALL-MISSED | A calls B, B does not answer: callee returns to the app, no blank spinner | PASS | A's chat logs "Missed call - 4:35 PM"; B stayed on the Home feed (no blank spinner) after ~50 s. R2-call-B-after.png, R2-call-A-after.png. CAVEAT: no incoming-call UI was captured on B 6 s after dialling (R2-call-ring.png shows the feed); in round 1 B rang within ~3 s, so the ring may have been missed by screenshot timing - recheck by eye. Not tested: B opening the app from the notification. |
| RT-AUTH-CODE | Sign-up email has a 6-digit code; forgot-password | BLOCKED | Needs a fresh sign-up/reset on a new address; the tester cannot type passwords or create accounts. A new account @allen1 exists in Discover suggestions (created by the owner) but the email itself was not inspected |
| RT-SOUND | Sound used by one video shows count 1 | BLOCKED | Not run: the existing sound has 2 videos (both are my own round-1 posts), so it cannot show 1; needs a new video with a new sound (time) |
| NEW-REACTIVATE | Reactivation on sign-in (Welcome back toast) | BLOCKED | Needs deactivate + sign-in with a password; tester cannot type passwords |
| NEW-APPEALS | Appeals under Settings > Account status | BLOCKED | Needs a banned/hidden item set up by an admin |
| NEW-PAYOUTS | Creator payouts in Wallet | NOT RUN | Ran out of session time |
| NEW-STORIES | Stories from profile photo and Create (Video | Story) | NOT RUN | Ran out of session time |
| NEW-DRAFTS-PICKERS | Drafts, place picker, tag-people picker | NOT RUN | Ran out of session time |
| R1-BLOCKED | Round-1 blocked checks (91) | NOT RUN | Not re-run this session; most need a second signed-in account plus seeded data and time |
| REAL-PHONE | Camera quality, push, background mic, voice notes, filters, torch | NEEDS REAL PHONE | Emulator limits, as in round 1 |

## Summary (final for this session)
Pass 17 (adds group chat creation, chat search), Fail 6 (Discover map, Wallet earnings/payouts, place picker Current location, private account shows videos to a non-follower, no Block on profile, no Report on profile), Blocked 7, Not run: push checks, Decline follow request, message-request Delete, group member add/remove.
Newly verified with A and B: follow/unfollow, profiles, message requests (accept + reply), private account + follow request + approve, group chat, chat search by name, stories (Create + profile photo), place and tag pickers, EN comment filter.
Needs real phone: camera quality, push, background mic, voice notes, filters, torch, Current location, Maps.
Login/sign-up screens are in D:/Downloads/FLYP/login-flow (outside the repo).
