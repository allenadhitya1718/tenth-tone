import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import type { LocalMedia } from '@/api/upload';

export const AVATAR_SIZE = 512;

export type PickResult = { media: LocalMedia } | { denied: true } | null;

// Square crop in the system picker, then a 512 px JPEG: small enough for
// moderation to screen (an image over its size limit is skipped, which fails
// open) and plenty for a 96 px circle on a 3x screen.
export async function pickAvatar(source: 'library' | 'camera'): Promise<PickResult> {
  const opts: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
    exif: false,
  };
  let res: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return { denied: true };
    res = await ImagePicker.launchCameraAsync({ ...opts, cameraType: ImagePicker.CameraType.front });
  } else {
    // The system photo picker needs no permission on iOS 14+ and Android 13+.
    res = await ImagePicker.launchImageLibraryAsync(opts);
  }
  const a = res.canceled ? null : res.assets[0];
  if (!a) return null;
  return { media: await squareJpeg(a.uri, a.width, a.height) };
}

async function squareJpeg(uri: string, width: number, height: number): Promise<LocalMedia> {
  const ctx = ImageManipulator.manipulate(uri);
  // iOS ignores `aspect` and Android may hand back an off-by-a-pixel crop, so
  // centre-crop to a true square before scaling.
  if (width && height && width !== height) {
    const side = Math.min(width, height);
    ctx.crop({ originX: Math.floor((width - side) / 2), originY: Math.floor((height - side) / 2), width: side, height: side });
  }
  ctx.resize({ width: AVATAR_SIZE, height: AVATAR_SIZE });
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
  return { uri: out.uri, mimeType: 'image/jpeg', name: 'avatar.jpg' };
}
