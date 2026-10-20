import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type LayoutChangeEvent, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDuration } from '@/features/live/config';
import { languageIsRtl } from '@/i18n';

import { hangUp, isCallActive, useCallState } from './callSession';
import { openCallScreen } from './nav';

// The bar that brings a minimised call back, the web app's call-pill. Shown on
// every screen except the call itself while a call is ringing out or running.
// Mount once, after the root <Stack> (it floats over it).
//
// It sat centred over every header and hid the name of the person you were
// chatting with, so it can now be dragged anywhere and settles on the nearest
// side edge, always inside the safe area: never under the status bar, never
// over the tab bar or the home indicator. It starts just below a header on the
// end side (right in English, left in Arabic and Urdu) and keeps wherever it
// was put for the rest of the session. A tap still opens the call; the red
// button still hangs up.
const MARGIN = 10;
// A screen header (TopBar) under the status bar, so the default spot clears it.
const HEADER_H = 56;
// The tab bar above the home indicator; the pill never goes over it.
const TAB_BAR_H = 64;

// Where it was left, for the session: which side and how far down.
let saved: { side: 'end' | 'left' | 'right'; y: number | null } = { side: 'end', y: null };
function remember(side: 'left' | 'right', y: number) {
  saved = { side, y };
}

export function CallPill() {
  const { t, i18n } = useTranslation();
  const s = useCallState();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [now, setNow] = useState(() => Date.now());
  const [size, setSize] = useState({ w: 0, h: 0 });
  const rtl = languageIsRtl(i18n.language);

  const visible = isCallActive(s) && s.phase !== 'incoming' && s.phase !== 'loading' && !!s.callId && !pathname.startsWith('/call');

  useEffect(() => {
    if (!visible || !s.startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [visible, s.startedAt]);

  const minY = insets.top + 4;
  const maxY = Math.max(minY, screenH - insets.bottom - TAB_BAR_H - size.h - 4);
  const leftX = MARGIN;
  const rightX = Math.max(MARGIN, screenW - size.w - MARGIN);
  const side: 'left' | 'right' = saved.side !== 'end' ? saved.side : rtl ? 'left' : 'right';
  const restX = side === 'left' ? leftX : rightX;
  const restY = Math.min(maxY, Math.max(minY, saved.y ?? insets.top + HEADER_H + 6));

  const x = useSharedValue(restX);
  const y = useSharedValue(restY);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const dragging = useSharedValue(false);

  // Back to its resting place when the size, the screen or the insets change
  // (rotation, a longer name, the keyboard) - unless a finger is on it.
  // The first placement, once the pill has a size, is instant.
  const placed = useRef(false);
  useEffect(() => {
    if (dragging.get()) return;
    if (!size.w) {
      placed.current = false;
      return;
    }
    if (!placed.current) {
      placed.current = true;
      x.set(restX);
      y.set(restY);
      return;
    }
    x.set(withSpring(restX, { damping: 20 }));
    y.set(withSpring(restY, { damping: 20 }));
  }, [restX, restY, size.w, x, y, dragging]);

  const pan = Gesture.Pan()
    .minDistance(6)
    .onBegin(() => {
      startX.set(x.get());
      startY.set(y.get());
    })
    .onStart(() => {
      dragging.set(true);
    })
    .onUpdate((e) => {
      x.set(Math.min(rightX, Math.max(leftX, startX.get() + e.translationX)));
      y.set(Math.min(maxY, Math.max(minY, startY.get() + e.translationY)));
    })
    .onFinalize(() => {
      if (!dragging.get()) return;
      dragging.set(false);
      const toRight = x.get() + size.w / 2 > screenW / 2;
      const endY = y.get();
      x.set(withSpring(toRight ? rightX : leftX, { damping: 18 }));
      runOnJS(remember)(toRight ? 'right' : 'left', endY);
    });

  const moved = useAnimatedStyle(() => ({
    opacity: size.w ? 1 : 0,
    transform: [{ translateX: x.get() }, { translateY: y.get() }],
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
  };

  if (!visible) return null;
  const name = s.peer?.name || s.peer?.handle || t('call.someone');
  const status =
    s.phase === 'connected' && s.startedAt
      ? formatDuration((now - s.startedAt) / 1000)
      : s.phase === 'connecting'
        ? t('call.connecting')
        : t('call.calling');

  return (
    <View style={styles.area} pointerEvents="box-none">
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.float, moved]} onLayout={onLayout}>
          <Pressable
            onPress={() => s.callId && openCallScreen(s.callId)}
            style={[styles.pill, { maxWidth: screenW * 0.86, direction: rtl ? 'rtl' : 'ltr' }]}
            accessibilityRole="button"
            accessibilityLabel={t('call.pillA11y', { name, status })}
            accessibilityHint={t('call.pillHint')}
          >
            <Ionicons name={s.kind === 'video' ? 'videocam' : 'call'} size={16} color="#FFFFFF" />
            <Text style={styles.text} numberOfLines={1}>
              {name} · {status}
            </Text>
            <Pressable
              onPress={() => hangUp()}
              hitSlop={10}
              style={styles.end}
              accessibilityRole="button"
              accessibilityLabel={t('call.end')}
            >
              <Ionicons name="call" size={14} color="#FFFFFF" style={styles.endIcon} />
            </Pressable>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  // Physical coordinates in every language: x is the distance from the left.
  area: { ...(StyleSheet.absoluteFill as object), direction: 'ltr' },
  float: { position: 'absolute', top: 0, left: 0 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#16A34A',
    borderRadius: 20,
    paddingStart: 14,
    paddingEnd: 6,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  text: { color: '#FFFFFF', fontWeight: '700', fontSize: 13.5, flexShrink: 1, fontVariant: ['tabular-nums'] },
  end: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center' },
  endIcon: { transform: [{ rotate: '135deg' }] },
});
