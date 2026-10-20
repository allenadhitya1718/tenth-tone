import { type InfiniteData, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { profileKeys } from '@/api/profiles';
import type { Video } from '@/api/types';
import { deleteVideo, videoKeys, type VideoTile } from '@/api/videos';
import { showAlert } from '@/components/Dialog';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/providers/AuthProvider';

type FeedData = InfiniteData<Video[], number>;

// Videos deleted in this session. A pinned clip (opened from a profile grid,
// a notification or a link) that was just deleted must not turn into the
// "Video not found" page: FeedList drops such a pin and shows the feed.
const deletedIds = new Set<string>();
export const wasDeletedHere = (id: string) => deletedIds.has(id);

// "Delete video" for the owner's own posts: confirm, delete (row + R2 media,
// see deleteVideo), then take it out of every cache that shows it. Returns
// the confirm function plus the id currently being deleted (loading state).
export function useDeleteVideo(onDeleted?: (id: string) => void) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { session } = useAuth();
  const me = session?.user.id;
  const [busyId, setBusyId] = useState<string | null>(null);
  const inFlight = useRef(false);

  const run = useCallback(
    async (id: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusyId(id);
      try {
        await deleteVideo(id);
        deletedIds.add(id);
        for (const tab of ['foryou', 'following'] as const) {
          qc.setQueryData<FeedData>(videoKeys.feed(tab), (data) =>
            data ? { ...data, pages: data.pages.map((p) => p.filter((v) => v.id !== id)) } : data,
          );
        }
        if (me) {
          qc.setQueryData<VideoTile[]>(videoKeys.userVideos(me), (rows) => rows?.filter((v) => v.id !== id));
          void qc.invalidateQueries({ queryKey: videoKeys.userVideos(me) });
          void qc.invalidateQueries({ queryKey: profileKeys.profile(me) });
        }
        qc.removeQueries({ queryKey: videoKeys.video(id) });
        void qc.invalidateQueries({ queryKey: videoKeys.saved() });
        void qc.invalidateQueries({ queryKey: videoKeys.archived() });
        void qc.invalidateQueries({ queryKey: videoKeys.myContentCounts() });
        void qc.invalidateQueries({ queryKey: videoKeys.myLiked() });
        void qc.invalidateQueries({ queryKey: ['feed'] });
        showToast(t('fix4.videoDeleted'), 'trash');
        onDeleted?.(id);
      } catch {
        showAlert(t('fix4.deleteVideoFailed'));
      } finally {
        inFlight.current = false;
        setBusyId(null);
      }
    },
    [me, onDeleted, qc, t],
  );

  const confirm = useCallback(
    (id: string) => {
      if (inFlight.current) return;
      showAlert(t('fix4.deleteVideoTitle'), t('fix4.deleteVideoBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('fix4.deleteVideo'), style: 'destructive', onPress: () => void run(id) },
      ]);
    },
    [run, t],
  );

  return { confirm, busyId };
}
