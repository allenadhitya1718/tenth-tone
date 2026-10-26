// WhatsApp-style message notifications (client round 4). Safe to import from
// the headless background task: no React, no router.
//
// Android: send-push sends a message as a DATA-ONLY push to an app that said
// it can draw one (push_tokens.caps 'chat_style', 0160). The background task
// (features/call/background.ts) hands it here, and this file draws ONE
// conversation notification per chat in Android's messaging style: the
// sender's photo, the last few messages (group chats name each sender), a
// Reply box and Mark as read. Replying sends the message without opening the
// app and adds it to the conversation, as WhatsApp does.
//
// iPhone: iOS draws the push itself; the app registers the 'chat_message'
// category with Reply (text input) and Mark as read (push.ts), and the
// answers arrive here through handleChatResponse.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import notifee, {
  AndroidCategory,
  AndroidStyle,
  AndroidVisibility,
  type AndroidMessagingStyleMessage,
  type Notification as KitNotification,
} from 'react-native-notify-kit';

import { markChatRead, sendMessage } from '@/api/chat';
import { markNotificationsRead } from '@/api/notifications';

export const IOS_CHAT_CATEGORY = 'chat_message';
export const CHAT_ACTION_REPLY = 'chat_reply';
export const CHAT_ACTION_READ = 'chat_read';
// push.ts creates it (high importance, sound, private on the lock screen).
export const CHAT_CHANNEL = 'messages';

const HISTORY = 7;
const historyKey = (chatId: string) => `tt-chat-notif:${chatId}`;
export const chatNotificationId = (chatId: string) => `chat_${chatId}`;

type Line = { text: string; at: number; mine: boolean; senderId?: string; name?: string; avatar?: string; notificationId?: string };

export type ChatPush = {
  chatId: string;
  route: string;
  notificationId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  text: string;
  chatTitle: string;
  isGroup: boolean;
  sentAt: number;
  replyLabel: string;
  readLabel: string;
  youLabel: string;
};

const str = (v: unknown) => (typeof v === 'string' ? v : '');
// Titles, bodies and message lines are read as simple HTML on Android.
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function parseChatPush(d: Record<string, unknown>): ChatPush | null {
  if (d.kind !== 'chat_message' || !str(d.chat_id)) return null;
  return {
    chatId: str(d.chat_id),
    route: str(d.route) || `/chat/${str(d.chat_id)}`,
    notificationId: str(d.notification_id),
    senderId: str(d.sender_id),
    senderName: str(d.sender_name) || 'FLYP',
    senderAvatar: str(d.sender_avatar),
    text: str(d.msg_text),
    chatTitle: str(d.chat_title),
    isGroup: d.is_group === '1',
    sentAt: Number(d.sent_at) || Date.now(),
    replyLabel: str(d.reply_label) || 'Reply',
    readLabel: str(d.read_label) || 'Mark as read',
    youLabel: str(d.you_label) || 'You',
  };
}

async function readHistory(chatId: string): Promise<Line[]> {
  try {
    const raw = await AsyncStorage.getItem(historyKey(chatId));
    const list = raw ? (JSON.parse(raw) as Line[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const writeHistory = (chatId: string, lines: Line[]) =>
  AsyncStorage.setItem(historyKey(chatId), JSON.stringify(lines.slice(-HISTORY))).catch(() => {});

// The data a conversation notification carries, kept so a reply can redraw it.
type Meta = Omit<ChatPush, 'text' | 'senderId' | 'senderName' | 'senderAvatar' | 'notificationId' | 'sentAt'> & {
  senderName: string;
  senderAvatar: string;
};

async function draw(meta: Meta, lines: Line[], quiet: boolean) {
  const last = lines[lines.length - 1];
  const messages: AndroidMessagingStyleMessage[] = lines.map((l) => ({
    text: esc(l.text),
    timestamp: l.at,
    // No person = a message from this phone's owner ("You").
    ...(l.mine ? {} : { person: { id: l.senderId || l.name || 'x', name: l.name || meta.senderName, ...(l.avatar ? { icon: l.avatar } : {}) } }),
  }));
  const title = meta.isGroup ? meta.chatTitle : meta.senderName;
  const n: KitNotification = {
    id: chatNotificationId(meta.chatId),
    title: esc(title),
    body: esc(last ? (meta.isGroup && !last.mine ? `${last.name}: ${last.text}` : last.text) : ''),
    data: {
      kind: 'chat_message',
      chat_id: meta.chatId,
      route: meta.route,
      chat_title: meta.chatTitle,
      is_group: meta.isGroup ? '1' : '0',
      sender_name: meta.senderName,
      sender_avatar: meta.senderAvatar,
      reply_label: meta.replyLabel,
      read_label: meta.readLabel,
      you_label: meta.youLabel,
    },
    android: {
      channelId: CHAT_CHANNEL,
      category: AndroidCategory.MESSAGE,
      visibility: AndroidVisibility.PRIVATE,
      // A reply redraws without a second sound; a new message alerts again.
      onlyAlertOnce: quiet,
      autoCancel: true,
      showTimestamp: true,
      timestamp: last?.at ?? Date.now(),
      ...(!meta.isGroup && meta.senderAvatar ? { largeIcon: meta.senderAvatar, circularLargeIcon: true } : {}),
      style: {
        type: AndroidStyle.MESSAGING,
        person: { name: meta.youLabel },
        messages,
        ...(meta.isGroup ? { title: esc(meta.chatTitle), group: true } : {}),
      },
      pressAction: { id: 'default', launchActivity: 'default' },
      actions: [
        {
          title: meta.replyLabel,
          pressAction: { id: CHAT_ACTION_REPLY },
          input: { placeholder: meta.replyLabel, allowFreeFormInput: true },
        },
        { title: meta.readLabel, pressAction: { id: CHAT_ACTION_READ } },
      ],
    },
  };
  await notifee.displayNotification(n);
}

/** A message push arrived: add it to its chat's notification (Android). */
export async function showChatMessage(c: ChatPush): Promise<void> {
  if (Platform.OS !== 'android') return;
  const lines = await readHistory(c.chatId);
  // The same push delivered twice is drawn once.
  if (c.notificationId && lines.some((l) => l.notificationId === c.notificationId)) return;
  lines.push({
    text: c.text,
    at: c.sentAt,
    mine: false,
    senderId: c.senderId,
    name: c.senderName,
    avatar: c.senderAvatar,
    notificationId: c.notificationId,
  });
  await writeHistory(c.chatId, lines);
  await draw(c, lines.slice(-HISTORY), false);
}

/** The chat was opened or read: take its notification away. Never throws. */
export async function clearChatNotification(chatId: string): Promise<void> {
  try {
    if (Platform.OS === 'android') await notifee.cancelNotification(chatNotificationId(chatId));
  } catch {}
  await AsyncStorage.removeItem(historyKey(chatId)).catch(() => {});
}

async function markRead(chatId: string, lines: Line[]) {
  const ids = lines.map((l) => l.notificationId).filter((x): x is string => !!x);
  await Promise.all([markChatRead(chatId), ids.length ? markNotificationsRead(ids.slice(0, 50)).catch(() => 0) : 0]);
}

/**
 * Reply or Mark as read pressed on a chat notification (Android, from the
 * notification's own data; iPhone, from the push's data). Never opens the app.
 */
export async function handleChatAction(action: string, data: Record<string, unknown>, input?: string): Promise<void> {
  const chatId = str(data.chat_id);
  if (!chatId) return;
  const lines = await readHistory(chatId);

  if (action === CHAT_ACTION_READ) {
    await markRead(chatId, lines);
    await clearChatNotification(chatId);
    return;
  }
  if (action !== CHAT_ACTION_REPLY) return;
  const text = (input ?? '').trim();
  if (!text) return;
  const meta: Meta = {
    chatId,
    route: str(data.route) || `/chat/${chatId}`,
    chatTitle: str(data.chat_title),
    isGroup: data.is_group === '1',
    senderName: str(data.sender_name),
    senderAvatar: str(data.sender_avatar),
    replyLabel: str(data.reply_label) || 'Reply',
    readLabel: str(data.read_label) || 'Mark as read',
    youLabel: str(data.you_label) || 'You',
  };
  try {
    await sendMessage({ chatId, text });
  } catch (e) {
    console.warn('chat reply from notification failed:', (e as Error)?.message);
    // Leave the conversation as it was, so the message can be retried.
    if (Platform.OS === 'android') await draw(meta, lines, true).catch(() => {});
    return;
  }
  // Replying reads the chat, as on WhatsApp.
  await markRead(chatId, lines);
  if (Platform.OS !== 'android') return;
  const next = [...lines, { text, at: Date.now(), mine: true }];
  await writeHistory(chatId, next);
  await draw(meta, next.slice(-HISTORY), true);
}
