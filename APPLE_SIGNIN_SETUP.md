# Sign in with Apple — setup & release notes

What landed in the code, and the console work only you can do (it needs your
Apple and Supabase logins). **The build will compile without step 1–3 below, but
the button will fail at runtime and App Review will reject it.** Do them first.

---

## What changed in the repo

| File | Change |
| --- | --- |
| `web/js/apple-auth.js` | **New.** `window.AppleAuth` — native sheet on iOS, OAuth redirect on web, the Apple-styled button, nonce handling, first-login name capture. |
| `web/js/supabase.js` | Added `signInWithApple({token, nonce})` (native, `signInWithIdToken`) and `signInWithAppleOAuth()` (web redirect). |
| `web/js/views.js` | New `appleAuthBlock()` helper; button added to the **welcome** and **login** screens. |
| `web/index.html` | Loads `apple-auth.js`; cache-busting versions bumped. |
| `package.json` | Added `@capacitor-community/apple-sign-in@^6.0.0`; version → `1.0.1`. |
| `.github/workflows/ios-build.yml` | Writes `App.entitlements` with the Sign in with Apple entitlement, wires it into the generated Xcode project, and stamps `CFBundleShortVersionString` from `package.json`. |

The button only renders where it can actually work — on iOS it uses the native
sheet, and a user who taps Cancel is not shown an error.

---

## 1. Apple Developer portal

1. https://developer.apple.com/account → **Certificates, Identifiers & Profiles** → **Identifiers**
2. Open **`com.tenthtone.tenthTone`**
3. Tick **Sign in with Apple** → **Save** → confirm
4. (Web/PWA only — skip if you only care about the iOS app)
   - **Identifiers** → **+** → **Services IDs** → description "Tenth Tone Web", identifier `com.tenthtone.web`
   - Open it → tick **Sign in with Apple** → **Configure**
     - Primary App ID: `com.tenthtone.tenthTone`
     - Domains: `qnzgxihlrwanywndcmpf.supabase.co`
     - Return URLs: `https://qnzgxihlrwanywndcmpf.supabase.co/auth/v1/callback`
5. (Web only) **Keys** → **+** → name "Sign in with Apple key" → tick **Sign in with Apple** →
   configure with the primary App ID → **Download the .p8** (one download only) and note the **Key ID**

## 2. Supabase

Dashboard → **Authentication** → **Providers** → **Apple** → enable, then:

- **Authorized Client IDs**: `com.tenthtone.tenthTone` ← **this is the one the iOS app needs.**
  Without it Supabase rejects the identity token with `Unacceptable audience`.
- Client ID / Secret Key: only for the web flow — Client ID is the Services ID
  (`com.tenthtone.web`), and the secret is a JWT generated from your Team ID,
  Key ID and the `.p8`. Supabase's Apple provider page has a generator; leave
  blank if you are shipping iOS only.

## 3. App Store Connect

Nothing to toggle for the capability itself, but before submitting:

- Apple requires an **account deletion** path in any app with accounts. The app
  has one under Settings → حذف حسابي — point to it in the review notes.
- Give reviewers a **test account** (email + password) that already has content.
- If you ship Apple login, an Apple ID with a **private relay** email must work
  end to end — relay addresses bounce if you have not verified your sending
  domain with Apple, so avoid transactional email to those users for now.

---

## 4. Build and submit

```bash
git add -A
git commit -m "Add Sign in with Apple (native iOS + web OAuth)"
git push origin main          # unsigned verification build runs on GitHub Actions

git tag v1.0.1
git push origin v1.0.1        # signed build → TestFlight
```

Watch **Actions → iOS build & TestFlight upload**. ~8–10 minutes. Then:

1. App Store Connect → **TestFlight** → wait for processing (5–30 min)
2. Install via TestFlight on your iPhone and **actually tap the Apple button** —
   a review rejection here costs days
3. **App Store** tab → **+ Version 1.0.1** → pick the new build → describe the
   change ("Added Sign in with Apple") → **Submit for Review**

### If the build fails

- `Provisioning profile ... doesn't support the Sign in with Apple capability`
  → step 1 was not done, or was done after the profile was cached. Re-run the
  workflow; `-allowProvisioningUpdates` regenerates the profile.
- `Unacceptable audience in id_token` → step 2, the Authorized Client IDs field.
- Anything else → the workflow uploads `xcodebuild.log` as an artifact.
