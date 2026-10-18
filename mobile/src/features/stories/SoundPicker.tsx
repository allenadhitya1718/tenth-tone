import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, I18nManager, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchSounds, soundKeys, type Sound } from '@/api/sounds';
import { AppText } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';

export const formatClock = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Client note 22: a song for a photo story, from the most used sounds.
// Each row can be previewed before it is chosen.
export function SoundPicker({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (s: Sound) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const sounds = useQuery({ queryKey: soundKeys.list(), queryFn: fetchSounds, enabled: visible });

  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const close = useCallback(() => {
    player.pause();
    setPreviewId(null);
    onClose();
  }, [player, onClose]);

  const toggle = useCallback(
    (s: Sound) => {
      if (previewId === s.id) {
        player.pause();
        setPreviewId(null);
        return;
      }
      if (!s.audio_url) return;
      player.replace({ uri: s.audio_url });
      player.play();
      setPreviewId(s.id);
    },
    [player, previewId],
  );

  const list = useMemo(() => {
    const all = (sounds.data ?? []).filter((s) => !!s.audio_url);
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((s) => `${s.title ?? ''} ${s.author_name ?? ''}`.toLowerCase().includes(needle));
  }, [sounds.data, q]);

  const choose = useCallback(
    (s: Sound) => {
      player.pause();
      setPreviewId(null);
      onPick(s);
    },
    [player, onPick],
  );

  const renderItem = useCallback(
    ({ item }: { item: Sound }) => (
      <SoundRow
        sound={item}
        playing={previewId === item.id}
        loading={previewId === item.id && !status.isLoaded}
        onPreview={toggle}
        onPick={choose}
      />
    ),
    [previewId, status.isLoaded, toggle, choose],
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} presentationStyle="pageSheet">
      <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top > 30 ? 12 : insets.top + 8 }]}>
        <View style={styles.head}>
          <AppText variant="label" style={{ flex: 1 }} accessibilityRole="header">
            {t('stories.chooseSong')}
          </AppText>
          <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('stories.close')} style={styles.iconBtn}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        </View>
        <View style={[styles.search, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={t('stories.searchSongs')}
            placeholderTextColor={colors.muted}
            style={[styles.searchInput, { color: colors.text, textAlign: I18nManager.isRTL ? 'right' : 'left' }]}
            accessibilityLabel={t('stories.searchSongs')}
            returnKeyType="search"
          />
        </View>
        {sounds.isLoading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.muted} />
        ) : !list.length ? (
          <AppText muted center style={{ marginTop: 40, paddingHorizontal: 24 }}>
            {q ? t('stories.noSongsMatch') : t('stories.noSongs')}
          </AppText>
        ) : (
          <FlatList
            data={list}
            keyExtractor={(s) => s.id}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
            initialNumToRender={12}
          />
        )}
      </View>
    </Modal>
  );
}

const SoundRow = memo(function SoundRow({
  sound,
  playing,
  loading,
  onPreview,
  onPick,
}: {
  sound: Sound;
  playing: boolean;
  loading: boolean;
  onPreview: (s: Sound) => void;
  onPick: (s: Sound) => void;
}) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const tint = isDark ? colors.primary2 : colors.primary;
  const title = sound.title || t('stories.untitledSong');
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Pressable
        onPress={() => onPreview(sound)}
        style={[styles.cover, { backgroundColor: colors.bg3 }]}
        accessibilityRole="button"
        accessibilityLabel={playing ? t('stories.stopPreview') : t('stories.previewSong', { title })}
      >
        {sound.cover_url ? <Image source={{ uri: sound.cover_url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
        <View style={styles.coverIcon}>
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Ionicons name={playing ? 'pause' : 'play'} size={18} color="#fff" />
          )}
        </View>
      </Pressable>
      <Pressable
        onPress={() => onPick(sound)}
        style={styles.rowText}
        accessibilityRole="button"
        accessibilityLabel={t('stories.useSongA11y', { title })}
      >
        <AppText numberOfLines={1} style={{ fontWeight: '700' }}>
          {title}
        </AppText>
        <AppText variant="small" muted numberOfLines={1}>
          {[sound.author_name, sound.duration ? formatClock(sound.duration) : null].filter(Boolean).join(' · ')}
        </AppText>
      </Pressable>
      <Pressable onPress={() => onPick(sound)} hitSlop={8} accessibilityElementsHidden importantForAccessibility="no">
        <AppText style={{ color: tint, fontWeight: '700' }}>{t('stories.use')}</AppText>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15, height: '100%' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cover: { width: 52, height: 52, borderRadius: 10, overflow: 'hidden' },
  coverIcon: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)' },
  rowText: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' },
});
