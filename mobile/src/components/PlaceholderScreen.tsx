import { useTranslation } from 'react-i18next';

import { AppText, Screen, TopBar } from './ui';

// A pushed screen that a later Phase 3 batch fills in.
export function PlaceholderScreen({ title }: { title: string }) {
  const { t } = useTranslation();
  return (
    <Screen header={<TopBar title={title} />}>
      <AppText muted center style={{ marginTop: 60 }}>
        {t('placeholder.later')}
      </AppText>
    </Screen>
  );
}
