// Push notifications on the device: permission, the native token, Android
// channels, what shows while the app is open, and where a tap goes. Port of
// web/js/push.js.
//
// The token is the NATIVE device token (FCM on Android, APNs on iPhone),
// never an Expo push token: send-push talks to FCM and APNs directly.
//
// Client note 11: lock-screen notifications were too many and too noisy. The
// fix, WhatsApp-style, is one Android channel per kind, so likes, comments
// and follows land in a silent low-importance channel while messages and
// calls keep sound and heads-up. A channel's importance cannot be changed
// after it is created (only by the person in system settings), so these ids
// and levels are effectively permanent: a different level needs a new id.
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { AndroidImportance as I, AndroidNotificationVisibility as V } from 'expo-notifications';
import type { TFunction } from 'i18next';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Platform } from 'react-native';

import { declineCallIfRinging } from '@/api/calls';
import { markNotificationsRead, notificationKeys } from '@/api/notifications';
import { removePushToken, savePushToken } from '@/api/settings';
import {
  ACTION_ACCEPT,
  ACTION_CALLBACK,
  ACTION_DECLINE,
  ACTION_MESSAGE,
  dismissIncomingCall,
  IOS_CALL_CATEGORY,
  IOS_MISSED_CATEGORY,
  markCallOver,
} from '@/features/call/callNotification';
import { answerWhenReady, getCallState } from '@/features/call/callSession';
import { watchVoipToken } from '@/features/call/callkit';
import { maybeAskFullScreenCalls } from '@/features/call/fullScreenPermission';
import { openCallScreen } from '@/features/call/nav';
import { callBack, useCallNotifications } from '@/features/call/useCallNotifications';
import { go } from '@/features/discover/nav';
import { useAuth } from '@/providers/AuthProvider';

import { getActiveChatId, setActiveChatId } from './activeChat';
import { CHAT_ACTION_READ, CHAT_ACTION_REPLY, clearChatNotification, handleChatAction, IOS_CHAT_CATEGORY } from './chatNotification';

// Channel ids send-push puts in android.notification.channel_id (messages,
// social, live; 'default' for the push test). An incoming call is not a
// notification push on Android: it arrives data-only and the app draws it in
// the calls channel itself (features/call/callNotification.ts).
export const PUSH_CHANNELS = {
  // Round 4: new ids for the FLYP message tone and ringtone (a channel's
  // sound is fixed once created). The old 'messages' / 'calls' are deleted.
  messages: 'chats',
  calls: 'incoming_calls',
  social: 'social',
  live: 'live',
  // The push test, and pushes from an older send-push.
  fallback: 'default',
} as const;

const TOKEN_KEY = 'tt-push-token';
const native = Platform.OS === 'ios' || Platform.OS === 'android';

// Likes, comments, follows: the bell already shows these in the app.
const SOCIAL_TYPES = new Set(['like', 'comment', 'follow', 'follow_request', 'mention', 'gift']);

// ---------- The chat being viewed (activeChat.ts) ----------

export { getActiveChatId, setActiveChatId };

type PushData = Record<string, unknown>;

const dataOf = (n: Notifications.Notification): PushData => (n.request.content.data ?? {}) as PushData;

function chatIdOf(data: PushData): string | null {
  if (typeof data.chat_id === 'string') return data.chat_id;
  const m = typeof data.route === 'string' ? data.route.match(/^\/chat\/([^/?#]+)/) : null;
  return m ? decodeURIComponent(m[1]) : null;
}

const isCall = (data: PushData) =>
  data.kind === 'incoming_call' || (typeof data.route === 'string' && data.route.startsWith('/call/'));

// The calls.id a call push is about (send-push sends route /call/<id>).
function callIdOf(data: PushData): string | null {
  if (typeof data.call_id === 'string') return data.call_id;
  const m = typeof data.route === 'string' ? data.route.match(/^\/call\/([^/?#]+)/) : null;
  return m ? decodeURIComponent(m[1]) : null;
}

// ---------- Foreground behaviour ----------

const HIDDEN: Notifications.NotificationBehavior = {
  shouldShowBanner: false,
  shouldShowList: false,
  shouldPlaySound: false,
  shouldSetBadge: false,
};

export function foregroundBehavior(data: PushData): Notifications.NotificationBehavior {
  const type = String(data.type ?? '');
  if (type === 'message') {
    const active = getActiveChatId();
    if (active && chatIdOf(data) === active) return HIDDEN;
    return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
  }
  if (isCall(data)) {
    // The realtime ring usually gets there first and the call screen is
    // already up: a heads-up banner with sound on top of it is noise.
    const id = callIdOf(data);
    if (id && getCallState().callId === id) return HIDDEN;
    return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
  }
  // In the app the bell badge is enough; keep it in the shade, quietly.
  if (SOCIAL_TYPES.has(type)) return { shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false };
  return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false };
}

let handlerInstalled = false;
function installHandler() {
  if (handlerInstalled) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      // A data-only push (a call ring or "call over", handled by the
      // background task in features/call/background.ts) has nothing to show.
      const c = n.request.content;
      if (!c.title && !c.body) return HIDDEN;
      return foregroundBehavior(dataOf(n));
    },
  });
}

// ---------- Android channels ----------

async function ensureChannels(t: TFunction) {
  if (Platform.OS !== 'android') return;
  // Re-run on a language change: names and descriptions can be updated,
  // importance cannot (see the top of the file).
  await Promise.all([
    Notifications.setNotificationChannelAsync(PUSH_CHANNELS.messages, {
      name: t('discover.push.ch_messages'),
      description: t('discover.push.ch_messagesDesc'),
      importance: I.HIGH,
      sound: 'flyp_message.wav',
      enableVibrate: true,
      vibrationPattern: [0, 200, 120, 200],
      showBadge: true,
      // Sender and text stay hidden on a locked screen.
      lockscreenVisibility: V.PRIVATE,
    }),
    Notifications.setNotificationChannelAsync(PUSH_CHANNELS.calls, {
      name: t('discover.push.ch_calls'),
      description: t('discover.push.ch_callsDesc'),
      importance: I.MAX,
      sound: 'flyp_ring.wav',
      enableVibrate: true,
      vibrationPattern: [0, 800, 400, 800, 400, 800],
      showBadge: false,
      lockscreenVisibility: V.PUBLIC,
    }),
    Notifications.setNotificationChannelAsync(PUSH_CHANNELS.social, {
      name: t('discover.push.ch_social'),
      description: t('discover.push.ch_socialDesc'),
      importance: I.LOW,
      sound: null,
      enableVibrate: false,
      vibrationPattern: null,
      showBadge: true,
      lockscreenVisibility: V.PRIVATE,
    }),
    Notifications.setNotificationChannelAsync(PUSH_CHANNELS.live, {
      name: t('discover.push.ch_live'),
      description: t('discover.push.ch_liveDesc'),
      importance: I.DEFAULT,
      showBadge: true,
    }),
    Notifications.setNotificationChannelAsync(PUSH_CHANNELS.fallback, {
      name: t('discover.push.ch_other'),
      importance: I.DEFAULT,
      showBadge: true,
    }),
    // The channels before the FLYP tones, so Settings lists each kind once.
    Notifications.deleteNotificationChannelAsync('messages').catch(() => {}),
    Notifications.deleteNotificationChannelAsync('calls').catch(() => {}),
  ]);
}

// ---------- Permission and token ----------

async function allowed(): Promise<boolean> {
  const now = await Notifications.getPermissionsAsync();
  if (now.granted) return true;
  if (!now.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  });
  return asked.granted;
}

// What this build can do with a push (push_tokens.caps, 0160).
export const PUSH_CAPS: string[] =
  Platform.OS === 'android'
    ? ['chat_style', 'ringtone']
    : Platform.OS === 'ios'
      ? // 'chat_avatar': this build has the Notification Service Extension
        // that shows the sender's photo (app.config.js FLYP_IOS_COMM_NOTIFS).
        ['chat_reply', 'ringtone', ...(Constants.expoConfig?.extra?.commNotifs ? ['chat_avatar'] : [])]
      : [];

// iPhone: the PushKit token, saved on the same row (callkit.ts).
let voipToken: string | null | undefined;

async function saveToken(token: string, lang: string) {
  await savePushToken(token, Platform.OS, lang, PUSH_CAPS, voipToken);
  await AsyncStorage.setItem(TOKEN_KEY, token).catch(() => {});
}

// Fetches the native token and saves it. Never throws: on a phone without
// reachable Google services (e.g. SERVICE_NOT_AVAILABLE on some Xiaomi/Redmi
// builds, no Play services, or no network) the app simply goes on without
// push and tries again later (see usePushRegistration).
let lastTokenFailure = '';
async function fetchAndSaveToken(lang: string): Promise<boolean> {
  try {
    const { data } = await Notifications.getDevicePushTokenAsync();
    if (typeof data === 'string' && data) await saveToken(data, lang);
    lastTokenFailure = '';
    return true;
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    // One line per distinct failure, not one per retry.
    if (msg !== lastTokenFailure) {
      lastTokenFailure = msg;
      console.warn(`push: no device token yet, will retry (${msg.slice(0, 160)})`);
    }
    return false;
  }
}

// Safe on every launch and sign-in: a token already saved is upserted again,
// which refreshes its language. Resolves true when a token was saved, false
// when only the token step failed (retry later).
async function register(t: TFunction, lang: string): Promise<boolean> {
  // Channels first: on Android 13+ the permission prompt only appears once
  // the app has a channel.
  await ensureChannels(t);
  await ensureCallCategory(t);
  await ensureChatCategory(t);
  await ensureMissedCategory(t);
  if (!(await allowed())) return true;
  const ok = await fetchAndSaveToken(lang);
  // Android 14+: the ringing call can only take over a locked screen with
  // full-screen access. Asked once, after notifications are allowed.
  await maybeAskFullScreenCalls(t);
  return ok;
}

// iPhone: the incoming-call alert (send-push aps.category 'incoming_call')
// gets Accept and Decline buttons. Re-registered on a language change so the
// buttons read in it. Android draws its own (callNotification.ts).
async function ensureCallCategory(t: TFunction) {
  if (Platform.OS !== 'ios') return;
  await Notifications.setNotificationCategoryAsync(IOS_CALL_CATEGORY, [
    {
      identifier: ACTION_DECLINE,
      buttonTitle: t('notify.call.decline'),
      options: { opensAppToForeground: false, isDestructive: true },
    },
    {
      identifier: ACTION_ACCEPT,
      buttonTitle: t('notify.call.accept'),
      options: { opensAppToForeground: true },
    },
  ]);
}

// iPhone: Reply (typed on the lock screen) and Mark as read on a message
// (send-push aps.category 'chat_message' for apps with cap 'chat_reply').
async function ensureChatCategory(t: TFunction) {
  if (Platform.OS !== 'ios') return;
  await Notifications.setNotificationCategoryAsync(IOS_CHAT_CATEGORY, [
    {
      identifier: CHAT_ACTION_REPLY,
      buttonTitle: t('notify.chat.reply'),
      textInput: { submitButtonTitle: t('notify.chat.send'), placeholder: t('notify.chat.replyPlaceholder') },
      options: { opensAppToForeground: false },
    },
    {
      identifier: CHAT_ACTION_READ,
      buttonTitle: t('notify.chat.markRead'),
      options: { opensAppToForeground: false },
    },
  ]);
}

// iPhone: Call back and Message on a missed call, as on WhatsApp.
async function ensureMissedCategory(t: TFunction) {
  if (Platform.OS !== 'ios') return;
  await Notifications.setNotificationCategoryAsync(IOS_MISSED_CATEGORY, [
    { identifier: ACTION_CALLBACK, buttonTitle: t('notify.missed.callBack'), options: { opensAppToForeground: true } },
    { identifier: ACTION_MESSAGE, buttonTitle: t('notify.missed.message'), options: { opensAppToForeground: true } },
  ]);
}

// Call BEFORE supabase.auth.signOut(): afterwards nothing can authorise the
// delete, and this phone would keep getting the old account's pushes.
export async function unregisterPush() {
  if (!native) return;
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (token) await removePushToken(token);
  } catch (e) {
    // The token also dies on the next send that comes back invalid.
    console.warn('push: token not removed:', (e as Error)?.message);
  }
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
  await Notifications.setBadgeCountAsync(0).catch(() => false);
}

// ---------- Opening a tapped notification ----------

// send-push writes web-app routes (/v/<id>, /profile/<id>, /home ...). This
// maps them onto this app's screens; anything unknown opens the list.
export function appPathFor(route: unknown): string {
  if (typeof route !== 'string' || !route.startsWith('/')) return '/notifications';
  const [, head = '', id = ''] = route.match(/^\/([^/?#]+)(?:\/([^/?#]+))?/) ?? [];
  const seg = encodeURIComponent(decodeURIComponent(id));
  switch (head) {
    case 'v':
    case 'video':
      return id ? `/video/${seg}` : '/notifications';
    case 'profile':
    case 'user':
      return id ? `/user/${seg}` : '/profile';
    case 'chat':
      return id ? `/chat/${seg}` : '/inbox';
    case 'live':
      return id ? `/live/${seg}` : '/';
    case 'comments':
      return id ? `/comments/${seg}` : '/notifications';
    case 'tag':
      return id ? `/tag/${seg}` : '/discover';
    case 'inbox':
      return '/inbox';
    case 'home':
      return '/';
    case 'follow-requests':
      return '/follow-requests';
    case 'call':
      return id ? `/call/${seg}` : '/inbox';
    default:
      return '/notifications';
  }
}

const openRoute = (route: string) => go(appPathFor(route));

const opened = new Set<string>();

function openResponse(r: Notifications.NotificationResponse, onRead: () => void) {
  const id = r.notification.request.identifier;
  // The cold-start response and the listener can both deliver the same tap.
  if (opened.has(id)) return;
  opened.add(id);
  const data = dataOf(r.notification);
  // Reply / Mark as read on a message: answered in place, nothing opens.
  if (r.actionIdentifier === CHAT_ACTION_REPLY || r.actionIdentifier === CHAT_ACTION_READ) {
    void handleChatAction(r.actionIdentifier, data, r.userText).then(onRead, () => {});
    return;
  }
  // Call back on a missed call (iPhone category 'missed_call').
  if (r.actionIdentifier === ACTION_CALLBACK && typeof data.caller_id === 'string' && data.caller_id) {
    void callBack({
      action: 'callback',
      peer: { id: data.caller_id, name: String(data.caller_name ?? ''), avatar: String(data.caller_avatar ?? '') },
      kind: data.call_kind === 'video' ? 'video' : 'audio',
      chatId: typeof data.chat_id === 'string' && data.chat_id ? data.chat_id : null,
    });
    return;
  }
  const callId = data.kind === 'call_cancelled' ? null : isCall(data) ? callIdOf(data) : null;
  // Decline on the iPhone call alert: no screen, just the answer.
  if (callId && r.actionIdentifier === ACTION_DECLINE) {
    markCallOver(callId);
    void dismissIncomingCall(callId);
    declineCallIfRinging(callId).catch((e) => console.warn('call: decline failed:', (e as Error)?.message));
  } else if (callId) {
    // Accept answers as soon as the call screen has loaded it.
    if (r.actionIdentifier === ACTION_ACCEPT) answerWhenReady(callId);
    // A call is opened through the call feature, which does not stack a
    // second screen when the realtime ring already opened one.
    openCallScreen(callId);
  } else go(appPathFor(data.route));
  // A grouped social push ("Sara and 4 more liked your video") stands for
  // several rows: send-push lists them all in notification_ids.
  const ids = new Set<string>();
  if (typeof data.notification_id === 'string') ids.add(data.notification_id);
  if (typeof data.notification_ids === 'string') {
    for (const id of data.notification_ids.split(',')) if (/^[0-9a-f-]{36}$/i.test(id)) ids.add(id);
  }
  if (ids.size) markNotificationsRead([...ids].slice(0, 50)).then(onRead, () => {});
}

// ---------- The hook ----------

// Mount once, inside the providers (auth, query, i18n). Registers while
// signed in, re-saves when the language or the token changes, and opens the
// screen a tapped notification points at.
export function usePushRegistration() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const qc = useQueryClient();

  // Accept / Decline / taps on the app-drawn call notifications.
  useCallNotifications(!!userId, openRoute);

  useEffect(() => {
    if (!native) return;
    installHandler();
    const refresh = () => void qc.invalidateQueries({ queryKey: notificationKeys.all });
    const received = Notifications.addNotificationReceivedListener(refresh);
    const tapped = Notifications.addNotificationResponseReceivedListener((r) => openResponse(r, refresh));
    return () => {
      received.remove();
      tapped.remove();
    };
  }, [qc]);

  useEffect(() => {
    if (!native || !userId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let running = false;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    // Backoff 30 s, 1 m, 2 m ... capped at 15 min; a return to the
    // foreground tries at once (it is also when the network is most likely
    // to be back), then the backoff continues.
    const attempt = async () => {
      if (cancelled || running) return;
      running = true;
      clear();
      let ok = false;
      try {
        ok = await register(t, lang);
      } catch (e) {
        console.warn('push: register:', (e as Error)?.message);
      }
      running = false;
      if (cancelled) return;
      if (ok) {
        failures = 0;
        return;
      }
      failures += 1;
      timer = setTimeout(() => void attempt(), Math.min(30_000 * 2 ** (failures - 1), 15 * 60_000));
    };
    void attempt();
    const appSub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && failures > 0) void attempt();
    });
    // iPhone: a new PushKit token goes onto this phone's row at once.
    const stopVoip = watchVoipToken((v) => {
      if (v === (voipToken ?? null)) return;
      voipToken = v;
      void AsyncStorage.getItem(TOKEN_KEY).then((tok) => {
        if (tok) saveToken(tok, lang).catch((e) => console.warn('push: voip token not saved:', (e as Error)?.message));
      });
    });
    // FCM and APNs rotate tokens now and then.
    const sub = Notifications.addPushTokenListener((tok) => {
      if (typeof tok.data === 'string' && tok.data) {
        saveToken(tok.data, lang).catch((e) => console.warn('push: token not saved:', (e as Error)?.message));
      }
    });
    return () => {
      cancelled = true;
      clear();
      appSub.remove();
      sub.remove();
      stopVoip();
    };
  }, [userId, lang, t]);

  // A tap that launched the app from cold arrives before any listener.
  useEffect(() => {
    if (!native || !userId) return;
    const last = Notifications.getLastNotificationResponse();
    if (!last) return;
    openResponse(last, () => void qc.invalidateQueries({ queryKey: notificationKeys.all }));
    Notifications.clearLastNotificationResponse();
  }, [userId, qc]);
}

// Removes this chat's message notifications from the shade (owner report:
// they stayed after the chat was read, unlike WhatsApp). The system draws
// them from the push itself, tagged `chat_<id>` (send-push), so they are
// found by that tag or by the chat_id in their data; on Android the tag is
// also cancelled directly, in case the list does not report it. Never throws.
export async function dismissChatNotifications(chatId: string) {
  // The WhatsApp-style ones the app draws itself (chatNotification.ts).
  await clearChatNotification(chatId);
  const tag = `chat_${chatId}`;
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    const ids = new Set(
      shown.filter((n) => n.request.identifier === tag || chatIdOf(dataOf(n)) === chatId).map((n) => n.request.identifier),
    );
    if (Platform.OS === 'android') ids.add(tag);
    await Promise.all([...ids].map((id) => Notifications.dismissNotificationAsync(id).catch(() => {})));
  } catch (e) {
    console.warn('push: could not clear chat notifications:', (e as Error)?.message ?? e);
  }
}

// For the chat screen: marks this chat as the one being read while mounted,
// and clears its notifications on opening and whenever the app comes back
// to the front with the chat open (a push may have landed in between).
export function useActiveChat(chatId: string | null | undefined) {
  useEffect(() => {
    if (!chatId) return;
    setActiveChatId(chatId);
    void dismissChatNotifications(chatId);
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') void dismissChatNotifications(chatId);
    });
    return () => {
      sub.remove();
      if (getActiveChatId() === chatId) setActiveChatId(null);
    };
  }, [chatId]);
}
