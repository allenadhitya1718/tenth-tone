# Sign in with Apple — setup notes

The code is in. Two console steps remain, and they need your Apple and Supabase
logins. **The build compiles without them, but the button fails at runtime and
App Review rejects it.** Do them before tagging a release.

---

## What changed

| File | Change |
| --- | --- |
| `web/js/apple-auth.js` | **New.** `window.AppleAuth` — native sheet on iOS via `@capacitor-community/apple-sign-in`, OAuth redirect on web, the Apple-styled button, nonce handling, first-login name capture. |
| `web/js/supabase.js` | `signInWithApple({token, nonce})` (native, `signInWithIdToken`) and `signInWithAppleOAuth()` (web redirect). |
| `web/js/views.js` | `appleAuthBlock()` helper; button on the **welcome** and **login** screens. |
| `web/index.html` | Loads `apple-auth.js`; asset versions bumped. |
| `package.json` | `@capacitor-community/apple-sign-in@^6.0.0`. Version field untouched. |
| `.github/workflows/ios-build.yml` | Writes `App.entitlements` with the Sign in with Apple entitlement and wires it into the generated Xcode project, before `pod install`. |

Nothing touches the build number or the marketing version — those keep working
exactly as they do today.

The button renders only where it can work. A user who taps Cancel on the Apple
sheet sees no error.

## 1. Apple Developer portal

1. https://developer.apple.com/account → **Certificates, Identifiers & Profiles** → **Identifiers**
2. Open **`com.flyp.app`**
3. Tick **Sign in with Apple** → **Save**

Automatic signing in CI will then issue a profile carrying the capability. If
the archive step fails with *"provisioning profile doesn't support the Sign in
with Apple capability"*, this step was missed — do it and re-run the workflow.

## 2. Supabase

Dashboard (project `qnzgxihlrwanywndcmpf`) → **Authentication** → **Providers** →
**Apple** → enable, then:

- **Authorized Client IDs**: `com.flyp.app`

That field is what the native flow needs. Without it Supabase rejects the
identity token with `Unacceptable audience`. Client ID / Secret Key are only
for the web redirect flow and can stay empty if you ship iOS only.

## 3. Before submitting

- Reviewers must be able to sign in with a **private relay** address — test one.
- FLYP already has account deletion in Settings; point to it in the review notes,
  since Apple checks for it in any app with accounts.

## 4. Ship it

```bash
git tag v1.4.2
git push origin v1.4.2
```

Or from GitHub: **Releases → Create a new release**, tag `v1.4.2`, target this
branch, **Publish**. Watch **Actions → iOS build & TestFlight upload**, then look
for the new build in App Store Connect → TestFlight.
