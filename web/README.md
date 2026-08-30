# FLYP — Social Video App

Clickable frontend prototype of a TikTok-style Arabic social video app, built from the SRS document. RTL Arabic, mobile-first, **PWA-installable on iPhone**, no build step, no backend (mock data).

## Run

```bash
cd "C:\Users\Syed\Desktop\social-app"
python -m http.server 5500
```

Then open:
- **Mobile app:** http://127.0.0.1:5500/index.html
- **Admin dashboard:** http://127.0.0.1:5500/admin.html

## Install on iPhone (PWA)

The app is a Progressive Web App — it installs to the home screen, runs fullscreen with no browser chrome, and works offline.

### To install on a real iPhone

1. **Make the dev server reachable from your phone.**
   Easiest path: deploy to a free static host (Vercel, Netlify, GitHub Pages, Cloudflare Pages). PWAs require **HTTPS** outside `localhost`, and your phone needs to reach the URL.

   Quick options:
   - **Netlify drop:** drag the `social-app/` folder onto https://app.netlify.com/drop → instant HTTPS URL
   - **Vercel:** `npx vercel` in the folder
   - **Cloudflare Pages:** connect the repo
   - **Local-only test:** run `npx serve --ssl` on your laptop, get the IP, open in iPhone Safari (you'll get a cert warning to bypass)

2. On the iPhone, open the URL in **Safari** (not Chrome — iOS PWA install only works through Safari).

3. Tap the **Share** button (the square with the up-arrow at the bottom of Safari).

4. Scroll and tap **"Add to Home Screen"** (إضافة إلى الشاشة الرئيسية).

5. Confirm the name "FLYP" and tap **Add**.

6. The app icon appears on your home screen. Launching it opens fullscreen with no browser bar — looks and feels like a native app.

### What works in PWA mode
- ✅ Home-screen icon, splash screen, fullscreen layout
- ✅ Offline support (service worker caches the app shell)
- ✅ App-like navigation (no browser chrome)
- ✅ Add to Siri / Spotlight search

### iOS PWA limitations
- ❌ Push notifications (limited; iOS 16.4+ supports web push but only when installed)
- ❌ Background sync
- ❌ Some camera/file APIs are restricted vs native apps
- ❌ Not in App Store (use Capacitor for that — see "Next steps" below)

### Verifying the PWA locally

Open Chrome DevTools → Application → Manifest / Service Workers. You should see:
- Manifest loaded correctly
- Service worker registered and activated
- "Install" button available in Chrome (omnibox)

## Mobile app screens (`index.html`)

Hash routes:

| Path | Screen |
| --- | --- |
| `#/` | Splash |
| `#/login` `#/register` `#/otp` `#/forgot` `#/reset` | Auth flow |
| `#/home` (`?tab=foryou\|following`) | Vertical video feed |
| `#/discover` | Search + trending tags + grid |
| `#/create` | Create entry (record / upload / live / template) |
| `#/camera` | Recording camera UI |
| `#/edit-video` | Filters / effects / text / stickers / music |
| `#/publish` | Caption + privacy + draft/publish |
| `#/inbox` | Chat list + activity quick-actions |
| `#/chat/:id` | 1:1 chat with mock messages |
| `#/profile` | Your profile (videos grid, stats) |
| `#/profile/edit` | Edit profile |
| `#/profile/:id` | Other user's profile (follow / message) |
| `#/list/followers` `#/list/following` | Followers/following |
| `#/notifications` | Activity notifications |
| `#/comments/:videoId` | Comments bottom sheet |
| `#/share/:videoId` | Share screen (the original Figma) |
| `#/live/host-list` | Browse live streams |
| `#/live/start` | Start a live stream |
| `#/live/:id` | Watch a live stream + send gifts |
| `#/map` | Friends map (location feature) |
| `#/wallet` | Coins / transactions / withdraw |
| `#/settings` | Account, content, support, logout |

## Admin dashboard screens (`admin.html`)

| Path | Screen |
| --- | --- |
| `#/dashboard` | KPIs, weekly chart, content donut, top users, activity |
| `#/users` | User table (search, filter, edit, ban, reset) |
| `#/videos` | Videos table (status filter, view, delete) |
| `#/comments` | Comments review/moderation |
| `#/reports` | Reports queue (review modal with action) |
| `#/live` | Active live streams (monitor / end) |
| `#/ads` | Campaigns table + create modal |
| `#/notifications` | Notification composer + history |
| `#/analytics` | Growth chart, engagement, top videos, geography |
| `#/wallet` | Gifts ledger + revenue stats |
| `#/roles` | Roles & permissions (system/custom roles) |
| `#/employees` | Employees CRUD with role assignment |
| `#/logs` | Activity logs (audit trail) |
| `#/location` | Location feature toggles + trending by region |
| `#/settings` | Platform settings |

## File layout

```
social-app/
├── index.html        # Mobile SPA shell
├── admin.html        # Admin SPA shell
├── css/
│   ├── app.css       # Mobile styles (RTL, mobile-first)
│   └── admin.css     # Admin styles (responsive desktop)
└── js/
    ├── data.js       # Mock data (users, videos, chats, etc.)
    ├── helpers.js    # Shared icons, components, router helpers
    ├── views.js      # Mobile view render functions
    ├── app.js        # Mobile router boot
    └── admin.js      # Admin views + router boot
```

## What's mocked / not wired

- **No backend:** all data lives in `js/data.js`. State changes during a session reset on reload.
- **No real video playback:** feed uses still images as placeholders.
- **No real auth:** any login/register button advances the flow.
- **No real-time:** chat and live comments don't actually push.
- **Avatars:** loaded from `i.pravatar.cc`.
- **Background images:** loaded from `images.unsplash.com`.

## Coverage vs. SRS

Mobile (3.1) — every use case has a screen:
- Account management (signup/login/OTP/reset/edit) ✓
- Video creation flow (record/upload/edit/music/publish) ✓
- Content interaction (For You / Following, like, comment, share, follow) ✓
- Following lists & notifications ✓
- Direct messaging + group-chat-ready UI ✓
- Live streaming (host start, viewer watch, gifts, comments) ✓
- Recommendation page (For You feed) ✓
- Location feature (friends map, share toggle, trending) ✓
- Reporting / moderation entry points ✓
- Wallet (balance, transactions, withdraw) ✓

Admin (3.2) — all 11 modules covered:
- User management ✓
- Content management ✓
- Reports & complaints ✓
- Live stream management ✓
- Ads management ✓
- Notifications ✓
- Analytics & reports (export buttons) ✓
- Location control ✓
- Roles & permissions ✓
- Employees management ✓
- Activity logs ✓
- Gifts/wallet reports ✓

## Next steps for production

1. **Backend:** auth (JWT), video upload + transcoding, S3/CDN, real-time WebSockets for chat/live, recommendation service.
2. **Stack proposal:** Node.js + Express/Fastify, PostgreSQL, Redis, AWS S3 + CloudFront, MUX or Agora for video, Firebase/OneSignal for push.
3. **Native mobile:** rewrite the mobile UI in React Native or Flutter and reuse this design as a reference.
4. **Testing:** unit tests for state, integration tests for API, E2E with Playwright.
5. **CI/CD:** Docker, GitHub Actions, staging + prod environments.
