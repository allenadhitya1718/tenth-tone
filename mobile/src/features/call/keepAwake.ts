import { requireOptionalNativeModule } from 'expo';

// Keeps the screen on for the length of a call.
//
// expo-keep-awake is not a dependency of this app, but `expo` itself depends
// on it, so its native module (ExpoKeepAwake) is linked into every build.
// It is reached through `expo` rather than imported by name, and optionally:
// a build without it simply lets the screen sleep. Once
// `npx expo install expo-keep-awake` is run this file can switch to
// activateKeepAwakeAsync / deactivateKeepAwake from the package.
type KeepAwakeModule = {
  activate?: (tag: string) => Promise<void>;
  deactivate?: (tag: string) => Promise<void>;
};

let mod: KeepAwakeModule | null | undefined;
function native(): KeepAwakeModule | null {
  if (mod === undefined) {
    try {
      mod = requireOptionalNativeModule<KeepAwakeModule>('ExpoKeepAwake');
    } catch {
      mod = null;
    }
  }
  return mod;
}

const TAG = 'flyp-call';
let on = false;

export function keepAwake(next: boolean) {
  if (on === next) return;
  on = next;
  const m = native();
  try {
    const p = next ? m?.activate?.(TAG) : m?.deactivate?.(TAG);
    p?.catch(() => {});
  } catch {}
}
