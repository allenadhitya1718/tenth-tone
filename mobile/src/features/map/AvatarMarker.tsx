import { memo, useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';

import type { LatLng } from './geo';

export const RING = {
  friend: '#22C55E',
  tracked: '#1E56D6',
  me: '#1E56D6',
  stale: '#8A8A8A',
} as const;

type Props = {
  coordinate: LatLng;
  name: string;
  avatarUrl: string | null | undefined;
  ring: string;
  // Drawn larger, on top, with a white halo.
  isMe?: boolean;
  dimmed?: boolean;
  selected?: boolean;
  // 0154: their note, as a speech bubble above the name.
  note?: string | null;
  accessibilityLabel: string;
  onPress?: () => void;
};

// Client note 16: friends as round avatars with a coloured ring, a pointer
// and their name, readable at every zoom. A view marker keeps one size on
// screen whatever the zoom, so it never shrinks to a dot.
//
// Android snapshots a custom marker into a bitmap; tracksViewChanges keeps
// it re-rendering until the avatar has loaded and then turns off, which is
// what keeps a map with many pins smooth.
export const AvatarMarker = memo(function AvatarMarker({
  coordinate,
  name,
  avatarUrl,
  ring,
  isMe,
  dimmed,
  selected,
  note,
  accessibilityLabel,
  onPress,
}: Props) {
  const [tracking, setTracking] = useState(true);
  const settle = () => setTracking(false);

  // Something that changes how the pin looks needs one more snapshot.
  useEffect(() => {
    setTracking(true);
    const t = setTimeout(settle, avatarUrl ? 1500 : 300);
    return () => clearTimeout(t);
  }, [avatarUrl, ring, selected, dimmed, name, note]);

  const size = isMe ? 56 : selected ? 56 : 50;
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';

  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={tracking}
      zIndex={isMe ? 1000 : selected ? 900 : 1}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
    >
      <View style={[styles.wrap, dimmed && styles.dimmed]} collapsable={false}>
        {note ? (
          <View style={styles.noteWrap}>
            <View style={styles.note}>
              <Text style={styles.noteText} numberOfLines={2} maxFontSizeMultiplier={1.2}>
                {note}
              </Text>
            </View>
            <View style={styles.noteTail} />
          </View>
        ) : null}
        <View style={styles.label}>
          <Text style={styles.labelText} numberOfLines={1} maxFontSizeMultiplier={1.2}>
            {name}
          </Text>
        </View>
        <View
          style={[
            styles.ring,
            { width: size, height: size, borderRadius: size / 2, backgroundColor: ring },
            isMe && styles.meHalo,
          ]}
        >
          <View style={[styles.inner, { borderRadius: (size - 6) / 2 }]}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.img} onLoadEnd={settle} onError={settle} />
            ) : (
              <View style={[styles.img, styles.initialBox, { backgroundColor: ring }]}>
                <Text style={styles.initial} maxFontSizeMultiplier={1}>
                  {initial}
                </Text>
              </View>
            )}
          </View>
        </View>
        <View style={[styles.pointer, { borderTopColor: ring }]} />
      </View>
    </Marker>
  );
});

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  noteWrap: { alignItems: 'center', marginBottom: 4 },
  note: {
    maxWidth: 170,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  noteText: { color: '#111111', fontSize: 12.5, fontWeight: '600', textAlign: 'center' },
  noteTail: {
    width: 0,
    height: 0,
    marginTop: -1,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#FFFFFF',
  },
  dimmed: { opacity: 0.6 },
  label: {
    maxWidth: 120,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: 'rgba(0,4,33,0.82)',
    marginBottom: 3,
  },
  labelText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  ring: { padding: 3, alignItems: 'center', justifyContent: 'center' },
  meHalo: { borderWidth: 2, borderColor: '#fff' },
  inner: { flex: 1, alignSelf: 'stretch', overflow: 'hidden', borderWidth: 2, borderColor: '#fff', backgroundColor: '#ddd' },
  img: { width: '100%', height: '100%' },
  initialBox: { alignItems: 'center', justifyContent: 'center' },
  initial: { color: '#fff', fontSize: 18, fontWeight: '800' },
  pointer: {
    width: 0,
    height: 0,
    marginTop: -1,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
