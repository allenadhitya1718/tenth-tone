import { useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

// CSS-style layered radial washes over a linear base, as used by the web
// app's .splash and onboarding .ph-bg backdrops. Positions and radii are
// fractions of the box, like `radial-gradient(90% 55% at 50% 22%, …)`.
export type Wash = { cx: number; cy: number; rx: number; ry: number; color: string; opacity?: number; stop?: number };

export function Backdrop({
  base,
  washes = [],
}: {
  base: [string, string] | string;
  washes?: Wash[];
}) {
  const uid = useId().replace(/:/g, '');
  const [from, to] = typeof base === 'string' ? [base, base] : base;
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id={`base${uid}`} x1="0" y1="0" x2="0.6" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
        {washes.map((w, i) => (
          <RadialGradient
            key={i}
            id={`w${i}${uid}`}
            cx={w.cx}
            cy={w.cy}
            rx={w.rx}
            ry={w.ry}
            fx={w.cx}
            fy={w.cy}
            gradientUnits="objectBoundingBox"
          >
            <Stop offset="0" stopColor={w.color} stopOpacity={w.opacity ?? 1} />
            <Stop offset={w.stop ?? 0.6} stopColor={w.color} stopOpacity={0} />
          </RadialGradient>
        ))}
      </Defs>
      <Rect x="0" y="0" width="100" height="100" fill={`url(#base${uid})`} />
      {washes.map((_, i) => (
        <Rect key={i} x="0" y="0" width="100" height="100" fill={`url(#w${i}${uid})`} />
      ))}
    </Svg>
  );
}
