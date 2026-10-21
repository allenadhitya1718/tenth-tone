import { useEffect, useState } from 'react';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

// Boot screen shown over the app while it signs in. It opens on the exact
// frame of the native splash (the mark, centred, on the same navy) so the
// hand-off is invisible, then plays one short beat: a soft glow blooms, three
// sound-wave rings ripple out of the mark, and the whole thing fades away.
// It never holds the app back for longer than MIN_MS.
export const SPLASH_BG = '#000421';
const MARK = 200; // same as `imageWidth` for expo-splash-screen in app.json
const MIN_MS = 2200;
const OUT_MS = 480;
const RING_GAP = 420;
// Gentle ease-out (no hard start or stop), shared by the beats below.
const SOFT = Easing.bezier(0.22, 1, 0.36, 1);
const BREATHE = Easing.inOut(Easing.sin);

function Ring({ delay, size }: { delay: number; size: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(delay, withTiming(1, { duration: 1900, easing: SOFT }));
    return () => cancelAnimation(p);
  }, [delay, p]);
  // Fades in as it leaves the mark and out as it spreads: it used to appear
  // at full strength on its first frame, which read as a flicker.
  const a = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.12, 1], [0, 0.5, 0]),
    transform: [{ scale: 0.6 + p.value * 1.3 }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      renderToHardwareTextureAndroid
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
        withTiming(1, { duration: 900, easing: SOFT }),
        withRepeat(
          withSequence(withTiming(0.75, { duration: 1100, easing: BREATHE }), withTiming(1, { duration: 1100, easing: BREATHE })),
          -1,
        ),
      ),
    );
    const t = setTimeout(() => setMinPassed(true), MIN_MS);
    return () => clearTimeout(t);
  }, [glow]);

  useEffect(() => {
    if (!ready || !minPassed) return;
    out.value = withTiming(1, { duration: OUT_MS, easing: Easing.inOut(Easing.cubic) }, (fin) => {
      if (fin) runOnJS(onFinish)();
    });
  }, [ready, minPassed, out, onFinish]);

  useEffect(() => {
    if (!ready || !minPassed) return;
    const t = setTimeout(onFinish, OUT_MS + 600);
    return () => clearTimeout(t);
  }, [ready, minPassed, onFinish]);

  const root = useAnimatedStyle(() => ({ opacity: 1 - out.value }));
  // Starts exactly as the native splash shows it (full size, full opacity).
  const mark = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + glow.value * 0.035 + out.value * 0.06 }],
  }));
  const halo = useAnimatedStyle(() => ({ opacity: glow.value }));

  const d = Math.max(width, height) * 1.1;

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.root, root]} onLayout={onShown}>
      {/* A pre-drawn glow image: animating its opacity is cheap, unlike re-rasterising a full-screen SVG gradient each frame. */}
      <Animated.View pointerEvents="none" renderToHardwareTextureAndroid style={[{ position: 'absolute', width: d, height: d }, halo]}>
        <Image source={require('../../assets/splash-glow.png')} style={{ width: d, height: d }} resizeMode="stretch" />
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
