import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export type RingKind = 'unseen' | 'closeFriends' | 'seen' | 'none';

const GRADIENT: Record<'unseen' | 'closeFriends', readonly [string, string, string]> = {
  unseen: ['#1E56D6', '#3D7BFF', '#E8478A'],
  closeFriends: ['#16A34A', '#22C55E', '#86EFAC'],
};

// An avatar inside a story ring: brand gradient while there is something
// new, green for close-friends stories, a thin grey ring once seen.
export const StoryRing = memo(function StoryRing({
  uri,
  name,
  size = 64,
  kind,
  gap,
}: {
  uri: string | null | undefined;
  name: string | null | undefined;
  size?: number;
  kind: RingKind;
  // Colour of the gap between ring and avatar (the surface behind).
  gap: string;
}) {
  const inner = size - 8;
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const avatar = (
    <View style={[styles.gap, { width: size - 4, height: size - 4, borderRadius: (size - 4) / 2, backgroundColor: gap }]}>
      <View style={[styles.avatar, { width: inner, height: inner, borderRadius: inner / 2 }]}>
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
        ) : (
          <Text style={[styles.initial, { fontSize: inner * 0.38 }]}>{initial}</Text>
        )}
      </View>
    </View>
  );
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (kind === 'unseen' || kind === 'closeFriends') {
    return (
      <LinearGradient colors={GRADIENT[kind]} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={[box, styles.center]}>
        {avatar}
      </LinearGradient>
    );
  }
  return (
    <View
      style={[
        box,
        styles.center,
        kind === 'seen' ? { borderWidth: 1.5, borderColor: 'rgba(138,138,138,0.7)' } : null,
      ]}
    >
      {avatar}
    </View>
  );
});

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  gap: { alignItems: 'center', justifyContent: 'center' },
  avatar: { overflow: 'hidden', backgroundColor: '#5D6890', alignItems: 'center', justifyContent: 'center' },
  initial: { color: '#fff', fontWeight: '800' },
});
