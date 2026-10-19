import { Platform } from 'react-native';

import { shaderBakeAvailable } from './videoFilter';

// Face effects need: the Android export with applyLook (to put the effects in
// the file), and the ML Kit face detector module in this binary. Anything else
// (iOS, an older build running a newer JS bundle) simply has no face effects in
// the strip, so nothing is shown that the file would not contain.
function probe(): boolean {
  if (Platform.OS !== 'android' || !shaderBakeAvailable) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NitroModules } = require('react-native-nitro-modules') as typeof import('react-native-nitro-modules');
    return NitroModules.hasHybridObject('FaceDetectorFactory');
  } catch {
    return false;
  }
}

export const faceFxAvailable: boolean = probe();
