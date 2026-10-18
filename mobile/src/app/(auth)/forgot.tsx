import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppText, Button, ErrorBox, Screen, TextField, TopBar, type ErrorMsg } from '@/components/ui';
import { toErrorMsg } from '@/hooks/useAuthError';
import { resetPassword } from '@/lib/auth';
import { isEmail } from '@/lib/password';
import { useAuth } from '@/providers/AuthProvider';

export default function Forgot() {
  const { t } = useTranslation();
  const { setPending } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<ErrorMsg>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    const addr = email.trim();
    if (!isEmail(addr)) return setError({ key: 'register.badEmail' });
    setBusy(true);
    setError(null);
    try {
      await resetPassword(addr);
      setPending({ resetEmail: addr });
      router.push('/reset');
    } catch (e) {
      setError(toErrorMsg(e));
    }
    setBusy(false);
  }

  return (
    <Screen header={<TopBar title={t('forgot.title')} />}>
      <AppText variant="title">{t('forgot.heading')}</AppText>
      <AppText variant="subtitle" muted>
        {t('forgot.sub')}
      </AppText>
      <ErrorBox error={error} />
      <TextField
        value={email}
        onChangeText={setEmail}
        placeholder={t('register.email')}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        returnKeyType="send"
        onSubmitEditing={send}
      />
      <Button title={busy ? t('forgot.sending') : t('forgot.send')} loading={busy} onPress={send} />
    </Screen>
  );
}
