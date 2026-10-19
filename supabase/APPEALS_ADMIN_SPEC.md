# Appeals: admin page spec (admin-v2)

Backend: `supabase/migrations/0132_appeals.sql` (Mumbai project, after 0131).
The app side already exists: Settings > Account status > "Appeal a decision"
(`mobile/src/features/appeals/`), and a banned screen that links to it. The
terms promise "Appeals are reviewed by a person"; this page is that person's
queue.

## What an appeal is

| column | meaning |
|---|---|
| `id` | uuid |
| `user_id` | who appealed |
| `kind` | `ban` (account suspension) or `content` |
| `target_type` | `user` (only for `ban`), `video`, `comment`, `story`, `live_comment`, `live_stream` |
| `target_id` | the user id for a ban, otherwise the content id |
| `reason` | the user's text, 1-1000 chars |
| `status` | `open`, `accepted`, `rejected` |
| `admin_note` | reviewer's note (required on reject, optional on accept; shown to the user) |
| `created_at`, `decided_at`, `decided_by` | |

What the user can appeal (server-checked on insert): an active ban; their
video or comment that is hidden (by an admin or by the report threshold,
`hidden_reason` `auto: ...`); their video / comment / story / live comment an
admin deleted (from `admin_logs` `delete_*` with `payload.owner`); their live
stream an admin ended (`live_streams.status = 'banned'`). Limits: 3 open
appeals per user, one open appeal per target, and no new appeal for a target
after a decision unless it was actioned again later.

## RPCs (all SECURITY DEFINER, refuse unless `is_admin()`, error `42501`)

### `admin_v2_appeal_counts() -> jsonb`
`{ open, accepted, rejected, oldest_open_at }`. Use for the tab counts and a
sidebar badge (open).

### `admin_v2_list_appeals(p_status text = 'open', p_limit int = 50, p_offset int = 0)`
`p_status`: `open` | `accepted` | `rejected` | `all`. Limit is capped at 200.
Open is sorted oldest first (work the queue in order); the others newest
decision first. Returns rows:

```
id, user_id, user_handle, user_name, user_avatar_url, user_banned_until,
user_appeals_total, kind, target_type, target_id, reason, status, admin_note,
created_at, decided_at, decided_by, decided_by_handle, target jsonb
```

`target` is the target as it is now:

| target_type | keys |
|---|---|
| `user` | `exists, still_actioned, banned_until, ban_reason, banned_at` |
| `video` | `exists, still_actioned (= is_hidden), description, thumbnail, video_url, hidden_at, hidden_reason, created_at` |
| `comment` | `exists, still_actioned, text, video_id, hidden_at, hidden_reason, created_at` |
| `live_stream` | `exists, still_actioned (= status 'banned'), title, thumbnail, status, started_at, ended_at` |
| `story` / `live_comment` (still present) | `exists, still_actioned: false, ...media / text` |
| anything deleted | `exists: false, deleted: true, deleted_at, delete_reason` |

`still_actioned: false` means the action was already undone some other way
(ban expired or lifted, video unhidden); accepting then changes nothing but
still closes the appeal and notifies the user.

### `admin_v2_decide_appeal(p_appeal uuid, p_accept boolean, p_note text = null) -> jsonb`
Returns `{ id, status, restored }`. Errors: `not found`, `appeal already
decided`, `a note is required to reject an appeal`, `note too long (max 1000)`.

Accept:
- `user` (ban): calls `admin_v2_set_ban(user, null, 'appeal accepted: <note>')`
  -> `restored: 'unbanned'` (logs `unban_user`).
- `video` / `comment` still hidden: `admin_v2_set_hidden(type, id, false, 'appeal accepted')`
  -> `'unhidden'` (logs `unhide_content`).
- `live_stream` still `banned`: status -> `ended` (back in the host's history)
  -> `'live_unbanned'` (logs `unban_live`).
- deleted content (any type) or `story` / `live_comment`: nothing can be
  restored -> `'deleted_cannot_restore'`. Say so in the UI before accepting.
- otherwise `'none'`.

Both outcomes: the appeal row is closed, `admin_logs` gets `appeal_accepted` /
`appeal_rejected` (`target_type 'appeal'`, payload user, kind, target, note,
restored), and the user gets a `notifications` row: type `system`, payload
`{ kind: 'appeal_decided', outcome: 'accepted'|'rejected', appeal_id,
appeal_kind, target_type, target_id, restored, note, title (ar), body (en) }`.

## Page layout

Sidebar entry "Appeals" with the open count badge (`admin_v2_appeal_counts`).

**Queue**: tabs Open / Accepted / Rejected (counts in the tab labels), each a
paged table (50 per page, "Load more" with `p_offset`):

| column | source |
|---|---|
| Submitted | `created_at` (relative, e.g. "3h ago"; flag rows older than 48 h in Open) |
| User | avatar + `user_name` / `@user_handle`; "banned until ..." chip from `user_banned_until` |
| What | `kind` + `target_type` label ("Account ban", "Hidden video", "Deleted story", ...) with a "deleted" chip when `target.exists = false` |
| Reason | first line of `reason`, truncated |
| Decided | Accepted/Rejected tabs only: `decided_at`, `decided_by_handle` |

Clicking a row opens the **detail drawer** (right side):
1. **Target**: preview by type (video thumbnail + player link + description;
   comment text with a link to its video; live title/thumbnail and times; ban
   until date and ban reason). The moderation reason (`hidden_reason`,
   `ban_reason`, `delete_reason`) and when it happened. A notice when
   `still_actioned` is false ("already lifted") or the content is deleted
   ("cannot be restored").
2. **User**: avatar, name, handle, link to the existing user detail
   (`admin_v2_user_detail`), current ban, `user_appeals_total`.
3. **Appeal**: full `reason` text, submitted time; for decided appeals the
   outcome, note, reviewer and time.
4. **Actions** (Open only): a note textarea (max 1000; required for Reject,
   shown to the user), buttons **Accept** and **Reject**. Accept confirms with
   what will happen ("This will lift the ban" / "unhide the video" / "nothing
   can be restored, the user is only notified"). After success: toast, close
   the drawer, refresh the list and counts.

Errors from the RPCs are shown inline in the drawer; `appeal already decided`
means someone else got there first: refresh.

## Not in scope
- Editing or reopening a decided appeal.
- Appeals for restrictions that are not stored anywhere today (e.g. feature
  limits); only the targets above exist in the schema.
- Push copy: `send-push` and the app's `notifications/describe.ts` should get
  a case for `kind: 'appeal_decided'` (until then the generic system row
  shows `title — body`).
