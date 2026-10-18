import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudienceLatencyLevelType,
  AudioProfileType,
  AudioScenarioType,
  ChannelProfileType,
  ClientRoleType,
  ConnectionChangedReasonType,
  ConnectionStateType,
  createAgoraRtcEngine,
  ErrorCodeType,
  type IRtcEngine,
  type IRtcEngineEventHandler,
} from 'react-native-agora';

import { fetchAgoraToken, type AgoraRole } from '@/api/agora';
import { ApiError } from '@/api/client';
import type { ErrorMsg } from '@/components/ui';
import { claimAgora } from '@/api/walkie';

import { AGORA_APP_ID } from './config';
import { liveError } from './errors';
import type { SpeakingStore } from './speakingStore';

// One audio-only Agora session for a live room (client note 4: no camera).
// Port of the session half of web/js/agora.js (startHost / startViewer) for
// react-native-agora:
//   - channel = the live_streams id, profile LiveBroadcasting;
//   - the uid is fixed BEFORE the token is asked for (a token is bound to one
//     uid) and joined with that same uid;
//   - 'host' publishes the microphone, 'audience' only listens;
//   - video is disabled outright.
//
// The role can change while joined (a viewer brought on stage, client note 6):
// the hook asks for a token of the new role, renews it and switches with
// setClientRole. Dropping to audience happens at once, before the new token
// arrives, because the publisher token still in hand stays valid until it
// expires.
//
// The engine is created on mount and ALWAYS left and released on unmount or
// when channel / uid / enabled change. Event handlers are unregistered first,
// so nothing calls into an unmounted screen.

export type AgoraStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

type Options = {
  channel: string | null;
  uid: number | null;
  role: AgoraRole;
  enabled: boolean;
  speaking: SpeakingStore;
};

// Volume is 0-255. Below this is breathing and room noise.
const SPEAKING_VOLUME = 18;

async function micAllowed(): Promise<boolean> {
  try {
    const now = await getRecordingPermissionsAsync();
    if (now.granted) return true;
    if (!now.canAskAgain) return false;
    return (await requestRecordingPermissionsAsync()).granted;
  } catch {
    // No permission module (should not happen in a dev build): let Agora ask.
    return true;
  }
}

export function useAgoraAudio({ channel, uid, role, enabled, speaking }: Options) {
  const [status, setStatus] = useState<AgoraStatus>('idle');
  const [error, setError] = useState<ErrorMsg>(null);
  const [muted, setMutedState] = useState(false);
  const [activeRole, setActiveRole] = useState<AgoraRole | null>(null);
  const [remoteCount, setRemoteCount] = useState(0);

  const engineRef = useRef<IRtcEngine | null>(null);
  const joinedRole = useRef<AgoraRole | null>(null);
  const wantedRole = useRef<AgoraRole>(role);
  const switchSeq = useRef(0);
  // Declared before the lifecycle effect, so a join reads the current role.
  useEffect(() => {
    wantedRole.current = role;
  }, [role]);

  // ---------- lifecycle ----------
  useEffect(() => {
    if (!enabled || !channel || !uid) return;
    let cancelled = false;
    const seqRef = switchSeq;
    let engine: IRtcEngine;
    // Stops a running walkie-talkie first: the engine is one shared object.
    const releaseClaim = claimAgora('live') ?? (() => {});
    try {
      engine = createAgoraRtcEngine();
      const rc = engine.initialize({
        appId: AGORA_APP_ID,
        channelProfile: ChannelProfileType.ChannelProfileLiveBroadcasting,
        audioScenario: AudioScenarioType.AudioScenarioChatroom,
      });
      if (rc < 0) throw new ApiError('agora_not_installed', `initialize ${rc}`);
    } catch (e) {
      // No native module (Expo Go, or a build without react-native-agora).
      console.warn('agora init:', (e as Error)?.message);
      void Promise.resolve().then(() => {
        if (cancelled) return;
        setStatus('error');
        setError({ key: 'live.errors.agora_not_installed' });
      });
      return () => {
        cancelled = true;
        releaseClaim();
      };
    }
    engineRef.current = engine;

    // The SDK reports the local speaker (uid 0) and remote speakers in two
    // separate callbacks, so the two halves are kept apart and merged.
    let localSpeaking = false;
    let remoteSpeaking: number[] = [];
    const remotes = new Set<number>();
    const publishSpeaking = () => speaking.set(localSpeaking ? [...remoteSpeaking, uid] : remoteSpeaking);

    const renew = (forRole: AgoraRole) => {
      fetchAgoraToken(channel, uid, forRole)
        .then((t) => {
          if (!cancelled && engineRef.current === engine) engine.renewToken(t.token);
        })
        .catch((e) => console.warn('agora renew:', (e as Error)?.message));
    };

    // Ejected because the same account joined elsewhere: the Failed state
    // that follows must not overwrite that explanation.
    let kicked = false;
    const handler: IRtcEngineEventHandler = {
      onJoinChannelSuccess: () => {
        if (!cancelled) setStatus('connected');
      },
      onConnectionStateChanged: (_c, state, reason) => {
        if (cancelled || kicked) return;
        if (reason === ConnectionChangedReasonType.ConnectionChangedSameUidLogin) {
          kicked = true;
          setStatus('error');
          setError({ key: 'live.errors.same_uid_login' });
          return;
        }
        if (state === ConnectionStateType.ConnectionStateReconnecting) setStatus('reconnecting');
        else if (state === ConnectionStateType.ConnectionStateConnected) setStatus('connected');
        else if (state === ConnectionStateType.ConnectionStateFailed) {
          setStatus('error');
          setError({ key: 'live.errors.agora_join_failed' });
        }
      },
      onUserJoined: (_c, remoteUid) => {
        remotes.add(remoteUid);
        if (!cancelled) setRemoteCount(remotes.size);
      },
      onUserOffline: (_c, remoteUid) => {
        remotes.delete(remoteUid);
        remoteSpeaking = remoteSpeaking.filter((u) => u !== remoteUid);
        publishSpeaking();
        if (!cancelled) setRemoteCount(remotes.size);
      },
      onAudioVolumeIndication: (_c, speakers) => {
        if (cancelled) return;
        const isLocalReport = speakers.length === 1 && (speakers[0]?.uid ?? -1) === 0;
        if (isLocalReport) {
          const s = speakers[0]!;
          localSpeaking = joinedRole.current === 'host' && ((s.vad ?? 0) === 1 || (s.volume ?? 0) > SPEAKING_VOLUME);
        } else {
          remoteSpeaking = speakers
            .filter((s) => s.uid && (s.volume ?? 0) > SPEAKING_VOLUME)
            .map((s) => s.uid as number);
        }
        publishSpeaking();
      },
      onTokenPrivilegeWillExpire: () => {
        if (joinedRole.current) renew(joinedRole.current);
      },
      onRequestToken: () => {
        if (joinedRole.current) renew(joinedRole.current);
      },
      onError: (err) => {
        if (err === ErrorCodeType.ErrTokenExpired || err === ErrorCodeType.ErrInvalidToken) {
          if (joinedRole.current) renew(joinedRole.current);
        }
      },
    };
    engine.registerEventHandler(handler);
    engine.enableAudio();
    engine.disableVideo();
    engine.setAudioProfile(AudioProfileType.AudioProfileDefault, AudioScenarioType.AudioScenarioChatroom);
    engine.setDefaultAudioRouteToSpeakerphone(true);
    engine.enableAudioVolumeIndication(350, 3, true);

    (async () => {
      setStatus('connecting');
      setError(null);
      let joinAs = wantedRole.current;
      if (joinAs === 'host' && !(await micAllowed())) {
        if (cancelled) return;
        setError({ key: 'live.errors.mic_denied' });
        joinAs = 'audience';
      }
      const tok = await fetchAgoraToken(channel, uid, joinAs);
      if (cancelled) return;
      const rc = engine.joinChannel(tok.token, channel, uid, {
        channelProfile: ChannelProfileType.ChannelProfileLiveBroadcasting,
        clientRoleType: joinAs === 'host' ? ClientRoleType.ClientRoleBroadcaster : ClientRoleType.ClientRoleAudience,
        audienceLatencyLevel: AudienceLatencyLevelType.AudienceLatencyLevelLowLatency,
        publishMicrophoneTrack: joinAs === 'host',
        publishCameraTrack: false,
        autoSubscribeAudio: true,
        autoSubscribeVideo: false,
      });
      if (rc < 0) throw new ApiError('agora_join_failed', `joinChannel ${rc}`);
      joinedRole.current = joinAs;
      setActiveRole(joinAs);
    })().catch((e) => {
      if (cancelled) return;
      console.warn('agora join:', (e as Error)?.message);
      setStatus('error');
      setError(liveError(e, 'live.errors.agora_join_failed'));
    });

    return () => {
      cancelled = true;
      seqRef.current++;
      try {
        engine.unregisterEventHandler(handler);
      } catch {}
      try {
        engine.leaveChannel();
      } catch {}
      try {
        engine.release();
      } catch {}
      releaseClaim();
      engineRef.current = null;
      joinedRole.current = null;
      speaking.set([]);
      setActiveRole(null);
      setRemoteCount(0);
      setMutedState(false);
      setStatus('idle');
    };
  }, [channel, uid, enabled, speaking]);

  // ---------- role switching (guests, client note 6) ----------
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !channel || !uid) return;
    if (status !== 'connected' && status !== 'reconnecting') return;
    if (joinedRole.current === null || joinedRole.current === role) return;
    const seq = ++switchSeq.current;

    if (role === 'audience') {
      // At once: stop publishing before anything else. The publisher token
      // still in hand stays valid until it expires.
      try {
        engine.updateChannelMediaOptions({
          publishMicrophoneTrack: false,
          clientRoleType: ClientRoleType.ClientRoleAudience,
        });
        engine.setClientRole(ClientRoleType.ClientRoleAudience, {
          audienceLatencyLevel: AudienceLatencyLevelType.AudienceLatencyLevelLowLatency,
        });
      } catch {}
      joinedRole.current = 'audience';
      void (async () => {
        setActiveRole('audience');
        setMutedState(false);
        try {
          const t = await fetchAgoraToken(channel, uid, 'audience');
          if (seq === switchSeq.current && engineRef.current === engine) engine.renewToken(t.token);
        } catch {}
      })();
      return;
    }

    void (async () => {
      if (!(await micAllowed())) throw new ApiError('mic_denied');
      const tok = await fetchAgoraToken(channel, uid, 'host');
      if (seq !== switchSeq.current || engineRef.current !== engine) return;
      engine.renewToken(tok.token);
      engine.setClientRole(ClientRoleType.ClientRoleBroadcaster);
      engine.updateChannelMediaOptions({
        token: tok.token,
        clientRoleType: ClientRoleType.ClientRoleBroadcaster,
        publishMicrophoneTrack: true,
      });
      engine.muteLocalAudioStream(false);
      joinedRole.current = 'host';
      setActiveRole('host');
      setMutedState(false);
    })().catch((e) => {
      if (seq !== switchSeq.current) return;
      console.warn('agora role switch:', (e as Error)?.message);
      setError(liveError(e, 'live.errors.agora_join_failed'));
    });
  }, [role, status, channel, uid]);

  const setMuted = useCallback((next: boolean) => {
    const engine = engineRef.current;
    if (!engine || joinedRole.current !== 'host') return;
    engine.muteLocalAudioStream(next);
    setMutedState(next);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { status, error, clearError, muted, setMuted, activeRole, remoteCount };
}
