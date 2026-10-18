import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { fetchLiveStreams, liveKeys, type LiveStreamSummary } from '@/api/live';
import { Button } from '@/components/ui';

import { formatCount } from './format';

// The third home tab: who is live right now. The web app sent this tab to
// a separate page; here it swipes in like the other two (client note 24).
export function LiveTab({ height, focused }: { height: number; focused: boolean }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: liveKeys.list(),
    queryFn: fetchLiveStreams,
    enabled: focused,
    refetchInterval: focused ? 20_000 : false,
  });

  return (
    <View style={[styles.wrap, { height }]}>
      <FlatList
        data={q.data ?? []}
        keyExtractor={(s) => s.id}
        numColumns={2}
        contentContainerStyle={styles.list}
        columnWrapperStyle={{ gap: 10 }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor="#fff" />}
        ListEmptyComponent={
          q.isLoading ? (
            <ActivityIndicator color="#fff" style={{ marginTop: 80 }} />
          ) : (
            <View style={styles.empty}>
              <Ionicons name="radio-outline" size={44} color="#98a3c7" />
              <Text style={styles.emptyText}>{t('feed.noLive')}</Text>
            </View>
          )
        }
        renderItem={({ item }) => <LiveCard stream={item} />}
      />
      <View style={styles.goLive}>
        <Button title={t('feed.goLive')} onPress={() => router.push('/live/start')} />
      </View>
    </View>
  );
}

function LiveCard({ stream }: { stream: LiveStreamSummary }) {
  const { t } = useTranslation();
  return (
    <Pressable style={styles.card} onPress={() => router.push(`/live/${stream.id}`)} accessibilityRole="button">
      {stream.thumbnail || stream.host?.avatar_url ? (
        <Image source={{ uri: (stream.thumbnail || stream.host?.avatar_url)! }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : null}
      <View style={styles.cardShade} />
      <View style={styles.badges}>
        <Text style={styles.livePill}>{t('home.live')}</Text>
        <Text style={styles.viewers}>
          <Ionicons name="eye" size={10} color="#fff" /> {formatCount(stream.viewer_count)}
        </Text>
      </View>
      <View style={styles.cardFoot}>
        <Text style={styles.host} numberOfLines={1}>
          {stream.host?.name ?? stream.host?.handle ?? ''}
        </Text>
        {stream.title ? (
          <Text style={styles.title} numberOfLines={2}>
            {stream.title}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#000421' },
  list: { padding: 10, paddingTop: 110, paddingBottom: 100, gap: 10 },
  empty: { alignItems: 'center', gap: 12, marginTop: 120 },
  emptyText: { color: '#98a3c7', fontSize: 15 },
  card: { flex: 1, aspectRatio: 3 / 4, borderRadius: 16, overflow: 'hidden', backgroundColor: '#121c4a' },
  cardShade: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: 'rgba(0,0,0,0.25)' },
  badges: { position: 'absolute', top: 8, start: 8, flexDirection: 'row', gap: 6 },
  livePill: { color: '#fff', backgroundColor: '#ff2d55', fontSize: 10, fontWeight: '800', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, overflow: 'hidden' },
  viewers: { color: '#fff', backgroundColor: 'rgba(0,0,0,0.45)', fontSize: 10, fontWeight: '700', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, overflow: 'hidden' },
  cardFoot: { position: 'absolute', bottom: 8, start: 8, end: 8 },
  host: { color: '#fff', fontWeight: '800', fontSize: 13 },
  title: { color: '#fff', fontSize: 12, opacity: 0.9 },
  goLive: { position: 'absolute', bottom: 16, start: 24, end: 24 },
});
