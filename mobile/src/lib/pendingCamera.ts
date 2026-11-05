// Android can kill FLYP while the system camera is open (phones low on
// memory do this often). The photo is then not lost: expo-image-picker keeps
// it, and getPendingResultAsync() hands it over after the app restarts. But
// the screen that asked for it is gone, so we note who asked before opening
// the camera, and on the next start send the person back there with it.
//
// Used for the story camera and the chat camera. Android only: iOS keeps the
// app alive while its camera sheet is open.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { router, type Href } from 'expo-router';
import { Platform } from 'react-native';

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
    // After a restart Expo hands the camera's result to the app only once
    // React is ready, which can be after this runs: ask for a few seconds.
    let res: Awaited<ReturnType<typeof ImagePicker.getPendingResultAsync>> = null;
    for (let i = 0; i < 20 && !res; i++) {
      res = await ImagePicker.getPendingResultAsync();
      if (!res) await new Promise((r) => setTimeout(r, 500));
    }
    if (!res || !('canceled' in res) || res.canceled || !res.assets?.[0]) return;
    recovered = { owner: note.owner, asset: res.assets[0] };
    const o = note.owner;
    if (o.screen === 'story') router.push('/stories/new' as Href);
    else if (o.screen === 'chat' && /^[0-9a-f-]{36}$/i.test(o.chatId)) router.push(`/chat/${o.chatId}` as Href);
  } catch (e) {
    console.warn('camera recovery:', (e as Error)?.message);
  }
}
