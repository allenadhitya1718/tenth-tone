import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, Path, Pattern, Rect } from 'react-native-svg';

import { useTheme } from '@/providers/ThemeProvider';

import { themeFor } from './themes';

// Client note 10 ("patterns or drawings" behind the messages, as WhatsApp
// does), and the chat themes the members can pick (0149): a solid colour, a
// gradient or a photo instead of the default doodle. Hidden from screen
// readers; never takes touches.
const TILE = 140;

export const ChatBackground = memo(function ChatBackground({
  theme,
  wallpaper,
}: {
  theme?: string | null;
  wallpaper?: string | null;
}) {
  const { isDark } = useTheme();
  const th = themeFor(theme, wallpaper);
  const palette = isDark ? th.dark : th.light;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
      {th.kind === 'solid' ? <View style={[StyleSheet.absoluteFill, { backgroundColor: palette[0] }]} /> : null}
      {th.kind === 'gradient' ? (
        <LinearGradient colors={[palette[0], palette[1]]} style={StyleSheet.absoluteFill} />
      ) : null}
      {th.kind === 'photo' && wallpaper ? (
        <>
          <Image source={{ uri: wallpaper }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
          {/* A light veil so bubbles and day labels stay readable on any photo. */}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(0,0,0,0.38)' : 'rgba(0,0,0,0.08)' }]} />
        </>
      ) : null}
      {th.kind === 'doodle' ? <Doodles /> : null}
    </View>
  );
});

// The default: one repeating vector tile in the theme's own text colour at
// very low opacity, so it follows light/dark without an image file and
// never competes with the bubbles.
const Doodles = memo(function Doodles() {
  const { colors, isDark } = useTheme();
  const stroke = colors.text;
  const opacity = isDark ? 0.06 : 0.05;
  return (
    <Svg width="100%" height="100%">
      <Defs>
        <Pattern id="chat-doodles" patternUnits="userSpaceOnUse" width={TILE} height={TILE}>
          <G stroke={stroke} strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={opacity}>
            {/* speech bubble */}
            <Path d="M14 16h26a6 6 0 0 1 6 6v12a6 6 0 0 1-6 6H26l-7 6v-6h-5a6 6 0 0 1-6-6V22a6 6 0 0 1 6-6z" />
            {/* heart */}
            <Path d="M92 30c-3-6-13-5-13 3 0 6 8 10 13 15 5-5 13-9 13-15 0-8-10-9-13-3z" />
            {/* music note */}
            <Path d="M122 8v18" />
            <Path d="M122 8l10 3" />
            <Circle cx={118} cy={27} r={4} />
            {/* star */}
            <Path d="M30 72l3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1z" />
            {/* camera */}
            <Rect x={70} y={70} width={26} height={18} rx={4} />
            <Circle cx={83} cy={79} r={5} />
            <Path d="M77 70l3-4h6l3 4" />
            {/* smile */}
            <Circle cx={122} cy={86} r={10} />
            <Path d="M117 89c2 3 8 3 10 0" />
            <Path d="M118 83h.01M126 83h.01" />
            {/* sparkle */}
            <Path d="M18 118v10M13 123h10" />
            {/* paper plane */}
            <Path d="M58 112l30-10-12 28-5-11z" />
            <Path d="M71 119l17-17" />
            {/* dots */}
            <Circle cx={110} cy={124} r={1.5} />
            <Circle cx={120} cy={128} r={1.5} />
            <Circle cx={130} cy={122} r={1.5} />
          </G>
        </Pattern>
      </Defs>
      <Rect x={0} y={0} width="100%" height="100%" fill="url(#chat-doodles)" />
    </Svg>
  );
});
