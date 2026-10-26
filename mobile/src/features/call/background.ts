// Runs with the app in the background or CLOSED. Imported once, at module
// scope, by the app entry (mobile/index.js) before expo-router: Android starts
// a headless JS runtime for a data push or a notification button, and only
// what the entry file loads exists there. Keep this file (and what it
// imports) free of React, the router and the Agora engine.
//
//   expo-notifications background task  every push the app receives while
//       not in front: an incoming call is drawn as the ringing call
//       notification; "call over" takes it away (and leaves "missed call").
//   notify-kit background events         Accept / Decline / tap on that
//       notification. Decline is done right here, without opening the app.
//       Accept and tap open the app; what to do once it is up waits in
//       `pending` until useCallNotifications() picks it up.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';
import notifee, { EventType, type Event } from 'react-native-notify-kit';

import { declineCallIfRinging } from '@/api/calls';
import { getActiveChatId } from '@/features/notifications/activeChat';
import { CHAT_ACTION_READ, CHAT_ACTION_REPLY, handleChatAction, parseChatPush, showChatMessage } from '@/features/notifications/chatNotification';

import {
  ACTION_ACCEPT,
  ACTION_DECLINE,
  ACTION_OPEN,
  dismissIncomingCall,
  handleCallEnded,
  markCallOver,
  parseCallEnded,
  parseIncomingCall,
  showIncomingCall,
} from './callNotification';

export const PUSH_TASK = 'flyp-push-background';

// ---------- The bridge to the running app ----------

export type CallAction =
  | { action: 'accept'; callId: string }
  | { action: 'open'; callId: string }
  | { action: 'route'; route: string };

type AppHandlers = {
  run: (a: CallAction) => void;
  // A call push arrived with the app in front: ring through the app.
  ring: (callId: string) => void;
};

let app: AppHandlers | null = null;
const PENDING_KEY = 'tt-call-pending';
// An action older than this is stale (the ring has long ended).
const PENDING_MAX_MS = 60_000;
let pending: (CallAction & { at: number }) | null = null;

// The same press can arrive twice (background event and the app's
// getInitialNotification); act on it once.
const recent = new Map<string, number>();
function firstTime(a: CallAction): boolean {
  const key = a.action === 'route' ? `route:${a.route}` : `${a.action}:${a.callId}`;
  const now = Date.now();
  const last = recent.get(key);
  recent.set(key, now);
  return !last || now - last > 10_000;
}

function deliver(a: CallAction) {
  if (!firstTime(a)) return;
  if (app) {
    app.run(a);
    return;
  }
  // The app is still starting (Accept from a closed app). Kept in memory for
  // this runtime and on disk in case the UI comes up in another one.
  pending = { ...a, at: Date.now() };
  AsyncStorage.setItem(PENDING_KEY, JSON.stringify(pending)).catch(() => {});
}

/** The running app takes over the actions. Returns the detach. */
export function attachCallActions(h: AppHandlers): () => void {
  app = h;
  void (async () => {
    let p = pending;
    pending = null;
    try {
      const raw = await AsyncStorage.getItem(PENDING_KEY);
      await AsyncStorage.removeItem(PENDING_KEY);
      if (!p && raw) p = JSON.parse(raw) as CallAction & { at: number };
    } catch {}
    if (p && Date.now() - p.at < PENDING_MAX_MS && app === h) {
      const { at: _at, ...a } = p;
      h.run(a as CallAction);
    }
  })();
  return () => {
    if (app === h) app = null;
  };
}

// ---------- notify-kit events (Android) ----------

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Accept / Decline / tap on one of the app-drawn notifications. */
export async function handleNotificationEvent({ type, detail }: Event): Promise<void> {
  const data = (detail.notification?.data ?? {}) as Record<string, unknown>;
  const kind = str(data.kind);
  const press = type === EventType.PRESS || type === EventType.ACTION_PRESS;
  if (!press) return;
  const id = detail.pressAction?.id ?? '';

  if (kind === 'incoming_call') {
    const callId = str(data.call_id);
    if (!callId) return;
    if (id === ACTION_DECLINE) {
      markCallOver(callId);
      await dismissIncomingCall(callId);
      try {
        await declineCallIfRinging(callId);
      } catch (e) {
        console.warn('call: decline from notification failed:', (e as Error)?.message);
      }
      return;
    }
    if (id === ACTION_ACCEPT) {
      markCallOver(callId);
      await dismissIncomingCall(callId);
      deliver({ action: 'accept', callId });
      return;
    }
    if (id === ACTION_OPEN || id === 'default') deliver({ action: 'open', callId });
    return;
  }

  if (kind === 'missed_call') {
    const route = str(data.route);
    if (route) deliver({ action: 'route', route });
    return;
  }

  // WhatsApp-style message notification (features/notifications/chatNotification.ts).
  if (kind === 'chat_message') {
    if (id === CHAT_ACTION_REPLY || id === CHAT_ACTION_READ) {
      await handleChatAction(id, data, detail.input);
      return;
    }
    const route = str(data.route);
    if (route) deliver({ action: 'route', route });
  }
}

// ---------- The push task (both platforms) ----------

async function onPush(payload: Notifications.NotificationTaskPayload | undefined) {
  if (!payload) return;
  // iPhone: Reply / Mark as read on a message alert, answered without
  // opening the app.
  if ('actionIdentifier' in payload) {
    const r = payload as unknown as { actionIdentifier: string; userText?: string; notification?: Notifications.Notification };
    const data = (r.notification?.request.content.data ?? {}) as Record<string, unknown>;
    if (r.actionIdentifier === CHAT_ACTION_REPLY || r.actionIdentifier === CHAT_ACTION_READ) {
      await handleChatAction(r.actionIdentifier, data, r.userText);
    }
    return;
  }
  const d = (payload.data ?? {}) as Record<string, unknown>;

  // A message, drawn WhatsApp-style (Android). Not while that chat is open.
  const chat = parseChatPush(d);
  if (chat) {
    if (AppState.currentState === 'active' && getActiveChatId() === chat.chatId) return;
    await showChatMessage(chat);
    return;
  }

  const ended = parseCallEnded(d);
  if (ended) {
    // In front, the call screen already said "missed"; no banner on top.
    const inFront = AppState.currentState === 'active' && !!app;
    await handleCallEnded(inFront ? { ...ended, missed: false } : ended);
    return;
  }
  const call = parseIncomingCall(d);
  if (!call) return;
  // In front: the app rings itself (call screen + its own ring), so no
  // notification on top of it.
  if (AppState.currentState === 'active' && app) {
    app.ring(call.callId);
    return;
  }
  await showIncomingCall(call);
}

const native = Platform.OS === 'android' || Platform.OS === 'ios';

if (native && !TaskManager.isTaskDefined(PUSH_TASK)) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(PUSH_TASK, async ({ data, error }) => {
    if (error) return;
    try {
      await onPush(data);
    } catch (e) {
      console.warn('push task:', (e as Error)?.message);
    }
  });
  Notifications.registerTaskAsync(PUSH_TASK).catch((e) =>
    console.warn('push task not registered:', (e as Error)?.message),
  );
}

if (Platform.OS === 'android') {
  notifee.onBackgroundEvent(handleNotificationEvent);
}

// iPhone: iOS itself draws every push; notify-kit must leave remote
// notifications (and their taps) to expo-notifications.
if (Platform.OS === 'ios') {
  notifee.setNotificationConfig({ ios: { handleRemoteNotifications: false } }).catch(() => {});
}
