import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import type { Comment } from '@/api/comments';
import { profileKeys } from '@/api/profiles';
import { blockUser, safetyKeys } from '@/api/safety';
import { removeCreatorFromFeeds } from '@/features/feed/cache';

// Asks first, then blocks and hides the person's content straight away: their
// videos leave the cached feeds, their comments leave every open thread, and
// the Blocked accounts list is refetched. Resolves true when the block went
// through.
export function useBlock() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  function hide(userId: string) {
    removeCreatorFromFeeds(qc, userId);
    qc.setQueriesData<Comment[]>({ queryKey: ['comments'] }, (list) =>
      Array.isArray(list) ? list.filter((c) => (c.user_id ?? c.user?.id) !== userId) : list,
    );
    void qc.invalidateQueries({ queryKey: safetyKeys.blocked() });
    void qc.invalidateQueries({ queryKey: ['feed'] });
    void qc.invalidateQueries({ queryKey: ['userVideos', userId] });
    void qc.invalidateQueries({ queryKey: ['followers'] });
    void qc.invalidateQueries({ queryKey: ['following'] });
    void qc.invalidateQueries({ queryKey: ['isFollowing'] });
    void qc.invalidateQueries({ queryKey: profileKeys.all });
  }

  return function confirmBlock(userId: string, name: string): Promise<boolean> {
    return new Promise((resolve) => {
      Alert.alert(t('ugc.blockTitle', { name }), t('ugc.blockBody'), [
        { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
        {
          text: t('ugc.blockConfirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              await blockUser(userId);
              hide(userId);
              Alert.alert(t('ugc.blockedToast', { name }));
              resolve(true);
            } catch {
              Alert.alert(t('ugc.blockFailed'));
              resolve(false);
            }
          },
        },
      ], { cancelable: true, onDismiss: () => resolve(false) });
    });
  };
}
