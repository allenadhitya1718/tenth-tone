# Deploy Flutter web to Vercel — FLYP

The Flutter app builds to `build/web/`. Vercel doesn't have a Flutter SDK, so you build locally and Vercel just serves the output.

## Build first

```bash
# Make sure Flutter is on PATH
export PATH="/c/src/flutter/bin:$PATH"   # Git Bash
# or in PowerShell: $env:PATH = "C:\src\flutter\bin;$env:PATH"

cd C:\Users\Syed\Desktop\flyp_flutter
flutter build web --release
```

That writes the deployable site to `build/web/`.

## Path 1 — Drag & drop (~2 min)

1. Zip the `build/web/` folder (NOT the project root).
2. Go to **https://vercel.com/new** → drop the zip.
3. Project name: `flyp-flutter`
4. Framework Preset: **Other**
5. **Deploy**.

Done. URL is HTTPS — installable as a PWA on iPhone.

## Path 2 — CLI

```bash
cd C:\Users\Syed\Desktop\flyp_flutter
npx vercel
```

Prompts:
1. **Set up and deploy?** → **Y**
2. **Project name?** → `flyp-flutter`
3. **Directory?** → `./` (vercel.json points to `build/web` already)
4. **Modify settings?** → **N**

Then for production:
```bash
flutter build web --release && npx vercel --prod
```

## Path 3 — GitHub + auto-deploy

This needs a tweak — Vercel's build runner doesn't have Flutter SDK. Two options:

### Option A — Commit `build/web/` and serve as-is

Add to `.gitignore`:
```
# Don't ignore web build for Vercel deployment
!build/web/
```

Then push. Vercel just serves `build/web/`. Re-run `flutter build web` and commit before each release.

### Option B — Custom build command (advanced)

Edit `vercel.json` → set `buildCommand` to a script that downloads Flutter and builds:

```json
{
  "buildCommand": "git clone https://github.com/flutter/flutter.git -b stable --depth 1 _flutter && _flutter/bin/flutter pub get && _flutter/bin/flutter build web --release",
  "outputDirectory": "build/web"
}
```

Slow (Flutter SDK downloads each build) but fully automated.

## What's already configured

`vercel.json` in the project root:
- ✅ Output directory: `build/web`
- ✅ SPA rewrites: all routes serve `index.html` (so deep links like `/profile` work after refresh)
- ✅ `flutter_service_worker.js` with `no-cache`
- ✅ Long-lived cache for `canvaskit/`, `assets/`, `icons/`
- ✅ Cross-Origin headers required for canvaskit rendering

## URLs after deployment

`https://flyp-flutter-xxxx.vercel.app`

Hash routes work too:
- `/#/home` → home feed
- `/#/profile` → profile
- `/#/wallet` → wallet
- etc.

## Tradeoffs vs. the PWA prototype

| | PWA (`social-app`) | Flutter web |
| --- | --- | --- |
| Initial load | ~80 KB | ~6 MB |
| First paint | <500ms | ~2–3s |
| Native feel | Web-y | Very native |
| Includes admin | ✅ | ❌ (web admin would need separate Flutter project) |
| Easier to iterate | ✅ | Slower (rebuild + redeploy each change) |

For a quick public demo + iPhone PWA install, the **PWA prototype is the better web target.** Use Flutter for the actual mobile app distribution.

## Custom domain

Same as the PWA — Vercel project → **Settings** → **Domains** → add your domain → update DNS at your registrar.
