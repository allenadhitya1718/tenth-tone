import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { supabase } from '@/api/client';
import { profileKeys } from '@/api/profiles';

// The person I asked to follow answered (approved or declined): the request
// row of mine is deleted, so the profile and follow buttons I have cached
// ("Requested") must be re-read without reopening the screen. Needs
// follow_requests in the realtime publication (0141); without it the
// 15 s refetch on the buttons is the fallback. Mount once while signed in.
export function useFollowRequestSync(me: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!me) return;
    const channel = supabase
      .channel('follow-requests:' + me + ':' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'follow_requests' }, (payload) => {
        const old = payload.old as { requester_id?: string; target_id?: string } | null;
        // Without replica identity the old row may hold only its key: then
        // refresh every cached request state rather than none.
        if (old?.requester_id && old.requester_id !== me) {
          // Someone's request to me went away: my requests list changes.
          void qc.invalidateQueries({ queryKey: profileKeys.followRequests() });
          return;
        }
        const target = old?.target_id;
        if (target) {
          void qc.invalidateQueries({ queryKey: profileKeys.hasRequestedFollow(target) });
          void qc.invalidateQueries({ queryKey: profileKeys.isFollowing(target) });
          void qc.invalidateQueries({ queryKey: profileKeys.profile(target) });
        } else {
          void qc.invalidateQueries({ queryKey: ['followRequest'] });
          void qc.invalidateQueries({ queryKey: ['isFollowing'] });
        }
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [me, qc]);
}
