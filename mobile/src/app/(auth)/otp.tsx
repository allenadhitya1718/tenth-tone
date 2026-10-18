import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { OtpInput } from '@/components/OtpInput';
import { AppText, Button, ErrorBox, LinkText, Screen, TopBar, type ErrorMsg } from '@/components/ui';
import { toErrorMsg } from '@/hooks/useAuthError';
import { useCooldown } from '@/hooks/useCooldown';
import { resendSignup, retryAfterSeconds, saveBirthDate, verifySignupCode } from '@/lib/auth';
import { OTP_LENGTH, RESEND_COOLDOWN } from '@/lib/config';
import { useAuth } from '@/providers/AuthProvider';

export default function Otp() {
  const { t } = useTranslation();
  const { pending, setPending } = useAuth();
  const email = pending.signupEmail;

  const [code, setCode] = useState('');
  const [error, setError] = useState<ErrorMsg>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  // Signup has just sent one, so the server-side clock is already running.
  const cooldown = useCooldown(RESEND_COOLDOWN);

  if (!email) {
    return (
      <Screen header={<TopBar title={t('otp.title')} onBack={() => router.replace('/register')} />}>
        <AppText variant="title" center style={{ marginTop: 40 }}>
          {t('otp.sessionExpired')}
        </AppText>
        <AppText muted center style={{ marginBottom: 20 }}>
          {t('otp.startOver')}
        </AppText>
        <Button title={t('common.back')} onPress={() => router.replace('/register')} />
      </Screen>
    );
  }

  // Resending to a mistyped address repeats the same nothing; the way out is
  // changing the address.
  function changeEmail() {
    setPending({});
    router.replace('/register');
  }

  async function verify() {
    if (code.length < OTP_LENGTH || !email) return;
    setBusy(true);
    setError(null);
    try {
      await verifySignupCode(email, code);
      // There was no session to write the birthday with until now.
      if (pending.birthDate) {
        await saveBirthDate(pending.birthDate).catch((e) => console.warn('birth date save:', e));
      }
      setPending({});
      // The root layout moves to the app as the session arrives.
    } catch (e) {
      setError(toErrorMsg(e));
      setBusy(false);
    }
  }

  async function resend() {
    if (cooldown.left > 0 || !email) return;
    setError(null);
    try {
      await resendSignup(email);
      setInfo('otp.resent');
      cooldown.start(RESEND_COOLDOWN);
    } catch (e) {
      setError(toErrorMsg(e));
      // If the server named a wait, honour it instead of guessing.
      cooldown.start(retryAfterSeconds(e) || RESEND_COOLDOWN);
    }
  }

  return (
    <Screen header={<TopBar title={t('otp.title')} onBack={changeEmail} />}>
      {/* No logo: it only pushed the code boxes down. */}
      <View style={{ alignItems: 'center', marginTop: 10 }}>
        <AppText variant="title" center>
          {t('otp.heading')}
        </AppText>
        <AppText muted center>
          {t('otp.sentTo')}
        </AppText>
        <AppText variant="label" center>
          {email}
        </AppText>
      </View>
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
      {info ? (
        <AppText variant="small" muted center>
          {t(info)}
        </AppText>
      ) : null}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginVertical: 12 }}>
        <AppText muted>{t('otp.didntGet')}</AppText>
        <LinkText
          title={cooldown.left > 0 ? t('otp.resendIn', { seconds: cooldown.left }) : t('otp.resend')}
          disabled={cooldown.left > 0}
          onPress={resend}
        />
      </View>
      <View style={{ alignItems: 'center', marginBottom: 8 }}>
        <LinkText title={t('otp.wrongEmail')} onPress={changeEmail} />
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
