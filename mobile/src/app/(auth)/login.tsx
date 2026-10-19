import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppleButton } from '@/components/AppleButton';
import { CircleBack, DARK, GlassField, GradientButton, TopGlow } from '@/components/DarkAuth';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { Logo } from '@/components/Logo';
import { ErrorBox, type ErrorMsg } from '@/components/ui';
import { toErrorMsg } from '@/hooks/useAuthError';
import { signIn } from '@/lib/auth';

// Dark, calm login. Same auth logic as before; only layout and styling changed.
export default function Login() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ErrorMsg>(null);
  const [busy, setBusy] = useState(false);
  const rtl = I18nManager.isRTL;

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
    <View style={styles.root}>
      <StatusBar style="light" />
      <TopGlow />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={styles.top}>
          <CircleBack onPress={() => router.replace('/welcome')} />
          <LanguageSwitch onDark />
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
            <View style={styles.head}>
              <View style={styles.logoGlow}>
                <Logo width={170} />
              </View>
              <Text style={styles.title}>{t('login.title')}</Text>
              <Text style={styles.sub}>{t('login.subtitle')}</Text>
            </View>

            <ErrorBox error={error} />
            <GlassField
              icon="mail-outline"
              value={email}
              onChangeText={setEmail}
              placeholder={t('register.email')}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="username"
              returnKeyType="next"
              accessibilityLabel={t('register.email')}
            />
            <View style={{ height: 16 }} />
            <GlassField
              icon="lock-closed-outline"
              secure
              value={password}
              onChangeText={setPassword}
              placeholder={t('login.password')}
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={submit}
              accessibilityLabel={t('login.password')}
            />
            <Text onPress={() => router.push('/forgot')} accessibilityRole="link" style={[styles.forgot, { alignSelf: rtl ? 'flex-start' : 'flex-end' }]}>
              {t('login.forgot')}
            </Text>

            <GradientButton title={busy ? t('login.submitting') : t('login.submit')} loading={busy} onPress={submit} />
            <View style={{ height: 12 }} />
            <AppleButton onError={(e) => setError(toErrorMsg(e))} forceLight />

            <View style={{ flex: 1, minHeight: 24 }} />
            <View style={styles.footer}>
              <Text style={styles.noAccount}>{t('login.noAccount')}</Text>
              <Text onPress={() => router.replace('/register')} accessibilityRole="link" style={styles.signUp}>
                {t('login.signUp')}
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: DARK.bg },
  top: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 28, maxWidth: 460, width: '100%', alignSelf: 'center' },
  head: { alignItems: 'center', marginTop: 12, marginBottom: 30 },
  logoGlow: { borderRadius: 18, shadowColor: DARK.blue, shadowOpacity: 0.45, shadowRadius: 22, shadowOffset: { width: 0, height: 0 }, elevation: 10 },
  title: { color: DARK.text, fontSize: 30, fontWeight: '800', marginTop: 20 },
  sub: { color: DARK.sub, fontSize: 15, marginTop: 6 },
  forgot: { color: DARK.link, fontSize: 14, fontWeight: '600', marginTop: 14, marginBottom: 26 },
  footer: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingTop: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.10)' },
  noAccount: { color: DARK.sub, fontSize: 15 },
  signUp: { color: DARK.link, fontSize: 15, fontWeight: '700' },
});
