import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import {
  isMuted,
  isRestricted,
  muteUser,
  restrictUser,
  safetyKeys,
  unmuteUser,
  unrestrictUser,
} from '@/api/safety';
import { showAlert } from '@/components/Dialog';
import { removeCreatorFromFeeds } from '@/features/feed/cache';

// Mute and restrict for someone else's profile menu. Each toggle explains
// what it does and asks first; once applied, the menu offers the opposite
// (Unmute / Unrestrict). Caches touched: the per-person flag, the Settings
// lists (Muted accounts / Restricted accounts), the feeds (muted people's
// videos leave them) and open comment threads (restricted people's comments
// are only shown to them).
export function useMuteRestrict(userId: string, enabled: boolean) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const muted = useQuery({ queryKey: safetyKeys.isMuted(userId), queryFn: () => isMuted(userId), enabled });
  const restricted = useQuery({
    queryKey: safetyKeys.isRestricted(userId),
    queryFn: () => isRestricted(userId),
    enabled,
  });

  function refresh(kind: 'muted' | 'restricted', now: boolean) {
    const flagKey = kind === 'muted' ? safetyKeys.isMuted(userId) : safetyKeys.isRestricted(userId);
    qc.setQueryData(flagKey, now);
    // ['muted'] / ['restricted'] cover both the Settings list and the flag.
    void qc.invalidateQueries({ queryKey: [kind] });
    if (kind === 'muted') {
      if (now) removeCreatorFromFeeds(qc, userId);
      void qc.invalidateQueries({ queryKey: ['feed'] });
    } else {
      void qc.invalidateQueries({ queryKey: ['comments'] });
      void qc.invalidateQueries({ queryKey: ['chats'] });
    }
  }

  function ask(kind: 'muted' | 'restricted', name: string): Promise<boolean> {
    const on = kind === 'muted' ? muted.data === true : restricted.data === true;
    const p = kind === 'muted' ? 'polish.mute' : 'polish.restrict';
    const verb = on ? 'off' : 'on';
    return new Promise((resolve) => {
      showAlert(
        t(`${p}.${verb}Title`, { name }),
        t(`${p}.${verb}Body`),
        [
          { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
          {
            text: t(`${p}.${verb}Confirm`),
            onPress: async () => {
              try {
                if (kind === 'muted') await (on ? unmuteUser(userId) : muteUser(userId));
                else await (on ? unrestrictUser(userId) : restrictUser(userId));
                refresh(kind, !on);
                showAlert(t(`${p}.${verb}Done`, { name }));
                resolve(true);
              } catch {
                showAlert(t(`${p}.failed`));
                resolve(false);
              }
            },
          },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
  }

  return {
    isMuted: muted.data === true,
    isRestricted: restricted.data === true,
    toggleMute: (name: string) => ask('muted', name),
    toggleRestrict: (name: string) => ask('restricted', name),
  };
}
