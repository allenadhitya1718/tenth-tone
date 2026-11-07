import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { countHighlightPlay, type LiveHighlight } from '@/api/highlights';
import { go, isImageUrl, userPath } from '@/features/discover/nav';
import { formatClock } from '@/features/stories/SoundPicker';

import { HighlightCover, highlightCoverUri } from './HighlightCover';

type Props = {
  item: LiveHighlight;
  height: number;
  // On screen: plays. Off screen: paused and back to the start.
  active: boolean;
  // On screen or next to it: holds an audio player, ready to start at once.
  near: boolean;
  muted: boolean;
  onToggleMute: () => void;
};

// A live highlight as one page of the Home feed (For You, Following), in the
// same frame as a video: the live's cover blurred behind, the cover in the
// middle, the host and title at the bottom, and the minute playing while the
// page is on screen. Tap to pause; with sound off, a tap turns it on.
export const HighlightFeedCard = memo(function HighlightFeedCard({ item, height, active, near, muted, onToggleMute }: Props) {
  const { t } = useTranslation();
  const host = item.host?.name || item.host?.handle || '';
  const cover = highlightCoverUri(item.cover_url, item.host?.avatar_url);
  const avatar = isImageUrl(item.host?.avatar_url) ? item.host!.avatar_url : null;
  const [paused, setPaused] = useState(false);
  // Leaving the page forgets a pause, as videos do.
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) setPaused(false);
  }

  const onPress = () => {
    if (muted) onToggleMute();
    else setPaused((p) => !p);
  };

  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, { height }]}
      accessibilityRole="button"
      accessibilityLabel={`${item.title || t('live.highlight.by', { name: host })}, ${formatClock(item.duration_ms / 1000)}`}
      accessibilityHint={muted ? t('feed.tapForSound') : undefined}
    >
      {cover ? <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={30} recyclingKey={item.id} /> : null}
      <View style={styles.shade} />
      <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.65)']} style={styles.bottomShade} />

      <View style={styles.middle} pointerEvents="none">
        <View style={styles.chip}>
          <Ionicons name="mic" size={12} color="#fff" />
          <Text style={styles.chipText}>{t('live.highlight.feedChip')}</Text>
        </View>
        <View style={styles.art}>
          <HighlightCover uri={cover} hostName={host} recyclingKey={item.id} />
          {paused ? (
            <View style={styles.pausedMark}>
              <Ionicons name="play" size={34} color="#fff" style={{ marginStart: 4 }} />
            </View>
          ) : null}
        </View>
      </View>

      {active && muted ? (
        <View style={styles.mutedPill} pointerEvents="none">
          <Ionicons name="volume-mute" size={14} color="#fff" />
          <Text style={styles.mutedText}>{t('feed.tapForSound')}</Text>
        </View>
      ) : null}

      <View style={styles.caption} pointerEvents="box-none">
        <Pressable onPress={() => go(userPath(item.host_id))} style={styles.who} accessibilityRole="link" hitSlop={6}>
          {avatar ? (
            <Image source={{ uri: avatar }} style={styles.whoAvatar} />
          ) : (
            <View style={[styles.whoAvatar, styles.avatarEmpty]}>
              <Text style={styles.whoLetter}>{(host[0] ?? '?').toUpperCase()}</Text>
            </View>
          )}
          <Text style={styles.handle} numberOfLines={1}>
            {host}
          </Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={2}>
          {item.title || t('live.highlight.by', { name: host })}
        </Text>
        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={13} color="rgba(255,255,255,0.85)" />
          <Text style={styles.meta}>{formatClock(item.duration_ms / 1000)}</Text>
        </View>
      </View>

      {near ? <Sound item={item} active={active && !paused} muted={muted} /> : null}
    </Pressable>
  );
});

// The audio, only for the pages on screen or next to it, so a long feed
// never holds dozens of players.
function Sound({ item, active, muted }: { item: LiveHighlight; active: boolean; muted: boolean }) {
  const player = useAudioPlayer({ uri: item.audio_url });
  const status = useAudioPlayerStatus(player);
  const counted = useRef(false);

  // expo-audio's API is a mutable player object; assigning is how it is driven.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    player.loop = true;
  }, [player]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    player.muted = muted;
  }, [player, muted]);
  useEffect(() => {
    if (active) {
      player.play();
      if (!counted.current) {
        counted.current = true;
        countHighlightPlay(item.id);
      }
    } else {
      player.pause();
    }
  }, [player, active, item.id]);
  // Off screen: back to the start for the next visit.
  useEffect(() => {
    if (!active) void player.seekTo(0).catch(() => {});
  }, [player, active]);

  const total = status.duration > 0 ? status.duration : item.duration_ms / 1000;
  const pct = total ? Math.min(1, status.currentTime / total) : 0;
  return (
    <View style={styles.track} pointerEvents="none">
      <View style={[styles.fill, { width: `${pct * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', backgroundColor: '#000421', overflow: 'hidden' },
  shade: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: 'rgba(0,4,33,0.55)' },
  bottomShade: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '40%' },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingBottom: 60 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(30,86,214,0.9)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  chipText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  art: {
    width: 240,
    height: 240,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#121c4a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pausedMark: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mutedPill: {
    position: 'absolute',
    top: 110,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  mutedText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  caption: { position: 'absolute', start: 12, end: 24, bottom: 22, gap: 4 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', maxWidth: '100%' },
  whoAvatar: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: '#fff' },
  avatarEmpty: { backgroundColor: '#1e56d6', alignItems: 'center', justifyContent: 'center' },
  whoLetter: { color: '#fff', fontWeight: '800', fontSize: 13 },
  handle: { flexShrink: 1, color: '#fff', fontWeight: '800', fontSize: 15, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  title: { color: '#fff', fontSize: 15, lineHeight: 21, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  meta: { color: 'rgba(255,255,255,0.85)', fontSize: 13 },
  track: { position: 'absolute', start: 0, end: 0, bottom: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.2)' },
  fill: { height: 3, backgroundColor: '#fff' },
});
