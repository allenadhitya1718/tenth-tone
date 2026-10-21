import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  I18nManager,
  Keyboard,
  PanResponder,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type AccessibilityActionEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import {
  deleteStory,
  fetchUserStories,
  isUnavailableShare,
  likeStory,
  markStoryViewed,
  replyToStory,
  storyKeys,
  type StoryTrayEntry,
  type UserStory,
} from '@/api/stories';
import { fetchProfile, profileKeys } from '@/api/profiles';
import { showAlert } from '@/components/Dialog';
import { showToast } from '@/components/Toast';
import { timeAgo } from '@/lib/timeAgo';
import { useAuth } from '@/providers/AuthProvider';

import { ImageStory, UnavailableStory, VideoStory } from './StoryMedia';
import { storyHref } from './StoryTray';
import { ViewersSheet } from './ViewersSheet';

const IMAGE_MS = 5_000;
// A photo with a song stays up long enough for the song to be heard.
const IMAGE_WITH_SOUND_MS = 15_000;
const HOLD_MS = 220;
const CLOSE_DRAG = 120;
const EASE = Easing.bezier(0.32, 0.72, 0, 1);

const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

// Client notes 22 / 25 / 31: the full-screen story player. Tap the end side
// to go on, the start side to go back (mirrored in RTL), hold to pause,
// swipe down to close. Photos run 5 s (15 s with a song), videos their own
// length. Each story is marked seen once it has actually been shown.
export function StoryViewer({ userId }: { userId: string }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { session } = useAuth();
  const me = session?.user.id ?? null;

  const stories = useQuery({ queryKey: storyKeys.user(userId), queryFn: () => fetchUserStories(userId) });
  const owner = useQuery({ queryKey: profileKeys.profile(userId), queryFn: () => fetchProfile(userId) });
  const list = useMemo(() => stories.data ?? [], [stories.data]);

  // Others' stories open at the first one not yet seen.
  const startIndex = useMemo(() => {
    const i = list.findIndex((s) => !s.seen);
    return i < 0 ? 0 : i;
  }, [list]);
  const [picked, setPicked] = useState<number | null>(null);
  const index = Math.min(picked ?? startIndex, Math.max(0, list.length - 1));
  const story: UserStory | undefined = list[index];
  const isMine = !!story && story.user_id === me;

  // ---------- pause sources ----------
  const [held, setHeld] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [focused, setFocused] = useState(true);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [screenReader, setScreenReader] = useState(false);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [readyId, setReadyId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const ready = !!story && (readyId === story.id || failedId === story.id);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    void AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader);
    const sr = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => {
      sub.remove();
      sr.remove();
    };
  }, []);

  // Typing a reply holds the story, as on Instagram.
  const [typing, setTyping] = useState(false);
  const paused = held || sheetOpen || viewersOpen || typing || !focused || !appActive;
  // With a screen reader the story waits for the "next" action instead of
  // moving on by itself.
  const autoAdvance = !screenReader;

  // ---------- navigation ----------
  const [progress] = useState(() => new Animated.Value(0));
  // Time already shown of the current photo, kept across pauses.
  const elapsed = useRef({ id: '', ms: 0 });
  // Bumped to replay the current story from the start.
  const [round, setRound] = useState(0);

  const goUser = useCallback(
    (dir: 1 | -1) => {
      const tray = qc.getQueryData<StoryTrayEntry[]>(storyKeys.tray()) ?? [];
      const at = tray.findIndex((e) => e.user_id === userId);
      const next = at >= 0 ? tray[at + dir] : undefined;
      if (next && !next.is_me) {
        router.replace(storyHref(next.user_id));
        return true;
      }
      return false;
    },
    [qc, userId],
  );

  const next = useCallback(() => {
    if (index < list.length - 1) setPicked(index + 1);
    else if (!goUser(1)) close();
  }, [index, list.length, goUser]);

  const prev = useCallback(() => {
    if (index > 0) setPicked(index - 1);
    else if (!goUser(-1)) {
      // First story of the first person: start it again.
      progress.setValue(0);
      setPicked(0);
      setRound((r) => r + 1);
    }
  }, [index, goUser, progress]);

  // ---------- photo timer ----------
  const hasSound = !!story && story.media_kind === 'image' && !!story.sound_audio_url;
  const total = hasSound ? IMAGE_WITH_SOUND_MS : IMAGE_MS;

  useEffect(() => {
    progress.setValue(0);
  }, [story?.id, progress]);

  useEffect(() => {
    if (!story || (story.media_kind !== 'image' && !isUnavailableShare(story)) || !ready || paused) return;
    const key = `${story.id}#${round}`;
    if (elapsed.current.id !== key) elapsed.current = { id: key, ms: 0 };
    const done = elapsed.current.ms;
    progress.setValue(done / total);
    const startedAt = Date.now();
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: Math.max(0, total - done),
      easing: Easing.linear,
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished && autoAdvance) next();
    });
    return () => {
      anim.stop();
      elapsed.current.ms += Date.now() - startedAt;
    };
  }, [story, ready, paused, total, progress, next, autoAdvance, round]);

  // ---------- song for photo stories (from sound_start_ms) ----------
  const audio = useAudioPlayer(null);
  const audioStatus = useAudioPlayerStatus(audio);
  const seekedFor = useRef<string | null>(null);
  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);
  useEffect(() => {
    audio.pause();
    seekedFor.current = null;
    if (hasSound && story?.sound_audio_url) audio.replace({ uri: story.sound_audio_url });
  }, [audio, hasSound, story?.id, story?.sound_audio_url]);
  useEffect(() => {
    if (!hasSound || !story || !audioStatus.isLoaded || seekedFor.current === story.id) return;
    seekedFor.current = story.id;
    void audio.seekTo((story.sound_start_ms || 0) / 1000).catch(() => {});
  }, [audio, hasSound, story, audioStatus.isLoaded]);
  useEffect(() => {
    if (hasSound && ready && !paused && audioStatus.isLoaded) audio.play();
    else audio.pause();
  }, [audio, hasSound, ready, paused, audioStatus.isLoaded]);

  // ---------- seen ----------
  const marked = useRef(new Set<string>());
  useEffect(() => {
    if (!story || !ready || isMine || story.seen || marked.current.has(story.id)) return;
    marked.current.add(story.id);
    void markStoryViewed(story.id).then(() => {
      qc.setQueryData<UserStory[]>(storyKeys.user(userId), (old) =>
        old?.map((s) => (s.id === story.id ? { ...s, seen: true } : s)),
      );
    });
  }, [story, ready, isMine, qc, userId]);
  useEffect(() => () => void qc.invalidateQueries({ queryKey: storyKeys.tray() }), [qc]);

  // Next photo is fetched while this one plays.
  useEffect(() => {
    const n = list[index + 1];
    if (n?.media_kind === 'image') void Image.prefetch(n.media_url).catch(() => {});
  }, [list, index]);

  // ---------- delete ----------
  const remove = useMutation({
    mutationFn: (id: string) => deleteStory(id),
    onSuccess: (_, id) => {
      const left = list.filter((s) => s.id !== id);
      qc.setQueryData<UserStory[]>(storyKeys.user(userId), left);
      void qc.invalidateQueries({ queryKey: storyKeys.tray() });
      if (!left.length) close();
      else setPicked(Math.min(index, left.length - 1));
    },
    onError: () => showAlert(t('stories.deleteFailed')),
  });
  // ---------- like and reply (0151) ----------
  // Optimistic per story; the server's answer settles it.
  const [likedNow, setLikedNow] = useState<Record<string, boolean>>({});
  const liked = !!story && (likedNow[story.id] ?? !!story.liked);
  const [heart] = useState(() => new Animated.Value(1));
  const like = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => likeStory(id, on),
    onMutate: ({ id, on }) => {
      setLikedNow((m) => ({ ...m, [id]: on }));
      if (on) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        heart.setValue(0.6);
        Animated.spring(heart, { toValue: 1, friction: 3, tension: 160, useNativeDriver: true }).start();
      }
    },
    onSuccess: (now, { id }) => setLikedNow((m) => ({ ...m, [id]: now })),
    onError: (e, { id, on }) => {
      setLikedNow((m) => ({ ...m, [id]: !on }));
      showAlert(t(e instanceof ApiError && e.code === 'needs_update' ? 'storyReply.err.needsUpdate' : 'storyReply.err.likeFailed'));
    },
  });

  const [reply, setReply] = useState('');
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    // The app draws edge to edge, so the reply bar lifts itself over the
    // keyboard (as the comments sheet does); Android leaves out the
    // navigation-bar inset from the height.
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) =>
      setKbHeight(e.endCoordinates.height + (Platform.OS === 'android' ? insets.bottom : 0)),
    );
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKbHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [insets.bottom]);
  const send = useMutation({
    mutationFn: ({ s, text }: { s: UserStory; text: string }) => replyToStory(s, text),
    onSuccess: () => {
      setReply('');
      Keyboard.dismiss();
      showToast(t('storyReply.sent'), 'paper-plane');
    },
    onError: (e) => {
      const code = e instanceof ApiError ? e.code : '';
      const key =
        code === 'needs_update'
          ? 'storyReply.err.needsUpdate'
          : code === 'story_gone'
            ? 'storyReply.err.gone'
            : code === 'blocked' || code === 'dm_unavailable' || code === 'bad_chat'
              ? 'storyReply.err.cant'
              : 'storyReply.err.generic';
      if (key === 'storyReply.err.generic') console.warn('story reply failed:', (e as Error)?.message ?? e);
      showAlert(t(key));
    },
  });
  const submitReply = () => {
    const text = reply.trim();
    if (!story || !text || send.isPending) return;
    send.mutate({ s: story, text });
  };

  const confirmDelete = () => {
    if (!story) return;
    setSheetOpen(true);
    showAlert(t('stories.deleteQ'), t('stories.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel', onPress: () => setSheetOpen(false) },
      {
        text: t('stories.delete'),
        style: 'destructive',
        onPress: () => {
          setSheetOpen(false);
          remove.mutate(story.id);
        },
      },
    ], { cancelable: true, onDismiss: () => setSheetOpen(false) });
  };
  // ---------- gestures ----------
  const [dragY] = useState(() => new Animated.Value(0));
  const pan = useMemo(() => createStoryPan({ next, prev, setHeld, width, dragY }), [next, prev, width, dragY]);

  const onA11yAction = (e: AccessibilityActionEvent) => {
    switch (e.nativeEvent.actionName) {
      case 'increment':
      case 'next':
        next();
        break;
      case 'decrement':
      case 'previous':
        prev();
        break;
      case 'magicTap':
      case 'pause':
        setHeld((h) => !h);
        break;
      case 'escape':
        close();
        break;
    }
  };

  // ---------- render ----------
  const scale = dragY.interpolate({ inputRange: [0, 400], outputRange: [1, 0.86], extrapolate: 'clamp' });
  const radius = dragY.interpolate({ inputRange: [0, 60], outputRange: [0, 24], extrapolate: 'clamp' });
  const backdrop = dragY.interpolate({ inputRange: [0, 400], outputRange: [1, 0.2], extrapolate: 'clamp' });

  if (stories.isLoading || stories.isError || !story) {
    return (
      <View style={[styles.root, styles.center]}>
        <StatusBar barStyle="light-content" />
        {stories.isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Text style={styles.stateText}>{t(stories.isError ? 'stories.loadFailed' : 'stories.noneLeft')}</Text>
            {stories.isError ? (
              <Pressable onPress={() => void stories.refetch()} style={styles.stateBtn} accessibilityRole="button">
                <Text style={styles.stateBtnText}>{t('stories.retry')}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={close} style={styles.stateBtn} accessibilityRole="button">
              <Text style={styles.stateBtnText}>{t('stories.close')}</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  const ownerName = isMine ? t('stories.yourStory') : owner.data?.name || owner.data?.handle || '';
  const ownerAvatar = owner.data?.avatar_url ?? null;
  const ago = timeAgo(story.created_at, t, i18n.language);
  const a11yLabel = [
    t('stories.storyOf', { n: index + 1, total: list.length, name: ownerName }),
    ago,
    story.caption ?? '',
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Animated.View style={[styles.root, { backgroundColor: 'transparent' }]}>
      <StatusBar barStyle="light-content" />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: backdrop }]} />
      <Animated.View
        style={[styles.stage, { borderRadius: radius, transform: [{ translateY: dragY }, { scale }] }]}
      >
        {isUnavailableShare(story) ? (
          <UnavailableStory key={story.id} story={story} onReady={setReadyId} />
        ) : story.media_kind === 'video' ? (
          <VideoStory
            key={`${story.id}#${round}`}
            story={story}
            paused={paused || !ready}
            progress={progress}
            onReady={setReadyId}
            onFail={setFailedId}
            onEnd={() => autoAdvance && next()}
          />
        ) : (
          <ImageStory key={story.id} story={story} onReady={setReadyId} onFail={setFailedId} />
        )}

        {/* Gesture surface: taps, hold, swipe down. */}
        <View
          style={StyleSheet.absoluteFill}
          {...pan.panHandlers}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={a11yLabel}
          accessibilityHint={t('stories.surfaceHint')}
          accessibilityActions={[
            { name: 'increment', label: t('stories.next') },
            { name: 'decrement', label: t('stories.previous') },
            { name: 'magicTap', label: t('stories.pause') },
            { name: 'escape', label: t('stories.close') },
            { name: 'next', label: t('stories.next') },
            { name: 'previous', label: t('stories.previous') },
            { name: 'pause', label: paused ? t('stories.play') : t('stories.pause') },
          ]}
          onAccessibilityAction={onA11yAction}
        />

        {!ready ? (
          <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
            <ActivityIndicator color="#fff" size="large" />
          </View>
        ) : null}
        {failedId === story.id ? (
          <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
            <Ionicons name="alert-circle-outline" size={36} color="#fff" />
            <Text style={styles.stateText}>{t('stories.mediaFailed')}</Text>
          </View>
        ) : null}

        {/* Top: progress + who */}
        <LinearGradient
          colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']}
          style={[styles.top, { paddingTop: insets.top + 8 }]}
          pointerEvents="box-none"
        >
          <View style={styles.bars} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            {list.map((s, i) => (
              <View key={s.id} style={styles.bar}>
                {i < index ? <View style={[StyleSheet.absoluteFill, styles.fill]} /> : null}
                {i === index ? (
                  <Animated.View
                    style={[
                      StyleSheet.absoluteFill,
                      styles.fill,
                      { transformOrigin: I18nManager.isRTL ? 'right' : 'left', transform: [{ scaleX: progress }] },
                    ]}
                  />
                ) : null}
              </View>
            ))}
          </View>
          <View style={styles.who}>
            <Pressable
              onPress={() => router.push(`/user/${story.user_id}`)}
              style={styles.whoBtn}
              accessibilityRole="button"
              accessibilityLabel={t('stories.openProfile', { name: ownerName })}
            >
              <View style={styles.avatar}>
                {ownerAvatar ? (
                  <Image source={{ uri: ownerAvatar }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <Ionicons name="person" size={18} color="#fff" />
                )}
              </View>
              <Text style={styles.whoName} numberOfLines={1}>
                {ownerName}
              </Text>
              <Text style={styles.whoAgo}>{ago}</Text>
              {story.audience === 'close_friends' ? (
                <View style={styles.cfBadge}>
                  <Ionicons name="star" size={10} color="#fff" />
                </View>
              ) : null}
            </Pressable>
            {paused && held ? <Ionicons name="pause" size={18} color="#fff" style={{ marginEnd: 6 }} /> : null}
            <Pressable
              onPress={close}
              hitSlop={10}
              style={styles.iconBtn}
              accessibilityRole="button"
              accessibilityLabel={t('stories.close')}
            >
              <Ionicons name="close" size={28} color="#fff" />
            </Pressable>
          </View>
        </LinearGradient>

        {/* Bottom: sound, caption, owner tools */}
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.65)']}
          style={[styles.bottom, { paddingBottom: kbHeight > 0 ? kbHeight + 8 : insets.bottom + 14 }]}
          pointerEvents="box-none"
        >
          {hasSound && story.sound_title ? (
            <View style={styles.soundPill} pointerEvents="none">
              <Ionicons name="musical-notes" size={14} color="#fff" />
              <Text style={styles.soundText} numberOfLines={1}>
                {story.sound_title}
                {story.sound_author ? ` · ${story.sound_author}` : ''}
              </Text>
            </View>
          ) : null}
          {story.caption ? (
            <Text style={styles.caption} pointerEvents="none">
              {story.caption}
            </Text>
          ) : null}
          {story.shared_video_id && !isUnavailableShare(story) ? (
            // 0155: whose video this is; opens the original post.
            <Pressable
              onPress={() => router.push(`/video/${story.shared_video_id}`)}
              style={styles.shareCardWrap}
              accessibilityRole="button"
              accessibilityLabel={t('storyShare.watchA11y', { name: story.shared_name || story.shared_handle || '' })}
            >
              <BlurView intensity={40} tint="dark" style={styles.shareCard}>
                <View style={styles.shareAvatar}>
                  {story.shared_avatar ? (
                    <Image source={{ uri: story.shared_avatar }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  ) : (
                    <Ionicons name="person" size={14} color="#fff" />
                  )}
                </View>
                <View style={styles.shareWho}>
                  <Text style={styles.shareName} numberOfLines={1}>
                    {story.shared_name || story.shared_handle}
                  </Text>
                  {story.shared_handle ? (
                    <Text style={styles.shareHandle} numberOfLines={1}>
                      @{story.shared_handle}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.shareWatch}>{t('storyShare.watch')}</Text>
                <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color="#fff" />
              </BlurView>
            </Pressable>
          ) : null}
          {isMine ? (
            <View style={styles.ownerRow}>
              <Pressable
                onPress={() => setViewersOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={t('stories.seenByCount', { count: story.view_count ?? 0 })}
                style={styles.glassWrap}
              >
                <BlurView intensity={40} tint="dark" style={styles.glass}>
                  <Ionicons name="eye-outline" size={18} color="#fff" />
                  <Text style={styles.glassText}>{t('stories.seenByCount', { count: story.view_count ?? 0 })}</Text>
                </BlurView>
              </Pressable>
              <Pressable
                onPress={confirmDelete}
                disabled={remove.isPending}
                accessibilityRole="button"
                accessibilityLabel={t('stories.delete')}
                accessibilityState={{ busy: remove.isPending }}
                style={styles.glassWrap}
              >
                <BlurView intensity={40} tint="dark" style={[styles.glass, styles.glassRound]}>
                  {remove.isPending ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Ionicons name="trash-outline" size={20} color="#fff" />
                  )}
                </BlurView>
              </Pressable>
            </View>
          ) : (
            <View style={styles.replyRow}>
              <View style={styles.replyBox}>
                <TextInput
                  value={reply}
                  onChangeText={setReply}
                  onFocus={() => setTyping(true)}
                  onBlur={() => setTyping(false)}
                  placeholder={t('storyReply.placeholder', { name: ownerName })}
                  placeholderTextColor="rgba(255,255,255,0.75)"
                  maxLength={1000}
                  multiline
                  returnKeyType="send"
                  submitBehavior="submit"
                  onSubmitEditing={submitReply}
                  style={styles.replyInput}
                  accessibilityLabel={t('storyReply.placeholder', { name: ownerName })}
                />
              </View>
              {reply.trim() ? (
                <Pressable
                  onPress={submitReply}
                  disabled={send.isPending}
                  hitSlop={6}
                  style={styles.iconBtn}
                  accessibilityRole="button"
                  accessibilityLabel={t('storyReply.send')}
                  accessibilityState={{ busy: send.isPending }}
                >
                  {send.isPending ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Ionicons name="paper-plane" size={24} color="#fff" style={I18nManager.isRTL ? styles.flip : undefined} />
                  )}
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => story && like.mutate({ id: story.id, on: !liked })}
                  hitSlop={6}
                  style={styles.iconBtn}
                  accessibilityRole="button"
                  accessibilityLabel={liked ? t('storyReply.unlike') : t('storyReply.like')}
                  accessibilityState={{ selected: liked }}
                >
                  <Animated.View style={{ transform: [{ scale: heart }] }}>
                    <Ionicons name={liked ? 'heart' : 'heart-outline'} size={28} color={liked ? '#FF3B5C' : '#fff'} />
                  </Animated.View>
                </Pressable>
              )}
            </View>
          )}
        </LinearGradient>
      </Animated.View>

      {isMine ? (
        <ViewersSheet
          storyId={story.id}
          count={story.view_count}
          visible={viewersOpen}
          onClose={() => setViewersOpen(false)}
        />
      ) : null}
    </Animated.View>
  );
}

type PanActions = {
  next: () => void;
  prev: () => void;
  setHeld: (v: boolean) => void;
  width: number;
  dragY: Animated.Value;
};

// Taps (start side back, end side forward, mirrored in RTL), hold to pause
// and drag down to close, on one responder so they never fight each other.
function createStoryPan(a: PanActions) {
  const { dragY } = a;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let isHeld = false;
  let dragging = false;
  const reset = () => {
    clearTimeout(holdTimer);
    if (isHeld || dragging) a.setHeld(false);
    isHeld = false;
    dragging = false;
  };
  return PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      isHeld = false;
      dragging = false;
      holdTimer = setTimeout(() => {
        isHeld = true;
        a.setHeld(true);
      }, HOLD_MS);
    },
    onPanResponderMove: (_, g) => {
      if (Math.abs(g.dy) > 10 || Math.abs(g.dx) > 10) clearTimeout(holdTimer);
      if (!dragging && g.dy > 12 && Math.abs(g.dy) > Math.abs(g.dx)) {
        dragging = true;
        a.setHeld(true);
      }
      if (dragging) dragY.setValue(Math.max(0, g.dy));
    },
    onPanResponderRelease: (e, g) => {
      clearTimeout(holdTimer);
      if (dragging) {
        if (g.dy > CLOSE_DRAG || g.vy > 1) {
          Animated.timing(dragY, { toValue: 1200, duration: 220, easing: EASE, useNativeDriver: true }).start(close);
          return;
        }
        Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
        reset();
        return;
      }
      if (isHeld) {
        reset();
        return;
      }
      const w = a.width;
      const x = e.nativeEvent.pageX;
      const startSide = I18nManager.isRTL ? x > w * 0.7 : x < w * 0.3;
      void Haptics.selectionAsync().catch(() => {});
      if (startSide) a.prev();
      else a.next();
    },
    onPanResponderTerminate: () => {
      Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start();
      reset();
    },
  });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  stage: { flex: 1, overflow: 'hidden', backgroundColor: '#000' },
  stateText: { color: '#fff', fontSize: 15, textAlign: 'center' },
  stateBtn: { paddingHorizontal: 22, minHeight: 44, borderRadius: 22, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  stateBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  top: { position: 'absolute', top: 0, start: 0, end: 0, paddingHorizontal: 10, paddingBottom: 24 },
  bars: { flexDirection: 'row', gap: 4 },
  bar: { flex: 1, height: 2.5, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
  fill: { backgroundColor: '#fff' },
  who: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  whoBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  whoName: { color: '#fff', fontWeight: '700', fontSize: 14, flexShrink: 1 },
  whoAgo: { color: 'rgba(255,255,255,0.75)', fontSize: 13 },
  cfBadge: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#16A34A', alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', bottom: 0, start: 0, end: 0, paddingHorizontal: 16, paddingTop: 48, gap: 10 },
  soundPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.16)',
    maxWidth: '85%',
  },
  soundText: { color: '#fff', fontSize: 13, fontWeight: '600', flexShrink: 1 },
  caption: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 23,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 6,
  },
  shareCardWrap: { alignSelf: 'center', borderRadius: 22, overflow: 'hidden', marginBottom: 10, maxWidth: '90%' },
  shareCard: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingStart: 6, paddingEnd: 12, paddingVertical: 6 },
  shareAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareWho: { flexShrink: 1 },
  shareName: { color: '#fff', fontSize: 14, fontWeight: '700', textAlign: 'left' },
  shareHandle: { color: 'rgba(255,255,255,0.8)', fontSize: 12, textAlign: 'left' },
  shareWatch: { color: '#fff', fontSize: 14, fontWeight: '700', marginStart: 6 },
  ownerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  glassWrap: { borderRadius: 24, overflow: 'hidden' },
  glass: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    minHeight: 44,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  glassRound: { width: 44, paddingHorizontal: 0, justifyContent: 'center' },
  glassText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  replyRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 4 },
  replyBox: {
    flex: 1,
    minHeight: 46,
    maxHeight: 120,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  replyInput: { color: '#fff', fontSize: 15, paddingVertical: 10, textAlign: I18nManager.isRTL ? 'right' : 'left' },
  flip: { transform: [{ scaleX: -1 }] },
});
