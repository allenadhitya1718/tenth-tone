import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { type Href, router, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  BackHandler,
  type LayoutChangeEvent,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { RenderModeType, RtcSurfaceView, RtcTextureView } from 'react-native-agora';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CallMemberWithProfile } from '@/api/calls';
import type { UserSummary } from '@/api/types';
import { showAlert } from '@/components/Dialog';
import type { ErrorMsg } from '@/components/ui';
import { showToast } from '@/components/Toast';
import { Avatar } from '@/features/chat/Avatar';
import { formatDuration } from '@/features/live/config';

import {
  accept,
  decline,
  dial,
  dialGroup,
  dismissEnded,
  flipCamera,
  getCallState,
  hangUp,
  isCallActive,
  openCall,
  toggleCamera,
  toggleMute,
  setAudioOutput,
  toggleSpeaker,
  useCallState,
  type CallState,
  type Readiness,
} from './callSession';
import type { AudioOutput } from './audioRoute';
import { AddPeopleSheet } from './AddPeopleSheet';
import { LocalPip } from './LocalPip';
import { callPath, markCallScreen, type DialParams } from './nav';
import {
  isActiveMember,
  memberAgoraUid,
  memberName,
  useCallMembers,
  useMarkRinging,
  useMemberToasts,
} from './useCallMembers';

const OUTPUT_KEY: Record<AudioOutput, string> = {
  bluetooth: 'call.outBluetooth',
  headset: 'call.outHeadset',
  speaker: 'call.outSpeaker',
  earpiece: 'call.outPhone',
  other: 'call.outPhone',
};

// The full-screen call: outgoing ring, incoming ring (Accept / Decline), and
// the call itself. Port of V.call and the incoming card in web/js/views.js.
//
// Always dark, whatever the app theme: it sits over a photo or a video.
const INK = '#FFFFFF';
const INK_SOFT = 'rgba(255,255,255,0.72)';
const GROUND = '#000421';
const RED = '#EF4444';
const GREEN = '#22C55E';
// How long the end of a call stays on screen before it closes.
const CLOSE_AFTER_MS = 1600;
// CALLS-08: never a bare spinner. If the call has not loaded by then, say so
// and offer Close.
const LOAD_TIMEOUT_MS = 8000;

type Props = { callId: string; dial?: undefined } | { callId?: undefined; dial: DialParams & { nonce: string } };

type Refusal = { error: NonNullable<ErrorMsg>; openSettings?: boolean };

export function CallScreen(props: Props) {
  const { t } = useTranslation();
  const s = useCallState();
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const dialReq = props.dial;
  const routeId = props.callId;
  const navigation = useNavigation();

  // Closes THIS screen. navigation.goBack() from the screen's own navigation
  // object removes this route, wherever it is in the stack; router.back()
  // (leaveCallScreen) pops whatever is on top. With two screens for one call
  // (a push tap and the realtime ring both opening it) the first one to
  // close popped the other, and the survivor sat on a spinner (CALLS-08).
  const left = useRef(false);
  const leave = useCallback(() => {
    if (left.current) return;
    left.current = true;
    if (navigation.canGoBack()) navigation.goBack();
    else router.replace('/');
  }, [navigation]);

  // ---------- start or pick up the session ----------
  useEffect(() => {
    if (routeId) {
      void openCall(routeId);
      return markCallScreen(routeId);
    }
    if (!dialReq) return;
    if (dialReq.group) {
      dialGroup({
        nonce: dialReq.nonce,
        chatId: dialReq.to,
        kind: dialReq.kind,
        name: dialReq.name ?? null,
        photo: dialReq.avatar ?? null,
      })
        .then((r) => {
          if (!r.ok) setRefusal({ error: r.error, openSettings: r.openSettings });
          else if (r.skipped) showToast(t('call.group.skipped', { count: r.skipped }), 'information-circle');
        })
        .catch(() => setRefusal({ error: { key: 'call.errors.generic' } }));
      return;
    }
    // The other person's name and photo come in with the route, so the
    // ringing screen is complete before the row is even written.
    dial({
      nonce: dialReq.nonce,
      calleeId: dialReq.to,
      kind: dialReq.kind,
      chatId: dialReq.chat ?? null,
      peer: { id: dialReq.to, name: dialReq.name ?? null, handle: dialReq.handle ?? null, avatar_url: dialReq.avatar ?? null },
    })
      .then((r: Readiness) => {
        if (!r.ok) setRefusal({ error: r.error, openSettings: r.openSettings });
      })
      .catch(() => setRefusal({ error: { key: 'call.errors.generic' } }));
    // Dial exactly once per nonce; the params never change for one screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mine = routeId ? s.callId === routeId : !!dialReq && s.dialNonce === dialReq.nonce;
  const busy = !mine && isCallActive(s) && !!routeId && s.callId !== routeId;

  // The session this screen was showing went away under it: dismissed by
  // another screen for the same call, or replaced. Close, and if it had
  // ended say how ("Missed call") on the way out.
  const wasMine = useRef(false);
  const lastReason = useRef<string | null>(null);
  useEffect(() => {
    if (mine) {
      wasMine.current = true;
      if (s.phase === 'ended') lastReason.current = s.endReason ?? 'ended';
      return;
    }
    if (!wasMine.current || left.current) return;
    if (lastReason.current) showToast(t(`call.endReason.${lastReason.current}`), 'call');
    leave();
  }, [mine, s.phase, s.endReason, leave, t]);

  // Still loading after LOAD_TIMEOUT_MS: show an error with Close instead.
  const loading = !refusal && !busy && (!mine || s.phase === 'loading');
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!loading) return;
    const id = setTimeout(() => setStuck(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [loading]);
  const closeStuck = useCallback(() => {
    // A session still loading this call would otherwise count as a call in
    // progress and refuse the next one.
    const st = getCallState();
    if (st.phase === 'loading' && routeId && st.callId === routeId) {
      hangUp('failed');
      dismissEnded();
    }
    leave();
  }, [leave, routeId]);

  // The dial screen registers under the call id once it has one, so a push
  // for this call does not open a second screen on top.
  useEffect(() => {
    if (dialReq && mine && s.callId) return markCallScreen(s.callId);
  }, [dialReq, mine, s.callId]);

  if (refusal) return <Refused refusal={refusal} onClose={leave} />;
  if (busy) return <Busy s={s} onClose={leave} />;
  if (loading && stuck) return <Refused refusal={{ error: { key: 'call.errors.generic' } }} onClose={closeStuck} hideReturn />;
  // This call is still loading.
  if (!mine) return <Loading label={t('call.loading')} />;
  return <CallView s={s} leave={leave} />;
}

// ---------- The call ----------

function CallView({ s, leave }: { s: CallState; leave: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [acceptError, setAcceptError] = useState<Refusal | null>(null);
  const [accepting, setAccepting] = useState(false);
  const video = s.kind === 'video';
  const live = s.phase === 'connecting' || s.phase === 'connected';
  const ringingOut = s.phase === 'dialing' || s.phase === 'outgoing';

  // ---------- who is in it (group calls, 0092) ----------
  const members = useCallMembers(s.channel, live || ringingOut || s.phase === 'incoming');
  const markRinging = useMarkRinging(s.channel);
  useMemberToasts(members, s.me, s.phase === 'connected');
  // Three or more people (counting anyone being rung in) is a group call; a
  // call back down to two is shown as the usual one-to-one screen, with
  // whoever is actually left in it.
  const { others, joinedOthers, group, peer } = useMemo(() => {
    const o = members.filter((m) => m.user_id !== s.me && isActiveMember(m));
    const j = o.filter((m) => m.status === 'joined');
    const g = live && o.length >= 2;
    const p: UserSummary | null = live && !g && j.length === 1 && j[0].profile ? j[0].profile : s.peer;
    return { others: o, joinedOthers: j, group: g, peer: p };
  }, [members, s.me, s.peer, live]);
  const name = peer?.name || peer?.handle || t('call.someone');
  const invite = !!s.row?.root_id && s.phase === 'incoming';
  // Rung into a call already under way: who else is in it, beside the inviter.
  const alsoIn = invite
    ? joinedOthers.filter((m) => m.user_id !== s.row?.caller_id).map((m) => memberName(m, t('call.someone')))
    : [];
  const groupCall = !!s.groupChatId;
  const title = group ? (s.groupName ?? groupTitle(others, t)) : name;
  const [adding, setAdding] = useState(false);
  // A fresh sheet (empty search, no old errors) each time it opens.
  const [sheetKey, setSheetKey] = useState(0);
  const canAdd = s.phase === 'connected' && !!s.call && members.length > 0;
  const onInvited = useCallback((u: UserSummary) => markRinging(u, s.me), [markRinging, s.me]);

  // The grid sits between the top bar and the controls, whatever they measure.
  const [topH, setTopH] = useState(0);
  const [bottomH, setBottomH] = useState(0);
  const onTopLayout = useCallback((e: LayoutChangeEvent) => setTopH(e.nativeEvent.layout.height), []);
  const onBottomLayout = useCallback((e: LayoutChangeEvent) => setBottomH(e.nativeEvent.layout.height), []);

  // ---------- closing when it is over ----------
  const closed = useRef(false);
  useEffect(() => {
    if (s.phase !== 'ended') return;
    const id = setTimeout(() => {
      if (closed.current) return;
      closed.current = true;
      // Leave first: dismissing first re-renders this screen as "not mine".
      leave();
      dismissEnded();
    }, CLOSE_AFTER_MS);
    return () => clearTimeout(id);
  }, [s.phase, leave]);

  // ---------- leaving without hanging up ----------
  const minimise = useCallback(() => {
    showToast(t('call.minimised'), 'call');
    leave();
  }, [t, leave]);

  const confirmCancel = useCallback(() => {
    showAlert(t('call.cancelTitle'), t('call.cancelBody', { name }), [
      { text: t('call.keepCalling'), style: 'cancel' },
      { text: t('call.cancelCall'), style: 'destructive', onPress: () => hangUp() },
    ]);
  }, [t, name]);

  // Android back: a running call is minimised, never hung up; a ring going
  // out asks first; a ring coming in has to be answered or declined.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const st = getCallState();
      if (st.phase === 'incoming') return true;
      if (st.phase === 'dialing' || st.phase === 'outgoing') {
        confirmCancel();
        return true;
      }
      if (st.phase === 'connecting' || st.phase === 'connected') {
        minimise();
        return true;
      }
      if (st.phase === 'ended') {
        if (!closed.current) {
          closed.current = true;
          leave();
          dismissEnded();
        }
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [confirmCancel, minimise, leave]);

  // ---------- the other side switching to video ----------
  const announced = useRef(s.kind);
  useEffect(() => {
    if (announced.current !== 'video' && s.kind === 'video' && live && !s.cameraOn) {
      showToast(t('call.peerTurnedVideoOn', { name }), 'videocam');
    }
    announced.current = s.kind;
  }, [s.kind, live, s.cameraOn, name, t]);

  const onAccept = useCallback(async () => {
    if (accepting) return;
    setAccepting(true);
    setAcceptError(null);
    try {
      const r = await accept();
      if (!r.ok) setAcceptError({ error: r.error, openSettings: r.openSettings });
    } finally {
      setAccepting(false);
    }
  }, [accepting]);

  const onCamera = useCallback(async () => {
    const err = await toggleCamera();
    if (err) showToast(t(err.key), 'videocam-off');
  }, [t]);

  // ---------- what is on screen ----------
  const showRemote = !group && live && video && s.remoteVideo && s.remoteUid != null && s.engineReady;
  // A video call that is ringing out shows this phone's camera full screen,
  // as FaceTime does; once the other picture arrives it moves to the corner.
  const localFull = !group && video && s.cameraOn && s.engineReady && !showRemote && (ringingOut || live);
  // In a group call this phone's camera is always the small window.
  const localPip = video && s.cameraOn && s.engineReady && (showRemote || group);
  const overVideo = showRemote || localFull;
  const compact = overVideo || group;

  // Rung into a group chat's call: the group is the headline, the person
  // who rang under it ("Family" / "Group voice call from Allen").
  const headName = invite && s.groupName ? s.groupName : name;
  const status = invite
    ? s.groupName
      ? t(video ? 'call.group.groupVideoFrom' : 'call.group.groupVoiceFrom', { name })
      : t(video ? 'call.group.incomingVideo' : 'call.group.incomingVoice')
    : statusLine(s, name, t);

  // Calling a group: once every member has declined or missed, stop ringing
  // nobody (the ring timeout would otherwise wait out the full 45 s).
  const ringingNobody = groupCall && s.isCaller && s.phase === 'outgoing' && members.length > 1 && others.length === 0;
  const anyDeclined = members.some((m) => m.user_id !== s.me && m.status === 'declined');
  useEffect(() => {
    if (ringingNobody) hangUp(anyDeclined ? 'declined' : 'no_answer');
  }, [ringingNobody, anyDeclined]);

  return (
    <View style={styles.root}>
      {/* Ground: the photo, blurred, under a navy veil. */}
      {s.peer?.avatar_url ? (
        <Image source={{ uri: s.peer.avatar_url }} style={StyleSheet.absoluteFill} blurRadius={40} contentFit="cover" />
      ) : null}
      <View style={[StyleSheet.absoluteFill, styles.veil]} />

      {showRemote ? (
        <RtcSurfaceView
          style={StyleSheet.absoluteFill}
          canvas={{ uid: s.remoteUid!, renderMode: RenderModeType.RenderModeHidden }}
          connection={{ channelId: s.channel ?? '', localUid: s.localUid ?? 0 }}
          accessible
          accessibilityLabel={t('call.a11y.remoteVideo', { name })}
        />
      ) : null}
      {localFull ? (
        <RtcSurfaceView
          style={StyleSheet.absoluteFill}
          canvas={{ uid: 0, renderMode: RenderModeType.RenderModeHidden }}
          accessible
          accessibilityLabel={t('call.a11y.localVideo')}
        />
      ) : null}
      {overVideo ? <View style={[StyleSheet.absoluteFill, styles.videoShade]} pointerEvents="none" /> : null}

      {group ? (
        <GroupGrid others={others} s={s} top={topH + 8} bottom={bottomH + 8} />
      ) : null}

      {/* Top: minimise, then who and how it is going. */}
      <View style={[styles.top, { paddingTop: insets.top + 8 }]} onLayout={onTopLayout}>
        <View style={styles.topRow}>
          <View style={styles.topSide}>
            {live || ringingOut ? (
              <RoundIcon
                icon="chevron-down"
                label={t('call.minimise')}
                onPress={ringingOut ? confirmCancel : minimise}
                small
              />
            ) : null}
          </View>
          <Text style={styles.kindTag} accessibilityElementsHidden importantForAccessibility="no">
            {video ? t('call.videoCall') : t('call.voiceCall')}
          </Text>
          <View style={[styles.topSide, styles.topEnd]}>
            {canAdd ? (
              <Pressable
                onPress={() => {
                  setSheetKey((k) => k + 1);
                  setAdding(true);
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('call.group.addA11y')}
                style={({ pressed }) => [styles.addPill, pressed && { opacity: 0.6 }]}
              >
                <Ionicons name="person-add" size={16} color={INK} />
                <Text style={styles.addPillText} numberOfLines={1}>
                  {t('call.group.add')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {compact ? (
          <View style={styles.compactHead}>
            <Text style={styles.compactName} numberOfLines={1} accessibilityRole="header">
              {title}
            </Text>
            <Text style={styles.sub} accessibilityLiveRegion="polite">
              {status}
            </Text>
          </View>
        ) : (
          <View style={styles.head}>
            <Pulse active={s.phase === 'incoming' || ringingOut}>
              <Avatar uri={s.peer?.avatar_url} name={name} size={112} />
            </Pulse>
            <Text style={styles.name} numberOfLines={2} accessibilityRole="header">
              {headName}
            </Text>
            <Text style={styles.sub} accessibilityLiveRegion="polite">
              {status}
            </Text>
            {alsoIn.length ? (
              <Text style={styles.withLine} numberOfLines={2}>
                {t('call.group.withNames', { names: alsoIn.join(t('call.group.listSep')) })}
              </Text>
            ) : null}
          </View>
        )}

        <Notices s={s} name={name} acceptError={acceptError} />
      </View>

      {localPip ? (
        <LocalPip
          top={group ? topH + 16 : insets.top + 120}
          bottom={group ? bottomH + 16 : insets.bottom + 200}
          label={t('call.a11y.localVideo')}
        />
      ) : null}

      {/* Bottom: the controls for this phase. */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 24 }]} onLayout={onBottomLayout}>
        {s.phase === 'incoming' ? (
          <View style={styles.answerRow}>
            <BigButton icon="call" color={RED} label={t('call.decline')} onPress={decline} rotate />
            <BigButton
              icon={video ? 'videocam' : 'call'}
              color={GREEN}
              label={video ? t('call.acceptVideo') : t('call.accept')}
              onPress={onAccept}
              busy={accepting}
            />
          </View>
        ) : s.phase === 'ended' ? (
          <View style={styles.endedRow} />
        ) : s.phase === 'loading' ? (
          <ActivityIndicator color={INK} />
        ) : (
          <>
            <View style={styles.controlRow}>
              <RoundIcon
                icon={s.muted ? 'mic-off' : 'mic'}
                label={s.muted ? t('call.unmute') : t('call.mute')}
                caption={t('call.mute')}
                active={s.muted}
                onPress={toggleMute}
              />
              {s.bluetooth || s.headset ? (
                // A headset is connected: pick where the sound goes.
                <RoundIcon
                  icon={s.audioOut === 'bluetooth' ? 'bluetooth' : s.audioOut === 'speaker' ? 'volume-high' : s.audioOut === 'headset' ? 'headset' : 'phone-portrait-outline'}
                  label={t('call.audioA11y', { output: t(OUTPUT_KEY[s.audioOut]) })}
                  caption={t('call.audio')}
                  active={s.audioOut === 'speaker'}
                  onPress={() =>
                    showAlert(t('call.audioTitle'), undefined, [
                      ...(s.bluetooth
                        ? [{ text: `${s.audioOut === 'bluetooth' ? '✓ ' : ''}${s.bluetoothName || t('call.outBluetooth')}`, onPress: () => setAudioOutput('bluetooth') }]
                        : []),
                      ...(s.headset
                        ? [{ text: `${s.audioOut === 'headset' ? '✓ ' : ''}${t('call.outHeadset')}`, onPress: () => setAudioOutput('headset') }]
                        : []),
                      { text: `${s.audioOut === 'speaker' ? '✓ ' : ''}${t('call.outSpeaker')}`, onPress: () => setAudioOutput('speaker') },
                      { text: `${s.audioOut === 'earpiece' ? '✓ ' : ''}${t('call.outPhone')}`, onPress: () => setAudioOutput('earpiece') },
                      { text: t('common.cancel'), style: 'cancel' },
                    ])
                  }
                />
              ) : (
                <RoundIcon
                  icon={s.speaker ? 'volume-high' : 'volume-medium'}
                  label={s.speaker ? t('call.speakerOff') : t('call.speakerOn')}
                  caption={t('call.speaker')}
                  active={s.speaker}
                  onPress={toggleSpeaker}
                />
              )}
              <RoundIcon
                icon={s.cameraOn ? 'videocam' : 'videocam-off'}
                label={s.cameraOn ? t('call.cameraOff') : video ? t('call.cameraOn') : t('call.switchToVideo')}
                caption={t('call.camera')}
                active={s.cameraOn}
                onPress={onCamera}
                disabled={s.phase === 'dialing'}
              />
              {video && s.cameraOn ? (
                <RoundIcon
                  icon="camera-reverse"
                  label={t('call.flip')}
                  caption={t('call.flipShort')}
                  onPress={flipCamera}
                />
              ) : null}
            </View>
            <BigButton
              icon="call"
              color={RED}
              label={ringingOut ? t('call.cancel') : group ? t('call.group.leave') : t('call.end')}
              onPress={() => hangUp()}
              rotate
            />
          </>
        )}
      </View>

      <AddPeopleSheet
        key={sheetKey}
        visible={adding && s.phase === 'connected'}
        onClose={() => setAdding(false)}
        members={members}
        me={s.me}
        kind={s.kind}
        onInvited={onInvited}
      />
    </View>
  );
}

type T = (k: string, o?: Record<string, unknown>) => string;

// "Devesh and Sara", "Devesh, Sara +2": the people on a group call, those in
// it before those still being rung.
function groupTitle(others: CallMemberWithProfile[], t: T): string {
  const sorted = [...others].sort((a, b) => Number(b.status === 'joined') - Number(a.status === 'joined'));
  const names = sorted.map((m) => memberName(m, t('call.someone')));
  if (names.length <= 1) return names[0] ?? t('call.someone');
  if (names.length === 2) return t('call.group.titleTwo', { a: names[0], b: names[1] });
  return t('call.group.titleMore', { a: names[0], b: names[1], count: names.length - 2 });
}

// ---------- Group call: one tile per other person ----------

function GroupGrid({ others, s, top, bottom }: { others: CallMemberWithProfile[]; s: CallState; top: number; bottom: number }) {
  const n = others.length;
  const cols = n <= 2 ? 1 : n <= 6 ? 2 : 3;
  const rows: CallMemberWithProfile[][] = [];
  // In the call first, then the people still ringing.
  const sorted = [...others].sort((a, b) => Number(b.status === 'joined') - Number(a.status === 'joined'));
  for (let i = 0; i < sorted.length; i += cols) rows.push(sorted.slice(i, i + cols));
  const avatar = n <= 2 ? 96 : n <= 4 ? 72 : 56;
  return (
    <View style={[styles.grid, { top, bottom }]}>
      {rows.map((row, i) => (
        <View key={i} style={styles.gridRow}>
          {row.map((m) => (
            <GroupTile key={m.user_id} m={m} s={s} avatar={avatar} />
          ))}
        </View>
      ))}
    </View>
  );
}

function GroupTile({ m, s, avatar }: { m: CallMemberWithProfile; s: CallState; avatar: number }) {
  const { t } = useTranslation();
  const uid = memberAgoraUid(m);
  const remote = s.remotes[uid];
  const name = memberName(m, t('call.someone'));
  const speaking = !!remote && !remote.muted && s.speaking.includes(uid);
  const showVideo = !!remote?.video && !remote.dropped && s.engineReady && m.status === 'joined';
  let status = '';
  if (m.status === 'ringing') status = t('call.group.ringing');
  else if (!remote) status = t('call.connecting');
  else if (remote.dropped) status = t('call.group.weak');
  const a11y = [name, status, remote?.muted ? t('call.group.mutedA11y') : '', speaking ? t('call.group.speakingA11y') : '']
    .filter(Boolean)
    .join(', ');
  const VideoView = Platform.OS === 'android' ? RtcTextureView : RtcSurfaceView;
  return (
    <View
      style={[styles.tile, speaking && styles.tileSpeaking]}
      accessible
      accessibilityLabel={a11y}
    >
      {showVideo ? (
        <VideoView
          style={StyleSheet.absoluteFill}
          canvas={{ uid, renderMode: RenderModeType.RenderModeHidden }}
          connection={{ channelId: s.channel ?? '', localUid: s.localUid ?? 0 }}
        />
      ) : (
        <View style={[styles.tileCenter, m.status === 'ringing' && styles.tileRinging]}>
          <Avatar uri={m.profile?.avatar_url} name={name} size={avatar} />
        </View>
      )}
      <View style={styles.tileLabel} pointerEvents="none">
        {remote?.muted ? <Ionicons name="mic-off" size={14} color={INK} /> : null}
        <Text style={styles.tileName} numberOfLines={1}>
          {name}
        </Text>
        {status ? (
          <Text style={styles.tileStatus} numberOfLines={1}>
            {status}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function statusLine(s: CallState, name: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  switch (s.phase) {
    case 'loading':
      return t('call.loading');
    case 'dialing':
    case 'outgoing':
      return t('call.calling');
    case 'incoming':
      return s.kind === 'video' ? t('call.incomingVideo') : t('call.incomingVoice');
    case 'connecting':
      return t('call.connecting');
    case 'connected':
      if (s.media === 'reconnecting') return t('call.reconnecting');
      if (s.peerStatus === 'dropped') return t('call.peerWeak', { name });
      return ''; // <Duration> under it shows the running time instead
    case 'ended':
      return t(`call.endReason.${s.endReason ?? 'ended'}`);
    default:
      return '';
  }
}

function Notices({ s, name, acceptError }: { s: CallState; name: string; acceptError: Refusal | null }) {
  const { t } = useTranslation();
  const lines: { key: string; text: string; icon: keyof typeof Ionicons.glyphMap }[] = [];
  if (s.phase === 'connected' && s.media === 'reconnecting') {
    lines.push({ key: 'net', text: t('call.reconnectingHint'), icon: 'cloud-offline' });
  }
  if (s.peerStatus === 'left' && s.phase !== 'ended') lines.push({ key: 'left', text: t('call.peerLeft', { name }), icon: 'exit-outline' });
  if (s.muted && (s.phase === 'connected' || s.phase === 'connecting')) {
    lines.push({ key: 'muted', text: t('call.youAreMuted'), icon: 'mic-off' });
  }
  if (s.notice) lines.push({ key: 'notice', text: t(s.notice.key, s.notice.params), icon: 'information-circle' });
  if (s.error && s.phase === 'ended') lines.push({ key: 'error', text: t(s.error.key, s.error.params), icon: 'alert-circle' });
  if (acceptError && s.phase === 'incoming') {
    lines.push({ key: 'accept', text: t(acceptError.error.key, acceptError.error.params), icon: 'alert-circle' });
  }
  return (
    <View style={styles.notices}>
      {s.phase === 'connected' && s.startedAt && s.media !== 'reconnecting' && s.peerStatus !== 'dropped' ? (
        <Duration startedAt={s.startedAt} />
      ) : null}
      {lines.map((l) => (
        <View key={l.key} style={styles.notice} accessibilityLiveRegion="polite">
          <Ionicons name={l.icon} size={16} color={INK} />
          <Text style={styles.noticeText}>{l.text}</Text>
        </View>
      ))}
      {acceptError?.openSettings && s.phase === 'incoming' ? <SettingsLink /> : null}
    </View>
  );
}

function Duration({ startedAt }: { startedAt: number }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const text = formatDuration((now - startedAt) / 1000);
  return (
    <Text style={styles.timer} accessibilityLabel={t('call.a11y.duration', { time: text })}>
      {text}
    </Text>
  );
}

function SettingsLink() {
  const { t } = useTranslation();
  return (
    <Pressable onPress={() => void Linking.openSettings()} style={styles.settingsBtn} accessibilityRole="button">
      <Text style={styles.settingsText}>{t('call.openSettings')}</Text>
    </Pressable>
  );
}

// ---------- Other states ----------

function Loading({ label }: { label: string }) {
  return (
    <View style={[styles.root, styles.center]}>
      <ActivityIndicator color={INK} accessibilityLabel={label} />
    </View>
  );
}

function Refused({ refusal, onClose, hideReturn }: { refusal: Refusal; onClose: () => void; hideReturn?: boolean }) {
  const { t } = useTranslation();
  const s = useCallState();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, styles.center, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Ionicons name="call-outline" size={44} color={INK_SOFT} />
      <Text style={styles.refusedTitle}>{t(refusal.error.key, refusal.error.params)}</Text>
      {refusal.openSettings ? <SettingsLink /> : null}
      {!hideReturn && isCallActive(s) && s.callId ? (
        <Pressable
          onPress={() => s.callId && openActive(s.callId)}
          style={styles.settingsBtn}
          accessibilityRole="button"
        >
          <Text style={styles.settingsText}>{t('call.returnToCall')}</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={onClose} style={styles.closeBtn} accessibilityRole="button">
        <Text style={styles.closeText}>{t('call.close')}</Text>
      </Pressable>
    </View>
  );
}

function Busy({ s, onClose }: { s: CallState; onClose: () => void }) {
  return <Refused refusal={{ error: { key: 'call.errors.already_in_call' } }} onClose={onClose} key={s.callId ?? 'busy'} />;
}

function openActive(callId: string) {
  // Replace, so Back from the running call does not land on this notice.
  router.replace(callPath(callId) as Href);
}

// ---------- Pieces ----------

function Pulse({ active, children }: { active: boolean; children: ReactNode }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.set(active ? withRepeat(withTiming(1, { duration: 1400 }), -1, false) : 0);
  }, [active, v]);
  const ring = useAnimatedStyle(() => ({
    opacity: active ? 0.5 * (1 - v.get()) : 0,
    transform: [{ scale: 1 + v.get() * 0.45 }],
  }));
  return (
    <View style={styles.pulseWrap}>
      <Animated.View style={[styles.pulseRing, ring]} pointerEvents="none" />
      {children}
    </View>
  );
}

function RoundIcon({
  icon,
  label,
  caption,
  onPress,
  active,
  disabled,
  small,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  caption?: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
  small?: boolean;
}) {
  const size = small ? 40 : 60;
  return (
    <View style={styles.ctl}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: !!active, disabled: !!disabled }}
        style={({ pressed }) => [
          styles.round,
          { width: size, height: size, borderRadius: size / 2 },
          active ? styles.roundActive : null,
          (pressed || disabled) && { opacity: 0.55 },
        ]}
      >
        <Ionicons name={icon} size={small ? 22 : 26} color={active ? GROUND : INK} />
      </Pressable>
      {caption ? (
        <Text style={styles.caption} numberOfLines={1} importantForAccessibility="no" accessibilityElementsHidden>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

function BigButton({
  icon,
  color,
  label,
  onPress,
  rotate,
  busy,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  onPress: () => void;
  rotate?: boolean;
  busy?: boolean;
}) {
  return (
    <View style={styles.ctl}>
      <Pressable
        onPress={onPress}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.big, { backgroundColor: color }, pressed && { opacity: 0.8 }]}
      >
        {busy ? (
          <ActivityIndicator color={INK} />
        ) : (
          <Ionicons name={icon} size={32} color={INK} style={rotate ? styles.hangupIcon : undefined} />
        )}
      </Pressable>
      <Text style={styles.caption} importantForAccessibility="no" accessibilityElementsHidden>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: GROUND },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  veil: { backgroundColor: 'rgba(0,4,33,0.72)' },
  videoShade: { backgroundColor: 'rgba(0,0,0,0.12)' },
  top: { paddingHorizontal: 16 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topSide: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 40 },
  topEnd: { justifyContent: 'flex-end' },
  addPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  addPillText: { color: INK, fontSize: 14, fontWeight: '700' },
  withLine: { color: INK_SOFT, fontSize: 14, textAlign: 'center' },
  grid: { position: 'absolute', start: 8, end: 8, gap: 8 },
  gridRow: { flex: 1, flexDirection: 'row', gap: 8 },
  tile: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  tileSpeaking: { borderColor: GREEN },
  tileCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tileRinging: { opacity: 0.55 },
  tileLabel: {
    position: 'absolute',
    start: 8,
    end: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tileName: {
    color: INK,
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 1,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowRadius: 4,
  },
  tileStatus: { color: INK_SOFT, fontSize: 12, textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 4 },
  kindTag: { color: INK_SOFT, fontSize: 13, fontWeight: '600' },
  head: { alignItems: 'center', marginTop: 48, gap: 10 },
  compactHead: { alignItems: 'center', marginTop: 8, gap: 2 },
  compactName: {
    color: INK,
    fontSize: 20,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 6,
  },
  name: { color: INK, fontSize: 28, fontWeight: '800', textAlign: 'center', marginTop: 12 },
  sub: { color: INK_SOFT, fontSize: 15, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },
  timer: { color: INK, fontSize: 16, fontVariant: ['tabular-nums'], textAlign: 'center' },
  notices: { alignItems: 'center', marginTop: 12, gap: 8 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: '100%',
  },
  noticeText: { color: INK, fontSize: 13, flexShrink: 1 },
  settingsBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.16)' },
  settingsText: { color: INK, fontWeight: '700' },
  closeBtn: { paddingHorizontal: 18, paddingVertical: 10 },
  closeText: { color: INK_SOFT, fontWeight: '600' },
  refusedTitle: { color: INK, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  pulseWrap: { alignItems: 'center', justifyContent: 'center' },
  pulseRing: { position: 'absolute', width: 112, height: 112, borderRadius: 56, backgroundColor: 'rgba(91,155,245,0.8)' },
  bottom: { position: 'absolute', start: 0, end: 0, bottom: 0, alignItems: 'center', gap: 22, paddingHorizontal: 16 },
  controlRow: { flexDirection: 'row', justifyContent: 'center', gap: 18, flexWrap: 'wrap' },
  answerRow: { flexDirection: 'row', justifyContent: 'space-around', alignSelf: 'stretch', paddingHorizontal: 24 },
  endedRow: { height: 60 },
  ctl: { alignItems: 'center', gap: 6, minWidth: 64 },
  round: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  roundActive: { backgroundColor: INK },
  caption: { color: INK_SOFT, fontSize: 12 },
  big: { width: 70, height: 70, borderRadius: 35, alignItems: 'center', justifyContent: 'center' },
  hangupIcon: { transform: [{ rotate: '135deg' }] },
});
