import { Image } from 'expo-image';
import { memo, useId } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

export type RingKind = 'unseen' | 'closeFriends' | 'seen' | 'none';

const GRADIENT: Record<'unseen' | 'closeFriends', readonly [string, string, string]> = {
  // FLYP blue -> purple -> pink, bottom-left to top-right (as on Instagram).
  unseen: ['#1E56D6', '#7C3AED', '#E8478A'],
  closeFriends: ['#16A34A', '#22C55E', '#86EFAC'],
};
const SEEN = 'rgba(138,138,138,0.6)';

// The one story indicator used everywhere (inbox tray, profile header): a
// circular ring around a circular photo, Instagram style. The ring is drawn
// with react-native-svg so it is a true circle on both platforms (a
// LinearGradient view with borderRadius rendered as a rounded square on iOS).
//   unseen        brand gradient ring
//   closeFriends  green gradient ring
//   seen          thin grey ring
//   none          no ring at all (the photo keeps its size so nothing jumps)
// Between ring and photo there is a transparent gap, so whatever is behind
// (app background, video) shows through like Instagram's white border.
export const StoryRing = memo(function StoryRing({
  uri,
  name,
  size = 64,
  kind,
}: {
  uri: string | null | undefined;
  name: string | null | undefined;
  // Outer size including the ring.
  size?: number;
  kind: RingKind;
}) {
  const rawId = useId();
  const gradId = `sr${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;

  // Ring and gap scale a little with the avatar (64 -> 3 + 2, 104 -> 4.5 + 3.5).
  const thick = Math.max(2, Math.round(size * 0.045 * 2) / 2);
  const gapW = Math.max(2, Math.round(size * 0.035 * 2) / 2);
  const photo = size - 2 * (thick + gapW);
  const gradient = kind === 'unseen' || kind === 'closeFriends';
  const stroke = gradient ? thick : 1.5;
  // Seen: the thin ring sits on the centre line of where the thick one would be.
  const r = (size - thick) / 2;
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';

  return (
    <View style={[styles.center, { width: size, height: size }]}>
      {kind !== 'none' ? (
        <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none">
          {gradient ? (
            <Defs>
              <LinearGradient id={gradId} x1="0" y1="1" x2="1" y2="0">
                <Stop offset="0" stopColor={GRADIENT[kind][0]} />
                <Stop offset="0.55" stopColor={GRADIENT[kind][1]} />
                <Stop offset="1" stopColor={GRADIENT[kind][2]} />
              </LinearGradient>
            </Defs>
          ) : null}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={gradient ? `url(#${gradId})` : SEEN}
            strokeWidth={stroke}
            fill="none"
          />
        </Svg>
      ) : null}
      <View style={[styles.avatar, { width: photo, height: photo, borderRadius: photo / 2 }]}>
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
        ) : (
          <Text style={[styles.initial, { fontSize: photo * 0.38 }]} allowFontScaling={false}>
            {initial}
          </Text>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  avatar: { overflow: 'hidden', backgroundColor: '#5D6890', alignItems: 'center', justifyContent: 'center' },
  initial: { color: '#fff', fontWeight: '800' },
});
