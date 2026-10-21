import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { AppState } from 'react-native';

import {
  fetchFriendLocations,
  fetchTrackedLocations,
  liveNote,
  locationKeys,
  subscribeToFriendLocations,
  type FriendLocation,
  type TrackedLocation,
  type UserLocationRow,
} from '@/api/location';

export type Pin = {
  id: string;
  name: string;
  handle: string | null;
  avatar: string | null;
  latitude: number;
  longitude: number;
  updatedAt: string;
  // Visible through an approved permit rather than (only) follow sharing.
  tracked: boolean;
  // 0154: their note ("At the beach, come join!"), for a day after it was set.
  note: string | null;
};

const STALE_MS = 60 * 60 * 1000;
export const isStale = (p: Pin, now: number) => now - new Date(p.updatedAt).getTime() > STALE_MS;

type Row = { user_id: string; lat: number | null; lng: number | null; updated_at: string; note?: string | null; note_at?: string | null };

// Applies one realtime row to a cached list straight away, so a followed
// friend's pin moves without waiting for a refetch. A row whose coordinates
// were blanked (sharing stopped) disappears at once.
function patch<T extends Row>(list: T[] | undefined, row: Partial<UserLocationRow>): T[] | undefined {
  if (!list || !row.user_id) return list;
  if (row.lat == null || row.lng == null) return list.filter((r) => r.user_id !== row.user_id);
  return list.map((r) =>
    r.user_id === row.user_id
      ? {
          ...r,
          lat: row.lat!,
          lng: row.lng!,
          updated_at: row.updated_at ?? r.updated_at,
          // Present only once 0154 is applied; a note change moves nothing.
          ...('note' in row ? { note: row.note ?? null, note_at: row.note_at ?? null } : null),
        }
      : r,
  );
}

// Friends sharing with me plus people whose permit I hold, live while the
// map is on screen. `live` gates the realtime channel and polling.
export function usePins(live: boolean) {
  const qc = useQueryClient();
  const friends = useQuery({
    queryKey: locationKeys.friends(),
    queryFn: fetchFriendLocations,
    refetchInterval: live ? 60_000 : false,
  });
  const tracked = useQuery({
    queryKey: locationKeys.tracked(),
    queryFn: fetchTrackedLocations,
    refetchInterval: live ? 60_000 : false,
  });

  useEffect(() => {
    if (!live) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = subscribeToFriendLocations((payload) => {
      const row = (payload.new ?? {}) as Partial<UserLocationRow>;
      const gone = (payload.old ?? {}) as Partial<UserLocationRow>;
      const changed = row.user_id ? row : { ...gone, lat: null, lng: null };
      qc.setQueryData<FriendLocation[]>(locationKeys.friends(), (old) => patch(old, changed));
      qc.setQueryData<TrackedLocation[]>(locationKeys.tracked(), (old) => patch(old, changed));
      // Someone new starting to share needs their profile: refetch, batched.
      clearTimeout(timer);
      timer = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: locationKeys.friends() });
        void qc.invalidateQueries({ queryKey: locationKeys.tracked() });
      }, 2500);
    });
    // Realtime misses what happened while the app was in the background.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        void qc.invalidateQueries({ queryKey: locationKeys.friends() });
        void qc.invalidateQueries({ queryKey: locationKeys.tracked() });
      }
    });
    return () => {
      clearTimeout(timer);
      unsub();
      sub.remove();
    };
  }, [live, qc]);

  const pins = useMemo<Pin[]>(() => {
    const out = new Map<string, Pin>();
    for (const l of tracked.data ?? []) {
      if (l.lat == null || l.lng == null) continue;
      out.set(l.user_id, {
        id: l.user_id,
        name: l.profiles?.name || l.profiles?.handle || '',
        handle: l.profiles?.handle ?? null,
        avatar: l.profiles?.avatar_url ?? null,
        latitude: l.lat,
        longitude: l.lng,
        updatedAt: l.updated_at,
        tracked: true,
        note: liveNote(l),
      });
    }
    for (const l of friends.data ?? []) {
      if (out.has(l.user_id)) continue;
      out.set(l.user_id, {
        id: l.user_id,
        name: l.profiles?.name || l.profiles?.handle || '',
        handle: l.profiles?.handle ?? null,
        avatar: l.profiles?.avatar_url ?? null,
        latitude: l.lat,
        longitude: l.lng,
        updatedAt: l.updated_at,
        tracked: false,
        note: liveNote(l),
      });
    }
    return [...out.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [friends.data, tracked.data]);

  return {
    pins,
    isLoading: friends.isLoading || tracked.isLoading,
    isError: friends.isError && tracked.isError,
    refetch: () => {
      void friends.refetch();
      void tracked.refetch();
    },
  };
}
