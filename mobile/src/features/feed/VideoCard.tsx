import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useEventListener } from 'expo';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Animated, AppState, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { countShare, videoLink } from '@/api/discover';
import type { Video } from '@/api/types';
import { trackEngagement } from '@/api/videos';
import { PostPlaceTags } from '@/features/place/PostPlaceTags';
import { ReportSheet } from '@/features/safety/ReportSheet';
import { useAuth } from '@/providers/AuthProvider';

import { patchVideoEverywhere } from './cache';
import { formatCount } from './format';
import { useDeleteVideo } from './useDeleteVideo';
import { useToggleFollow, useToggleLike, useToggleSave } from './useFeed';

type Props = {
  video: Video;
  height: number;
  // This card is the one on screen.
  active: boolean;
  // Within one card of the screen: mount a player so it is buffered before
  // it is swiped to. Further away, only the still is drawn.
  near: boolean;
  muted: boolean;
  onToggleMute: () => void;
};

export const VideoCard = memo(function VideoCard({ video, height, active, near, muted, onToggleMute }: Props) {
  return (
    <View style={[styles.card, { height }]}>
      {near && video.video_url ? (
        <Player video={video} active={active} muted={muted} />
      ) : (
        <Still uri={video.thumbnail} />
      )}
      <Overlay video={video} active={active} muted={muted} onToggleMute={onToggleMute} />
    </View>
  );
});

function Still({ uri }: { uri: string | null }) {
  // Old posts wrote the MP4's own URL into thumbnail; that is not an image.
  const isImage = !!uri && !/\.(mp4|mov|webm)(\?|$)/i.test(uri);
  return isImage ? (
    <Image source={{ uri: uri! }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
  ) : null;
}

function Player({ video, active, muted }: { video: Video; active: boolean; muted: boolean }) {
  // useCaching: the same clip is watched again and again, and every
  // re-download costs the storage egress allowance.
  const player = useVideoPlayer({ uri: video.video_url!, useCaching: true }, (p) => {
    p.loop = true;
    p.muted = muted;
    p.timeUpdateEventInterval = 0.5;
  });
  const [firstFrame, setFirstFrame] = useState(false);
  const watch = useRef({ ms: 0, loops: 0, maxPct: 0, last: 0 });

  useEffect(() => {
    // expo-video's API is a mutable player object; assigning is how it is driven.
    // eslint-disable-next-line react-hooks/immutability
    player.muted = muted;
  }, [player, muted]);

  useEffect(() => {
    if (active) {
      player.play();
      return;
    }
    player.pause();
  }, [player, active]);

  // Watch time, loops and completion feed the For You ranking. Sent when the
  // card stops being the active one, never per second.
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    const w = watch.current;
    if (!active) return;
    const delta = currentTime - w.last;
    if (delta > 0 && delta < 2) w.ms += delta * 1000;
    if (delta < -1) w.loops += 1;
    w.last = currentTime;
    if (player.duration > 0) w.maxPct = Math.max(w.maxPct, Math.min(100, (currentTime / player.duration) * 100));
  });

  useEffect(() => {
    if (active) return;
    const w = watch.current;
    if (w.ms < 500) return;
    void trackEngagement({
      videoId: video.id,
      watchMs: Math.round(w.ms),
      loopCount: w.loops,
      // 0..1, as the server stores it (a 0..100 value was clamped to 1, so
      // nearly every view looked complete).
      completionPct: w.loops > 0 ? 1 : w.maxPct / 100,
    }).catch(() => {});
    watch.current = { ms: 0, loops: 0, maxPct: 0, last: 0 };
  }, [active, video.id]);

  return (
    <>
      {/* The still sits under the video until its first frame, so swiping
          never shows a black card. */}
      {!firstFrame ? <Still uri={video.thumbnail} /> : null}
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
        surfaceType="textureView"
        onFirstFrameRender={() => setFirstFrame(true)}
      />
    </>
  );
}

function Overlay({
  video,
  active,
  muted,
  onToggleMute,
}: {
  video: Video;
  active: boolean;
  muted: boolean;
  onToggleMute: () => void;
}) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const me = session?.user.id;
  const likeM = useToggleLike();
  const saveM = useToggleSave();
  const followM = useToggleFollow();
  const qc = useQueryClient();
  const [heart] = useState(() => new Animated.Value(0));
  const lastTap = useRef(0);

  const isMine = video.user?.id === me;
  const [reportOpen, setReportOpen] = useState(false);
  const del = useDeleteVideo();

  function toggleLike(next = !video.liked) {
    if (next === video.liked) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    likeM.mutate({ id: video.id, next });
  }

  // Double tap likes (never unlikes), single tap toggles sound.
  function onTap() {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      lastTap.current = 0;
      toggleLike(true);
      heart.setValue(0);
      Animated.sequence([
        Animated.spring(heart, { toValue: 1, useNativeDriver: true, friction: 4 }),
        Animated.timing(heart, { toValue: 0, duration: 250, delay: 300, useNativeDriver: true }),
      ]).start();
      return;
    }
    lastTap.current = now;
    setTimeout(() => {
      if (lastTap.current === now) onToggleMute();
    }, 290);
  }

  // Only a completed share counts. iOS says so (sharedAction vs
  // dismissedAction). Android's Share.share resolves "shared" even when the
  // chooser is cancelled, so there a share counts only if the app really went
  // to the background, which is what picking a target app does and cancelling
  // the chooser does not.
  async function share() {
    let wentAway = false;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background' || s === 'inactive') wentAway = true;
    });
    try {
      const res = await Share.share({ message: videoLink(video.id) });
      const done = res.action === Share.sharedAction && (Platform.OS !== 'android' || wentAway);
      if (done) {
        void countShare(video.id);
        patchVideoEverywhere(qc, video.id, (v) => ({ ...v, shares_count: (v.shares_count ?? 0) + 1 }));
      }
    } catch {
      /* a failed share sheet is not a share */
    } finally {
      sub.remove();
    }
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Shades behind the tabs and the caption/rail, so white text stays
          readable on a bright clip. */}
      <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.45)', 'transparent']} style={styles.topShade} />
      <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.6)']} style={styles.bottomShade} />
      <Pressable style={StyleSheet.absoluteFill} onPress={onTap} accessibilityLabel={t('feed.tapHint')} />

      <Animated.View
        pointerEvents="none"
        style={[
          styles.burst,
          { opacity: heart, transform: [{ scale: heart.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.2] }) }] },
        ]}
      >
        <Ionicons name="heart" size={110} color="#ff2d55" />
      </Animated.View>

      {active && muted ? (
        <View style={styles.mutedPill} pointerEvents="none">
          <Ionicons name="volume-mute" size={14} color="#fff" />
          <Text style={styles.mutedText}>{t('feed.tapForSound')}</Text>
        </View>
      ) : null}

      <View style={styles.rail} pointerEvents="box-none">
        <Pressable
          onPress={() => video.user?.id && router.push(`/user/${video.user.id}`)}
          accessibilityRole="button"
          accessibilityLabel={video.user?.name ?? video.user?.handle ?? ''}
          style={styles.avatarWrap}
        >
          {video.user?.avatar_url ? (
            <Image source={{ uri: video.user.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarEmpty]}>
              <Text style={styles.avatarLetter}>{(video.user?.name ?? video.user?.handle ?? '?').slice(0, 1)}</Text>
            </View>
          )}
          {!isMine && !video.following && video.user?.id ? (
            <Pressable
              onPress={() => followM.mutate({ userId: video.user!.id, next: true })}
              style={styles.followBadge}
              accessibilityRole="button"
              accessibilityLabel={t('feed.follow')}
              hitSlop={8}
            >
              <Ionicons name="add" size={14} color="#fff" />
            </Pressable>
          ) : null}
        </Pressable>

        <RailButton
          icon={video.liked ? 'heart' : 'heart-outline'}
          color={video.liked ? '#ff2d55' : '#fff'}
          label={formatCount(video.likes_count)}
          a11y={t(video.liked ? 'feed.unlike' : 'feed.like')}
          onPress={() => toggleLike()}
        />
        <RailButton
          icon="chatbubble-ellipses"
          label={formatCount(video.comments_count)}
          a11y={t('feed.comments')}
          onPress={() => router.push(`/comments/${video.id}`)}
        />
        <RailButton
          icon={video.saved ? 'bookmark' : 'bookmark-outline'}
          color={video.saved ? '#ffc83d' : '#fff'}
          label={formatCount(video.saves_count)}
          a11y={t(video.saved ? 'feed.unsave' : 'feed.save')}
          onPress={() => saveM.mutate({ id: video.id, next: !video.saved })}
        />
        <RailButton icon="arrow-redo" label={formatCount(video.shares_count)} a11y={t('feed.share')} onPress={share} />
        {!isMine ? <RailButton icon="flag-outline" label={t('ugc.report')} a11y={t('ugc.report')} onPress={() => setReportOpen(true)} /> : null}
        {isMine ? (
          <RailButton
            icon="trash-outline"
            label={t('fix4.deleteShort')}
            a11y={t('fix4.deleteVideo')}
            busy={del.busyId === video.id}
            onPress={() => del.confirm(video.id)}
          />
        ) : null}
      </View>
      <ReportSheet visible={reportOpen} onClose={() => setReportOpen(false)} targetType="video" targetId={video.id} />

      <View style={styles.caption} pointerEvents="box-none">
        {/* Profile photo in place of the "@", like the client asked. */}
        <Pressable
          onPress={() => video.user?.id && router.push(`/user/${video.user.id}`)}
          style={styles.who}
          accessibilityRole="link"
          accessibilityLabel={video.user?.name ?? video.user?.handle ?? ''}
          hitSlop={6}
        >
          {video.user?.avatar_url ? (
            <Image source={{ uri: video.user.avatar_url }} style={styles.whoAvatar} />
          ) : (
            <View style={[styles.whoAvatar, styles.avatarEmpty]}>
              <Text style={styles.whoLetter}>{(video.user?.name ?? video.user?.handle ?? '?').slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
          <Text style={styles.handle} numberOfLines={1}>
            {video.user?.handle ?? ''}
          </Text>
        </Pressable>
        {video.description ? (
          <Text style={styles.desc} numberOfLines={3}>
            {video.description}
          </Text>
        ) : null}
        <PostPlaceTags videoId={video.id} active={active} />
        <View style={styles.soundRow}>
          <Ionicons name="musical-notes" size={13} color="#fff" />
          <Text style={styles.sound} numberOfLines={1}>
            {video.music || t('feed.originalSound', { handle: video.user?.handle ?? '' })}
          </Text>
        </View>
      </View>
    </View>
  );
}

function RailButton({
  icon,
  label,
  color = '#fff',
  a11y,
  busy = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color?: string;
  a11y: string;
  busy?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ busy }}
      hitSlop={6}
      style={styles.railBtn}
    >
      {busy ? <ActivityIndicator color="#fff" style={styles.railSpinner} /> : <Ionicons name={icon} size={32} color={color} style={styles.shadow} />}
      <Text style={styles.railLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', backgroundColor: '#000', overflow: 'hidden' },
  topShade: { position: 'absolute', top: 0, left: 0, right: 0, height: 140 },
  bottomShade: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '45%' },
  burst: { position: 'absolute', top: '40%', alignSelf: 'center' },
  mutedPill: {
    position: 'absolute',
    top: 110,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  mutedText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  rail: { position: 'absolute', end: 10, bottom: 24, alignItems: 'center', gap: 18 },
  avatarWrap: { marginBottom: 6, alignItems: 'center' },
  avatar: { width: 46, height: 46, borderRadius: 23, borderWidth: 2, borderColor: '#fff' },
  avatarEmpty: { backgroundColor: '#1e56d6', alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { color: '#fff', fontWeight: '800', fontSize: 18 },
  followBadge: {
    position: 'absolute',
    bottom: -9,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ff2d55',
    alignItems: 'center',
    justifyContent: 'center',
  },
  railBtn: { alignItems: 'center' },
  railSpinner: { width: 32, height: 32 },
  railLabel: { color: '#fff', fontSize: 12, fontWeight: '700', marginTop: 2, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
  shadow: { textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6 },
  caption: { position: 'absolute', start: 12, end: 80, bottom: 22, gap: 4 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', maxWidth: '100%' },
  whoAvatar: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: '#fff' },
  whoLetter: { color: '#fff', fontWeight: '800', fontSize: 13 },
  handle: { flexShrink: 1, color: '#fff', fontWeight: '800', fontSize: 15, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  desc: { color: '#fff', fontSize: 14, lineHeight: 20, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  soundRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  sound: { color: '#fff', fontSize: 13, flexShrink: 1 },
});
