import { useEffect, useState } from 'react';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

// Boot screen shown over the app while it signs in. It opens on the exact
// frame of the native splash (the mark, centred, on the same navy) so the
// hand-off is invisible, then plays one short beat: a soft glow blooms, three
// sound-wave rings ripple out of the mark, and the whole thing fades away.
// It never holds the app back for longer than MIN_MS.
export const SPLASH_BG = '#000421';
const MARK = 200; // same as `imageWidth` for expo-splash-screen in app.json
const MIN_MS = 2200;
const OUT_MS = 380;
const RING_GAP = 380;

function Ring({ delay, size }: { delay: number; size: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(delay, withTiming(1, { duration: 1500, easing: Easing.out(Easing.cubic) }));
    return () => cancelAnimation(p);
  }, [delay, p]);
  const a = useAnimatedStyle(() => ({
    opacity: (1 - p.value) * (p.value === 0 ? 0 : 0.55),
    transform: [{ scale: 0.55 + p.value * 1.35 }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: '#3B82F6' },
        a,
      ]}
    />
  );
}

export function AnimatedSplash({ ready, onShown, onFinish }: { ready: boolean; onShown?: () => void; onFinish: () => void }) {
  const { width, height } = useWindowDimensions();
  const [minPassed, setMinPassed] = useState(false);
  const glow = useSharedValue(0);
  const out = useSharedValue(0);

  useEffect(() => {
    glow.value = withDelay(
      250,
      withSequence(
        withTiming(1, { duration: 700, easing: Easing.out(Easing.quad) }),
        withRepeat(withSequence(withTiming(0.72, { duration: 700 }), withTiming(1, { duration: 700 })), -1),
      ),
    );
    const t = setTimeout(() => setMinPassed(true), MIN_MS);
    return () => clearTimeout(t);
  }, [glow]);

  useEffect(() => {
    if (!ready || !minPassed) return;
    out.value = withTiming(1, { duration: OUT_MS, easing: Easing.in(Easing.quad) }, (fin) => {
      if (fin) runOnJS(onFinish)();
    });
  }, [ready, minPassed, out, onFinish]);

  const root = useAnimatedStyle(() => ({ opacity: 1 - out.value }));
  // Starts exactly as the native splash shows it (full size, full opacity).
  const mark = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + glow.value * 0.035 + out.value * 0.06 }],
  }));
  const halo = useAnimatedStyle(() => ({ opacity: glow.value }));

  const d = Math.max(width, height) * 1.1;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, root]} onLayout={onShown}>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: d, height: d }, halo]}>
        <Svg width={d} height={d}>
          <Defs>
            <RadialGradient id="g" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#2563EB" stopOpacity="0.34" />
              <Stop offset="0.45" stopColor="#1E56D6" stopOpacity="0.12" />
              <Stop offset="1" stopColor="#000421" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect width={d} height={d} fill="url(#g)" />
        </Svg>
      </Animated.View>
      {[0, 1, 2].map((i) => (
        <Ring key={i} delay={500 + i * RING_GAP} size={MARK * 1.05} />
      ))}
      <Animated.View style={mark}>
        <Image source={require('../../assets/splash-mark.png')} style={{ width: MARK, height: MARK }} resizeMode="contain" />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: SPLASH_BG, alignItems: 'center', justifyContent: 'center', zIndex: 1000, overflow: 'hidden' },
});
