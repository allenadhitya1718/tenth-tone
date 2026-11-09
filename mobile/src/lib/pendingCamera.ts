// Android can kill FLYP while the system camera is open (phones low on
// memory do this often), and it restarts on the feed with the photo lost.
// So we note who asked before opening the camera, and on the next start find
// the photo (below) and send the person back to that screen with it.
//
// Used for the story camera and the chat camera. Android only: iOS keeps the
// app alive while its camera sheet is open.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { router, type Href } from 'expo-router';
import { Image, Platform } from 'react-native';

const KEY = 'tt-pending-camera';
// A photo older than this is stale: the person has moved on.
const MAX_AGE_MS = 15 * 60_000;

export type CameraOwner = { screen: 'story'; kind: 'image' | 'video' } | { screen: 'chat'; chatId: string };

let recovered: { owner: CameraOwner; asset: ImagePicker.ImagePickerAsset } | null = null;

/** launchCameraAsync, remembering who asked in case Android kills the app meanwhile. */
export async function launchCameraFor(
  owner: CameraOwner,
  opts: ImagePicker.ImagePickerOptions,
): Promise<ImagePicker.ImagePickerResult> {
  if (Platform.OS === 'android') {
    await AsyncStorage.setItem(KEY, JSON.stringify({ owner, at: Date.now() })).catch(() => {});
  }
  try {
    return await ImagePicker.launchCameraAsync(opts);
  } finally {
    if (Platform.OS === 'android') await AsyncStorage.removeItem(KEY).catch(() => {});
  }
}

/** Hands a photo or clip to a screen that is about to open (a gallery
 *  share into FLYP, features/share/ShareIncoming.tsx); that screen takes it
 *  with takeRecoveredCamera(), exactly as after a camera recovery. */
export function handOverMedia(owner: CameraOwner, asset: ImagePicker.ImagePickerAsset) {
  recovered = { owner, asset };
}

/** The recovered photo or clip for this screen, once. */
export function takeRecoveredCamera(match: (o: CameraOwner) => boolean): ImagePicker.ImagePickerAsset | null {
  if (!recovered || !match(recovered.owner)) return null;
  const { asset } = recovered;
  recovered = null;
  return asset;
}

let checked = false;

/**
 * Called once after sign-in. If the app was killed while the camera was
 * open, reopens the screen that asked, which then takes the photo with
 * takeRecoveredCamera(). Never throws.
 */
export async function recoverPendingCamera(): Promise<void> {
  if (Platform.OS !== 'android' || checked) return;
  checked = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return;
    await AsyncStorage.removeItem(KEY);
    const note = JSON.parse(raw) as { owner?: CameraOwner; at?: number };
    if (!note.owner || !note.at || Date.now() - note.at > MAX_AGE_MS) return;
    const asset = (await pendingResult()) ?? (await photoLeftByCamera(note.at, note.owner));
    if (!asset) return;
    recovered = { owner: note.owner, asset };
    const o = note.owner;
    if (o.screen === 'story') router.push('/stories/new' as Href);
    else if (o.screen === 'chat' && /^[0-9a-f-]{36}$/i.test(o.chatId)) router.push(`/chat/${o.chatId}` as Href);
  } catch (e) {
    console.warn('camera recovery:', (e as Error)?.message);
  }
}

async function pendingResult(): Promise<ImagePicker.ImagePickerAsset | null> {
  // Expo can hand the camera's result over a moment after start-up.
  for (let i = 0; i < 6; i++) {
    const res = await ImagePicker.getPendingResultAsync();
    if (res && 'canceled' in res) return !res.canceled && res.assets?.[0] ? res.assets[0] : null;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

// React Native drops the camera's answer when it reaches a freshly restarted
// app before React is ready ("Tried to access onActivityResult while context
// is not ready"), so getPendingResultAsync() has nothing. The photo itself is
// already saved: the picker has the camera write it to cache/ImagePicker
// before it opens. Take the newest non-empty photo written there since the
// camera opened. Photos only: a clip would need its length checked.
async function photoLeftByCamera(since: number, owner: CameraOwner): Promise<ImagePicker.ImagePickerAsset | null> {
  if (owner.screen === 'story' && owner.kind !== 'image') return null;
  const dir = new Directory(Paths.cache, 'ImagePicker');
  if (!dir.exists) return null;
  let best: { file: File; at: number } | null = null;
  for (const f of dir.list()) {
    if (!(f instanceof File) || !/\.(jpe?g|png)$/i.test(f.name)) continue;
    const info = f.info();
    const at = info.modificationTime ?? 0;
    if (!info.exists || !info.size || at < since - 2000) continue;
    if (!best || at > best.at) best = { file: f, at };
  }
  if (!best) return null;
  const { width, height } = await Image.getSize(best.file.uri);
  return {
    uri: best.file.uri,
    width,
    height,
    type: 'image',
    mimeType: /\.png$/i.test(best.file.name) ? 'image/png' : 'image/jpeg',
    fileName: best.file.name,
    fileSize: best.file.size ?? undefined,
    assetId: null,
  } as ImagePicker.ImagePickerAsset;
}
