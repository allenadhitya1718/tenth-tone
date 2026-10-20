import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { MessageRow } from '@/api/chat';
import { listenerTopic, supabase } from '@/api/client';
import { groupQueryKeys } from '@/api/groups';

// Every group change (rename, photo, add, remove, admin, leave) writes a
// 'system' line into the chat (0147), and messages are already in the
// realtime publication. So one listener on this chat's inserts is enough to
// repaint the thread header, the inbox row and the Group Info screen when
// anyone changes the group, without publishing chats / chat_members (whose
// read stamps change on every message).
export function useGroupLive(chatId: string, enabled = true) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || !chatId) return;
    const channel = supabase
      .channel(listenerTopic(`group-live:${chatId}`))
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
        (payload) => {
          if ((payload.new as MessageRow | null)?.type !== 'system') return;
          for (const key of groupQueryKeys(chatId)) void qc.invalidateQueries({ queryKey: key, exact: true });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [chatId, enabled, qc]);
}
