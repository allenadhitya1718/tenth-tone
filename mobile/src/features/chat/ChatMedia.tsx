import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { openLocation, parseLocation } from './location';

// A video message: plays in the bubble with the system controls (and full
// screen from there), paused until tapped. Before this, a video message was
// drawn as a picture and came out blank.
export const VideoMessage = memo(function VideoMessage({ uri, onLongPress }: { uri: string; onLongPress: () => void }) {
  const { t } = useTranslation();
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  return (
    <Pressable onLongPress={onLongPress} delayLongPress={300} accessibilityRole="none" accessibilityLabel={t('attach.videoMessage')}>
      <View style={styles.video}>
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls />
      </View>
    </Pressable>
  );
});

// A shared location: a pin card that opens the maps app. Reads links from the
// earlier app too (location.ts). Falls back to the raw text when it is not a
// location link.
export const LocationMessage = memo(function LocationMessage({
  text,
  fg,
  sub,
  onLongPress,
}: {
  text: string | null;
  fg: string;
  sub: string;
  onLongPress: () => void;
}) {
  const { t } = useTranslation();
  const loc = parseLocation(text);
  if (!loc) return <Text style={[styles.raw, { color: fg }]}>{text}</Text>;
  const title = loc.label || t('attach.sharedLocation');
  return (
    <Pressable
      onPress={() => openLocation(loc)}
      onLongPress={onLongPress}
      delayLongPress={300}
      style={styles.loc}
      accessibilityRole="link"
      accessibilityLabel={`${title}, ${t('attach.openMaps')}`}
    >
      <View style={styles.pin}>
        <Ionicons name="location" size={26} color="#FFFFFF" />
      </View>
      <View style={styles.locBody}>
        <Text style={[styles.locTitle, { color: fg }]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[styles.locSub, { color: sub }]} numberOfLines={1}>
          {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}
        </Text>
        <Text style={[styles.locOpen, { color: fg }]}>{t('attach.openMaps')}</Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  video: { width: 230, height: 300, borderRadius: 15, overflow: 'hidden', backgroundColor: '#000' },
  raw: { fontSize: 16, textAlign: 'left' },
  loc: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4, minWidth: 210 },
  pin: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#10B981', alignItems: 'center', justifyContent: 'center' },
  locBody: { flexShrink: 1, gap: 2 },
  locTitle: { fontSize: 15.5, fontWeight: '700', textAlign: 'left' },
  locSub: { fontSize: 12.5, textAlign: 'left' },
  locOpen: { fontSize: 13, fontWeight: '700', textDecorationLine: 'underline', marginTop: 2, textAlign: 'left' },
});
