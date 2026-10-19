import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { FxTimeline } from './faceFx';
import type { LookSpec } from './looks';

// Native side is the local Expo module flyp-video-filter (Media3 Transformer on
// Android, AVFoundation + Core Image on iOS); autolinking only finds it under
// mobile/modules/. VisionCamera records straight from the sensor, so a look or
// an effect can only reach the file by re-encoding it afterwards.
type FlypVideoFilterModule = {
  applyColorMatrix(inputUri: string, matrix: number[], bitRate: number): Promise<string>;
  /** Android: re-encode with the look's shader and the face-effect timeline. */
  applyLook?(inputUri: string, specJson: string, bitRate: number): Promise<string>;
};

const native = requireOptionalNativeModule<FlypVideoFilterModule>('FlypVideoFilter');

// Looks are only offered when this binary has the export module (and so the
// Skia preview that shipped with it). An older build or an OTA update running
// on one simply shows no look strip, never a preview the file won't match.
export const filtersAvailable = native != null;

/** True when the export can run the look shader and draw face effects (Android build with applyLook). */
export const shaderBakeAvailable = native != null && typeof native.applyLook === 'function' && Platform.OS === 'android';

/**
 * Re-encodes the clip with the look shader (and optionally the face-effect
 * timeline) baked in; returns the new file:// uri.
 */
export async function bakeLook(inputUri: string, look: LookSpec | null, fx: FxTimeline | null, bitRate: number): Promise<string> {
  if (!native?.applyLook) throw new Error('FlypVideoFilter.applyLook is not in this build');
  const out = await native.applyLook(inputUri, JSON.stringify({ look, fx }), bitRate);
  return out.startsWith('file://') ? out : `file://${out}`;
}

/** Colour-matrix bake for binaries without applyLook. */
export async function bakeColorMatrix(inputUri: string, matrix: number[], bitRate: number): Promise<string> {
  if (!native) throw new Error('FlypVideoFilter native module is not in this build');
  const out = await native.applyColorMatrix(inputUri, [...matrix], bitRate);
  return out.startsWith('file://') ? out : `file://${out}`;
}
