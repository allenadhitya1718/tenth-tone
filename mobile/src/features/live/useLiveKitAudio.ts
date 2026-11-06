import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NativeModules } from 'react-native';

import { fetchLiveKitToken, type LiveKitRole } from '@/api/livekit';
import { claimAgora } from '@/api/walkie';
import type { ErrorMsg } from '@/components/ui';
import { startAudioForeground } from '@/lib/audioForeground';

import { agoraUidFor } from './config';
import { liveError } from './errors';
import type { SpeakingStore } from './speakingStore';
import type { AgoraStatus } from './useAgoraAudio';

// The audio of a live on FLYP's own LiveKit server (engine 'livekit', 0166).
// Same contract as useAgoraAudio, so the room screen does not care which one
// runs: { status, error, clearError, muted, setMuted }.
//
//   - the room is the live_streams id, the identity the account id;
//   - 'host' (the host, or a guest accepted on stage) publishes the
//     microphone, 'audience' only listens;
//   - a role change (a guest brought on or taken off stage) reconnects with a
//     token for the new role: a second's gap, and the server's permissions are
//     always the ones in the token. Taking a guest off the air is also
//     enforced by the server (live-token 'revoke', called by the host);
//   - the speaking rings use agoraUidFor(identity), the same numbers the
//     Agora rooms use, so the stage needs no change;
//   - LiveKit refreshes the token by itself while connected.
//
// Memory: one Room per screen, made on open and fully torn down on close
// (disconnect + audio session stop). Only audio is subscribed.
//
// The LiveKit library is loaded only when a LiveKit live opens. A build
// without it (an older binary) shows "update the app" instead of crashing.

type Options = {
  liveId: string | null;
  me: string | null;
  role: LiveKitRole;
  enabled: boolean;
  speaking: SpeakingStore;
  onLeave?: () => void;
};

type LK = typeof import('livekit-client');
type LKNative = typeof import('@livekit/react-native');

let lib: { lk: LK; native: LKNative } | null | undefined;
function loadLiveKit(): { lk: LK; native: LKNative } | null {
  if (lib !== undefined) return lib;
  // Check the native parts BEFORE loading: React Native's module loader
  // reports a module that throws while loading as a fatal error even when the
  // caller catches it (seen on the Redmi with an older build: the app
  // reloaded instead of saying "update the app").
  const mods = NativeModules as Record<string, unknown>;
  if (!mods.WebRTCModule || !mods.LivekitReactNativeModule) {
    lib = null;
    return lib;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const native = require('@livekit/react-native') as LKNative;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lk = require('livekit-client') as LK;
    native.registerGlobals();
    lib = { lk, native };
  } catch (e) {
    console.warn('livekit load:', (e as Error)?.message);
    lib = null;
  }
  return lib;
}

async function micAllowed(): Promise<boolean> {
  try {
    const now = await getRecordingPermissionsAsync();
    if (now.granted) return true;
    if (!now.canAskAgain) return false;
    return (await requestRecordingPermissionsAsync()).granted;
  } catch {
    return true;
  }
}

export function useLiveKitAudio({ liveId, me, role, enabled, speaking, onLeave }: Options) {
  const [status, setStatus] = useState<AgoraStatus>('idle');
  const [error, setError] = useState<ErrorMsg>(null);
  const [muted, setMutedState] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const roomRef = useRef<InstanceType<LK['Room']> | null>(null);

  useEffect(() => {
    if (!enabled || !liveId || !me) return;
    const loaded = loadLiveKit();
    if (!loaded) {
      void Promise.resolve().then(() => {
        setStatus('error');
        setError({ key: 'live.errors.update_app' });
      });
      return;
    }
    const { lk, native } = loaded;
    let cancelled = false;
    // Stops a running walkie-talkie first: one microphone at a time.
    const releaseClaim = claimAgora('live') ?? (() => {});
    const room = new lk.Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const syncSpeakers = (people: { identity: string }[]) => {
      speaking.set(people.map((p) => agoraUidFor(p.identity)));
    };
    room
      .on(lk.RoomEvent.ActiveSpeakersChanged, syncSpeakers)
      .on(lk.RoomEvent.ConnectionStateChanged, (s) => {
        if (cancelled) return;
        if (s === lk.ConnectionState.Connected) setStatus('connected');
        else if (s === lk.ConnectionState.Reconnecting || s === lk.ConnectionState.SignalReconnecting) setStatus('reconnecting');
        else if (s === lk.ConnectionState.Connecting) setStatus('connecting');
      })
      .on(lk.RoomEvent.Disconnected, (reason) => {
        if (cancelled) return;
        setPublishing(false);
        if (reason === lk.DisconnectReason.DUPLICATE_IDENTITY) {
          setStatus('error');
          setError({ key: 'live.errors.same_uid_login' });
        } else if (reason === lk.DisconnectReason.ROOM_DELETED) {
          setStatus('idle');
        } else if (reason !== lk.DisconnectReason.CLIENT_INITIATED) {
          setStatus('error');
          setError({ key: 'live.errors.agora_join_failed' });
        }
      })
      // The host took this guest off the air on the server: stop at once.
      .on(lk.RoomEvent.ParticipantPermissionsChanged, (_prev, participant) => {
        if (cancelled || participant !== room.localParticipant) return;
        if (!room.localParticipant.permissions?.canPublish) {
          void room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
          setPublishing(false);
        }
      });

    (async () => {
      setStatus('connecting');
      setError(null);
      let joinAs: LiveKitRole = role;
      if (joinAs === 'host' && !(await micAllowed())) {
        if (cancelled) return;
        setError({ key: 'live.errors.mic_denied' });
        joinAs = 'audience';
      }
      await native.AudioSession.startAudioSession();
      const tok = await fetchLiveKitToken(liveId, joinAs);
      if (cancelled) return;
      await room.connect(tok.url, tok.token, { autoSubscribe: true });
      if (cancelled) return;
      if (joinAs === 'host') {
        await room.localParticipant.setMicrophoneEnabled(true);
        if (!cancelled) {
          setPublishing(true);
          setMutedState(false);
        }
      }
    })().catch((e) => {
      if (cancelled) return;
      console.warn('livekit join:', (e as Error)?.message);
      setStatus('error');
      setError(liveError(e, 'live.errors.agora_join_failed'));
    });

    return () => {
      cancelled = true;
      room.removeAllListeners();
      void room.disconnect().catch(() => {});
      void native.AudioSession.stopAudioSession().catch(() => {});
      releaseClaim();
      roomRef.current = null;
      speaking.set([]);
      setPublishing(false);
      setMutedState(false);
      setStatus('idle');
    };
    // A role change reconnects with a token for the new role (see header).
  }, [liveId, me, enabled, role, speaking]);

  const setMuted = useCallback((next: boolean) => {
    const room = roomRef.current;
    if (!room?.localParticipant.permissions?.canPublish) return;
    void room.localParticipant
      .setMicrophoneEnabled(!next)
      .then(() => setMutedState(next))
      .catch((e) => console.warn('livekit mute:', (e as Error)?.message));
  }, []);

  const clearError = useCallback(() => setError(null), []);

  // While this phone publishes, the microphone must survive the app being
  // minimised: Android 14+ foreground service (as in useAgoraAudio).
  const onLeaveRef = useRef(onLeave);
  useEffect(() => {
    onLeaveRef.current = onLeave;
  }, [onLeave]);
  const hasLeave = !!onLeave;
  useEffect(() => {
    if (!enabled || !publishing) return;
    return startAudioForeground('live', hasLeave ? { onEnd: () => onLeaveRef.current?.() } : {});
  }, [enabled, publishing, hasLeave]);

  return { status, error, clearError, muted, setMuted, activeRole: publishing ? ('host' as const) : ('audience' as const) };
}
