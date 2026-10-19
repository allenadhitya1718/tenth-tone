import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  discoverKeys,
  fetchPopularVideos,
  fetchSuggestedProfiles,
  fetchTrendingHashtags,
  type PersonResult,
} from '@/api/discover';
import type { Hashtag } from '@/api/sounds';
import type { VideoTile } from '@/api/videos';
import { formatCount } from '@/features/feed/format';
import { NotificationsBell } from '@/features/notifications/NotificationsBell';
import { useTheme } from '@/providers/ThemeProvider';

import { FollowButton } from './FollowButton';
import { go, tagPath, userPath } from './nav';
import { Avatar, EmptyState, ErrorState, LoadingState, SectionHead } from './parts';
import { GRID_GAP, useTileStyle, VideoTileCell } from './rows';
import { atHandle } from '@/lib/handle';

const TAGS = 10;
const PEOPLE = 12;
const VIDEOS = 30;

// The Discover tab: a search bar that opens the search screen, trending
// hashtags, people to follow, then popular videos as a 3-column grid.
export function Discover() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const tile = useTileStyle();

  const tags = useQuery({ queryKey: discoverKeys.trendingHashtags(TAGS), queryFn: () => fetchTrendingHashtags(TAGS) });
  const people = useQuery({ queryKey: discoverKeys.suggestedProfiles(PEOPLE), queryFn: () => fetchSuggestedProfiles(PEOPLE) });
  const videos = useQuery({ queryKey: discoverKeys.popularVideos(VIDEOS), queryFn: () => fetchPopularVideos(VIDEOS) });

  const refreshing = tags.isRefetching || people.isRefetching || videos.isRefetching;
  const { refetch: refetchTags } = tags;
  const { refetch: refetchPeople } = people;
  const { refetch: refetchVideos } = videos;
  const onRefresh = useCallback(() => {
    void refetchTags();
    void refetchPeople();
    void refetchVideos();
  }, [refetchTags, refetchPeople, refetchVideos]);

  const loading = tags.isLoading || people.isLoading || videos.isLoading;
  const failed = tags.isError || people.isError || videos.isError;
  const nothing = !loading && !tags.data?.length && !people.data?.length && !videos.data?.length;

  const header = useMemo(
    () => (
      <DiscoverSections
        tags={tags.data ?? []}
        people={people.data ?? []}
        hasVideos={!!videos.data?.length}
      />
    ),
    [tags.data, people.data, videos.data],
  );

  const renderItem = useCallback(
    ({ item }: { item: VideoTile }) => <VideoTileCell video={item} size={tile} />,
    [tile],
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <View style={styles.topRow}>
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          {t('discover.title')}
        </Text>
        <View style={styles.topActions}>
          {/* The friends map used to be reachable only from Settings. */}
          <Pressable
            onPress={() => go('/map')}
            hitSlop={6}
            style={styles.topBtn}
            accessibilityRole="button"
            accessibilityLabel={t('map.title')}
          >
            <Ionicons name="map-outline" size={25} color={colors.text} />
          </Pressable>
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

      <FlatList<VideoTile>
        data={videos.data ?? []}
        numColumns={3}
        keyExtractor={keyOf}
        renderItem={renderItem}
        ListHeaderComponent={nothing ? undefined : header}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.gridContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
        removeClippedSubviews
        initialNumToRender={12}
        windowSize={7}
        ListEmptyComponent={
          loading ? (
            <LoadingState />
          ) : failed ? (
            <ErrorState onRetry={onRefresh} />
          ) : nothing ? (
            <EmptyState
              icon="compass-outline"
              title={t('discover.empty.title')}
              sub={t('discover.empty.sub')}
              action={{ title: t('discover.empty.create'), onPress: () => router.push('/camera') }}
            />
          ) : undefined
        }
      />
    </SafeAreaView>
  );
}

const keyOf = (v: VideoTile) => v.id;

const DiscoverSections = memo(function DiscoverSections({
  tags,
  people,
  hasVideos,
}: {
  tags: Hashtag[];
  people: PersonResult[];
  hasVideos: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View>
      {tags.length ? (
        <>
          <SectionHead title={t('discover.sections.trending')} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {tags.map((tag, i) => (
              <TagChip key={tag.tag} tag={tag} rank={i + 1} />
            ))}
          </ScrollView>
        </>
      ) : null}

      {people.length ? (
        <>
          <SectionHead title={t('discover.sections.people')} />
          <FlatList
            horizontal
            data={people}
            keyExtractor={personKey}
            renderItem={renderPerson}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.cards}
          />
        </>
      ) : null}

      {hasVideos ? <SectionHead title={t('discover.sections.popular')} /> : null}
    </View>
  );
});

const personKey = (p: PersonResult) => p.id;
const renderPerson = ({ item }: { item: PersonResult }) => <PersonCard person={item} />;

const TagChip = memo(function TagChip({ tag, rank }: { tag: Hashtag; rank: number }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const count = t('discover.common.videosCount', { n: formatCount(tag.usage_count), count: Number(tag.usage_count ?? 0) });
  return (
    <Pressable
      onPress={() => go(tagPath(tag.tag))}
      style={[styles.chip, { backgroundColor: colors.bg2, borderColor: colors.border }]}
      accessibilityRole="button"
      accessibilityLabel={t('discover.trendingRank', { rank, tag: tag.tag, count })}
    >
      <Text style={[styles.chipTag, { color: colors.text }]} numberOfLines={1}>
        #{tag.tag}
      </Text>
      <Text style={[styles.chipCount, { color: colors.muted }]}>{count}</Text>
    </Pressable>
  );
});

const PersonCard = memo(function PersonCard({ person }: { person: PersonResult }) {
  const { colors } = useTheme();
  const display = person.name || person.handle || '';
  return (
    <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
      <Pressable
        onPress={() => go(userPath(person.id))}
        style={styles.cardMain}
        accessibilityRole="button"
        accessibilityLabel={[display, person.handle ? atHandle(person.handle) : null].filter(Boolean).join(', ')}
      >
        <Avatar uri={person.avatar_url} name={display} size={64} />
        <View style={styles.cardName}>
          <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
            {display}
          </Text>
          {person.verified ? <Ionicons name="checkmark-circle" size={14} color={colors.primary2} /> : null}
        </View>
        {person.handle ? (
          <Text style={[styles.cardHandle, { color: colors.muted }]} numberOfLines={1}>
            {atHandle(person.handle)}
          </Text>
        ) : null}
      </Pressable>
      <FollowButton userId={person.id} name={display} />
    </View>
  );
});

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
  topBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
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
  gridRow: { gap: GRID_GAP },
  gridContent: { gap: GRID_GAP, paddingBottom: 40 },
  chips: { paddingHorizontal: 16, gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 44,
    justifyContent: 'center',
    maxWidth: 200,
  },
  chipTag: { fontSize: 15, fontWeight: '700' },
  chipCount: { fontSize: 12, marginTop: 2 },
  cards: { paddingHorizontal: 16, gap: 10, paddingBottom: 4 },
  card: {
    width: 148,
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  cardMain: { alignItems: 'center', gap: 4, alignSelf: 'stretch' },
  cardName: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 6, maxWidth: '100%' },
  cardTitle: { fontSize: 14.5, fontWeight: '700', flexShrink: 1 },
  cardHandle: { fontSize: 12.5, maxWidth: '100%' },
});
