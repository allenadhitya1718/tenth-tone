import { useEffect, useState } from 'react';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

// Boot screen shown over the app while it signs in. It opens on the brand
// blue (the native splash in app.json is the same plain blue, so the hand-
// over is seamless), which then settles into the night navy as the FLYP
// logo comes in with a soft glow behind it. (Owner, Nov 2026: no spinning
// dots, start from the blue screen.)
//
// Never holds the app back for longer than MIN_MS. With Reduce Motion on,
// the blue simply fades to the logo.
export const SPLASH_BG = '#000421';
const FLOOD = '#1E56D6'; // theme primary, and the native splash colour
const MARK = 200;
const LOGO_W = 260;
const LOGO_H = (LOGO_W * 230) / 472; // flyp-logo-mark.png is 472x230
const GLOW_MAX = 0.6;

// Timeline (ms).
const HOLD_MS = 220; // the blue on its own, as the native splash showed it
const REVEAL_MS = 620; // blue settles into navy, logo in
const MIN_MS = HOLD_MS + REVEAL_MS + 350;
const OUT_MS = 450;

const SOFT = Easing.bezier(0.22, 1, 0.36, 1);
const BREATHE = Easing.inOut(Easing.sin);

export function AnimatedSplash({ ready, onShown, onFinish }: { ready: boolean; onShown?: () => void; onFinish: () => void }) {
  const { width, height } = useWindowDimensions();
  const calm = useReducedMotion();
  const [minPassed, setMinPassed] = useState(false);

  const reveal = useSharedValue(0); // 0 = all blue, 1 = navy with the logo
  const glow = useSharedValue(0);
  const out = useSharedValue(0);

  useEffect(() => {
    const delay = calm ? 0 : HOLD_MS;
    reveal.value = withDelay(delay, withTiming(1, { duration: calm ? 500 : REVEAL_MS, easing: SOFT }));
    glow.value = withDelay(
      delay,
      calm
        ? withTiming(1, { duration: 500 })
        : withSequence(
            withTiming(1, { duration: REVEAL_MS, easing: SOFT }),
            // A slow, shallow breath while sign-in finishes.
            withRepeat(
              withSequence(withTiming(0.8, { duration: 1500, easing: BREATHE }), withTiming(1, { duration: 1500, easing: BREATHE })),
              -1,
            ),
          ),
    );
    const t = setTimeout(() => setMinPassed(true), calm ? 900 : MIN_MS);
    return () => {
      clearTimeout(t);
      cancelAnimation(reveal);
      cancelAnimation(glow);
    };
  }, [calm, reveal, glow]);

  useEffect(() => {
    if (!ready || !minPassed) return;
    out.value = withTiming(1, { duration: OUT_MS, easing: Easing.inOut(Easing.cubic) }, (fin) => {
      if (fin) runOnJS(onFinish)();
    });
  }, [ready, minPassed, out, onFinish]);

  // Safety net: the app must never stay behind the splash.
  useEffect(() => {
    if (!ready || !minPassed) return;
    const t = setTimeout(onFinish, OUT_MS + 600);
    return () => clearTimeout(t);
  }, [ready, minPassed, onFinish]);

  const root = useAnimatedStyle(() => ({ opacity: 1 - out.value }));
  // Full screen from the first frame, exactly like the native splash.
  const floodStyle = useAnimatedStyle(() => ({ opacity: 1 - reveal.value }));
  const halo = useAnimatedStyle(() => ({ opacity: glow.value * GLOW_MAX }));
  const logo = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [{ scale: interpolate(reveal.value, [0, 1], [0.92, 1]) + out.value * 0.04 }],
  }));

  // A soft pool behind the logo rather than a full-screen wash.
  const d = Math.min(Math.max(width, height) * 0.9, MARK * 3.2);

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.root, root]} onLayout={onShown}>
      {/* A pre-drawn glow image: animating its opacity is cheap, unlike re-rasterising a full-screen SVG gradient each frame. */}
      <Animated.View pointerEvents="none" renderToHardwareTextureAndroid style={[styles.center, { width: d, height: d }, halo]}>
        <Image source={require('../../assets/splash-glow.png')} style={{ width: d, height: d }} resizeMode="stretch" />
      </Animated.View>

      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: FLOOD }, floodStyle]} />

      <Animated.View style={[styles.center, logo]}>
        <Image
          source={require('../../assets/flyp-logo-mark.png')}
          style={{ width: LOGO_W, height: LOGO_H }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </Animated.View>
      <View accessible accessibilityLabel="FLYP" style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: SPLASH_BG, alignItems: 'center', justifyContent: 'center', zIndex: 1000, overflow: 'hidden' },
  center: { position: 'absolute' },
});
