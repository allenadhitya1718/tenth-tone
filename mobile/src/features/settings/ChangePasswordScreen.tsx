import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { showAlert } from '@/components/Dialog';
import { PasswordRules } from '@/components/PasswordRules';
import { AppText, Button, ErrorBox, LinkText, Screen, TextField, TopBar, type ErrorMsg } from '@/components/ui';
import { toErrorMsg } from '@/hooks/useAuthError';
import { signOut, updatePassword, verifyPassword } from '@/lib/auth';
import { isCommonPassword, passwordChecks } from '@/lib/password';

import { signOutOtherDevices } from './accountAuth';
import { confirm, InlineError } from './components';

// Re-asks for the current password first. That step is the point: it stops
// someone holding an unlocked phone from taking the account.
export function ChangePasswordScreen() {
  const { t } = useTranslation();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [curErr, setCurErr] = useState<string | null>(null);
  const [nextErr, setNextErr] = useState<string | null>(null);
  const [error, setError] = useState<ErrorMsg>(null);
  const [busy, setBusy] = useState(false);

  const rulesOk = passwordChecks(next).every((c) => c.ok);
  const mismatch = !!again && again !== next;
  const ready = !!cur && rulesOk && again === next;

  async function save() {
    if (!ready || busy) return;
    setError(null);
    if (next === cur) return setNextErr(t('settings2.password.sameAsOld'));
    if (isCommonPassword(next)) return setNextErr(t('password.common'));
    setBusy(true);
    try {
      if (!(await verifyPassword(cur))) {
        setCurErr(t('settings2.password.wrongCurrent'));
        return;
      }
      await updatePassword(next);
      // The password is already changed; failing to end other sessions must
      // not read as though the change failed.
      try {
        await signOutOtherDevices();
      } catch {}
      showAlert(t('settings2.password.doneTitle'), t('settings2.password.doneBody'));
      router.back();
    } catch (e) {
      setError(toErrorMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    const yes = await confirm({
      title: t('settings2.password.forgotTitle'),
      message: t('settings2.password.forgotBody'),
      confirmLabel: t('settings2.password.forgotConfirm'),
      cancelLabel: t('common.cancel'),
    });
    if (yes) await signOut().catch(() => {});
  }

  return (
    <Screen header={<TopBar title={t('settings2.password.title')} />}>
      <AppText variant="label" style={styles.h} accessibilityRole="header">
        {t('settings2.common.confirmIdentity')}
      </AppText>
      <TextField
        secure
        value={cur}
        onChangeText={(v) => {
          setCur(v);
          setCurErr(null);
        }}
        placeholder={t('settings2.password.current')}
        accessibilityLabel={t('settings2.password.current')}
        autoComplete="current-password"
        textContentType="password"
        autoCapitalize="none"
      />
      <InlineError text={curErr} />
      <LinkText title={t('settings2.password.forgot')} onPress={forgot} style={styles.link} />

      <AppText variant="label" style={styles.h} accessibilityRole="header">
        {t('settings2.password.new')}
      </AppText>
      <TextField
        secure
        value={next}
        onChangeText={(v) => {
          setNext(v);
          setNextErr(null);
        }}
        placeholder={t('settings2.password.new')}
        accessibilityLabel={t('settings2.password.new')}
        autoComplete="new-password"
        textContentType="newPassword"
        autoCapitalize="none"
      />
      <PasswordRules value={next} />
      <InlineError text={nextErr} />
      <TextField
        secure
        value={again}
        onChangeText={setAgain}
        placeholder={t('settings2.password.confirm')}
        accessibilityLabel={t('settings2.password.confirm')}
        autoComplete="new-password"
        textContentType="newPassword"
        autoCapitalize="none"
        onSubmitEditing={save}
      />
      {mismatch ? <ErrorBox error={{ key: 'password.mismatch' }} /> : null}
      <ErrorBox error={error} />
      <AppText variant="small" muted style={{ marginBottom: 12 }}>
        {t('settings2.password.othersSignedOut')}
      </AppText>
      <Button title={t('common.save')} onPress={save} loading={busy} disabled={!ready} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  h: { marginTop: 8, marginBottom: 10 },
  link: { marginBottom: 18, marginTop: 10 },
});
