import { useState } from 'react';
import { I18nManager, Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { RenderModeType, RtcSurfaceView, RtcTextureView } from 'react-native-agora';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

// This phone's camera in a small window over the other person's picture.
// Drag it anywhere; it settles in the nearest corner on release.
//
// Android draws it with a TextureView: a SurfaceView punches a hole through
// the window, so a moving one smears and can end up under the full-screen
// remote view. iOS has only the one kind of view.
const W = 104;
const H = 156;
const MARGIN = 12;

export function LocalPip({ top, bottom, label }: { top: number; bottom: number; label: string }) {
  const [area, setArea] = useState({ w: 0, h: 0 });
  // Starts in the top corner on the end side (top-right in English, top-left in Arabic).
  const x = useSharedValue<number | null>(null);
  const y = useSharedValue(top);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea({ w: width, h: height });
    if (x.get() === null) x.set(I18nManager.isRTL ? MARGIN : width - W - MARGIN);
  };

  const maxX = Math.max(MARGIN, area.w - W - MARGIN);
  const maxY = Math.max(top, area.h - H - bottom);

  const pan = Gesture.Pan()
    .onBegin(() => {
      startX.set(x.get() ?? 0);
      startY.set(y.get());
    })
    .onUpdate((e) => {
      x.set(Math.min(maxX, Math.max(MARGIN, startX.get() + e.translationX)));
      y.set(Math.min(maxY, Math.max(top, startY.get() + e.translationY)));
    })
    .onEnd((e) => {
      const cx = (x.get() ?? 0) + W / 2 + e.velocityX * 0.1;
      const cy = y.get() + H / 2 + e.velocityY * 0.1;
      x.set(withSpring(cx < area.w / 2 ? MARGIN : maxX, { damping: 18 }));
      y.set(withSpring(cy < area.h / 2 ? top : maxY, { damping: 18 }));
    });

  const style = useAnimatedStyle(() => ({
    opacity: x.get() === null ? 0 : 1,
    transform: [{ translateX: x.get() ?? 0 }, { translateY: y.get() }],
  }));

  const canvas = { uid: 0, renderMode: RenderModeType.RenderModeHidden };
  return (
    <View style={[StyleSheet.absoluteFill, styles.area]} pointerEvents="box-none" onLayout={onLayout}>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[styles.pip, style]}
          accessible
          accessibilityLabel={label}
        >
          {Platform.OS === 'android' ? (
            <RtcTextureView style={StyleSheet.absoluteFill} canvas={canvas} />
          ) : (
            <RtcSurfaceView style={StyleSheet.absoluteFill} canvas={canvas} zOrderMediaOverlay />
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  // Laid out left-to-right in every language, so `left` and translateX are
  // both physical and x is simply the distance from the left edge.
  area: { direction: 'ltr' },
  pip: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: W,
    height: H,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#0A1236',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
});
