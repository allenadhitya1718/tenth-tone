import type { QueryClient } from '@tanstack/react-query';

import { type ChatListItem, chatKeys, type MessageRow } from '@/api/chat';

import type { ThreadMessage } from './useThread';

// A message just sent or received, written straight into the caches so the
// inbox and a thread opened later show it at once, instead of after the next
// round trip (owner reports: the inbox only caught up after a visible
// refresh on coming back from a chat; a group thread reopened soon after
// could miss messages that the inbox preview already showed). The callers
// still invalidate, so the server's answer settles anything guessed here.

// The inbox row: newest message, moved to the top, one more unread when it
// is someone else's and that chat is not the one on screen. A row seen twice
// (the thread's listener and the inbox's both deliver it) changes nothing
// the second time.
export function patchChatPreview(qc: QueryClient, row: MessageRow, me: string | undefined, onScreenChatId?: string | null) {
  if (!row?.chat_id) return;
  qc.setQueryData<ChatListItem[]>(chatKeys.chats(), (list) => {
    if (!list) return list;
    const i = list.findIndex((c) => c.id === row.chat_id);
    if (i === -1) return list; // a new conversation: the refetch brings it
    const chat = list[i];
    const last = chat.last_message;
    if (last && last.created_at === row.created_at && last.from_user_id === row.from_user_id) return list;
    if (last && Date.parse(last.created_at) > Date.parse(row.created_at)) return list;
    const fromOther = !!me && row.from_user_id !== me;
    const bumped: ChatListItem = {
      ...chat,
      last_message: {
        chat_id: row.chat_id,
        text: row.text,
        type: row.type || 'text',
        from_user_id: row.from_user_id,
        created_at: row.created_at,
      },
      unread_count: fromOther && onScreenChatId !== row.chat_id ? (chat.unread_count ?? 0) + 1 : chat.unread_count,
    };
    return [bumped, ...list.slice(0, i), ...list.slice(i + 1)];
  });
}

// A thread already in the cache gets someone else's new message appended,
// so opening it shows the message before its refetch lands. Your own
// messages are left to the thread's optimistic send.
export function appendToCachedThread(qc: QueryClient, row: MessageRow, me: string | undefined) {
  if (!row?.chat_id || !row.id || row.from_user_id === me) return;
  qc.setQueryData<ThreadMessage[]>(chatKeys.messages(row.chat_id), (list) => {
    if (!list || list.some((m) => m.id === row.id)) return list;
    const msg: ThreadMessage = {
      id: row.id,
      type: row.type || 'text',
      text: row.text,
      attachment_url: row.attachment_url,
      from_user_id: row.from_user_id,
      created_at: row.created_at,
      reply_to_id: row.reply_to_id ?? null,
      from: null,
    };
    return [...list, msg];
  });
}
