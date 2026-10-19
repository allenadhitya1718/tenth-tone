import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, Stack, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler, StyleSheet, View } from 'react-native';

import { appealKeys, fetchMyAppeals, isPermanentBan } from '@/api/appeals';
import { fetchAccountStatus, settingsKeys } from '@/api/settings';
import { showToast } from '@/components/Toast';
import { AppText, Button, Screen } from '@/components/ui';
import { signOut } from '@/lib/auth';
import { useTheme } from '@/providers/ThemeProvider';

import { isBanned } from './accountGate';
import { formatDate, moderatorReason } from './shared';

const P = 'settings2.appeals.banned';

// Shown after sign-in (and on a restored session) while the account is
// banned. The account is NOT reactivated. The way out is an appeal, a
// "check again" once the ban is lifted, or signing out.
export function BannedScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const status = useQuery({ queryKey: settingsKeys.accountStatus(), queryFn: fetchAccountStatus });
  const mine = useQuery({ queryKey: appealKeys.mine(), queryFn: fetchMyAppeals });
  const [busy, setBusy] = useState<'check' | 'out' | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // No swipe or hardware back into the app behind this screen.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
      return () => sub.remove();
    }, []),
  );

  const s = status.data;
  const until = s?.banned_until ?? null;
  const reason = moderatorReason(t, s?.ban_reason);
  const openBanAppeal = (mine.data ?? []).find((a) => a.kind === 'ban' && a.status === 'open');

  async function checkAgain() {
    setBusy('check');
    setNote(null);
    try {
      const r = await status.refetch();
      if (r.data && !isBanned(r.data)) {
        showToast(t(`${P}.lifted`));
        router.replace('/' as Href);
        return;
      }
      setNote(t(`${P}.stillBanned`));
    } finally {
      setBusy(null);
    }
  }

  async function out() {
    setBusy('out');
    try {
      await signOut();
    } catch {
      setBusy(null);
    }
  }

  return (
    <Screen contentStyle={styles.content}>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <View style={[styles.badge, { backgroundColor: colors.dangerSoft }]}>
        <Ionicons name="ban-outline" size={40} color={colors.danger} />
      </View>
      <AppText variant="title" center accessibilityRole="header" style={styles.title}>
        {t(`${P}.title`)}
      </AppText>
      {s ? (
        <AppText variant="label" center style={{ marginTop: 6 }}>
          {isPermanentBan(until) ? t(`${P}.permanent`) : t(`${P}.until`, { date: formatDate(until, i18n.language) })}
        </AppText>
      ) : null}
      {reason ? (
        <AppText center muted style={{ marginTop: 10 }}>
          {t(`${P}.reason`, { reason })}
        </AppText>
      ) : null}
      <AppText center muted style={styles.para}>
        {t(`${P}.body`)}
      </AppText>

      {openBanAppeal ? (
        <View style={[styles.pending, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
          <Ionicons name="time-outline" size={18} color={colors.warn} />
          <AppText variant="small" style={{ flex: 1 }}>
            {t(`${P}.appealOpen`)}
          </AppText>
        </View>
      ) : null}

      <Button title={t(`${P}.appealCta`)} onPress={() => router.push('/appeals' as Href)} style={styles.btn} />
      <Button
        title={t(`${P}.checkAgain`)}
        variant="secondary"
        onPress={checkAgain}
        loading={busy === 'check'}
        disabled={!!busy}
        style={styles.btn}
      />
      {note ? (
        <AppText variant="small" muted center style={{ marginTop: 8 }} accessibilityLiveRegion="polite">
          {note}
        </AppText>
      ) : null}
      <Button title={t(`${P}.signOut`)} variant="ghost" onPress={out} loading={busy === 'out'} disabled={!!busy} style={styles.btn} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 24, paddingTop: 48, paddingBottom: 40 },
  badge: { alignSelf: 'center', width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: 18 },
  para: { marginTop: 16, marginBottom: 8 },
  pending: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 12 },
  btn: { marginTop: 12 },
});
