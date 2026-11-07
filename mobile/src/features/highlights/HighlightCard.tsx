import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { LiveHighlight } from '@/api/highlights';
import { go } from '@/features/discover/nav';
import { formatCount } from '@/features/feed/format';
import { formatClock } from '@/features/stories/SoundPicker';

import { HighlightCover, highlightCoverUri } from './HighlightCover';

export const highlightPath = (id: string) => `/highlight/${encodeURIComponent(id)}`;

// A highlight in a grid (Explore, profile), like an Instagram grid tile: the
// picture, a small corner badge (mic and length), the title or "From X's
// live" and the host. No play button (owner: it looked awkward); a tap
// anywhere opens it.
export const HighlightCard = memo(function HighlightCard({ item }: { item: LiveHighlight }) {
  const { t } = useTranslation();
  const host = item.host?.name || item.host?.handle || '';
  const cover = highlightCoverUri(item.cover_url, item.host?.avatar_url);
  const label = item.title || t('live.highlight.by', { name: host });
  return (
    <Pressable
      style={styles.card}
      onPress={() => go(highlightPath(item.id))}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${formatClock(item.duration_ms / 1000)}`}
    >
      <HighlightCover uri={cover} hostName={host} compact recyclingKey={item.id} />
      <View style={styles.shade} />
      <View style={styles.badge}>
        <Ionicons name="mic" size={10} color="#fff" />
        <Text style={styles.badgeText}>{formatClock(item.duration_ms / 1000)}</Text>
      </View>
      <View style={styles.foot}>
        <Text style={styles.title} numberOfLines={2}>
          {label}
        </Text>
        <View style={styles.metaRow}>
          <Text style={[styles.meta, styles.metaHost]} numberOfLines={1}>
            {host}
          </Text>
          {/* An icon and a number: reads right in every language (no plural forms). */}
          {item.plays_count ? (
            <View style={styles.plays} accessibilityLabel={t('live.highlight.plays', { n: formatCount(item.plays_count) })}>
              <Ionicons name="play" size={10} color="rgba(255,255,255,0.85)" />
              <Text style={styles.meta}>{formatCount(item.plays_count)}</Text>
            </View>
          ) : null}
        </View>
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
  foot: { position: 'absolute', bottom: 8, start: 8, end: 8 },
  title: { color: '#fff', fontWeight: '800', fontSize: 13 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  meta: { color: 'rgba(255,255,255,0.85)', fontSize: 11.5 },
  metaHost: { flexShrink: 1 },
  plays: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});
