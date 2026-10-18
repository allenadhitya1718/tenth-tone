import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppleButton } from '@/components/AppleButton';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { Logo } from '@/components/Logo';
import { AppText, Button, ErrorBox, LinkText, Screen, TextField, TopBar, type ErrorMsg } from '@/components/ui';
import { toErrorMsg } from '@/hooks/useAuthError';
import { signIn } from '@/lib/auth';

export default function Login() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ErrorMsg>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email || !password) return setError({ key: 'login.fillAll' });
    setError(null);
    setBusy(true);
    try {
      await signIn({ email: email.trim(), password });
      // The root layout swaps the whole auth stack for the app as the session
      // lands, so the login screen never sits under the feed.
    } catch (e) {
      setError(toErrorMsg(e));
      setBusy(false);
    }
  }

  return (
    <Screen header={<TopBar onBack={() => router.replace('/welcome')} right={<LanguageSwitch />} />}>
      <View style={{ alignItems: 'center', marginTop: 8, marginBottom: 24 }}>
        <Logo width={165} />
        <AppText variant="title" center style={{ marginTop: 14 }}>
          {t('login.title')}
        </AppText>
        <AppText muted center>
          {t('login.subtitle')}
        </AppText>
      </View>
      <ErrorBox error={error} />
      <TextField
        value={email}
        onChangeText={setEmail}
        placeholder={t('register.email')}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="username"
        returnKeyType="next"
      />
      <TextField
        value={password}
        onChangeText={setPassword}
        placeholder={t('login.password')}
        secure
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      <View style={{ alignItems: 'flex-end', marginBottom: 14 }}>
        <LinkText title={t('login.forgot')} onPress={() => router.push('/forgot')} />
      </View>
      <Button title={busy ? t('login.submitting') : t('login.submit')} loading={busy} onPress={submit} />
      <AppleButton onError={(e) => setError(toErrorMsg(e))} />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 18 }}>
        <AppText muted>{t('login.noAccount')}</AppText>
        <LinkText title={t('login.signUp')} onPress={() => router.replace('/register')} />
      </View>
    </Screen>
  );
}
