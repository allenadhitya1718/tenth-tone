import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';

import { useTheme } from '@/providers/ThemeProvider';

// KLIPY's attribution guide (the brand files they sent): the GIF picker shows
// "Powered by KLIPY" by the search bar, and a sent GIF carries the
// semi-transparent white KLIPY mark in its bottom-left corner. The official
// PNGs, scaled down, in assets/klipy.
const POWERED_BLACK = require('../../../assets/klipy/powered-black.png');
const POWERED_WHITE = require('../../../assets/klipy/powered-white.png');
const WATERMARK = require('../../../assets/klipy/watermark.png');

/** "Powered by KLIPY", black on light themes and white on dark. */
export function PoweredByKlipy() {
  const { isDark } = useTheme();
  return (
    <Image
      source={isDark ? POWERED_WHITE : POWERED_BLACK}
      style={styles.powered}
      contentFit="contain"
      accessible
      accessibilityLabel="Powered by KLIPY"
    />
  );
}

/** The mark on a sent KLIPY GIF; sits inside the GIF's clipping view. */
export function KlipyWatermark() {
  return <Image source={WATERMARK} style={styles.watermark} contentFit="contain" accessible={false} pointerEvents="none" />;
}

const styles = StyleSheet.create({
  // 247 x 42 source.
  powered: { width: 82, height: 14, opacity: 0.85 },
  // 153 x 42 source.
  watermark: { position: 'absolute', start: 7, bottom: 6, width: 33, height: 9, opacity: 0.75 },
});
