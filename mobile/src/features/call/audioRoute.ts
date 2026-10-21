import { requireOptionalNativeModule } from 'expo';

// Call audio output (modules/flyp-audio-route): is a Bluetooth or wired
// headset connected, which output is the call on, and (iOS) switching it.
// Optional: a build made before the module existed has none, and the call
// falls back to Agora's own route events and speaker switch.
export type AudioOutput = 'speaker' | 'earpiece' | 'bluetooth' | 'headset' | 'other';

export type AudioRouteState = {
  bluetooth: boolean;
  bluetoothName: string | null;
  headset: boolean;
  output: AudioOutput;
};

type Sub = { remove: () => void };
type AudioRouteModule = {
  getState: () => AudioRouteState;
  setOutput: (output: AudioOutput) => boolean;
  addListener: (event: 'change', fn: (s: AudioRouteState) => void) => Sub;
};

let mod: AudioRouteModule | null | undefined;
function native(): AudioRouteModule | null {
  if (mod === undefined) {
    try {
      mod = requireOptionalNativeModule<AudioRouteModule>('FlypAudioRoute');
    } catch {
      mod = null;
    }
  }
  return mod;
}

export function hasAudioRouteModule() {
  return !!native();
}

export function readAudioRoute(): AudioRouteState | null {
  try {
    return native()?.getState() ?? null;
  } catch {
    return null;
  }
}

/** iOS only: switches the output on the shared audio session. */
export function setNativeAudioOutput(output: AudioOutput): boolean {
  try {
    return native()?.setOutput(output) ?? false;
  } catch {
    return false;
  }
}

export function watchAudioRoute(fn: (s: AudioRouteState) => void): () => void {
  const m = native();
  if (!m) return () => {};
  try {
    const sub = m.addListener('change', fn);
    return () => sub.remove();
  } catch {
    return () => {};
  }
}
