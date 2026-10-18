# Phase 4: applying migrations 0097–0111

These files add the database side of the client's change requests and fix
four bugs found while porting the app.

## Status (18 Oct 2026)

**Mumbai (`vfkwipvinmnybilcrdzr`)**: 0001–0109 applied, except 0015, 0040
and 0052, which are recorded as applied without running (superseded, or
demo seed data). Applied one file at a time through `supabase db query
--linked -f` because `db push` logs in as `cli_login_postgres`, whose search
path lacks `extensions` (`uuid_generate_v4()` not found).

- pg_cron 1.6.4 and pg_net 0.20.4 enabled.
- `media-reconcile` is **unscheduled** and its function not deployed: the
  bucket is shared with the old project and Mumbai's ledger is empty, so a
  sweep would delete the whole library.
- Deployed functions: agora-token, media-upload, moderate-content,
  suggest-tags, storage-alert (`--no-verify-jwt`), send-push
  (`--no-verify-jwt`).
- Still to do by hand: the job_endpoints / alert_config fix-up and the
  RECONCILE_SECRET / ALERT_SECRET secrets, then the provider secrets
  (Agora, R2, Firebase, Gemini, Resend).

**Old project (`qnzgxihlrwanywndcmpf`)**: none of 0097+ applied. The live
v1.4.25 app still runs there.

Later files, after the table below:

| # | File | What it does |
|---|---|---|
| 10 | `0106_walkie.sql` | Walkie-talkie: who may join a chat's voice channel |
| 11 | `0107_suggest_tags.sql` | Rate limit for AI hashtag suggestions |
| 12 | `0108_personal_feed.sql` | Personalised For You feed, seen-history, test batches for new videos |
| 13 | `0109_call_push.sql` | Cancels the ringing call notification when a call ends |
| 14 | `0110_media_delete_queue_processor.sql` | Deletes expired story files from R2 (not applied yet) |
| 15 | `0111_iap_verify.sql` | Store purchase verification for coins (not applied yet) |

Apply after 0001–0096, **in this order**:

| # | File | What it does | Client note |
|---|---|---|---|
| 1 | `0097_friends_privacy.sql` | Adds **Friends** (mutual follow) to who can message / comment / tag me | 13 |
| 2 | `0098_search_strips_at.sql` | Searching "@sara" finds sara | 30 |
| 3 | `0099_message_delivery.sql` | Delivered state per chat member, for sent / delivered / read ticks | 10 |
| 4 | `0100_latest_message_per_chat.sql` | Inbox reads one latest message per chat instead of every message | (speed) |
| 5 | `0101_post_location_and_tags.sql` | Place on posts, tagging people, profile map data | 21, 28 |
| 6 | `0102_stories.sql` | Stories (24 h), views, tray, nightly purge | 22, 25, 31 |
| 7 | `0103_live_guests.sql` | Viewers join the live as guests (request / invite / remove) | 6 |
| 8 | `0104_gifts_and_wallet.sql` | Horse, camel, falcon, dallah, dates gifts; coin packages; top-up records | 17, 12 |
| 9 | `0105_location_permit_fixes.sql` | Security fix for location tracking permits, see below | 27 |

Each file is safe to re-run and ends with check queries. Run those after
applying; every row should say OK / true.

## Bugs these fix in the CURRENT database too

- **Gifts have never worked** (0104). A gift notification uses type `'gift'`,
  which the notifications table rejects, so every gift rolled back. 0104 adds
  the type.
- **A person could approve their own location-tracking request, or create
  it already approved** (0105). Today this grants nothing only because of
  the next bug.
- **Approved tracking permits gave no access** (0105). 0032 dropped the rule.
  0105 restores it together with the fix above. Do not restore one without
  the other.
- **Each location update reset "public" sharing back to "friends", and could
  turn sharing back on** (0105, plus the new app).

## Edge Functions that changed (deploy after the migrations)

- `agora-token`: an accepted live guest gets the speaker (publisher) role
  (needs 0103).
- `media-upload`: story files are protected from deletion while a story
  uses them (needs 0102).

## Decisions for you or the client

1. **Friends-only messages are refused outright**, like "people I follow"
   today. They do not land in the Requests tray. Confirm this is wanted.
2. **Gift prices and coin packages** in 0104 are a proposal: horse 1500,
   camel 300, falcon 150, dallah 30, dates 15 coins; packages
   `flyp.coins.100` … `flyp.coins.6500`. The product ids must be created
   with exactly these names in App Store Connect and the Play Console.
3. **Buying coins needs a server-side receipt check** (an Edge Function
   `verify-purchase`, not written yet) using Apple's App Store Server API and
   Google Play's API, or RevenueCat. Apple requires In-App Purchase for coins.
4. **Exact GPS on public posts.** 0101 stores whatever coordinates the app
   sends. The app should send the chosen place's coordinates, not the
   phone's own position.

## Still to build (after this phase)

- A job that works through `media_delete_queue` (0102) so expired stories'
  files are deleted from R2. Until then they stay stored and count toward the
  storage ceiling.
- `send-push` cases for the new notification kinds (live guest invites,
  gifts, "tagged you"). They appear in the in-app list but not on the lock
  screen yet.
- Reporting a story (the `reports` table has no story type yet).
