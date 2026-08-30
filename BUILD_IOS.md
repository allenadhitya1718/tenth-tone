# iOS Build & App Store Guide (Capacitor)

Your live PWA at https://tiktok-nu-eosin.vercel.app is wrapped as a native iOS app via **Capacitor**. The Capacitor shell bundles your `web/` folder and presents it inside a native `WKWebView`, with native plugins for camera, geolocation, push notifications, etc.

CI builds the IPA on a free GitHub Actions macOS runner — **no Mac needed locally**. You just need an Apple Developer account ($99/yr) and to add 4 GitHub secrets.

---

## ⚠️ Read first — what Apple will reject

Apple's App Review (Guideline 4.2 — Minimum Functionality) rejects apps that are:
- Just a wrapped website with no native value
- Mostly mock data with no real user activity
- Missing privacy policy
- Without proper content moderation

**Mitigations already in place:**
- ✅ Real auth (Supabase) — not mocked
- ✅ Native camera + geolocation permission strings in Info.plist
- ✅ Native splash + status bar styling
- ✅ Privacy Policy at [`PRIVACY.md`](./PRIVACY.md)
- ✅ Native back gesture, scroll, keyboard handling

**Still needed before submitting (see below):**
- 🔲 Apple Developer enrollment
- 🔲 Privacy policy hosted on a public URL (host PRIVACY.md somewhere — Vercel / GitHub Pages)
- 🔲 Real users + real videos in the app at review time
- 🔲 5–7 screenshots taken on real iPhone or simulator
- 🔲 App description in App Store Connect

---

## 1. One-time Apple setup (~1–3 days)

### Apple Developer Program — $99/yr
1. Go to https://developer.apple.com/programs/enroll/
2. Sign in with your Apple ID
3. Choose Individual ($99) or Organization ($99 + D-U-N-S number, takes 1–2 weeks)
4. Pay → wait 24–48h for approval
5. Note your **Team ID** at https://developer.apple.com/account → top right (10 chars)

### Register the app in App Store Connect
1. https://appstoreconnect.apple.com → **Apps** → **+** → **New App**
2. Platform: iOS · Name: **FLYP** (or your chosen name)
3. Primary language: Arabic
4. Bundle ID: `com.flyp.app` (must exactly match `capacitor.config.json`)
5. SKU: any unique string (e.g. `flyp-001`)
6. Note the numeric **App ID** from the URL after creation

### App Store Connect API Key
Lets CI sign + upload without manual cert/profile management.
1. https://appstoreconnect.apple.com/access/integrations/api → **Generate API Key**
2. Name: `CI build key` · Access: **App Manager**
3. **Download the .p8 file immediately** (you can never re-download it)
4. Note three values:
   - **Key ID** (10 chars)
   - **Issuer ID** (UUID)
   - The **.p8 file**

### Add 4 GitHub secrets
Go to https://github.com/meeranpmo-svg/Tiktok/settings/secrets/actions → **New repository secret** for each:

| Name | Value |
| --- | --- |
| `APPLE_TEAM_ID` | Your 10-char Team ID |
| `APP_STORE_CONNECT_KEY_ID` | The Key ID |
| `APP_STORE_CONNECT_ISSUER_ID` | The Issuer ID |
| `APP_STORE_CONNECT_KEY_BASE64` | base64 of the .p8 file (see below) |

To base64-encode the .p8 in **Windows PowerShell**:
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\AuthKey_ABC123XYZ4.p8"))
```
Copy the long output (one line) and paste as the secret value.

---

## 2. Trigger a build

### Option A — Push a version tag (recommended for releases)
```bash
git tag v1.0.0
git push origin v1.0.0
```
GitHub Actions:
1. Spins up a macOS runner (~1 min)
2. `npm install` (~30s)
3. `npx cap add ios` — generates the Xcode project from your web/ assets
4. `npx cap sync ios` — copies the latest web/ into the iOS bundle
5. Pod install — installs Capacitor plugin native deps (~1 min)
6. `xcodebuild archive` with automatic signing via App Store Connect API key (~3 min)
7. Export IPA + upload to TestFlight via `altool` (~1 min)

Total: ~8–10 minutes per build.

### Option B — Manual run
- GitHub repo → **Actions** → **iOS build & TestFlight upload** → **Run workflow**
- Toggle **"Upload to TestFlight"** → **Run**

### Option C — Verification only (no signing)
Push to any branch (or `main`). Workflow runs build for the simulator without code signing. Useful to catch errors fast.

---

## 3. Test on TestFlight

After a successful upload:
1. https://appstoreconnect.apple.com → your app → **TestFlight** tab
2. Wait 5–30 min for Apple's processing
3. **Internal Testing** → add yourself as a tester (no review required)
4. Install **TestFlight** app on your iPhone from the App Store
5. Open TestFlight → see FLYP → install → launch

The build appears as **"FLYP"** with the purple **T** icon. It's a real native app — runs fullscreen, has native splash, camera works, etc.

For external testing (up to 10,000 users): **External Testing** group → Apple does a brief review (~24h) → users join via public link.

---

## 4. Submit for App Store review

When ready for the public store:
1. App Store Connect → your app → **App Store** tab → **+ Version**
2. Fill in:
   - **App Name** (≤30 chars) — e.g. "FLYP"
   - **Subtitle** (≤30 chars)
   - **Description** (long-form, up to 4000 chars)
   - **Keywords** (comma-separated, ≤100 chars)
   - **Privacy Policy URL** — host PRIVACY.md somewhere (GitHub Pages free, or `https://tiktok-nu-eosin.vercel.app/privacy`)
   - **Support URL** — a contact page
   - **Marketing URL** (optional)
3. **Screenshots**: 5–7 per device size. Required sizes:
   - 6.9" (iPhone 16 Pro Max) — 1320×2868
   - 6.7" (iPhone 14 Pro Max) — 1290×2796
   - 6.5" (iPhone 11 Pro Max) — 1242×2688
   - 5.5" (iPhone 8 Plus) — 1242×2208
   - Take with **Xcode Simulator** (Hardware → Save Screen) or real device
4. **Age Rating** — answer the questionnaire (FLYP is likely 17+ given UGC + DMs)
5. **App Review Information**:
   - Test account: provide a real email + password Apple can use to log in
   - **Notes**: brief description of how to test the app
6. **Pricing & Availability** — Free, list of countries
7. **Submit for Review**
8. Apple typically reviews within 24–48 hours; budget for at least one rejection + fix cycle

---

## 5. Common rejections & fixes

**"4.2 Minimum Functionality"**
→ App must have native value beyond a webview. Fix: ensure native camera/geolocation are actually invoked (not just web APIs); add native splash; native push notifications.

**"5.1.1 Privacy"**
→ Permission strings missing or unclear. We've already added them in `Info.plist` via the workflow.

**"5.1.1(v) Account Sign-In"**
→ Apple now requires "Sign in with Apple" as an option whenever you offer email/social login. Add `@capacitor-community/apple-sign-in` plugin (later session).

**"4.5.4 Push Notifications"**
→ If you mention push in the description, you must actually have it wired with proper UX. (Currently scaffolded but not fully wired.)

**"5.0 Legal"**
→ Privacy policy URL must be reachable and match what's in the app.

---

## 6. Updating the app (after first release)

```bash
# Make code changes locally
git add -A && git commit -m "..."
git push

# When ready to ship:
git tag v1.0.1
git push origin v1.0.1
```

CI auto-builds + uploads. New build appears in TestFlight within 30 min, then submit "this build" for App Store review (no full re-fill of metadata).

---

## 7. Architecture diagram

```
GitHub repo (main branch)
  ├── web/                      ← live PWA, deployed to Vercel
  ├── capacitor.config.json     ← Capacitor: webDir = "web"
  ├── package.json              ← npm deps (@capacitor/*)
  └── .github/workflows/ios-build.yml

   ↓ git tag v1.0.0 → push

GitHub Actions (macOS runner)
  ├── npm install
  ├── npx cap add ios            (generates ios/ Xcode project)
  ├── npx cap sync ios           (bundles web/ into the iOS app)
  ├── xcodebuild archive         (signs with App Store Connect API)
  └── altool upload              (uploads IPA to TestFlight)

   ↓

App Store Connect
  ├── TestFlight (internal/external testing)
  └── App Store (public release after Apple review)

   ↓

iPhone / iPad
  ├── Native shell (Capacitor)
  │     ├── Splash screen (native)
  │     ├── Status bar (styled)
  │     └── WKWebView ← loads bundled web/index.html
  └── At runtime, the JS in web/ talks to:
        ├── Supabase (auth, DB, realtime, storage)
        └── Native plugins (camera, geolocation, push)
```

---

## 8. Files in this repo for App Store

| File | Purpose |
| --- | --- |
| `package.json` | Capacitor dependencies |
| `capacitor.config.json` | App ID, app name, bundled webDir, plugin config |
| `.github/workflows/ios-build.yml` | macOS CI: build + sign + upload |
| `resources/AppIcon-1024.png` | App Store icon (1024×1024) |
| `PRIVACY.md` | Privacy policy (host this somewhere public) |
| `web/` | The actual app — bundled into the iOS shell |
| `flutter/` | Alternative implementation, not used for App Store path |
