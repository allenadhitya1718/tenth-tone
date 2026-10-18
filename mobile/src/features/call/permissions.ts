import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { getCameraPermissionsAsync, requestCameraPermissionsAsync } from 'expo-image-picker';

// Microphone and camera for a call. 'blocked' means the system will not ask
// again: only the Settings app can change it, so the screen offers a button
// to open it instead of a "try again" that would do nothing.
export type Perm = 'granted' | 'denied' | 'blocked';

type PermResponse = { granted: boolean; canAskAgain: boolean };

async function ensure(get: () => Promise<PermResponse>, ask: () => Promise<PermResponse>): Promise<Perm> {
  try {
    const now = await get();
    if (now.granted) return 'granted';
    if (!now.canAskAgain) return 'blocked';
    const asked = await ask();
    if (asked.granted) return 'granted';
    return asked.canAskAgain ? 'denied' : 'blocked';
  } catch {
    // No permission module (should not happen in a dev build): let Agora ask.
    return 'granted';
  }
}

export const ensureMic = () => ensure(getRecordingPermissionsAsync, requestRecordingPermissionsAsync);
// The same OS camera permission the camera screen uses; expo-image-picker is
// simply the installed module that can ask for it without opening a camera.
export const ensureCamera = () => ensure(getCameraPermissionsAsync, requestCameraPermissionsAsync);
