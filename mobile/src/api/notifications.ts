// The activity feed and its bell badge. Port of the Notifications section
// of web/js/db.js.
//
// ApiError codes thrown here: none. Failures surface as PostgrestError from
// fetchNotifications / markNotificationsRead; countUnreadNotifications never
// throws.
import { supabase, uid } from './client';
import type { Iso, Uuid } from './types';

export const notificationKeys = {
  all: ['notifications'] as const,
  list: () => ['notifications', 'list'] as const,
  unreadCount: () => ['notifications', 'unreadCount'] as const,
};

// Activity, not messages: a DM already announces itself in the inbox with
// its own unread mark, and repeating it here buried the one-off events under
// chatter (Instagram draws the same line). 'live' is a one-off event and
// belongs. 'follow_request' was once missing from this list, so every
// request was written (0053) but never fetched or counted.
export const ACTIVITY_TYPES = ['like', 'comment', 'follow', 'mention', 'system', 'live', 'follow_request', 'gift'] as const;

export type NotificationType = (typeof ACTIVITY_TYPES)[number];

export type Notification = {
  id: Uuid;
  type: NotificationType;
  payload: Record<string, unknown> | null;
  read_at: Iso | null;
  created_at: Iso;
  actor: { id: Uuid; name: string | null; avatar_url: string | null } | null;
};

// Ring rows (notify_on_call, 0093) exist only to carry the push; in the list
// they read as a nameless update and counted on the bell. Shared by the list
// and the count so the badge never counts rows the screen does not show.
const NOT_A_RING = 'payload->>kind.is.null,payload->>kind.neq.incoming_call';

export async function fetchNotifications(): Promise<Notification[]> {
  const me = await uid();
  if (!me) return [];
  const { data, error } = await supabase
    .from('notifications')
    .select(
      `
      id, type, payload, read_at, created_at,
      actor:profiles!notifications_actor_id_fkey ( id, name, avatar_url )
    `,
    )
    .eq('user_id', me)
    .in('type', ACTIVITY_TYPES)
    .or(NOT_A_RING)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as unknown as Notification[];
}

// Marks the given notifications read, or all unread ones when no ids are
// passed. Returns how many changed. (Nothing used to set read_at, so the
// badge could only ever grow.)
export async function markNotificationsRead(ids?: Uuid[] | null): Promise<number> {
  const me = await uid();
  if (!me) return 0;
  let q = supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', me)
    .is('read_at', null);
  if (Array.isArray(ids) && ids.length) q = q.in('id', ids);
  const { data, error } = await q.select('id');
  if (error) throw error;
  return (data ?? []).length;
}

// Same filter as fetchNotifications, or the bell would count rows the
// screen does not show: a badge you cannot clear by opening it.
export async function countUnreadNotifications(): Promise<number> {
  const me = await uid();
  if (!me) return 0;
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', me)
    .in('type', ACTIVITY_TYPES)
    .or(NOT_A_RING)
    .is('read_at', null);
  if (error) return 0;
  return count || 0;
}
