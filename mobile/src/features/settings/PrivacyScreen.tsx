import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { fetchMyLocationSettings, locationKeys } from '@/api/location';
import { profileKeys } from '@/api/profiles';
import { fetchMySettings, setPrivate, settingsKeys, type MySettings, type WhoCan } from '@/api/settings';
import { Screen, TopBar } from '@/components/ui';

import { ErrorView, go, Group, LoadingView, Row, showError, SwitchRow } from './components';
import { useUpdateUserSettings, useUserSettings } from './hooks';

export const WHO_FIELDS = ['message', 'comment', 'tag'] as const;
export type WhoField = (typeof WHO_FIELDS)[number];

export const whoLabelKey = (v: WhoCan) => `settings2.who.${v}`;

export function PrivacyScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: settingsKeys.mySettings(), queryFn: fetchMySettings });
  const settings = useUserSettings();
  const updateSettings = useUpdateUserSettings();
  const location = useQuery({ queryKey: locationKeys.settings(), queryFn: fetchMyLocationSettings });

  const priv = useMutation({
    mutationFn: (on: boolean) => setPrivate(on),
    onMutate: async (on) => {
      await qc.cancelQueries({ queryKey: settingsKeys.mySettings() });
      const prev = qc.getQueryData<MySettings>(settingsKeys.mySettings());
      qc.setQueryData<MySettings>(settingsKeys.mySettings(), { ...(prev ?? {}), is_private: on });
      return { prev };
    },
    onError: (e, _on, ctx) => {
      qc.setQueryData(settingsKeys.mySettings(), ctx?.prev);
      showError(t, e, 'settings2.common.updateFailed');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.mySettings() });
      qc.invalidateQueries({ queryKey: profileKeys.all });
    },
  });

  const loc = location.data;
  const locValue = !loc
    ? undefined
    : !loc.sharing_enabled || loc.visibility === 'none'
      ? t('settings2.location.off')
      : t(loc.visibility === 'public' ? 'settings2.location.public' : 'settings2.location.friends');

  return (
    <Screen header={<TopBar title={t('settings2.privacy.title')} />} contentStyle={styles.content}>
      {me.isLoading ? (
        <LoadingView />
      ) : me.isError ? (
        <ErrorView onRetry={() => me.refetch()} />
      ) : (
        <Group title={t('settings2.privacy.accountGroup')} footer={t('settings2.privacy.privateHint')}>
          <SwitchRow
            icon="lock-closed-outline"
            label={t('settings2.privacy.privateAccount')}
            value={!!me.data?.is_private}
            disabled={priv.isPending}
            onChange={(on) => priv.mutate(on)}
          />
        </Group>
      )}

      <Group title={t('settings2.privacy.interactions')} footer={t('settings2.privacy.friendsMeaning')}>
        {WHO_FIELDS.map((f) => {
          const v = settings.data?.[`who_can_${f}`];
          return (
            <Row
              key={f}
              icon={f === 'message' ? 'paper-plane-outline' : f === 'comment' ? 'chatbubble-outline' : 'at-outline'}
              label={t(`settings2.who.title_${f}`)}
              value={v ? t(whoLabelKey(v)) : undefined}
              onPress={() => go(`/settings/who-can/${f}`)}
            />
          );
        })}
      </Group>

      <Group title={t('presence.settingsGroup')} footer={t('presence.settingsHint')}>
        <SwitchRow
          icon="radio-button-on-outline"
          label={t('presence.settingsLabel')}
          value={settings.data?.show_activity_status ?? true}
          disabled={!settings.data || updateSettings.isPending}
          onChange={(on) =>
            updateSettings.mutate({ show_activity_status: on }, { onError: (e) => showError(t, e, 'settings2.common.updateFailed') })
          }
        />
      </Group>

      <Group title={t('settings2.privacy.locationGroup')}>
        <Row icon="location-outline" label={t('settings2.location.title')} value={locValue} onPress={() => go('/settings/location')} />
      </Group>

      <Group title={t('settings2.privacy.peopleGroup')}>
        <Row icon="star-outline" label={t('settings2.closeFriends.title')} onPress={() => go('/settings/close-friends')} />
        <Row icon="eye-off-outline" label={t('settings2.hiddenWords.title')} onPress={() => go('/settings/hidden-words')} />
        <Row icon="remove-circle-outline" label={t('settings2.restricted.title')} onPress={() => go('/settings/restricted')} />
        <Row icon="volume-mute-outline" label={t('settings2.muted.title')} onPress={() => go('/settings/muted')} />
        <Row icon="ban-outline" label={t('settings2.blocked.title')} onPress={() => go('/settings/blocked')} />
      </Group>
    </Screen>
  );
}

const styles = StyleSheet.create({ content: { paddingHorizontal: 16, paddingBottom: 40 } });
