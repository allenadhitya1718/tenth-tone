# FLYP — Complete Build & Deploy Guide

Single source of truth for getting FLYP running on iOS, Android, and the web. Aimed at a developer picking this up fresh.

---

## Table of contents

1. [Architecture overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [First-time setup (5 min)](#3-first-time-setup-5-min)
4. [Backend: Supabase migrations](#4-backend-supabase-migrations)
5. [Web / PWA — local dev + deploy](#5-web--pwa--local-dev--deploy)
6. [Android — debug APK (local, 10 min)](#6-android--debug-apk-local-10-min)
7. [Android — Play Store signed AAB (CI, 6 min)](#7-android--play-store-signed-aab-ci-6-min)
8. [iOS — local build (Mac required)](#8-ios--local-build-mac-required)
9. [iOS — TestFlight via GitHub Actions (no Mac needed)](#9-ios--testflight-via-github-actions-no-mac-needed)
10. [Required secrets reference](#10-required-secrets-reference)
11. [Common errors & fixes](#11-common-errors--fixes)
12. [Where the code lives](#12-where-the-code-lives)
13. [Pending integrations (need 3rd-party keys)](#13-pending-integrations)

---

## 1. Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│              FLYP — one source, three targets         │
└─────────────────────────────────────────────────────────────┘

  web/                ← vanilla JS PWA (no React, no build step)
    ├── index.html
    ├── admin.html
    ├── css/*.css
    ├── js/
    │   ├── views.js  ← every screen (V.home, V.map, V.chat, ...)
    │   ├── db.js     ← Supabase API layer
    │   ├── admin.js  ← admin dashboard SPA
    │   └── ...
    └── sw.js         ← service worker (PWA cache)

       │
       │ deployed as-is to:
       ▼
  ┌──────────┐     ┌──────────────┐     ┌──────────────┐
  │ Vercel   │     │ Capacitor →  │     │ Capacitor →  │
  │ (web)    │     │ iOS shell    │     │ Android shell│
  └──────────┘     │ → TestFlight │     │ → Play Store │
                   │ → App Store  │     │              │
                   └──────────────┘     └──────────────┘
                          │                    │
                          │                    │
                          └────────┬───────────┘
                                   ▼
                          ┌──────────────────┐
                          │ Supabase backend │
                          │ ─────────────    │
                          │ Postgres + RLS   │
                          │ Auth (email OTP) │
                          │ Storage (videos) │
                          │ Realtime         │
                          │ Edge Functions   │
                          └──────────────────┘
```

**Key idea:** the `web/` folder is *the* app. Vercel serves it as a PWA. Capacitor wraps the exact same folder in a native iOS/Android shell. There is no separate React build — the JS is vanilla and runs as-is.

---

## 2. Prerequisites

| Tool | Version | Required for | How to install on Windows |
|---|---|---|---|
| **Node.js** | 20.x or 22.x | All builds | https://nodejs.org → LTS installer |
| **npm** | 10.x | All builds | ships with Node |
| **Git** | any 2.x | Cloning + version control | https://git-scm.com |
| **JDK** | Temurin 21 | Android builds | `winget install EclipseAdoptium.Temurin.21.JDK` |
| **Android SDK** | API 35, build-tools 35.0.0 | Android builds | See §6. Or install Android Studio |
| **Xcode** | 16.x | iOS local builds | macOS App Store (Mac required) |
| **Capacitor CLI** | 6.2.1 | All native builds | `npm i -g @capacitor/cli` (or use `npx`) |

Web-only dev needs **only** Node + Git.

---

## 3. First-time setup (5 min)

```bash
# 1. Unzip the source (or git clone)
unzip FLYP-source.zip
cd Tiktok

# 2. Restore npm dependencies
npm install

# 3. Verify
node -v          # → v20.x or v22.x
npm -v           # → 10.x
ls web/index.html  # → exists
```

That's it for the web side. Open `web/index.html` in any browser and you have a working PWA pointing at production Supabase.

---

## 4. Backend: Supabase migrations

The app talks to a Supabase project. To set up a **fresh** project, apply migrations in numeric order.

### Existing production project
- **URL:** https://qnzgxihlrwanywndcmpf.supabase.co
- **Dashboard:** https://supabase.com/dashboard/project/qnzgxihlrwanywndcmpf
- Publishable key (safe to commit) is already in `web/js/supabase.js`

### Setting up a fresh Supabase project
1. Create project at https://supabase.com/dashboard/projects → choose region near your users
2. Note the **Project URL** and **publishable key** (Settings → API)
3. Edit `web/js/supabase.js` and replace the constants
4. SQL Editor → run migrations in order:

   | File | Adds |
   |---|---|
   | `0001_init.sql` | 18 base tables + RLS + storage buckets |
   | `0002_admin.sql` | `is_admin` + admin RLS + `ads` + `admin_stats` RPC |
   | `0003_triggers.sql` | Auto counters + notification triggers + welcome wallet (100 coins) |
   | `0004_permits_blocks.sql` | Location permits + blocks + push tokens |
   | `0005_admin_writes.sql` | Admin write RLS + `admin_adjust_wallet` + `admin_user_detail` RPCs |
   | `0006_self_service.sql` | `is_private` + topup/withdraw/delete-account RPCs |
   | `0007_security_hardening.sql` | Revokes client-callable payment RPCs + adds profile field validation |

5. Optional: run `supabase/demo_seed.sql` to populate 8 sample videos & follows.

### Buckets you need
After `0001_init.sql`, three storage buckets exist: `avatars`, `videos`, `thumbnails`. All public-read, authenticated-write. RLS policies are in the migration.

---

## 5. Web / PWA — local dev + deploy

### Local dev

```bash
# Any static file server works. Easiest:
npx http-server web -p 8080 -c-1 --cors

# Then open http://localhost:8080
```

Hot reload? There's no build step, so just edit `web/js/views.js`, hit refresh in the browser. Service worker may cache aggressively in production — disable in DevTools → Application → Service Workers → ☑ "Update on reload".

### Deploy to Vercel (production)

Already wired. The repo's `vercel.json` sets `outputDirectory: "web"`. Every push to `main` on https://github.com/meeranpmo-svg/Tiktok auto-deploys to https://tiktok-nu-eosin.vercel.app.

To deploy a fork:
```bash
npm i -g vercel
cd Tiktok
vercel              # follow prompts, accept defaults
vercel --prod       # promote preview to production
```

---

## 6. Android — debug APK (local, 10 min)

This is what we run for fast iteration. Output is signed with the Android debug keystore — fine for side-loading on dev devices, **not** acceptable to Play Store.

### Install the toolchain (one time, ~15 min)

```powershell
# 1. JDK 21
winget install -e --id EclipseAdoptium.Temurin.21.JDK

# 2. Android SDK cmdline-tools
mkdir C:\Android\sdk\cmdline-tools
cd C:\Android\sdk\cmdline-tools
Invoke-WebRequest "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip" -OutFile tools.zip
Expand-Archive tools.zip .
Move-Item cmdline-tools latest
Remove-Item tools.zip

# 3. Persistent env vars
[Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot", "User")
[Environment]::SetEnvironmentVariable("ANDROID_HOME", "C:\Android\sdk", "User")
[Environment]::SetEnvironmentVariable("ANDROID_SDK_ROOT", "C:\Android\sdk", "User")
$old = [Environment]::GetEnvironmentVariable("Path", "User")
[Environment]::SetEnvironmentVariable("Path", "$old;C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin;C:\Android\sdk\cmdline-tools\latest\bin;C:\Android\sdk\platform-tools", "User")

# Close and reopen PowerShell, then:
# 4. Accept SDK licenses and install required components
echo y | sdkmanager --licenses
sdkmanager --install "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```

On macOS / Linux the equivalent:
```bash
# brew install --cask temurin@21 android-commandlinetools
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH
yes | sdkmanager --licenses
sdkmanager --install "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```

### Build the APK

```bash
cd Tiktok
npm install                       # if not already
npm install --save @capacitor/android@^6.2.1   # if not already in package.json
npx cap add android               # generates android/ folder
npx cap sync android              # copies web/ into android/app/src/main/assets/public

cd android
./gradlew assembleDebug
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk` (~7 MB)

### Install on a device

```bash
# Via USB (developer mode + USB debugging enabled on phone)
adb install android/app/build/outputs/apk/debug/app-debug.apk

# Or transfer the .apk to the phone via Drive/Telegram/USB and tap to install
```

---

## 7. Android — Play Store signed AAB (CI, 6 min)

The repo has a GitHub Actions workflow at `.github/workflows/android-build.yml`. Pushing a `v*` tag triggers a signed release AAB build.

### One-time setup: generate the upload keystore

```powershell
# In any folder:
keytool -genkey -v `
  -keystore upload-keystore.jks `
  -alias flyp-upload `
  -keyalg RSA -keysize 2048 -validity 36500 `
  -storepass YourStrongPass!23 `
  -keypass YourStrongPass!23 `
  -dname "CN=FLYP, OU=Mobile, O=FLYP, L=Riyadh, ST=Riyadh, C=SA"

# ⚠️ This keystore is irreplaceable. Back it up to two locations.
# If lost AND Play Console access lost, the app can never be updated.

# Move out of the repo so it's never committed:
mkdir C:\Users\$env:USERNAME\Documents\FLYPKeys
Move-Item upload-keystore.jks C:\Users\$env:USERNAME\Documents\FLYPKeys\

# Base64-encode for GitHub secret:
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\Users\$env:USERNAME\Documents\FLYPKeys\upload-keystore.jks")) | Set-Clipboard
```

### Add 4 GitHub secrets

GitHub repo → Settings → Secrets and variables → Actions → **New repository secret** for each:

| Name | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | The base64 string from clipboard above |
| `ANDROID_KEYSTORE_PASSWORD` | `YourStrongPass!23` (or whatever you used) |
| `ANDROID_KEY_ALIAS` | `flyp-upload` |
| `ANDROID_KEY_PASSWORD` | Same as `ANDROID_KEYSTORE_PASSWORD` |

### Trigger the release build

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions detects the secrets and produces:
- `app-release.aab` (Play Store upload format)
- `app-release.apk` (for side-load testing of the production build)

Download from the workflow run → **Artifacts** at the bottom.

### Upload to Play Console

1. https://play.google.com/console → your app → **Testing** → **Internal testing** → **Create new release**
2. Upload `app-release.aab` → release notes → Save → Review → Roll out
3. **Testers** tab → create email list → add testers → copy opt-in URL → testers tap link → install from Play Store

Full step-by-step: see `PLAY_STORE_CHECKLIST.md`.

---

## 8. iOS — local build (Mac required)

```bash
cd Tiktok
npm install
npm install --save @capacitor/ios@^6.2.1   # already in package.json
npx cap add ios
npx cap sync ios
npx cap open ios   # opens Xcode
```

Xcode:
1. Top bar: select **App** scheme → choose **iPhone 16 Pro** simulator (or a connected device)
2. **▶ Run** (or `Cmd+R`)
3. App launches in simulator. Camera/mic work on physical devices only.

To produce an unsigned IPA for ad-hoc distribution: Xcode → Product → **Archive** → Distribute App → Development.

---

## 9. iOS — TestFlight via GitHub Actions (no Mac needed)

This is the production path. Workflow at `.github/workflows/ios-build.yml`. Pushing a `v*` tag builds a signed IPA on a macOS runner and uploads to TestFlight.

### Prerequisites
1. Apple Developer Program membership ($99/yr — see `APPLE_TESTFLIGHT_CHECKLIST.md` Step 1)
2. App registered in App Store Connect with bundle ID `com.flyp.app`
3. App Store Connect API key (`.p8` file) generated

### Add 4 GitHub secrets

| Name | Value |
|---|---|
| `APPLE_TEAM_ID` | 10-char Team ID from developer.apple.com |
| `APP_STORE_CONNECT_KEY_ID` | 10-char Key ID from the API Keys page |
| `APP_STORE_CONNECT_ISSUER_ID` | UUID at top of API Keys page |
| `APP_STORE_CONNECT_KEY_BASE64` | base64 of the `.p8` file (PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey_XXX.p8"))`) |

### Trigger the build

```bash
git tag v1.0.0
git push origin v1.0.0
```

Or run the workflow manually from the Actions tab with `upload: true`.

20 minutes later → IPA in TestFlight. Add testers in App Store Connect → they install via the TestFlight iOS app.

Full step-by-step: see `APPLE_TESTFLIGHT_CHECKLIST.md`.

---

## 10. Required secrets reference

All GitHub Actions secrets in one place:

### Android (Play Store)
- `ANDROID_KEYSTORE_BASE64` — base64 of upload-keystore.jks
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS` — typically `flyp-upload`
- `ANDROID_KEY_PASSWORD`

### iOS (TestFlight / App Store)
- `APPLE_TEAM_ID`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_KEY_BASE64`

### Vercel
- Already configured in the existing project. For a fork, link via `vercel` CLI — no secrets needed in GitHub.

### Supabase
- Publishable key is in `web/js/supabase.js` (safe to commit — anon key only, real auth happens server-side via RLS).
- **Service-role key** must never be in the repo. Only used by Edge Functions and admin scripts.

---

## 11. Common errors & fixes

### Android

| Symptom | Fix |
|---|---|
| `npx cap add android` says *"Could not find the android platform"* | Run `npm install --save @capacitor/android@^6.2.1` first |
| `./gradlew` fails with *"JAVA_HOME is not set"* | `export JAVA_HOME=...` per §6 |
| `./gradlew` fails with *"SDK location not found"* | `export ANDROID_HOME=...` per §6 |
| `sdkmanager: command not found` (bash) | Use `.bat` extension: `/c/Android/sdk/cmdline-tools/latest/bin/sdkmanager.bat` |
| Workflow says *"No signing secrets"* | Set the 4 secrets in §7 — names are case-sensitive |
| Play Console rejects upload: *"version code conflict"* | Push a fresh tag like `v1.0.1` — workflow auto-bumps versionCode from timestamp |

### iOS

| Symptom | Fix |
|---|---|
| `xcodebuild: error: No profiles for 'com.flyp.app'` | Bundle ID in App Store Connect must match `capacitor.config.json` exactly (case-sensitive) |
| *"Authentication failed because the password was incorrect"* | Check `APP_STORE_CONNECT_ISSUER_ID` vs `APP_STORE_CONNECT_KEY_ID` — easy to swap |
| *"Invalid Code Signing Entitlements"* (Push Notifications) | Enable Push Notifications capability in App Store Connect for the bundle ID, OR temporarily remove `@capacitor/push-notifications` from `package.json` for first build |
| Build never appears in TestFlight | Wait up to 30 min for Apple processing. Check App Store Connect → Notifications email for rejection reason |

### Supabase / DB

| Symptom | Fix |
|---|---|
| Web app loads but shows *"failed to load profile"* | Migrations 0001–0007 must be applied. Run them in order in SQL Editor |
| Admin dashboard shows *"ليس لديه صلاحيات إدارية"* | The account isn't admin yet. `update public.profiles set is_admin=true where id=(select id from auth.users where email='YOUR_EMAIL');` |
| `self_topup` RPC errors with *"permission denied"* | This is intentional — migration 0007 revokes client access. Use admin panel's `adminAdjustWallet` for demos, or wire a Stripe/Apple-IAP webhook for production |

### General

| Symptom | Fix |
|---|---|
| Vercel deploy stuck on 404 | `vercel.json` must set `outputDirectory: "web"`. Check the root-level config |
| Service worker shows old version after deploy | Bump `VERSION` constant at top of `web/sw.js`. SW deletes old caches on activation |
| Push to `main` doesn't trigger workflow | Check the workflow file is on GitHub (not just locally). PAT must have `workflow` scope for git push |

---

## 12. Where the code lives

```
Tiktok/
├── web/                              ← THE APP
│   ├── index.html                    ← main user app entry
│   ├── admin.html                    ← admin dashboard entry
│   ├── css/
│   │   ├── app.css                   ← main app styles (~530 lines)
│   │   └── admin.css                 ← admin styles (~280 lines)
│   ├── js/
│   │   ├── supabase.js               ← Supabase client init + auth helpers
│   │   ├── db.js                     ← ALL DB calls (~800 lines, easy to skim)
│   │   ├── helpers.js                ← el(), esc(), safeUrl(), icons
│   │   ├── data.js                   ← seed data for offline / fallback UI
│   │   ├── i18n.js                    ← Arabic⇄English engine (dictionary + DOM translator) — see §14
│   │   ├── views.js                  ← every screen as a function (V.home, V.map, V.chat, …) — ~2400 lines
│   │   ├── app.js                    ← router + auth guard
│   │   ├── admin.js                  ← admin SPA — ~1100 lines
│   │   ├── agora.js                  ← scaffolded live-stream client (not wired)
│   │   └── sw-register.js            ← service worker registration
│   ├── sw.js                         ← service worker (cache versioning)
│   ├── manifest.json                 ← PWA install manifest
│   └── icons/, fonts/, ...
│
├── supabase/
│   ├── migrations/                   ← apply 0001..0007 in order
│   └── demo_seed.sql                 ← sample content
│
├── .github/workflows/
│   ├── ios-build.yml                 ← macOS CI → TestFlight
│   └── android-build.yml             ← Ubuntu CI → signed AAB
│
├── flutter/                          ← (parallel rewrite, not used for production)
│
├── resources/                        ← app icons + splash for capacitor-assets
├── capacitor.config.json             ← Capacitor: webDir="web", bundle ID, plugins
├── package.json                      ← npm deps (Capacitor 6 + 8 plugins)
├── vercel.json                       ← outputDirectory="web" + rewrites
│
└── *.md                              ← all docs
    ├── BUILD.md                      ← this file
    ├── APPLE_TESTFLIGHT_CHECKLIST.md ← click-by-click iOS setup
    ├── PLAY_STORE_CHECKLIST.md       ← click-by-click Android setup
    ├── BUILD_IOS.md                  ← deeper iOS reference
    ├── BACKEND.md                    ← Supabase schema reference
    ├── DEMO.md                       ← 6-minute customer-demo script
    ├── PRIVACY.md                    ← privacy policy text (host as URL for App Stores)
    └── RESTORE.md                    ← disaster-recovery cheat sheet
```

---

## 13. Pending integrations

These were intentionally stubbed pending real third-party signups:

| Feature | Status | What's missing |
|---|---|---|
| **Real live video broadcast** | Host-side preview works via `getUserMedia`; viewer side stubbed | Agora / MUX / LiveKit API key + token generator (server) |
| **Payments — wallet top-up** | UI shows packages; `self_topup` RPC is locked for security | Stripe / Apple-IAP webhook that verifies receipts and calls `self_topup` with service-role key |
| **Real push notifications** | Capacitor plugin scaffolded; UI ready | VAPID keys for web push + APNs cert for iOS + Edge Function to dispatch |
| **Sign in with Apple** | Not implemented | Required by Apple if email/social login is offered. Add `@capacitor-community/apple-sign-in` |

When ready to wire any of these, the integration points are clearly marked in `db.js` with `// TODO:` comments.

> **Done since:** English ⇄ Arabic localization is now shipped — see §14.

---

## 14. Internationalization (Arabic ⇄ English)

The app is **authored in Arabic** and English is layered on at runtime by
`web/js/i18n.js`. There is **no build step and no per-string editing of
views** — the engine translates the rendered DOM.

### How it works
1. **Dictionary** — a single `DICT` object maps each Arabic UI label →
   English. The user-app strings are in the literal; the admin strings are
   merged in via `Object.assign(DICT, {…})` lower in the same file. ~450
   entries total.
2. **Exact-match translation** — after every screen render, and again via a
   `MutationObserver` on `<body>` for async content (feed, modals, toasts,
   bottom nav), the engine walks text nodes + `placeholder`/`title`/
   `aria-label` attributes. It only swaps a string whose **entire trimmed
   value** is a known key. **This is the safety guarantee:** user-generated
   content (names, messages, captions) never exactly equals a UI label, so
   it is structurally impossible to mistranslate it.
3. **Parametric rules** — a short `RULES` list handles the few dynamic
   strings with a number/word slot: relative timestamps (`5m ago`),
   `Send (N)`, `N friends on the map`, `Topped up N coins`.
4. **Native dialogs** — `window.confirm/prompt/alert` are patched so their
   messages localize too.
5. **Direction** — switching language sets `<html dir>` to `rtl`/`ltr`,
   toggles `body.lang-en`, and dispatches a `tt-rerender` event that both
   routers (`app.js`, `admin.js`) listen for to re-render the current
   screen from its Arabic source.
6. **Persistence** — the choice is stored in `localStorage('tt-lang')` and
   restored on boot (before first paint) to avoid a flash.

### The switch UI
- **User app:** segmented `العربية | English` control on the splash, login,
  and Settings → Language row (`langSwitch()` in `views.js`).
- **Admin:** `ع | EN` control on the topbar and the pre-login card
  (`admLangSwitch()` in `admin.js`).

### Adding / changing a translation
Open `web/js/i18n.js`:
- To fix or add a label, add/edit an entry in `DICT` — key is the **exact**
  Arabic string as it appears in the code, value is the English.
- For a new dynamic pattern (number/word slot), add a `[regex, fn]` pair to
  `RULES`.
- After editing, bump `VERSION` in `web/sw.js` so clients pick up the new
  bundle.

### Adding a third language
Replace the flat `DICT` with `{ en: {…}, fr: {…} }` keyed by language,
make `translate()` read `DICT[getLang()]`, and add the language to the
switch controls. The render/observer/dialog plumbing stays unchanged.

### Gotcha
Because translation is exact-match, a label that is **built by string
concatenation at runtime** (e.g. `'منذ ' + n + ' د'`) won't match a static
dictionary key — those are handled by `RULES` instead. If you add a new
concatenated UI string, either make it a single literal (so it can live in
`DICT`) or add a `RULES` entry for it.

---

## Live URLs reference

| | URL |
|---|---|
| Web app | https://tiktok-nu-eosin.vercel.app |
| Admin dashboard | https://tiktok-nu-eosin.vercel.app/admin.html |
| GitHub repo | https://github.com/meeranpmo-svg/Tiktok |
| Supabase dashboard | https://supabase.com/dashboard/project/qnzgxihlrwanywndcmpf |
| Vercel project | https://vercel.com/meeranpmo-svgs-projects/tiktok |
| Apple Developer | https://developer.apple.com/account |
| App Store Connect | https://appstoreconnect.apple.com |
| Google Play Console | https://play.google.com/console |

---

## Contact

For repo access, Supabase admin invitations, or any of the above secrets: ping the product owner.
