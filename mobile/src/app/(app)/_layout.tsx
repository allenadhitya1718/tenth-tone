import { useQuery } from '@tanstack/react-query';
import { router, Stack, usePathname, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { fetchBirthDateStrict, settingsKeys } from '@/api/settings';
import { cleanupRecordings } from '@/features/live/liveRecording';
import { recoverPendingCamera } from '@/lib/pendingCamera';
import { useShareIntentContext } from 'expo-share-intent';

import { useTheme } from '@/providers/ThemeProvider';

// A screen that throws while rendering shows a recovery screen instead of
// closing the app (components/AppErrorBoundary.tsx).
export { AppErrorBoundary as ErrorBoundary } from '@/components/AppErrorBoundary';

// A call covers everything and is never swiped away by accident: ending it
// is a deliberate button.
const CALL_SCREEN = {
  presentation: 'fullScreenModal',
  animation: 'slide_from_bottom',
  gestureEnabled: false,
  contentStyle: { backgroundColor: '#000421' },
} as const;

export default function AppLayout() {
  const { colors } = useTheme();
  // Settles coin purchases left unfinished (app killed mid-verification)
  // as soon as someone is signed in, not only when the wallet opens.
  // Loaded lazily: a build without the store module must still start.
  useEffect(() => {
    import('@/features/wallet/store')
      .then((m) => m.startStorePurchaseRecovery())
      .catch(() => {});
  }, []);

  // Live recordings (kept for highlights) older than 2 days, or beyond the
  // 3 newest, are deleted so they never fill the phone (liveRecording.ts).
  useEffect(() => {
    cleanupRecordings();
  }, []);

  // Android killed the app while its camera was open: reopen the story or
  // chat that asked, with the photo (lib/pendingCamera.ts).
  useEffect(() => {
    void recoverPendingCamera();
  }, []);

  // A photo or video shared into FLYP from another app. On Android it arrives
  // as an event, not a link, so +native-intent never sees it and FLYP just
  // opened on Home with the photo dropped (found testing on the Redmi). Open
  // the Share screen whenever one is waiting (after sign-in too).
  const { hasShareIntent } = useShareIntentContext();
  const pathNow = usePathname();
  useEffect(() => {
    if (hasShareIntent && pathNow !== '/share') router.push('/share' as Href);
  }, [hasShareIntent, pathNow]);

  // An account without a birthday is asked for it once, right after signing
  // in (owner request): Apple / phone sign-in and accounts from the earlier
  // app never asked. Only on a clean "no birthday" answer, never because a
  // read failed.
  const birth = useQuery({ queryKey: settingsKeys.birthDate(), queryFn: fetchBirthDateStrict, staleTime: 5 * 60_000 });
  const pathname = usePathname();
  const needsBirthday = birth.isSuccess && birth.data === null;
  useEffect(() => {
    if (needsBirthday && pathname !== '/confirm-birthday') router.replace('/confirm-birthday');
  }, [needsBirthday, pathname]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      {/* Comments slide up over the feed. A transparent modal with the panel
          drawn by the screen itself: a formSheet laid its content out at full
          height, which pushed the composer below the visible part. */}
      <Stack.Screen
        name="comments/[id]"
        options={{ presentation: 'transparentModal', animation: 'slide_from_bottom', contentStyle: { backgroundColor: 'transparent' } }}
      />
      <Stack.Screen name="search" options={{ animation: 'fade' }} />
      <Stack.Screen name="camera" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="live/[id]" options={{ animation: 'fade', contentStyle: { backgroundColor: '#000421' } }} />
      {/* The story is a transparent modal so a swipe down shows the feed behind it. */}
      <Stack.Screen
        name="stories/[userId]"
        options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }}
      />
      {/* Android draws a full-screen modal without the status bar inset, so
          the header sat under the clock; a plain screen sliding up looks the same. */}
      <Stack.Screen
        name="stories/new"
        options={{ presentation: Platform.OS === 'ios' ? 'fullScreenModal' : 'card', animation: 'slide_from_bottom' }}
      />
      <Stack.Screen name="map" options={{ animation: 'slide_from_bottom' }} />
      {/* /highlight/<id> only redirects into the For You feed. */}
      <Stack.Screen name="highlight/[id]" options={{ animation: 'none', contentStyle: { backgroundColor: '#000421' } }} />
      <Stack.Screen name="confirm-birthday" options={{ gestureEnabled: false }} />
      <Stack.Screen name="call/[id]" options={CALL_SCREEN} />
      <Stack.Screen name="call/dial" options={CALL_SCREEN} />
    </Stack>
  );
}
