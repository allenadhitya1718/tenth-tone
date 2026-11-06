import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import { type Href, router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/api/client';
import { highlightKeys, postHighlight } from '@/api/highlights';
import { fetchLiveStream, liveKeys } from '@/api/live';
import { showAlert } from '@/components/Dialog';
import { showToast } from '@/components/Toast';
import { AppText, Button, Screen, TopBar } from '@/components/ui';
import { formatClock } from '@/features/stories/SoundPicker';
import { NotAacError, trimAac } from '@/lib/aacTrim';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/providers/ThemeProvider';

import { BUCKET_S, busiestStart, deleteRecordings, momentsFor, recordingFor } from './liveRecording';

const WINDOW_S = 60;
const MIN_S = 5;
const STEP_S = 5;
const MAX_TITLE = 80;
// At most this many activity bars on the trim bar, however long the live.
const MAX_BARS = 90;

// After a live: the host picks the best minute of their recording and posts
// it as a highlight to Explore and their profile (0167). Only that minute is
// uploaded. The screen starts on the busiest minute (most comments,
// reactions and gifts, from the host phone's moments log) and draws that
// activity on the bar. Tap the bar to place the minute, nudge it by 5
// seconds, listen to it, add an optional title, post.
export function HighlightMaker({ liveId }: { liveId: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const { session } = useAuth();
  const me = session?.user.id ?? null;

  const live = useQuery({ queryKey: liveKeys.stream(liveId), queryFn: () => fetchLiveStream(liveId) });
  const [file] = useState(() => recordingFor(liveId));
  const [moments] = useState(() => (file ? momentsFor(file) : []));

  // The full recording, only for its length: a raw AAC recording has no
  // index, so Android cannot jump into it (it played from 0:00 on the Redmi).
  const full = useAudioPlayer(file ? { uri: file.uri } : null);
  const fullStatus = useAudioPlayerStatus(full);
  const total = fullStatus.duration > 0 ? fullStatus.duration : 0;
  const windowS = Math.min(WINDOW_S, total);
  const maxStart = Math.max(0, total - windowS);

  // The preview plays the chosen minute trimmed into its own small file,
  // exactly what will be posted.
  const preview = useAudioPlayer(null);
  const previewStatus = useAudioPlayerStatus(preview);

  // Where the minute starts: the host's choice once they move it, until
  // then the busiest minute (or the start, when nothing happened).
  const suggested = total ? busiestStart(moments, total, windowS) : null;
  const [picked, setPicked] = useState<number | null>(null);
  const startS = picked ?? suggested ?? 0;
  const [previewing, setPreviewing] = useState(false);
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
    if (!file) return;
    setPreviewing(true);
    const clip = new File(Paths.cache, `highlight-preview-${Date.now()}.aac`);
    try {
      await trimAac(file, clip, startS * 1000, windowS * 1000);
      preview.replace({ uri: clip.uri });
      preview.play();
    } catch (e) {
      setPreviewing(false);
      showAlert(t('live.errors.title'), e instanceof NotAacError ? t('live.highlight.notAac') : t('live.errors.generic'));
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
  const currentTime = startS + (playingMinute ? previewStatus.currentTime : 0);

  const isHost = !!me && live.data?.host?.id === me;
  const cover = live.data?.thumbnail || live.data?.host?.avatar_url || null;

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
  const winWidth = total ? Math.max(6, (windowS / total) * barW) : 0;
  const playedX = total ? Math.min(barW, (currentTime / total) * barW) : 0;

  return (
    <Screen header={header}>
      <View style={[styles.cover, { backgroundColor: colors.bg2 }]}>
        {cover ? <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={18} /> : null}
        <View style={styles.coverShade} />
        {cover ? <Image source={{ uri: cover }} style={styles.coverArt} contentFit="cover" /> : <Ionicons name="radio" size={48} color="#fff" />}
      </View>

      <AppText muted style={styles.sub}>
        {t('live.highlight.sub')}
      </AppText>

      {!ready ? (
        <ActivityIndicator style={{ marginVertical: 24 }} color={colors.primary} />
      ) : (
        <>
          <Pressable
            accessibilityRole="adjustable"
            accessibilityLabel={t('live.highlight.startsAt', { time: formatClock(startS) })}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(e) => nudge(e.nativeEvent.actionName === 'increment' ? STEP_S : -STEP_S)}
            onLayout={(e) => setBarW(e.nativeEvent.layout.width)}
            onPress={(e) => {
              if (!barW || !total) return;
              stop();
              // Tap = the middle of the minute.
              setPicked(clamp(Math.round((e.nativeEvent.locationX / barW) * total - windowS / 2)));
            }}
            style={[styles.bar, { backgroundColor: colors.bg3 }]}
          >
            <View style={[styles.window, { left: winLeft, width: winWidth, backgroundColor: colors.primary }]} />
            {bars.map((b) =>
              b.h > 0 ? (
                <View
                  key={b.i}
                  pointerEvents="none"
                  style={[
                    styles.activity,
                    { left: b.x * barW, width: Math.max(1.5, b.w * barW - 1), height: 4 + b.h * 30, backgroundColor: colors.text },
                  ]}
                />
              ) : null,
            )}
            {playingMinute ? <View style={[styles.playhead, { left: playedX }]} /> : null}
          </Pressable>
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

          <View style={styles.controls}>
            <Pressable onPress={() => nudge(-STEP_S)} style={[styles.round, { backgroundColor: colors.bg2 }]} accessibilityLabel={t('live.highlight.back5')} hitSlop={6}>
              <Ionicons name="play-back" size={20} color={colors.text} />
            </Pressable>
            <View style={styles.times}>
              <AppText style={{ fontWeight: '700' }}>{t('live.highlight.startsAt', { time: formatClock(startS) })}</AppText>
              <Text style={[styles.small, { color: colors.muted }]}>{t('live.highlight.length', { time: formatClock(windowS) })}</Text>
            </View>
            <Pressable onPress={() => nudge(STEP_S)} style={[styles.round, { backgroundColor: colors.bg2 }]} accessibilityLabel={t('live.highlight.fwd5')} hitSlop={6}>
              <Ionicons name="play-forward" size={20} color={colors.text} />
            </Pressable>
          </View>

          <Button
            title={playingMinute ? t('live.highlight.pause') : t('live.highlight.playMinute')}
            variant="secondary"
            onPress={playingMinute ? stop : () => void playMinute()}
          />
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

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: 12, marginTop: 80, paddingHorizontal: 24 },
  cover: { height: 180, borderRadius: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  coverShade: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: 'rgba(0,4,33,0.45)' },
  coverArt: { width: 110, height: 110, borderRadius: 14 },
  sub: { marginBottom: 18 },
  bar: { height: 44, borderRadius: 10, overflow: 'hidden', justifyContent: 'center' },
  window: { position: 'absolute', top: 0, bottom: 0, borderRadius: 8, opacity: 0.85 },
  activity: { position: 'absolute', bottom: 0, borderTopLeftRadius: 1.5, borderTopRightRadius: 1.5, opacity: 0.45 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -6, marginBottom: 14 },
  busyText: { flex: 1 },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#fff' },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, marginBottom: 14 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  round: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  times: { alignItems: 'center', gap: 2 },
  small: { fontSize: 12.5 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginVertical: 16 },
  discard: { alignSelf: 'center', paddingVertical: 14 },
  note: { textAlign: 'center' },
});
