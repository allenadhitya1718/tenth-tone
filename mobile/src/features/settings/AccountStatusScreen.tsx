import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';

import {
  cancelAccountDeletion,
  deactivateAccount,
  fetchAccountStatus,
  reactivateAccount,
  scheduleAccountDeletion,
  settingsKeys,
} from '@/api/settings';
import { isPermanentBan } from '@/api/appeals';
import { creatorKeys, fetchCreatorEarnings } from '@/api/wallet';
import { showToast } from '@/components/Toast';
import { AppText, Button, Screen, TopBar } from '@/components/ui';
import { isBanned } from '@/features/appeals/accountGate';
import { formatDate } from '@/features/appeals/shared';
import { useTheme } from '@/providers/ThemeProvider';

import { confirm, ErrorView, errorText, go, InlineError, LoadingView, Row } from './components';

// Apple 5.1.1(v): account deletion has to be reachable and completable in
// the app. Two clearly different choices: a break (nothing is lost) and
// deletion (scheduled 30 days out, cancelled by signing back in).
export function AccountStatusScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: settingsKeys.accountStatus(), queryFn: fetchAccountStatus });
  const [view, setView] = useState<'choices' | 'delete'>('choices');
  const [busy, setBusy] = useState<'deactivate' | 'delete' | 'cancel' | 'reactivate' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Diamonds not yet paid out are forfeited on deletion (terms); warn if any.
  const earnings = useQuery({
    queryKey: creatorKeys.summary(),
    queryFn: fetchCreatorEarnings,
    enabled: view === 'delete',
  });
  const d = earnings.data?.diamonds;
  const unwithdrawn = d ? Math.max(d.available, 0) + d.pending + d.withheld + d.reserved : 0;

  async function deactivate() {
    const yes = await confirm({
      title: t('settings2.status.deactivateTitle'),
      message: t('settings2.status.deactivateConfirm'),
      confirmLabel: t('settings2.status.deactivateCta'),
      cancelLabel: t('common.cancel'),
    });
    if (!yes) return;
    setBusy('deactivate');
    setError(null);
    try {
      // Signs out on success; the root layout then shows the welcome screen.
      await deactivateAccount();
    } catch (e) {
      setError(errorText(e, t));
      setBusy(null);
    }
  }

  async function scheduleDelete() {
    const yes = await confirm({
      title: t('settings2.status.deleteCta'),
      message: t('settings2.status.deleteConfirm'),
      confirmLabel: t('settings2.status.deleteCta'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!yes) return;
    setBusy('delete');
    setError(null);
    try {
      await scheduleAccountDeletion();
    } catch (e) {
      setError(errorText(e, t));
      setBusy(null);
    }
  }

  async function keep() {
    setBusy('cancel');
    setError(null);
    try {
      await cancelAccountDeletion();
      await qc.invalidateQueries({ queryKey: settingsKeys.accountStatus() });
      Alert.alert(t('settings2.status.cancelledTitle'), t('settings2.status.cancelledBody'));
      setView('choices');
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(null);
    }
  }

  // A deactivated account normally comes back on sign-in (AuthProvider); this
  // is the manual way, and the fallback if that call failed.
  async function reactivate() {
    setBusy('reactivate');
    setError(null);
    try {
      await reactivateAccount();
      await qc.invalidateQueries({ queryKey: settingsKeys.accountStatus() });
      showToast(t('settings2.appeals.gate.welcomeBack'));
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(null);
    }
  }

  const banned = isBanned(status.data);
  // The terms promise appeals here (Settings > Account status).
  const appealEntry = (
    <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border, padding: 0, overflow: 'hidden' }]}>
      <Row
        icon="document-text-outline"
        label={t('settings2.status.appealRow')}
        hint={t('settings2.status.appealRowHint')}
        onPress={() => go('/appeals')}
      />
    </View>
  );
  const bannedNotice = banned ? (
    <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.danger }]}>
      <AppText variant="label" accessibilityRole="header">
        {t('settings2.status.bannedTitle')}
      </AppText>
      <AppText variant="small" muted style={{ marginTop: 6 }}>
        {isPermanentBan(status.data?.banned_until)
          ? t('settings2.appeals.banned.permanent')
          : t('settings2.appeals.banned.until', { date: formatDate(status.data?.banned_until, i18n.language) })}
      </AppText>
      <Button title={t('settings2.appeals.banned.appealCta')} onPress={() => go('/appeals')} style={styles.btn} />
    </View>
  ) : null;

  let body;
  if (status.isLoading) {
    body = <LoadingView />;
  } else if (status.isError) {
    body = <ErrorView onRetry={() => status.refetch()} />;
  } else if (status.data?.deletion_scheduled_at) {
    body = (
      <>
        <WarnHead text={t('settings2.status.pendingTitle')} />
        <AppText muted style={styles.para}>
          {t('settings2.status.pendingBody', { count: status.data.days_left ?? 30 })}
        </AppText>
        <InlineError text={error} />
        <Button title={t('settings2.status.keepCta')} onPress={keep} loading={busy === 'cancel'} style={styles.btn} />
        {appealEntry}
      </>
    );
  } else if (view === 'delete') {
    body = (
      <>
        <WarnHead text={t('settings2.status.irreversible')} />
        <Points
          tone="danger"
          lines={[
            ...['deleteLose1', 'deleteLose2', 'deleteLose3', 'deleteLose4'].map((k) => t(`settings2.status.${k}`)),
            ...(unwithdrawn > 0 ? [t('settings2.status.deleteLoseEarnings', { n: unwithdrawn.toLocaleString(i18n.language) })] : []),
          ]}
        />
        <AppText muted style={styles.para}>
          {t('settings2.status.deleteWhen')}
        </AppText>
        <InlineError text={error} />
        <DangerButton title={t('settings2.status.deleteCta')} onPress={scheduleDelete} loading={busy === 'delete'} />
        <Button title={t('common.back')} variant="ghost" onPress={() => setView('choices')} disabled={!!busy} />
      </>
    );
  } else {
    body = (
      <>
        {status.data?.deactivated && !banned ? (
          <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.warn }]}>
            <AppText variant="label" accessibilityRole="header">
              {t('settings2.status.deactivatedTitle')}
            </AppText>
            <AppText variant="small" muted style={{ marginTop: 6 }}>
              {t('settings2.status.deactivatedBody')}
            </AppText>
            <Button
              title={t('settings2.status.reactivateCta')}
              onPress={reactivate}
              loading={busy === 'reactivate'}
              disabled={!!busy}
              style={styles.btn}
            />
          </View>
        ) : null}
        <AppText muted style={styles.para}>
          {t('settings2.status.intro')}
        </AppText>
        <Card
          tone="warn"
          title={t('settings2.status.deactivateTitle')}
          lines={['deactivate1', 'deactivate2', 'deactivate3'].map((k) => t(`settings2.status.${k}`))}
        >
          <Button
            title={t('settings2.status.deactivateCta')}
            variant="secondary"
            onPress={deactivate}
            loading={busy === 'deactivate'}
            disabled={!!busy}
          />
        </Card>
        <Card
          tone="danger"
          title={t('settings2.status.deleteTitle')}
          lines={['delete1', 'delete2'].map((k) => t(`settings2.status.${k}`))}
        >
          <DangerButton title={t('settings2.status.continueDelete')} onPress={() => setView('delete')} disabled={!!busy} />
        </Card>
        {appealEntry}
        <InlineError text={error} />
      </>
    );
  }

  return (
    <Screen header={<TopBar title={t('settings2.status.title')} />} contentStyle={styles.content}>
      {bannedNotice}
      {body}
    </Screen>
  );
}

function WarnHead({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.warnHead}>
      <Ionicons name="warning-outline" size={26} color={colors.danger} />
      <AppText variant="label" style={{ flex: 1 }} accessibilityRole="header">
        {text}
      </AppText>
    </View>
  );
}

function Points({ lines, tone }: { lines: string[]; tone: 'warn' | 'danger' }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 8, marginVertical: 10 }}>
      {lines.map((l) => (
        <View key={l} style={{ flexDirection: 'row', gap: 8 }}>
          <Ionicons name="ellipse" size={7} color={tone === 'danger' ? colors.danger : colors.warn} style={{ marginTop: 7 }} />
          <AppText variant="small" style={{ flex: 1 }}>
            {l}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function Card({
  tone,
  title,
  lines,
  children,
}: {
  tone: 'warn' | 'danger';
  title: string;
  lines: string[];
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: tone === 'danger' ? colors.danger : colors.border }]}>
      <AppText variant="label" accessibilityRole="header">
        {title}
      </AppText>
      <Points lines={lines} tone={tone} />
      {children}
    </View>
  );
}

function DangerButton({
  title,
  onPress,
  loading,
  disabled,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  // The primary button in a deep red. The theme's danger tone is for text
  // and icons; white on it falls short of 4.5:1, so the fill is darker.
  return <Button title={title} onPress={onPress} loading={loading} disabled={disabled} style={{ backgroundColor: DANGER_FILL }} />;
}

const DANGER_FILL = '#B91C1C';

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  para: { marginVertical: 12 },
  btn: { marginTop: 12 },
  warnHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginTop: 14 },
});
