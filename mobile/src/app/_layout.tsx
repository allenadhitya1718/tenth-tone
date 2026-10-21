import { QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { bootQueryCache, queryClient } from '@/api/queryClient';
import { useFollowRequestSync } from '@/features/notifications/useFollowRequestSync';
import { usePushRegistration } from '@/features/notifications/push';
import { usePresenceHeartbeat } from '@/features/presence/usePresence';
import { useRecordSession } from '@/features/settings/useRecordSession';
import { initI18n, languageIsRtl } from '@/i18n';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { ThemeProvider, useTheme } from '@/providers/ThemeProvider';
import { AnimatedSplash } from '@/components/AnimatedSplash';
import { DialogHost } from '@/components/Dialog';
import { ToastHost } from '@/components/Toast';
import { CallPill, useIncomingCalls } from '@/features/call';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [langReady, setLangReady] = useState(false);

  useEffect(() => {
    // When the stored language needs the other layout direction, initI18n
    // reloads the app; rendering in between would flash the wrong layout.
    // The saved cache (chats, inbox) is read back alongside the language,
    // so the first screen already shows it.
    Promise.all([initI18n(), bootQueryCache()])
      .then(([{ reloading }]) => !reloading && setLangReady(true))
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
              <DialogHost />
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
  usePresenceHeartbeat(!!session && ready && !recovering);

  const [splashDone, setSplashDone] = useState(false);
  const splash = splashDone ? null : (
    // The native splash stays up until this overlay has drawn its first frame,
    // so the two look like one continuous screen.
    <AnimatedSplash ready={ready} onShown={() => SplashScreen.hideAsync().catch(() => {})} onFinish={() => setSplashDone(true)} />
  );

  const signedIn = !!session && !recovering;

  // The splash keeps one place in the tree whether or not the app is ready:
  // moving it (it used to be returned alone, then nested below) remounted
  // it the moment sign-in finished, restarting its animation mid-play.
  return (
    <>
      {ready ? <AppTree signedIn={signedIn} isDark={isDark} bg={colors.bg} rtl={languageIsRtl(i18n.language)} /> : null}
      {splash}
    </>
  );
}

function AppTree({ signedIn, isDark, bg, rtl }: { signedIn: boolean; isDark: boolean; bg: string; rtl: boolean }) {
  return (
    <LocaleProvider direction={rtl ? 'rtl' : 'ltr'}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: bg } }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
      {signedIn ? <CallPill /> : null}
    </LocaleProvider>
  );
}
