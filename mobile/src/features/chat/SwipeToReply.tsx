import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { type ReactNode, useCallback, useMemo } from 'react';
import { I18nManager, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { useTheme } from '@/providers/ThemeProvider';

// Swipe a message toward the end side (right in English, left in Arabic) to
// reply, like WhatsApp and Instagram. A reply arrow fades in from the start
// edge; past THRESHOLD there is a tick of haptics and letting go replies
// (dragging back under it cancels). The bubble always springs back.
//
// Only a clearly sideways drag in that one direction activates: a vertical
// move fails the gesture at once so the list scrolls, a drag the other way
// fails too, and a tap or long press never moves far enough to activate, so
// media, links and the long-press menu work as before. Screen readers get a
// "Reply" accessibility action on the bubble instead (MessageBubble).
const THRESHOLD = 64;
const MAX = 96;
const ACTIVATE = 14;
const FAR = 10_000;

export function SwipeToReply({
  enabled,
  onReply,
  children,
}: {
  enabled: boolean;
  onReply: () => void;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const x = useSharedValue(0);
  const armed = useSharedValue(false);
  // Physical direction of "toward the end side".
  const dir = I18nManager.isRTL ? -1 : 1;

  const tick = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .activeOffsetX(dir > 0 ? [-FAR, ACTIVATE] : [-ACTIVATE, FAR])
        .failOffsetX(dir > 0 ? [-ACTIVATE, FAR] : [-FAR, ACTIVATE])
        .failOffsetY([-12, 12])
        .onUpdate((e) => {
          const d = Math.max(0, e.translationX * dir);
          // Rubber band past MAX.
          const eased = d > MAX ? MAX + (d - MAX) * 0.2 : d;
          x.set(eased * dir);
          if (d >= THRESHOLD && !armed.get()) {
            armed.set(true);
            runOnJS(tick)();
          } else if (d < THRESHOLD && armed.get()) {
            armed.set(false);
          }
        })
        .onEnd(() => {
          if (armed.get()) runOnJS(onReply)();
        })
        .onFinalize(() => {
          armed.set(false);
          x.set(withSpring(0, { damping: 20, stiffness: 260 }));
        }),
    [enabled, dir, onReply, tick, x, armed],
  );

  const moved = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const arrow = useAnimatedStyle(() => {
    const p = Math.abs(x.get()) / THRESHOLD;
    return {
      opacity: interpolate(p, [0.15, 1], [0, 1], Extrapolation.CLAMP),
      transform: [{ scale: interpolate(p, [0, 1, 1.4], [0.5, 1, 1.1], Extrapolation.CLAMP) }],
    };
  });

  if (!enabled) return <>{children}</>;
  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[styles.arrowWrap, arrow]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Animated.View style={[styles.arrow, { backgroundColor: colors.bg2 }]}>
          <Ionicons name={I18nManager.isRTL ? 'arrow-redo' : 'arrow-undo'} size={18} color={colors.text} />
        </Animated.View>
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={moved}>{children}</Animated.View>
      </GestureDetector>
    </>
  );
}

const styles = StyleSheet.create({
  arrowWrap: { position: 'absolute', top: 0, bottom: 0, start: 14, justifyContent: 'center' },
  arrow: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
