# Round 2 testing: brief for the tester's Claude

Read `HANDOFF.md` and `TEST_PLAN.md` first. Same setup as round 1 (Android emulators, results as a new PR `test-results/<date>-round2`).

## Use the new build
GitHub → Actions → **Android dev build** → latest run on `feat/rn-phase1-foundation` (commit `18a22bc` or newer) → artifact `flyp-test-apk`. Uninstall the old APK first. Do not reuse the old one: the map, comment filter and call fixes are only in the new build.

## What changed since round 1 (retest these first)
| Round-1 failure | What was done | How to retest |
|---|---|---|
| Sign-up email had no code | Supabase Site URL, 5 email templates and OTP length (6) fixed | Sign up with a fresh address, expect a bilingual email from `no-reply@notify.flyp-sa.com` with a 6-digit code, enter it in the app. Also test forgot-password. |
| COMMENTS-09: rude comments not blocked | Server word filter (EN + AR) | Post "you are a stupid idiot", "fuck you" and an Arabic insult: each must be rejected with a "Comment not posted" alert and the text stays in the box. "That's a stupid rule" must still post. |
| DISCOVER-04: sound count doubles | Duplicate trigger removed, counts recomputed | Post one video with a sound; sound page must say 1 video. |
| CALLS-08: callee stuck on spinner after a missed call | Call screen closes itself, 8 s fallback | Two emulators: A calls B, B does not answer. B must see "Missed call" and return to the app, never a blank spinner. Repeat with B opening the app from the notification. |
| Map unavailable | Maps key now in the build | Discover → map button shows a real map (the emulator image needs Google Play services). |

## New features to cover (not in round 1)
- Reactivation on sign-in: deactivate an account, sign in again, expect the "Welcome back" toast.
- Appeals: Settings → Account status → Appeal a decision (needs a banned or hidden item; an admin can set one up).
- Creator payouts in Wallet (earnings, withdrawal flow); do not enter real bank details, use obviously fake test values.
- Stories from the profile photo and from Create (Video | Story switch).
- Drafts, place and tag-people pickers.

## Order of work
1. Post content first (videos, a story, comments) so the 91 "blocked" checks have data to run against.
2. Work through the previously blocked checks.
3. Then the retests and new features above.

Real-device checks (camera quality, push, background mic) are done by the owner on the Redmi, not on emulators.

Report each failure with: check id, steps, expected, actual, screenshot. Do not run database commands or edit the repo's source; report only.
