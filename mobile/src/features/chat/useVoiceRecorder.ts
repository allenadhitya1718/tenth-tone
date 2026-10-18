import {
  getRecordingPermissionsAsync,
  type RecordingOptions,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { LocalMedia } from '@/api/upload';

// Same limits as the web app's voice notes.
const MAX_MS = 5 * 60 * 1000; // stops itself after five minutes
const MIN_MS = 700; // shorter than this is a mis-tap, not a note

// AAC in .m4a, mono, speech bitrate: a minute is about 0.5 MB.
const VOICE_PRESET: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 64000,
};

type Phase = 'idle' | 'starting' | 'recording' | 'stopping';

export type RecorderEvents = {
  onDone: (media: LocalMedia, durationMs: number) => void;
  onTooShort: () => void;
  onPermissionDenied: () => void;
  onPermissionAsked: () => void;
  onError: () => void;
};

// Hold-to-record. begin() on press, finish() on release, cancel() when the
// finger slides away. Every step is guarded: a release can arrive while the
// recorder is still preparing (or while the permission dialog is up), and a
// cancel and a release can both arrive for one press.
export function useVoiceRecorder(events: RecorderEvents) {
  const recorder = useAudioRecorder(VOICE_PRESET);
  const state = useAudioRecorderState(recorder, 250);
  const [recording, setRecording] = useState(false);
  const phase = useRef<Phase>('idle');
  const released = useRef(false);
  const cancelled = useRef(false);
  const startedAt = useRef(0);
  const ev = useRef(events);
  useEffect(() => {
    ev.current = events;
  }, [events]);

  const stop = useCallback(async () => {
    if (phase.current !== 'recording') return;
    phase.current = 'stopping';
    const elapsed = Date.now() - startedAt.current;
    try {
      await recorder.stop();
    } catch {}
    setRecording(false);
    // Hand the session back for playback through the speaker.
    void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    phase.current = 'idle';
    const uri = recorder.uri;
    if (cancelled.current) return;
    if (elapsed < MIN_MS || !uri) {
      ev.current.onTooShort();
      return;
    }
    ev.current.onDone({ uri, mimeType: 'audio/mp4', name: 'voice.m4a' }, elapsed);
  }, [recorder]);

  const begin = useCallback(async () => {
    if (phase.current !== 'idle') return;
    phase.current = 'starting';
    released.current = false;
    cancelled.current = false;
    try {
      let perm = await getRecordingPermissionsAsync();
      if (!perm.granted) {
        if (!perm.canAskAgain) {
          phase.current = 'idle';
          ev.current.onPermissionDenied();
          return;
        }
        // The system dialog takes over the screen, so the press that asked is
        // spent; the next hold records.
        perm = await requestRecordingPermissionsAsync();
        phase.current = 'idle';
        if (perm.granted) ev.current.onPermissionAsked();
        else ev.current.onPermissionDenied();
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      if (released.current || cancelled.current) {
        phase.current = 'idle';
        void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
        if (released.current && !cancelled.current) ev.current.onTooShort();
        return;
      }
      recorder.record();
      startedAt.current = Date.now();
      phase.current = 'recording';
      setRecording(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } catch {
      phase.current = 'idle';
      setRecording(false);
      ev.current.onError();
    }
  }, [recorder]);

  const finish = useCallback(() => {
    released.current = true;
    void stop();
  }, [stop]);

  const cancel = useCallback(() => {
    if (cancelled.current) return;
    cancelled.current = true;
    if (phase.current === 'recording') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      void stop();
    }
  }, [stop]);

  // The five-minute cap.
  useEffect(() => {
    if (recording && state.durationMillis >= MAX_MS) void stop();
  }, [recording, state.durationMillis, stop]);

  // Leaving the screen mid-recording hands the microphone back and drops it.
  useEffect(
    () => () => {
      if (phase.current === 'recording') {
        cancelled.current = true;
        try {
          void recorder.stop().catch(() => {});
        } catch {}
        void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      }
    },
    [recorder],
  );

  return { recording, durationMs: recording ? state.durationMillis : 0, begin, finish, cancel };
}
