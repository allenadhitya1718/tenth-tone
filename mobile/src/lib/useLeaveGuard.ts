import { usePreventRemove } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { showAlert } from '@/components/Dialog';

// Asks before a screen closes while it holds unsaved work, whichever way the
// person leaves: the top arrow, Android's Back or the iOS swipe (phone test,
// 19 Nov 2026: Back threw an edited voice clip cover away without a word).
// Pass active = false while posting, so the post's own navigation goes
// through. A confirmed Discard goes through without asking again.
export function useLeaveGuard(active: boolean, title: string, body: string, discardLabel: string, onDiscard?: () => void) {
  const { t } = useTranslation();
  const [discarded, setDiscarded] = useState(false);
  usePreventRemove(active && !discarded, ({ repeat }) => {
    showAlert(title, body, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: discardLabel,
        style: 'destructive',
        onPress: () => {
          onDiscard?.();
          setDiscarded(true);
          repeat();
        },
      },
    ]);
  });
}
