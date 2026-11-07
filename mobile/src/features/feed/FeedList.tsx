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

import { fetchFollowingHighlights, fetchRecentHighlights, highlightKeys, type LiveHighlight } from '@/api/highlights';
import { fetchProfile, profileKeys } from '@/api/profiles';
import type { Video } from '@/api/types';
import { type FeedTab, fetchVideo, videoKeys } from '@/api/videos';
import { NotFoundState } from '@/components/NotFoundState';
import { HighlightFeedCard } from '@/features/highlights/HighlightFeedCard';
import { Button } from '@/components/ui';
import { useAuth } from '@/providers/AuthProvider';

import { useFeed } from './useFeed';
import { wasDeletedHere } from './useDeleteVideo';
import { VideoCard } from './VideoCard';

type ViewToken = { isViewable: boolean; index?: number | null };

// A page of the feed: a video, or a live highlight (lives are audio, and
// permanent posts are gone, so highlights are most of what there is).
type FeedItem = { kind: 'video'; id: string; at: number; v: Video } | { kind: 'highlight'; id: string; at: number; h: LiveHighlight };
const asVideo = (v: Video): FeedItem => ({ kind: 'video', id: v.id, at: Date.parse(v.created_at) || 0, v });
const asHighlight = (h: LiveHighlight): FeedItem => ({ kind: 'highlight', id: h.id, at: Date.parse(h.created_at) || 0, h });

// A video to show first, ahead of the normal feed (`at` changes on every
// open, so the same clip can be pinned again).
export type Pin = { id: string; at: string };

// One tab of the home feed: a vertical pager of full-height clips, videos
// and live highlights together, newest first (For You: everyone's
// highlights; Following: those of people you follow). It snaps
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
  const list = useRef<FlatList<FeedItem>>(null);
  // A failure here only leaves highlights out; the videos still show.
  const hl = useQuery({
    queryKey: tab === 'following' ? highlightKeys.following() : highlightKeys.recent(),
    queryFn: () => (tab === 'following' ? fetchFollowingHighlights() : fetchRecentHighlights(50)),
    staleTime: 30_000,
  });
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
    enabled: tab === 'following' && !!me && q.isSuccess && !(feed?.some((p) => p.length) ?? false) && !hl.data?.length,
    select: (p) => (p?.following_count ?? 0) > 0,
  });
  const videos = useMemo(() => {
    const first = pin && pinned.data?.id === pin.id ? pinned.data : null;
    const rest = [...(feed?.flat() ?? []).filter((v) => v.id !== first?.id).map(asVideo), ...(hl.data ?? []).map(asHighlight)].sort(
      (a, b) => b.at - a.at,
    );
    // A pinned video stays first.
    return first ? [asVideo(first), ...rest] : rest;
  }, [feed, hl.data, pin, pinned.data]);

  // While there are only a few videos, For You loops: once the server has
  // nothing more (no next page), the same videos follow again instead of the
  // "all caught up" card. With enough videos the server keeps sending new
  // pages (0108/0157) and this never kicks in. Following still ends.
  const looping = tab === 'foryou' && !!q.data && !q.hasNextPage && videos.length > 0;
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

  // Videos and highlights load separately; wait for both, so the feed is
  // not re-sorted under the viewer when the second one arrives (on the
  // Redmi's slow 4G the video showed first, then the highlight slid in).
  // A failed highlight query is not loading, so it never blocks the videos.
  if (q.isLoading || hl.isLoading || height === 0 || (pin && pinned.isLoading)) {
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
        if (q.hasNextPage) {
          if (!q.isFetchingNextPage) void q.fetchNextPage();
        } else if (looping) {
          setRounds((r) => Math.min(r + 1, 50));
        }
      }}
      // A full-height last page, so a swipe past the final video always lands
      // somewhere and says why there is nothing more (like Instagram).
      ListFooterComponent={
        q.hasNextPage || looping ? undefined : (
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
            setRounds(1);
            void q.refetch();
            void hl.refetch();
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
