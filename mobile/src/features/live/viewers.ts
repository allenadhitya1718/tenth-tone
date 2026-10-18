// TEMPORARY: belongs in src/api/live.ts (see the snippet in the hand-off
// notes). Kept here so the host's viewer list works before that lands; delete
// this file and import fetchLiveViewers from '@/api/live' once it does.
//
// Who is watching a stream, for the host's viewer list and invites. Port of
// openViewerList in web/js/views.js: live_viewers (0048) is readable by any
// signed-in user so that a host can list who is watching. Two queries rather
// than an embed, as the web app does: the embed depends on a foreign-key name.
import { supabase } from '@/api/client';
import type { UserSummary, Uuid } from '@/api/types';

export const liveViewersKey = (liveId: string) => ['live', liveId, 'viewers'] as const;

export async function fetchLiveViewers(liveId: Uuid, limit = 200): Promise<UserSummary[]> {
  const { data: rows, error } = await supabase
    .from('live_viewers')
    .select('user_id')
    .eq('live_id', liveId)
    .limit(limit);
  if (error) throw error;
  const ids = ((rows ?? []) as { user_id: Uuid | null }[]).map((r) => r.user_id).filter((x): x is Uuid => !!x);
  if (!ids.length) return [];
  const { data: profs, error: e2 } = await supabase
    .from('profiles')
    .select('id, name, handle, avatar_url, verified')
    .in('id', ids);
  if (e2) throw e2;
  return (profs ?? []) as UserSummary[];
}
