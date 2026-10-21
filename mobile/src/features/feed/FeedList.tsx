import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { fetchProfile, profileKeys } from '@/api/profiles';
import type { Video } from '@/api/types';
import { type FeedTab, fetchVideo, videoKeys } from '@/api/videos';
import { NotFoundState } from '@/components/NotFoundState';
import { Button } from '@/components/ui';
import { useAuth } from '@/providers/AuthProvider';

import { useFeed } from './useFeed';
import { wasDeletedHere } from './useDeleteVideo';
import { VideoCard } from './VideoCard';

type ViewToken = { isViewable: boolean; index?: number | null };

// A video to show first, ahead of the normal feed (`at` changes on every
// open, so the same clip can be pinned again).
export type Pin = { id: string; at: string };

// One tab of the home feed: a vertical pager of full-height clips. It snaps
// every `height` with interval momentum off, so any flick, however light,
// or a drag past half way moves exactly one clip, as on Reels / TikTok.
// (pagingEnabled on Android only turned the page on a hard fling, and a
// gentle swipe sprang back.)
export function FeedList({
  tab,
  pin: pinProp,
  height,
  focused,
  muted,
  onToggleMute,
}: {
  tab: FeedTab;
  pin?: Pin;
  height: number;
  // The tab is the one on screen; off-screen tabs keep no clip playing.
  focused: boolean;
  muted: boolean;
  onToggleMute: () => void;
}) {
  const { t } = useTranslation();
  // A pinned clip the user has just deleted is dropped (the normal feed
  // shows) rather than turning into "Video not found".
  const pin = pinProp && !wasDeletedHere(pinProp.id) ? pinProp : undefined;
  const q = useFeed(tab);
  const [index, setIndex] = useState(0);
  const list = useRef<FlatList<Video>>(null);
  const pinned = useQuery({
    queryKey: videoKeys.video(pin?.id ?? ''),
    queryFn: () => fetchVideo(pin!.id),
    enabled: !!pin,
  });
  const feed = q.data?.pages;
  // An empty Following tab: "follow people" only when you follow nobody;
  // when you do but none of them has posted, say that instead (run 9).
  const { session } = useAuth();
  const me = session?.user.id;
  const followsSomeone = useQuery({
    queryKey: profileKeys.profile(me ?? ''),
    queryFn: () => fetchProfile(me),
    enabled: tab === 'following' && !!me && q.isSuccess && !(feed?.some((p) => p.length) ?? false),
    select: (p) => (p?.following_count ?? 0) > 0,
  });
  const videos = useMemo(() => {
    const all = feed?.flat() ?? [];
    const first = pin && pinned.data?.id === pin.id ? pinned.data : null;
    return first ? [first, ...all.filter((v) => v.id !== first.id)] : all;
  }, [feed, pin, pinned.data]);

  // Back to the top whenever a video is pinned, so it is the one playing.
  const pinKey = pin ? `${pin.id}:${pin.at}` : '';
  const [seenPin, setSeenPin] = useState(pinKey);
  if (seenPin !== pinKey) {
    setSeenPin(pinKey);
    if (pinKey) setIndex(0);
  }
  useEffect(() => {
    if (pinKey) list.current?.scrollToOffset({ offset: 0, animated: false });
  }, [pinKey]);

  // Stable identity: FlatList refuses a changing onViewableItemsChanged.
  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable);
    if (first?.index != null) setIndex(first.index);
  }, []);
  // The clip the snap settled on plays at once, without waiting for the
  // viewability pass.
  const onSettled = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (height > 0) setIndex(Math.max(0, Math.round(e.nativeEvent.contentOffset.y / height)));
    },
    [height],
  );

  const renderItem = useCallback(
    ({ item, index: i }: { item: Video; index: number }) => (
      <VideoCard
        video={item}
        height={height}
        active={focused && i === index}
        near={Math.abs(i - index) <= 1}
        muted={muted}
        onToggleMute={onToggleMute}
      />
    ),
    [height, focused, index, muted, onToggleMute],
  );

  if (q.isLoading || height === 0 || (pin && pinned.isLoading)) {
    return (
      <View style={[styles.center, { height }]}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  // A link to a video that is gone (or never existed): say so, with a way
  // out, instead of silently showing the normal feed.
  if (pin && pinned.isSuccess && !pinned.data) {
    return (
      <View style={{ height, backgroundColor: '#000' }}>
        <NotFoundState dark embedded icon="videocam-off-outline" title={t('fix4.notFoundVideoTitle')} body={t('fix4.notFoundVideoBody')} />
      </View>
    );
  }

  if (q.isError) {
    return (
      <View style={[styles.center, { height }]}>
        <Text style={styles.msg}>{t('feed.error')}</Text>
        <Button title={t('feed.retry')} onPress={() => q.refetch()} style={{ paddingHorizontal: 28 }} />
      </View>
    );
  }

  if (!videos.length) {
    return (
      <View style={[styles.center, { height }]}>
        <Text style={styles.msg}>
          {t(tab !== 'following' ? 'feed.empty' : followsSomeone.data ? 'polish.feed.followingNoPosts' : 'feed.emptyFollowing')}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      ref={list}
      data={videos}
      keyExtractor={(v) => v.id}
      renderItem={renderItem}
      snapToInterval={height}
      snapToAlignment="start"
      disableIntervalMomentum
      decelerationRate="fast"
      onMomentumScrollEnd={onSettled}
      showsVerticalScrollIndicator={false}
      getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
      onViewableItemsChanged={onViewable}
      viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}
      windowSize={3}
      initialNumToRender={2}
      maxToRenderPerBatch={2}
      removeClippedSubviews
      onEndReachedThreshold={2}
      onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
      // A full-height last page, so a swipe past the final video always lands
      // somewhere and says why there is nothing more (like Instagram).
      ListFooterComponent={
        q.hasNextPage ? undefined : (
          <View style={[styles.center, { height }]}>
            <Ionicons name="checkmark-circle-outline" size={56} color="#fff" />
            <Text style={styles.endTitle}>{t('feed.caughtUpTitle')}</Text>
            <Text style={styles.msg}>{t('feed.caughtUpBody')}</Text>
            <Button title={t('feed.caughtUpCta')} onPress={() => router.navigate('/discover')} style={{ paddingHorizontal: 28 }} />
          </View>
        )
      }
      refreshControl={
        <RefreshControl
          refreshing={q.isRefetching && !q.isFetchingNextPage}
          onRefresh={() => {
            setIndex(0);
            void q.refetch();
          }}
          tintColor="#fff"
          colors={['#1e56d6']}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 32, backgroundColor: '#000' },
  msg: { color: '#fff', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  endTitle: { color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center' },
});
