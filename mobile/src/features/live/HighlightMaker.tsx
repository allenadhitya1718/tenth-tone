import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import { type Href, router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, PanResponder, type PanResponderInstance, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/api/client';
import { highlightKeys, postHighlight } from '@/api/highlights';
import { fetchLiveStream, liveKeys } from '@/api/live';
import { showAlert } from '@/components/Dialog';
import { showToast } from '@/components/Toast';
import { AppText, Button, Screen, TopBar } from '@/components/ui';
import { formatClock } from '@/features/stories/SoundPicker';
import { aacDurationMs, NotAacError, trimAac } from '@/lib/aacTrim';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/providers/ThemeProvider';

import { BUCKET_S, busiestStart, deleteRecordings, momentsFor, recordingFor } from './liveRecording';

// A highlight is any length from 5 seconds to 1 minute (0167 allows 5-61 s).
const WINDOW_S = 60;
const MIN_S = 5;
const STEP_S = 5;
// How close (px) a touch must be to an end of the selection to drag that end.
const HANDLE_PX = 24;
const MAX_TITLE = 80;
// At most this many activity bars on the trim bar, however long the live.
const MAX_BARS = 90;

// After a live: the host picks the best part of their recording, up to a
// minute, and posts it as a highlight to Explore and their profile (0167).
// Only that part is uploaded. The screen starts on the busiest minute (most
// comments, reactions and gifts, from the host phone's moments log) and
// draws that activity on the bar. Drag either end of the selection to change
// its length, drag its middle (or tap the bar) to move it, or use the 5-second
// buttons. The preview at the top looks like the posted highlight and plays
// exactly the selected part.
export function HighlightMaker({ liveId }: { liveId: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const { session } = useAuth();
  const me = session?.user.id ?? null;

  const live = useQuery({ queryKey: liveKeys.stream(liveId), queryFn: () => fetchLiveStream(liveId) });
  const [file] = useState(() => recordingFor(liveId));
  const [moments] = useState(() => (file ? momentsFor(file) : []));

  // The recording's exact length, by counting its audio frames. Android's
  // player only estimates a raw AAC file's length (0:23 for a quiet 1:16
  // live on the Redmi), so it is the fallback for a file that can't be read.
  const exact = useQuery({
    queryKey: ['live-recording-length', file?.uri ?? ''],
    queryFn: () => aacDurationMs(file!),
    enabled: !!file,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const full = useAudioPlayer(file && exact.isError ? { uri: file.uri } : null);
  const fullStatus = useAudioPlayerStatus(full);
  const total = exact.data ? exact.data / 1000 : exact.isError && fullStatus.duration > 0 ? fullStatus.duration : 0;
  // The length: the host's choice once they change it, else a minute (or
  // the whole live when shorter).
  const longest = Math.min(WINDOW_S, total);
  const shortest = Math.min(MIN_S, total);
  const [lenPicked, setLenPicked] = useState<number | null>(null);
  const windowS = total ? Math.max(shortest, Math.min(longest, lenPicked ?? longest)) : 0;
  const maxStart = Math.max(0, total - windowS);

  // The preview plays the chosen minute trimmed into its own small file,
  // exactly what will be posted.
  const preview = useAudioPlayer(null);
  const previewStatus = useAudioPlayerStatus(preview);

  // Where the part starts: the host's choice once they move it, until
  // then the busiest stretch (or the start, when nothing happened).
  const suggested = total ? busiestStart(moments, total, windowS) : null;
  const [picked, setPicked] = useState<number | null>(null);
  const startS = Math.max(0, Math.min(maxStart, picked ?? suggested ?? 0));
  const [previewing, setPreviewing] = useState(false);
  const [trimming, setTrimming] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [barW, setBarW] = useState(0);

  const clamp = (s: number) => Math.max(0, Math.min(maxStart, s));
  const stop = () => {
    preview.pause();
    setPreviewing(false);
  };
  const playMinute = async () => {
    if (!file || trimming) return;
    setPreviewing(true);
    setTrimming(true);
    const clip = new File(Paths.cache, `highlight-preview-${Date.now()}.aac`);
    try {
      await trimAac(file, clip, startS * 1000, windowS * 1000);
      preview.replace({ uri: clip.uri });
      preview.play();
    } catch (e) {
      setPreviewing(false);
      showAlert(t('live.errors.title'), e instanceof NotAacError ? t('live.highlight.notAac') : t('live.errors.generic'));
    } finally {
      setTrimming(false);
    }
  };
  const nudge = (d: number) => {
    stop();
    setPicked(clamp(startS + d));
  };
  const toBusiest = () => {
    stop();
    setPicked(null);
  };
  // Longer or shorter by 5 seconds; the start stays put unless the end
  // would run past the recording.
  const changeLength = (d: number) => {
    stop();
    const len = Math.max(shortest, Math.min(longest, windowS + d));
    setLenPicked(len);
    setPicked(Math.max(0, Math.min(startS, Math.floor(total - len))));
  };

  // Dragging on the bar (see createTrimPan). The drag in progress lives in
  // `dragBox`, which outlives re-renders, so a new responder made mid-drag
  // carries on the same drag.
  const [dragBox] = useState<DragBox>(() => ({ d: null }));
  const pan = useMemo(
    () => createTrimPan(dragBox, { startS, windowS, total, barW, longest }, { setPicked, setLenPicked, stop }),
    // stop() only pauses the preview; it need not remake the responder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dragBox, startS, windowS, total, barW, longest],
  );
  // The activity, merged into at most MAX_BARS bars across the recording.
  const bars = useMemo(() => {
    if (!total || !moments.some((v) => v > 0)) return [];
    const buckets = Math.ceil(total / BUCKET_S);
    const per = Math.max(1, Math.ceil(buckets / MAX_BARS));
    const out: number[] = [];
    for (let i = 0; i < buckets; i += per) {
      let sum = 0;
      for (let j = i; j < Math.min(buckets, i + per); j++) sum += moments[j] ?? 0;
      out.push(sum);
    }
    const max = Math.max(...out);
    return out.map((v, i) => ({ i, h: v / max, x: (i * per * BUCKET_S) / total, w: (per * BUCKET_S) / total }));
  }, [moments, total]);
  useEffect(() => () => preview.pause(), [preview]);
  // Old preview files out of the cache when the screen closes.
  useEffect(
    () => () => {
      try {
        for (const e of new Directory(Paths.cache).list()) {
          if (e instanceof File && e.name.startsWith('highlight-preview-')) e.delete();
        }
      } catch {}
    },
    [],
  );
  const playingMinute = previewing && previewStatus.playing;
  const elapsed = playingMinute ? Math.min(windowS, previewStatus.currentTime) : 0;
  const currentTime = startS + elapsed;

  const isHost = !!me && live.data?.host?.id === me;
  const cover = live.data?.thumbnail || live.data?.host?.avatar_url || null;
  const hostName = live.data?.host?.name || live.data?.host?.handle || '';

  async function post() {
    if (!file || busy || windowS < MIN_S) return;
    setBusy(true);
    stop();
    setProgress(0);
    const out = new File(Paths.cache, `highlight-${Date.now()}.aac`);
    try {
      const cut = await trimAac(file, out, startS * 1000, windowS * 1000);
      const posted = await postHighlight(
        {
          liveId,
          audio: { uri: out.uri, mimeType: 'audio/aac', size: cut.bytes, name: 'highlight.aac' },
          title,
          startMs: startS * 1000,
          durationMs: cut.durationMs,
        },
        setProgress,
      );
      void qc.invalidateQueries({ queryKey: highlightKeys.all });
      showToast(t('live.highlight.posted'));
      // Straight to the new highlight, so the host hears what they posted.
      router.replace(`/highlight/${posted.id}` as Href);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : null;
      const msg =
        e instanceof NotAacError
          ? t('live.highlight.notAac')
          : code === 'highlight_limit_live'
            ? t('live.highlight.limitLive')
            : code === 'highlight_limit_day'
              ? t('live.highlight.limitDay')
              : code === 'content_blocked'
                ? t('live.errors.content_blocked')
                : t('live.highlight.failed');
      showAlert(t('live.errors.title'), msg);
    } finally {
      try {
        if (out.exists) out.delete();
      } catch {}
      setBusy(false);
    }
  }

  function discard() {
    showAlert(t('live.highlight.discardTitle'), t('live.highlight.discardBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('live.highlight.discard'),
        style: 'destructive',
        onPress: () => {
          stop();
          deleteRecordings(liveId);
          router.back();
        },
      },
    ]);
  }

  const header = <TopBar title={t('live.highlight.make')} />;

  if (!file || (live.isSuccess && !isHost)) {
    return (
      <Screen header={header}>
        <View style={styles.empty}>
          <Ionicons name="mic-off-outline" size={40} color={colors.muted} />
          <AppText muted center>
            {t('live.highlight.none')}
          </AppText>
        </View>
      </Screen>
    );
  }

  const ready = total > 0;
  const winLeft = total ? (startS / total) * barW : 0;
  const winWidth = total ? Math.max(14, (windowS / total) * barW) : 0;
  const playedX = total ? Math.min(barW, (currentTime / total) * barW) : 0;

  const label = title.trim() || t('live.highlight.by', { name: hostName });
  const endS = startS + windowS;

  return (
    <Screen header={header}>
      {/* The preview: what the posted highlight will look like, playing
          exactly the selected part. Tap anywhere on it to play or pause. */}
      <Pressable
        onPress={!ready ? undefined : playingMinute ? stop : () => void playMinute()}
        disabled={!ready || busy}
        accessibilityRole="button"
        accessibilityLabel={playingMinute ? t('live.highlight.pause') : t('live.highlight.playPart')}
        style={[styles.cover, { backgroundColor: colors.bg2 }]}
      >
        {cover ? <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={18} /> : null}
        <View style={styles.coverShade} />
        {/* No cover photo: the play button alone (an icon behind it looked broken). */}
        {cover ? <Image source={{ uri: cover }} style={styles.coverArt} contentFit="cover" /> : <View style={styles.coverArt} />}
        <View style={styles.playBig}>
          {trimming ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Ionicons name={playingMinute ? 'pause' : 'play'} size={26} color="#fff" style={playingMinute ? undefined : { marginStart: 3 }} />
          )}
        </View>
        <View style={styles.previewFoot} pointerEvents="none">
          <Text style={styles.previewTitle} numberOfLines={1}>
            {label}
          </Text>
          <View style={styles.previewTrack}>
            <View style={[styles.previewFill, { width: `${windowS ? (elapsed / windowS) * 100 : 0}%` }]} />
          </View>
          <View style={styles.previewTimes}>
            <Text style={styles.previewTime}>{formatClock(elapsed)}</Text>
            <Text style={styles.previewTime}>{formatClock(windowS)}</Text>
          </View>
        </View>
      </Pressable>

      <AppText muted style={styles.sub}>
        {t('live.highlight.sub')}
      </AppText>

      {!ready ? (
        <ActivityIndicator style={{ marginVertical: 24 }} color={colors.primary} />
      ) : (
        <>
          <View
            {...pan.panHandlers}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={t('live.highlight.startsAt', { time: formatClock(startS) })}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(e) => nudge(e.nativeEvent.actionName === 'increment' ? STEP_S : -STEP_S)}
            onLayout={(e) => setBarW(e.nativeEvent.layout.width)}
            style={[styles.bar, { backgroundColor: colors.bg3 }]}
          >
            <View pointerEvents="none" style={[styles.window, { left: winLeft, width: winWidth, borderColor: colors.primary }]} />
            {bars.map((b) =>
              b.h > 0 ? (
                <View
                  key={b.i}
                  pointerEvents="none"
                  style={[styles.activity, { left: b.x * barW, width: Math.max(1.5, b.w * barW - 1), height: 4 + b.h * 34 }]}
                />
              ) : null,
            )}
            {playingMinute ? <View pointerEvents="none" style={[styles.playhead, { left: playedX }]} /> : null}
            {/* The two ends: drag to change the length. */}
            <View pointerEvents="none" style={[styles.handle, { left: winLeft - 7, backgroundColor: colors.primary }]}>
              <View style={styles.grip} />
            </View>
            <View pointerEvents="none" style={[styles.handle, { left: winLeft + winWidth - 7, backgroundColor: colors.primary }]}>
              <View style={styles.grip} />
            </View>
          </View>
          <View style={styles.barLabels}>
            <Text style={[styles.small, { color: colors.muted }]}>0:00</Text>
            <Text style={[styles.small, { color: colors.muted }]}>{formatClock(total)}</Text>
          </View>
          {suggested !== null ? (
            picked === null || picked === suggested ? (
              <View style={styles.busyRow}>
                <Ionicons name="flame" size={15} color={colors.primary} />
                <Text style={[styles.small, styles.busyText, { color: colors.muted }]}>{t('live.highlight.busiest')}</Text>
              </View>
            ) : (
              <Pressable onPress={toBusiest} style={styles.busyRow} accessibilityRole="button" hitSlop={8}>
                <Ionicons name="flame" size={15} color={colors.primary} />
                <Text style={[styles.small, styles.busyText, { color: colors.primary, fontWeight: '700' }]}>{t('live.highlight.toBusiest')}</Text>
              </Pressable>
            )
          ) : null}

          {/* Move the part (5 s at a time) ... */}
          <View style={styles.controls}>
            <Pressable onPress={() => nudge(-STEP_S)} style={[styles.round, { backgroundColor: colors.bg2 }]} accessibilityLabel={t('live.highlight.back5')} hitSlop={6}>
              <Ionicons name="play-back" size={20} color={colors.text} />
            </Pressable>
            <View style={styles.times}>
              <AppText style={{ fontWeight: '700' }}>{`${formatClock(startS)} – ${formatClock(endS)}`}</AppText>
              <Text style={[styles.small, { color: colors.muted }]}>{t('live.highlight.moveHint')}</Text>
            </View>
            <Pressable onPress={() => nudge(STEP_S)} style={[styles.round, { backgroundColor: colors.bg2 }]} accessibilityLabel={t('live.highlight.fwd5')} hitSlop={6}>
              <Ionicons name="play-forward" size={20} color={colors.text} />
            </Pressable>
          </View>
          {/* ... and change its length (5 s to 1 minute). */}
          <View style={styles.controls}>
            <Pressable
              onPress={() => changeLength(-STEP_S)}
              disabled={windowS <= shortest}
              style={[styles.round, { backgroundColor: colors.bg2, opacity: windowS <= shortest ? 0.4 : 1 }]}
              accessibilityLabel={t('live.highlight.shorter')}
              hitSlop={6}
            >
              <Ionicons name="remove" size={22} color={colors.text} />
            </Pressable>
            <View style={styles.times}>
              <AppText style={{ fontWeight: '700' }}>{t('live.highlight.lengthIs', { time: formatClock(windowS) })}</AppText>
              <Text style={[styles.small, { color: colors.muted }]}>{t('live.highlight.lengthHint')}</Text>
            </View>
            <Pressable
              onPress={() => changeLength(STEP_S)}
              disabled={windowS >= longest}
              style={[styles.round, { backgroundColor: colors.bg2, opacity: windowS >= longest ? 0.4 : 1 }]}
              accessibilityLabel={t('live.highlight.longer')}
              hitSlop={6}
            >
              <Ionicons name="add" size={22} color={colors.text} />
            </Pressable>
          </View>
        </>
      )}

      <TextInput
        value={title}
        onChangeText={(v) => setTitle(v.slice(0, MAX_TITLE))}
        placeholder={t('live.highlight.titlePh')}
        placeholderTextColor={colors.muted}
        style={[styles.input, { color: colors.text, backgroundColor: colors.bg2, borderColor: colors.border }]}
        maxLength={MAX_TITLE}
        editable={!busy}
      />

      <Button
        title={busy ? `${t('live.highlight.posting')} ${progress ? Math.round(progress * 100) + '%' : ''}`.trim() : t('live.highlight.post')}
        onPress={() => void post()}
        disabled={!ready || busy || windowS < MIN_S}
        loading={busy}
      />
      <Pressable onPress={discard} disabled={busy} style={styles.discard} accessibilityRole="button">
        <Text style={{ color: colors.danger, fontWeight: '600' }}>{t('live.highlight.discard')}</Text>
      </Pressable>
      <Text style={[styles.small, styles.note, { color: colors.muted }]}>{t('live.highlight.keepNote')}</Text>
    </Screen>
  );
}

type Drag = { mode: 'start' | 'end' | 'move' | 'tap'; x0: number; pageX0: number; s0: number; l0: number };
type DragBox = { d: Drag | null };
type TrimView = { startS: number; windowS: number; total: number; barW: number; longest: number };
type TrimActions = { setPicked: (s: number) => void; setLenPicked: (l: number) => void; stop: () => void };

// One responder for the whole trim bar, so drags and taps never fight: a
// touch near an end of the selection drags that end (the length), inside it
// moves it, anywhere else is a tap that centres the selection there.
function createTrimPan(box: DragBox, v: TrimView, a: TrimActions): PanResponderInstance {
  const { total: T, barW: W, longest } = v;
  return PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      if (!T || !W || T < MIN_S) {
        box.d = null;
        return;
      }
      const x = e.nativeEvent.locationX;
      const left = (v.startS / T) * W;
      const right = ((v.startS + v.windowS) / T) * W;
      const dl = Math.abs(x - left);
      const dr = Math.abs(x - right);
      const inside = x > left && x < right;
      // A narrow selection is all handles: a touch inside it moves it, and
      // its ends are dragged from just outside.
      const narrow = right - left < HANDLE_PX * 3;
      const nearEnd = Math.min(dl, dr) <= HANDLE_PX;
      const mode = inside && (narrow || !nearEnd) ? 'move' : nearEnd ? (dl < dr ? 'start' : 'end') : 'tap';
      box.d = { mode, x0: x, pageX0: e.nativeEvent.pageX, s0: v.startS, l0: v.windowS };
      a.stop();
    },
    onPanResponderMove: (e) => {
      const d = box.d;
      if (!d || !T || !W || d.mode === 'tap') return;
      const dx = e.nativeEvent.pageX - d.pageX0;
      const at = Math.round((Math.max(0, Math.min(W, d.x0 + dx)) / W) * T);
      if (d.mode === 'start') {
        const end = d.s0 + d.l0;
        const s = Math.max(Math.max(0, end - longest), Math.min(end - MIN_S, at));
        a.setPicked(s);
        a.setLenPicked(end - s);
      } else if (d.mode === 'end') {
        const end = Math.max(d.s0 + MIN_S, Math.min(Math.min(T, d.s0 + longest), at));
        a.setPicked(d.s0);
        a.setLenPicked(end - d.s0);
      } else {
        a.setPicked(Math.max(0, Math.min(Math.floor(T - d.l0), Math.round(d.s0 + (dx / W) * T))));
      }
    },
    onPanResponderRelease: (e) => {
      const d = box.d;
      box.d = null;
      if (!d || d.mode !== 'tap' || !T || !W) return;
      if (Math.abs(e.nativeEvent.pageX - d.pageX0) > 8) return;
      // A tap: the selection's middle goes where the finger was.
      a.setPicked(Math.max(0, Math.min(Math.floor(T - d.l0), Math.round((d.x0 / W) * T - d.l0 / 2))));
    },
    onPanResponderTerminate: () => {
      box.d = null;
    },
  });
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: 12, marginTop: 80, paddingHorizontal: 24 },
  cover: { height: 220, borderRadius: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  coverShade: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: 'rgba(0,4,33,0.45)' },
  coverArt: { width: 104, height: 104, borderRadius: 14, marginBottom: 40 },
  playBig: {
    position: 'absolute',
    top: 64,
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(30,86,214,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewFoot: { position: 'absolute', start: 14, end: 14, bottom: 10 },
  previewTitle: { color: '#fff', fontWeight: '800', fontSize: 14, marginBottom: 6 },
  previewTrack: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  previewFill: { height: 3, backgroundColor: '#fff' },
  previewTimes: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  previewTime: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '600' },
  sub: { marginBottom: 18 },
  bar: { height: 52, borderRadius: 10, justifyContent: 'center' },
  window: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: 8,
    borderWidth: 2,
    backgroundColor: 'rgba(30,86,214,0.45)',
  },
  activity: {
    position: 'absolute',
    bottom: 0,
    borderTopLeftRadius: 1.5,
    borderTopRightRadius: 1.5,
    backgroundColor: 'rgba(255,255,255,0.75)',
  },
  handle: { position: 'absolute', top: 6, bottom: 6, width: 14, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 2, height: 16, borderRadius: 1, backgroundColor: '#fff' },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -6, marginBottom: 14 },
  busyText: { flex: 1 },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#fff' },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, marginBottom: 14 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  round: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  times: { alignItems: 'center', gap: 2 },
  small: { fontSize: 12.5 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginVertical: 16 },
  discard: { alignSelf: 'center', paddingVertical: 14 },
  note: { textAlign: 'center' },
});
