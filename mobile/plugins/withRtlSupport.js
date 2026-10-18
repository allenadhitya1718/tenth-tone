// Marks the Android app as supporting right-to-left layouts.
//
// expo-localization used to do this, but its native module also calls
// I18nUtil.forceRTL(false) on every launch (LocalizationModule.kt), which
// wiped the app's own choice: Arabic, the default language, never rendered
// right-to-left. The app does not use expo-localization for anything else,
// so it was removed and this keeps the one manifest flag it provided.
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

module.exports = function withRtlSupport(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.$['android:supportsRtl'] = 'true';
    return cfg;
  });
};
