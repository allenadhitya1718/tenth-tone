// The incoming-call notification drawn by the app itself, WhatsApp-style:
// ringing, heads-up / full-screen, on the lock screen, with Accept and
// Decline. Safe to import from the headless background task (background.ts):
// nothing here touches React, the router or the Agora engine.
//
// Android: send-push sends an incoming call as a DATA-ONLY high-priority FCM
// message (supabase/functions/send-push). expo-notifications hands it to the
// background task even when the app is closed, and this file draws it with
// react-native-notify-kit (the maintained Notifee fork), which can do what
// expo-notifications cannot: a full-screen intent, a looping ring
// (FLAG_INSISTENT), buttons that do not open the app, a timeout.
//
// iPhone: the call arrives as a time-sensitive alert in the 'incoming_call'
// category (registered in push.ts with the same two buttons); iOS draws it.
// Only removing it lives here.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidVisibility,
  type Notification as KitNotification,
} from 'react-native-notify-kit';

// The 'calls' channel push.ts creates (PUSH_CHANNELS.calls): MAX importance,
// sound, long vibration, public on the lock screen.
export const CALL_CHANNEL = 'incoming_calls';
// Missed calls sit with messages: heard, but not a full ring.
const MISSED_CHANNEL = 'chats';

// The caller gives up after 45 s (callSession.ts RING_TIMEOUT_MS).
export const RING_MS = 45_000;

// The iOS notification category (send-push aps.category) and its buttons.
export const IOS_CALL_CATEGORY = 'incoming_call';
export const ACTION_ACCEPT = 'accept';
export const ACTION_DECLINE = 'decline';
export const ACTION_OPEN = 'open_call';

export type IncomingCallPush = {
  callId: string;
  callKind: 'audio' | 'video';
  isInvite: boolean;
  callerName: string;
  callerAvatar: string;
  title: string;
  text: string;
  acceptLabel: string;
  declineLabel: string;
  createdAt: number;
  notificationId: string;
};

export type CallEndedPush = {
  callId: string;
  missed: boolean;
  missedTitle: string;
  missedText: string;
  route: string;
  // For WhatsApp's Call back / Message buttons (empty from an older send-push).
  callerId: string;
  callerName: string;
  callerAvatar: string;
  kind: 'audio' | 'video';
  chatId: string;
  callbackLabel: string;
  messageLabel: string;
};

export const ACTION_CALLBACK = 'missed_callback';
export const ACTION_MESSAGE = 'missed_message';
export const IOS_MISSED_CATEGORY = 'missed_call';

const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** The data of a send-push incoming-call push, or null for anything else. */
export function parseIncomingCall(data: Record<string, unknown> | null | undefined): IncomingCallPush | null {
  if (!data || data.kind !== 'incoming_call' || !s(data.call_id)) return null;
  const video = data.call_kind === 'video';
  const name = s(data.caller_name) || 'FLYP';
  return {
    callId: s(data.call_id),
    callKind: video ? 'video' : 'audio',
    isInvite: data.is_invite === '1' || data.is_invite === true,
    callerName: name,
    callerAvatar: s(data.caller_avatar),
    // send-push writes these in the person's language; English is only the
    // fallback for a push from an older send-push.
    title: s(data.call_title) || name,
    text: s(data.call_text) || (video ? 'Video call' : 'Voice call'),
    acceptLabel: s(data.accept_label) || 'Accept',
    declineLabel: s(data.decline_label) || 'Decline',
    createdAt: Number(data.created_at) || Date.now(),
    notificationId: s(data.notification_id),
  };
}

export function parseCallEnded(data: Record<string, unknown> | null | undefined): CallEndedPush | null {
  if (!data || data.kind !== 'call_cancelled' || !s(data.call_id)) return null;
  return {
    callId: s(data.call_id),
    missed: data.missed === '1' || data.missed === true,
    missedTitle: s(data.missed_title),
    missedText: s(data.missed_text),
    route: s(data.route) || '/inbox',
    callerId: s(data.caller_id),
    callerName: s(data.caller_name),
    callerAvatar: s(data.caller_avatar),
    kind: data.call_kind === 'video' ? 'video' : 'audio',
    chatId: s(data.chat_id),
    callbackLabel: s(data.callback_label),
    messageLabel: s(data.message_label),
  };
}

export const callNotificationId = (callId: string) => `call_${callId}`;
const missedNotificationId = (callId: string) => `missed_${callId}`;

// Calls that already ended on this phone: a late or replayed ring push for
// them must not start ringing again.
const over = new Set<string>();
export const markCallOver = (callId: string) => void over.add(callId);

async function ensureCallChannel() {
  // push.ts creates it on sign-in; a phone that got a call before ever
  // opening this version still needs one. Same settings, so no conflict.
  if (await notifee.isChannelCreated(CALL_CHANNEL)) return;
  await notifee.createChannel({
    id: CALL_CHANNEL,
    name: 'Calls',
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PUBLIC,
    // res/raw/flyp_ring (app.json expo-notifications sounds).
    sound: 'flyp_ring',
    vibration: true,
    vibrationPattern: [300, 800, 400, 800],
  });
}

const escapeHtml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Rings: the call notification, until answered, declined, cancelled or 45 s. */
export async function showIncomingCall(c: IncomingCallPush): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (over.has(c.callId)) return;
  const left = RING_MS - (Date.now() - c.createdAt);
  if (left < 3_000) return; // a push that arrived too late to ring
  await ensureCallChannel();
  const notification: KitNotification = {
    id: callNotificationId(c.callId),
    title: escapeHtml(c.title),
    body: escapeHtml(c.text),
    data: { kind: 'incoming_call', call_id: c.callId, notification_id: c.notificationId },
    android: {
      channelId: CALL_CHANNEL,
      category: AndroidCategory.CALL,
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PUBLIC,
      // Rings (repeats the channel sound) until it is answered or removed.
      loopSound: true,
      ongoing: true,
      autoCancel: false,
      onlyAlertOnce: true,
      timeoutAfter: left,
      showTimestamp: true,
      timestamp: c.createdAt,
      lightUpScreen: true,
      ...(c.callerAvatar ? { largeIcon: c.callerAvatar, circularLargeIcon: true } : {}),
      // Tapping the body opens the ringing call screen (not answered).
      pressAction: { id: ACTION_OPEN, launchActivity: 'default' },
      // On a locked or idle phone Android launches the app straight away
      // (needs Full-Screen Intent access, see fullScreenPermission.ts).
      fullScreenAction: { id: ACTION_OPEN, launchActivity: 'default' },
      // WhatsApp's look: red Decline, green Answer (the action titles take
      // simple HTML; phones that ignore the colour show plain text).
      color: '#25D366',
      actions: [
        // No launchActivity: declining never opens the app.
        { title: `<font color="#E53935"><b>${escapeHtml(c.declineLabel)}</b></font>`, pressAction: { id: ACTION_DECLINE } },
        { title: `<font color="#1DA851"><b>${escapeHtml(c.acceptLabel)}</b></font>`, pressAction: { id: ACTION_ACCEPT, launchActivity: 'default' } },
      ],
    },
  };
  await notifee.displayNotification(notification);
}

/** Takes the ringing notification away (both platforms). Never throws. */
export async function dismissIncomingCall(callId: string): Promise<void> {
  try {
    if (Platform.OS === 'android') await notifee.cancelNotification(callNotificationId(callId));
  } catch {}
  // Anything expo-notifications drew for this call: an iPhone alert, or an
  // Android one from an older send-push.
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      shown
        .filter((n) => {
          const d = (n.request.content.data ?? {}) as Record<string, unknown>;
          return d.call_id === callId && d.kind === 'incoming_call';
        })
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier)),
    );
  } catch {}
}

/** The ring is over; on Android, "Missed call from X" when nobody answered. */
export async function handleCallEnded(e: CallEndedPush): Promise<void> {
  markCallOver(e.callId);
  await dismissIncomingCall(e.callId);
  if (Platform.OS !== 'android' || !e.missed || !e.missedTitle) return;
  try {
    await notifee.displayNotification({
      id: missedNotificationId(e.callId),
      title: e.missedTitle,
      body: e.missedText,
      data: {
        kind: 'missed_call',
        call_id: e.callId,
        route: e.route,
        caller_id: e.callerId,
        caller_name: e.callerName,
        caller_avatar: e.callerAvatar,
        call_kind: e.kind,
        chat_id: e.chatId,
      },
      android: {
        channelId: MISSED_CHANNEL,
        pressAction: { id: 'default', launchActivity: 'default' },
        autoCancel: true,
        ...(e.callerAvatar ? { largeIcon: e.callerAvatar, circularLargeIcon: true } : {}),
        actions:
          e.callerId && e.callbackLabel
            ? [
                { title: e.callbackLabel, pressAction: { id: ACTION_CALLBACK, launchActivity: 'default' } },
                { title: e.messageLabel || e.callbackLabel, pressAction: { id: ACTION_MESSAGE, launchActivity: 'default' } },
              ]
            : undefined,
      },
    });
  } catch {}
}
