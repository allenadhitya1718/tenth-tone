import { QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { queryClient } from '@/api/queryClient';
import { useFollowRequestSync } from '@/features/notifications/useFollowRequestSync';
import { usePushRegistration } from '@/features/notifications/push';
import { useRecordSession } from '@/features/settings/useRecordSession';
import { initI18n, languageIsRtl } from '@/i18n';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { ThemeProvider, useTheme } from '@/providers/ThemeProvider';
import { AnimatedSplash } from '@/components/AnimatedSplash';
import { ToastHost } from '@/components/Toast';
import { CallPill, useIncomingCalls } from '@/features/call';

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
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <AuthProvider>
              <RootNavigator />
              <ToastHost />
            </AuthProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { session, ready, recovering } = useAuth();
  const { colors, isDark } = useTheme();
  const { i18n } = useTranslation();
  usePushRegistration();
  useIncomingCalls();
  useFollowRequestSync(session?.user.id);
  useRecordSession();

  const [splashDone, setSplashDone] = useState(false);
  const splash = splashDone ? null : (
    // The native splash stays up until this overlay has drawn its first frame,
    // so the two look like one continuous screen.
    <AnimatedSplash ready={ready} onShown={() => SplashScreen.hideAsync().catch(() => {})} onFinish={() => setSplashDone(true)} />
  );

  if (!ready) return splash;

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
      {signedIn ? <CallPill /> : null}
      {splash}
    </LocaleProvider>
  );
}
