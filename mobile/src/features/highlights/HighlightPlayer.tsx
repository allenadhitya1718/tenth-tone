import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { countHighlightPlay, deleteHighlight, fetchHighlight, highlightKeys } from '@/api/highlights';
import { showAlert } from '@/components/Dialog';
import { showToast } from '@/components/Toast';
import { go, userPath } from '@/features/discover/nav';
import { formatCount } from '@/features/feed/format';
import { formatClock } from '@/features/stories/SoundPicker';
import { useAuth } from '@/providers/AuthProvider';

import { clipByKey, HighlightCover, highlightCoverUri } from './HighlightCover';

const BG = '#000421';

// One highlight, full screen: the live's cover behind, play / pause, how far
// along, who hosted it. The host can delete it.
export function HighlightPlayer({ id }: { id: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { session } = useAuth();
  const q = useQuery({ queryKey: highlightKeys.one(id), queryFn: () => fetchHighlight(id) });
  const h = q.data;

  const player = useAudioPlayer(h ? { uri: h.audio_url } : null);
  const status = useAudioPlayerStatus(player);
  const counted = useRef(false);
  useEffect(() => () => player.pause(), [player]);

  const toggle = () => {
    if (!h) return;
    if (status.playing) {
      player.pause();
      return;
    }
    if (status.duration > 0 && status.currentTime >= status.duration - 0.25) void player.seekTo(0);
    player.play();
    if (!counted.current) {
      counted.current = true;
      countHighlightPlay(h.id);
    }
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (q.isLoading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  if (!h) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <Ionicons name="mic-off-outline" size={40} color="rgba(255,255,255,0.6)" />
        <Text style={styles.gone}>{t('live.highlight.gone')}</Text>
        <Pressable onPress={back} style={styles.goneBack} accessibilityRole="button">
          <Text style={styles.goneBackText}>{t('common.back')}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const isMine = session?.user.id === h.host_id;
  const host = h.host?.name || h.host?.handle || '';
  const cover = highlightCoverUri(h.cover_url, h.host?.avatar_url);
  const total = status.duration > 0 ? status.duration : h.duration_ms / 1000;
  const pct = total ? Math.min(1, status.currentTime / total) : 0;

  const remove = () =>
    showAlert(t('live.highlight.deleteTitle'), t('live.highlight.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('live.highlight.delete'),
        style: 'destructive',
        onPress: () => {
          player.pause();
          deleteHighlight(h.id)
            .then(() => {
              void qc.invalidateQueries({ queryKey: highlightKeys.all });
              showToast(t('live.highlight.deleted'));
              back();
            })
            .catch(() => showAlert(t('live.errors.title'), t('live.errors.generic')));
        },
      },
    ]);

  return (
    <View style={styles.root}>
      {cover ? <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={30} /> : null}
      <View style={styles.shade} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.top}>
          <Pressable onPress={back} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.back')}>
            <Ionicons name="chevron-down" size={28} color="#fff" />
          </Pressable>
          {isMine ? (
            <Pressable onPress={remove} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('live.highlight.delete')}>
              <Ionicons name="trash-outline" size={22} color="#fff" />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.middle}>
          <View style={styles.art}>
            <HighlightCover uri={cover} hostName={host} />
          </View>
          <Text style={styles.title} numberOfLines={3}>
            {h.title || t(clipByKey(h.kind), { name: host })}
          </Text>
          <Pressable onPress={() => go(userPath(h.host_id))} accessibilityRole="link" hitSlop={6}>
            <Text style={styles.host}>{h.title ? t(clipByKey(h.kind), { name: host }) : host}</Text>
          </Pressable>
        </View>

        <View style={styles.bottom}>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${pct * 100}%` }]} />
          </View>
          <View style={styles.times}>
            <Text style={styles.time}>{formatClock(status.currentTime)}</Text>
            <Text style={styles.time}>{formatClock(total)}</Text>
          </View>
          <Pressable
            onPress={toggle}
            style={styles.playBtn}
            accessibilityRole="button"
            accessibilityLabel={status.playing ? t('live.highlight.pause') : t('live.highlight.play')}
          >
            {status.isBuffering && status.playing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Ionicons name={status.playing ? 'pause' : 'play'} size={34} color="#fff" style={status.playing ? undefined : { marginStart: 4 }} />
            )}
          </Pressable>
          {h.plays_count ? (
            <View style={styles.playsRow} accessibilityLabel={t('live.highlight.plays', { n: formatCount(h.plays_count) })}>
              <Ionicons name="play" size={12} color="rgba(255,255,255,0.7)" />
              <Text style={styles.plays}>{formatCount(h.plays_count)}</Text>
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  shade: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: 'rgba(0,4,33,0.6)' },
  safe: { flex: 1, paddingHorizontal: 24 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 52 },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  art: {
    width: 220,
    height: 220,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#121c4a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  host: { color: 'rgba(255,255,255,0.8)', fontSize: 14.5, fontWeight: '600' },
  bottom: { paddingBottom: 24, alignItems: 'center' },
  track: { direction: 'ltr', alignSelf: 'stretch', height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  fill: { height: 4, backgroundColor: '#fff' },
  times: { direction: 'ltr', alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, marginBottom: 18 },
  time: { color: 'rgba(255,255,255,0.75)', fontSize: 12 },
  playBtn: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#1E56D6', alignItems: 'center', justifyContent: 'center' },
  playsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 14 },
  plays: { color: 'rgba(255,255,255,0.7)', fontSize: 12.5 },
  gone: { color: '#fff', fontSize: 15, textAlign: 'center', paddingHorizontal: 24 },
  goneBack: { paddingHorizontal: 18, paddingVertical: 10 },
  goneBackText: { color: '#9DBBFF', fontWeight: '700' },
});
