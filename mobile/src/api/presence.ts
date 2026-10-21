// Activity status (0152_activity_status.sql): "Active now" / "Last seen".
// touch_presence records that this person is using the app (at most one
// write per 30 s server-side); get_presence answers only for people who
// share a chat with you, both of you showing your activity, no block.
import { supabase } from './client';
import type { Iso, Uuid } from './types';

export const presenceKeys = {
  user: (userId: Uuid) => ['presence', userId] as const,
};

// Never throws: a lost heartbeat only makes "last seen" a minute older.
export async function touchPresence(): Promise<void> {
  try {
    await supabase.rpc('touch_presence');
  } catch {}
}

// The person's last activity, or null when it is not shown to you (their
// choice or yours, no shared chat, a block) or before 0152.
export async function fetchPresence(userId: Uuid): Promise<Iso | null> {
  const { data, error } = await supabase.rpc('get_presence', { p_user_ids: [userId] });
  if (error) return null;
  const row = (data as { user_id: Uuid; last_active_at: Iso }[] | null)?.[0];
  return row?.last_active_at ?? null;
}
