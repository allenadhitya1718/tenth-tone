import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { REACTIONS } from './config';

// Floating reactions (port of floatHeart / the reaction tray in V.live).

type Floater = { id: number; emoji: string; drift: number; rise: number; offset: number };

// At most this many in flight: a burst from a busy room must not pile up
// hundreds of animated views.
const MAX_FLOATERS = 24;

export function useFloaters() {
  const [items, setItems] = useState<Floater[]>([]);
  const seq = useRef(0);
  const spawn = useCallback((emoji: string) => {
    const id = ++seq.current;
    setItems((list) =>
      [
        ...list,
        { id, emoji, drift: (Math.random() - 0.5) * 80, rise: 300 + Math.random() * 200, offset: 16 + Math.random() * 40 },
      ].slice(-MAX_FLOATERS),
    );
  }, []);
  const done = useCallback((id: number) => setItems((list) => list.filter((f) => f.id !== id)), []);
  return { items, spawn, done };
}

export function FloaterLayer({ items, onDone }: { items: Floater[]; onDone: (id: number) => void }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {items.map((f) => (
        <FloatingEmoji key={f.id} floater={f} onDone={onDone} />
      ))}
    </View>
  );
}

const FloatingEmoji = memo(function FloatingEmoji({ floater, onDone }: { floater: Floater; onDone: (id: number) => void }) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const a = Animated.timing(v, { toValue: 1, duration: 2400, easing: Easing.out(Easing.quad), useNativeDriver: true });
    a.start(() => onDone(floater.id));
    return () => a.stop();
  }, [floater.id, onDone, v]);
  return (
    <Animated.Text
      style={[
        styles.floater,
        {
          end: floater.offset,
          opacity: v.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0.8, 0] }),
          transform: [
            { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -floater.rise] }) },
            { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, floater.drift] }) },
            { scale: v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.6, 1.1, 0.9] }) },
          ],
        },
      ]}
    >
      {floater.emoji}
    </Animated.Text>
  );
});

// The tray of six reactions above the heart button. It closes on a tap
// anywhere outside it (client note 29) and on its own after four seconds of
// no taps, so it never sits over the room; each tap restarts the clock.
export function ReactionTray({
  open,
  onPick,
  onClose,
  bottom,
}: {
  open: boolean;
  onPick: (emoji: string) => void;
  onClose: () => void;
  bottom: number;
}) {
  const { t } = useTranslation();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(onClose, 4000);
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    arm();
    AccessibilityInfo.announceForAccessibility(t('live.reactions.opened'));
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [open, arm, t]);

  if (!open) return null;
  return (
    <>
      {/* Catches the outside tap. Below the tray, above everything else. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('live.reactions.close')}
      />
      <View style={[styles.tray, { bottom }]} accessibilityRole="toolbar" accessibilityLabel={t('live.reactions.title')}>
        {REACTIONS.map((e) => (
          <Pressable
            key={e}
            onPress={() => {
              onPick(e);
              arm();
            }}
            style={styles.trayBtn}
            accessibilityRole="button"
            accessibilityLabel={t('live.reactions.send', { emoji: e })}
          >
            <Text style={styles.trayEmoji}>{e}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  floater: { position: 'absolute', bottom: 90, fontSize: 28 },
  tray: {
    position: 'absolute',
    end: 12,
    flexDirection: 'row',
    gap: 2,
    padding: 4,
    borderRadius: 28,
    backgroundColor: 'rgba(10,18,54,0.92)',
  },
  trayBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  trayEmoji: { fontSize: 26 },
});
