// app.json holds the config; this only points the Android build at the
// Firebase file. google-services.json is not committed (the repo is public):
// EAS builds receive it as the file variable GOOGLE_SERVICES_JSON, local
// builds read the copy in this folder.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
  },
});
