import type { Ionicons } from '@expo/vector-icons';
import { type ReactElement, useCallback } from 'react';
import { FlatList, RefreshControl, StyleSheet } from 'react-native';

import type { VideoTile } from '@/api/videos';
import { useTheme } from '@/providers/ThemeProvider';

import { EmptyState, ErrorState, LoadingState } from './parts';
import { GRID_GAP, useTileStyle, VideoTileCell } from './rows';

// A header over a 3-column grid of videos, with the loading, error and empty
// states every grid screen (hashtag, sound) needs.
export function VideoGrid({
  videos,
  header,
  loading,
  failed,
  refreshing,
  onRefresh,
  empty,
}: {
  videos: VideoTile[] | undefined;
  header?: ReactElement;
  loading: boolean;
  failed: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  empty: { icon: keyof typeof Ionicons.glyphMap; title: string; sub?: string };
}) {
  const { colors } = useTheme();
  const tile = useTileStyle();
  const renderItem = useCallback(({ item }: { item: VideoTile }) => <VideoTileCell video={item} size={tile} />, [tile]);

  return (
    <FlatList<VideoTile>
      data={videos ?? []}
      numColumns={3}
      keyExtractor={keyOf}
      renderItem={renderItem}
      ListHeaderComponent={header}
      columnWrapperStyle={styles.row}
      contentContainerStyle={styles.content}
      removeClippedSubviews
      initialNumToRender={12}
      windowSize={7}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.muted} />}
      ListEmptyComponent={
        loading ? (
          <LoadingState />
        ) : failed ? (
          <ErrorState onRetry={onRefresh} />
        ) : (
          <EmptyState icon={empty.icon} title={empty.title} sub={empty.sub} />
        )
      }
    />
  );
}

const keyOf = (v: VideoTile) => v.id;

const styles = StyleSheet.create({
  row: { gap: GRID_GAP },
  content: { gap: GRID_GAP, paddingBottom: 40 },
});
