# Backend Integration

The web app uses **Supabase** as its backend (Postgres + Auth + Storage + Realtime). This document covers what's wired and what's left.

## Architecture

```
Browser (PWA at /web)
   │
   ├── Supabase Auth        — signup, login, OTP, password reset, sessions
   ├── Supabase Postgres    — all data (profiles, videos, chats, ...)
   ├── Supabase Storage     — avatars, videos, group-photos, chat-media
   └── Supabase Realtime    — chat messages, friend locations
```

The Supabase URL + anon key are hardcoded in `web/js/supabase.js`. The anon key is safe to expose — Row Level Security policies enforce access control server-side.

## What's wired and working

### Auth (Phase 1)
- **Signup** — email/phone + password → row in `auth.users` + auto-created `profiles` row
- **Login** — email/phone + password
- **OTP** — verify code received via email/SMS
- **Forgot password** — sends reset link via email (Supabase default template)
- **Reset password** — updates user password, signs in
- **Logout** — clears session
- **Route guard** — non-public paths redirect to `/login` if no session

### Profiles (Phase 1)
- **My profile** loads `profiles` row by `auth.uid()`
- **Other user profile** loads `profiles` row by id
- **Edit profile** — name, handle, bio, avatar (uploaded to `avatars/` bucket)
- **Followers / following lists** — real follow toggle

### Videos (Phase 2)
- **Publish** — uploads file to `videos/` bucket, inserts `videos` row
- **Home feed** — fetches from `videos` table with author join, descending by `created_at`
- **Following feed** — filters to videos by users I follow
- **Likes** — `likes` table; optimistic toggle in UI
- **Saves** — `saves` table; optimistic toggle
- **Comments** — fetch + post + (TODO) delete

### Follows (Phase 2)
- **Follow/unfollow** from user profile or follower list
- Counts maintained by SQL trigger on the `follows` table

### Chat (Phase 3)
- **Inbox** — lists `chats` where I'm a member, sorted by last message time
- **Open / create DM** — finds existing 1:1 or creates new `chats` row + member rows
- **Group creation** — name + photo (to `group-photos/` bucket) + initial members
- **Send message** — text or attachment (image/video/audio) to `chat-media/`
- **Realtime delivery** — Supabase Realtime channel on `messages` table inserts

### Notifications (Phase 3)
- **Fetch** real notifications from the `notifications` table (filtered to me)
- Generation of notifications still pending — see TODO

### Live location (Phase 4)
- **Geolocation API** — requests permission, gets lat/lng
- **Push to DB** — `user_locations.upsert()` on every position change
- **Friends map** — fetches `user_locations` joined to `profiles` for users I follow
- **Realtime updates** — subscribes to `user_locations` change feed; pins re-render
- **Privacy** — RLS enforces `visibility ∈ {public, friends, none}`

### Wallet & gifts (Phase 5, partial)
- **Wallet balance** — read from `wallets` table
- **Transactions** — listed from `wallet_transactions`
- **Send gift** — debits sender, credits receiver, inserts `gift_transactions` + 2 ledger rows
- **Gift catalog** — read from `gifts` table (8 default gifts seeded by migration)

### Live streams (Phase 5, scaffold only)
- **Start live** — inserts `live_streams` row, status='live'
- **End live** — sets status='ended', `ended_at`
- **Live list** — fetches active streams ordered by viewer count
- **❌ Real video broadcast NOT yet wired** — see "What's missing" below

## What's missing / TODO

### Real video broadcasting (Live streams)
The current "live stream" creates a database row but doesn't actually broadcast video. To make it work:

**Option A — Agora.io** (easiest, ~$3 per 1000 minutes)
1. Sign up at https://www.agora.io/, get App ID
2. `npm install agora-rtc-sdk-ng` or load via CDN
3. Replace mock video preview in `web/js/views.js` `V.live()` and `V.liveStart()` with Agora client SDK calls
4. Add Agora token endpoint as a Supabase Edge Function

**Option B — MUX** ($1 per 1000 minutes input + $1 per 1000 minutes output for HLS playback)
1. Sign up at https://mux.com/, get token + secret
2. Use `@mux/mux-live` for broadcasting
3. Hosts upload to a MUX live stream URL; viewers watch via HLS

**Option C — LiveKit Cloud** (free for 10 hosts/100 viewers)
1. Sign up at https://cloud.livekit.io/, create a project
2. `npm install livekit-client`
3. LiveKit gives best video quality but more setup

### Notification generation
Currently `notifications` table only gets data via direct inserts. To make real notifications fire on actions:

```sql
-- Trigger on `likes` insert: notify video owner
create function public.notify_on_like()
returns trigger language plpgsql security definer as $$
begin
  insert into public.notifications (user_id, actor_id, type, payload)
  select v.user_id, new.user_id, 'like', jsonb_build_object('video_id', new.video_id)
  from public.videos v where v.id = new.video_id and v.user_id <> new.user_id;
  return new;
end; $$;

create trigger tr_like_notify after insert on public.likes
  for each row execute function public.notify_on_like();
```

Repeat for `comments`, `follows`. Add to migration.

### Counts maintenance
`videos.likes_count` and `videos.comments_count` aren't auto-incremented yet. Add triggers:

```sql
create function public.bump_video_likes() returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT') then update public.videos set likes_count = likes_count + 1 where id = new.video_id;
  elsif (tg_op = 'DELETE') then update public.videos set likes_count = greatest(likes_count - 1, 0) where id = old.video_id;
  end if;
  return null;
end; $$;
create trigger tr_likes after insert or delete on public.likes
  for each row execute function public.bump_video_likes();
```

### Admin dashboard backend
Currently `web/admin.html` and `web/js/admin.js` work entirely on mock data. To wire to Supabase:

1. **Admin role check** — add a `role` field to `profiles` (or a separate `admins` table). Restrict admin pages with `if (!user.is_admin) go('/login')`.
2. **Replace `DB.users` etc.** with `await window.API.fetch...()` calls in each admin view function.
3. **Reports queue** — fetch from `reports` table where status='pending'. Action buttons call `update reports set status='resolved', action_taken=...`.
4. **User management** — `update profiles` for edits; `update auth.users set banned_until=` for bans (requires service_role; needs Edge Function).

### Push notifications
Web push works via service worker + VAPID keys. iOS PWA push needs iOS 16.4+ and the PWA installed to home screen.

1. Generate VAPID keys: `npx web-push generate-vapid-keys`
2. Store private key in Supabase secrets, public key in client
3. On user permission grant: register subscription, store in `push_tokens` table
4. Trigger sends via Supabase Edge Function calling `web-push` library

### Email confirmation
For production: re-enable "Confirm email" in Supabase Auth settings. Customize email templates at **Supabase → Authentication → Email Templates**.

### Phone (SMS) OTP
Requires a Twilio account ($) and configuring SMS provider in Supabase Auth. Free tier doesn't include SMS.

## Storage buckets

| Bucket | Public? | Used by |
| --- | --- | --- |
| `avatars` | Yes | Profile picture uploads |
| `videos` | Yes | Published videos |
| `group-photos` | Yes | Group chat photos |
| `chat-media` | No | DM/group attachments (signed URLs) |

All buckets created automatically by `supabase/migrations/0001_init.sql`.

## RLS policies

Every table has Row Level Security enabled. See migration for full policies. Summary:

- **profiles** — anyone reads, only owner updates
- **videos** — public read for `privacy='public'` videos; only owner writes
- **likes / saves / comments** — anyone reads, only owner writes their own
- **follows** — anyone reads, only `auth.uid() = follower_id` can insert/delete
- **chats / chat_members / messages** — only members read/write
- **notifications** — only owner reads
- **user_locations** — public/friends/own based on `visibility` field
- **wallets** — only owner reads
- **gift_transactions** — owner reads

## Local dev

```bash
cd web
python -m http.server 5500
# → http://127.0.0.1:5500
```

Auth works against the live Supabase project. To use a separate dev project:

1. Create another Supabase project (e.g. `flyp-dev`)
2. Run `supabase/migrations/0001_init.sql` in it
3. Update `web/js/supabase.js` with the dev URL + anon key
4. Add `http://localhost:5500/**` to dev project's redirect URLs

## Files

```
supabase/migrations/0001_init.sql   ← Full schema + RLS + storage buckets
web/js/supabase.js                  ← Auth + storage helpers
web/js/db.js                        ← All data queries (50+ functions)
web/js/views.js                     ← UI (uses window.API.* from db.js)
web/js/app.js                       ← Router + auth guard
```
