import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { getCameraPermissionsAsync, requestCameraPermissionsAsync } from 'expo-image-picker';

// Microphone and camera for a call. 'blocked' means the system will not ask
// again: only the Settings app can change it, so the screen offers a button
// to open it instead of a "try again" that would do nothing.
export type Perm = 'granted' | 'denied' | 'blocked';

type PermResponse = { granted: boolean; canAskAgain: boolean };

// One system dialog at a time per permission: the early ask while a call rings
// and an Accept pressed meanwhile share the same answer instead of stacking.
const inflight = new Map<string, Promise<Perm>>();

function ensure(key: string, get: () => Promise<PermResponse>, ask: () => Promise<PermResponse>): Promise<Perm> {
  const running = inflight.get(key);
  if (running) return running;
  const p = ensureOnce(get, ask).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function ensureOnce(get: () => Promise<PermResponse>, ask: () => Promise<PermResponse>): Promise<Perm> {
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

export const ensureMic = () => ensure('mic', getRecordingPermissionsAsync, requestRecordingPermissionsAsync);
// The same OS camera permission the camera screen uses; expo-image-picker is
// simply the installed module that can ask for it without opening a camera.
export const ensureCamera = () => ensure('camera', getCameraPermissionsAsync, requestCameraPermissionsAsync);

// Asked while the incoming call is ringing, BEFORE Accept: the system dialog
// must not appear after the callee has answered, or the caller times out
// while it is open. A refusal is shown by the accept path with its reason.
export async function prepareForCall(kind: 'audio' | 'video'): Promise<void> {
  const mic = await ensureMic();
  if (mic === 'granted' && kind === 'video') await ensureCamera();
}
