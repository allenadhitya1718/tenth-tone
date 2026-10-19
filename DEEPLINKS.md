# Deep Links — setup checklist

Shared links open the native app directly on the right screen instead of
the browser. The app-side code is **done**; the remaining steps need the
real developer accounts and the live domain, so they're listed here.

## Android App Links on the React Native build (owner steps)

Symptom this fixes: `https://flyp-sa.com/u/<handle>` opens Chrome instead of
FLYP, and `adb shell pm get-app-links com.flyp.app` shows `flyp-sa.com: 1024`
(not verified). Cause: `https://flyp-sa.com/.well-known/assetlinks.json`
returned 404. The file is in the repo (`site/.well-known/assetlinks.json`)
and `site/vercel.json` already serves it as `application/json` with no
redirect, so the site simply has not been deployed with it (or the host
skipped the hidden `.well-known` folder). The routes in
`mobile/app.json` (`/u/`, `/v/`, `/live/` on `flyp-sa.com` and
`www.flyp-sa.com`, `autoVerify: true`) match the screens in `mobile/src/app`.

1. Find the Play app-signing fingerprint: Play Console, select FLYP,
   Test and release, App integrity (older UI: Setup, App signing), tab
   "App signing" ("Play app signing"), copy **SHA-256 certificate
   fingerprint** under "App signing key certificate". If you also install
   builds signed with your own upload key or EAS keystore, copy their
   SHA-256 too (the "Upload key certificate" box in the same page, or
   `eas credentials`). Never guess one.
2. Open `site/.well-known/assetlinks.json` and add each fingerprint to
   `sha256_cert_fingerprints` (colon-separated uppercase hex, one string
   per key). It currently holds only the fingerprint of the sideloaded test
   APK; keep it, and add the Play one next to it.
3. Deploy `site/` so that the hidden `.well-known` folder is included
   (Vercel: `vercel --prod` from `site/`; with a drag-and-drop or FTP
   host, upload the `.well-known` folder explicitly).
4. Check: `curl -sI https://flyp-sa.com/.well-known/assetlinks.json` must
   return `200` and `content-type: application/json`, with no redirect
   (also for `https://www.flyp-sa.com/...`; if www redirects to the apex,
   either serve the file on www too or drop the www intent filter).
5. On the phone: `adb shell pm verify-app-links --re-verify com.flyp.app`,
   wait a minute, then `adb shell pm get-app-links com.flyp.app` must show
   `flyp-sa.com: verified`. This needs a build that contains the
   `autoVerify` filters (any build from this repo state).

## Link formats

| Link | Opens |
|---|---|
| `https://flyp-sa.com/v/<videoId>` | that video, pinned to the top of the feed |
| `https://flyp-sa.com/u/<userId>` | that user's profile |
| `https://flyp-sa.com/live/<liveId>` | that live stream |
| `flyp://v/<videoId>` | custom-scheme fallback (no domain verification needed) |

Video links are public — a signed-out person who taps one still sees the
video, so a shared link is never a dead end.

## Already done (in the repo)

- `web/js/deeplink.js` — parses incoming links, handles the Capacitor
  `appUrlOpen` event, the cold-start launch URL, and plain-web visits.
- `web/js/app.js` — `/v/<id>` route; `/v/` added to the public prefixes.
- `web/js/views.js` — the share screen copies the real deep link.
- `web/js/db.js` — `API.fetchVideo(id)` for the pinned video.
- `android/app/src/main/AndroidManifest.xml` — App Links + custom-scheme
  intent filters.
- `web/.well-known/assetlinks.json` and `web/.well-known/apple-app-site-association`
  — association files, with placeholders to fill in.

## Remaining steps

### 1. Host the association files at the domain root

Both must be reachable at the **root** of `flyp-sa.com`, over HTTPS,
with no redirects:

- `https://flyp-sa.com/.well-known/assetlinks.json`
- `https://flyp-sa.com/.well-known/apple-app-site-association`

The Apple file has **no `.json` extension** and must be served as
`application/json`. On Netlify, add to `netlify.toml`:

```toml
[[headers]]
  for = "/.well-known/apple-app-site-association"
  [headers.values]
    Content-Type = "application/json"
```

Also make sure unknown paths (`/v/…`, `/u/…`) rewrite to `index.html`
so the web fallback works:

```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### 2. Android — fill in the signing fingerprint

`web/.well-known/assetlinks.json` has a placeholder. Get the SHA-256 of
the **release** signing certificate (the one Play uses — if you use Play
App Signing, copy it from Play Console → Setup → App signing):

```bash
keytool -list -v -keystore <your-release.keystore> -alias <your-alias>
```

Paste the `SHA256:` value into `sha256_cert_fingerprints`.

Verify after deploying:

```bash
adb shell pm verify-app-links --re-verify com.flyp.app
```

### 3. iOS — Team ID + Associated Domains

1. In `web/.well-known/apple-app-site-association`, replace
   `REPLACE_WITH_TEAMID` with your Apple Developer Team ID, giving
   e.g. `A1B2C3D4E5.com.flyp.app`.
2. The `ios/` project doesn't exist in the repo yet — create it with
   `npx cap add ios`, then in Xcode: target → Signing & Capabilities →
   **+ Capability** → **Associated Domains**, and add:
   - `applinks:flyp-sa.com`
   - `applinks:www.flyp-sa.com`

### 4. Test

- **Android:** `adb shell am start -a android.intent.action.VIEW -d "https://flyp-sa.com/v/SOME_ID"`
- **iOS:** send yourself the link in Notes/Messages and tap it (typing it
  into Safari's address bar does *not* trigger a Universal Link).
- **Web:** open `https://flyp-sa.com/v/SOME_ID` in a desktop browser —
  it should land on that video in the PWA.

## Note on the domain

`flyp-sa.com` is taken from the support/privacy addresses already used
in the app. If the real domain differs, update it in **three** places:
`web/js/deeplink.js` (`DOMAIN`), the `android:host` values in
`AndroidManifest.xml`, and the iOS Associated Domains entries.
