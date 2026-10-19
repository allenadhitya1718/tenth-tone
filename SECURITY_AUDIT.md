# FLYP security audit — 2026-10-19

Scope: billing abuse, token/secret leakage, account and data compromise. Covers
`mobile/` (Expo app), `supabase/migrations` 0001–0111, every Edge Function, and
`web/` only where it touches the Mumbai backend (it doesn't — `web/js/supabase.js`
points at the old project).

Method: two agents. A finder read every migration (replayed 0001–0111 in order,
keeping the latest definition of each function, policy, trigger and grant), every
Edge Function and the mobile data layer and config, ran `npm audit`, and grepped
for secrets. It worked from the checklists in cloudflare/security-audit-skill,
alibaba/open-code-review and coder/coder, thinking like an attacker who has the
anon key and one normal account. A fixer then fixed the findings, and the finder
re-verified every fix. That loop ran three rounds.

> **Limitation:** none of this was checked against the live DB. The Supabase MCP
> connected to this session belongs to another account and has no access to
> `vfkwipvinmnybilcrdzr`. Each migration ends with SELECT-only check queries.
> Run them after applying, and run the Security Advisor (Dashboard → Advisors).
> In particular, confirm F02 with
> `select proname, proacl from pg_proc where proname in ('self_topup','self_withdraw');`
> **before** applying 0112. 0112 drops both functions either way.

Nothing is committed, applied or deployed. The other session's commit `db5e118`
already contains some of the round-1 Edge Function edits (verify-purchase,
media-upload daily cap, constant-time secret compare). Everything else is still
uncommitted in the working tree.

## Findings

| ID | Sev | Area | Issue | Status |
|---|---|---|---|---|
| F01 | Critical | RLS / privacy | A direct `INSERT into follows` skipped private-account approval, and "friends" location meant "follows you". Any stranger could read exact live GPS and private posts, stories and lives. | **Fixed** 0113 (+0123 lives) |
| F02 | Critical | Wallet | `self_topup` / `self_withdraw` were never revoked from PUBLIC. Likely an unlimited coin mint. | **Fixed** 0112 (dropped) |
| F03 | High | Calls / Agora | Anyone could call `call_member_set` to mark themselves joined in any call, and the client chose the call channel. That got them a publisher token to eavesdrop or hijack. | **Fixed** 0114 |
| F04 | High | Rate limits | Every rate trigger trusted the client's `created_at`, so back-dating bypassed all limits (spam plus push fan-out). Messages with `type='call'` skipped limits. Like and follow loops re-sent pushes. | **Fixed** 0115, 0121, 0125 |
| F05 | High | Messaging | A blocked user, or someone you limited, could add you to a group and message and push you. A 3-member "dm" passed the DM checks. | **Fixed** 0116 + `api/chat.ts` |
| F06 | High | Moderation / fan-out | Owners could un-hide moderated videos and fake counters. Hosts could un-ban lives. ended→live flips re-notified every follower, and lives sent duplicate notifications. | **Fixed** 0117 |
| F07 | High | Agora | The token function issued tokens for any channel and accepted client-chosen uids (eavesdrop, kick the host, billing). No throttle. | **Fixed** agora-token + 0120. The uid is always derived on the server. Calls need membership. Lives need a visible stream with status 'live'. 600 tokens/hour and 3000/day, fails closed. 1h TTL kept. |
| F08 | Med-High | R2 cost | Uploads signed but never confirmed escaped the quota and were never cleaned up (about 23 GB/day per account). | **Fixed** 0118 + 0138 + media-reconcile (rewritten). Pending uploads count for the whole day, max 200 signed URLs/day. Cleanup never lists the shared bucket: it deletes only keys in this project's `media_objects` ledger that are `pending`, >= 24 h old, well-formed and unreferenced. Daily dry run is scheduled; **deletion is OFF until the owner sets `reconcile_config.live = true`** (`supabase/RUN_NOW_schedule_reconcile.sql`). |
| F09 | Medium | Calls | Anyone could ring anyone with a full-screen push, and could insert a call as 'accepted'. | **Fixed** 0114 (`may_ring`: needs an existing relationship, server forces 'ringing'). Behaviour change: a first call to a stranger is refused. |
| F10 | Medium | IAP | Sandbox and TestFlight purchases credited real coins by default. | **Fixed** verify-purchase. Sandbox credits need `IAP_ALLOW_SANDBOX=true`, the buyer in `IAP_SANDBOX_USER_IDS`, and owner = buyer. |
| F11 | Medium | Gemini | No per-user limit. Screening is optional for the client. | **Fixed** moderate-content + 0120 + 0140. 150/hour and 1000/day, fails closed. New videos, stories and comments are stored hidden (`pending_review`) by a database trigger and screened by the server, so a modified client cannot skip it. Gemini down or over limit: released after 5 minutes with an admin queue entry. Still client-only: live titles/covers and profile text/avatars. |
| F12 | Medium | Data leak | Comments, likes, live chat and live viewers of private or friends-only content were readable with the anon key. | **Fixed** 0119 |
| F13 | Medium | Config | Builds without EAS env vars silently used the OLD project. | **Fixed** `lib/config.ts`, `eas.json` (public Mumbai URL and publishable key) |
| F14 | Medium | Deep link | `flyp://call/dial?to=…&name=Mom` placed a call at once, with a spoofed name. | **Fixed** `dial.tsx` + new `DialConfirm.tsx` |
| F15 | Low-Med | Info leak | Helper RPCs (setting_*, has_blocked, is_friend, may_*, can_view_story, …) answered for arbitrary user ids. | **Fixed** 0112, 0118, 0122 (`called_as_rpc()` guard) |
| F16 | Low | Profiles | Every user could read `is_admin`, `banned_until`, `deactivated_at` and `deletion_scheduled_at` for everyone. | **Fixed** 0124 (column grants; Mumbai only) + `api/profiles.ts` |
| F17 | Low | Resend | Any user could call `check_storage_alert()` and trigger alert emails. | **Fixed** 0112 |
| F18 | Low | Ranking | Shares and watch time were unbounded. | **Fixed** 0115 |
| F19 | Low | Secrets | Secret headers were compared with `===`. | **Fixed** constant-time compare in send-push, media-delete-queue, media-reconcile, storage-alert |
| F20 | Low | Storage | Public buckets had no MIME allow-list (HTML/SVG hosting). | **Fixed** 0118 |
| F21 | Low | Push | Any token string could be registered under your own account. | **Accepted risk**: it only redirects your own notifications. |
| F22 | Low | DB bloat | client_logs, saves, reactions and engagement had no rate limit. | **Fixed** 0115, 0121. The story_views claim was a false positive (already gated by stories RLS). |
| F23 | Low | npm | 25 High, 0 Critical (`npm audit --omit=dev`; 27 with dev deps). All build-time. | **Not fixable with overrides**: the High findings are node-forge <= 1.4.0 and braces <= 3.0.3, and the registry's latest versions are 1.4.0 and 3.0.3 (no patched release exists). The rest cascade from those. An `xcode -> uuid ^11.1.1` override clears the 9 moderates only, so it was not applied. package.json untouched. |
| F24 | Low | Keys | The Firebase client key in `mobile/google-services.json` is unrestricted. It's not a secret, but it's not gitignored either. | **Needs user** (restrict the key) |
| N1 | Bug | Account deletion | The app called `self_delete_account`, which is service-role only, so in-app deletion failed (App Store 5.1.1(v)). | **Fixed** `api/settings.ts` → `schedule_account_deletion`. The purge cron is ensured in 0121. |
| R1 | Medium | Follow requests | (found in round 2) request → cancel → request sent unlimited pushes to private accounts. | **Fixed** 0125 |
| R2 | Low | Live | `join_live_stream` didn't check visibility. Friends-only live notifications went to one-way followers. | **Fixed** 0125 |

Checked and OK: RLS is on for every table. Every SECURITY DEFINER function has a
fixed `search_path`, and none builds dynamic SQL from user input.
`guard_profile_privileges`, the wallets and `send_gift`, and `credit_wallet_topup`
(service only) are sound. Notifications can't be inserted by the client. The
secret-gated functions (send-push, storage-alert, media-delete-queue,
media-reconcile) require their secrets. suggest-tags is rate-limited. media-upload
picks the key on the server and signs size and type, with a 120 s expiry, HEAD
verification and an owner-only delete. Admin RPCs check `is_admin()`. DMs,
chat-media and walkie are restricted to members. The on-device session is
AES-encrypted with its key in SecureStore. There are no server secrets in the repo.

## What was changed

- **Migrations (new):** `supabase/migrations/0112_wallet_and_grants.sql` …
  `0125_follow_requests_and_live_join.sql` (14 files). Each one is re-runnable
  and ends with check queries.
- **Edge Functions:** agora-token, moderate-content, media-upload,
  verify-purchase, send-push, media-delete-queue, media-reconcile, storage-alert.
- **Mobile (JS only; no new native build needed, just reload the dev client):**
  - `src/lib/config.ts`, `eas.json`, `BUILD_GUIDE.md`
  - `src/api/{agora,calls,chat,moderation,profiles,settings}.ts`
  - `src/features/call/{nav.ts,callSession.ts,DialConfirm.tsx (new)}`, `src/app/(app)/call/dial.tsx`
  - `src/features/chat/{NewChat.tsx,walkie/useWalkie.ts}`, `src/features/live/{config.ts,useAgoraAudio.ts}`
  - i18n `call`, `chat` and `map` feature files in all 9 languages
- **Checks (mobile/):** `tsc --noEmit` clean. `eslint src` has 0 errors and 2
  pre-existing warnings in `src/i18n/index.ts`. `expo-doctor` passes 20/20.
  `deno check` was not run (deno isn't installed); a TypeScript syntax pass was clean.

## Apply / deploy, in this order (Mumbai `vfkwipvinmnybilcrdzr` only)

**Never apply any of these to the old project `qnzgxihlrwanywndcmpf`.** 0124
would break the old web app there.

1. Pre-check F02 (query above). Optionally save the result for a clawback decision.
2. Apply the migrations one at a time, the same way as before (`db push` lacks `extensions` on its search path):

```bash
cd /home/allen-adhitya/Documents/tenth-tone && for f in 0112_wallet_and_grants 0113_follows_privacy 0114_calls_hardening 0115_rate_limit_backdate 0116_messaging_and_groups 0117_moderation_guards 0118_media_and_storage 0119_privacy_reads 0120_edge_rate_limits 0121_notification_dedupe_and_rates 0122_helper_rpc_guards 0123_live_friends_mutual 0124_profile_private_columns 0125_follow_requests_and_live_join; do echo "== $f"; npx supabase db query --linked -f supabase/migrations/$f.sql || break; done
```

   Then run the check queries at the bottom of each file. The behavioural tests in
   the 0114, 0115 and 0116 comments are best run on a Supabase branch first.
3. Set function secrets (Dashboard → Edge Functions → Secrets):
   `IAP_ALLOW_SANDBOX=false`. During App Review only, set it to `true` and put the
   review demo account's user id in `IAP_SANDBOX_USER_IDS`.
4. Deploy the functions (only after 0120 is applied, otherwise agora-token and
   moderate-content return 503):

```bash
npx supabase functions deploy agora-token moderate-content media-upload verify-purchase
```

```bash
npx supabase functions deploy send-push storage-alert media-delete-queue --no-verify-jwt
```

   **Do not deploy media-reconcile yet.** It is still unsafe while the R2 bucket is
   shared with the old project (it would sweep the old library). Its code change is
   only the constant-time compare.
5. Reload the dev build, then test: a 1:1 call and a group call (the uid is now
   server-derived), joining a live, walkie, follow and unfollow on a private
   account, creating a group that includes someone with "who can message me" off,
   publishing a video, and in-app account deletion.

## Remaining risks and recommendations (needs you)

- **Agora:** set a usage alert and a monthly cap in the Agora console. Tokens still
  last 1h.
- **Cloudflare R2:** set a billing alert. media-reconcile is deployed and runs a
  daily DRY RUN (0138); review `admin_logs` and then enable deletion with
  `supabase/RUN_NOW_schedule_reconcile.sql`. It only touches this project's own
  ledger keys, so the shared bucket is safe.
- **Google / Gemini:** set a quota cap and budget alert on the Gemini key. Restrict
  the Firebase/Android API key to package `com.flyp.app` plus the release and
  upload SHA-1s. Restrict any Maps key the same way.
- **Resend:** a hard server-side cap of 50 emails/day (0139, `email_config.daily_cap`) now guards storage-alert, the only code that calls Resend; refusals are logged to `admin_logs` (`email_cap_hit`). Also set a limit in the Resend dashboard. Auth emails use Supabase Auth SMTP and are outside this cap.
- **Supabase:** set a spend cap or usage alerts. Enable Auth CAPTCHA (hCaptcha or
  Turnstile) on sign-up and OTP to stop mass account creation, since every per-user
  limit multiplies by the number of accounts.
- **Optional hardening:** Play Integrity / App Attest on verify-purchase and
  agora-token. Moderation of live titles/covers and profile text/avatars on the server. A content hash to stop re-posting removed media.
- **Accepted behaviour changes:** a first call to a stranger is refused (F09).
  Groups skip members who don't accept DMs from you (a toast tells the creator).
  Friends-only location and lives now mean a mutual follow. The same account on two
  devices shares one Agora uid, so the second device bumps the first.
- **Schema rule after 0124:** a new `profiles` column is unreadable by users until
  it's granted (`grant select (col) on public.profiles to anon, authenticated`).
  Don't re-run `RUN_NOW.sql`: it would restore the old `live insert own` policy.
- **Coins already minted** via `self_topup` (if F02 was live): 0112 contains a
  commented query to list them.
- **npm:** recheck `npm audit` after the next Expo SDK bump.
