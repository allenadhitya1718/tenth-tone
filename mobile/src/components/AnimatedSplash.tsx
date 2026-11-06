import { useEffect, useState } from 'react';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

// Boot screen shown over the app while it signs in. It opens exactly as the
// native splash in app.json ends: the FLYP logo on the night navy, same size
// and place, so the hand-over cannot be seen. A soft glow comes up behind
// the logo, then the screen fades into the app. (Owner, Nov 2026: no
// spinning dots, no plain blue screen; the FLYP screen straight away.)
//
// LOGO_W must equal expo-splash-screen's imageWidth in app.json. 180 is the
// largest this wide logo can be and still fit the circle Android 12+ clips
// the native splash icon to (192 dp across).
//
// Never holds the app back for longer than MIN_MS. With Reduce Motion on,
// there is no glow pulse and no zoom.
export const SPLASH_BG = '#000421';
const MARK = 200;
const LOGO_W = 180;
const LOGO_H = (LOGO_W * 230) / 472; // flyp-logo-mark.png is 472x230
const GLOW_MAX = 0.6;

// Timeline (ms).
const GLOW_IN_MS = 600; // the glow comes up behind the logo
const MIN_MS = GLOW_IN_MS + 200;
const OUT_MS = 400;

const SOFT = Easing.bezier(0.22, 1, 0.36, 1);
const BREATHE = Easing.inOut(Easing.sin);

export function AnimatedSplash({ ready, onShown, onFinish }: { ready: boolean; onShown?: () => void; onFinish: () => void }) {
  const { width, height } = useWindowDimensions();
  const calm = useReducedMotion();
  const [minPassed, setMinPassed] = useState(false);

  const glow = useSharedValue(0);
  const out = useSharedValue(0);

  useEffect(() => {
    glow.value = calm
      ? withTiming(1, { duration: 400 })
      : withSequence(
          withTiming(1, { duration: GLOW_IN_MS, easing: SOFT }),
          // A slow, shallow breath while sign-in finishes.
          withRepeat(
            withSequence(withTiming(0.8, { duration: 1500, easing: BREATHE }), withTiming(1, { duration: 1500, easing: BREATHE })),
            -1,
          ),
        );
    const t = setTimeout(() => setMinPassed(true), calm ? 500 : MIN_MS);
    return () => {
      clearTimeout(t);
      cancelAnimation(glow);
    };
  }, [calm, glow]);

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
  const halo = useAnimatedStyle(() => ({ opacity: glow.value * GLOW_MAX }));
  // On screen from the first frame, as the native splash left it; a slight
  // zoom as the splash fades out (none with Reduce Motion).
  const logo = useAnimatedStyle(() => ({ transform: [{ scale: 1 + (calm ? 0 : out.value * 0.04) }] }));

  // A soft pool behind the logo rather than a full-screen wash.
  const d = Math.min(Math.max(width, height) * 0.9, MARK * 3.2);

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.root, root]} onLayout={onShown}>
      {/* A pre-drawn glow image: animating its opacity is cheap, unlike re-rasterising a full-screen SVG gradient each frame. */}
      <Animated.View pointerEvents="none" renderToHardwareTextureAndroid style={[styles.center, { width: d, height: d }, halo]}>
        <Image source={require('../../assets/splash-glow.png')} style={{ width: d, height: d }} resizeMode="stretch" />
      </Animated.View>

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
