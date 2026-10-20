# Phone run 8 (2026-10-20, build be9b8e2): PAUSED BY OWNER, partial

| id | status | note |
|---|---|---|
| P1c cold start | PARTIAL PASS | force-stop + `am start -W`: COLD, TotalTime 1854 ms and 2190 ms. After launch the activity stayed resumed; `dumpsys activity top` had no "splash" match from t=1.5 s to 9 s. gfxinfo after launch (reset before): ~440 frames, janky 3-4 %, p50 12 ms, p90 20-22 ms, p95 28 ms, p99 133-150 ms (startup hitches). First screen was the For You feed with the Delete action visible on own video (video area still dark at the time of the screenshot). Touch responsiveness NOT measured (no taps sent). |
| Note | NOTE | On the first launch another app (not FLYP) was in front when I looked ~10 s later (owner using the phone); not touched. |
| P1a feed swipes | not run: paused by owner |
| P1b double-tap like / single-tap pause | not run: paused by owner |
| P1d welcome/login/onboarding | not run (needs logged-out view: NEEDS-OWNER; code in mobile/src/components/AnimatedSplash.tsx and src/app/_layout.tsx not reviewed yet) |
| P1e camera Filters/Effects/Beauty | not run: paused by owner |
| P1f captions See more/less, Delete video | not run: paused by owner (Delete action is visible in the feed rail on own video) |
| P1g Discover map / Maps key | not run: paused by owner |
| P1h tabs/search/profile speed | not run: paused by owner |
| Priority 2 | not run: paused by owner |

No code changes. Nothing created on the phone or account. Screenshots deleted.
