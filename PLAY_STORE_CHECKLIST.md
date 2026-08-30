# Google Play Store Setup — Click-by-Click Checklist

Companion to [`APPLE_TESTFLIGHT_CHECKLIST.md`](./APPLE_TESTFLIGHT_CHECKLIST.md) — same step-by-step format, for Android.

Total time: **~45 minutes of clicking + 1 hour for Google's first review**. No multi-day approval wait like Apple.

---

## Step 0 — Before you start

Have these open in browser tabs:

- [ ] https://play.google.com/console/u/0/signup
- [ ] https://github.com/meeranpmo-svg/Tiktok/settings/secrets/actions

Have these tools ready:
- [ ] Your Google account (Gmail) password — same one you'd use for Play Store
- [ ] $25 (one-time fee, lifetime)
- [ ] PowerShell open
- [ ] Java JDK installed — if not, install OpenJDK in Step 1

---

## Step 1 — Install Java JDK (if not already installed) ⏱️ 5 min

You need `keytool` to generate your Play Store upload keystore. It comes with any JDK.

1. Open PowerShell and run:
   ```powershell
   keytool -help
   ```
2. **If you see the help text** → ✅ JDK is installed, skip to Step 2.
3. **If you get "keytool is not recognized"** → install OpenJDK:
   - Download from https://adoptium.net/temurin/releases/?version=21&package=jdk&arch=x64&os=windows
   - Run the `.msi` installer → check **"Set JAVA_HOME variable"** and **"Add to PATH"**
   - Close and reopen PowerShell
   - Run `keytool -help` again → should now work

**Checkpoint:** ✅ `keytool -help` prints the help text.

---

## Step 2 — Generate your Play Store upload keystore ⏱️ 3 min

> ⚠️ **Critical:** This keystore is what proves to Google that future updates come from you. If you lose it AND lose access to your Play Console account, you can never update the app. Back it up to two places.

1. In PowerShell, run (replace `YourPassword123!` with a real strong password — write it down):
   ```powershell
   cd C:\Users\Syed\Desktop\Tiktok
   keytool -genkey -v `
     -keystore upload-keystore.jks `
     -alias flyp-upload `
     -keyalg RSA -keysize 2048 -validity 36500 `
     -storepass YourPassword123! `
     -keypass YourPassword123! `
     -dname "CN=FLYP, OU=Mobile, O=FLYP, L=Riyadh, ST=Riyadh, C=SA"
   ```
2. The file `upload-keystore.jks` (~3 KB) is created in your Tiktok folder
3. **Move it OUT of the repo** — never commit it:
   ```powershell
   mkdir C:\Users\Syed\Documents\FLYPKeys
   move upload-keystore.jks C:\Users\Syed\Documents\FLYPKeys\
   ```
4. Save a backup copy to a second location (cloud drive, USB stick, password manager). If you lose this file you cannot update the app on Play Store.

**Checkpoint:** ✅ The `upload-keystore.jks` file exists at `C:\Users\Syed\Documents\FLYPKeys\upload-keystore.jks` AND you have the password written down.

---

## Step 3 — Base64-encode the keystore ⏱️ 1 min

Same trick as the Apple `.p8` file — GitHub secrets store text only.

1. In PowerShell:
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\Users\Syed\Documents\FLYPKeys\upload-keystore.jks"))
   ```
2. Copy the **entire output** (one long line, ~5 000 base64 characters).

**Checkpoint:** ✅ You have a long base64 string in your clipboard.

---

## Step 4 — Add 4 GitHub secrets ⏱️ 3 min

1. Open https://github.com/meeranpmo-svg/Tiktok/settings/secrets/actions
2. Click **New repository secret** and add **each one**:

| # | Name (exact, case-sensitive) | Value |
|---|---|---|
| 1 | `ANDROID_KEYSTORE_BASE64` | The long base64 string from Step 3 |
| 2 | `ANDROID_KEYSTORE_PASSWORD` | The password from Step 2 (`YourPassword123!`) |
| 3 | `ANDROID_KEY_ALIAS` | `flyp-upload` |
| 4 | `ANDROID_KEY_PASSWORD` | Same password as #2 |

**Checkpoint:** ✅ All four secrets appear in the **Repository secrets** list.

---

## Step 5 — Enroll in Google Play Console ⏱️ 10 min, instant approval

Much faster than Apple — Google approves the account within minutes, not days.

1. Open https://play.google.com/console/u/0/signup
2. Sign in with the Google account that will own the app
3. Choose **An organization** (most users) or **Personal**
4. Fill in:
   - **Developer name** (shown to users): `FLYP` (or your company name)
   - **Contact email**: a real reachable email
   - **Contact phone**: real number
   - **Website** (optional): leave blank or use `https://tiktok-nu-eosin.vercel.app`
5. Click through the **Developer Distribution Agreement** → accept
6. Pay **$25** one-time fee (Google accepts credit card, debit card, PayPal in some regions)
7. **Verify your identity** — Google will email you a verification link within a few minutes

**Checkpoint:** ✅ You can log into https://play.google.com/console and see the **Apps** dashboard.

---

## Step 6 — Create the app in Play Console ⏱️ 5 min

1. In Play Console → **Create app** (top right)
2. Fill in:

| Field | Value |
|---|---|
| App name | `FLYP` |
| Default language | **Arabic** |
| App or game | **App** |
| Free or paid | **Free** |
| Declarations | ☑ Developer Program Policies, ☑ US export laws |

3. Click **Create app**

You're now on the app dashboard with a long left sidebar of tasks (Store listing, App content, etc.). We'll fill those later — first let's get a build uploaded.

**Checkpoint:** ✅ You see the app's overview page with a setup task list.

---

## Step 7 — Trigger the signed release build ⏱️ 1 min push + 6 min CI

```bash
cd /c/Users/Syed/Desktop/Tiktok
git pull              # make sure you have the latest workflow
git tag v1.0.0
git push origin v1.0.0
```

This pushes a version tag. The workflow detects the 4 secrets you set in Step 4 and produces a **signed release AAB** (Android App Bundle) ready for Play Console.

**Watch the build:** https://github.com/meeranpmo-svg/Tiktok/actions/workflows/android-build.yml

You should see steps:
- ✅ Detect signing secrets → "Signing secrets present"
- ✅ Decode upload keystore
- ✅ Build debug APK
- ✅ Build signed release AAB (Play Store)
- ✅ Build signed release APK (side-load)

Total time: ~6 minutes.

**Checkpoint:** ✅ The build has a green ✓ AND the artifacts section at the bottom shows `flyp-release-aab-XXXXX`.

---

## Step 8 — Download the AAB ⏱️ 1 min

1. On the green-check workflow run → scroll to **Artifacts** section
2. Click **flyp-release-aab-XXXXX** to download a `.zip`
3. Unzip → you have `app-release.aab` (~3–8 MB) on your disk

**Checkpoint:** ✅ You have `app-release.aab` saved locally.

---

## Step 9 — Set up Internal Testing track ⏱️ 5 min

Faster than full release — your team can install via a TestFlight-like link.

1. Play Console → your app → left sidebar → **Testing** → **Internal testing**
2. Click **Create new release**
3. Click **Upload** → select your `app-release.aab`
4. Wait ~30 seconds for upload + processing
5. Fill the **Release name** (auto-fills, e.g. `1 (1.0.0)`)
6. **Release notes**:
   ```
   <ar-SA>الإصدار الأول</ar-SA>
   ```
7. Click **Next** → **Save** → **Review release** → **Start rollout to Internal testing** → confirm

Google may flag a few "errors" or "warnings" — most are about missing store listing assets (described in Step 11). Internal testing can roll out even with those warnings.

**Checkpoint:** ✅ The release shows status **"Available to internal testers"**.

---

## Step 10 — Add testers and get the install link ⏱️ 3 min

1. Same **Internal testing** page → scroll to **Testers** tab
2. Click **Create email list** → name: `Family & Friends`
3. Paste tester email addresses (one per line) — your own Google email first
4. Click **Save changes**
5. Back in the **Testers** tab → copy the **opt-in URL** at the bottom (looks like `https://play.google.com/apps/internaltest/XXXXX`)
6. Share that link with your testers. They:
   - Open it on their Android phone in Chrome
   - Tap **Become a tester**
   - Tap **Download it on Google Play** → goes to a normal Play Store page that lets them install FLYP

**Checkpoint:** ✅ You and at least one tester have the app installed via Play Store (not side-loaded).

---

## Step 11 — Fill the store listing (required before public release) ⏱️ 30 min

You can skip this for now and stay on internal testing forever. To eventually go public:

1. Play Console → your app → left sidebar → **Grow** → **Store presence** → **Main store listing**
2. Fill in (all in Arabic for primary language):
   - **App name** (≤30 chars): `FLYP`
   - **Short description** (≤80 chars): one sentence about the app
   - **Full description** (≤4000 chars): longer marketing copy
3. **Graphics** — required images:
   - **App icon**: 512×512 PNG (already have `resources/AppIcon-1024.png` — resize to 512×512)
   - **Feature graphic**: 1024×500 PNG (banner shown on Play Store page)
   - **Phone screenshots**: at least 2, up to 8. Sizes between 320–3840 px. Take with Android emulator or real device.
4. Click **Save**

Then in left sidebar → **Policy** → **App content** — fill out the questionnaires:
- **Privacy policy**: paste `https://tiktok-nu-eosin.vercel.app/privacy` (host PRIVACY.md somewhere first)
- **Ads**: No (we don't show ads yet)
- **App access**: provide test login (Google must be able to log in to review)
- **Data safety**: declare you collect email, location, photos — be honest
- **Target audience**: 13+ (FLYP has DMs and UGC; pick 17+ if you're being conservative)
- **News app**: No
- **COVID-19 contact tracing**: No

After all the green checkmarks: **Production** track → **Create release** → upload same AAB or promote from internal → submit for review.

Google's production review usually takes 1–7 days. Internal testing has **no review**.

**Checkpoint:** ✅ Store listing has no red exclamation marks remaining.

---

## Step 12 — Common failures and fixes

| Symptom | Most likely cause | Fix |
|---|---|---|
| `::error::Decoded keystore does not look like a JKS file` | Base64 string got truncated when pasting into GitHub secret | Re-run Step 3, paste again. Make sure no line breaks were added. |
| `keystore was tampered with, or password was incorrect` | `ANDROID_KEYSTORE_PASSWORD` doesn't match what you used in keytool | Re-add the secret with the exact password from Step 2. |
| Play Console: *"You uploaded an APK or Android App Bundle which is signed with a key that is also used to sign APKs that are delivered to users"* | First upload uses a keystore Google has already seen for another app | Generate a fresh keystore with a different alias and try again. |
| Play Console: *"You need to use a different version code"* | Two builds with the same `versionCode` | Push a fresh tag (`v1.0.1`) — the workflow auto-increments versionCode from the timestamp. |
| Workflow built but no AAB artifact | Tag wasn't pushed (you only pushed a commit) | `git tag v1.0.0 && git push origin v1.0.0` — tags need a separate push. |
| Workflow says "No signing secrets" | Secret names typo'd | Re-check the four names in Step 4 — case-sensitive. |

---

## Step 13 — Updating the app

Same pattern as iOS:

```bash
# Make code changes
git add -A && git commit -m "..."
git push

# When ready for a new Play Store release:
git tag v1.0.1
git push origin v1.0.1
```

CI produces a fresh signed AAB. Upload it to Play Console → Internal Testing → Create new release. Or promote the existing internal release to closed/open/production.

---

## Quick reference card

```
ANDROID_KEYSTORE_BASE64    = base64 of upload-keystore.jks   (Step 3)
ANDROID_KEYSTORE_PASSWORD  = the password you set in keytool  (Step 2)
ANDROID_KEY_ALIAS          = flyp-upload
ANDROID_KEY_PASSWORD       = same as ANDROID_KEYSTORE_PASSWORD

Keystore location  = C:\Users\Syed\Documents\FLYPKeys\upload-keystore.jks
Bundle ID          = com.flyp.app   (matches Apple, matches capacitor.config.json)
App name           = FLYP
Default language   = Arabic
First track        = Internal testing (no review)
Cost               = $25 one-time (vs Apple $99/year)
```

---

## When you finish each step, mark the checkbox above. Ping me with the error log if any step fails.
