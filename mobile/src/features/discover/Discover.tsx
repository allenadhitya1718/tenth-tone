import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useIsFocused } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchRecentHighlights, highlightKeys, type LiveHighlight } from '@/api/highlights';
import { fetchLiveStreams, liveKeys, type LiveStreamSummary } from '@/api/live';
import { Button } from '@/components/ui';
import { LiveCard } from '@/features/feed/LiveTab';
import { HighlightCard } from '@/features/highlights/HighlightCard';
import { NotificationsBell } from '@/features/notifications/NotificationsBell';
import { useTheme } from '@/providers/ThemeProvider';

import { go } from './nav';
import { ErrorState, LoadingState, SectionHead } from './parts';

// Explore (client change, Nov 2026): FLYP is built on stories and lives, so
// this tab shows who is live right now, then clips cut from lives. Search
// stays on top for finding people.
export function Discover() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const focused = useIsFocused();

  const lives = useQuery({
    queryKey: liveKeys.list(),
    queryFn: fetchLiveStreams,
    refetchInterval: focused ? 20_000 : false,
  });
  // Highlights cut from lives by their hosts (0167).
  const clips = useQuery({ queryKey: highlightKeys.recent(), queryFn: () => fetchRecentHighlights(30) });
  const { refetch } = lives;
  const { refetch: refetchClips } = clips;
  const onRefresh = useCallback(() => {
    void refetch();
    void refetchClips();
  }, [refetch, refetchClips]);

  const renderItem = useCallback(({ item }: { item: LiveStreamSummary }) => <LiveCard stream={item} />, []);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <View style={styles.topRow}>
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          {t('discover.title')}
        </Text>
        <View style={styles.topActions}>
          <NotificationsBell />
        </View>
      </View>
      <Pressable
        onPress={() => go('/search')}
        style={[styles.searchBar, { backgroundColor: colors.bg2, borderColor: colors.border }]}
        accessibilityRole="search"
        accessibilityLabel={t('discover.search.placeholder')}
        accessibilityHint={t('discover.search.openHint')}
      >
        <Ionicons name="search" size={18} color={colors.muted} />
        <Text style={[styles.searchText, { color: colors.muted }]} numberOfLines={1}>
          {t('discover.search.placeholder')}
        </Text>
      </Pressable>

      <FlatList<LiveStreamSummary>
        data={lives.data ?? []}
        numColumns={2}
        keyExtractor={keyOf}
        renderItem={renderItem}
        ListHeaderComponent={<SectionHead title={t('discover.explore.liveNow')} />}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.gridContent}
        refreshControl={<RefreshControl refreshing={lives.isRefetching || clips.isRefetching} onRefresh={onRefresh} tintColor={colors.muted} />}
        ListEmptyComponent={
          lives.isLoading ? (
            <LoadingState />
          ) : lives.isError ? (
            <ErrorState onRetry={onRefresh} />
          ) : (
            <View style={[styles.noLive, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
              <Ionicons name="radio-outline" size={32} color={colors.muted} />
              <Text style={[styles.noLiveText, { color: colors.muted }]}>{t('discover.explore.noLive')}</Text>
              <Button title={t('feed.goLive')} onPress={() => router.push('/live/start')} style={styles.goLive} />
            </View>
          )
        }
        ListFooterComponent={<ClipsSection items={clips.data ?? []} />}
      />
    </SafeAreaView>
  );
}

const keyOf = (s: LiveStreamSummary) => s.id;

// Clips cut from lives land here once clipping is built; until then the
// section says what it is for, so the tab doesn't look unfinished.
function ClipsSection({ items }: { items: LiveHighlight[] }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const rows: LiveHighlight[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return (
    <View>
      <SectionHead title={t('discover.explore.clips')} />
      {rows.length ? (
        <View style={styles.clipGrid}>
          {rows.map((row) => (
            <View key={row[0]!.id} style={styles.gridRow}>
              {row.map((h) => (
                <HighlightCard key={h.id} item={h} />
              ))}
              {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
            </View>
          ))}
        </View>
      ) : (
        <View style={[styles.clipsSoon, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
          <Ionicons name="mic-outline" size={28} color={colors.muted} />
          <Text style={[styles.noLiveText, { color: colors.muted }]}>{t('discover.explore.clipsSoon')}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingStart: 16,
    paddingEnd: 8,
    height: 52,
  },
  title: { fontSize: 24, fontWeight: '800' },
  topActions: { flexDirection: 'row', alignItems: 'center' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 4,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchText: { flex: 1, fontSize: 15 },
  gridRow: { gap: 10, paddingHorizontal: 16 },
  gridContent: { gap: 10, paddingBottom: 40 },
  clipGrid: { gap: 10 },
  noLive: {
    marginHorizontal: 16,
    padding: 20,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    gap: 12,
  },
  noLiveText: { fontSize: 14.5, textAlign: 'center', lineHeight: 20 },
  // The card centres its content, which squeezed the button into a circle.
  goLive: { alignSelf: 'stretch' },
  clipsSoon: {
    marginHorizontal: 16,
    paddingVertical: 28,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    gap: 10,
  },
});
