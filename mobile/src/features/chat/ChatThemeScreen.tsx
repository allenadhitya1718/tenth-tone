import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { chatKeys, fetchChatInfo } from '@/api/chat';
import { chatThemeErrorKey, setChatTheme } from '@/api/chatTheme';
import { groupQueryKeys } from '@/api/groups';
import type { LocalMedia } from '@/api/upload';
import { showAlert } from '@/components/Dialog';
import { NotFoundState } from '@/components/NotFoundState';
import { showToast } from '@/components/Toast';
import { Button, Screen, TopBar } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';

import { ChatBackground } from './ChatBackground';
import { type ChatTheme, DEFAULT_THEME, GRADIENT_THEMES, PHOTO_KEY, SOLID_THEMES, themeFor } from './themes';

const WALLPAPER_WIDTH = 1080;

// Chat theme picker (client: "chat background options, like Instagram").
// The choice is shared: everyone in the chat sees it, and a line in the chat
// says who changed it (0149). Opened from the thread header and Group Info.
export function ChatThemeScreen({ chatId }: { chatId: string }) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const info = useQuery({ queryKey: chatKeys.info(chatId), queryFn: () => fetchChatInfo(chatId) });

  const current = info.data ? themeFor(info.data.theme, info.data.wallpaper).key : null;
  // undefined = nothing picked yet, so the current theme shows as selected.
  const [draft, setDraft] = useState<string | null | undefined>(undefined);
  const [photo, setPhoto] = useState<LocalMedia | null>(null);
  const selected = draft === undefined ? current : draft;
  const previewWallpaper = selected === PHOTO_KEY ? photo?.uri ?? info.data?.wallpaper ?? null : null;
  const changed = draft !== undefined && (draft !== current || (draft === PHOTO_KEY && !!photo));

  const apply = useMutation({
    mutationFn: () =>
      setChatTheme(chatId, selected ?? null, { photo: selected === PHOTO_KEY ? photo : null, wallpaperUrl: info.data?.wallpaper }),
    onSuccess: () => {
      for (const key of groupQueryKeys(chatId)) void qc.invalidateQueries({ queryKey: key, exact: true });
      showToast(t('chatTheme.saved'));
      router.back();
    },
    onError: (e) => {
      const key = chatThemeErrorKey(e);
      if (key === 'chatTheme.err.generic') console.warn('chat theme: failed:', (e as Error)?.message ?? e);
      showAlert(t(key));
    },
  });

  const pickPhoto = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [9, 16],
        quality: 1,
        exif: false,
      });
      const a = res.canceled ? null : res.assets[0];
      if (!a) return;
      // A phone-width JPEG keeps the upload well under the bucket's 5 MB.
      const ctx = ImageManipulator.manipulate(a.uri);
      if (a.width > WALLPAPER_WIDTH) ctx.resize({ width: WALLPAPER_WIDTH });
      const out = await (await ctx.renderAsync()).saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
      setPhoto({ uri: out.uri, mimeType: 'image/jpeg', name: 'wallpaper.jpg' });
      setDraft(PHOTO_KEY);
    } catch (e) {
      console.warn('chat theme: photo pick failed:', (e as Error)?.message ?? e);
      showAlert(t('chatTheme.err.photoFailed'));
    }
  };

  if (info.isLoading) {
    return (
      <Screen scroll={false} header={<TopBar title={t('chatTheme.title')} />}>
        <ActivityIndicator style={styles.loading} color={colors.primary} />
      </Screen>
    );
  }
  if (info.isError || !info.data || info.data.missing) {
    return <NotFoundState icon="chatbubbles-outline" title={t('fix4.notFoundChatTitle')} body={t('fix4.notFoundChatBody')} />;
  }

  const hasPhoto = !!(photo || info.data.wallpaper);

  return (
    <Screen scroll={false} contentStyle={styles.screen} header={<TopBar title={t('chatTheme.title')} />}>
      <View style={[styles.preview, { borderBottomColor: colors.border }]} accessibilityLabel={t('chatTheme.preview')}>
        <ChatBackground theme={selected} wallpaper={previewWallpaper} />
        <View style={styles.previewBody} importantForAccessibility="no-hide-descendants">
          <View style={[styles.bubble, styles.bubbleTheirs, { backgroundColor: isDark ? colors.bg3 : colors.bg }]}>
            <Text style={[styles.bubbleText, { color: colors.text }]}>{t('chatTheme.sampleTheirs')}</Text>
          </View>
          <View style={[styles.bubble, styles.bubbleMine, { backgroundColor: colors.primary }]}>
            <Text style={[styles.bubbleText, { color: colors.onPrimary }]}>{t('chatTheme.sampleMine')}</Text>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        <Text style={[styles.note, { color: colors.muted }]}>{t('chatTheme.sharedNote')}</Text>

        <View style={styles.grid}>
          <Tile theme={DEFAULT_THEME} selected={selected == null} onPress={() => setDraft(null)} />
          <Pressable
            onPress={() => (hasPhoto && selected !== PHOTO_KEY ? setDraft(PHOTO_KEY) : void pickPhoto())}
            style={styles.tileWrap}
            accessibilityRole="button"
            accessibilityState={{ selected: selected === PHOTO_KEY }}
            accessibilityLabel={hasPhoto ? t('chatTheme.photo') : t('chatTheme.choosePhoto')}
          >
            <View style={[styles.tile, { backgroundColor: colors.bg2, borderColor: selected === PHOTO_KEY ? colors.primary : colors.border }, selected === PHOTO_KEY && styles.tileOn]}>
              {hasPhoto ? (
                <Image source={{ uri: photo?.uri ?? info.data.wallpaper ?? undefined }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <Ionicons name="image-outline" size={26} color={colors.muted} />
              )}
              {selected === PHOTO_KEY ? <Check /> : null}
            </View>
            <Text style={[styles.tileLabel, { color: colors.text }]} numberOfLines={1}>
              {t('chatTheme.photo')}
            </Text>
          </Pressable>
        </View>
        {hasPhoto ? (
          <Pressable onPress={() => void pickPhoto()} style={styles.linkRow} accessibilityRole="button" hitSlop={8}>
            <Ionicons name="images-outline" size={18} color={colors.primary2} />
            <Text style={[styles.link, { color: colors.primary2 }]}>{t('chatTheme.changePhoto')}</Text>
          </Pressable>
        ) : null}

        <Text style={[styles.section, { color: colors.muted }]} accessibilityRole="header">
          {t('chatTheme.colours')}
        </Text>
        <View style={styles.grid}>
          {SOLID_THEMES.map((th) => (
            <Tile key={th.key} theme={th} selected={selected === th.key} onPress={() => setDraft(th.key)} />
          ))}
        </View>

        <Text style={[styles.section, { color: colors.muted }]} accessibilityRole="header">
          {t('chatTheme.gradients')}
        </Text>
        <View style={styles.grid}>
          {GRADIENT_THEMES.map((th) => (
            <Tile key={th.key} theme={th} selected={selected === th.key} onPress={() => setDraft(th.key)} />
          ))}
        </View>
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border, paddingBottom: 12 + insets.bottom }]}>
        <Button title={t('chatTheme.apply')} onPress={() => apply.mutate()} disabled={!changed} loading={apply.isPending} />
      </View>
    </Screen>
  );
}

function Tile({ theme, selected, onPress }: { theme: ChatTheme; selected: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const palette = isDark ? theme.dark : theme.light;
  return (
    <Pressable
      onPress={onPress}
      style={styles.tileWrap}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={t(theme.name)}
    >
      <View
        style={[
          styles.tile,
          { backgroundColor: theme.kind === 'solid' ? palette[0] : colors.bg, borderColor: selected ? colors.primary : colors.border },
          selected && styles.tileOn,
        ]}
      >
        {theme.kind === 'gradient' ? <LinearGradient colors={[palette[0], palette[1]]} style={StyleSheet.absoluteFill} /> : null}
        {theme.kind === 'doodle' ? <ChatBackground theme={null} /> : null}
        {selected ? <Check /> : null}
      </View>
      <Text style={[styles.tileLabel, { color: colors.text }]} numberOfLines={1}>
        {t(theme.name)}
      </Text>
    </Pressable>
  );
}

function Check() {
  const { colors } = useTheme();
  return (
    <View style={[styles.check, { backgroundColor: colors.primary, borderColor: colors.bg }]}>
      <Ionicons name="checkmark" size={14} color={colors.onPrimary} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: 0, paddingVertical: 0 },
  loading: { marginTop: 60 },
  preview: { height: 190, overflow: 'hidden', borderBottomWidth: StyleSheet.hairlineWidth },
  previewBody: { flex: 1, justifyContent: 'center', paddingHorizontal: 16, gap: 8 },
  bubble: { maxWidth: '75%', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleTheirs: { alignSelf: 'flex-start', borderBottomStartRadius: 5 },
  bubbleMine: { alignSelf: 'flex-end', borderBottomEndRadius: 5 },
  bubbleText: { fontSize: 15, textAlign: 'left' },
  list: { padding: 16, paddingBottom: 24 },
  note: { fontSize: 13, marginBottom: 14, textAlign: 'left' },
  section: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 18, marginBottom: 10, textAlign: 'left' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tileWrap: { width: 72, alignItems: 'center', gap: 6 },
  tile: {
    width: 64,
    height: 64,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileOn: { borderWidth: 3 },
  tileLabel: { fontSize: 12, textAlign: 'center' },
  check: {
    position: 'absolute',
    bottom: 4,
    end: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, alignSelf: 'flex-start' },
  link: { fontSize: 14, fontWeight: '600' },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
