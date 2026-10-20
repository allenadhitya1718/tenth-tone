import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/providers/ThemeProvider';

type Toast = { id: number; text: string; icon: keyof typeof Ionicons.glyphMap; tone: 'success' | 'error' };

// A short confirmation that slides in under the status bar and leaves on
// its own, in place of the system alert box ("Posted" / OK) that looked out
// of place. Any screen calls showToast(); <ToastHost /> sits once at the root.
let push: ((t: Toast) => void) | null = null;
let nextId = 1;

export function showToast(text: string, icon: Toast['icon'] = 'checkmark-circle', tone: Toast['tone'] = 'success') {
  push?.({ id: nextId++, text, icon, tone });
}

const VISIBLE_MS = 2200;

export function ToastHost() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<Toast | null>(null);
  const shown = useSharedValue(0);
  const pillStyle = useAnimatedStyle(() => ({
    opacity: shown.get(),
    transform: [{ translateY: (1 - shown.get()) * -24 }],
  }));

  useEffect(() => {
    push = (t) => setToast(t);
    return () => {
      push = null;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    void Haptics.notificationAsync(toast.tone === 'error' ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Success);
    AccessibilityInfo.announceForAccessibility(toast.text);
    shown.set(
      withSequence(
        withTiming(0, { duration: 0 }),
        withSpring(1, { damping: 18, stiffness: 220 }),
        withDelay(VISIBLE_MS, withTiming(0, { duration: 220 })),
      ),
    );
    // Unmount once the fade-out is over; a newer toast restarts this.
    const done = setTimeout(() => setToast(null), VISIBLE_MS + 700);
    return () => clearTimeout(done);
  }, [toast, shown]);

  if (!toast) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 10 }]}>
      <Animated.View
        style={[
          styles.pill,
          { backgroundColor: colors.bg2, borderColor: colors.border },
          pillStyle,
        ]}
      >
        <Ionicons name={toast.icon} size={22} color={toast.tone === 'error' ? colors.danger : colors.success} />
        <Text style={[styles.text, { color: colors.text }]} numberOfLines={2}>
          {toast.text}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', start: 0, end: 0, alignItems: 'center', zIndex: 1000, elevation: 1000 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: '88%',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
});
