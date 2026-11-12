// The iPhone share extension (expo-share-intent) needs a target name of its
// own: when it was also "FLYP", EAS could not tell the two targets apart and
// signed the app with the extension's profile (TestFlight build, 12 Nov
// 2026). The plugin uses one setting for both the target name and the name
// in the share sheet, so the target is "FLYPShare" and this sets the name
// people see back to "FLYP". It runs last (finalized), after the share plugin
// has written the extension's Info.plist.
const fs = require('fs');
const path = require('path');
const plist = require('@expo/plist').default;
const { withFinalizedMod } = require('expo/config-plugins');

module.exports = function withShareExtensionDisplayName(config, { targetName = 'FLYPShare', displayName = 'FLYP' } = {}) {
  return withFinalizedMod(config, [
    'ios',
    (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, targetName, 'ShareExtension-Info.plist');
      if (!fs.existsSync(file)) throw new Error(`[withShareExtensionDisplayName] ${file} not found`);
      const info = plist.parse(fs.readFileSync(file, 'utf8'));
      info.CFBundleDisplayName = displayName;
      fs.writeFileSync(file, plist.build(info));
      return cfg;
    },
  ]);
};
