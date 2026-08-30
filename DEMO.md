# Demo Guide — showing the app to a customer

## Pre-demo checklist (do 30 minutes before)

- [ ] Run `demo_seed.sql` to populate sample videos: https://raw.githubusercontent.com/meeranpmo-svg/Tiktok/main/supabase/demo_seed.sql
- [ ] Verify https://tiktok-nu-eosin.vercel.app loads (not 404)
- [ ] Have **two browsers ready**:
  - Browser 1: signed in as you (admin)
  - Browser 2: incognito, ready to sign in as `khaled@flyp-sa.com` / `khaled1234`
- [ ] Have an MP4 file ready on the desktop for the upload demo (~5-15 seconds, < 20 MB)
- [ ] Phone with stable WiFi for live mobile demo
- [ ] **Test once before the customer arrives** — sign up, publish a video, send a chat

## The 12-minute demo flow

| # | Time | Screen / Action | What to say |
| --- | --- | --- | --- |
| 1 | 0:00 | Open https://tiktok-nu-eosin.vercel.app on phone (Safari/Chrome) | "Pure web app, no install needed. Works on any device with a browser." |
| 2 | 0:30 | Tap Share → Add to Home Screen → launch from icon | "Installs as a real app — fullscreen, offline-capable PWA." |
| 3 | 1:00 | Sign up live with a fresh email | "Real Supabase auth, no email verification needed (configurable). Profile is auto-created in Postgres." |
| 4 | 2:00 | Edit profile → upload avatar | "File goes to Supabase Storage, RLS policies enforce that only the owner can write." |
| 5 | 3:00 | Browse home feed (vertical TikTok-style) | "All real videos from the database, ordered by recency. Recommendation engine is the next phase." |
| 6 | 4:00 | Like a video, comment, save | "Each interaction hits Supabase. Postgres triggers auto-create notifications for the video owner." |
| 7 | 5:00 | Tap **+** in bottom nav → upload an MP4 → publish | "60-second cap, auto-thumbnails, stored privately or publicly per RLS." |
| 8 | 6:00 | Switch to second browser, sign in as `khaled@flyp-sa.com` / `khaled1234` | "This is a separate account I prepared — same Supabase project." |
| 9 | 6:30 | Like the video you just uploaded | "Watch the notification fire on the other side..." |
| 10 | 6:45 | Switch back to first browser → bell icon shows new notification | "Postgres trigger created that. No background polling — Supabase Realtime broadcasts the change." |
| 11 | 7:30 | Open Inbox → New chat → search khaled → start DM → send a message | "Real-time message delivery. Watch the other browser..." |
| 12 | 8:00 | Switch to second browser → message appears within 1 second | "Same thing — Supabase Realtime channel on the messages table." |
| 13 | 8:30 | Settings → Friends Map → allow location | "Live GPS sharing, privacy controls let you choose public/friends/none." |
| 14 | 9:00 | Wallet — show 1000 coins balance, transaction history | "In-app currency for gifts during live streams. Atomic transactions enforced server-side." |
| 15 | 9:30 | Open a live stream (mock) → Send a gift | "Wallet debit + receiver credit + gift_transactions ledger entry, all in one Supabase call." |
| 16 | 10:00 | Settings → الإدارة → opens admin dashboard | "Full moderation panel for staff. Real-time stats, user management, content moderation, audit log of every admin action." |
| 17 | 10:30 | Show admin: Users → ban/admin toggles, Videos → delete, Reports queue | "Every action logged to admin_logs table for compliance." |
| 18 | 11:00 | Show: build pipeline (GitHub Actions tab) for iOS/Android | "Code is in a monorepo. CI builds iOS IPA on macOS runners and Android APK on Linux runners — no Mac needed locally." |

## Things to AVOID clicking during demo

- **Live → Start Live** (creates DB row but no real video broadcast yet — needs Agora or MUX, ~$3/1000 min)
- **Push notifications** — not wired (would need VAPID keys + iOS APNs setup)

If the customer asks about these, tell them:
- "Live broadcast: 1-day integration with Agora/MUX (paid services, $3-5 per 1000 viewer-minutes)"
- "Push notifications: 1-2 day integration, free; needs us to register an Apple Developer account ($99/yr) for iOS push"

## Backup plan if something fails live

| Failure | Recovery |
| --- | --- |
| Internet drops | Switch to phone hotspot |
| Supabase has an outage | Show the GitHub repo + architecture diagrams |
| Demo browser crashes | Have a screenshot deck as backup |
| Camera doesn't work on demo phone | Use the upload flow instead — looks the same end result |
| Realtime doesn't fire instantly | Refresh the receiving browser; the message IS in the DB, just delivery delayed |

## Talking points (sales angles)

- **Speed:** "Built on Supabase + Vercel — Supabase handles auth, database, file storage, real-time, and serverless functions out of the box. We don't pay for any of that infrastructure to be built."
- **Cost:** "Supabase free tier covers 50,000 monthly active users and 500 MB of database. We can run for free until launch traction."
- **Compliance:** "Postgres + Row Level Security means data access rules are enforced at the database level — not in app code. Auditable, secure."
- **Multi-platform from day one:** "Same backend serves the web app, the iOS app (via Capacitor), and the Android app. One codebase, three platforms."
- **Admin moderation:** "Reports queue, automated counters, audit log of every admin action — production-ready compliance from day one."

## Demo credentials

| Role | Email | Password |
| --- | --- | --- |
| Demo user (pre-loaded) | `khaled@flyp-sa.com` | `khaled1234` |
| Admin (you set this up) | your email | your password |

## URLs

| Where | URL |
| --- | --- |
| Mobile app | https://tiktok-nu-eosin.vercel.app |
| Admin dashboard | https://tiktok-nu-eosin.vercel.app/admin |
| Repo | https://github.com/meeranpmo-svg/Tiktok |
| Supabase | https://supabase.com/dashboard/project/qnzgxihlrwanywndcmpf |

## After the demo

If the customer asks for next steps, the typical pricing tiers:

| Tier | Includes | Time | Cost |
| --- | --- | --- | --- |
| Hand off as-is | Working PWA + admin | done now | — |
| + Real live streaming | Agora SDK wired | 1 week | dev time + $3-5/1000 viewer-min |
| + iOS App Store | Apple Developer enrollment + signed builds | 2 weeks | $99/yr Apple |
| + Android Play Store | Same | 1 week | $25 one-time |
| + Push notifications | iOS + Android push | 1 week | free |
| + Recommendation engine | ML pipeline for "For You" | 2-4 weeks | dev time |
| + Custom domain | flyp-sa.com or similar | 1 day | $10-15/yr domain |
