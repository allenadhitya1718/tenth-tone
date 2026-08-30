# Tenth Tone — production-readiness audit

Checked against an 18-point production-grade checklist, 2026-08-30.
Every line below was verified against the actual code or database, not assumed.

**Summary: 7 strong, 4 partial, 6 genuine gaps, 1 that does not apply.**

The database and security work are genuinely good — better than most first apps.
The gaps are all in the surrounding engineering: testing, monitoring, rate
limiting, and having somewhere safe to try things.

---

## Already solid

### 2. Database design — STRONG
43 tables, foreign keys throughout, composite primary keys, check constraints,
timestamps. Row Level Security enabled on **all 43 tables** — that is the thing
most first apps get wrong, and it is right here.

Indexes were audited: 65 foreign keys checked, the hot paths (feed, likes,
saves, watch history, blocks) already covered by their primary keys. One real
gap found and fixed (`0047`, `follows.followed_id`).

Missing: **soft deletion**. Deletes are permanent. `videos` has `is_archived`,
but nothing else does. Worth adding before launch for anything a user could
delete by mistake, and for moderation review.

### 4. Authentication and authorization — STRONG
Authorization is enforced in the database, not in the screens. Private accounts,
blocks, mutes, restricts, admin roles, chat membership — all checked by RLS
policies and security-definer functions.

The helper pattern (`is_chat_member`) exists specifically because a naive policy
caused infinite recursion, and that was found and fixed properly in `0018`.

### 9. Feed — STRONG
Exactly the deterministic model recommended: engagement score + freshness +
personalisation, with anti-repeat so one creator cannot fill the page.
No black-box AI. Good.

Caveat under gaps: it pages by offset, not cursor.

### 11. Moderation — STRONG
Report content, report users, block, mute, restrict, hidden words, auto-hide at
5 distinct reporters in 24h, admin reversal path, community guidelines gate,
admin dashboard with reports/logs/tickets/deletions. This is more complete than
many launched apps.

### 8. Caching — DONE (built 2026-08-30)
Client-side cache with TTLs, stale-while-revalidate, request collapsing, and
persistence across app restarts. Keyed per user, cleared on sign-out.

### 5a. XSS — CLEAN (verified)
No user-supplied text is ever injected as HTML. Every `html:` and `innerHTML`
use in the app is an app-controlled icon. User text goes through
`document.createTextNode`, including the mention/hashtag parser. Verified by
scanning every occurrence.

### 5b. Secrets — CLEAN (verified)
No `service_role` key, no Agora certificate, no private keys anywhere in the
client bundle or the repo. `.pexels-key` is correctly gitignored. The Supabase
anon/publishable key in `supabase.js` is *meant* to be public — RLS is what
protects the data.

---

## Where the advice does not fit this app

### 3. "Build a real API layer" — ALREADY SATISFIED, DIFFERENTLY
The checklist assumes a browser → your server → database shape, and says to put
validation on your server.

This app is browser → Supabase. That is a deliberate, legitimate architecture
(a "backend as a service"), and **the validation layer exists — it lives inside
the database**: RLS policies, check constraints, and security-definer functions
that the client cannot bypass.

The underlying principle — *never trust the client* — is satisfied. A user can
call the database directly and will still be refused. Building a separate API
server would be a very large rewrite for little security gain at this stage.

Worth revisiting only if you later need something the database cannot do:
third-party API keys that must stay secret, heavy processing, or webhooks.

### 8b. "Use Redis"
Redis is a server-side cache. There is no server tier here for it to live in,
and adding one would put an extra network hop in front of every cache miss —
making misses *slower* than today. A shared cache in front of per-user RLS data
is also a way to serve one account's rows to another. Client-side caching was
the correct answer here and is done.

### 1b. "Use TypeScript"
A real trade-off, not a free win. The app is vanilla JS with **no build step** —
you edit a file and reload. TypeScript needs a compiler, a build pipeline, and a
migration of ~500KB of existing code. Worth it for a team; expensive for one
person mid-project. Not a correctness issue.

---

## Genuine gaps, in priority order

### 1. No rate limiting — HIGH RISK
Only support tickets are rate limited (`0033`). Nothing else is.

Today anyone can call your database in a loop: sign-up attempts, follows, likes,
comments, uploads, messages. That means spam, harassment at scale, and a storage
bill you did not authorise. This is the gap most likely to actually hurt you,
because it is exploitable by anyone who reads your JavaScript — which is
everyone.

Fixable inside Postgres with per-user counters and a trigger, the same shape as
the support-ticket limiter that already exists.

### 2. No error monitoring — HIGH
Nothing reports failures. If the app breaks for a user in Riyadh at 2am, you
find out when they tell you, and you have no idea what happened.

Sentry has a free tier and is roughly twenty lines to add.

### 3. No automated tests — HIGH
Zero. Every check so far has been me reading code and clicking. That does not
scale and does not survive a change made six months from now.

Critical flows to cover first: signup, login, post a video, follow, like,
comment, send a message, block, delete account.

### 4. No staging environment — HIGH
One Supabase project. Every migration run so far has been executed **directly
against the real database holding real users**. A bad migration has nowhere to
fail safely.

A second Supabase project used as staging is the fix, and it is free.

### 5. Offset pagination in the feed — MEDIUM
`fetch_fyp_feed` uses `p_offset`. At page 50 the database walks and discards the
first 1,000 rows every time, and rows shift under you as new videos arrive, so
you can see duplicates or miss posts.

Cursor pagination (remember the last item, ask for what comes after it) fixes
both. Matters at scale, not today.

### 6. No background jobs — MEDIUM
Everything happens while the user waits. Video compression runs **on the phone**,
which is slow and drains battery. Notification fan-out (the live alert I added
in `0045`) writes a row per follower inside the trigger — fine for 50 followers,
not for 50,000.

### 7. Media pipeline incomplete — MEDIUM
Has: client-side compression, size and duration limits, storage-policy quota
enforcement, on-device nudity detection.
Missing: a CDN, server-side transcoding, generated thumbnails, and multiple
qualities for different connections. Videos are served straight from Supabase
storage.

### 8. CI/CD is build-only — MEDIUM
Two workflows, both of which build the app. No linting, no type checking, no
tests, no staging deploy. Nothing stops broken code being built and shipped.

### 9. Documentation gaps — LOW
Twelve `.md` files, mostly setup and store checklists. `BACKEND.md` exists.
Missing: `ARCHITECTURE.md`, `DATABASE.md`, `SECURITY.md`. Also — and this is
worth doing first — three SQL bundle files (`APPLY_ALL.sql`, `REMAINING.sql`,
`RUN_NOW.sql`) contradict each other about what has been applied and are now
actively misleading. `MIGRATION_STATE.md` records the truth; the other three
should go.

### 10. views.js is 359KB in one file — LOW but growing
Not a correctness problem, and the layering is actually fine (screens call
`API.*`, which is the only thing that talks to the database — that separation is
correct). But one file holding every screen is hard to navigate and easy to
break. Splitting it by screen is mechanical, low-risk work.

---

## Not yet done

### 16. Performance / load testing
Not attempted. Worth doing after rate limiting exists, or a load test is
indistinguishable from an attack.

### 5c. Access-control testing
RLS is enabled everywhere and looks correct, but **has never been independently
tested**. "Switched on" and "correct" are different things. The real test is to
sign in as user A and try to read user B's private data directly, bypassing the
app entirely.

This is the single highest-value test to run before launch.

---

## Suggested order

1. **Test RLS with two accounts** — cheap, and the consequence of being wrong is
   the worst on this list
2. **Rate limiting** — the most exploitable gap
3. **Staging project** — so everything after this is safe to try
4. **Error monitoring** — twenty minutes, permanent benefit
5. **Tests for the critical flows**
6. **Delete the three misleading SQL bundles**
7. Then: cursor pagination, background jobs, CDN, splitting views.js
