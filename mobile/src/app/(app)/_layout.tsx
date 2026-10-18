import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { useTheme } from '@/providers/ThemeProvider';

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
      <Stack.Screen name="stories/new" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="map" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="call/[id]" options={CALL_SCREEN} />
      <Stack.Screen name="call/dial" options={CALL_SCREEN} />
    </Stack>
  );
}
