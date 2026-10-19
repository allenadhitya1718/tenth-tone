import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  I18nManager,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import type { Privacy } from '@/api/types';
import { deleteVideo, fetchVideo, publishDraft, videoKeys, type VideoTile } from '@/api/videos';
import { showToast } from '@/components/Toast';
import { Button } from '@/components/ui';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/providers/ThemeProvider';

import { updateDraft } from './api';

const MAX_CAPTION = 300;
const PRIVACIES: Privacy[] = ['public', 'followers', 'private'];
const PRIVACY_ICON: Record<Privacy, keyof typeof Ionicons.glyphMap> = {
  public: 'earth-outline',
  followers: 'people-outline',
  private: 'lock-closed-outline',
};

const asPrivacy = (p: string | null | undefined): Privacy => (PRIVACIES.includes(p as Privacy) ? (p as Privacy) : 'public');

// Client note 2: a saved draft opens here, never in the For You feed (where
// it used to play as if it were posted). Preview, then Post now, Edit the
// caption and settings, or Delete.
export function DraftSheet({ draft, onClose }: { draft: VideoTile | null; onClose: () => void }) {
  return (
    <Modal visible={!!draft} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {draft ? <DraftBody draft={draft} onClose={onClose} /> : null}
    </Modal>
  );
}

function DraftBody({ draft, onClose }: { draft: VideoTile; onClose: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const { session } = useAuth();
  const me = session?.user.id;
  const qc = useQueryClient();

  const full = useQuery({ queryKey: videoKeys.video(draft.id), queryFn: () => fetchVideo(draft.id) });
  const video = full.data;

  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<null | 'post' | 'save' | 'delete'>(null);
  const [caption, setCaption] = useState(draft.description ?? '');
  const [privacy, setPrivacy] = useState<Privacy>('public');
  const [allowComments, setAllowComments] = useState(true);
  const [allowSaving, setAllowSaving] = useState(true);
  const [paused, setPaused] = useState(false);

  // The form starts from what was saved with the draft (run on Edit).
  const reset = () => {
    setCaption(video?.description ?? draft.description ?? '');
    setPrivacy(asPrivacy(video?.privacy));
    setAllowComments(video?.allow_comments ?? true);
    setAllowSaving(video?.allow_saving ?? true);
  };

  const src = video?.video_url ?? draft.video_url ?? null;
  const player = useVideoPlayer(src ? { uri: src } : null, (p) => {
    p.loop = true;
    p.play();
  });
  const togglePlay = () => {
    if (paused) player.play();
    else player.pause();
    setPaused(!paused);
  };

  const refreshLists = () => {
    void qc.invalidateQueries({ queryKey: videoKeys.drafts() });
    void qc.invalidateQueries({ queryKey: ['feed'] });
    void qc.invalidateQueries({ queryKey: videoKeys.video(draft.id) });
    if (me) void qc.invalidateQueries({ queryKey: videoKeys.userVideos(me) });
  };

  const failure = (title: string, e: unknown) =>
    Alert.alert(title, e instanceof ApiError && e.code === 'content_blocked' ? (e.message ?? undefined) : undefined);

  async function postNow() {
    if (busy) return;
    setBusy('post');
    try {
      await publishDraft(draft.id);
      player.pause();
      refreshLists();
      showToast(t('publish.posted'), 'checkmark-circle');
      onClose();
    } catch (e) {
      failure(t('drafts.postFailed'), e);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (busy) return;
    setBusy('save');
    try {
      await updateDraft(draft.id, {
        description: caption,
        privacy,
        allow_comments: allowComments,
        allow_saving: allowSaving,
      });
      refreshLists();
      showToast(t('drafts.saved'), 'document-text');
      setEditing(false);
    } catch (e) {
      failure(t('drafts.saveFailed'), e);
    } finally {
      setBusy(null);
    }
  }

  function confirmDelete() {
    if (busy) return;
    Alert.alert(t('drafts.deleteTitle'), t('drafts.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('drafts.delete'),
        style: 'destructive',
        onPress: async () => {
          setBusy('delete');
          try {
            await deleteVideo(draft.id);
            player.pause();
            refreshLists();
            showToast(t('drafts.deleted'), 'trash');
            onClose();
          } catch (e) {
            failure(t('drafts.deleteFailed'), e);
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }

  const previewW = Math.min(width * (editing ? 0.32 : 0.6), 260);
  const previewH = Math.min(previewW * (16 / 9), height * 0.5);
  const shownCaption = (video?.description ?? draft.description ?? '').trim();
  const savedPrivacy = asPrivacy(video?.privacy);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={editing ? () => (reset(), setEditing(false)) : onClose}
          hitSlop={12}
          disabled={!!busy}
          accessibilityRole="button"
          accessibilityLabel={editing ? t('common.cancel') : t('legal.close')}
        >
          <Ionicons name={editing ? (I18nManager.isRTL ? 'chevron-forward' : 'chevron-back') : 'close'} size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]} accessibilityRole="header" numberOfLines={1}>
          {editing ? t('drafts.edit') : t('drafts.title')}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={editing ? styles.editTop : styles.viewTop}>
            <Pressable
              onPress={togglePlay}
              accessibilityRole="button"
              accessibilityLabel={t('drafts.togglePlay')}
              style={[styles.preview, { width: previewW, height: previewH, backgroundColor: colors.bg3 }]}
            >
              {src ? (
                <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} pointerEvents="none" />
              ) : null}
              {paused ? (
                <View style={styles.playIcon} pointerEvents="none">
                  <Ionicons name="play" size={36} color="#fff" />
                </View>
              ) : null}
            </Pressable>

            {editing ? (
              <View style={{ flex: 1 }}>
                <TextInput
                  value={caption}
                  onChangeText={(v) => setCaption(v.slice(0, MAX_CAPTION))}
                  placeholder={t('publish.captionPlaceholder')}
                  placeholderTextColor={colors.muted}
                  multiline
                  style={[styles.caption, { color: colors.text, textAlign: I18nManager.isRTL ? 'right' : 'left' }]}
                />
                <Text style={{ color: colors.muted, fontSize: 12, alignSelf: 'flex-end' }}>
                  {caption.length}/{MAX_CAPTION}
                </Text>
              </View>
            ) : (
              <View style={styles.summary}>
                <Text style={[styles.summaryCaption, { color: shownCaption ? colors.text : colors.muted }]} numberOfLines={4}>
                  {shownCaption || t('drafts.noCaption')}
                </Text>
                <View style={styles.summaryRow}>
                  <Ionicons name={PRIVACY_ICON[savedPrivacy]} size={16} color={colors.muted} />
                  <Text style={{ color: colors.muted, fontSize: 13 }}>{t(`publish.privacy_${savedPrivacy}`)}</Text>
                </View>
              </View>
            )}
          </View>

          {editing ? (
            <>
              <Section title={t('publish.whoCanWatch')}>
                {PRIVACIES.map((p) => (
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
              <Button title={t('drafts.save')} loading={busy === 'save'} disabled={!!busy} onPress={() => void save()} />
            </>
          ) : (
            <View style={styles.actions}>
              <Button title={t('drafts.postNow')} loading={busy === 'post'} disabled={!!busy} onPress={() => void postNow()} />
              <Button
                title={t('drafts.edit')}
                variant="secondary"
                disabled={!!busy}
                onPress={() => {
                  reset();
                  setEditing(true);
                }}
              />
              <Pressable
                onPress={confirmDelete}
                disabled={!!busy}
                style={styles.deleteBtn}
                accessibilityRole="button"
                accessibilityLabel={t('drafts.delete')}
              >
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
                <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 15 }}>{t('drafts.delete')}</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

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
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary }} accessibilityLabel={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 16, fontWeight: '800', flex: 1, textAlign: 'center' },
  content: { padding: 16, gap: 16 },
  viewTop: { alignItems: 'center', gap: 14 },
  editTop: { flexDirection: 'row', gap: 12 },
  preview: { borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  playIcon: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  summary: { alignSelf: 'stretch', gap: 6 },
  summaryCaption: { fontSize: 15, lineHeight: 21 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  caption: { minHeight: 110, fontSize: 15, textAlignVertical: 'top' },
  card: { borderRadius: 14, paddingHorizontal: 14 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  optionText: { flex: 1, fontSize: 15 },
  actions: { gap: 10 },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
});
