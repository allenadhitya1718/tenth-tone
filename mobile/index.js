// App entry. The background handlers for pushes and for the incoming-call
// notification's buttons must be registered at module scope BEFORE the app
// renders: Android starts a headless JS runtime for a data push (or an
// Accept / Decline press) with the app closed, and only what this file loads
// exists there. See src/features/call/background.ts.
import './src/features/call/background';
import 'expo-router/entry';
