// The fingerprint decides which builds an over-the-air update may reach
// (runtimeVersion policy "fingerprint" in app.json): an update only goes to
// builds whose native side has the same fingerprint, so new JavaScript can
// never land on a build that lacks a native module it needs (that is how
// "WebRTC native module not found" crashed a test phone on 6 Nov 2026).
//
// The build and the update must therefore compute the SAME fingerprint from
// the same commit. app.config.js fills a few values from the environment, and
// those differ between workflows without changing anything an update relies
// on, so they are left out here:
//  - `extra` (mapsKeyConfigured, commNotifs): read by JavaScript only, and
//    every update carries its own copy;
//  - the Google Maps key: a value in the Android manifest, not code. iOS
//    builds don't set it at all, while the update workflow does.
// The google-services.json path is already left out by Expo (it hashes the
// file's contents instead), so the update workflow writes the same file.
// FLYP_IOS_COMM_NOTIFS really changes the iOS build (an extension and an
// entitlement), so it stays in, and the update workflow passes the same value.
const { DEFAULT_SOURCE_SKIPS, SourceSkips } = require('@expo/fingerprint');

/** @type {import('@expo/fingerprint').Config} */
module.exports = {
  sourceSkips: DEFAULT_SOURCE_SKIPS | SourceSkips.ExpoConfigExtraSection,
  fileHookTransform: (source, chunk) => {
    if (source.type !== 'contents' || source.id !== 'expoConfig' || typeof chunk !== 'string') return chunk;
    const config = JSON.parse(chunk);
    if (config.android?.config?.googleMaps) {
      delete config.android.config.googleMaps;
      if (Object.keys(config.android.config).length === 0) delete config.android.config;
    }
    return JSON.stringify(config);
  },
};
