import { type InfiniteData, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { follow, unfollow } from '@/api/profiles';
import type { Video } from '@/api/types';
import { type FeedTab, fetchFeed, like, save, unlike, unsave, videoKeys } from '@/api/videos';

const PAGE = 20;

// One page per fetch, offset paging like the web app. The first page paints
// from cache when you come back to the feed and refreshes behind it.
export function useFeed(tab: FeedTab) {
  return useInfiniteQuery({
    queryKey: videoKeys.feed(tab),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchFeed({ tab, limit: PAGE, offset: pageParam }),
    getNextPageParam: (last, pages) => (last.length < PAGE ? undefined : pages.length * PAGE),
    staleTime: 30_000,
    // For You is built per session on the server (0108): a background
    // refetch of page 0 would start a new session and reshuffle the feed
    // under the viewer. It refreshes on pull-to-refresh only.
    refetchOnWindowFocus: tab !== 'foryou',
    refetchOnMount: tab !== 'foryou',
  });
}

type FeedData = InfiniteData<Video[], number>;

// Applies a change to one video everywhere it appears in the cached feeds,
// so a like on For You also shows on Following.
function patchVideo(qc: ReturnType<typeof useQueryClient>, id: string, patch: (v: Video) => Video) {
  for (const tab of ['foryou', 'following'] as const) {
    qc.setQueryData<FeedData>(videoKeys.feed(tab), (data) =>
      data ? { ...data, pages: data.pages.map((p) => p.map((v) => (v.id === id ? patch(v) : v))) } : data,
    );
  }
}

function patchCreator(qc: ReturnType<typeof useQueryClient>, userId: string, following: boolean) {
  for (const tab of ['foryou', 'following'] as const) {
    qc.setQueryData<FeedData>(videoKeys.feed(tab), (data) =>
      data
        ? { ...data, pages: data.pages.map((p) => p.map((v) => (v.user?.id === userId ? { ...v, following } : v))) }
        : data,
    );
  }
}

// Optimistic: the heart fills on tap and rolls back if the server refuses.
export function useToggleLike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) => (next ? like(id) : unlike(id)),
    onMutate: ({ id, next }) =>
      patchVideo(qc, id, (v) => ({ ...v, liked: next, likes_count: Math.max(0, v.likes_count + (next ? 1 : -1)) })),
    onError: (_e, { id, next }) =>
      patchVideo(qc, id, (v) => ({ ...v, liked: !next, likes_count: Math.max(0, v.likes_count + (next ? -1 : 1)) })),
  });
}

export function useToggleSave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) => (next ? save(id) : unsave(id)),
    onMutate: ({ id, next }) =>
      patchVideo(qc, id, (v) => ({ ...v, saved: next, saves_count: Math.max(0, v.saves_count + (next ? 1 : -1)) })),
    onError: (_e, { id, next }) =>
      patchVideo(qc, id, (v) => ({ ...v, saved: !next, saves_count: Math.max(0, v.saves_count + (next ? -1 : 1)) })),
    onSuccess: () => qc.invalidateQueries({ queryKey: videoKeys.saved() }),
  });
}

// A private account answers a follow with a request, so the button only
// switches to "following" when the server says so.
export function useToggleFollow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, next }: { userId: string; next: boolean }) =>
      next ? follow(userId) : (await unfollow(userId), 'none' as const),
    onSuccess: (result, { userId }) => {
      patchCreator(qc, userId, result === 'following');
      qc.invalidateQueries({ queryKey: videoKeys.feed('following') });
    },
  });
}
