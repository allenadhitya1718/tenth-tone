import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImageManipulator from 'expo-image-manipulator';
import { router } from 'expo-router';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { type VideoPlayer, useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, I18nManager, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import type { TagRefusal } from '@/api/tags';
import type { Privacy, UserSummary } from '@/api/types';
import type { LocalMedia } from '@/api/upload';
import { appendTag, captionTags, suggestTags, suggestTagsKeys, tagLangFor } from '@/api/suggestTags';
import { publishVideo, videoKeys, type VideoPlace } from '@/api/videos';
import { showToast } from '@/components/Toast';
import { Button, TopBar } from '@/components/ui';
import { PlacePicker } from '@/features/place/PlacePicker';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/providers/ThemeProvider';

import { clearPendingSound, usePendingSound } from './pendingSound';
import { Avatar, TagPeoplePicker } from './TagPeoplePicker';
import { atHandle } from '@/lib/handle';

const MAX_CAPTION = 300;

// Caption, privacy and posting. Client note 2 ("the upload never finishes,
// and the video can't be published or saved as a draft"): the file now goes
// from disk straight to R2 with real progress, a failure keeps everything on
// screen with Retry, and Save draft goes through the same path.
//
// Note 21: a place (the Location row, PlacePicker) and tagged people (the
// Tag people row, TagPeoplePicker). The place is saved with the post and
// offered as a hashtag; tags the server refuses (who_can_tag, blocks) are
// listed after posting. `place` seeds the row when a caller already has one.
export function PublishScreen({
  uri,
  mime,
  size,
  place: initialPlace = null,
}: {
  uri: string;
  mime?: string;
  size?: number;
  place?: VideoPlace | null;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { session } = useAuth();
  const qc = useQueryClient();
  const [caption, setCaption] = useState('');
  const [privacy, setPrivacy] = useState<Privacy>('public');
  const [allowComments, setAllowComments] = useState(true);
  const [allowSaving, setAllowSaving] = useState(true);
  const [busy, setBusy] = useState<null | 'post' | 'draft'>(null);
  const [full, setFull] = useState(false);
  const [progress, setProgress] = useState(0);
  const [poster, setPoster] = useState<LocalMedia | null>(null);
  const [place, setPlace] = useState<VideoPlace | null>(initialPlace);
  const [tagged, setTagged] = useState<UserSummary[]>([]);
  const [picker, setPicker] = useState<null | 'place' | 'tags'>(null);
  // "Use this sound" on a sound page: the post is linked to that sound.
  const sound = usePendingSound();
  // Leaving this screen (posted, or backed out) drops the pick.
  useEffect(() => clearPendingSound, []);

  const player = useVideoPlayer({ uri }, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  // A frame a little way in (frame 0 of a phone clip is often black),
  // scaled to 720 px wide: it is the feed poster and the moderation sample.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const frame = await VideoThumbnails.getThumbnailAsync(uri, { time: 1000, quality: 0.8 });
        const small = await ImageManipulator.manipulateAsync(frame.uri, [{ resize: { width: 720 } }], {
          compress: 0.8,
          format: ImageManipulator.SaveFormat.JPEG,
        });
        if (live) setPoster({ uri: small.uri, mimeType: 'image/jpeg', name: 'poster.jpg' });
      } catch (e) {
        console.warn('poster:', (e as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [uri]);

  async function submit(asDraft: boolean) {
    if (busy) return;
    setBusy(asDraft ? 'draft' : 'post');
    setProgress(0);
    try {
      const { tagRefusals } = await publishVideo({
        video: { uri, mimeType: mime ?? 'video/mp4', size: size ?? null, name: 'clip.mp4' },
        poster,
        description: caption.trim(),
        sound_id: sound?.id ?? null,
        music: sound?.title ?? null,
        privacy,
        is_draft: asDraft,
        allow_comments: allowComments,
        allow_saving: allowSaving,
        place,
        tags: tagged.map((p) => p.id),
        onProgress: (sent, total) => total > 0 && setProgress(sent / total),
      });
      player.pause();
      const me = session?.user.id;
      void qc.invalidateQueries({ queryKey: videoKeys.feed('foryou') });
      void qc.invalidateQueries({ queryKey: videoKeys.drafts() });
      if (me) void qc.invalidateQueries({ queryKey: videoKeys.userVideos(me) });
      showToast(t(asDraft ? 'publish.draftSaved' : 'publish.posted'), asDraft ? 'document-text' : 'checkmark-circle');
      if (tagRefusals.length) reportRefusals(tagRefusals);
      router.dismissAll();
      router.replace('/profile');
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      const message =
        code === 'content_blocked'
          ? (e as Error).message
          : code.startsWith('quota') || code === 'file_too_large'
            ? t('publish.tooLarge')
            : t('publish.failedHint');
      Alert.alert(t('publish.failed'), message, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('feed.retry'), onPress: () => submit(asDraft) },
      ]);
    } finally {
      setBusy(null);
    }
  }

  // The post is up; only some tags did not land. One alert naming each.
  function reportRefusals(refusals: TagRefusal[]) {
    const byId = new Map(tagged.map((p) => [p.id, p]));
    const lines = refusals.some((r) => r.reason === 'tags_unavailable')
      ? [t('place.refusedUnavailable')]
      : refusals.map((r) => {
          const who = byId.get(r.userId);
          const handle = who?.handle ?? who?.name ?? '?';
          if (r.reason === 'tag_not_allowed') return t('place.refusedNotAllowed', { handle });
          if (r.reason === 'tag_limit') return t('place.refusedLimit', { handle });
          return t('place.refusedFailed', { handle });
        });
    Alert.alert(t('place.refusedTitle'), lines.join('\n'));
  }

  const insert = (s: string) => setCaption((c) => (c + (c && !c.endsWith(' ') ? ' ' : '') + s).slice(0, MAX_CAPTION));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <TopBar title={t('camera.publish')} onBack={busy ? () => {} : undefined} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
        <View style={styles.top}>
          <Pressable
            onPress={() => setFull(true)}
            accessibilityRole="button"
            accessibilityLabel={t('publish.watchFull')}
            style={[styles.preview, { backgroundColor: colors.bg3 }]}
          >
            {/* One player feeds one view at a time on Android, so the
                thumbnail steps aside while the full-screen view is open. */}
            {full ? null : (
              <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} pointerEvents="none" />
            )}
            <View style={styles.expand} pointerEvents="none">
              <Ionicons name="expand" size={16} color="#fff" />
            </View>
          </Pressable>
          <View style={{ flex: 1 }}>
            <TextInput
              value={caption}
              onChangeText={(v) => setCaption(v.slice(0, MAX_CAPTION))}
              placeholder={t('publish.captionPlaceholder')}
              placeholderTextColor={colors.muted}
              multiline
              style={[styles.caption, { color: colors.text, textAlign: I18nManager.isRTL ? 'right' : 'left' }]}
            />
            <View style={styles.chips}>
              <Chip label="# " text={t('publish.hashtag')} onPress={() => insert('#')} />
              <Chip label="@ " text={t('publish.mention')} onPress={() => insert('@')} />
            </View>
            <Text style={{ color: colors.muted, fontSize: 12, alignSelf: 'flex-end' }}>
              {caption.length}/{MAX_CAPTION}
            </Text>
          </View>
        </View>

        <SuggestedHashtags image={poster} place={place?.name} caption={caption} max={MAX_CAPTION} onChange={setCaption} disabled={!!busy} />

        {sound ? (
          <View style={[styles.soundChip, { backgroundColor: colors.bg2 }]}>
            <Ionicons name="musical-notes" size={18} color={colors.text} />
            <Text style={[styles.optionText, { color: colors.text }]} numberOfLines={1}>
              {t('fix4.soundLabel', { title: sound.title || t('discover.sound.untitled') })}
            </Text>
            <Pressable
              onPress={clearPendingSound}
              disabled={!!busy}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('fix4.soundRemove')}
            >
              <Ionicons name="close-circle" size={20} color={colors.muted} />
            </Pressable>
          </View>
        ) : null}

        <Section title={t('place.details')}>
          <Pressable
            onPress={() => setPicker('place')}
            disabled={!!busy}
            accessibilityRole="button"
            accessibilityLabel={place ? `${t('place.location')}: ${place.name}` : t('place.addLocation')}
            style={styles.option}
          >
            <Ionicons name="location-outline" size={20} color={colors.text} />
            <Text style={[styles.optionText, { color: colors.text }]} numberOfLines={1}>
              {place ? place.name : t('place.addLocation')}
            </Text>
            {place ? (
              <Pressable
                onPress={() => setPlace(null)}
                hitSlop={10}
                disabled={!!busy}
                accessibilityRole="button"
                accessibilityLabel={t('place.removeLocation')}
              >
                <Ionicons name="close-circle" size={20} color={colors.muted} />
              </Pressable>
            ) : (
              <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.muted} />
            )}
          </Pressable>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Pressable
            onPress={() => setPicker('tags')}
            disabled={!!busy}
            accessibilityRole="button"
            accessibilityLabel={
              tagged.length
                ? `${t('place.tagPeople')}: ${tagged.map((p) => p.handle ?? p.name).join(', ')}`
                : t('place.tagPeople')
            }
            style={styles.option}
          >
            <Ionicons name="person-add-outline" size={20} color={colors.text} />
            {tagged.length ? (
              <View style={styles.taggedRow}>
                <View style={styles.faces}>
                  {tagged.slice(0, 3).map((p, i) => (
                    <View key={p.id} style={[styles.face, { borderColor: colors.bg2, marginStart: i ? -8 : 0 }]}>
                      <Avatar user={p} size={24} />
                    </View>
                  ))}
                </View>
                <Text style={[styles.optionText, { color: colors.text }]} numberOfLines={1}>
                  {tagged.map((p) => atHandle(p.handle ?? p.name)).join(', ')}
                </Text>
              </View>
            ) : (
              <Text style={[styles.optionText, { color: colors.text }]}>{t('place.tagPeople')}</Text>
            )}
            <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.muted} />
          </Pressable>
        </Section>

        <Section title={t('publish.whoCanWatch')}>
          {(['public', 'followers', 'private'] as Privacy[]).map((p) => (
            <Pressable
              key={p}
              onPress={() => setPrivacy(p)}
              style={styles.option}
              accessibilityRole="radio"
              accessibilityState={{ checked: privacy === p }}
            >
              <Ionicons name={PRIVACY_ICON[p]} size={20} color={colors.text} />
              <Text style={[styles.optionText, { color: colors.text }]}>{t(`publish.privacy_${p}`)}</Text>
              <Ionicons
                name={privacy === p ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={privacy === p ? colors.primary : colors.muted}
              />
            </Pressable>
          ))}
        </Section>

        <Section title={t('publish.options')}>
          <Toggle label={t('publish.allowComments')} value={allowComments} onChange={setAllowComments} />
          <Toggle label={t('publish.allowSaving')} value={allowSaving} onChange={setAllowSaving} />
        </Section>

        {busy ? (
          <View style={{ gap: 6 }}>
            <View style={[styles.bar, { backgroundColor: colors.bg3 }]}>
              <View style={[styles.barFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: colors.primary }]} />
            </View>
            <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center' }}>
              {progress < 1 ? t('publish.uploading', { pct: Math.round(progress * 100) }) : t('publish.finishing')}
            </Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button
            title={t('publish.saveDraft')}
            variant="secondary"
            style={{ flex: 1 }}
            loading={busy === 'draft'}
            disabled={!!busy}
            onPress={() => submit(true)}
          />
          <Button title={t('camera.publish')} style={{ flex: 1 }} loading={busy === 'post'} disabled={!!busy} onPress={() => submit(false)} />
        </View>
      </ScrollView>
      <FullPreview open={full} player={player} onClose={() => setFull(false)} />
      <PlacePicker open={picker === 'place'} onClose={() => setPicker(null)} onPick={setPlace} />
      <TagPeoplePicker open={picker === 'tags'} initial={tagged} onClose={() => setPicker(null)} onDone={setTagged} />
    </SafeAreaView>
  );
}

const PRIVACY_ICON: Record<Privacy, keyof typeof Ionicons.glyphMap> = {
  public: 'earth-outline',
  followers: 'people-outline',
  private: 'lock-closed-outline',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 13 }}>{title}</Text>
      <View style={[styles.card, { backgroundColor: colors.bg2 }]}>{children}</View>
    </View>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.option}>
      <Text style={[styles.optionText, { color: colors.text }]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary }} />
    </View>
  );
}

function Chip({ label, text, onPress }: { label: string; text: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.chip, { backgroundColor: colors.bg2 }]} accessibilityRole="button">
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
        {label}
        {text}
      </Text>
    </Pressable>
  );
}

// Client note 23: AI hashtags from the poster frame, plus the place. Asks
// once per image (the query key holds it; the server limits each account),
// shows a skeleton while it waits, and hides itself on any failure: no
// suggestions is a fine outcome. Tapping a chip appends #tag to the caption
// unless it is already there or would not fit in `max`.
//
// Exported for the story composer, which shows the same row for photos.
export function SuggestedHashtags({
  image,
  place,
  caption,
  max,
  onChange,
  disabled,
}: {
  image: LocalMedia | null;
  place?: string | null;
  caption: string;
  max: number;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { colors, isDark } = useTheme();
  const tint = isDark ? colors.primary2 : colors.primary;
  const lang = tagLangFor(i18n.language);
  const placeName = place?.trim() || null;
  // Only on request: each suggestion is a Gemini call, and the free tier's
  // daily cap is shared with upload screening, which must always run.
  const [asked, setAsked] = useState(false);
  const q = useQuery({
    queryKey: suggestTagsKeys.forImage(image?.uri ?? null, placeName, lang),
    queryFn: () => suggestTags({ image, place: placeName, lang }),
    enabled: !!image && asked,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  if (!image) return null;
  if (!asked) {
    return (
      <Pressable
        onPress={() => setAsked(true)}
        disabled={disabled}
        accessibilityRole="button"
        style={[styles.suggestChip, { alignSelf: 'flex-start', backgroundColor: colors.bg2, borderColor: colors.border }]}
      >
        <Ionicons name="sparkles" size={14} color={tint} />
        <Text style={{ color: tint, fontWeight: '700', fontSize: 13 }}>{t('hashtags.suggestButton')}</Text>
      </Pressable>
    );
  }
  const rateLimited = q.error instanceof ApiError && q.error.code === 'rate_limited';
  if (q.isError && !rateLimited) return null;
  const tags = q.data ? [...(q.data.placeTag ? [q.data.placeTag] : []), ...q.data.tags] : [];
  if (q.isSuccess && !tags.length) return null;

  const present = captionTags(caption);

  return (
    <View style={{ gap: 8 }}>
      <View style={styles.suggestHead}>
        <Ionicons name="sparkles" size={14} color={tint} />
        <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 13 }} accessibilityRole="header">
          {t('hashtags.suggested')}
        </Text>
      </View>
      {q.isPending ? (
        <View style={styles.suggestRow} accessibilityLabel={t('hashtags.loading')} accessibilityLiveRegion="polite">
          {[64, 88, 56, 96, 72].map((w, i) => (
            <SkeletonPill key={i} width={w} color={colors.bg3} />
          ))}
        </View>
      ) : rateLimited ? (
        <Text style={{ color: colors.muted, fontSize: 13 }}>{t('hashtags.rateLimited')}</Text>
      ) : (
        <View style={styles.suggestRow} accessibilityHint={t('hashtags.hint')}>
          {tags.map((tag) => {
            const isPlace = tag === q.data?.placeTag;
            const added = present.has(tag.toLowerCase());
            const next = added ? null : appendTag(caption, tag, max);
            const off = !!disabled || added || next == null;
            return (
              <Pressable
                key={tag}
                onPress={() => next != null && onChange(next)}
                disabled={off}
                accessibilityRole="button"
                accessibilityState={{ disabled: off, selected: added }}
                accessibilityLabel={
                  added ? t('hashtags.added', { tag }) : next == null ? t('hashtags.noRoom', { tag }) : t('hashtags.add', { tag })
                }
                style={[
                  styles.suggestChip,
                  { backgroundColor: added ? colors.primarySoft : colors.bg2, borderColor: added ? tint : colors.border },
                  !added && next == null && { opacity: 0.45 },
                ]}
              >
                {isPlace ? <Ionicons name="location" size={13} color={tint} /> : null}
                <Text style={{ color: added ? tint : colors.text, fontWeight: '600', fontSize: 13 }}>#{tag}</Text>
                {added ? <Ionicons name="checkmark" size={13} color={tint} /> : null}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

function SkeletonPill({ width, color }: { width: number; color: string }) {
  const o = useSharedValue(0.45);
  useEffect(() => {
    o.set(withRepeat(withTiming(1, { duration: 700 }), -1, true));
  }, [o]);
  const style = useAnimatedStyle(() => ({ opacity: o.get() }));
  return <Animated.View style={[styles.skeleton, { width, backgroundColor: color }, style]} />;
}

// The clip as it will look in the feed: full screen, with sound. Tap to
// pause or play; the X or Android back returns to the form, muted again.
function FullPreview({ open, player, onClose }: { open: boolean; player: VideoPlayer; onClose: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!open) return;
    // The player is an imperative native object, not React state.
    // eslint-disable-next-line react-hooks/immutability
    player.muted = false;
    player.play();
    return () => {
      player.muted = true;
      player.play();
    };
  }, [open, player]);

  const toggle = () => {
    if (paused) player.play();
    else player.pause();
    setPaused(!paused);
  };

  return (
    <Modal visible={open} animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait']}>
      <View style={styles.fullRoot}>
        {open ? <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} pointerEvents="none" /> : null}
        <Pressable style={StyleSheet.absoluteFill} onPress={toggle} accessibilityRole="button" accessibilityLabel={t(paused ? 'publish.play' : 'publish.pause')}>
          {paused ? (
            <View style={styles.fullCenter} pointerEvents="none">
              <Ionicons name="play" size={64} color="rgba(255,255,255,0.85)" />
            </View>
          ) : null}
        </Pressable>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('publish.closePreview')}
          style={[styles.fullClose, { top: insets.top + 12 }]}
        >
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  soundChip: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14 },
  expand: { position: 'absolute', bottom: 6, end: 6, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 10, padding: 4 },
  fullRoot: { flex: 1, backgroundColor: '#000' },
  fullCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fullClose: { position: 'absolute', start: 14, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  top: { flexDirection: 'row', gap: 12 },
  preview: { width: 110, height: 196, borderRadius: 12, overflow: 'hidden' },
  caption: { minHeight: 110, fontSize: 15, lineHeight: 21, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', gap: 8, marginTop: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },
  suggestHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  suggestRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  suggestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  skeleton: { height: 30, borderRadius: 16 },
  card: { borderRadius: 14, paddingHorizontal: 14 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50 },
  optionText: { flex: 1, fontSize: 15 },
  divider: { height: StyleSheet.hairlineWidth },
  taggedRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  faces: { flexDirection: 'row' },
  face: { borderWidth: 2, borderRadius: 14 },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6 },
  actions: { flexDirection: 'row', gap: 10 },
});
