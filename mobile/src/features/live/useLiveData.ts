import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  fetchLiveComments,
  fetchLiveGuests,
  fetchLiveStream,
  liveKeys,
  subscribeToLiveComments,
  subscribeToLiveGuests,
  subscribeToLiveStream,
  type LiveComment,
  type LiveGuest,
  type LiveStream,
} from '@/api/live';
import { fetchProfile, profileKeys } from '@/api/profiles';
import type { UserSummary, Uuid } from '@/api/types';

import { MAX_COMMENTS_SHOWN } from './config';

// Looks a person up by id through the shared profile cache, for realtime rows
// that arrive with only a user id (comments, guests, gifts).
export function useProfileLookup() {
  const qc = useQueryClient();
  return useCallback(
    async (id: Uuid): Promise<UserSummary | null> => {
      try {
        const p = await qc.fetchQuery({
          queryKey: profileKeys.profile(id),
          queryFn: () => fetchProfile(id),
          staleTime: 5 * 60_000,
        });
        return p ? { id: p.id, name: p.name, handle: p.handle, avatar_url: p.avatar_url, verified: p.verified } : null;
      } catch {
        return null;
      }
    },
    [qc],
  );
}

// The stream row, kept current by realtime: the viewer count moves and the
// room learns when the host ends the broadcast. Tracks the peak for the
// host's summary.
export function useLiveStreamRow(liveId: Uuid) {
  const qc = useQueryClient();
  const key = liveKeys.stream(liveId);
  const q = useQuery({ queryKey: key, queryFn: () => fetchLiveStream(liveId), staleTime: 10_000 });
  const [peak, setPeak] = useState(0);
  const loaded = !!q.data;
  // The most listeners seen, for the host's summary. Adjusted during render
  // (React's pattern for state derived from a changing value).
  const count = q.data?.viewer_count ?? 0;
  if (count > peak) setPeak(count);

  useEffect(() => {
    if (!loaded) return;
    return subscribeToLiveStream(liveId, (row) => {
      qc.setQueryData<LiveStream | null>(liveKeys.stream(liveId), (old) =>
        old
          ? {
              ...old,
              viewer_count: typeof row.viewer_count === 'number' ? row.viewer_count : old.viewer_count,
              status: row.status ?? old.status,
              ended_at: row.ended_at ?? old.ended_at,
            }
          : old,
      );
    });
  }, [liveId, loaded, qc]);

  const setViewerCount = useCallback(
    (n: number) =>
      qc.setQueryData<LiveStream | null>(liveKeys.stream(liveId), (old) => (old ? { ...old, viewer_count: n } : old)),
    [liveId, qc],
  );

  return { ...q, peak, setViewerCount };
}

// Every live_guests row of the stream (0103), kept current by realtime. A row
// for someone not yet in the list is fetched with its profile by refetching.
export function useLiveGuests(liveId: Uuid, enabled: boolean) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: liveKeys.guests(liveId),
    queryFn: () => fetchLiveGuests(liveId),
    enabled,
    // 'live_guests_unavailable' (0103 not applied) will not fix itself.
    retry: false,
  });
  const ok = enabled && q.isSuccess;

  useEffect(() => {
    if (!ok) return;
    return subscribeToLiveGuests(liveId, (row) => {
      const list = qc.getQueryData<LiveGuest[]>(liveKeys.guests(liveId)) ?? [];
      if (list.some((g) => g.user_id === row.user_id)) {
        qc.setQueryData<LiveGuest[]>(liveKeys.guests(liveId), (old) =>
          old?.map((g) => (g.user_id === row.user_id ? { ...g, ...row } : g)),
        );
      } else {
        void qc.invalidateQueries({ queryKey: liveKeys.guests(liveId) });
      }
    });
  }, [liveId, ok, qc]);

  return q;
}

// Live chat: the recent tail, then realtime inserts. Rows arrive without the
// author, who is looked up (and cached) before the line is shown. Lines from
// people this viewer has hidden or blocked are dropped as they arrive.
export function useLiveComments(liveId: Uuid, enabled: boolean, hidden: ReadonlySet<string>) {
  const lookup = useProfileLookup();
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const hiddenRef = useRef(hidden);
  useEffect(() => {
    hiddenRef.current = hidden;
  }, [hidden]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const seen = new Set<string>();
    const add = (c: LiveComment) => {
      if (seen.has(c.id) || (c.user && hiddenRef.current.has(c.user.id))) return;
      seen.add(c.id);
      setComments((list) => [...list, c].slice(-MAX_COMMENTS_SHOWN));
    };

    fetchLiveComments(liveId)
      .then((rows) => {
        if (!active) return;
        rows.forEach(add);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setFailed(true);
        setLoading(false);
      });

    const unsub = subscribeToLiveComments(liveId, (row) => {
      void lookup(row.user_id).then((user) => {
        if (!active) return;
        add({ id: row.id, text: row.text, created_at: row.created_at, user: user ?? { id: row.user_id, name: null, handle: null, avatar_url: null } });
      });
    });
    return () => {
      active = false;
      unsub();
    };
  }, [liveId, enabled, lookup]);

  const remove = useCallback((id: string) => setComments((list) => list.filter((c) => c.id !== id)), []);
  // Someone hidden or blocked just now disappears from what is already shown.
  const visible = useMemo(
    () => (hidden.size ? comments.filter((c) => !c.user || !hidden.has(c.user.id)) : comments),
    [comments, hidden],
  );

  return { comments: visible, loading, failed, remove };
}

// Seconds since the stream started, ticking once a second. Its own hook so
// only the badge that shows it re-renders every second.
export function useElapsed(startedAt: string | null | undefined, running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
}
