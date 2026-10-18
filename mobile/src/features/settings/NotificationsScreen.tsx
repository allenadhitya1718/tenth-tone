import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import type { UserSettings } from '@/api/settings';
import { Screen, TopBar } from '@/components/ui';

import { ErrorView, Group, LoadingView, Note, showError, SwitchRow, type IconName } from './components';
import { useUpdateUserSettings, useUserSettings } from './hooks';

type NotifKey = Extract<keyof UserSettings, `notif_${string}`>;

const ITEMS: { key: NotifKey; icon: IconName }[] = [
  { key: 'notif_likes', icon: 'heart-outline' },
  { key: 'notif_comments', icon: 'chatbubble-outline' },
  { key: 'notif_follows', icon: 'person-add-outline' },
  { key: 'notif_messages', icon: 'mail-outline' },
  { key: 'notif_live', icon: 'radio-outline' },
  { key: 'notif_gifts', icon: 'gift-outline' },
];

export function NotificationsScreen() {
  const { t } = useTranslation();
  const settings = useUserSettings();
  const update = useUpdateUserSettings();

  return (
    <Screen header={<TopBar title={t('settings2.notifications.title')} />} contentStyle={styles.content}>
      <Note>{t('settings2.notifications.note')}</Note>
      {settings.isLoading ? (
        <LoadingView />
      ) : settings.isError || !settings.data ? (
        <ErrorView onRetry={() => settings.refetch()} />
      ) : (
        <Group>
          {ITEMS.map(({ key, icon }) => (
            <SwitchRow
              key={key}
              icon={icon}
              label={t(`settings2.notifications.${key}`)}
              value={settings.data?.[key] !== false}
              onChange={(on) =>
                update.mutate({ [key]: on }, { onError: (e) => showError(t, e, 'settings2.common.updateFailed') })
              }
            />
          ))}
        </Group>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({ content: { paddingHorizontal: 16, paddingBottom: 40 } });
