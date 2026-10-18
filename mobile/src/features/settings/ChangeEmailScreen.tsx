import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';

import { OtpInput } from '@/components/OtpInput';
import { AppText, Button, ErrorBox, LinkText, Screen, TextField, TopBar, type ErrorMsg } from '@/components/ui';
import { toErrorMsg } from '@/hooks/useAuthError';
import { useCooldown } from '@/hooks/useCooldown';
import { retryAfterSeconds, verifyPassword } from '@/lib/auth';
import { OTP_LENGTH, RESEND_COOLDOWN } from '@/lib/config';
import { isEmail } from '@/lib/password';

import { currentEmail, requestEmailChange, verifyEmailChange } from './accountAuth';
import { InlineError } from './components';

type Step = 'form' | 'new' | 'old';

// Password first, then a code sent to the new address. When the project has
// "secure email change" on, the current address gets a code too, and the
// change only lands once both are entered.
export function ChangeEmailScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [old, setOld] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [code, setCode] = useState('');
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [error, setError] = useState<ErrorMsg>(null);
  const [busy, setBusy] = useState(false);
  const cooldown = useCooldown();

  useEffect(() => {
    currentEmail().then(setOld);
  }, []);

  const target = email.trim().toLowerCase();
  const formReady = !!pw && isEmail(target);

  async function send() {
    if (!formReady || busy) return;
    if (old && target === old.toLowerCase()) return setEmailErr(t('settings2.email.same'));
    setBusy(true);
    setError(null);
    try {
      if (!(await verifyPassword(pw))) {
        setPwErr(t('settings2.email.wrongPassword'));
        return;
      }
      await requestEmailChange(target);
      setStep('new');
      setCode('');
      cooldown.start(RESEND_COOLDOWN);
    } catch (e) {
      setError(toErrorMsg(e));
      const wait = retryAfterSeconds(e);
      if (wait) cooldown.start(wait);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (cooldown.left > 0) return;
    setError(null);
    try {
      await requestEmailChange(target);
      cooldown.start(RESEND_COOLDOWN);
    } catch (e) {
      setError(toErrorMsg(e));
      cooldown.start(retryAfterSeconds(e) || RESEND_COOLDOWN);
    }
  }

  async function verify() {
    if (code.length < OTP_LENGTH || busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyEmailChange(step === 'old' && old ? old : target, code);
      const now = (await currentEmail())?.toLowerCase();
      if (now === target) {
        qc.invalidateQueries({ queryKey: ['mySettings'] });
        Alert.alert(t('settings2.email.doneTitle'), t('settings2.email.doneBody', { email: target }));
        router.back();
        return;
      }
      // Half done: the other address still has to confirm.
      if (step === 'new' && old) {
        setStep('old');
        setCode('');
      } else {
        Alert.alert(t('settings2.email.pendingTitle'), t('settings2.email.pendingBody'));
        router.back();
      }
    } catch (e) {
      setError(toErrorMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (step !== 'form') {
    const sentTo = step === 'old' ? old : target;
    return (
      <Screen header={<TopBar title={t('settings2.email.title')} onBack={() => setStep('form')} />}>
        <AppText variant="title" center>
          {t('otp.heading')}
        </AppText>
        <AppText muted center>
          {step === 'old' ? t('settings2.email.oldCodeLead') : t('otp.sentTo')}
        </AppText>
        <AppText variant="label" center>
          {sentTo}
        </AppText>
        <OtpInput
          length={OTP_LENGTH}
          value={code}
          onChange={(v) => {
            setCode(v);
            setError(null);
          }}
          error={!!error}
        />
        <ErrorBox error={error} />
        <View style={styles.resend}>
          <AppText muted>{t('otp.didntGet')}</AppText>
          <LinkText
            title={cooldown.left > 0 ? t('otp.resendIn', { seconds: cooldown.left }) : t('otp.resend')}
            disabled={cooldown.left > 0}
            onPress={resend}
          />
        </View>
        <Button
          title={busy ? t('otp.verifying') : t('otp.verify')}
          loading={busy}
          disabled={code.length < OTP_LENGTH}
          onPress={verify}
        />
      </Screen>
    );
  }

  return (
    <Screen header={<TopBar title={t('settings2.email.title')} />}>
      <AppText variant="small" muted>
        {t('settings2.email.current')}
      </AppText>
      <AppText variant="label" style={{ marginBottom: 18 }}>
        {old ?? '—'}
      </AppText>

      <AppText variant="label" style={styles.h} accessibilityRole="header">
        {t('settings2.common.confirmIdentity')}
      </AppText>
      <TextField
        secure
        value={pw}
        onChangeText={(v) => {
          setPw(v);
          setPwErr(null);
        }}
        placeholder={t('settings2.email.password')}
        accessibilityLabel={t('settings2.email.password')}
        autoComplete="current-password"
        textContentType="password"
        autoCapitalize="none"
      />
      <InlineError text={pwErr} />

      <AppText variant="label" style={[styles.h, { marginTop: 18 }]} accessibilityRole="header">
        {t('settings2.email.new')}
      </AppText>
      <TextField
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          setEmailErr(null);
        }}
        placeholder={t('settings2.email.new')}
        accessibilityLabel={t('settings2.email.new')}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={send}
      />
      <InlineError text={emailErr} />
      <ErrorBox error={error} />
      <AppText variant="small" muted style={{ marginVertical: 12 }}>
        {t('settings2.email.note')}
      </AppText>
      <Button title={t('settings2.email.send')} onPress={send} loading={busy} disabled={!formReady} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  h: { marginBottom: 10 },
  resend: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginVertical: 12 },
});
