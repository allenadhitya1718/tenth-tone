import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text } from 'react-native';

import { fetchAccountStatus, fetchMySettings, settingsKeys } from '@/api/settings';
import { LegalSheet } from '@/components/LegalSheet';
import { Screen, TopBar } from '@/components/ui';
import { LANGUAGES } from '@/i18n';
import { signOut } from '@/lib/auth';
import { useTheme, type ThemePref } from '@/providers/ThemeProvider';

import { confirm, go, Group, RadioGroup, RadioRow, Row, SwitchRow, showError } from './components';
import { useUpdateUserSettings, useUserSettings } from './hooks';

// The settings list. Every item pushes its own screen onto the stack, so this
// one stays mounted underneath and keeps its scroll position when you come
// back (client note 15). Nothing here resets scroll on focus.
export function SettingsHome() {
  const { t, i18n } = useTranslation();
  const { colors, pref, setPref } = useTheme();
  const [legalOpen, setLegalOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const me = useQuery({ queryKey: settingsKeys.mySettings(), queryFn: fetchMySettings });
  const status = useQuery({ queryKey: settingsKeys.accountStatus(), queryFn: fetchAccountStatus });
  const settings = useUserSettings();
  const update = useUpdateUserSettings();

  const language = LANGUAGES.find((l) => l.code === i18n.language)?.native ?? i18n.language;
  const version = Constants.expoConfig?.version ?? '';
  const deletionPending = !!status.data?.deletion_scheduled_at;

  const setPlayback = (key: 'autoplay' | 'data_saver', on: boolean) =>
    update.mutate({ [key]: on }, { onError: (e) => showError(t, e, 'settings2.common.updateFailed') });

  async function logOut() {
    const yes = await confirm({
      title: t('settings2.home.logoutTitle'),
      message: t('settings2.home.logoutMessage'),
      confirmLabel: t('settings.logout'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!yes) return;
    setSigningOut(true);
    try {
      await signOut();
    } catch (e) {
      setSigningOut(false);
      showError(t, e);
    }
  }

  return (
    <Screen header={<TopBar title={t('settings.title')} />} contentStyle={styles.content}>
      <Group title={t('settings2.home.account')}>
        <Row icon="person-outline" label={t('profile.edit')} onPress={() => go('/profile/edit')} />
        <Row icon="key-outline" label={t('settings2.password.title')} onPress={() => go('/settings/password')} />
        <Row icon="mail-outline" label={t('settings2.email.title')} onPress={() => go('/settings/email')} />
        <Row icon="phone-portrait-outline" label={t('settings2.devices.title')} onPress={() => go('/settings/devices')} />
        <Row icon="download-outline" label={t('settings2.data.title')} onPress={() => go('/settings/data')} />
        <Row icon="wallet-outline" label={t('live.wallet.title')} onPress={() => go('/wallet')} />
      </Group>

      <Group title={t('settings2.home.privacy')}>
        <Row
          icon="lock-closed-outline"
          label={t('settings2.privacy.title')}
          value={me.data ? t(me.data.is_private ? 'settings2.privacy.private' : 'settings2.privacy.public') : undefined}
          onPress={() => go('/settings/privacy')}
        />
        <Row icon="map-outline" label={t('map.title')} onPress={() => go('/map')} />
        <Row icon="ban-outline" label={t('settings2.blocked.title')} onPress={() => go('/settings/blocked')} />
        <Row icon="star-outline" label={t('settings2.closeFriends.title')} onPress={() => go('/settings/close-friends')} />
      </Group>

      <Group title={t('settings2.home.notifications')}>
        <Row icon="notifications-outline" label={t('settings2.notifications.title')} onPress={() => go('/settings/notifications')} />
      </Group>

      <Group title={t('settings2.home.content')}>
        <SwitchRow
          icon="play-circle-outline"
          label={t('settings2.home.autoplay')}
          value={settings.data?.autoplay ?? true}
          disabled={!settings.data}
          onChange={(on) => setPlayback('autoplay', on)}
        />
        <SwitchRow
          icon="cellular-outline"
          label={t('settings2.home.dataSaver')}
          hint={t('settings2.home.dataSaverHint')}
          value={settings.data?.data_saver ?? false}
          disabled={!settings.data}
          onChange={(on) => setPlayback('data_saver', on)}
        />
        <Row icon="time-outline" label={t('settings2.activity.title')} onPress={() => go('/settings/activity')} />
      </Group>

      <Group title={t('settings.language')}>
        <Row icon="globe-outline" label={t('settings.language')} value={language} onPress={() => go('/settings/language')} />
      </Group>

      <RadioGroup title={t('settings.appearance')}>
        {(['system', 'light', 'dark'] as ThemePref[]).map((p) => (
          <RadioRow key={p} label={t(`settings.${p}`)} selected={pref === p} onPress={() => setPref(p)} />
        ))}
      </RadioGroup>

      <Group title={t('settings2.home.support')}>
        <Row icon="flag-outline" label={t('settings2.report.title')} onPress={() => go('/settings/report')} />
        <Row icon="chatbubbles-outline" label={t('settings2.contact.title')} onPress={() => go('/settings/support')} />
        <Row icon="shield-checkmark-outline" label={t('settings2.guidelines.title')} onPress={() => go('/settings/guidelines')} />
      </Group>

      <Group title={t('settings2.home.about')}>
        <Row icon="document-text-outline" label={t('settings2.home.legal')} onPress={() => setLegalOpen(true)} />
        <Row icon="information-circle-outline" label={t('settings2.home.version')} value={version} />
      </Group>

      <Group title={t('settings2.home.accountStatus')}>
        <Row icon="pause-circle-outline" label={t('settings2.status.deactivateTitle')} onPress={() => go('/settings/account-status')} />
        <Row
          icon="trash-outline"
          danger
          label={t('settings2.status.deleteRow')}
          value={deletionPending ? t('settings2.status.pendingShort') : undefined}
          onPress={() => go('/settings/account-status')}
        />
      </Group>

      <Pressable
        onPress={logOut}
        disabled={signingOut}
        accessibilityRole="button"
        accessibilityState={{ disabled: signingOut, busy: signingOut }}
        style={({ pressed }) => [styles.logout, { backgroundColor: pressed ? colors.bg3 : colors.bg2 }]}
      >
        <Text style={[styles.logoutText, { color: colors.danger }]}>{t('settings.logout')}</Text>
      </Pressable>

      <LegalSheet visible={legalOpen} onClose={() => setLegalOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  logout: { marginTop: 28, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  logoutText: { fontSize: 16, fontWeight: '700' },
});
