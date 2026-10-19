import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
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

import { ApiError } from '@/api/client';
import type { UserSummary, Uuid } from '@/api/types';
import {
  claimAgora,
  fetchWalkieToken,
  openWalkieSignal,
  type WalkiePresence,
  type WalkieSignal,
  walkieChannelName,
} from '@/api/walkie';
import { agoraUidFor, AGORA_APP_ID } from '@/features/live/config';
import { startAudioForeground } from '@/lib/audioForeground';

// Live push-to-talk in a chat thread (client note 26). See src/api/walkie.ts
// for the channel and the shared-engine guard.
//
// Three layers, each narrower than the last:
//   signal : realtime presence + 'talking' events, open whenever the thread
//            is on screen (so the other side can see "X is talking" and
//            offer to listen even with walkie off);
//   audio  : the Agora channel, joined as audience only while walkie is on,
//            the thread is focused and the app is in the foreground;
//   talk   : broadcaster only while the button is held (or latched).
// Leaving the screen, backgrounding the app, or a live room / call claiming
// the engine tears the audio down at once.

export type WalkieStatus = 'off' | 'connecting' | 'connected' | 'reconnecting' | 'error';
export type WalkieError = 'busy' | 'forbidden' | 'unavailable' | 'not_installed' | 'join_failed' | 'same_uid' | 'mic_denied';

export type WalkieSpeaker = { id: Uuid; name: string | null };

export type WalkieControls = {
  on: boolean;
  setOn: (on: boolean) => void;
  status: WalkieStatus;
  error: WalkieError | null;
  retry: () => void;
  /** This device is publishing its microphone. */
  talking: boolean;
  startTalking: () => void;
  stopTalking: () => void;
  /** Other members talking now. */
  speakers: WalkieSpeaker[];
  /** Other members with walkie on. */
  listeners: number;
};

type Options = {
  chatId: Uuid;
  me: Uuid | undefined;
  myName: string | null;
  others: UserSummary[] | undefined;
  /** False for an unaccepted request or while the chat is loading. */
  allowed: boolean;
};

// Volume is 0-255. Below this is breathing and room noise.
const SPEAKING_VOLUME = 18;
// A held (or latched) button stops itself after a minute.
const MAX_TALK_MS = 60_000;
// A 'talking' event from a client that vanished without saying "stopped".
const TALKING_STALE_MS = MAX_TALK_MS + 5_000;

function without(m: Record<string, number>, id: string) {
  if (!(id in m)) return m;
  const next = { ...m };
  delete next[id];
  return next;
}

function errorOf(e: unknown): WalkieError {
  const code = e instanceof ApiError ? e.code : '';
  if (code === 'agora_forbidden' || code === 'not_signed_in') return 'forbidden';
  if (code === 'agora_not_installed') return 'not_installed';
  if (code === 'agora_join_failed') return 'join_failed';
  return 'unavailable';
}

function engineInUse(engine: IRtcEngine) {
  try {
    const s = engine.getConnectionState();
    return (
      s === ConnectionStateType.ConnectionStateConnecting ||
      s === ConnectionStateType.ConnectionStateConnected ||
      s === ConnectionStateType.ConnectionStateReconnecting
    );
  } catch {
    return false;
  }
}

function toBroadcaster(engine: IRtcEngine) {
  engine.setClientRole(ClientRoleType.ClientRoleBroadcaster);
  engine.updateChannelMediaOptions({
    clientRoleType: ClientRoleType.ClientRoleBroadcaster,
    publishMicrophoneTrack: true,
  });
  engine.muteLocalAudioStream(false);
}

function toAudience(engine: IRtcEngine) {
  engine.updateChannelMediaOptions({
    publishMicrophoneTrack: false,
    clientRoleType: ClientRoleType.ClientRoleAudience,
  });
  engine.setClientRole(ClientRoleType.ClientRoleAudience, {
    audienceLatencyLevel: AudienceLatencyLevelType.AudienceLatencyLevelLowLatency,
  });
}

export function useWalkie({ chatId, me, myName, others, allowed }: Options): WalkieControls {
  const [focused, setFocused] = useState(true);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [on, setOnState] = useState(false);
  const [status, setStatus] = useState<WalkieStatus>('off');
  const [error, setError] = useState<WalkieError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [talking, setTalking] = useState(false);
  const [presence, setPresence] = useState<WalkiePresence[]>([]);
  const [eventTalkers, setEventTalkers] = useState<Record<string, number>>({});
  const [audioTalkers, setAudioTalkers] = useState<number[]>([]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  const visible = allowed && focused && appActive && !!me;
  // On Android a walkie that is on keeps going when the app is minimised: a
  // foreground service (lib/audioForeground) keeps the audio and the mic,
  // and the signal stays open with it. Elsewhere backgrounding tears it down.
  const audioOn = (Platform.OS === 'android' ? allowed && focused && !!me : visible) && on;
  const signalOn = visible || audioOn;
  const agoraUid = useMemo(() => (me ? agoraUidFor(me) : 0), [me]);

  const engineRef = useRef<IRtcEngine | null>(null);
  const joined = useRef(false);
  const wantTalk = useRef(false);
  const talkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signalRef = useRef<WalkieSignal | null>(null);
  const shared = useRef({ on: false, talking: false });

  const pushSignal = useCallback((next: { on: boolean; talking: boolean }) => {
    shared.current = next;
    signalRef.current?.update(next);
  }, []);

  // ---------- signal ----------
  useEffect(() => {
    if (!signalOn || !me) return;
    const staleTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const signal = openWalkieSignal(chatId, me, myName, {
      onPresence: setPresence,
      onTalking: (p) => {
        const id = p.from;
        if (!id) return;
        const prev = staleTimers.get(id);
        if (prev) clearTimeout(prev);
        if (p.isTalking) {
          setEventTalkers((m) => ({ ...m, [id]: Date.now() }));
          staleTimers.set(
            id,
            setTimeout(() => {
              staleTimers.delete(id);
              setEventTalkers((m) => without(m, id));
            }, TALKING_STALE_MS),
          );
        } else {
          staleTimers.delete(id);
          setEventTalkers((m) => without(m, id));
        }
      },
    });
    signalRef.current = signal;
    signal.update(shared.current);
    return () => {
      for (const tm of staleTimers.values()) clearTimeout(tm);
      signal.close();
      if (signalRef.current === signal) signalRef.current = null;
      setPresence([]);
      setEventTalkers({});
    };
  }, [signalOn, chatId, me, myName]);

  // ---------- talk ----------
  const stopTalking = useCallback(() => {
    wantTalk.current = false;
    if (talkTimer.current) {
      clearTimeout(talkTimer.current);
      talkTimer.current = null;
    }
    const engine = engineRef.current;
    if (engine && joined.current) {
      try {
        toAudience(engine);
      } catch {}
    }
    setTalking((was) => {
      if (was) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      return false;
    });
    pushSignal({ on: shared.current.on, talking: false });
  }, [pushSignal]);

  const startTalking = useCallback(() => {
    if (wantTalk.current) return;
    wantTalk.current = true;
    void (async () => {
      const engine = engineRef.current;
      if (!engine || !joined.current) {
        wantTalk.current = false;
        return;
      }
      let granted = false;
      try {
        const now = await getRecordingPermissionsAsync();
        granted = now.granted;
        if (!granted && now.canAskAgain) granted = (await requestRecordingPermissionsAsync()).granted;
      } catch {
        granted = true; // no permission module: let Agora ask
      }
      if (!granted) {
        wantTalk.current = false;
        setError('mic_denied');
        return;
      }
      // Released while the permission check (or its dialog) was up.
      if (!wantTalk.current || engineRef.current !== engine || !joined.current) return;
      try {
        toBroadcaster(engine);
      } catch {
        wantTalk.current = false;
        return;
      }
      setError((e) => (e === 'mic_denied' ? null : e));
      setTalking(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      pushSignal({ on: true, talking: true });
      if (talkTimer.current) clearTimeout(talkTimer.current);
      talkTimer.current = setTimeout(stopTalking, MAX_TALK_MS);
    })();
  }, [pushSignal, stopTalking]);

  // ---------- audio ----------
  useEffect(() => {
    if (!audioOn || !agoraUid) return;
    let cancelled = false;
    let engine: IRtcEngine | null = null;
    let handler: IRtcEngineEventHandler | null = null;
    // State updates are deferred out of the effect body.
    const later = (fn: () => void) =>
      void Promise.resolve().then(() => {
        if (!cancelled) fn();
      });

    const teardown = () => {
      if (cancelled) return;
      cancelled = true;
      wantTalk.current = false;
      if (talkTimer.current) {
        clearTimeout(talkTimer.current);
        talkTimer.current = null;
      }
      const e = engine;
      engine = null;
      if (e) {
        if (handler) {
          try {
            e.unregisterEventHandler(handler);
          } catch {}
        }
        if (joined.current) {
          try {
            e.leaveChannel();
          } catch {}
        }
        try {
          e.release();
        } catch {}
      }
      if (engineRef.current === e) engineRef.current = null;
      joined.current = false;
    };

    const release = claimAgora('walkie', () => {
      // A live room or call is taking the engine: get out of its way now,
      // synchronously, then switch walkie off.
      teardown();
      void Promise.resolve().then(() => {
        setOnState(false);
        setTalking(false);
        setAudioTalkers([]);
        setStatus('off');
        pushSignal({ on: false, talking: false });
      });
    });
    if (!release) {
      later(() => {
        setStatus('error');
        setError('busy');
      });
      return () => {
        cancelled = true;
      };
    }

    let eng: IRtcEngine;
    try {
      eng = createAgoraRtcEngine();
      // Something that does not use claimAgora() is in a channel: leave it be.
      if (engineInUse(eng)) {
        release();
        later(() => {
          setStatus('error');
          setError('busy');
        });
        return () => {
          cancelled = true;
        };
      }
      const rc = eng.initialize({
        appId: AGORA_APP_ID,
        channelProfile: ChannelProfileType.ChannelProfileLiveBroadcasting,
        audioScenario: AudioScenarioType.AudioScenarioChatroom,
      });
      if (rc < 0) throw new ApiError('agora_not_installed', `initialize ${rc}`);
    } catch (e) {
      console.warn('walkie init:', (e as Error)?.message);
      release();
      later(() => {
        setStatus('error');
        setError('not_installed');
      });
      return () => {
        cancelled = true;
      };
    }
    engine = eng;
    engineRef.current = eng;
    const channel = walkieChannelName(chatId);

    const renew = () => {
      fetchWalkieToken(chatId, agoraUid)
        .then((t) => {
          if (!cancelled && engineRef.current === eng) eng.renewToken(t.token);
        })
        .catch((e) => console.warn('walkie renew:', (e as Error)?.message));
    };

    let kicked = false;
    handler = {
      onJoinChannelSuccess: () => later(() => setStatus('connected')),
      onConnectionStateChanged: (_c, state, reason) => {
        if (cancelled || kicked) return;
        if (reason === ConnectionChangedReasonType.ConnectionChangedSameUidLogin) {
          kicked = true;
          later(() => {
            setStatus('error');
            setError('same_uid');
          });
          return;
        }
        if (state === ConnectionStateType.ConnectionStateReconnecting) later(() => setStatus('reconnecting'));
        else if (state === ConnectionStateType.ConnectionStateConnected) later(() => setStatus('connected'));
        else if (state === ConnectionStateType.ConnectionStateFailed)
          later(() => {
            setStatus('error');
            setError('join_failed');
          });
      },
      onUserOffline: (_c, remoteUid) => later(() => setAudioTalkers((l) => l.filter((u) => u !== remoteUid))),
      onAudioVolumeIndication: (_c, speakers) => {
        if (cancelled) return;
        // The local report (uid 0) comes on its own; only remote ones matter.
        if (speakers.length === 1 && (speakers[0]?.uid ?? -1) === 0) return;
        const next = speakers.filter((s) => s.uid && (s.volume ?? 0) > SPEAKING_VOLUME).map((s) => s.uid as number);
        setAudioTalkers((prev) => (prev.length === next.length && prev.every((u, i) => u === next[i]) ? prev : next));
      },
      onTokenPrivilegeWillExpire: renew,
      onRequestToken: renew,
      onError: (err) => {
        if (err === ErrorCodeType.ErrTokenExpired || err === ErrorCodeType.ErrInvalidToken) renew();
      },
    };
    eng.registerEventHandler(handler);
    eng.enableAudio();
    eng.disableVideo();
    eng.setAudioProfile(AudioProfileType.AudioProfileSpeechStandard, AudioScenarioType.AudioScenarioChatroom);
    eng.setDefaultAudioRouteToSpeakerphone(true);
    eng.enableAudioVolumeIndication(300, 3, false);

    later(() => {
      setStatus('connecting');
      setError(null);
    });
    fetchWalkieToken(chatId, agoraUid)
      .then((tok) => {
        if (cancelled) return;
        // A publisher token, joined as audience: the microphone stays closed
        // until the button is held, and holding needs no second request.
        const rc = eng.joinChannel(tok.token, channel, tok.uid || agoraUid, {
          channelProfile: ChannelProfileType.ChannelProfileLiveBroadcasting,
          clientRoleType: ClientRoleType.ClientRoleAudience,
          audienceLatencyLevel: AudienceLatencyLevelType.AudienceLatencyLevelLowLatency,
          publishMicrophoneTrack: false,
          publishCameraTrack: false,
          autoSubscribeAudio: true,
          autoSubscribeVideo: false,
        });
        if (rc < 0) throw new ApiError('agora_join_failed', `joinChannel ${rc}`);
        joined.current = true;
        pushSignal({ on: true, talking: false });
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn('walkie join:', (e as Error)?.message);
        setStatus('error');
        setError(errorOf(e));
      });

    return () => {
      teardown();
      release();
      setTalking(false);
      setAudioTalkers([]);
      setStatus('off');
      pushSignal({ on: false, talking: false });
    };
  }, [audioOn, agoraUid, chatId, attempt, pushSignal]);

  // The ongoing "Walkie-talkie on" notification (Android foreground
  // service), started when walkie comes on with the app in front.
  const setOnRef = useRef<(on: boolean) => void>(() => {});
  useEffect(() => {
    if (!audioOn) return;
    return startAudioForeground('walkie', { onEnd: () => setOnRef.current(false) });
  }, [audioOn]);

  // ---------- controls ----------
  const setOn = useCallback(
    (next: boolean) => {
      if (!next) stopTalking();
      setError(null);
      setOnState(next);
    },
    [stopTalking],
  );
  useEffect(() => {
    setOnRef.current = setOn;
  }, [setOn]);

  const retry = useCallback(() => {
    setError(null);
    setOnState(true);
    setAttempt((n) => n + 1);
  }, []);

  // Others talking: the Agora level meter (only while listening), presence,
  // and the 'talking' events the web app also sends.
  const speakers = useMemo<WalkieSpeaker[]>(() => {
    const byId = new Map((others ?? []).map((o) => [o.id, o]));
    const byUid = new Map((others ?? []).map((o) => [agoraUidFor(o.id), o.id]));
    const ids = new Set<string>();
    for (const u of audioTalkers) {
      const id = byUid.get(u);
      if (id) ids.add(id);
    }
    for (const p of presence) if (p.talking) ids.add(p.user_id);
    for (const id of Object.keys(eventTalkers)) ids.add(id);
    if (me) ids.delete(me);
    return [...ids].map((id) => {
      const o = byId.get(id);
      return { id, name: o?.name || o?.handle || null };
    });
  }, [others, audioTalkers, presence, eventTalkers, me]);

  const listeners = useMemo(() => presence.filter((p) => p.on).length, [presence]);

  return useMemo(
    () => ({
      on: on && allowed,
      setOn,
      status: audioOn ? status : 'off',
      error,
      retry,
      talking,
      startTalking,
      stopTalking,
      speakers,
      listeners,
    }),
    [on, allowed, setOn, audioOn, status, error, retry, talking, startTalking, stopTalking, speakers, listeners],
  );
}
