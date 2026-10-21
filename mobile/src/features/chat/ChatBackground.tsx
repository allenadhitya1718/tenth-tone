import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, Path, Pattern, Rect } from 'react-native-svg';

import { useTheme } from '@/providers/ThemeProvider';

import { type ThemePattern, themeFor } from './themes';

// Client note 10 ("patterns or drawings" behind the messages, as WhatsApp
// does), and the chat themes (0149): the theme's gradient with its pattern,
// a photo under a veil, or by default the doodle tile in the app's own
// colours. Hidden from screen readers; never takes touches.
const TILE = 140;

export const ChatBackground = memo(function ChatBackground({
  theme,
  wallpaper,
}: {
  theme?: string | null;
  wallpaper?: string | null;
}) {
  const { colors, isDark } = useTheme();
  const th = themeFor(theme, wallpaper);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
      {!th ? (
        <PatternLayer kind="doodle" color={colors.text} opacity={isDark ? 0.06 : 0.05} />
      ) : th.key === 'photo' && wallpaper ? (
        <>
          <Image source={{ uri: wallpaper }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
          {/* A veil so bubbles and day labels stay readable on any photo. */}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.32)' }]} />
        </>
      ) : (
        <>
          {th.bg.length > 1 ? (
            <LinearGradient
              colors={th.bg as [string, string, ...string[]]}
              start={th.diagonal ? { x: 0, y: 0 } : { x: 0.5, y: 0 }}
              end={th.diagonal ? { x: 1, y: 1 } : { x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: th.bg[0] }]} />
          )}
          {th.pattern ? <PatternLayer kind={th.pattern} color={th.patternColor ?? '#FFFFFF'} opacity={th.patternOpacity ?? 0.12} /> : null}
        </>
      )}
    </View>
  );
});

// One repeating vector tile, drawn in `color` at `opacity`.
export const PatternLayer = memo(function PatternLayer({ kind, color, opacity }: { kind: ThemePattern; color: string; opacity: number }) {
  // Unique per colour: two tiles of the same pattern in different colours
  // (the picker) must not share a definition.
  const id = `chat-${kind}-${color.replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs>
        <Pattern id={id} patternUnits="userSpaceOnUse" width={TILE} height={TILE}>
          <G opacity={opacity}>{TILES[kind](color)}</G>
        </Pattern>
      </Defs>
      <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
});

const heart = (x: number, y: number, s: number, c: string) => (
  <Path
    key={`h${x}-${y}`}
    transform={`translate(${x} ${y}) scale(${s})`}
    d="M12 21s-7.5-4.6-10-9.2C.3 8.4 2.2 4 6.2 4c2.4 0 3.9 1.5 5.8 3.6C13.9 5.5 15.4 4 17.8 4c4 0 5.9 4.4 4.2 7.8C19.5 16.4 12 21 12 21z"
    fill={c}
  />
);
const sparkle = (x: number, y: number, s: number, c: string) => (
  <Path key={`s${x}-${y}`} transform={`translate(${x} ${y}) scale(${s})`} d="M12 0l2.6 9.4L24 12l-9.4 2.6L12 24l-2.6-9.4L0 12l9.4-2.6z" fill={c} />
);
const star = (x: number, y: number, s: number, c: string) => (
  <Path
    key={`t${x}-${y}`}
    transform={`translate(${x} ${y}) scale(${s})`}
    d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 21l1.6-7L2 9.2l7.1-.6z"
    fill={c}
  />
);
const leaf = (x: number, y: number, r: number, c: string) => (
  <Path key={`l${x}-${y}`} transform={`translate(${x} ${y}) rotate(${r})`} d="M0 0C6-10 20-10 24 0 20 10 6 10 0 0z M2 0h20" fill={c} />
);
const note = (x: number, y: number, c: string) => (
  <G key={`n${x}-${y}`} transform={`translate(${x} ${y})`}>
    <Path d="M9 2v14" stroke={c} strokeWidth={2} />
    <Path d="M9 2l8 2.5v4L9 6" fill={c} />
    <Circle cx={6} cy={17} r={4} fill={c} />
  </G>
);
const petal = (x: number, y: number, c: string) => (
  <G key={`p${x}-${y}`} transform={`translate(${x} ${y})`}>
    {[0, 72, 144, 216, 288].map((a) => (
      <Circle key={a} cx={6 * Math.cos((a * Math.PI) / 180)} cy={6 * Math.sin((a * Math.PI) / 180)} r={4.5} fill={c} />
    ))}
    <Circle cx={0} cy={0} r={2.6} fill="#FFFFFF" opacity={0.6} />
  </G>
);

const TILES: Record<ThemePattern, (c: string) => ReactNode> = {
  hearts: (c) => [heart(8, 10, 0.9, c), heart(82, 30, 0.6, c), heart(40, 78, 0.75, c), heart(104, 98, 0.95, c), heart(10, 112, 0.5, c)],
  sparkles: (c) => [sparkle(14, 16, 0.7, c), sparkle(92, 8, 0.45, c), sparkle(58, 60, 0.9, c), sparkle(16, 98, 0.4, c), sparkle(104, 100, 0.6, c)],
  stars: (c) => [
    star(10, 12, 0.6, c),
    star(96, 40, 0.4, c),
    star(46, 90, 0.5, c),
    <Circle key="d1" cx={70} cy={18} r={1.6} fill={c} />,
    <Circle key="d2" cx={24} cy={62} r={1.2} fill={c} />,
    <Circle key="d3" cx={120} cy={92} r={1.8} fill={c} />,
    <Circle key="d4" cx={86} cy={128} r={1.2} fill={c} />,
    <Circle key="d5" cx={128} cy={8} r={1} fill={c} />,
  ],
  bubbles: (c) => [
    <Circle key="b1" cx={24} cy={26} r={14} fill="none" stroke={c} strokeWidth={2} />,
    <Circle key="b2" cx={96} cy={38} r={7} fill="none" stroke={c} strokeWidth={2} />,
    <Circle key="b3" cx={62} cy={92} r={20} fill="none" stroke={c} strokeWidth={2} />,
    <Circle key="b4" cx={122} cy={110} r={5} fill={c} />,
    <Circle key="b5" cx={14} cy={118} r={4} fill={c} />,
  ],
  waves: (c) => [
    <Path key="w1" d="M0 30c17.5-12 35-12 52.5 0s35 12 52.5 0 35-12 35 0" fill="none" stroke={c} strokeWidth={2.4} />,
    <Path key="w2" d="M0 80c17.5-12 35-12 52.5 0s35 12 52.5 0 35-12 35 0" fill="none" stroke={c} strokeWidth={2.4} />,
    <Path key="w3" d="M0 125c17.5-9 35-9 52.5 0s35 9 52.5 0 35-9 35 0" fill="none" stroke={c} strokeWidth={1.6} />,
  ],
  leaves: (c) => [leaf(10, 24, -20, c), leaf(80, 18, 30, c), leaf(40, 80, 15, c), leaf(100, 104, -35, c)],
  notes: (c) => [note(14, 10, c), note(86, 34, c), note(42, 82, c), note(108, 104, c)],
  petals: (c) => [petal(22, 22, c), petal(96, 40, c), petal(54, 96, c), petal(124, 124, c)],
  doodle: (c) => (
    <G stroke={c} strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round">
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
  ),
};
