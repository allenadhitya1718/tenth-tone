// app.json holds the config; this only points the Android build at the
// Firebase file. google-services.json is not committed (the repo is public):
// EAS builds receive it as the file variable GOOGLE_SERVICES_JSON, local
// builds read the copy in this folder.
//
// FLYP_IOS_COMM_NOTIFS=1 (client round 4): iPhone message notifications show
// the sender's photo, as WhatsApp's do. That needs the Notification Service
// Extension in targets/notification-service (added by @bacons/apple-targets)
// and the "Communication Notifications" capability on com.flyp.social, which
// must be switched on in the Apple developer portal first (the iOS build runs
// with EXPO_NO_CAPABILITY_SYNC=1). Until then the switch stays off and the
// build is exactly as before.
const commNotifs = process.env.FLYP_IOS_COMM_NOTIFS === '1';

module.exports = ({ config }) => ({
  ...config,
  // Expo strips android.config (it holds secrets) from the config the app
  // reads at runtime, so expose only a boolean for the maps availability check.
  extra: { ...config.extra, mapsKeyConfigured: !!process.env.GOOGLE_MAPS_ANDROID_KEY, commNotifs },
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
    // Maps SDK for Android key: restricted to com.flyp.app + our signing
    // SHA-1, but kept out of the public repo. EAS / CI / .env.local set it.
    ...(process.env.GOOGLE_MAPS_ANDROID_KEY
      ? { config: { ...config.android?.config, googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY } } }
      : {}),
  },
  ...(commNotifs
    ? {
        ios: {
          ...config.ios,
          appleTeamId: 'V5L3KDWBQS',
          entitlements: { ...config.ios?.entitlements, 'com.apple.developer.usernotifications.communication': true },
          infoPlist: {
            ...config.ios?.infoPlist,
            NSUserActivityTypes: [...(config.ios?.infoPlist?.NSUserActivityTypes ?? []), 'INSendMessageIntent'],
          },
        },
        plugins: [...(config.plugins ?? []), '@bacons/apple-targets'],
      }
    : {}),
});
