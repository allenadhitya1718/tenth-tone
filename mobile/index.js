// App entry. The background handlers for pushes and for the incoming-call
// notification's buttons must be registered at module scope BEFORE the app
// renders: Android starts a headless JS runtime for a data push (or an
// Accept / Decline press) with the app closed, and only what this file loads
// exists there. See src/features/call/background.ts.
import './src/features/call/background';
// The Android foreground service that keeps a call / live stage / walkie
// heard when the app is minimised: its runner and the notification's
// buttons must exist in a headless runtime too (src/lib/audioForeground.ts).
import './src/lib/audioForeground';
import 'expo-router/entry';
