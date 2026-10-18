import { requireOptionalNativeModule } from 'expo';

import type { ColorMatrix } from './filters';

// Native side is the local Expo module flyp-video-filter (AVFoundation + Core
// Image on iOS, Media3 Transformer on Android); autolinking only finds it under
// mobile/modules/. VisionCamera records straight from the
// sensor, so a filter can only reach the file by re-encoding it afterwards.
type FlypVideoFilterModule = {
  applyColorMatrix(inputUri: string, matrix: number[], bitRate: number): Promise<string>;
};

const native = requireOptionalNativeModule<FlypVideoFilterModule>('FlypVideoFilter');

// Filters are only offered when this binary has the export module (and so the
// Skia preview that shipped with it). An older build or an OTA update running
// on one simply shows no filter strip, never a preview the file won't match.
export const filtersAvailable = native != null;

/** Re-encodes the clip with the matrix baked in and returns the new file:// uri. */
export async function bakeColorMatrix(inputUri: string, matrix: ColorMatrix, bitRate: number): Promise<string> {
  if (!native) throw new Error('FlypVideoFilter native module is not in this build');
  const out = await native.applyColorMatrix(inputUri, [...matrix], bitRate);
  return out.startsWith('file://') ? out : `file://${out}`;
}
