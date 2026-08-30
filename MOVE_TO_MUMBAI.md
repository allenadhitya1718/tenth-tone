# Moving the database from Tokyo to Mumbai

**Why:** the project is in `ap-northeast-1` (Tokyo) and the users are in Saudi
Arabia. That is ~8,800 km, crossed twice on every request — every feed open,
every message, every like. Mumbai is ~2,800 km away. This is worth roughly
150–200ms on **every request in the app**, which is more than caching,
parallelising and every query fix put together.

**Why now:** there are 14 profiles, 30 videos, 5 messages and 7 follows. After
launch this becomes a migration with downtime. Today it is an afternoon.

Supabase has no Middle East region — Mumbai (`ap-south-1`) is the closest,
with Frankfurt (`eu-central-1`) a reasonable second because the Gulf has good
cable routes to Europe.

---

## What has to move

| | Amount | Difficulty |
|---|---|---|
| Database rows | 14 profiles, 30 videos, 5 messages, 7 follows | Easy |
| **Storage files** | **30 video files** | **The actual work** |
| Auth logins | 14 accounts | Fiddly — see step 4 |

The 30 videos are the curated seed clips. They live **only** in Supabase
Storage on the current project — they are not in the repo and nothing
regenerates them. If they are lost they are gone.

---

## Step 1 — Create two projects

In the Supabase dashboard, **New project**, twice:

| Name | Region | Purpose |
|---|---|---|
| `flyp` | `ap-south-1` (Mumbai) | the real one |
| `flyp-staging` | `ap-south-1` (Mumbai) | fake data, load testing, trying migrations first |

Same region for both, or staging timings will not tell you anything about
production.

Save each project's **URL** and **publishable (anon) key** from
Settings → API. You will need them in step 6.

---

## Step 2 — Build the schema on both

In each new project's SQL Editor, run **in this order**:

```
supabase/migrations/0001_init.sql
0002 … 0040        (in numeric order)
0041_chat_read_state.sql
0042_message_replies_reactions.sql
0043_message_requests.sql
0044_profile_required_fields.sql
0045_call_records_live_alerts.sql
0046_live_viewer_count.sql
0047_follows_followed_index.sql
0048_security_fixes.sql
0049_blocking_fixes.sql
0050_rate_limits.sql
0051_enable_scheduled_jobs.sql
0053_follow_requests_and_counter_repair.sql
0054_block_visibility_and_private_lists.sql
0055_follower_list_rpcs.sql
```

Skip `0015_ai_moderation.sql` — it needs a paid moderation account.
Skip `0052` — `0053` supersedes it.

Then, in **both** projects:

- **Database → Extensions → enable `pg_cron`**, then re-run `0051`. The
  `create extension` line does not work from the SQL editor on Supabase; it
  succeeds and does nothing.
- **Storage → create four buckets**: `avatars`, `videos`, `chat-media`,
  `group-photos`. Match the settings on the old project (public/private and
  the file size limit).

Confirm with the check block at the end of each migration. Do not assume.

---

## Step 3 — Copy the database rows

On the **OLD** project's SQL Editor, run this to produce INSERT statements:

```sql
-- Profiles. UUIDs are preserved on purpose: videos, follows and messages all
-- reference them, and regenerating IDs would orphan everything.
select 'insert into public.profiles (id,handle,name,bio,avatar_url,is_private,verified,created_at) values ('
  || quote_literal(id) || ',' || quote_nullable(handle) || ',' || quote_literal(name) || ','
  || quote_nullable(bio) || ',' || quote_nullable(avatar_url) || ','
  || is_private || ',' || verified || ',' || quote_literal(created_at)
  || ') on conflict (id) do nothing;'
from public.profiles;
```

Copy the output, run it on the **NEW** project. Repeat for `videos`,
`follows` and `messages` with the same pattern.

**Do not copy the counter columns** (`followers_count` and so on). Recompute
them at the end instead — step 5.

---

## Step 4 — The logins

This is the fiddly part, and there are two honest options.

### Option A — start fresh (recommended)

Delete the profile rows for test accounts you do not care about, sign up
again on the new project, and only keep what matters. With 14 accounts —
most of them test accounts and 5 generated seed accounts — this is usually
faster and cleaner than moving password hashes between projects.

**Catch:** new signups get new UUIDs, so anything referencing the old ID
(videos, follows) must be re-pointed or re-created. Easiest if you do this
*before* step 3 and only copy rows for accounts you keep.

### Option B — copy the auth rows

On the old project:

```sql
select id, email, encrypted_password, email_confirmed_at, created_at,
       raw_user_meta_data
from auth.users;
```

and insert them into the new project's `auth.users`. Password hashes carry
over, so people keep their passwords and all UUIDs stay valid.

**Be aware:** writing directly into `auth.users` is not a supported flow.
Test it on staging first. If sign-in misbehaves afterwards, fall back to
option A.

---

## Step 5 — Move the 30 video files

The row copy only moved the *URLs*, which still point at the old project.
The files themselves have to be downloaded and re-uploaded.

Save as `move-storage.mjs` in the project root and fill in the four values:

```js
import { createClient } from '@supabase/supabase-js';

const OLD = createClient('https://OLD_REF.supabase.co', 'OLD_SERVICE_ROLE_KEY');
const NEW = createClient('https://NEW_REF.supabase.co', 'NEW_SERVICE_ROLE_KEY');
const BUCKETS = ['videos', 'avatars', 'chat-media', 'group-photos'];

for (const bucket of BUCKETS) {
  const { data: folders } = await OLD.storage.from(bucket).list('', { limit: 1000 });
  for (const folder of folders ?? []) {
    // Files are stored under a per-user folder, so list one level down too.
    const { data: files } = await OLD.storage.from(bucket).list(folder.name, { limit: 1000 });
    for (const f of files ?? []) {
      const path = `${folder.name}/${f.name}`;
      const { data: blob, error } = await OLD.storage.from(bucket).download(path);
      if (error) { console.warn('skip', path, error.message); continue; }
      const up = await NEW.storage.from(bucket).upload(path, blob, { upsert: true });
      console.log(up.error ? `FAILED ${path}: ${up.error.message}` : `ok ${path}`);
    }
  }
}
```

Run it with `node move-storage.mjs`.

> **The service_role key is the master key to your database.** It bypasses
> every security rule. Put it in this file, run the script, then delete the
> file. Never commit it, never put it in `web/`, never paste it into a chat.

Then re-point the URLs on the **NEW** project:

```sql
update public.videos
   set video_url = replace(video_url, 'OLD_REF.supabase.co', 'NEW_REF.supabase.co'),
       thumbnail = replace(thumbnail, 'OLD_REF.supabase.co', 'NEW_REF.supabase.co')
 where video_url like '%OLD_REF%' or thumbnail like '%OLD_REF%';

update public.profiles
   set avatar_url = replace(avatar_url, 'OLD_REF.supabase.co', 'NEW_REF.supabase.co')
 where avatar_url like '%OLD_REF%';
```

---

## Step 6 — Point the app at the new project

One place, `web/js/supabase.js`:

```js
const SUPABASE_URL = 'https://NEW_REF.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_...';   // the new project's
```

Bump `?v=` on `supabase.js` in `index.html` and hard-refresh.

The publishable key belongs in the code — that is what it is for. The
service_role key never does.

---

## Step 7 — Recompute the counters, then verify

```sql
update public.profiles p
   set followers_count = (select count(*) from public.follows f where f.followed_id = p.id),
       following_count = (select count(*) from public.follows f where f.follower_id = p.id),
       likes_count     = (select count(*) from public.likes l
                            join public.videos v on v.id = l.video_id
                           where v.user_id = p.id);
```

Then check it actually worked:

```sql
select 'profiles'  as t, count(*)::text from public.profiles
union all select 'videos',   count(*)::text from public.videos
union all select 'follows',  count(*)::text from public.follows
union all select 'messages', count(*)::text from public.messages
union all select 'videos still pointing at the OLD project',
       (select count(*)::text from public.videos where video_url like '%OLD_REF%')
union all select 'cron jobs registered',
       coalesce((select string_agg(jobname, ', ') from cron.job), 'NONE — enable pg_cron');
```

Expect 14 / 30 / 7 / 5, **zero** old URLs, and two cron jobs.

Then open the app and check a video actually plays. A row copied is not the
same as a file that loads.

---

## Do not delete the old project yet

Keep it for a week or two, paused if you like. It is the only copy of those
30 video files until you have watched one play from the new project.

---

## Then, and only then

Measure the difference. On the new project:

```js
// paste in the browser console with the app open
const t = [];
for (let i = 0; i < 5; i++) {
  const a = performance.now();
  await (await window.SB.client()).from('profiles').select('id').limit(1);
  t.push(Math.round(performance.now() - a));
}
t.sort((x, y) => x - y); console.log('median ms:', t[2]);
```

From India this was ~155ms against Tokyo. Mumbai should be well under 50ms.
The number that actually matters is from **Saudi Arabia** — if you know
anyone there, that is the measurement worth having.
