import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type RecordingOptions, RecordingPresets, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { type Href, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/api/client';
import { highlightKeys, postVoiceClip } from '@/api/highlights';
import { fetchProfile, profileKeys } from '@/api/profiles';
import type { LocalMedia } from '@/api/upload';
import { showAlert } from '@/components/Dialog';
import { showToast } from '@/components/Toast';
import { AppText, Button, Screen, TopBar } from '@/components/ui';
import { useVoiceRecorder } from '@/features/chat/useVoiceRecorder';
import { isImageUrl } from '@/features/discover/nav';
import { HighlightCover } from '@/features/highlights/HighlightCover';
import { formatClock } from '@/features/stories/SoundPicker';
import { reportError } from '@/lib/errorReport';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/providers/ThemeProvider';

const MAX_S = 5 * 60; // the recorder stops itself at five minutes
const MIN_MS = 5000; // the server's minimum (0170)
const MAX_CAPTION = 150;

// Speech quality, small files: a 5-minute clip must stay under the upload
// limit. The Redmi ignored a plain AAC 64 kbps request and recorded at
// ~192 kbps (370 KB for 15 s, ~7.4 MB for 5 minutes). HE-AAC on Android is
// built for low-bitrate speech; 48 kbps mono is ~1.8 MB for 5 minutes.
const VOICE_CLIP_PRESET: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 32000,
  numberOfChannels: 1,
  bitRate: 48000,
  android: { outputFormat: 'mpeg4', audioEncoder: 'he_aac' },
};

// A voice clip (0170): the person records up to five minutes in the app,
// listens back, picks a background photo, adds a caption and posts. It is
// shown with live highlights in Explore, Home and on their profile.
// Opened from the Create (+) menu. (Client, Nov 2026.)
export function VoiceClipMaker() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const { session } = useAuth();
  const me = session?.user.id;
  const mine = useQuery({
    queryKey: profileKeys.profile(me ?? ''),
    queryFn: () => fetchProfile(me),
    enabled: !!me,
  });
  const myName = mine.data?.name || mine.data?.handle || '';
  const myPhoto = isImageUrl(mine.data?.avatar_url) ? mine.data!.avatar_url! : null;

  const [clip, setClip] = useState<{ media: LocalMedia; ms: number } | null>(null);
  const [title, setTitle] = useState('');
  const [cover, setCover] = useState<LocalMedia | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const rec = useVoiceRecorder(
    {
      onDone: (media, ms) => {
        if (ms < MIN_MS) {
          showAlert(t('voice.tooShortTitle'), t('voice.tooShort'));
          return;
        }
        setClip({ media, ms });
      },
      onTooShort: () => showAlert(t('voice.tooShortTitle'), t('voice.tooShort')),
      onPermissionAsked: () => showToast(t('voice.tapAgain'), 'mic-outline'),
      onPermissionDenied: () =>
        showAlert(t('voice.micTitle'), t('voice.micBody'), [
          { text: t('voice.cancel'), style: 'cancel' },
          {
            text: t('voice.openSettings'),
            onPress: () => void Linking.openSettings(),
          },
        ]),
      onError: () => showAlert(t('voice.errorTitle'), t('voice.recordFailed')),
    },
    VOICE_CLIP_PRESET,
  );

  // Listening back to the recording.
  const player = useAudioPlayer(clip ? { uri: clip.media.uri } : null);
  const status = useAudioPlayerStatus(player);
  useEffect(() => () => player.pause(), [player]);
  const togglePlay = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (status.duration > 0 && status.currentTime >= status.duration - 0.25) void player.seekTo(0);
    player.play();
  };

  const recordAgain = () =>
    showAlert(t('voice.againTitle'), t('voice.againBody'), [
      { text: t('voice.cancel'), style: 'cancel' },
      {
        text: t('voice.again'),
        style: 'destructive',
        onPress: () => {
          player.pause();
          setClip(null);
        },
      },
    ]);

  async function pickCover() {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (res.canceled || !res.assets[0]) return;
      const a = res.assets[0];
      setCover({
        uri: a.uri,
        mimeType: a.mimeType ?? 'image/jpeg',
        size: a.fileSize ?? null,
        name: a.fileName ?? null,
      });
    } catch {
      showAlert(t('voice.errorTitle'), t('live.highlight.coverPickFailed'));
    }
  }

  async function post() {
    if (!clip || busy) return;
    setBusy(true);
    player.pause();
    setProgress(0);
    try {
      const posted = await postVoiceClip({ audio: clip.media, durationMs: clip.ms, title, cover }, setProgress);
      void qc.invalidateQueries({ queryKey: highlightKeys.all });
      showToast(t('voice.posted'));
      router.replace(`/highlight/${posted.id}` as Href);
    } catch (e) {
      reportError('handled', e, true, 'voice-post');
      const code = e instanceof ApiError ? e.code : null;
      const msg =
        code === 'network'
          ? t('live.highlight.network')
          : code === 'highlight_limit_day'
            ? t('live.highlight.limitDay')
            : code === 'content_blocked'
              ? t('live.errors.content_blocked')
              : t('voice.failed');
      showAlert(t('voice.errorTitle'), msg);
    } finally {
      setBusy(false);
    }
  }

  const shownCover = cover?.uri ?? myPhoto;
  const coverSource = cover ? 'coverChosen' : myPhoto ? 'coverFromProfile' : 'coverBrand';
  const elapsedS = rec.recording ? rec.durationMs / 1000 : 0;
  const header = <TopBar title={t('voice.title')} />;

  return (
    <Screen header={header}>
      {/* The picture that goes with the voice, as it will be posted. */}
      <View style={[styles.stage, { backgroundColor: colors.bg2 }]}>
        <HighlightCover uri={shownCover} hostName={myName} blurRadius={18} />
        <View style={styles.shade} />
        <View style={styles.art}>
          <HighlightCover uri={shownCover} hostName={myName} compact />
        </View>
      </View>

      {!clip ? (
        <View style={styles.recordBox}>
          <Text style={[styles.timer, { color: colors.text }]}>{`⁦${formatClock(elapsedS)} / ${formatClock(MAX_S)}⁩`}</Text>
          <Pressable
            onPress={() => (rec.recording ? rec.finish() : void rec.begin())}
            style={[
              styles.mic,
              {
                backgroundColor: rec.recording ? colors.danger : colors.primary,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={rec.recording ? t('voice.stop') : t('voice.record')}
          >
            <Ionicons name={rec.recording ? 'stop' : 'mic'} size={38} color="#fff" />
          </Pressable>
          <AppText muted center>
            {rec.recording ? t('voice.recordingHint') : t('voice.startHint')}
          </AppText>
        </View>
      ) : (
        <View style={[styles.listenRow, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
          <Pressable
            onPress={togglePlay}
            style={[styles.playBtn, { backgroundColor: colors.primary }]}
            accessibilityRole="button"
            accessibilityLabel={status.playing ? t('live.highlight.pause') : t('live.highlight.play')}
          >
            <Ionicons name={status.playing ? 'pause' : 'play'} size={22} color="#fff" style={status.playing ? undefined : { marginStart: 3 }} />
          </Pressable>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText style={{ fontWeight: '800' }}>{t('voice.yourClip')}</AppText>
            <Text style={[styles.small, { color: colors.muted }]}>{`⁦${formatClock(status.currentTime)} / ${formatClock(clip.ms / 1000)}⁩`}</Text>
          </View>
          <Pressable onPress={recordAgain} disabled={busy} hitSlop={8} accessibilityRole="button">
            <Text style={{ color: colors.primary, fontWeight: '800' }}>{t('voice.again')}</Text>
          </Pressable>
        </View>
      )}

      <TextInput
        value={title}
        onChangeText={(v) => setTitle(v.slice(0, MAX_CAPTION))}
        placeholder={t('live.highlight.titlePh')}
        placeholderTextColor={colors.muted}
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.bg2,
            borderColor: colors.border,
          },
        ]}
        maxLength={MAX_CAPTION}
        editable={!busy}
        multiline
        textAlignVertical="top"
      />

      {/* The background photo, shown with the voice everywhere. */}
      <View style={[styles.coverRow, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
        <View style={styles.coverThumb}>
          <HighlightCover uri={shownCover} hostName={myName} compact />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText style={{ fontWeight: '700' }}>{t('voice.background')}</AppText>
          <Text style={[styles.small, { color: colors.muted }]} numberOfLines={2}>
            {t(`live.highlight.${coverSource}`)}
          </Text>
        </View>
        {cover ? (
          <Pressable onPress={() => setCover(null)} disabled={busy} hitSlop={8} accessibilityRole="button" style={styles.coverBtn}>
            <Text style={[styles.small, { color: colors.muted, fontWeight: '700' }]}>{t('live.highlight.coverReset')}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => void pickCover()} disabled={busy} hitSlop={8} accessibilityRole="button" style={styles.coverBtn}>
          <Text style={{ color: colors.primary, fontWeight: '800' }}>{t('live.highlight.coverChange')}</Text>
        </Pressable>
      </View>

      <Button
        title={busy ? `${t('voice.posting')} ${progress ? Math.round(progress * 100) + '%' : ''}`.trim() : t('voice.post')}
        onPress={() => void post()}
        disabled={!clip || busy}
        loading={busy}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  stage: {
    height: 200,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  shade: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    backgroundColor: 'rgba(0,4,33,0.45)',
  },
  art: { width: 128, height: 128, borderRadius: 16, overflow: 'hidden' },
  recordBox: { alignItems: 'center', gap: 14, marginBottom: 18 },
  timer: { fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  mic: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 6,
  },
  playBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  small: { fontSize: 13 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginVertical: 14,
    minHeight: 72,
  },
  coverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 10,
    marginBottom: 16,
  },
  coverThumb: { width: 52, height: 52, borderRadius: 10, overflow: 'hidden' },
  coverBtn: { paddingHorizontal: 6, paddingVertical: 6 },
});
