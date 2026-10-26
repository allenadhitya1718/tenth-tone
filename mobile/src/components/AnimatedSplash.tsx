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

// Boot screen shown over the app while it signs in, after a Dribbble
// reference (owner, Oct 2026): two dots, one orbiting the other, merge into
// one, which swells into a flood of the brand colour that gives way to the
// logo. In FLYP's colours: electric-blue dots on the night navy, a blue
// flood that settles into the glow behind the full FLYP logo.
//
// It opens on the exact frame of the native splash (the mark, centred, on
// the same navy) so the hand-off is invisible, and never holds the app back
// for longer than MIN_MS. With Reduce Motion on, the logo simply fades in.
export const SPLASH_BG = '#000421';
const MARK = 200; // same as `imageWidth` for expo-splash-screen in app.json
const DOT = 24;
const ORBIT = 32; // distance of the pale dot from the solid one
const BLUE = '#3D7BFF'; // theme accent
const PALE = '#9DBBFF'; // a light tint of it, like the reference's pale dot
const FLOOD = '#1E56D6'; // theme primary
const LOGO_W = 260;
const LOGO_H = (LOGO_W * 230) / 472; // flyp-logo-mark.png is 472x230
const GLOW_MAX = 0.6;

// Timeline (ms).
const T_DOTS = 150; // dots appear as the native mark shrinks away
const T_ORBIT = 380; // pale dot circles the solid one
const ORBIT_MS = 1050;
const T_MERGE = T_ORBIT + ORBIT_MS; // pale dot slides in
const MERGE_MS = 260;
const T_FLOOD = T_MERGE + MERGE_MS; // merged dot swells over the screen
const FLOOD_MS = 560;
const T_REVEAL = T_FLOOD + FLOOD_MS; // flood settles into the glow, logo in
const REVEAL_MS = 520;
const MIN_MS = T_REVEAL + REVEAL_MS + 250;
const OUT_MS = 450;

const SOFT = Easing.bezier(0.22, 1, 0.36, 1);
const SWING = Easing.inOut(Easing.cubic);
const BREATHE = Easing.inOut(Easing.sin);

export function AnimatedSplash({ ready, onShown, onFinish }: { ready: boolean; onShown?: () => void; onFinish: () => void }) {
  const { width, height } = useWindowDimensions();
  const calm = useReducedMotion();
  const [minPassed, setMinPassed] = useState(false);

  const nativeMark = useSharedValue(1); // the native splash's mark, 1 -> 0
  const dots = useSharedValue(0); // 0 -> 1 appear
  const orbit = useSharedValue(0); // 0 -> 1 = one and a half turns
  const merge = useSharedValue(0); // 0 -> 1 pale dot gone into the solid one
  const flood = useSharedValue(0); // 0 -> 1 circle covers the screen
  const reveal = useSharedValue(0); // 0 -> 1 flood gone, logo in
  const glow = useSharedValue(0);
  const out = useSharedValue(0);

  useEffect(() => {
    const all = [nativeMark, dots, orbit, merge, flood, reveal, glow];
    if (calm) {
      nativeMark.value = withTiming(0, { duration: 400 });
      reveal.value = withTiming(1, { duration: 500 });
      glow.value = withTiming(1, { duration: 500 });
    } else {
      nativeMark.value = withTiming(0, { duration: 320, easing: SOFT });
      dots.value = withDelay(T_DOTS, withTiming(1, { duration: 300, easing: SOFT }));
      orbit.value = withDelay(T_ORBIT, withTiming(1, { duration: ORBIT_MS, easing: SWING }));
      merge.value = withDelay(T_MERGE, withTiming(1, { duration: MERGE_MS, easing: SWING }));
      flood.value = withDelay(T_FLOOD, withTiming(1, { duration: FLOOD_MS, easing: Easing.inOut(Easing.quad) }));
      reveal.value = withDelay(T_REVEAL, withTiming(1, { duration: REVEAL_MS, easing: SOFT }));
      glow.value = withDelay(
        T_REVEAL,
        withSequence(
          withTiming(1, { duration: REVEAL_MS, easing: SOFT }),
          // A slow, shallow breath while sign-in finishes.
          withRepeat(
            withSequence(withTiming(0.8, { duration: 1500, easing: BREATHE }), withTiming(1, { duration: 1500, easing: BREATHE })),
            -1,
          ),
        ),
      );
    }
    const t = setTimeout(() => setMinPassed(true), calm ? 900 : MIN_MS);
    return () => {
      clearTimeout(t);
      all.forEach((v) => cancelAnimation(v));
    };
  }, [calm, nativeMark, dots, orbit, merge, flood, reveal, glow]);

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

  // Big enough to cover the screen from its centre.
  const cover = Math.ceil(Math.hypot(width, height)) + 4;

  const root = useAnimatedStyle(() => ({ opacity: 1 - out.value }));
  const markStyle = useAnimatedStyle(() => ({
    opacity: nativeMark.value,
    transform: [{ scale: 0.25 + nativeMark.value * 0.75 }],
  }));
  const solid = useAnimatedStyle(() => ({
    opacity: dots.value * (1 - flood.value),
    transform: [{ scale: dots.value * (1 + merge.value * 0.3) }],
  }));
  const pale = useAnimatedStyle(() => {
    const a = orbit.value * Math.PI * 3; // one and a half turns
    const r = ORBIT * (1 - merge.value);
    return {
      opacity: dots.value * 0.6 * (1 - merge.value),
      transform: [{ translateX: Math.cos(a) * r }, { translateY: Math.sin(a) * r }, { scale: dots.value }],
    };
  });
  const floodStyle = useAnimatedStyle(() => ({
    opacity: flood.value > 0 ? 1 - reveal.value : 0,
    transform: [{ scale: interpolate(flood.value, [0, 1], [(DOT * 1.3) / cover, 1]) }],
  }));
  const halo = useAnimatedStyle(() => ({ opacity: glow.value * GLOW_MAX }));
  const logo = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [{ scale: 0.92 + reveal.value * 0.08 + out.value * 0.04 }],
  }));

  // A soft pool behind the logo rather than a full-screen wash.
  const d = Math.min(Math.max(width, height) * 0.9, MARK * 3.2);

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.root, root]} onLayout={onShown}>
      {/* A pre-drawn glow image: animating its opacity is cheap, unlike re-rasterising a full-screen SVG gradient each frame. */}
      <Animated.View pointerEvents="none" renderToHardwareTextureAndroid style={[styles.center, { width: d, height: d }, halo]}>
        <Image source={require('../../assets/splash-glow.png')} style={{ width: d, height: d }} resizeMode="stretch" />
      </Animated.View>

      <Animated.View style={[styles.center, markStyle]}>
        <Image source={require('../../assets/splash-mark.png')} style={{ width: MARK, height: MARK }} resizeMode="contain" />
      </Animated.View>

      <Animated.View style={[styles.center, { width: cover, height: cover, borderRadius: cover / 2, backgroundColor: FLOOD }, floodStyle]} />

      <Animated.View style={[styles.center, styles.dot, { backgroundColor: PALE }, pale]} />
      <Animated.View style={[styles.center, styles.dot, styles.solid, solid]} />

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
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  solid: {
    backgroundColor: BLUE,
    shadowColor: BLUE,
    shadowOpacity: 0.8,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
});
