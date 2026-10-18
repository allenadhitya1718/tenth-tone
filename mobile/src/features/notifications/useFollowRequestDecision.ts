import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { approveFollowRequest, declineFollowRequest, type FollowRequest, profileKeys } from '@/api/profiles';
import { useAuth } from '@/providers/AuthProvider';

export type Decision = 'approve' | 'decline';

// Approve or decline one follow request. Used by the requests screen and
// inline on a notification row, so both keep the same cache in step.
export function useFollowRequestDecision(requesterId: string) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { session } = useAuth();
  const me = session?.user.id;

  return useMutation({
    mutationFn: (d: Decision) => (d === 'approve' ? approveFollowRequest(requesterId) : declineFollowRequest(requesterId)),
    onSuccess: (_r, d) => {
      qc.setQueryData<FollowRequest[]>(profileKeys.followRequests(), (list) => list?.filter((r) => r.id !== requesterId));
      void qc.invalidateQueries({ queryKey: profileKeys.followRequestCount() });
      if (d === 'approve' && me) {
        // They now follow you: your count and your followers list changed.
        void qc.invalidateQueries({ queryKey: profileKeys.profile(me) });
        void qc.invalidateQueries({ queryKey: profileKeys.followers(me) });
      }
    },
    onError: () => {
      Alert.alert(t('discover.requests.failed'));
      // It may have been handled on another device; show the real state.
      void qc.invalidateQueries({ queryKey: profileKeys.followRequests() });
    },
  });
}
