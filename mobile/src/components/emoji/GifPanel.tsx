import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { memo, type ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  I18nManager,
  type ListRenderItem,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ApiError } from '@/api/client';
import { type Gif, gifKeys, searchGifs } from '@/api/gifs';
import { useDebouncedValue } from '@/features/discover/useDebouncedValue';
import { useTheme } from '@/providers/ThemeProvider';

const CELL_HEIGHT = 112;
const GAP = 4;

// The trending / search query the GIF tab shows. Shared with the tab bar,
// which prefetches trending to learn whether GIFs are available at all.
export function useGifQuery(q: string, lang: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: gifKeys.list(q, lang),
    queryFn: ({ pageParam }) => searchGifs({ q, pos: pageParam, lang }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    enabled,
    staleTime: q ? 5 * 60_000 : 10 * 60_000,
    gcTime: 15 * 60_000,
    // An unavailable service or a rate limit will not fix itself in a second.
    retry: (n, e) => !(e instanceof ApiError && (e.code === 'gif_unavailable' || e.code === 'rate_limited')) && n < 1,
  });
}

type Props = {
  height: number;
  // Tapping a GIF sends or posts it at once.
  onPick: (gif: Gif) => void;
  // Lets the parent keep the panel open while the search field has the
  // keyboard (both parents close the panel when the keyboard opens).
  onSearchFocusChange?: (focused: boolean) => void;
  // What a tap does, for the screen reader ("sends" in chat, "posts" in comments).
  pickHint: string;
};

export const GifPanel = memo(function GifPanel({ height, onPick, onSearchFocusChange, pickHint }: Props) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const q = useDebouncedValue(text.trim(), 400);
  const lang = (i18n.language || 'en').slice(0, 2);
  const query = useGifQuery(q, lang);

  const gifs = useMemo(() => {
    const seen = new Set<string>();
    const out: Gif[] = [];
    for (const p of query.data?.pages ?? []) {
      for (const g of p.results) {
        if (seen.has(g.id)) continue;
        seen.add(g.id);
        out.push(g);
      }
    }
    return out;
  }, [query.data]);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderItem = useCallback<ListRenderItem<Gif>>(
    ({ item }) => (
      <Pressable
        onPress={() => onPick(item)}
        style={({ pressed }) => [styles.cell, { backgroundColor: colors.bg3 }, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={item.description ? t('gif.a11y', { description: item.description }) : t('gif.a11yPlain')}
        accessibilityHint={pickHint}
      >
        <Image
          source={{ uri: item.preview_url }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          recyclingKey={item.id}
          autoplay
          cachePolicy="memory-disk"
          transition={100}
          accessible={false}
        />
      </Pressable>
    ),
    [onPick, colors.bg3, t, pickHint],
  );

  const err = query.error;
  const code = err instanceof ApiError ? err.code : null;
  const searching = !!q;
  // A new search has no data yet: the spinner, not the previous query's GIFs.
  const loading = query.isPending;

  let body: ReactNode;
  if (loading) {
    body = (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('gif.loading')} />
      </View>
    );
  } else if (err && !gifs.length) {
    body = (
      <View style={styles.center} accessibilityLiveRegion="polite">
        <Ionicons name="cloud-offline-outline" size={26} color={colors.muted} />
        <Text style={[styles.stateText, { color: colors.muted }]}>
          {code === 'rate_limited' ? t('gif.rateLimited') : code === 'gif_unavailable' ? t('gif.unavailable') : t('gif.error')}
        </Text>
        {code !== 'gif_unavailable' ? (
          <Pressable onPress={() => void query.refetch()} hitSlop={8} accessibilityRole="button" style={[styles.retry, { borderColor: colors.border }]}>
            <Text style={[styles.retryText, { color: colors.primary2 }]}>{t('gif.retry')}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  } else if (!gifs.length) {
    body = (
      <View style={styles.center} accessibilityLiveRegion="polite">
        <Ionicons name="search-outline" size={26} color={colors.muted} />
        <Text style={[styles.stateText, { color: colors.muted }]}>{searching ? t('gif.empty', { q }) : t('gif.emptyTrending')}</Text>
      </View>
    );
  } else {
    body = (
      <FlatList
        key="gif-grid"
        data={gifs}
        numColumns={2}
        keyExtractor={(g) => g.id}
        renderItem={renderItem}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={styles.grid}
        columnWrapperStyle={styles.columns}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={5}
        removeClippedSubviews
        getItemLayout={(_, index) => ({ length: CELL_HEIGHT + GAP, offset: (CELL_HEIGHT + GAP) * Math.floor(index / 2), index })}
        ListFooterComponent={isFetchingNextPage ? <ActivityIndicator style={styles.more} color={colors.primary} /> : undefined}
      />
    );
  }

  return (
    <View style={[styles.panel, { height, backgroundColor: colors.bg2 }]}>
      <View style={[styles.searchRow, { backgroundColor: colors.bg }]}>
        <Ionicons name="search" size={17} color={colors.muted} />
        <TextInput
          value={text}
          onChangeText={(v) => setText(v.slice(0, 100))}
          placeholder={t('gif.search')}
          placeholderTextColor={colors.muted}
          style={[styles.input, { color: colors.text, textAlign: I18nManager.isRTL ? 'right' : 'left' }]}
          returnKeyType="search"
          autoCorrect={false}
          onFocus={() => onSearchFocusChange?.(true)}
          onBlur={() => onSearchFocusChange?.(false)}
          accessibilityLabel={t('gif.search')}
        />
        {text ? (
          <Pressable onPress={() => setText('')} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('gif.clear')}>
            <Ionicons name="close-circle" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {!searching && gifs.length ? (
        <Text style={[styles.section, { color: colors.muted }]} accessibilityRole="header">
          {t('gif.trending')}
        </Text>
      ) : null}
      <View style={styles.flex}>{body}</View>
      {/* Tenor's terms require visible attribution. */}
      <Text style={[styles.attribution, { color: colors.muted }]}>{t('gif.poweredBy')}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  panel: { overflow: 'hidden' },
  flex: { flex: 1 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 8,
    marginTop: 6,
    marginBottom: 4,
    paddingHorizontal: 10,
    height: 36,
    borderRadius: 18,
  },
  input: { flex: 1, fontSize: 15, paddingVertical: 0 },
  section: { fontSize: 12, fontWeight: '700', marginHorizontal: 12, marginBottom: 2, textAlign: 'left' },
  grid: { paddingHorizontal: 6, paddingBottom: 6 },
  columns: { gap: GAP, marginBottom: GAP },
  cell: { flex: 1, height: CELL_HEIGHT, borderRadius: 8, overflow: 'hidden' },
  pressed: { opacity: 0.7 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 24 },
  stateText: { fontSize: 14, textAlign: 'center' },
  retry: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  retryText: { fontSize: 14, fontWeight: '700' },
  more: { marginVertical: 8 },
  attribution: { fontSize: 10, textAlign: 'center', paddingVertical: 3 },
});
