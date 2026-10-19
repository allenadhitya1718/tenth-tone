import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import type { Video } from '@/api/types';
import { videoKeys } from '@/api/videos';

type FeedData = InfiniteData<Video[], number>;

const TABS = ['foryou', 'following'] as const;

// Applies a change to one video in every cached feed and in its single-video
// cache, so a count shown in the rail is never behind what just happened.
export function patchVideoEverywhere(qc: QueryClient, id: string, patch: (v: Video) => Video) {
  for (const tab of TABS) {
    qc.setQueryData<FeedData>(videoKeys.feed(tab), (data) =>
      data ? { ...data, pages: data.pages.map((p) => p.map((v) => (v.id === id ? patch(v) : v))) } : data,
    );
  }
  qc.setQueryData<Video | null>(videoKeys.video(id), (v) => (v ? patch(v) : v));
}

// Drops everything a person posted from the cached feeds (used on block).
export function removeCreatorFromFeeds(qc: QueryClient, userId: string) {
  for (const tab of TABS) {
    qc.setQueryData<FeedData>(videoKeys.feed(tab), (data) =>
      data ? { ...data, pages: data.pages.map((p) => p.filter((v) => v.user?.id !== userId)) } : data,
    );
  }
}
