import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import type { Comment } from '@/api/comments';
import { chatKeys } from '@/api/chat';
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
    // Discover's "Suggested for you" and people search: the blocked account
    // leaves the cached lists at once, then everything refetches.
    qc.setQueriesData<{ id?: string }[]>({ queryKey: ['suggestedProfiles'] }, (list) =>
      Array.isArray(list) ? list.filter((p) => p.id !== userId) : list,
    );
    for (const k of ['suggestedProfiles', 'popularVideos', 'search', 'shareTargets', 'followRequests']) {
      void qc.invalidateQueries({ queryKey: [k] });
    }
    // The inbox hides a blocked person's name; their chat row changes too.
    void qc.invalidateQueries({ queryKey: chatKeys.chats() });
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
