# iOS Build & TestFlight Guide

This repo is set up to build and upload to TestFlight from the cloud — **no Mac required on your end**. You'll use either GitHub Actions (free for public repos, 200 effective minutes/month free for private) or Codemagic (free 500 minutes/month, easier for Flutter).

## Bundle ID

Already configured: **`com.flyp.app`**

If you want to change it, edit:
1. `ios/Runner.xcodeproj/project.pbxproj` (5 occurrences of `PRODUCT_BUNDLE_IDENTIFIER`)
2. `.github/workflows/ios-build.yml` (`BUNDLE_ID`)
3. `codemagic.yaml` (`bundle_identifier`)

---

## ⚠️ Prerequisites — you must do these first

These can't be automated:

### 1. Apple Developer Program — $99 / year

1. Go to https://developer.apple.com/programs/enroll/
2. Sign in with your Apple ID (or create one)
3. Choose **Individual** ($99) or **Organization** ($99 + D-U-N-S number)
4. Pay → wait 24–48h for approval
5. Once approved, find your **Team ID** at https://developer.apple.com/account → top right corner

### 2. Register the app in App Store Connect

1. Go to https://appstoreconnect.apple.com/
2. **Apps** → **+** → **New App**
3. Fill in:
   - **Platform:** iOS
   - **Name:** FLYP (or your chosen name)
   - **Primary language:** Arabic
   - **Bundle ID:** `com.flyp.app` (must match exactly)
   - **SKU:** any unique string (e.g. `flyp-001`)
4. Click **Create**
5. Note the **App ID** (numeric, in the URL after creation)

### 3. App Store Connect API Key

This lets CI sign and upload without manual certificate management.

1. Go to https://appstoreconnect.apple.com/access/integrations/api
2. Click **Generate API Key** (or **+**)
3. Name: `CI build key`
4. Access: **App Manager**
5. Click **Generate**
6. **Download the .p8 file immediately** (you can't re-download it later)
7. Note three values:
   - **Key ID** (10 chars, e.g. `ABC123XYZ4`)
   - **Issuer ID** (UUID, e.g. `12345678-1234-1234-1234-123456789012`)
   - **The .p8 file** itself

---

## Path A — GitHub Actions (recommended if your code is on GitHub)

### One-time setup

1. **Push the repo to GitHub** (private or public — both work).
2. Go to your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
3. Add these secrets:

| Name | Value |
| --- | --- |
| `APPLE_TEAM_ID` | Your Team ID (10 chars, e.g. `4LPV5R63EQ`) |
| `APP_STORE_CONNECT_KEY_ID` | The Key ID from step 3 above |
| `APP_STORE_CONNECT_ISSUER_ID` | The Issuer ID |
| `APP_STORE_CONNECT_KEY_BASE64` | base64 of the .p8 file (see below) |

To base64-encode the .p8 file on Windows PowerShell:
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\AuthKey_ABC123XYZ4.p8"))
```
Copy the output (one long line) and paste as the secret value.

4. Edit `ios/exportOptions.plist` and replace `YOUR_TEAM_ID_HERE` with your real Team ID. Commit.

### Trigger a build

Three ways:

**a. Push a version tag** (recommended for releases):
```bash
git tag v1.0.0
git push origin v1.0.0
```
This auto-builds, signs, uploads to TestFlight.

**b. Manual run from GitHub UI:**
- Repo → **Actions** → **iOS build & TestFlight upload** → **Run workflow** → toggle "Upload to TestFlight" → **Run**.

**c. Build verification only** (no upload, no signing — useful to catch errors quickly):
- Just push to any branch. The workflow runs `flutter build ios --no-codesign` to confirm the project compiles.

### Cost on GitHub Actions
- Public repos: **free unlimited macOS minutes**.
- Private repos: 2,000 free minutes/month, but macOS counts as 10×, so effectively **200 minutes/month free** (~10 builds). After that, $0.08/minute.

---

## Path B — Codemagic (alternative, easier setup for Flutter)

### One-time setup

1. Sign up at https://codemagic.io with your GitHub/GitLab/Bitbucket account.
2. **Add application** → select your repo.
3. Codemagic auto-detects the `codemagic.yaml` in the root.
4. **Teams** → **Integrations** → **Apple Developer Portal** → **Connect** → upload the .p8 file + paste Key ID + Issuer ID. Name it `flyp_key` (matches the `integrations:` key in `codemagic.yaml`).
5. **Workflow settings** → add environment variable `APP_STORE_APP_ID` = your numeric App ID.
6. Edit `codemagic.yaml` line `recipients:` to your email.

### Trigger a build

- Push to `main` or push a `v*` tag → auto-build.
- Or click **Start new build** in the Codemagic UI.
- Codemagic uploads to TestFlight automatically and emails you when done.

### Cost on Codemagic
- Free tier: **500 build minutes / month** (~20–25 iOS builds).
- After: $0.038/minute.

---

## After the first successful upload

1. Go to https://appstoreconnect.apple.com/ → your app → **TestFlight** tab.
2. Wait 5–30 min for Apple to process the build.
3. **Internal Testing** → add yourself as a tester → install the **TestFlight app** on your iPhone → install the build → test.
4. **External Testing** (optional) → add up to 10,000 testers → requires a quick App Review (~24h, much faster than App Store review).
5. When ready: **App Store** tab → **Add for Review** → fill in description, screenshots, privacy policy URL, age rating, etc. → **Submit for Review**.

---

## Apple will likely reject your first submission

The current app uses **mock data** — no real backend, fake accounts, fake videos. Apple's reviewers will log in with test credentials, find nothing real, and reject under **Guideline 4.2 — Minimum Functionality**.

**Before submitting for App Store review (not TestFlight), you need:**
- Real authentication (real accounts, real password reset emails)
- Real video upload + storage (S3 or similar)
- Real chat (WebSocket or polling)
- Privacy Policy URL (host on a public site)
- Test account credentials provided to Apple in App Review Information
- Screenshots taken on real iOS devices/simulator (6.7", 6.5", 5.5" sizes)

You can iterate on TestFlight all you want without these — TestFlight reviews are fast and lenient.

---

## Common errors & fixes

**"No matching profiles found"**
→ Bundle ID in App Store Connect doesn't match `com.flyp.app`. Fix one or the other.

**"Invalid Key ID" / "Authentication failed"**
→ Double-check the .p8 file was base64'd correctly (no line breaks, no extra whitespace).

**"Provisioning profile doesn't include the currently selected device"**
→ Only matters for ad-hoc builds. App Store builds don't need a device.

**Build succeeds but doesn't appear in App Store Connect**
→ Wait 5–30 min for Apple's processing pipeline. Check email for "Your build has completed processing" or "ITMS-90683: Missing Purpose String" type errors.

**"Missing Compliance" warning on the build**
→ TestFlight → your build → **Manage** → answer the encryption export compliance question (usually "No" for apps that only use HTTPS).

---

## Local Mac builds (if you ever get a Mac)

```bash
cd flyp_flutter
flutter pub get
flutter precache --ios

# Open in Xcode for first-time signing setup:
open ios/Runner.xcworkspace
# In Xcode: Runner target → Signing & Capabilities → check "Automatically manage signing" → pick your team

flutter build ipa --release
# IPA at build/ios/ipa/flyp.ipa

# Or open Xcode → Product → Archive → Distribute App → App Store Connect → Upload
```

---

## What to ask me next

- **"push to github"** — set up the git remote and push the repo (you give me the GitHub URL or `gh` is already authed)
- **"add backend"** — start building the real backend (auth, video upload, chat, etc.) — required before App Store approval
- **"app icon"** — generate proper iOS icon assets (1024×1024 + all the smaller sizes) from your brand
- **"screenshots"** — set up automated App Store screenshot generation
