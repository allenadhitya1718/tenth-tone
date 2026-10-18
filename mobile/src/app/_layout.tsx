import { LocaleProvider, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initI18n, languageIsRtl } from '@/i18n';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { ThemeProvider, useTheme } from '@/providers/ThemeProvider';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [langReady, setLangReady] = useState(false);

  useEffect(() => {
    // When the stored language needs the other layout direction, initI18n
    // reloads the app; rendering in between would flash the wrong layout.
    initI18n()
      .then(({ reloading }) => !reloading && setLangReady(true))
      .catch(() => setLangReady(true));
  }, []);

  if (!langReady) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { session, ready, recovering } = useAuth();
  const { colors, isDark } = useTheme();
  const { i18n } = useTranslation();

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  const signedIn = !!session && !recovering;

  return (
    <LocaleProvider direction={languageIsRtl(i18n.language) ? 'rtl' : 'ltr'}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </LocaleProvider>
  );
}
