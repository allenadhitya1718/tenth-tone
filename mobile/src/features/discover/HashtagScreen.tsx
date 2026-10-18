import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchHashtag, fetchHashtagVideos, soundKeys } from '@/api/sounds';
import { TopBar } from '@/components/ui';
import { formatCount } from '@/features/feed/format';
import { useTheme } from '@/providers/ThemeProvider';

import { VideoGrid } from './VideoGrid';

// Every video carrying one hashtag, most liked first.
export function HashtagScreen({ tag }: { tag: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const clean = tag.replace(/^#+/, '').toLowerCase();

  const info = useQuery({ queryKey: soundKeys.hashtag(clean), queryFn: () => fetchHashtag(clean), enabled: !!clean });
  const videos = useQuery({
    queryKey: soundKeys.hashtagVideos(clean),
    queryFn: () => fetchHashtagVideos(clean),
    enabled: !!clean,
  });

  const { refetch: refetchInfo } = info;
  const { refetch: refetchVideos } = videos;
  const onRefresh = useCallback(() => {
    void refetchInfo();
    void refetchVideos();
  }, [refetchInfo, refetchVideos]);

  // The trigger-maintained count can lag a little; never show fewer than
  // the grid actually holds.
  const count = Math.max(info.data?.usage_count ?? 0, videos.data?.length ?? 0);

  const header = (
    <View style={styles.header}>
      <View style={[styles.badge, { backgroundColor: colors.bg3 }]}>
        <Text style={[styles.hash, { color: colors.text }]}>#</Text>
      </View>
      <View style={styles.headerText}>
        <Text style={[styles.tag, { color: colors.text }]} numberOfLines={2} accessibilityRole="header">
          #{clean}
        </Text>
        <Text style={[styles.count, { color: colors.muted }]}>
          {t('discover.common.videosCount', { n: formatCount(count), count: Number(count ?? 0) })}
        </Text>
      </View>
    </View>
  );

  const share = () => void Share.share({ message: `#${clean}` });

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <TopBar
        title={`#${clean}`}
        right={
          <Pressable onPress={share} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('discover.common.share')}>
            <Ionicons name="share-social-outline" size={22} color={colors.text} />
          </Pressable>
        }
      />
      <VideoGrid
        videos={videos.data}
        header={header}
        // An empty tag (a bad link) never loads; it falls to the empty state.
        loading={!!clean && videos.isLoading}
        failed={videos.isError}
        refreshing={info.isRefetching || videos.isRefetching}
        onRefresh={onRefresh}
        empty={{
          icon: 'pricetag-outline',
          title: t('discover.hashtag.empty'),
          sub: t('discover.hashtag.emptySub'),
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 18 },
  badge: { width: 72, height: 72, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  hash: { fontSize: 36, fontWeight: '800' },
  headerText: { flex: 1, gap: 4 },
  tag: { fontSize: 22, fontWeight: '800', alignSelf: 'flex-start', maxWidth: '100%' },
  count: { fontSize: 14, alignSelf: 'flex-start' },
});
