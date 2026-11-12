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

import { fetchHighlight, fetchRecentHighlights, highlightKeys, type LiveHighlight } from '@/api/highlights';
import { fetchProfile, profileKeys } from '@/api/profiles';
import type { Video } from '@/api/types';
import { type FeedTab, fetchVideo } from '@/api/videos';
import { NotFoundState } from '@/components/NotFoundState';
import { HighlightFeedCard, highlightDeletedHere } from '@/features/highlights/HighlightFeedCard';
import { Button } from '@/components/ui';
import { useAuth } from '@/providers/AuthProvider';

import { useFeed } from './useFeed';
import { wasDeletedHere } from './useDeleteVideo';
import { VideoCard } from './VideoCard';

type ViewToken = { isViewable: boolean; index?: number | null };

// A page of the feed: a video, or a live highlight (lives are audio, and
// permanent posts are gone). For You is highlights only (client, Nov 2026);
// Following keeps the videos of the people you follow.
type FeedItem = { kind: 'video'; id: string; at: number; v: Video } | { kind: 'highlight'; id: string; at: number; h: LiveHighlight };
const asVideo = (v: Video): FeedItem => ({ kind: 'video', id: v.id, at: Date.parse(v.created_at) || 0, v });
const asHighlight = (h: LiveHighlight): FeedItem => ({ kind: 'highlight', id: h.id, at: Date.parse(h.created_at) || 0, h });

// A video or a highlight to show first, ahead of the normal feed (`at`
// changes on every open, so the same clip can be pinned again). Grid tiles,
// notifications and links open clips this way, so a swipe carries on into
// the feed, as on Reels.
export type Pin = { kind: 'video' | 'highlight'; id: string; at: string };

// One tab of the home feed: a vertical pager of full-height clips (For You:
// everyone's highlights, newest first; Following: videos of the people you
// follow). It snaps
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
  const pin =
    pinProp && !(pinProp.kind === 'video' ? wasDeletedHere(pinProp.id) : highlightDeletedHere(pinProp.id)) ? pinProp : undefined;
  const forYou = tab === 'foryou';
  // For You: highlights. Following: videos (their query stays off on For You).
  const q = useFeed(tab, !forYou);
  const [index, setIndex] = useState(0);
  const list = useRef<FlatList<FeedItem>>(null);
  const hl = useQuery({
    queryKey: highlightKeys.recent(),
    queryFn: () => fetchRecentHighlights(50),
    enabled: forYou,
    staleTime: 30_000,
  });
  const pinned = useQuery<FeedItem | null>({
    queryKey: ['feed-pin', pin?.kind, pin?.id],
    queryFn: async () => {
      if (pin!.kind === 'highlight') {
        const h = await fetchHighlight(pin!.id);
        return h ? asHighlight(h) : null;
      }
      const v = await fetchVideo(pin!.id);
      return v ? asVideo(v) : null;
    },
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
    const first = pin && pinned.data?.kind === pin.kind && pinned.data.id === pin.id ? pinned.data : null;
    const all = forYou ? (hl.data ?? []).map(asHighlight) : (feed?.flat() ?? []).map(asVideo);
    const rest = all.filter((x) => !(first && x.kind === first.kind && x.id === first.id)).sort((a, b) => b.at - a.at);
    // A pinned clip stays first.
    return first ? [first, ...rest] : rest;
  }, [forYou, feed, hl.data, pin, pinned.data]);

  // For You loops: after the last highlight the same ones follow again
  // instead of the "all caught up" card. Following still ends.
  const looping = forYou && hl.isSuccess && videos.length > 0;
  const hasMore = !forYou && q.hasNextPage;
  const [rounds, setRounds] = useState(1);
  const items = useMemo(() => {
    if (!looping) return videos;
    const out = [...videos];
    for (let r = 0; r < rounds; r++) out.push(...videos);
    return out;
  }, [looping, videos, rounds]);

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
    ({ item, index: i }: { item: FeedItem; index: number }) =>
      item.kind === 'video' ? (
        <VideoCard
          video={item.v}
          height={height}
          active={focused && i === index}
          near={Math.abs(i - index) <= 1}
          muted={muted}
          onToggleMute={onToggleMute}
        />
      ) : (
        <HighlightFeedCard
          item={item.h}
          height={height}
          active={focused && i === index}
          near={Math.abs(i - index) <= 1}
          muted={muted}
          onToggleMute={onToggleMute}
        />
      ),
    [height, focused, index, muted, onToggleMute],
  );

  // Wait for the pinned clip too, so the feed is not re-sorted under the
  // viewer when it arrives.
  if ((forYou ? hl.isLoading : q.isLoading) || height === 0 || (pin && pinned.isLoading)) {
    return (
      <View style={[styles.center, { height }]}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  // A link to a clip that is gone (or never existed): say so, with a way
  // out, instead of silently showing the normal feed.
  if (pin && pinned.isSuccess && !pinned.data) {
    return (
      <View style={{ height, backgroundColor: '#000' }}>
        {pin.kind === 'highlight' ? (
          <NotFoundState dark embedded icon="mic-off-outline" title={t('live.highlight.gone')} />
        ) : (
          <NotFoundState dark embedded icon="videocam-off-outline" title={t('fix4.notFoundVideoTitle')} body={t('fix4.notFoundVideoBody')} />
        )}
      </View>
    );
  }

  if (forYou ? hl.isError : q.isError) {
    return (
      <View style={[styles.center, { height }]}>
        <Text style={styles.msg}>{t('feed.error')}</Text>
        <Button title={t('feed.retry')} onPress={() => void (forYou ? hl.refetch() : q.refetch())} style={{ paddingHorizontal: 28 }} />
      </View>
    );
  }

  if (!videos.length) {
    // Following with nothing to show: say why (posts are gone, highlights
    // are what appears here) and give a way on, instead of bare text.
    if (tab === 'following') {
      return (
        <View style={[styles.center, { height }]}>
          <Ionicons name="mic-outline" size={48} color="#fff" />
          <Text style={styles.endTitle}>{t(followsSomeone.data ? 'live.highlight.followingQuietTitle' : 'live.highlight.followingNoneTitle')}</Text>
          <Text style={styles.msg}>{t(followsSomeone.data ? 'live.highlight.followingQuiet' : 'live.highlight.followingNone')}</Text>
          <Button title={t('live.highlight.toExplore')} onPress={() => router.navigate('/discover')} style={{ paddingHorizontal: 28 }} />
        </View>
      );
    }
    return (
      <View style={[styles.center, { height }]}>
        <Text style={styles.msg}>{t('feed.empty')}</Text>
      </View>
    );
  }

  return (
    <FlatList
      ref={list}
      data={items}
      // Repeated rounds reuse ids, so the round goes into the key.
      keyExtractor={(v, i) => (i < videos.length ? `${v.kind}:${v.id}` : `${v.kind}:${v.id}:${Math.floor(i / videos.length)}`)}
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
      onEndReached={() => {
        if (hasMore) {
          if (!q.isFetchingNextPage) void q.fetchNextPage();
        } else if (looping) {
          setRounds((r) => Math.min(r + 1, 50));
        }
      }}
      // A full-height last page, so a swipe past the final video always lands
      // somewhere and says why there is nothing more (like Instagram).
      ListFooterComponent={
        hasMore || looping ? undefined : (
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
          refreshing={forYou ? hl.isRefetching : q.isRefetching && !q.isFetchingNextPage}
          onRefresh={() => {
            setIndex(0);
            setRounds(1);
            void (forYou ? hl.refetch() : q.refetch());
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
