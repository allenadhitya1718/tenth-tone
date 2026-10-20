import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  I18nManager,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Alert } from '@/components/Dialog';
import type { Sound } from '@/api/sounds';
import { createStory, storyKeys, type StoryAudience, type StoryKind } from '@/api/stories';
import type { LocalMedia } from '@/api/upload';
import { AppText, Button, TopBar } from '@/components/ui';
import { SuggestedHashtags } from '@/features/publish/PublishScreen';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/providers/ThemeProvider';

import { storyError } from './errors';
import { formatClock, SoundPicker } from './SoundPicker';

const MAX_CAPTION = 500;
const MAX_SIDE = 1080;
const MAX_VIDEO_S = 60;
const MAX_START_S = 600;
const STEP_S = 5;

type Picked = {
  kind: StoryKind;
  media: LocalMedia;
  poster: LocalMedia | null;
  width: number;
  height: number;
};

const AUDIENCES: { key: StoryAudience; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'everyone', icon: 'earth-outline' },
  { key: 'followers', icon: 'people-outline' },
  { key: 'close_friends', icon: 'star-outline' },
];

// Photos become JPEG, at most 1080 px on the long side: the R2 bucket takes
// only jpg images, and a story never needs more.
async function preparePhoto(a: ImagePicker.ImagePickerAsset): Promise<Picked> {
  const long = Math.max(a.width, a.height);
  const resize =
    long > MAX_SIDE
      ? [{ resize: a.width >= a.height ? { width: MAX_SIDE } : { height: MAX_SIDE } }]
      : [];
  const out = await ImageManipulator.manipulateAsync(a.uri, resize, {
    compress: 0.85,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return {
    kind: 'image',
    media: { uri: out.uri, mimeType: 'image/jpeg', name: 'story.jpg' },
    poster: null,
    width: out.width,
    height: out.height,
  };
}

// A frame a little way in, as the poster and the moderation sample.
async function prepareVideo(a: ImagePicker.ImagePickerAsset): Promise<Picked> {
  let poster: LocalMedia | null = null;
  try {
    const frame = await VideoThumbnails.getThumbnailAsync(a.uri, { time: 500, quality: 0.8 });
    const small = await ImageManipulator.manipulateAsync(frame.uri, [{ resize: { width: 720 } }], {
      compress: 0.8,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    poster = { uri: small.uri, mimeType: 'image/jpeg', name: 'poster.jpg' };
  } catch (e) {
    console.warn('story poster:', (e as Error)?.message);
  }
  const mime = (a.mimeType ?? 'video/mp4').split(';')[0];
  return {
    kind: 'video',
    media: { uri: a.uri, mimeType: mime, size: a.fileSize ?? null, name: a.fileName ?? (mime === 'video/quicktime' ? 'story.mov' : 'story.mp4') },
    poster,
    width: a.width,
    height: a.height,
  };
}

// Client notes 22 / 25 / 31: post a story. Pick a photo or a video, add a
// caption, a song for photos, choose who sees it, post with progress.
export function StoryComposer() {
  const { t, i18n } = useTranslation();
  const { colors, isDark } = useTheme();
  const qc = useQueryClient();
  const { session } = useAuth();
  const tint = isDark ? colors.primary2 : colors.primary;

  const [picked, setPicked] = useState<Picked | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [caption, setCaption] = useState('');
  const [audience, setAudience] = useState<StoryAudience>('followers');
  const [sound, setSound] = useState<Sound | null>(null);
  const [startS, setStartS] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  // `camera`: take the photo or record the clip now, instead of choosing
  // one from the library. The camera stops itself at MAX_VIDEO_S.
  async function pick(kind: StoryKind, source: 'library' | 'camera' = 'library') {
    if (busy || preparing) return;
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(t('stories.cameraDenied'));
          return;
        }
      }
      const opts: ImagePicker.ImagePickerOptions = {
        mediaTypes: kind === 'image' ? ['images'] : ['videos'],
        quality: 1,
        allowsMultipleSelection: false,
        videoMaxDuration: MAX_VIDEO_S,
      };
      const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      if (kind === 'video' && a.duration && a.duration / 1000 > MAX_VIDEO_S + 0.5) {
        Alert.alert(t('stories.videoTooLong', { n: MAX_VIDEO_S }));
        return;
      }
      setPreparing(true);
      const p = kind === 'image' ? await preparePhoto(a) : await prepareVideo(a);
      setPicked(p);
      if (p.kind === 'video') chooseSound(null);
    } catch (e) {
      console.warn('story pick:', (e as Error)?.message);
      Alert.alert(t('stories.pickFailed'));
    } finally {
      setPreparing(false);
    }
  }

  // ---------- song preview ----------
  const audio = useAudioPlayer(null);
  const audioStatus = useAudioPlayerStatus(audio);
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => {
    audio.pause();
    if (sound?.audio_url) audio.replace({ uri: sound.audio_url });
  }, [audio, sound?.audio_url]);
  const chooseSound = (s: Sound | null) => {
    setPreviewing(false);
    setSound(s);
    setStartS(0);
  };
  useEffect(() => {
    if (previewing && audioStatus.isLoaded) {
      void audio.seekTo(startS).then(() => audio.play()).catch(() => {});
    } else audio.pause();
  }, [audio, previewing, audioStatus.isLoaded, startS]);
  // Leaving the screen stops the preview.
  useFocusEffect(
    useCallback(
      () => () => {
        setPreviewing(false);
      },
      [],
    ),
  );

  const maxStart = Math.min(MAX_START_S, Math.max(0, Math.floor((sound?.duration ?? MAX_START_S) - STEP_S)));
  const nudge = (d: number) => setStartS((s) => Math.max(0, Math.min(maxStart, s + d)));

  async function post() {
    if (!picked || busy) return;
    setBusy(true);
    setProgress(0);
    setPreviewing(false);
    try {
      await createStory({
        media: picked.media,
        kind: picked.kind,
        poster: picked.poster,
        soundId: picked.kind === 'image' ? sound?.id ?? null : null,
        soundStartMs: picked.kind === 'image' && sound ? startS * 1000 : 0,
        caption: caption.trim(),
        audience,
        onProgress: (sent, total) => total > 0 && setProgress(sent / total),
      });
      void qc.invalidateQueries({ queryKey: storyKeys.tray() });
      const me = session?.user.id;
      if (me) void qc.invalidateQueries({ queryKey: storyKeys.user(me) });
      Alert.alert(t('stories.posted'));
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (e) {
      const { title, body } = storyError(e, t, i18n.language);
      Alert.alert(title, body, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('stories.retry'), onPress: () => void post() },
      ]);
    } finally {
      setBusy(false);
    }
  }

  const leave = () => {
    if (busy) return;
    if (!picked) return router.canGoBack() ? router.back() : router.replace('/');
    Alert.alert(t('stories.discardQ'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('stories.discard'), style: 'destructive', onPress: () => (router.canGoBack() ? router.back() : router.replace('/')) },
    ]);
  };

  // ---------- step 1: choose media ----------
  if (!picked) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        <TopBar title={t('stories.newStory')} onBack={leave} />
        <ScrollView contentContainerStyle={styles.chooseWrap}>
          <AppText variant="title" center accessibilityRole="header">
            {t('stories.chooseTitle')}
          </AppText>
          <AppText variant="subtitle" muted center>
            {t('stories.chooseLead')}
          </AppText>
          {preparing ? (
            <View style={{ alignItems: 'center', gap: 8 }} accessibilityLiveRegion="polite">
              <ActivityIndicator color={tint} />
              <AppText muted>{t('stories.preparing')}</AppText>
            </View>
          ) : (
            <>
              <AppText variant="small" muted style={styles.sourceLabel}>
                {t('stories.fromLibrary')}
              </AppText>
              <View style={styles.chooseRow}>
                <ChooseCard icon="image-outline" label={t('stories.photo')} hint={t('stories.photoHint')} onPress={() => void pick('image')} />
                <ChooseCard
                  icon="videocam-outline"
                  label={t('stories.video')}
                  hint={t('stories.videoHint', { n: MAX_VIDEO_S })}
                  onPress={() => void pick('video')}
                />
              </View>
              <AppText variant="small" muted style={styles.sourceLabel}>
                {t('stories.fromCamera')}
              </AppText>
              <View style={styles.chooseRow}>
                <ChooseCard
                  icon="camera-outline"
                  label={t('stories.takePhoto')}
                  hint={t('stories.takePhotoHint')}
                  onPress={() => void pick('image', 'camera')}
                />
                <ChooseCard
                  icon="radio-button-on-outline"
                  label={t('stories.recordVideo')}
                  hint={t('stories.videoHint', { n: MAX_VIDEO_S })}
                  onPress={() => void pick('video', 'camera')}
                />
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---------- step 2: details ----------
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <TopBar title={t('stories.newStory')} onBack={leave} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.previewRow}>
            <View style={[styles.preview, { backgroundColor: colors.bg3 }]}>
              {picked.kind === 'image' ? (
                <Image source={{ uri: picked.media.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <VideoPreview uri={picked.media.uri} />
              )}
              <Pressable
                onPress={() => void pick(picked.kind)}
                disabled={busy}
                style={styles.change}
                accessibilityRole="button"
                accessibilityLabel={t('stories.change')}
              >
                <Ionicons name="swap-horizontal" size={16} color="#fff" />
              </Pressable>
            </View>
            <View style={{ flex: 1 }}>
              <TextInput
                value={caption}
                onChangeText={(v) => setCaption(v.slice(0, MAX_CAPTION))}
                placeholder={t('stories.captionPlaceholder')}
                placeholderTextColor={colors.muted}
                multiline
                editable={!busy}
                accessibilityLabel={t('stories.caption')}
                style={[styles.caption, { color: colors.text, textAlign: I18nManager.isRTL ? 'right' : 'left' }]}
              />
              <AppText variant="small" muted style={{ alignSelf: 'flex-end' }}>
                {caption.length}/{MAX_CAPTION}
              </AppText>
            </View>
          </View>

          {/* Note 23: the same AI hashtag row as the video publish screen,
              for photos (the photo itself is the sample). */}
          {picked.kind === 'image' ? (
            <SuggestedHashtags image={picked.media} caption={caption} max={MAX_CAPTION} onChange={setCaption} disabled={busy} />
          ) : null}

          {picked.kind === 'image' ? (
            <Section title={t('stories.song')}>
              {sound ? (
                <View style={{ paddingVertical: 10, gap: 10 }}>
                  <View style={styles.songRow}>
                    <View style={[styles.songCover, { backgroundColor: colors.bg3 }]}>
                      {sound.cover_url ? (
                        <Image source={{ uri: sound.cover_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
                      ) : (
                        <Ionicons name="musical-notes" size={18} color={colors.muted} />
                      )}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <AppText numberOfLines={1} style={{ fontWeight: '700' }}>
                        {sound.title || t('stories.untitledSong')}
                      </AppText>
                      {sound.author_name ? (
                        <AppText variant="small" muted numberOfLines={1}>
                          {sound.author_name}
                        </AppText>
                      ) : null}
                    </View>
                    <IconButton
                      icon={previewing ? 'pause' : 'play'}
                      label={previewing ? t('stories.stopPreview') : t('stories.preview')}
                      onPress={() => setPreviewing((p) => !p)}
                    />
                    <IconButton icon="close" label={t('stories.removeSong')} onPress={() => chooseSound(null)} />
                  </View>
                  <View style={styles.startRow}>
                    <AppText variant="small" muted style={{ flex: 1 }}>
                      {t('stories.startsAt')}
                    </AppText>
                    <IconButton icon="remove" label={t('stories.earlier', { n: STEP_S })} onPress={() => nudge(-STEP_S)} disabled={startS <= 0} />
                    <AppText
                      style={styles.clock}
                      accessibilityLiveRegion="polite"
                      accessibilityLabel={t('stories.startsAtA11y', { time: formatClock(startS) })}
                    >
                      {formatClock(startS)}
                    </AppText>
                    <IconButton icon="add" label={t('stories.later', { n: STEP_S })} onPress={() => nudge(STEP_S)} disabled={startS >= maxStart} />
                  </View>
                </View>
              ) : (
                <Pressable
                  onPress={() => setPickerOpen(true)}
                  style={styles.option}
                  accessibilityRole="button"
                  disabled={busy}
                >
                  <Ionicons name="musical-notes-outline" size={20} color={colors.text} />
                  <AppText style={{ flex: 1 }}>{t('stories.addSong')}</AppText>
                  <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.muted} />
                </Pressable>
              )}
            </Section>
          ) : null}

          <Section title={t('stories.audience')}>
            <View accessibilityRole="radiogroup">
              {AUDIENCES.map((a) => {
                const on = audience === a.key;
                return (
                  <Pressable
                    key={a.key}
                    onPress={() => setAudience(a.key)}
                    disabled={busy}
                    style={styles.option}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on, disabled: busy }}
                  >
                    <Ionicons name={a.icon} size={20} color={a.key === 'close_friends' ? colors.success : colors.text} />
                    <View style={{ flex: 1 }}>
                      <AppText>{t(`stories.audience_${a.key}`)}</AppText>
                      <AppText variant="small" muted>
                        {t(`stories.audience_${a.key}_hint`)}
                      </AppText>
                    </View>
                    <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? tint : colors.muted} />
                  </Pressable>
                );
              })}
            </View>
          </Section>

          {busy ? (
            <View style={{ gap: 6 }} accessibilityLiveRegion="polite">
              <View style={[styles.bar, { backgroundColor: colors.bg3 }]}>
                <View style={[styles.barFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: colors.primary }]} />
              </View>
              <AppText variant="small" muted center>
                {progress < 1 ? t('stories.uploading', { pct: Math.round(progress * 100) }) : t('stories.finishing')}
              </AppText>
            </View>
          ) : null}

          <Button title={t('stories.share')} onPress={() => void post()} loading={busy} disabled={busy} />
        </ScrollView>
      </KeyboardAvoidingView>

      <SoundPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(s) => {
          chooseSound(s);
          setPickerOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />;
}

function ChooseCard({
  icon,
  label,
  hint,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  onPress: () => void;
}) {
  const { colors, isDark } = useTheme();
  const tint = isDark ? colors.primary2 : colors.primary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={({ pressed }) => [
        styles.chooseCard,
        { backgroundColor: colors.bg2, borderColor: colors.border, transform: [{ scale: pressed ? 0.98 : 1 }] },
      ]}
    >
      <View style={[styles.chooseIcon, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name={icon} size={30} color={tint} />
      </View>
      <AppText variant="label">{label}</AppText>
      <AppText variant="small" muted center>
        {hint}
      </AppText>
    </Pressable>
  );
}

function IconButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={[styles.iconBtn, { backgroundColor: colors.bg3 }, disabled && { opacity: 0.4 }]}
    >
      <Ionicons name={icon} size={18} color={colors.text} />
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <AppText variant="small" muted style={{ fontWeight: '700' }} accessibilityRole="header">
        {title}
      </AppText>
      <View style={[styles.card, { backgroundColor: colors.bg2 }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  chooseWrap: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 22, paddingVertical: 16, gap: 8 },
  chooseRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  sourceLabel: { marginTop: 14, fontWeight: '700' },
  chooseCard: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
    paddingVertical: 26,
    paddingHorizontal: 12,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chooseIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 16 },
  previewRow: { flexDirection: 'row', gap: 12 },
  preview: { width: 120, height: 213, borderRadius: 14, overflow: 'hidden' },
  change: {
    position: 'absolute',
    bottom: 8,
    end: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: { minHeight: 150, fontSize: 15, lineHeight: 21, textAlignVertical: 'top' },
  card: { borderRadius: 14, paddingHorizontal: 14 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 6 },
  songRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  songCover: { width: 44, height: 44, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  startRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  clock: { minWidth: 48, textAlign: 'center', fontWeight: '700', fontVariant: ['tabular-nums'] },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6 },
});
