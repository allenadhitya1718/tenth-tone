// app.json holds the config; this only points the Android build at the
// Firebase file. google-services.json is not committed (the repo is public):
// EAS builds receive it as the file variable GOOGLE_SERVICES_JSON, local
// builds read the copy in this folder.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
    // Maps SDK for Android key: restricted to com.flyp.app + our signing
    // SHA-1, but kept out of the public repo. EAS / CI / .env.local set it.
    ...(process.env.GOOGLE_MAPS_ANDROID_KEY
      ? { config: { ...config.android?.config, googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY } } }
      : {}),
  },
});
