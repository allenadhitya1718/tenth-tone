# Phase 4 migration: inputs

Collected while porting `web/js/db.js` to `mobile/src/api/` (Phase 2). These
go into the new migration (`0097+`) together with the client-note items in
`CLIENT_NOTES_STATUS.md` ("Database work the RN rebuild needs"). Nothing here
has been applied anywhere.

## Bugs in the current schema (also affect the live web app)

1. **Location permits grant nothing.** 0032 replaced the `locations read`
   policy without the approved-permit clause 0004 had, and 0077 kept it out.
   Approving a tracking request changes nothing; `fetchTrackedLocations` only
   returns people already visible through public/friends sharing.
2. **A requester can approve their own permit.** The `permits update as
   target` policy allows `auth.uid() = requester_id`. Harmless only because of
   (1). **Fix both together**: restoring (1) alone would let anyone track
   anyone by approving their own request.
3. **Every location fix resets visibility.** The `upsertLocation` path writes
   `visibility = 'friends'` and `sharing_enabled = true` by default, so a
   'public' choice is lost and a fix while sharing is off turns sharing on.
   Better handled in an RPC that only updates coordinates.

## Performance

4. **Chat list and share targets read every message of every chat** to find
   each chat's latest message (`_fetchChatsRaw`, share recency). Replace with
   an RPC that returns one latest message per chat (`distinct on (chat_id)`).
5. **For You paging**: when `fetch_fyp_feed` returns no rows (past its end),
   the client falls back to the newest-public query at the same offset, so
   late pages repeat or mix. Have the RPC page itself to the end instead.

## Small fixes

6. `search_profiles` (0065): strip a leading `@` server-side too (client
   note 30; the app now strips it, the web app does not).
7. Use `(select auth.uid())` instead of `auth.uid()` in every new or touched
   policy, so it is evaluated once per query rather than once per row.
8. Visibility filters are inconsistent: `fetchSoundVideos`,
   `fetchHashtagVideos` and `fetchLikedVideos` do not exclude archived videos;
   confirm whether RLS already covers `is_hidden` / `is_archived` and add the
   missing filters in the app or the policy.
