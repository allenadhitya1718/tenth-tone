import { useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';

import {
  type ChatInfo,
  chatKeys,
  fetchMessages,
  fetchReceipts,
  markChatDelivered,
  markChatRead,
  type Message,
  type MessageRow,
  type MessageType,
  type Receipt,
  type ReplyTarget,
  sendMessage,
  subscribeToMessageChanges,
  subscribeToMessages,
  subscribeToReceipts,
  toggleMessageReaction,
  deleteMessage,
} from '@/api/chat';
import type { LocalMedia } from '@/api/upload';

// A message as this screen holds it. localId is set on bubbles this device
// drew optimistically and stays as the list key after the real id arrives,
// so the row is not remounted (an image would flash) when the send lands.
export type ThreadMessage = Message & { localId?: string; pending?: boolean };

const isLocal = (id: string) => id.startsWith('local-');
let localSeq = 0;

function toReplyTarget(m: Message): ReplyTarget {
  return {
    id: m.id,
    type: m.type,
    text: m.text,
    attachment_url: m.attachment_url,
    from_user_id: m.from_user_id,
    from: m.from ? { id: m.from.id, name: m.from.name } : null,
  };
}

// Everything the thread needs from the server: the messages (with realtime
// inserts and optimistic sends folded in), the other members' receipts for
// the ticks, and the read/delivered stamps that drive the other side's ticks.
export function useThread(chatId: string, me: string | undefined, info: ChatInfo | undefined) {
  const qc = useQueryClient();
  const key = useMemo(() => chatKeys.messages(chatId), [chatId]);

  // A refetch (pull, foreground, reconnect) replaces the list; sends still in
  // flight are kept on the end so their bubbles do not vanish mid-send.
  const messages = useQuery({
    queryKey: key,
    queryFn: async () => {
      const fresh = (await fetchMessages(chatId)) as ThreadMessage[];
      const prev = qc.getQueryData<ThreadMessage[]>(key) ?? [];
      const ids = new Set(fresh.map((m) => m.id));
      const pending = prev.filter((m) => m.pending && !ids.has(m.id));
      return pending.length ? [...fresh, ...pending] : fresh;
    },
    enabled: !!chatId,
  });

  const receipts = useQuery({
    queryKey: chatKeys.receipts(chatId),
    queryFn: () => fetchReceipts(chatId),
    enabled: !!chatId,
  });

  // The author of a realtime row is only an id; the header already knows
  // everyone in the chat. Read through a ref so the subscription is not
  // rebuilt whenever the info query refreshes.
  const infoRef = useRef(info);
  useEffect(() => {
    infoRef.current = info;
  }, [info]);

  const markRead = useCallback(() => {
    void markChatRead(chatId).then(() => {
      void qc.invalidateQueries({ queryKey: chatKeys.chats(), exact: true });
      void qc.invalidateQueries({ queryKey: chatKeys.unreadCount() });
    });
  }, [chatId, qc]);

  // Opening the thread means everything in it has been delivered and read.
  useEffect(() => {
    if (!chatId) return;
    void markChatDelivered(chatId);
    markRead();
  }, [chatId, markRead]);

  // Without 0099 the receipts never stream, so focus is the other trigger.
  useFocusEffect(
    useCallback(() => {
      void qc.invalidateQueries({ queryKey: chatKeys.receipts(chatId) });
    }, [chatId, qc]),
  );

  // Back from the background: catch up on anything the socket missed.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      void markChatDelivered(chatId);
      markRead();
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: chatKeys.receipts(chatId) });
    });
    return () => sub.remove();
  }, [chatId, key, markRead, qc]);

  useEffect(() => {
    if (!chatId || !me) return;
    const unsub = subscribeToMessages(chatId, (row: MessageRow) => {
      let fromOther = false;
      qc.setQueryData<ThreadMessage[]>(key, (list = []) => {
        if (list.some((m) => m.id === row.id)) return list;
        const type = row.type || 'text';
        const text = row.text || '';
        if (row.from_user_id === me) {
          // The echo of our own optimistic bubble adopts it instead of
          // drawing the message twice.
          const i = list.findIndex((m) => m.pending && isLocal(m.id) && m.type === type && (m.text || '') === text);
          if (i !== -1) {
            const next = list.slice();
            next[i] = { ...next[i], id: row.id, created_at: row.created_at, pending: false };
            return next;
          }
        } else {
          fromOther = true;
        }
        // A live insert has reply_to_id but not the joined parent; the parent
        // is nearly always on screen already.
        const parent = row.reply_to_id ? list.find((m) => m.id === row.reply_to_id) : undefined;
        const author =
          row.from_user_id === me ? null : infoRef.current?.others.find((o) => o.id === row.from_user_id) ?? null;
        const msg: ThreadMessage = {
          id: row.id,
          type,
          text: row.text,
          attachment_url: row.attachment_url,
          from_user_id: row.from_user_id,
          created_at: row.created_at,
          reply_to_id: row.reply_to_id ?? null,
          reply_to: parent ? toReplyTarget(parent) : null,
          reactions: [],
          from: author ? { id: author.id, name: author.name, avatar_url: author.avatar_url } : null,
        };
        return [...list, msg];
      });
      if (fromOther) markRead();
      void qc.invalidateQueries({ queryKey: chatKeys.chats(), exact: true });
    });
    return unsub;
  }, [chatId, key, me, qc, markRead]);

  // The other side reacted or deleted a message: patch the list at once.
  // A deletion only names the id; a reaction event may name no message at all
  // (a delete without replica identity), so then the list is refetched.
  useEffect(() => {
    if (!chatId || !me) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refetch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void qc.invalidateQueries({ queryKey: key }), 250);
    };
    const unsub = subscribeToMessageChanges(
      (id) => {
        const list = qc.getQueryData<ThreadMessage[]>(key);
        if (!list?.some((m) => m.id === id)) return;
        qc.setQueryData<ThreadMessage[]>(key, (cur = []) => cur.filter((m) => m.id !== id));
        void qc.invalidateQueries({ queryKey: chatKeys.chats(), exact: true });
      },
      (id) => {
        const list = qc.getQueryData<ThreadMessage[]>(key);
        if (id && !list?.some((m) => m.id === id)) return;
        refetch();
      },
    );
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [chatId, key, me, qc]);

  useEffect(() => {
    if (!chatId) return;
    return subscribeToReceipts(chatId, (r: Receipt) => {
      qc.setQueryData<Receipt[]>(chatKeys.receipts(chatId), (list = []) => {
        const rest = list.filter((x) => x.user_id !== r.user_id);
        return [...rest, r];
      });
    });
  }, [chatId, qc]);

  // Optimistic send. The bubble is registered BEFORE the network call: the
  // realtime echo can arrive before sendMessage resolves (see api/chat.ts).
  // Resolves false on failure, after taking the bubble back.
  const send = useCallback(
    async (input: {
      text: string;
      type?: MessageType;
      media?: LocalMedia | null;
      attachmentUrl?: string | null;
      replyTo?: Message | null;
    }) => {
      if (!me) return false;
      const type = input.type ?? 'text';
      const localId = `local-${Date.now()}-${++localSeq}`;
      const optimistic: ThreadMessage = {
        id: localId,
        localId,
        pending: true,
        type,
        text: input.text,
        attachment_url: input.media?.uri ?? input.attachmentUrl ?? null,
        from_user_id: me,
        created_at: new Date().toISOString(),
        reply_to_id: input.replyTo?.id ?? null,
        reply_to: input.replyTo ? toReplyTarget(input.replyTo) : null,
        reactions: [],
        from: null,
      };
      qc.setQueryData<ThreadMessage[]>(key, (list = []) => [...list, optimistic]);
      try {
        const row = await sendMessage({
          chatId,
          text: input.text,
          type,
          media: input.media ?? null,
          attachmentUrl: input.attachmentUrl ?? null,
          replyToId: input.replyTo?.id ?? null,
        });
        qc.setQueryData<ThreadMessage[]>(key, (list = []) => {
          const i = list.findIndex((m) => m.localId === localId);
          if (i === -1) return list;
          // The echo got in first as a separate row: drop the duplicate.
          if (list.some((m, j) => j !== i && m.id === row.id)) return list.filter((_, j) => j !== i);
          const next = list.slice();
          // The local file stays as the source for this session: swapping to
          // the signed URL would reload an image that is already on screen.
          next[i] = { ...next[i], id: row.id, created_at: row.created_at, pending: false };
          return next;
        });
        void qc.invalidateQueries({ queryKey: chatKeys.chats(), exact: true });
        return true;
      } catch (e) {
        qc.setQueryData<ThreadMessage[]>(key, (list = []) => list.filter((m) => m.localId !== localId));
        throw e;
      }
    },
    [chatId, key, me, qc],
  );

  // Optimistic: your reaction replaces any earlier one; the same emoji again
  // clears it. Rolled back when the server refuses.
  const react = useCallback(
    async (messageId: string, emoji: string) => {
      if (!me || isLocal(messageId)) return;
      const before = qc.getQueryData<ThreadMessage[]>(key);
      qc.setQueryData<ThreadMessage[]>(key, (list = []) =>
        list.map((m) => {
          if (m.id !== messageId) return m;
          const all = m.reactions ?? [];
          const mine = all.find((r) => r.user_id === me);
          const rest = all.filter((r) => r.user_id !== me);
          return { ...m, reactions: mine?.emoji === emoji ? rest : [...rest, { user_id: me, emoji }] };
        }),
      );
      try {
        await toggleMessageReaction(messageId, emoji);
      } catch (e) {
        qc.setQueryData(key, before);
        throw e;
      }
    },
    [key, me, qc],
  );

  const remove = useCallback(
    async (messageId: string) => {
      const before = qc.getQueryData<ThreadMessage[]>(key);
      qc.setQueryData<ThreadMessage[]>(key, (list = []) => list.filter((m) => m.id !== messageId));
      try {
        await deleteMessage(messageId);
        void qc.invalidateQueries({ queryKey: chatKeys.chats(), exact: true });
      } catch (e) {
        qc.setQueryData(key, before);
        throw e;
      }
    },
    [key, qc],
  );

  return { messages, receipts, send, react, remove };
}
