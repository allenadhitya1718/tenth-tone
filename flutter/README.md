# FLYP — Flutter

Native Flutter rewrite of the FLYP social video app. RTL Arabic, mobile-first, mock data (no backend).

Targets: **iOS** · **Android** · **Web** (already builds).

## Quick start

The Flutter SDK is installed at `C:\src\flutter`. Add it to your PATH for this terminal:

```bash
# Git Bash
export PATH="/c/src/flutter/bin:$PATH"

# PowerShell
$env:PATH = "C:\src\flutter\bin;$env:PATH"
```

Then:

```bash
cd C:\Users\Syed\Desktop\flyp_flutter
flutter pub get        # one-time, install deps
flutter run -d chrome  # run on web (no extra setup)
flutter run             # run on connected device or emulator
```

To make the PATH permanent on Windows: System Properties → Environment Variables → add `C:\src\flutter\bin` to `PATH`.

## Web demo (already built)

```bash
cd C:\Users\Syed\Desktop\flyp_flutter\build\web
python -m http.server 5600
# → http://127.0.0.1:5600
```

## Project structure

```
lib/
├── main.dart                       # Entry, MaterialApp.router, RTL locale
├── core/
│   ├── theme/
│   │   ├── app_colors.dart         # Brand palette + gradients
│   │   └── app_theme.dart          # ThemeData with Cairo font
│   └── widgets/
│       ├── avatar.dart             # Circular avatar w/ cached network image
│       ├── bottom_nav_scaffold.dart # 5-tab bottom nav (dark/light)
│       └── video_grid_card.dart    # Grid card for videos
├── data/
│   ├── models/
│   │   ├── user.dart               # AppUser
│   │   ├── video.dart              # Video
│   │   ├── chat.dart               # Chat + ChatMessage
│   │   └── models.dart             # Re-exports + AppNotification, TxRow, Gift, TrendingTag
│   └── mock_data.dart              # MockDB — all seed data
├── routing/
│   └── app_router.dart             # go_router with all 26 routes
└── features/
    ├── splash/splash_screen.dart
    ├── auth/{login,register,otp,forgot,reset}_screen.dart
    ├── feed/{home,comments}_screen.dart
    ├── discover/discover_screen.dart
    ├── create/{create,camera,edit_video,publish}_screen.dart
    ├── profile/{profile,edit_profile,user_list}_screen.dart
    ├── chat/{inbox,chat}_screen.dart
    ├── notifications/notifications_screen.dart
    ├── live/{live_viewer,live_start,live_host_list}_screen.dart
    ├── share/share_screen.dart
    ├── wallet/wallet_screen.dart
    ├── map/map_screen.dart
    └── settings/settings_screen.dart
```

## All routes

| Path | Screen |
| --- | --- |
| `/` | Splash |
| `/login` `/register` `/otp` `/forgot` `/reset` | Auth flow |
| `/home` (`?tab=foryou\|following`) | Vertical video feed (PageView) |
| `/comments/:id` | Comments bottom sheet |
| `/discover` | Search + trending + grid |
| `/create` | Create entry (record / upload / live / template) |
| `/camera` | Camera UI with record button |
| `/edit-video` | Filters / effects / text / stickers / music |
| `/publish` | Caption + privacy + draft/publish |
| `/profile` | Your profile |
| `/profile/edit` | Edit profile |
| `/profile/:id` | Other user's profile |
| `/list/followers` `/list/following` | User list |
| `/inbox` | Chat list + activity quick actions |
| `/chat/:id` | 1:1 chat |
| `/notifications` | Activity notifications |
| `/share` `/share/:id` | Share screen (the original Figma) |
| `/live/host-list` | Live streams grid |
| `/live/start` | Start a live stream |
| `/live/:id` | Watch a live stream + send gifts (modal) |
| `/map` | Friends map (custom-painted) |
| `/wallet` | Coins / transactions |
| `/settings` | Account, content, support, logout |

## What's mocked

- **No backend.** All state is in `MockDB` — resets on app restart.
- **No real video playback.** Background images via `CachedNetworkImage` from Unsplash.
- **No real auth.** Login/register/OTP all advance the flow.
- **No real chat.** Messages append to in-memory list.

## Verifying

```bash
flutter analyze       # 0 errors, 0 warnings (only info-level lint nags)
flutter test          # passes the boot test
flutter build web     # produces build/web/
flutter build apk     # Android APK (needs Android SDK setup)
flutter build ios     # iOS — REQUIRES MAC + Xcode + Apple Developer account
```

## Building for iOS (App Store)

**You need a Mac.** This is non-negotiable — Apple's tooling only runs on macOS.

Steps when you have Mac access:

```bash
# On the Mac, after copying this repo
cd flyp_flutter
flutter pub get
flutter precache --ios

# Open in Xcode for signing
open ios/Runner.xcworkspace

# Build the IPA (after signing setup)
flutter build ipa --release

# Upload to App Store Connect via Transporter
```

**Cloud-Mac alternative (build from Windows repo):**
- **Codemagic** — free tier covers Flutter iOS, drop in your Apple credentials
- **GitHub Actions** with `macos-latest` runners
- **Bitrise**

## Building for Android (Play Store)

Works fully from Windows after installing Android Studio:
1. Install Android Studio from developer.android.com
2. `flutter doctor` and accept SDK licenses
3. `flutter build apk --release` or `flutter build appbundle --release`

## Next steps

All 27 SRS screens are scaffolded. To make this production-ready:

1. **Real backend integration** — replace `MockDB` calls with HTTP/WebSocket clients
2. **Real video playback** — wire up `video_player` or `chewie` plugin
3. **Real camera** — wire `camera` plugin
4. **Real maps** — wire `google_maps_flutter` (needs API key)
5. **Real live streaming** — wire Agora/MUX SDK
6. **Push notifications** — Firebase Cloud Messaging
7. **Localization** — extract strings to `.arb` files for English support
8. **State management** — currently uses `setState`; consider `riverpod` for app-wide state
9. **Tests** — add widget tests per screen

## Status

- Flutter SDK 3.41.8 installed at `C:\src\flutter`
- Project scaffolded with proper feature-first architecture
- All 27 screens implemented with RTL Arabic + Cairo font
- go_router with 26 routes, deep links work
- `flutter analyze` — 0 errors, 0 warnings
- `flutter build web` — succeeds
- Web preview running at http://127.0.0.1:5600
- iOS build — needs Mac
- Real backend — separate effort
