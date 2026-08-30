# Tiktok — FLYP

Monorepo for the **FLYP** social video app. Two implementations of the same SRS:

```
.
├── web/        ← PWA web prototype (HTML/CSS/JS, RTL Arabic)
│                 Mobile app + admin dashboard. Iphone PWA-installable.
└── flutter/    ← Native Flutter rewrite (iOS/Android/Web)
                  All 27 screens. App-Store-ready scaffolding.
```

## Quick start

### 🌐 PWA (web)

```bash
cd web
python -m http.server 5500
# → http://127.0.0.1:5500/         mobile app
# → http://127.0.0.1:5500/admin    admin dashboard
```

PWA-installable on iPhone via Safari → Share → Add to Home Screen (requires HTTPS in production — deploy to Vercel for that).

### 📱 Flutter (native)

```bash
# Flutter SDK at C:\src\flutter
export PATH="/c/src/flutter/bin:$PATH"
cd flutter
flutter pub get
flutter run -d chrome     # web
flutter run               # connected device/emulator
```

Pre-built web is at `flutter/build_web/` (so Vercel can deploy without re-running Flutter).

## Deployment

| Target | Folder | Guide |
| --- | --- | --- |
| Vercel (PWA) | `web/` | [`web/VERCEL_DEPLOY.md`](web/VERCEL_DEPLOY.md) |
| Vercel (Flutter web) | `flutter/build_web/` | [`flutter/VERCEL_DEPLOY.md`](flutter/VERCEL_DEPLOY.md) |
| iOS App Store | `flutter/` | [`flutter/BUILD_IOS.md`](flutter/BUILD_IOS.md) |
| Android Play Store | `flutter/` | `flutter build appbundle --release` |

## Status

- ✅ All 27 SRS screens implemented in both PWA and Flutter
- ✅ RTL Arabic, Cairo font
- ✅ Admin dashboard (web only) with 11 modules from SRS
- ✅ Mock data layer — no backend yet
- ✅ Vercel configs ready
- ✅ GitHub Actions iOS pipeline (TestFlight upload on `git tag v*`)
- ⏳ Real backend (auth, video storage, chat, live) — separate effort
- ⏳ Apple Developer enrollment ($99/yr) needed for App Store

## License

Proprietary — © Joint Executive Company.
