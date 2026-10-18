import type { TFunction } from 'i18next';

import {
  DM_FALLBACK_TITLE,
  GROUP_FALLBACK_TITLE,
  type LastMessage,
  type Message,
  type MessageType,
  type ReplyTarget,
} from '@/api/chat';

// A call row carries JSON in `text` (0045), not a sentence. Printing it raw
// showed {"kind":"video",...} in the inbox, so it is read here instead.
type CallInfo = { kind?: string; status?: string; seconds?: number };

export function parseCall(text: string | null | undefined): CallInfo {
  try {
    const v = JSON.parse(text || '{}') as unknown;
    return v && typeof v === 'object' ? (v as CallInfo) : {};
  } catch {
    return {};
  }
}

export function callLabel(info: CallInfo, t: TFunction) {
  if (info.status === 'declined') return t('chat.callDeclined');
  if (info.status === 'missed') return t('chat.callMissed');
  return info.kind === 'video' ? t('chat.callVideo') : t('chat.callVoice');
}

// One line describing a message, for the inbox row, the reply quote and the
// reply bar. Media gets a label: an image's "text" is empty and a voice
// note's URL is meaningless to a person.
export function previewText(
  m: Pick<LastMessage | Message | ReplyTarget, 'type' | 'text'> | null | undefined,
  t: TFunction,
): string {
  if (!m) return t('chat.startConversation');
  const kind: MessageType = m.type || 'text';
  if (kind === 'voice') return `🎤 ${t('chat.voiceMessage')}`;
  if (kind === 'image') return `📷 ${t('chat.photo')}`;
  if (kind === 'video') return `🎥 ${t('chat.video')}`;
  if (kind === 'location') return `📍 ${t('chat.location')}`;
  if (kind === 'file') return `📎 ${m.text || t('chat.file')}`;
  if (kind === 'call') {
    const info = parseCall(m.text);
    return `${info.kind === 'video' ? '📹' : '📞'} ${callLabel(info, t)}`;
  }
  return (m.text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function clockTime(iso: string, locale: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

export function dayKey(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// "Today", "Yesterday", or the date. A long thread was one unbroken run of
// bubbles with only clock times before the web app added these.
export function dayLabel(iso: string, t: TFunction, locale: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return t('chat.today');
  if (d.toDateString() === yesterday.toDateString()) return t('chat.yesterday');
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: sameYear ? undefined : 'numeric' });
}

export function formatDuration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// The first letter of a name, for an avatar without a photo.
export function initial(name: string | null | undefined) {
  return Array.from((name || '').trim())[0]?.toUpperCase() ?? '?';
}

// The API keeps the web app's Arabic fallback titles ("group", "chat");
// translated here so an English screen does not show Arabic words.
export function translateTitle(title: string, t: TFunction) {
  if (title === GROUP_FALLBACK_TITLE) return t('chat.groupFallback');
  if (title === DM_FALLBACK_TITLE) return t('chat.dmFallback');
  return title;
}
