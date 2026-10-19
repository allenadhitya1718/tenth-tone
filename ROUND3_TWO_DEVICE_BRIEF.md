# Round 3: two-device tests (brief for the tester's Claude)

Read `HANDOFF.md`, `TEST_PLAN.md` and `ROUND2_BRIEF.md` first. This round is only the checks that need **two users on two devices**. Everything else was already run on a real phone and is in `test-results/phone-run*-2026-10-19.md`.

## Setup
1. Branch `feat/rn-phase1-foundation`, pull the latest.
2. Newest APK: GitHub -> Actions -> **Android dev build** -> latest green run -> artifact `flyp-test-apk` (use `gh api repos/allenadhitya1718/tenth-tone/actions/runs/<id>/artifacts` and download the zip if `gh run download` fails with a path-traversal error; unzip it with a script that reads the entry into a file, do not extract by name).
3. Start **two** Android emulators (A and B): Android 14 (API 34) **Google Play** x86_64 images, 4 GB RAM each, camera = VirtualScene or Webcam0, microphone passthrough on. Install on both: `adb -s emulator-5554 install -r flyp-test.apk`, `adb -s emulator-5556 install -r flyp-test.apk`.
4. Two accounts: sign up **two fresh accounts** in the app (one per emulator) with two addresses you control (for example `yourname+flypA@gmail.com` and `yourname+flypB@gmail.com`); the sign-up email contains a 6-digit code to type into the app. Choose your own passwords; never reuse a real one and never share them. Make both accounts adults (18+) with a birth date. If an email does not arrive, check Spam and wait 1 minute, then report.
   Do NOT use or ask for the owner's accounts.
5. Make A and B follow each other (accept the request if one is private) so they count as friends for calls and the map.

## Checks to run (IDs are in TEST_PLAN.md; record PASS/FAIL/BLOCKED with evidence)
- **Chat:** CHAT-03 (read ticks turn blue on B opening the thread), CHAT-04/05/06/07/10/11/12 (voice note plays on B, image send/receive, delete message for me / everyone, reply, reactions, typing indicator, search, mute, block from chat).
- **Walkie-talkie:** all WALKIE-*.
- **Calls:** CALLS-02 to CALLS-13 (voice and video: ring on B, accept, mute, speaker, flip camera, end from either side, missed call -> the callee returns to the app (no stuck spinner), busy line, call while the app is in the background and with the screen locked on B, decline, the refusal screen when B blocks A or limits who can contact them).
- **Live (audio rooms):** LIVE-02, LIVE-05 to LIVE-11 (B joins A's room, listener count, guest invite and stage, comments, gifts (test coins only: the wallet shows a 100 coin test balance; do NOT buy anything), end of room for listeners).
- **Stories:** STORIES-03/04/05/08 (audience enforcement: 'friends only' story is hidden from a non-friend, viewers list, 24-hour expiry can be skipped: mark NEEDS-24H).
- **Notifications and push:** every NOTIF-* and the PUSH section: like, comment, follow, follow request, mention, message, call; with the app closed and in the background on B. Note: Google Play services are required for push; if the emulator shows `SERVICE_NOT_AVAILABLE` for the FCM token, mark BLOCKED with the log line.
- **Follow and privacy rules:** private account follow requests, who-can-message, who-can-tag, who-can-comment, block/unblock from A, hidden videos of a blocked user, report flows (send ONE test report, then say so).
- **Friends map:** both accounts opt in (choose 'Share my location' with a fake location set via the emulator controls), see each other, directions, stop sharing (the map works now: Google key fixed).
- **Camera filters on the emulator:** with the VirtualScene camera, check that filters show a coloured live preview and a filtered recording reaches the post screen (the emulator GPU may differ from real phones: report, do not fix).
- **Comments keyboard:** open the keyboard in Comments, Chat and Live: the input must be fully above the keyboard.

## Rules
- Test and report only. Do not edit the app's code, run database or Supabase commands, change any service settings, or touch the owner's accounts.
- Wallet, coins and creator payouts are being discussed with the client: only LOOK (layout/errors), never complete a purchase or enter bank/ID data.
- Never put passwords, tokens or keys into reports, screenshots or commits.
- Delete the test content you create when finished (posts, stories, comments), and tell the owner which accounts to delete.
- Record results in `test-results/phone-run5-two-device-<date>.md` (table by check ID: PASS/FAIL/BLOCKED/NEEDS-24H, evidence, logcat excerpt for each FAIL, screenshots in `test-results/`), commit on a branch `test-results/<date>-round3` and open a PR into `feat/rn-phase1-foundation`.
- Final summary: counts per status, the FAIL list (one line each), what could not be tested and why.
