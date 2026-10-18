import { Ionicons } from '@expo/vector-icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { memo, type ReactElement, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  I18nManager,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { discoverKeys, type PersonResult, searchAll, type SearchResults } from '@/api/discover';
import type { Hashtag, Sound } from '@/api/sounds';
import type { VideoTile } from '@/api/videos';
import { useTheme } from '@/providers/ThemeProvider';

import { go, tagPath } from './nav';
import { EmptyState, ErrorState, LoadingState, SectionHead } from './parts';
import { useRecentSearches } from './recentSearches';
import { GRID_GAP, HashtagRow, PersonRow, SoundRow, useTileStyle, VideoTileCell } from './rows';
import { useDebouncedValue } from './useDebouncedValue';

type Tab = 'top' | 'people' | 'videos' | 'sounds' | 'hashtags';
const TABS: Tab[] = ['top', 'people', 'videos', 'sounds', 'hashtags'];

// "@" and "#" on their own are not a search yet.
const stripPrefix = (q: string) => q.replace(/^[@#]+/, '').trim();

// The tab a leading character asks for: "@" means a person (client note 30),
// "#" a hashtag.
const tabFor = (lead: string | undefined): Tab | null => (lead === '@' ? 'people' : lead === '#' ? 'hashtags' : null);

export function Search() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const [tab, setTab] = useState<Tab>('top');
  const recent = useRecentSearches();
  const { add: addRecent } = recent;

  const q = useDebouncedValue(text.trim(), 300);
  const body = stripPrefix(q);

  // The query goes to searchAll exactly as typed: it strips the "@" for
  // people and the "#" for hashtags itself, and the leading character is
  // also what picked the tab.
  const results = useQuery({
    queryKey: discoverKeys.search(q),
    queryFn: () => searchAll(q),
    enabled: body.length > 0,
    placeholderData: keepPreviousData,
  });

  function onChange(v: string) {
    const lead = v.trimStart()[0];
    const prevLead = text.trimStart()[0];
    if (lead !== prevLead) {
      const wanted = tabFor(lead);
      if (wanted) setTab(wanted);
      else if (tabFor(prevLead)) setTab('top');
    }
    setText(v);
  }

  function onSubmit() {
    const v = text.trim();
    if (!stripPrefix(v)) return;
    addRecent(v);
    // "#travel" + search goes straight to the hashtag page.
    if (/^#[^\s#]+$/.test(v)) go(tagPath(v));
  }

  // Tapping a result is what makes a search worth remembering.
  const remember = useCallback(() => addRecent(q), [addRecent, q]);

  const pickRecent = useCallback((v: string) => {
    setTab(tabFor(v[0]) ?? 'top');
    setText(v);
  }, []);

  const searching = body.length > 0;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/discover'))}
          hitSlop={10}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Ionicons name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'} size={26} color={colors.text} />
        </Pressable>
        <View style={[styles.field, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            value={text}
            onChangeText={onChange}
            onSubmitEditing={onSubmit}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            placeholder={t('discover.search.placeholder')}
            placeholderTextColor={colors.muted}
            accessibilityLabel={t('discover.search.placeholder')}
            style={[styles.input, { color: colors.text, textAlign: I18nManager.isRTL ? 'right' : 'left' }]}
          />
          {results.isFetching && searching ? <ActivityIndicator size="small" color={colors.muted} /> : null}
          {text ? (
            <Pressable
              onPress={() => onChange('')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('discover.search.clearText')}
            >
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {searching ? (
        <>
          <TabBar tab={tab} onChange={setTab} />
          {results.isError && !results.data ? (
            <ErrorState onRetry={() => void results.refetch()} />
          ) : !results.data ? (
            <LoadingState />
          ) : (
            <Results tab={tab} data={results.data} onOpen={remember} onMore={setTab} />
          )}
        </>
      ) : (
        <Recent items={recent.items} onPick={pickRecent} onRemove={recent.remove} onClear={recent.clear} />
      )}
    </SafeAreaView>
  );
}

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={[styles.tabsWrap, { borderBottomColor: colors.border }]} accessibilityRole="tablist">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {TABS.map((k) => {
          const on = tab === k;
          return (
            <Pressable
              key={k}
              onPress={() => onChange(k)}
              style={[styles.tab, on && { borderBottomColor: colors.text }]}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.tabText, { color: on ? colors.text : colors.muted }]}>{t(`discover.search.tab_${k}`)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Results({
  tab,
  data,
  onOpen,
  onMore,
}: {
  tab: Tab;
  data: SearchResults;
  onOpen: () => void;
  onMore: (t: Tab) => void;
}) {
  const { t } = useTranslation();
  const tile = useTileStyle();

  const renderPerson = useCallback(({ item }: { item: PersonResult }) => <PersonRow person={item} onOpen={onOpen} />, [onOpen]);
  const renderVideo = useCallback(
    ({ item }: { item: VideoTile }) => <VideoTileCell video={item} size={tile} onOpen={onOpen} />,
    [tile, onOpen],
  );
  const renderSound = useCallback(({ item }: { item: Sound }) => <SoundRow sound={item} onOpen={onOpen} />, [onOpen]);
  const renderTag = useCallback(({ item }: { item: Hashtag }) => <HashtagRow tag={item} onOpen={onOpen} />, [onOpen]);

  const noResults = <EmptyState icon="search-outline" title={t('discover.search.noResults')} sub={t('discover.search.noResultsSub')} />;

  switch (tab) {
    case 'people':
      return (
        <FlatList
          data={data.profiles}
          keyExtractor={idOf}
          renderItem={renderPerson}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={noResults}
        />
      );
    case 'videos':
      return (
        <FlatList
          key="videos"
          data={data.videos}
          numColumns={3}
          keyExtractor={idOf}
          renderItem={renderVideo}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.gridContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={noResults}
        />
      );
    case 'sounds':
      return (
        <FlatList
          data={data.sounds}
          keyExtractor={idOf}
          renderItem={renderSound}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={noResults}
        />
      );
    case 'hashtags':
      return (
        <FlatList
          data={data.hashtags}
          keyExtractor={tagOf}
          renderItem={renderTag}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={noResults}
        />
      );
    default:
      return <TopResults data={data} tile={tile} onOpen={onOpen} onMore={onMore} empty={noResults} />;
  }
}

const idOf = (x: { id: string }) => x.id;
const tagOf = (x: Hashtag) => x.tag;

// A few of each kind, with "See all" switching to that kind's tab. Bounded
// (at most 3 + 4 + 6 + 3 rows), so a plain ScrollView is enough here.
const TopResults = memo(function TopResults({
  data,
  tile,
  onOpen,
  onMore,
  empty,
}: {
  data: SearchResults;
  tile: { width: number; height: number };
  onOpen: () => void;
  onMore: (t: Tab) => void;
  empty: ReactElement;
}) {
  const { t } = useTranslation();
  const videoRows = useMemo(() => {
    const first = data.videos.slice(0, 6);
    return [first.slice(0, 3), first.slice(3, 6)].filter((r) => r.length);
  }, [data.videos]);

  if (!data.profiles.length && !data.hashtags.length && !data.videos.length && !data.sounds.length) return empty;

  return (
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.topContent}>
      {data.profiles.length ? (
        <>
          <SectionHead title={t('discover.search.tab_people')} onMore={data.profiles.length > 3 ? () => onMore('people') : undefined} />
          {data.profiles.slice(0, 3).map((p) => (
            <PersonRow key={p.id} person={p} onOpen={onOpen} />
          ))}
        </>
      ) : null}
      {data.hashtags.length ? (
        <>
          <SectionHead title={t('discover.search.tab_hashtags')} onMore={data.hashtags.length > 4 ? () => onMore('hashtags') : undefined} />
          {data.hashtags.slice(0, 4).map((h) => (
            <HashtagRow key={h.tag} tag={h} onOpen={onOpen} />
          ))}
        </>
      ) : null}
      {videoRows.length ? (
        <>
          <SectionHead title={t('discover.search.tab_videos')} onMore={data.videos.length > 6 ? () => onMore('videos') : undefined} />
          {videoRows.map((row) => (
            <View key={row[0].id} style={styles.topGridRow}>
              {row.map((v) => (
                <VideoTileCell key={v.id} video={v} size={tile} onOpen={onOpen} />
              ))}
            </View>
          ))}
        </>
      ) : null}
      {data.sounds.length ? (
        <>
          <SectionHead title={t('discover.search.tab_sounds')} onMore={data.sounds.length > 3 ? () => onMore('sounds') : undefined} />
          {data.sounds.slice(0, 3).map((s) => (
            <SoundRow key={s.id} sound={s} onOpen={onOpen} />
          ))}
        </>
      ) : null}
    </ScrollView>
  );
});

function Recent({
  items,
  onPick,
  onRemove,
  onClear,
}: {
  items: string[];
  onPick: (v: string) => void;
  onRemove: (v: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();

  if (!items.length) {
    return <EmptyState icon="search-outline" title={t('discover.search.hintTitle')} sub={t('discover.search.hintSub')} />;
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(v) => v}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      ListHeaderComponent={
        <View style={styles.recentHead}>
          <Text style={[styles.recentTitle, { color: colors.text }]} accessibilityRole="header">
            {t('discover.search.recent')}
          </Text>
          <Pressable onPress={onClear} hitSlop={10} accessibilityRole="button" style={styles.clearAll}>
            <Text style={[styles.clearText, { color: isDark ? colors.primary2 : colors.primary }]}>
              {t('discover.search.clearAll')}
            </Text>
          </Pressable>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.recentRow}>
          <Pressable
            style={styles.recentMain}
            onPress={() => onPick(item)}
            accessibilityRole="button"
            accessibilityHint={t('discover.search.recentHint')}
          >
            <Ionicons name="time-outline" size={20} color={colors.muted} />
            <Text style={[styles.recentText, { color: colors.text }]} numberOfLines={1}>
              {item}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => onRemove(item)}
            hitSlop={10}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel={t('discover.search.removeRecent', { q: item })}
          >
            <Ionicons name="close" size={18} color={colors.muted} />
          </Pressable>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingStart: 6, paddingEnd: 16, paddingVertical: 6 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    height: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, fontSize: 15, height: '100%', paddingVertical: 0 },
  tabsWrap: { borderBottomWidth: StyleSheet.hairlineWidth },
  tabs: { paddingHorizontal: 8 },
  tab: {
    paddingHorizontal: 14,
    minHeight: 44,
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabText: { fontSize: 14.5, fontWeight: '700' },
  gridRow: { gap: GRID_GAP },
  gridContent: { gap: GRID_GAP, paddingBottom: 40 },
  topContent: { paddingBottom: 40 },
  topGridRow: { flexDirection: 'row', gap: GRID_GAP, marginBottom: GRID_GAP },
  recentHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  recentTitle: { fontSize: 16, fontWeight: '800' },
  clearAll: { minHeight: 44, justifyContent: 'center' },
  clearText: { fontSize: 14, fontWeight: '700' },
  recentRow: { flexDirection: 'row', alignItems: 'center', paddingStart: 16, paddingEnd: 6 },
  recentMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  recentText: { flex: 1, fontSize: 15 },
});
