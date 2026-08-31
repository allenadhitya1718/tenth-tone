# Migration state — verified against the live database

**Verified:** 2026-08-30, by querying the database directly (not by reading the
bundle files, which were all wrong — see below).

## Current state

**`0001`–`0051` are applied**, with one deliberate exception:

| Migration | State | Note |
|---|---|---|
| `0001`–`0014` | applied | |
| `0015_ai_moderation` | **deliberately NOT applied** | Needs a paid moderation API (Sightengine, ~$29/mo minimum for video — their free tier is images only) and the `pg_net` extension. Apply only if that account exists. |
| `0016`–`0047` | applied | |
| `0048_security_fixes` | applied 2026-08-30 | **Critical.** Any user could set their own `profiles.is_admin`. Also forged call-record messages, a reaction that could be moved into a private chat, and viewer counts anyone could rewrite. |
| `0049_blocking_fixes` | applied 2026-08-30 | Blocked users could still comment, message, and read your videos; blocks left follows intact. |
| `0050_rate_limits` | applied 2026-08-30 | Follows, comments, messages, reports, likes, broadcasts. Verified 6 of 6 triggers active. |
| `0051_enable_scheduled_jobs` | applied 2026-08-30 | See the note below — the SQL alone was not enough. |
| `0052_fix_counter_guard` | **superseded by 0053** | Its repair UPDATE was reverted by the very guard it was fixing, because `auth.uid()` is null in the SQL editor. Do not run it. |
| `0053_follow_requests_and_counter_repair` | applied 2026-08-30 | Following a private account had never worked — `follow_or_request` inserted notification type `follow_request`, which the check constraint rejected. Also repairs the counters 0052 failed to. |
| `0057_reply_and_accept_notifications` | applied 2026-08-31 | Replying to a comment notified the video's owner instead of the person replied to. Accepting a follow request told the account owner, never the requester who was waiting. Reuses existing notification types, so no constraint change. |
| `0058_close_avatar_quota_bypass` | **NOT applied — run this** | **Security.** The `avatars` bucket bypassed the upload quota entirely: 0031 gated `videos` and `chat-media` but left 0001's avatars policy alone, so any account could write unlimited 5 MB files, ignoring the daily AND global ceilings. Confirmed by test, not by reading. Also adds the missing `group-photos` insert policy — that bucket had none, so group photo uploads were failing for everyone. |
| `0054_block_visibility_and_private_lists` | applied 2026-08-30 | Instagram-style blocking; a private account's follower list was public. |
| `0055_follower_list_rpcs` | applied 2026-08-30 | 0054's row policy hid public accounts' follower lists too — a row policy cannot know whose list is being viewed. `list_followers` / `list_following` decide per-viewer instead. |
| `0056_remaining_rate_limits` | applied 2026-08-30 | videos (row insert), live_comments, chats, calls. Corrects 0050's note claiming videos were already covered — the upload quota guards the file, not the row. Verified 4 of 4 triggers and 3 of 3 indexes. |

### pg_cron had to be enabled from the dashboard

`0032` and `0034` each registered a nightly job, but both were wrapped in
`if exists (select 1 from pg_extension where extname = 'pg_cron')`. The
extension was never enabled, so **both silently did nothing for months** —
account deletion never completed past its 30-day grace period, and location
history was never purged. The app's own privacy screen promises both.

`create extension if not exists pg_cron;` in the SQL editor did **not** work.
It ran without error and changed nothing. It had to be toggled on in
**Database → Extensions**, after which `0051` registered the jobs.

Confirmed active:

| Job | Schedule |
|---|---|
| `purge-scheduled-deletions` | `30 3 * * *` |
| `purge-stale-locations` | `0 3 * * *` |

The lesson worth keeping: a guard that degrades quietly is only safe if
somebody later checks whether it degraded. Nobody did, for months.

## The bundle files are stale — do not follow them

Three "paste this into the SQL editor" bundles sit in `supabase/`. Every one of
them understates what is applied, because each was written at a different time
and never updated:

| File | Claims outstanding | Actually |
|---|---|---|
| `APPLY_ALL.sql` | `0005`, `0006`, `0017`–`0027` | all applied |
| `REMAINING.sql` | `0028`–`0030` | all applied |
| `migrations/RUN_NOW.sql` | `0035`, `0038` | both applied |

Following `RUN_NOW.sql` would mean re-running two migrations that are already
live. They are all written to be safe to re-run, so nothing would break — but
the instruction is wrong, and it cost real time to work out that it was.

Keep them only as history. **This file is the source of truth.**

## Re-verifying

The state above was established with the query below. It reports one row per
object that a migration creates: a populated `found` means that migration is
applied, `null` means it is not. Re-run it any time rather than trusting a
bundle file, or this file, or a handoff document.

```sql
select '0031 app_limits'            as object, to_regclass('public.app_limits')::text as found
union all select '0031 within_upload_quota',   to_regprocedure('public.within_upload_quota(uuid)')::text
union all select '0032 stop_sharing_location', to_regprocedure('public.stop_sharing_location()')::text
union all select '0033 support_tickets',       to_regclass('public.support_tickets')::text
union all select '0034 deactivate_account',    to_regprocedure('public.deactivate_account()')::text
union all select '0035 extract_handles',       to_regprocedure('public.extract_handles(text)')::text
union all select '0035 search_handles',        to_regprocedure('public.search_handles(text,integer)')::text
union all select '0035 mention trigger',       (select tgname::text from pg_trigger where tgname = 'trg_notify_video_mentions')
union all select '0037 admin_queue_counts',    to_regprocedure('public.admin_queue_counts()')::text
union all select '0038 close_stale_live',      to_regprocedure('public.close_stale_live_streams(integer)')::text
union all select '0038 live insert policy',    (select policyname::text from pg_policies where tablename = 'live_streams' and policyname = 'live insert own')
union all select '0039 admin_delete_user',     to_regprocedure('public.admin_delete_user(uuid)')::text
union all select '0039 purge_scheduled_del',   to_regprocedure('public.purge_scheduled_deletions()')::text
union all select '0040 seed accounts',         (select count(*)::text from public.profiles where handle like 'flyp\_%')
union all select '0041 last_read_at col',      (select column_name::text from information_schema.columns where table_schema='public' and table_name='chat_members' and column_name='last_read_at')
union all select '0041 mark_chat_read',        to_regprocedure('public.mark_chat_read(uuid)')::text
union all select '0041 chat_unread_counts',    to_regprocedure('public.chat_unread_counts()')::text;
```

Two traps worth knowing when extending this query:

- **Check what a migration actually creates.** `0038_live_streaming` adds
  *policies* to `live_streams`; the table itself comes from an earlier
  migration. Testing for the table reports "applied" either way.
- **`0040_seed_accounts` inserts data, not schema.** It is checked by counting
  the five `flyp_*` profiles it creates, not by looking for an object.

## Counters

Counters were rebuilt with `RECOUNT_STATS.sql`. Across the original 9 videos
there were **3 likes, 3 comments, 3 saves**, and the 7 seeded demo videos
legitimately show 0 engagement. **That is correct** — do not "fix" it by
re-inflating the numbers.
