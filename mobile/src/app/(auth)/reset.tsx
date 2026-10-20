import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { showAlert } from '@/components/Dialog';
import { OtpInput } from '@/components/OtpInput';
import { PasswordRules } from '@/components/PasswordRules';
import { AppText, Button, ErrorBox, LinkText, Screen, TextField, TopBar, type ErrorMsg } from '@/components/ui';
import { toErrorMsg } from '@/hooks/useAuthError';
import { useCooldown } from '@/hooks/useCooldown';
import { resetPassword, signOut, updatePassword, verifyRecoveryCode } from '@/lib/auth';
import { OTP_LENGTH, RESEND_COOLDOWN } from '@/lib/config';
import { isCommonPassword, passwordChecks } from '@/lib/password';
import { useAuth } from '@/providers/AuthProvider';

// Code first, then the new password. Verifying the code signs the device in,
// so `recovering` holds the router on this screen until the password is set.
export default function Reset() {
  const { t } = useTranslation();
  const { pending, setPending, setRecovering } = useAuth();
  const email = pending.resetEmail;

  const [stage, setStage] = useState<'code' | 'password'>('code');
  const [code, setCode] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<ErrorMsg>(null);
  const [busy, setBusy] = useState(false);
  const cooldown = useCooldown(RESEND_COOLDOWN);

  // Leaving half way must not strand a signed-in session behind the auth
  // screens, so backing out of the password stage signs out again.
  async function leave() {
    if (stage === 'password') {
      await signOut().catch(() => {});
      setRecovering(false);
    }
    router.replace('/forgot');
  }

  if (!email) {
    return (
      <Screen header={<TopBar title={t('reset.title')} onBack={leave} />}>
        <AppText variant="title" center style={{ marginTop: 40 }}>
          {t('otp.sessionExpired')}
        </AppText>
        <AppText muted center style={{ marginBottom: 20 }}>
          {t('otp.startOver')}
        </AppText>
        <Button title={t('common.back')} onPress={leave} />
      </Screen>
    );
  }

  async function verify() {
    if (code.length < OTP_LENGTH || !email) return;
    setBusy(true);
    setError(null);
    setRecovering(true);
    try {
      await verifyRecoveryCode(email, code);
      setStage('password');
    } catch (e) {
      setRecovering(false);
      setError(toErrorMsg(e));
    }
    setBusy(false);
  }

  async function resend() {
    if (cooldown.left > 0 || !email) return;
    try {
      await resetPassword(email);
      cooldown.start(RESEND_COOLDOWN);
    } catch (e) {
      setError(toErrorMsg(e));
    }
  }

  async function save() {
    if (pw1 !== pw2) return setError({ key: 'password.mismatch' });
    if (isCommonPassword(pw1)) return setError({ key: 'password.common' });
    setBusy(true);
    setError(null);
    try {
      await updatePassword(pw1);
      setPending({});
      showAlert(t('reset.changed'));
      // Releasing the hold lets the root layout move into the app.
      setRecovering(false);
    } catch (e) {
      setError(toErrorMsg(e));
      setBusy(false);
    }
  }

  const canSave = passwordChecks(pw1).every((c) => c.ok) && pw1 === pw2 && !!pw1;

  return (
    <Screen header={<TopBar title={t('reset.title')} onBack={leave} />}>
      {stage === 'code' ? (
        <>
          <AppText variant="title" center>
            {t('otp.heading')}
          </AppText>
          <AppText muted center>
            {t('otp.sentTo')}
          </AppText>
          <AppText variant="label" center>
            {email}
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
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginVertical: 12 }}>
            <AppText muted>{t('otp.didntGet')}</AppText>
            <LinkText
              title={cooldown.left > 0 ? t('otp.resendIn', { seconds: cooldown.left }) : t('otp.resend')}
              disabled={cooldown.left > 0}
              onPress={resend}
            />
          </View>
          <Button
            title={busy ? t('otp.verifying') : t('reset.verify')}
            loading={busy}
            disabled={code.length < OTP_LENGTH}
            onPress={verify}
          />
        </>
      ) : (
        <>
          <AppText variant="title">{t('reset.newHeading')}</AppText>
          <AppText variant="subtitle" muted>
            {t('reset.newSub')}
          </AppText>
          <TextField
            value={pw1}
            onChangeText={setPw1}
            placeholder={t('reset.newPlaceholder')}
            secure
            autoFocus
            autoComplete="new-password"
            textContentType="newPassword"
          />
          <PasswordRules value={pw1} />
          <TextField
            value={pw2}
            onChangeText={setPw2}
            placeholder={t('register.confirmPlaceholder')}
            secure
            autoComplete="new-password"
            textContentType="newPassword"
          />
          <ErrorBox error={error} />
          <Button
            title={busy ? t('reset.saving') : t('reset.save')}
            loading={busy}
            disabled={!canSave}
            onPress={save}
          />
        </>
      )}
    </Screen>
  );
}
