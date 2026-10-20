import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  ActivityIndicator,
  BackHandler,
  FlatList,
  I18nManager,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isCommentBlocked } from '@/api/comments';
import { showAlert } from '@/components/Dialog';
import { refusalKind } from '@/lib/serverError';
import { giftKeys, subscribeToLiveGifts, type Gift } from '@/api/gifts';
import {
  approveLiveGuest,
  endLive,
  inviteToLive,
  joinLiveReactions,
  joinLiveStream,
  leaveLiveStage,
  leaveLiveStream,
  liveKeys,
  postLiveComment,
  removeLiveGuest,
  requestToJoinLive,
  respondLiveInvite,
  type LiveComment,
  type LiveGuestStatus,
  type LiveReactions,
  type LiveStream,
} from '@/api/live';
import type { UserSummary } from '@/api/types';
import { Button } from '@/components/ui';
import { formatCount } from '@/features/feed/format';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/providers/ThemeProvider';

import { agoraUidFor, formatDuration, liveLink, MAX_COMMENT, MAX_GUESTS } from './config';
import { liveError, serverDetail } from './errors';
import { GiftBanner, GiftTray, useGiftBanner } from './Gifts';
import { ModerationSheet, type ModerationTarget } from './ModerationSheet';
import { FloaterLayer, ReactionTray, useFloaters } from './Reactions';
import { Avatar, OptionRow, Sheet } from './Sheet';
import { createSpeakingStore } from './speakingStore';
import { Stage, type StageSpeaker } from './Stage';
import { StageManager } from './StageManager';
import { useAgoraAudio } from './useAgoraAudio';
import {
  useElapsed,
  useHostHeartbeat,
  useLiveComments,
  useLiveGuests,
  useLiveStreamRow,
  useProfileLookup,
} from './useLiveData';
import { atHandle } from '@/lib/handle';

// One screen for the host, the audience and guests on stage (client notes 4,
// 5, 6, 7, 17, 29). Port of V.live in web/js/views.js, audio only.
//
// Who you are decides the controls:
//   host     End, the stage manager, mic; publishes from the start
//   viewer   Request to speak, gifts, report the stream; listens
//   guest    a viewer whose live_guests row is 'accepted': mic and Leave
//            stage; publishes for as long as the row stays 'accepted'
//
// Nothing here leaves the room by navigating within it: every panel is a
// Modal sheet, because for the host leaving is ending.

const BG = '#000421';
const DIM = 'rgba(255,255,255,0.72)';

export function LiveRoom({ liveId, hostHint }: { liveId: string; hostHint: boolean }) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const me = session?.user.id ?? null;
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const lookup = useProfileLookup();

  const stream = useLiveStreamRow(liveId);
  const live = stream.data ?? null;
  const host = live?.host ?? null;
  const isHost = !!me && host?.id === me;
  const isLive = live?.status === 'live';
  const ended = !!live && !isLive;

  // ---------- people this viewer chose not to see ----------
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const hide = useCallback((userId: string) => setHidden((prev) => new Set(prev).add(userId)), []);

  // ---------- counted in as a viewer (required for invites, 0103) ----------
  const { setViewerCount } = stream;
  const countMeIn = isLive && !isHost && !!me;
  useEffect(() => {
    if (!countMeIn) return;
    let active = true;
    let joined = false;
    void joinLiveStream(liveId).then((n) => {
      if (!n) return;
      joined = true;
      if (active) setViewerCount(n);
      // Left before the join answered: count out again at once.
      else void leaveLiveStream(liveId);
    });
    return () => {
      active = false;
      if (joined) void leaveLiveStream(liveId);
    };
  }, [countMeIn, liveId, setViewerCount]);

  // ---------- stage ----------
  const guestsQ = useLiveGuests(liveId, isLive);
  const guests = useMemo(() => guestsQ.data ?? [], [guestsQ.data]);
  const myGuest = me ? guests.find((g) => g.user_id === me) : undefined;
  const myStatus: LiveGuestStatus | null = myGuest?.status ?? null;
  const onStage = useMemo(
    () => guests.filter((g) => g.status === 'accepted' && g.user_id !== host?.id).slice(0, MAX_GUESTS),
    [guests, host?.id],
  );
  const amSpeaker = isHost || myStatus === 'accepted';
  const requestCount = guests.filter((g) => g.status === 'requested').length;
  const guestsError = guestsQ.error ? liveError(guestsQ.error).key : null;

  // ---------- audio ----------
  const [speaking] = useState(createSpeakingStore);
  // The ongoing notification's button while minimised: there is no screen to
  // confirm on, so the host's press ends the live and a guest's steps down.
  const queryClient = useQueryClient();
  const leaveFromNotification = useCallback(() => {
    if (isHost) {
      void endLive(liveId)
        .then(() =>
          queryClient.setQueryData<LiveStream | null>(liveKeys.stream(liveId), (old) =>
            old ? { ...old, status: 'ended', ended_at: new Date().toISOString() } : old,
          ),
        )
        .catch(() => {});
    } else {
      void leaveLiveStage(liveId).catch(() => {});
    }
  }, [isHost, liveId, queryClient]);

  const agora = useAgoraAudio({
    channel: live ? liveId : null,
    uid: me ? agoraUidFor(me) : null,
    role: amSpeaker ? 'host' : 'audience',
    enabled: isLive && !!me,
    speaking,
    onLeave: leaveFromNotification,
  });

  const speakers = useMemo<StageSpeaker[]>(() => {
    if (!host) return [];
    const list: StageSpeaker[] = [
      { user: host, isHost: true, isMe: isHost, muted: isHost ? agora.muted : undefined },
    ];
    for (const g of onStage) {
      const user: UserSummary = g.user ?? { id: g.user_id, name: null, handle: null, avatar_url: null };
      list.push({ user, isHost: false, isMe: g.user_id === me, muted: g.user_id === me ? agora.muted : undefined });
    }
    return list;
  }, [host, isHost, onStage, me, agora.muted]);

  // Tell a guest when their place on stage changes.
  const prevStatus = useRef<LiveGuestStatus | null>(null);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = myStatus;
    if (prev === myStatus || isHost) return;
    if (myStatus === 'accepted') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAlert(t('live.guest.onStageTitle'), t('live.guest.onStageBody'));
    } else if (prev === 'accepted' && myStatus === 'removed') {
      showAlert(t('live.guest.removedTitle'), t('live.guest.removedBody'));
    } else if (prev === 'requested' && myStatus === 'removed') {
      showAlert(t('live.guest.declinedTitle'));
    }
  }, [myStatus, isHost, t]);

  // ---------- guest actions (RPCs; errors are translated ApiError codes) ----------
  const [busyId, setBusyId] = useState<string | null>(null);
  const guestAction = useCallback(
    async (userId: string, run: () => Promise<LiveGuestStatus>): Promise<boolean> => {
      setBusyId(userId);
      try {
        await run();
        await qc.invalidateQueries({ queryKey: liveKeys.guests(liveId) });
        return true;
      } catch (e) {
        showAlert(refusalKind(e) === 'rate' ? t('errors.slowDown') : t('live.errors.title'), t(liveError(e).key));
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [liveId, qc, t],
  );

  const [inviteDismissed, setInviteDismissed] = useState<string | null>(null);
  const showInvite = myStatus === 'invited' && inviteDismissed !== myGuest?.updated_at;

  function onHandPress() {
    if (!me) return;
    if (myStatus === 'requested') {
      showAlert(t('live.guest.requestedTitle'), t('live.guest.requestedBody'), [
        { text: t('live.guest.keepRequest'), style: 'cancel' },
        { text: t('live.guest.withdraw'), style: 'destructive', onPress: () => void guestAction(me, () => leaveLiveStage(liveId)) },
      ]);
    } else if (myStatus === 'invited') {
      setInviteDismissed(null);
    } else {
      void guestAction(me, () => requestToJoinLive(liveId)).then((ok) => {
        if (ok) AccessibilityInfo.announceForAccessibility(t('live.guest.requestSent'));
      });
    }
  }

  function onLeaveStage() {
    if (!me) return;
    showAlert(t('live.guest.leaveTitle'), undefined, [
      { text: t('live.cancel'), style: 'cancel' },
      { text: t('live.guest.leave'), style: 'destructive', onPress: () => void guestAction(me, () => leaveLiveStage(liveId)) },
    ]);
  }

  // ---------- chat ----------
  const chat = useLiveComments(liveId, !!live, hidden);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  async function sendComment() {
    const body = text.trim();
    if (!body || sending) return;
    setText('');
    // Client note 8: the keyboard stays up for the next line.
    input.current?.focus();
    setSending(true);
    try {
      // The realtime feed echoes it back; nothing is appended here.
      await postLiveComment(liveId, body, (id, message) => {
        chat.remove(id);
        showAlert(t('live.chat.withdrawn'), message ?? undefined);
      });
    } catch (e) {
      setText((v) => v || body);
      // Refused by the server's word filter (0135): the comments strings.
      if (isCommentBlocked(e)) showAlert(t('comments.blocked'), t('comments.blockedBody'));
      else showAlert(t(liveError(e, 'live.chat.sendFailed').key), serverDetail(e));
    } finally {
      setSending(false);
    }
  }

  // ---------- reactions ----------
  const floaters = useFloaters();
  const reactions = useRef<LiveReactions | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const { spawn } = floaters;
  useEffect(() => {
    if (!isLive) return;
    let active = true;
    void joinLiveReactions(liveId, (emoji) => spawn(emoji)).then((r) => {
      if (active) reactions.current = r;
      else r.unsubscribe();
    });
    return () => {
      active = false;
      reactions.current?.unsubscribe();
      reactions.current = null;
    };
  }, [isLive, liveId, spawn]);
  useEffect(() => {
    const set = timers.current;
    return () => set.forEach(clearTimeout);
  }, []);

  const sendReaction = useCallback(
    (emoji: string) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // A few staggered copies per tap, so a tap reads as a burst.
      for (let i = 0; i < 3; i++) {
        const id = setTimeout(() => {
          timers.current.delete(id);
          spawn(emoji);
        }, i * 90);
        timers.current.add(id);
      }
      void reactions.current?.send(emoji);
    },
    [spawn],
  );
  const [trayOpen, setTrayOpen] = useState(false);
  const closeTray = useCallback(() => setTrayOpen(false), [setTrayOpen]);

  // ---------- gifts ----------
  const [giftsOpen, setGiftsOpen] = useState(false);
  const banner = useGiftBanner();
  const sentByMe = useRef(new Set<string>());
  const giftRecipients = useMemo(
    () => speakers.map((s) => s.user).filter((u) => u.id !== me),
    [speakers, me],
  );
  const { push: pushBanner } = banner;
  const hostId = host?.id ?? null;

  useEffect(() => {
    if (!isLive) return;
    let active = true;
    const unsub = subscribeToLiveGifts(liveId, (row) => {
      if (sentByMe.current.has(row.id)) return;
      void (async () => {
        const catalogue = qc.getQueryData<Gift[]>(giftKeys.catalogue());
        const gift = catalogue?.find((g) => g.id === row.gift_id) ?? { name: row.gift_id, name_en: row.gift_id, emoji: '🎁', asset_url: null };
        const [from, to] = await Promise.all([
          lookup(row.from_user_id),
          row.to_user_id === hostId ? Promise.resolve(null) : lookup(row.to_user_id),
        ]);
        if (!active) return;
        pushBanner({
          key: `${row.from_user_id}:${row.to_user_id}:${row.gift_id}`,
          sender: from?.name || from?.handle || t('live.someone'),
          recipient: to ? to.name || to.handle || null : null,
          gift,
        });
      })();
    });
    return () => {
      active = false;
      unsub();
    };
  }, [isLive, liveId, hostId, lookup, pushBanner, qc, t]);

  const onGiftSent = useCallback(
    (txId: string, gift: Gift, to: UserSummary) => {
      sentByMe.current.add(txId);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      pushBanner({
        key: `me:${to.id}:${gift.id}`,
        sender: t('live.you'),
        recipient: to.id === hostId ? null : to.name || to.handle || null,
        gift,
      });
    },
    [hostId, pushBanner, t],
  );

  // ---------- moderation ----------
  const [modTarget, setModTarget] = useState<ModerationTarget | null>(null);
  const onComment = useCallback(
    (c: LiveComment) => {
      if (!c.user || c.user.id === me) return;
      setModTarget({ kind: 'comment', user: c.user, text: c.text });
    },
    [me, setModTarget],
  );
  const onSpeaker = useCallback((s: StageSpeaker) => setModTarget({ kind: 'speaker', user: s.user }), [setModTarget]);
  const modUserId = modTarget && modTarget.kind !== 'stream' ? modTarget.user.id : null;
  const modOnStage = !!modUserId && onStage.some((g) => g.user_id === modUserId);
  const modHostAction =
    isHost && modUserId
      ? modOnStage
        ? { label: t('live.stage.remove'), icon: 'mic-off-outline' as const, onPress: () => void guestAction(modUserId, () => removeLiveGuest(liveId, modUserId)) }
        : { label: t('live.stage.inviteToSpeak'), icon: 'person-add-outline' as const, onPress: () => void guestAction(modUserId, () => inviteToLive(liveId, modUserId)) }
      : null;

  // ---------- host ----------
  const [managerOpen, setManagerOpen] = useState(false);
  const [ending, setEnding] = useState(false);

  const confirmEnd = useCallback(() => {
    showAlert(t('live.end.title'), t('live.end.body'), [
      { text: t('live.cancel'), style: 'cancel' },
      {
        text: t('live.end.confirm'),
        style: 'destructive',
        onPress: async () => {
          setEnding(true);
          try {
            await endLive(liveId);
            qc.setQueryData<LiveStream | null>(liveKeys.stream(liveId), (old) =>
              old ? { ...old, status: 'ended', ended_at: new Date().toISOString() } : old,
            );
          } catch {
            showAlert(t('live.end.failed'));
          } finally {
            setEnding(false);
          }
        },
      },
    ]);
  }, [liveId, qc, t]);

  // The host leaves only by ending: back is turned into the End prompt, and
  // the iOS swipe-back is switched off below while the stream runs.
  const hostLive = isHost && isLive;
  // Keeps the stream open server-side; a killed app stops beating and the
  // server ends the live within ~90 s (0126).
  useHostHeartbeat(liveId, hostLive);
  useEffect(() => {
    if (!hostLive) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      confirmEnd();
      return true;
    });
    return () => sub.remove();
  }, [hostLive, confirmEnd]);

  const leave = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/')), []);

  const share = useCallback(async () => {
    const url = liveLink(liveId);
    const name = host?.name || host?.handle || '';
    try {
      await Share.share(
        Platform.OS === 'ios'
          ? { url, message: t('live.shareMessage', { name }) }
          : { message: `${t('live.shareMessage', { name })}\n${url}` },
        { dialogTitle: t('live.share') },
      );
    } catch {
      // Cancelled.
    }
  }, [host?.handle, host?.name, liveId, t]);

  // ---------- render ----------
  const bgUri = live?.thumbnail || host?.avatar_url || null;
  const elapsed = useElapsed(live?.started_at, isLive);

  if (stream.isLoading) {
    return (
      <View style={[styles.root, styles.center]}>
        <StatusBar style="light" />
        <ActivityIndicator color="#fff" size="large" />
        <Text style={styles.centerText}>{hostHint ? t('live.starting') : t('live.loading')}</Text>
      </View>
    );
  }
  if (stream.isError || !live) {
    return (
      <View style={[styles.root, styles.center, { paddingHorizontal: 32 }]}>
        <StatusBar style="light" />
        <Ionicons name={stream.isError ? 'cloud-offline-outline' : 'radio-outline'} size={48} color={DIM} />
        <Text style={styles.centerTitle}>{stream.isError ? t('live.loadFailed') : t('live.notFound')}</Text>
        {!stream.isError ? <Text style={styles.centerText}>{t('live.notFoundSub')}</Text> : null}
        {stream.isError ? <Button title={t('live.retry')} onPress={() => void stream.refetch()} style={styles.wide} /> : null}
        <Button title={t('live.back')} variant="ghost" onPress={leave} style={styles.wide} />
      </View>
    );
  }

  // An ended live (e.g. opened from an old "Your live has started" alert)
  // shows only its summary, never the room with its End button and comment box.
  if (ended) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <EndedCard live={live} isHost={isHost} peak={stream.peak} onDone={() => router.replace('/')} />
      </View>
    );
  }

  const hostName = host?.name || host?.handle || t('live.someone');
  const composerBottom = Math.max(insets.bottom, 10);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ gestureEnabled: !hostLive, animation: 'fade' }} />
      <StatusBar style="light" />

      {/* Background: the cover, or the host's photo, blurred (note 5). */}
      {bgUri ? (
        <Image source={{ uri: bgUri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={Platform.OS === 'android' ? 25 : 0} accessible={false} />
      ) : null}
      <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, styles.dim]} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
          <Pressable
            style={styles.hostInfo}
            onPress={() => host && router.push(`/user/${host.id}`)}
            accessibilityRole="button"
            accessibilityLabel={t('live.hostProfile', { name: hostName })}
          >
            <Avatar uri={host?.avatar_url} name={hostName} size={36} />
            <View style={{ flexShrink: 1 }}>
              <Text style={styles.hostName} numberOfLines={1}>
                {hostName}
              </Text>
              {host?.handle ? (
                <Text style={styles.hostHandle} numberOfLines={1}>
                  {atHandle(host.handle)}
                </Text>
              ) : null}
            </View>
          </Pressable>
          <View style={styles.headerRight}>
            <View style={styles.liveBadge} accessible accessibilityLabel={t('live.badgeA11y', { time: formatDuration(elapsed) })}>
              <Text style={styles.liveBadgeText}>{t('live.badge')}</Text>
              <Text style={styles.liveBadgeTime}>{formatDuration(elapsed)}</Text>
            </View>
            <View style={styles.pill} accessible accessibilityLabel={t('live.viewersA11y', { count: live.viewer_count })}>
              <Ionicons name="headset" size={12} color="#fff" />
              <Text style={styles.pillText}>{formatCount(live.viewer_count)}</Text>
            </View>
            <RoundIcon icon="share-social-outline" label={t('live.share')} onPress={() => void share()} />
            {isHost ? (
              <Pressable
                onPress={confirmEnd}
                disabled={ending || !isLive}
                style={styles.endBtn}
                accessibilityRole="button"
                accessibilityLabel={t('live.end.action')}
                accessibilityState={{ busy: ending }}
              >
                {ending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.endText}>{t('live.end.action')}</Text>}
              </Pressable>
            ) : (
              <>
                <RoundIcon
                  icon="ellipsis-horizontal"
                  label={t('live.options')}
                  onPress={() => setModTarget({ kind: 'stream', liveId, host })}
                />
                <RoundIcon icon="close" label={t('live.leave')} onPress={leave} />
              </>
            )}
          </View>
        </View>

        {live.title ? (
          <Text style={styles.title} numberOfLines={2}>
            {live.title}
          </Text>
        ) : null}

        <AudioStatus
          status={agora.status}
          error={agora.error?.key ?? null}
          onDismiss={agora.clearError}
          onSettings={agora.error?.key === 'live.errors.mic_denied' ? () => void Linking.openSettings() : undefined}
        />

        <View style={styles.stage}>
          <Stage
            speakers={speakers}
            speaking={speaking}
            onLongPress={onSpeaker}
            emptySeatLabel={isHost ? t('live.stage.manage') : t('live.guest.request')}
            onEmptySeat={
              !isLive
                ? undefined
                : isHost
                  ? () => setManagerOpen(true)
                  : !myStatus || myStatus === 'left' || myStatus === 'removed'
                    ? onHandPress
                    : undefined
            }
          />
        </View>

        <View style={{ flex: 1 }} />

        {/* Chat over a gradient, with the gift banner on top of it. */}
        <View style={styles.bottom}>
          <LinearGradient colors={['transparent', 'rgba(0,4,33,0.88)']} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={styles.bannerSlot}>
            <GiftBanner event={banner.current} onDone={banner.shift} />
          </View>
          <CommentList comments={chat.comments} loading={chat.loading} failed={chat.failed} onComment={onComment} />

          <View style={[styles.bar, { paddingBottom: composerBottom }]}>
            <View style={styles.inputWrap}>
              <TextInput
                ref={input}
                value={text}
                onChangeText={(v) => setText(v.slice(0, MAX_COMMENT))}
                placeholder={t('live.chat.placeholder')}
                placeholderTextColor="rgba(255,255,255,0.6)"
                style={[styles.input, { textAlign: I18nManager.isRTL ? 'right' : 'left' }]}
                returnKeyType="send"
                submitBehavior="submit"
                onSubmitEditing={() => void sendComment()}
                editable={isLive}
                accessibilityLabel={t('live.chat.placeholder')}
                onFocus={closeTray}
              />
              {text.trim() ? (
                <Pressable onPress={() => void sendComment()} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('live.chat.send')} style={styles.sendBtn}>
                  <Ionicons name="send" size={20} color="#fff" style={I18nManager.isRTL ? { transform: [{ scaleX: -1 }] } : undefined} />
                </Pressable>
              ) : null}
            </View>

            {isLive && amSpeaker ? (
              <RoundIcon
                icon={agora.muted ? 'mic-off' : 'mic'}
                label={agora.muted ? t('live.mic.unmute') : t('live.mic.mute')}
                onPress={() => agora.setMuted(!agora.muted)}
                active={!agora.muted}
              />
            ) : null}
            {isLive && isHost ? (
              <RoundIcon icon="people" label={t('live.stage.manageA11y', { count: requestCount })} onPress={() => setManagerOpen(true)} badge={requestCount} />
            ) : null}
            {isLive && !isHost && myStatus === 'accepted' ? (
              <RoundIcon icon="exit-outline" label={t('live.guest.leave')} onPress={onLeaveStage} />
            ) : null}
            {isLive && !isHost && myStatus !== 'accepted' ? (
              <RoundIcon
                icon={myStatus === 'requested' || myStatus === 'invited' ? 'hand-left' : 'hand-left-outline'}
                label={
                  myStatus === 'requested'
                    ? t('live.guest.requested')
                    : myStatus === 'invited'
                      ? t('live.guest.invitedShort')
                      : t('live.guest.request')
                }
                onPress={onHandPress}
                active={myStatus === 'requested' || myStatus === 'invited'}
                disabled={busyId === me}
              />
            ) : null}
            {isLive && giftRecipients.length ? (
              <RoundIcon icon="gift" label={t('live.gifts.open')} onPress={() => setGiftsOpen(true)} tint="#FF6FA3" />
            ) : null}
            {isLive ? (
              <RoundIcon
                icon="heart"
                label={t('live.reactions.heart')}
                onPress={() => {
                  sendReaction('❤️');
                  setTrayOpen(true);
                }}
                tint="#ff2d55"
              />
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>

      <FloaterLayer items={floaters.items} onDone={floaters.done} />
      <ReactionTray open={trayOpen} onPick={sendReaction} onClose={closeTray} bottom={composerBottom + 56} />

      {ended ? <EndedCard live={live} isHost={isHost} peak={stream.peak} onDone={() => router.replace('/')} /> : null}

      {/* Sheets */}
      <GiftTray visible={giftsOpen} onClose={() => setGiftsOpen(false)} liveId={liveId} recipients={giftRecipients} onSent={onGiftSent} />
      {isHost ? (
        <StageManager
          visible={managerOpen}
          onClose={() => setManagerOpen(false)}
          liveId={liveId}
          guests={guests}
          guestsError={guestsError}
          myId={me}
          busyId={busyId}
          onApprove={(id) => void guestAction(id, () => approveLiveGuest(liveId, id))}
          onRemove={(id) => void guestAction(id, () => removeLiveGuest(liveId, id))}
          onInvite={(id) => void guestAction(id, () => inviteToLive(liveId, id))}
          onPerson={(user) => {
            setManagerOpen(false);
            setModTarget({ kind: 'viewer', user });
          }}
        />
      ) : null}
      <ModerationSheet target={modTarget} onClose={() => setModTarget(null)} onHide={hide} onBlocked={hide} hostAction={modHostAction} />
      <Sheet visible={showInvite && isLive} onClose={() => setInviteDismissed(myGuest?.updated_at ?? null)} title={t('live.guest.invitedTitle')}>
        <InviteBody avatar={host?.avatar_url} name={hostName} />
        <OptionRow
          icon="mic"
          label={t('live.guest.accept')}
          disabled={busyId === me}
          onPress={() => {
            if (!me) return;
            setInviteDismissed(myGuest?.updated_at ?? null);
            void guestAction(me, () => respondLiveInvite(liveId, true));
          }}
        />
        <OptionRow
          icon="close-circle-outline"
          danger
          label={t('live.guest.decline')}
          disabled={busyId === me}
          onPress={() => {
            if (!me) return;
            setInviteDismissed(myGuest?.updated_at ?? null);
            void guestAction(me, () => respondLiveInvite(liveId, false));
          }}
        />
      </Sheet>
    </View>
  );
}

function InviteBody({ avatar, name }: { avatar?: string | null; name: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={styles.invite}>
      <Avatar uri={avatar} name={name} size={64} />
      <Text style={[styles.inviteText, { color: colors.text }]}>{t('live.guest.invitedBody', { name })}</Text>
    </View>
  );
}

function RoundIcon({
  icon,
  label,
  onPress,
  active,
  disabled,
  badge,
  tint = '#fff',
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
  badge?: number;
  tint?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      style={[styles.round, active && styles.roundActive, disabled && { opacity: 0.5 }]}
    >
      <Ionicons name={icon} size={21} color={tint} />
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function AudioStatus({
  status,
  error,
  onDismiss,
  onSettings,
}: {
  status: string;
  error: string | null;
  onDismiss: () => void;
  onSettings?: () => void;
}) {
  const { t } = useTranslation();
  if (error) {
    return (
      <View style={styles.audioError} accessibilityLiveRegion="polite" accessibilityRole="alert">
        <Ionicons name="warning" size={16} color="#FFD27A" />
        <Text style={styles.audioErrorText}>{t(error)}</Text>
        {onSettings ? (
          <Pressable onPress={onSettings} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.audioLink}>{t('live.openSettings')}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel={t('live.close')} hitSlop={10}>
          <Ionicons name="close" size={16} color="#fff" />
        </Pressable>
      </View>
    );
  }
  if (status === 'connecting' || status === 'reconnecting') {
    return (
      <View style={styles.audioPill} accessibilityLiveRegion="polite">
        <ActivityIndicator size="small" color="#fff" />
        <Text style={styles.audioPillText}>{status === 'connecting' ? t('live.audio.connecting') : t('live.audio.reconnecting')}</Text>
      </View>
    );
  }
  return null;
}

const CommentList = memo(function CommentList({
  comments,
  loading,
  failed,
  onComment,
}: {
  comments: LiveComment[];
  loading: boolean;
  failed: boolean;
  onComment: (c: LiveComment) => void;
}) {
  const { t } = useTranslation();
  // Inverted, so the newest line sits at the bottom without scrolling.
  const data = useMemo(() => [...comments].reverse(), [comments]);
  return (
    <FlatList
      data={data}
      inverted
      keyExtractor={(c) => c.id}
      style={styles.comments}
      contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 4 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      ListEmptyComponent={
        // VirtualizedList already counter-flips the empty component of an
        // inverted list; flipping it again here drew it upside down.
        <View>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.chatEmpty}>{failed ? t('live.chat.loadFailed') : t('live.chat.empty')}</Text>
          )}
        </View>
      }
      renderItem={({ item }) => <CommentRow comment={item} onPress={onComment} />}
    />
  );
});

const CommentRow = memo(function CommentRow({ comment, onPress }: { comment: LiveComment; onPress: (c: LiveComment) => void }) {
  const { t } = useTranslation();
  const name = comment.user?.name || comment.user?.handle || t('live.someone');
  return (
    <Pressable
      onLongPress={() => onPress(comment)}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`${name}: ${comment.text}`}
      accessibilityHint={t('live.chat.longPressHint')}
      accessibilityActions={[{ name: 'longpress', label: t('live.options') }]}
      onAccessibilityAction={() => onPress(comment)}
      style={styles.comment}
    >
      <Avatar uri={comment.user?.avatar_url} name={name} size={26} />
      <Text style={styles.commentText}>
        <Text style={styles.commentName}>{name} </Text>
        {comment.text}
      </Text>
    </Pressable>
  );
});

function EndedCard({ live, isHost, peak, onDone }: { live: LiveStream; isHost: boolean; peak: number; onDone: () => void }) {
  const { t } = useTranslation();
  const seconds = live.ended_at
    ? (new Date(live.ended_at).getTime() - new Date(live.started_at).getTime()) / 1000
    : 0;
  return (
    <View style={[StyleSheet.absoluteFill, styles.endedWrap]} accessibilityViewIsModal>
      <View style={styles.ended}>
        <Ionicons name="radio-outline" size={40} color="#fff" />
        <Text style={styles.endedTitle} accessibilityRole="header">
          {isHost ? t('live.ended.hostTitle') : t('live.ended.title')}
        </Text>
        <Text style={styles.endedSub}>
          {isHost
            ? t('live.ended.summary', { time: formatDuration(seconds), count: Math.max(peak, live.viewer_count) })
            : t('live.ended.thanks')}
        </Text>
        <Button title={isHost ? t('live.ended.done') : t('live.ended.more')} onPress={onDone} style={styles.wide} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  dim: { backgroundColor: 'rgba(0,4,33,0.45)' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  centerTitle: { color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  centerText: { color: DIM, fontSize: 14, textAlign: 'center' },
  wide: { alignSelf: 'stretch', paddingHorizontal: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  hostInfo: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, minHeight: 44 },
  hostName: { color: '#fff', fontSize: 14, fontWeight: '800' },
  hostHandle: { color: DIM, fontSize: 12 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6, marginStart: 'auto' },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#ff2d55', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  liveBadgeText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  liveBadgeTime: { color: '#fff', fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  pillText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  endBtn: { backgroundColor: '#ff2d55', borderRadius: 18, paddingHorizontal: 14, minHeight: 36, minWidth: 56, alignItems: 'center', justifyContent: 'center' },
  endText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  title: { color: '#fff', fontSize: 16, fontWeight: '700', paddingHorizontal: 16, marginTop: 10, textAlign: 'center' },
  stage: { marginTop: 28 },
  bottom: { maxHeight: '48%' },
  bannerSlot: { minHeight: 44, justifyContent: 'center' },
  comments: { flexGrow: 0, maxHeight: 220 },
  comment: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4 },
  commentText: { color: '#fff', fontSize: 14, lineHeight: 19, flexShrink: 1, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
  commentName: { color: 'rgba(255,255,255,0.75)', fontWeight: '800' },
  chatEmpty: { color: DIM, fontSize: 13, textAlign: 'center', paddingVertical: 8 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingTop: 8 },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 22, paddingStart: 14, paddingEnd: 4, minHeight: 44 },
  input: { flex: 1, color: '#fff', fontSize: 15, paddingVertical: 10 },
  sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1E56D6', alignItems: 'center', justifyContent: 'center' },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  roundActive: { backgroundColor: 'rgba(30,86,214,0.85)' },
  badge: { position: 'absolute', top: -2, end: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#ff2d55', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  audioError: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 10, padding: 10, borderRadius: 12, backgroundColor: 'rgba(120,20,40,0.75)' },
  audioErrorText: { color: '#fff', fontSize: 13, flex: 1 },
  audioLink: { color: '#9CC2FF', fontSize: 13, fontWeight: '800' },
  audioPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', marginTop: 10, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.4)' },
  audioPillText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  invite: { alignItems: 'center', gap: 12, paddingVertical: 18, paddingHorizontal: 24 },
  inviteText: { fontSize: 15, textAlign: 'center' },
  endedWrap: { backgroundColor: 'rgba(0,4,33,0.82)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  ended: { alignItems: 'center', gap: 10, alignSelf: 'stretch' },
  endedTitle: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  endedSub: { color: DIM, fontSize: 15, textAlign: 'center', marginBottom: 8 },
});
