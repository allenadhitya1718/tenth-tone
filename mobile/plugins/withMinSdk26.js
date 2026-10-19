// react-native-vision-camera's native frame code (NativeBufferHelper.cpp) is
// compiled out below API 26 and throws "HardwareBuffers require minSdk 26 or
// higher!" for every frame, so the Skia filter preview stayed black. React
// Native 0.88 defaults minSdk to 24; Expo reads the android.minSdkVersion
// Gradle property to override it. API 26 is Android 8.0 (>99% of devices).
const { withGradleProperties } = require('expo/config-plugins');

module.exports = function withMinSdk26(config) {
  return withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter((p) => !(p.type === 'property' && p.key === 'android.minSdkVersion'));
    cfg.modResults.push({ type: 'property', key: 'android.minSdkVersion', value: '26' });
    return cfg;
  });
};
