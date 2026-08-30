# Apple TestFlight Setup — Click-by-Click Checklist

A focused, in-order checklist for getting **FLYP** onto TestFlight for the first time. Each step shows the exact URL, the exact field to fill, and what to copy where.

Total time once Apple approval is complete: **~30 minutes of clicking + 20 minutes for CI build**.

> 📖 For background/reference, see [`BUILD_IOS.md`](./BUILD_IOS.md). This file is the "just do it" path.

---

## Step 0 — Before you start

Have these open in browser tabs:

- [ ] https://developer.apple.com/programs/enroll/
- [ ] https://appstoreconnect.apple.com
- [ ] https://github.com/meeranpmo-svg/Tiktok/settings/secrets/actions

Have these tools ready:
- [ ] Your Apple ID password
- [ ] A credit card for the $99 fee
- [ ] PowerShell open (for base64 encoding later)
- [ ] A safe place to save 1 file (the `.p8` API key — Apple lets you download it only once)

---

## Step 1 — Enroll in Apple Developer Program ⏱️ 5 min clicking + 24–48 hr Apple approval

> 💡 **Start this step first** because the 24–48 h wait is the bottleneck. While you wait, you can come back and prepare everything else.

1. Open https://developer.apple.com/programs/enroll/
2. Click **Start Your Enrollment**
3. Sign in with your Apple ID → enable 2FA if not already on
4. Choose **Individual** ($99) — fastest. Pick **Organization** only if your company will own the app and you have a D-U-N-S number (1–2 extra weeks).
5. Fill in legal name, address, phone
6. Pay $99 with credit card
7. Apple emails approval within 24–48 hours. **Don't proceed past Step 2 until you get the approval email** (subject: *"Welcome to the Apple Developer Program"*).

**Checkpoint:** ✅ You received the approval email AND can log into https://developer.apple.com/account without seeing "Pending".

### 1a. Grab your Team ID

1. Open https://developer.apple.com/account
2. Scroll to **Membership details**
3. Copy the **Team ID** — a 10-character string like `A1B2C3D4E5`
4. Save it to a notepad as `APPLE_TEAM_ID = A1B2C3D4E5`

---

## Step 2 — Create the app entry in App Store Connect ⏱️ 5 min

1. Open https://appstoreconnect.apple.com
2. Sign in (same Apple ID)
3. Click **Apps** → **+** (top left) → **New App**
4. Fill the form **exactly** as below:

| Field | Value |
|---|---|
| Platforms | ☑ **iOS** only (leave macOS / tvOS unchecked) |
| Name | `FLYP` |
| Primary Language | **Arabic** |
| Bundle ID | Pick from dropdown — if `com.flyp.app` isn't listed, click **Register a new bundle ID** below the dropdown. **Must match `capacitor.config.json` exactly — case sensitive.** |
| SKU | `flyp-ios-1` (any unique string; never shown to users) |
| User Access | **Full Access** |

5. Click **Create**

**Checkpoint:** ✅ You see the app's overview page with a placeholder icon and "1.0 Prepare for Submission" panel.

---

## Step 3 — Generate the App Store Connect API key ⏱️ 3 min

This is what lets GitHub CI sign + upload builds without needing your laptop or Mac.

1. Open https://appstoreconnect.apple.com/access/integrations/api
2. Click the **App Store Connect API** tab (not Team Keys)
3. If you see *"Generate API Key or request Access"* — click **Request Access** first, agree to terms
4. Click **+** (or **Generate API Key**)
5. Fill in:
   - **Name**: `CI build key`
   - **Access**: **App Manager** (App Manager is the minimum — don't pick Admin)
6. Click **Generate**
7. **Download the .p8 file IMMEDIATELY** — you can never re-download it. Save to a safe location, e.g. `C:\Users\Syed\Documents\AuthKey_ABCDE12345.p8`
8. Copy these two values shown on screen:
   - **Key ID** (10 chars, e.g. `ABCDE12345`) → save as `APP_STORE_CONNECT_KEY_ID`
   - **Issuer ID** (UUID at the top of the page, e.g. `69a6de70-...`) → save as `APP_STORE_CONNECT_ISSUER_ID`

**Checkpoint:** ✅ You have the `.p8` file saved AND have the 2 IDs noted.

---

## Step 4 — Base64-encode the .p8 file ⏱️ 1 min

The GitHub secret needs the key as a single-line base64 string.

1. Open **PowerShell** (not bash)
2. Run (replace the path with your actual `.p8` file location):
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\Users\Syed\Documents\AuthKey_ABCDE12345.p8"))
   ```
3. Copy the **entire output** (one long line of base64). This is your `APP_STORE_CONNECT_KEY_BASE64`.

**Checkpoint:** ✅ You have a long string of base64 characters in your clipboard.

---

## Step 5 — Add 4 secrets to GitHub ⏱️ 3 min

1. Open https://github.com/meeranpmo-svg/Tiktok/settings/secrets/actions
2. Click **New repository secret** and add **each of these one at a time**:

| # | Name (exact, case-sensitive) | Value |
|---|---|---|
| 1 | `APPLE_TEAM_ID` | The 10-char Team ID from Step 1a |
| 2 | `APP_STORE_CONNECT_KEY_ID` | The 10-char Key ID from Step 3 |
| 3 | `APP_STORE_CONNECT_ISSUER_ID` | The UUID Issuer ID from Step 3 |
| 4 | `APP_STORE_CONNECT_KEY_BASE64` | The long base64 string from Step 4 |

3. After adding each, you should see it in the **Repository secrets** list with a redacted value

**Checkpoint:** ✅ All four secrets appear in the list at the bottom of that page.

---

## Step 6 — Trigger the first TestFlight build ⏱️ 1 min push + 20 min CI

```bash
cd /c/Users/Syed/Desktop/Tiktok
git tag v1.0.0
git push origin v1.0.0
```

Or, alternatively, from the GitHub UI:
1. Go to https://github.com/meeranpmo-svg/Tiktok/actions/workflows/ios-build.yml
2. Click **Run workflow** (top right)
3. Set **Upload to TestFlight** = `true`
4. Click **Run workflow**

**Checkpoint:** ✅ A new run appears in the **Actions** tab with the yellow-spinning circle.

---

## Step 7 — Watch the CI build ⏱️ 20 min

1. Open https://github.com/meeranpmo-svg/Tiktok/actions
2. Click the running workflow → click the **build** job
3. Watch each step turn green:
   - ✅ Select Xcode 16
   - ✅ Install npm dependencies (~30s)
   - ✅ Add iOS platform (Capacitor) (~1 min)
   - ✅ Sync web assets to iOS project (~30s)
   - ✅ Pod install (~1 min)
   - ✅ Decode App Store Connect API key
   - ✅ Build archive (signed for App Store) (~10 min)
   - ✅ Export IPA (~3 min)
   - ✅ Upload to TestFlight (~3 min)

**If any step turns red:** scroll back to the failing step → expand the log → copy the error message → ping me and I'll diagnose. Common issues are listed in Step 9.

**Checkpoint:** ✅ All steps green, total run time ~18–22 min.

---

## Step 8 — Install on your iPhone via TestFlight ⏱️ 5 min

1. Open https://appstoreconnect.apple.com → your app → **TestFlight** tab
2. Wait 5–30 minutes for Apple to **process** the build. It first appears as **"Processing"** then changes to a green status.
3. While waiting, install the **TestFlight** app on your iPhone from the App Store (it's free, by Apple).
4. In App Store Connect → TestFlight → **Internal Testing** → **+** → add your Apple ID email (the same one you signed in with)
5. Apple sends an email invite within 1 minute. Open the TestFlight app on your iPhone → tap the invite link.
6. The **FLYP** card appears with **Install** button. Tap → 10-second install → tap **Open**.

**Checkpoint:** ✅ The app launches with the purple splash screen, then loads your live feed. Native camera/mic prompts work. You can sign in with your demo account.

---

## Step 9 — Common failures and fixes

| Symptom | Most likely cause | Fix |
|---|---|---|
| `xcodebuild: error: No profiles for 'com.flyp.app' were found` | Bundle ID in App Store Connect doesn't match `capacitor.config.json` | Re-check Step 2; the Bundle ID is case-sensitive |
| `Authentication failed because the password was incorrect or the user is locked` | Wrong Issuer ID or Key ID | Double-check Step 5 secrets — common to confuse Key ID with Issuer ID |
| `Error: Could not find or use auto-linked library` | Capacitor plugin pod install flaked | Re-run the workflow (click "Re-run failed jobs") — usually transient |
| `Invalid Code Signing Entitlements` | The app uses Push Notifications without a Push certificate | We listed the plugin but haven't requested push entitlement yet. Either: (a) remove push from `package.json` and re-tag, or (b) in App Store Connect → your app → enable Push Notifications capability. For first TestFlight, option (a) is faster. |
| TestFlight build never shows up | Apple processing delay | Wait up to 30 min. If still missing after 1 h, check the email Apple sent you (App Store Connect → Notifications) for a rejection reason |
| App icon is a grey circle | We didn't supply a proper 1024×1024 icon yet | Already in `resources/AppIcon-1024.png`. Next CI run will pick it up via `capacitor-assets generate` (skipped in current workflow — call me back to wire that in). |

---

## Step 10 — Add external testers (when ready)

Internal testing (Step 8) is limited to people you've added one-by-one and they must have Apple IDs you've assigned to the app. To open testing wider:

1. App Store Connect → TestFlight → **External Testing** → **+** (new group)
2. Group name: e.g. `Friends & family beta`
3. Add **Builds** → pick the v1.0.0 build
4. Apple does a brief **Beta App Review** (~24 h, much lighter than App Store review)
5. After approval, you get a **public TestFlight link** like `https://testflight.apple.com/join/XXXXXXXX`
6. Share with anyone — up to 10 000 external testers per build

---

## Step 11 — Submit for App Store review (when ready to launch)

That's a separate process documented in [`BUILD_IOS.md`](./BUILD_IOS.md) section 4. Don't worry about it until after TestFlight is working and you've had real testers use the app.

---

## Quick reference card

```
APPLE_TEAM_ID                  = 10-char Team ID from developer.apple.com membership page
APP_STORE_CONNECT_KEY_ID       = 10-char Key ID from API Keys page
APP_STORE_CONNECT_ISSUER_ID    = UUID Issuer ID (top of API Keys page)
APP_STORE_CONNECT_KEY_BASE64   = base64 of the .p8 file (PowerShell command above)

Bundle ID  = com.flyp.app   (must match capacitor.config.json exactly)
SKU        = flyp-ios-1           (arbitrary; never shown to users)
App Name   = FLYP
Language   = Arabic
```

---

## When you finish each step, mark the checkbox above. Ping me with the error log if anything fails.
