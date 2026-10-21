// Keeps a call, a live stage or a walkie-talkie heard (and the microphone
// open) when the app is minimised, by running an Android foreground service
// with an ongoing notification: "FLYP call in progress" / "You're live" /
// "Walkie-talkie on", a button that hangs up / leaves / turns off, and a tap
// that brings the app back.
//
// Why: on Android 14+ (targetSdk 34+) an app in the background loses the
// microphone (and is soon frozen) unless a foreground service of type
// `microphone` is running. The service is react-native-notify-kit's
// (app.notifee.core.ForegroundService), declared in the manifest by its
// config plugin in app.json as `microphone|mediaPlayback`:
//   microphone     the open mic of a call / stage / walkie talk button;
//   mediaPlayback  the other people's audio played back.
// `phoneCall` is deliberately NOT used: it needs the app to be a default
// dialer / self-managed ConnectionService (Telecom) and a Play Console "phone
// call" declaration that a VoIP feature without Telecom would not pass.
//
// Android only allows a `microphone` foreground service to START while the
// app is visible, so each session is started when it begins (call media
// joining, going on stage, walkie on), never on minimise. A request made
// while the app is not in front waits until it is. A `microphone` service
// also needs RECORD_AUDIO already granted; without it (a walkie listener who
// has never talked) the service runs as `mediaPlayback` only and is upgraded
// the next time the app comes to the front with the permission.
//
// One service for the whole app: when several sessions overlap (rare: the
// shared Agora engine allows one at a time) the notification shows the most
// important one, and the service stops when the last one ends.
//
// Safe for the app entry and the headless runtime: no React, router or Agora
// here. iOS needs none of this (UIBackgroundModes audio + voip); every export
// is a no-op there.
import i18n from 'i18next';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import notifee, {
  AndroidCategory,
  AndroidForegroundServiceType,
  AndroidImportance,
  AndroidVisibility,
  EventType,
  type Event,
} from 'react-native-notify-kit';

import { handleNotificationEvent } from '@/features/call/background';

export type AudioSessionKind = 'call' | 'live' | 'walkie';

export type AudioSessionOptions = {
  /** The notification's button: hang up / leave / turn off. No button without it. */
  onEnd?: () => void;
  /** Tapping the notification (after the app is back in front). */
  onOpen?: () => void;
  /** Replaces the default "Tap to return..." line (the other person's name...). */
  body?: string | null;
  /** Calls, Instagram-style: the other person as the title, their photo, and
   * "Ongoing voice/video call" under it. */
  title?: string | null;
  avatar?: string | null;
  video?: boolean;
};

const ANDROID = Platform.OS === 'android';
const CHANNEL = 'ongoing_audio';
// Calls get their own channel and group: in the shared low-priority channel
// the ongoing call sat among (and was bundled with) every other FLYP
// notification. Its own group keeps Android from bundling it.
const CALL_CHANNEL = 'ongoing_call';
const CALL_GROUP = 'flyp_ongoing_call';
const CALL_COLOR = '#1E56D6';
const NOTIFICATION_ID = 'flyp_audio_fgs';
const KIND = 'audio_fgs';
const ACTION_END = 'audio_fgs_end';
const ACTION_OPEN = 'audio_fgs_open';
// Most important first: the one the notification shows.
const ORDER: AudioSessionKind[] = ['call', 'live', 'walkie'];

type Session = AudioSessionOptions & { token: object; since: number };
const sessions = new Map<AudioSessionKind, Session>();

let running = false;
// The types the running service was promoted with ('' = not running).
let shownKey = '';
let releaseRunner: (() => void) | null = null;

// ---------- The service ----------

if (ANDROID) {
  // The service lives as long as this promise is pending. Registered at
  // module scope (this file is loaded by the app entry, index.js): Android
  // may also restart the service after the process died, with nothing left
  // to keep alive; that one is stopped straight away.
  notifee.registerForegroundService(
    () =>
      new Promise<void>((resolve) => {
        releaseRunner?.();
        releaseRunner = resolve;
        if (sessions.size === 0) void stopService();
      }),
  );
}

async function micGranted(): Promise<boolean> {
  try {
    return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  } catch {
    return false;
  }
}

async function ensureChannel(kind: AudioSessionKind) {
  if (kind === 'call') {
    if (await notifee.isChannelCreated(CALL_CHANNEL)) return;
    await notifee.createChannel({
      id: CALL_CHANNEL,
      name: i18n.t('notify.fgs.callChannel', { defaultValue: 'Ongoing calls' }),
      // Shown, never sounding: the call is already in your ear.
      importance: AndroidImportance.DEFAULT,
      visibility: AndroidVisibility.PUBLIC,
      vibration: false,
      badge: false,
    });
    return;
  }
  if (await notifee.isChannelCreated(CHANNEL)) return;
  await notifee.createChannel({
    id: CHANNEL,
    name: i18n.t('notify.fgs.channel', { defaultValue: 'Ongoing calls and live audio' }),
    // Silent and out of the way: it is a status, not an alert.
    importance: AndroidImportance.LOW,
    visibility: AndroidVisibility.PUBLIC,
    vibration: false,
  });
}

function top(): [AudioSessionKind, Session] | null {
  for (const k of ORDER) {
    const s = sessions.get(k);
    if (s) return [k, s];
  }
  return null;
}

async function stopService() {
  const wasRunning = running;
  running = false;
  shownKey = '';
  releaseRunner?.();
  releaseRunner = null;
  try {
    await notifee.stopForegroundService();
  } catch {}
  if (wasRunning) {
    try {
      await notifee.cancelNotification(NOTIFICATION_ID);
    } catch {}
  }
}

async function show(kind: AudioSessionKind, s: Session) {
  const mic = await micGranted();
  const types = mic
    ? [AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MICROPHONE, AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK]
    : [AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK];
  const key = `${kind}|${mic ? 'mic' : 'play'}|${s.body ?? ''}|${s.title ?? ''}|${s.avatar ?? ''}|${s.video ? 1 : 0}|${s.onEnd ? 1 : 0}`;
  // Starting (or adding the microphone type) needs the app in front; a
  // same-type update of the running notification does not.
  const needsFront = !running || (mic && !shownKey.includes('|mic|'));
  if (needsFront && AppState.currentState !== 'active') return;
  if (running && key === shownKey) return;
  await ensureChannel(kind);
  const call = kind === 'call';
  await notifee.displayNotification({
    id: NOTIFICATION_ID,
    title: call && s.title ? s.title : i18n.t(`notify.fgs.${kind}.title`),
    body:
      call && s.title
        ? i18n.t(s.video ? 'notify.fgs.call.ongoingVideo' : 'notify.fgs.call.ongoingVoice')
        : s.body || i18n.t(`notify.fgs.${kind}.body`),
    data: { kind: KIND, session: kind },
    android: {
      channelId: call ? CALL_CHANNEL : CHANNEL,
      ...(call
        ? {
            groupId: CALL_GROUP,
            color: CALL_COLOR,
            colorized: true,
            ...(s.avatar ? { largeIcon: s.avatar, circularLargeIcon: true } : {}),
          }
        : {}),
      asForegroundService: true,
      foregroundServiceTypes: types,
      category: kind === 'call' ? AndroidCategory.CALL : AndroidCategory.SERVICE,
      ongoing: true,
      autoCancel: false,
      onlyAlertOnce: true,
      visibility: AndroidVisibility.PUBLIC,
      ...(kind === 'call' ? { showChronometer: true, showTimestamp: true, timestamp: s.since } : {}),
      // Opens the app; onOpen then takes the person to the screen.
      pressAction: { id: ACTION_OPEN, launchActivity: 'default' },
      // No launchActivity: hanging up does not open the app.
      actions: s.onEnd ? [{ title: i18n.t(`notify.fgs.${kind}.end`), pressAction: { id: ACTION_END } }] : [],
    },
  });
  running = true;
  shownKey = key;
}

// Every change goes through one queue, so a quick start/stop/start never
// races the native service.
let queue: Promise<void> = Promise.resolve();
function sync() {
  if (!ANDROID) return;
  queue = queue
    .then(async () => {
      const t = top();
      if (!t) {
        if (running || releaseRunner) await stopService();
        return;
      }
      await show(t[0], t[1]);
    })
    .catch((e) => console.warn('audio foreground:', (e as Error)?.message));
}

// A session asked for while the app was not in front starts once it is; a
// microphone granted meanwhile upgrades the service's type.
if (ANDROID) {
  AppState.addEventListener('change', (st) => {
    if (st === 'active' && sessions.size > 0) sync();
  });
}

/**
 * Starts (or updates) the ongoing notification for this kind of session.
 * Call it while the app is in front. Returns the stop: it only removes this
 * very start, so a late cleanup cannot end a newer session of the same kind.
 */
export function startAudioForeground(kind: AudioSessionKind, opts: AudioSessionOptions = {}): () => void {
  if (!ANDROID) return () => {};
  const token = {};
  sessions.set(kind, { ...opts, token, since: sessions.get(kind)?.since ?? Date.now() });
  sync();
  return () => {
    if (sessions.get(kind)?.token !== token) return;
    sessions.delete(kind);
    sync();
  };
}

/** Ends the notification for this kind of session, whoever started it. */
export function stopAudioForeground(kind: AudioSessionKind) {
  if (!ANDROID || !sessions.has(kind)) return;
  sessions.delete(kind);
  sync();
}

// ---------- The notification's button and tap ----------

function whenActive(fn: () => void) {
  if (AppState.currentState === 'active') {
    fn();
    return;
  }
  const sub = AppState.addEventListener('change', (st) => {
    if (st !== 'active') return;
    sub.remove();
    fn();
  });
  // The app never came up: forget it.
  setTimeout(() => sub.remove(), 15_000);
}

/** Handles a press on the ongoing notification; false for anything else. */
export function handleAudioForegroundEvent({ type, detail }: Event): boolean {
  const data = (detail.notification?.data ?? {}) as Record<string, unknown>;
  if (data.kind !== KIND) return false;
  if (type !== EventType.PRESS && type !== EventType.ACTION_PRESS) return true;
  const kind = data.session as AudioSessionKind;
  const s = sessions.get(kind);
  const id = detail.pressAction?.id;
  if (id === ACTION_END) {
    if (!s) {
      // A leftover from a session this runtime no longer knows: just go.
      void stopService();
      return true;
    }
    try {
      s.onEnd?.();
    } catch (e) {
      console.warn('audio foreground end:', (e as Error)?.message);
    }
    stopAudioForeground(kind);
    return true;
  }
  if (s?.onOpen) {
    const open = s.onOpen;
    whenActive(() => {
      try {
        open();
      } catch {}
    });
  }
  return true;
}

if (ANDROID) {
  // Presses with the app in front.
  notifee.onForegroundEvent((e) => void handleAudioForegroundEvent(e));
  // Presses with the app in the background: notify-kit has ONE background
  // handler. background.ts (imported above, so it has already registered
  // its own) handles the call notifications; this wraps it, taking this
  // notification's presses and passing everything else on unchanged.
  notifee.onBackgroundEvent(async (e) => {
    if (handleAudioForegroundEvent(e)) return;
    await handleNotificationEvent(e);
  });
}
