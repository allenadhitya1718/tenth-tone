import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import type { LocalMedia } from '@/api/upload';

// The front of a national ID / Iqama for payout verification (0130).
// Re-encoded as a JPEG no wider than 1600 px: readable for a reviewer, well
// under the 'kyc' bucket's 10 MB limit, and re-encoding drops EXIF (GPS,
// device) so nothing but the picture leaves the phone.
const MAX_SIDE = 1600;

export type IdPhotoResult = { media: LocalMedia } | { denied: true } | null;

export async function pickIdPhoto(source: 'camera' | 'library'): Promise<IdPhotoResult> {
  const opts: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 1,
    exif: false,
  };
  let res: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return { denied: true };
    res = await ImagePicker.launchCameraAsync({ ...opts, cameraType: ImagePicker.CameraType.back });
  } else {
    // The system photo picker needs no permission on iOS 14+ and Android 13+.
    res = await ImagePicker.launchImageLibraryAsync(opts);
  }
  const a = res.canceled ? null : res.assets[0];
  if (!a) return null;

  const ctx = ImageManipulator.manipulate(a.uri);
  const longest = Math.max(a.width || 0, a.height || 0);
  if (longest > MAX_SIDE) {
    ctx.resize(a.width >= a.height ? { width: MAX_SIDE } : { height: MAX_SIDE });
  }
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
  return { media: { uri: out.uri, mimeType: 'image/jpeg', name: 'id.jpg' } };
}
