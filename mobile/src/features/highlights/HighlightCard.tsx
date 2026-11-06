import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { LiveHighlight } from '@/api/highlights';
import { go, isImageUrl } from '@/features/discover/nav';
import { formatCount } from '@/features/feed/format';
import { formatClock } from '@/features/stories/SoundPicker';

export const highlightPath = (id: string) => `/highlight/${encodeURIComponent(id)}`;

// A highlight in a grid (Explore, profile): the live's cover, a play mark,
// its length, the title or "From X's live", and the host.
export const HighlightCard = memo(function HighlightCard({ item }: { item: LiveHighlight }) {
  const { t } = useTranslation();
  const host = item.host?.name || item.host?.handle || '';
  const cover = isImageUrl(item.cover_url) ? item.cover_url : isImageUrl(item.host?.avatar_url) ? item.host!.avatar_url : null;
  const label = item.title || t('live.highlight.by', { name: host });
  return (
    <Pressable
      style={styles.card}
      onPress={() => go(highlightPath(item.id))}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${formatClock(item.duration_ms / 1000)}`}
    >
      {cover ? <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={item.id} /> : null}
      <View style={styles.shade} />
      <View style={styles.badge}>
        <Ionicons name="mic" size={10} color="#fff" />
        <Text style={styles.badgeText}>{formatClock(item.duration_ms / 1000)}</Text>
      </View>
      <View style={styles.play}>
        <Ionicons name="play" size={22} color="#fff" />
      </View>
      <View style={styles.foot}>
        <Text style={styles.title} numberOfLines={2}>
          {label}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {[host, item.plays_count ? t('live.highlight.plays', { n: formatCount(item.plays_count) }) : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { flex: 1, aspectRatio: 3 / 4, borderRadius: 16, overflow: 'hidden', backgroundColor: '#121c4a' },
  shade: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: 'rgba(0,4,33,0.35)' },
  badge: {
    position: 'absolute',
    top: 8,
    start: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  play: {
    position: 'absolute',
    alignSelf: 'center',
    top: '38%',
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(30,86,214,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingStart: 3,
  },
  foot: { position: 'absolute', bottom: 8, start: 8, end: 8 },
  title: { color: '#fff', fontWeight: '800', fontSize: 13 },
  meta: { color: 'rgba(255,255,255,0.85)', fontSize: 11.5, marginTop: 2 },
});
