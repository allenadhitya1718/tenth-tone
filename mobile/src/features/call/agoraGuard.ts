import { ConnectionStateType, createAgoraRtcEngine } from 'react-native-agora';

import { agoraBusy } from '@/api/walkie';

// createAgoraRtcEngine() returns ONE native engine for the whole app, shared
// by live rooms (features/live/useAgoraAudio.ts), walkie-talkie and calls.
// Two of them initializing it at once would tear each other down, so a call
// is refused while anything else holds it.
//
// Two checks, because not every user of the engine registers yet:
//   - claimAgora()/agoraBusy() in api/walkie.ts, the shared guard (a live
//     room or another call that claimed it);
//   - the engine's own connection state: a walkie channel, or a live room
//     that does not claim the guard, still shows up as connecting /
//     connected / reconnecting on the singleton.
// Only meaningful while THIS app has no call of its own on the engine.
export function otherAgoraSessionActive(): boolean {
  if (agoraBusy()) return true;
  try {
    const s = createAgoraRtcEngine().getConnectionState();
    return (
      s === ConnectionStateType.ConnectionStateConnecting ||
      s === ConnectionStateType.ConnectionStateConnected ||
      s === ConnectionStateType.ConnectionStateReconnecting
    );
  } catch {
    // Not initialized, or no native module: nothing is using it.
    return false;
  }
}
