import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
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
import { canonicalKey, type ChatTheme, PHOTO_KEY, THEMES, themeFor } from './themes';

const WALLPAPER_WIDTH = 1080;
const COLUMNS = 3;
const GAP = 10;

// Chat theme picker (client: "chat background options, like Instagram").
// Each tile is a small picture of the theme (background, pattern, both
// bubble styles); the top shows the chat as it will look. The choice is
// shared: everyone in the chat sees it, and a line in the chat says who
// changed it (0149).
export function ChatThemeScreen({ chatId }: { chatId: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const qc = useQueryClient();
  const info = useQuery({ queryKey: chatKeys.info(chatId), queryFn: () => fetchChatInfo(chatId) });

  const current = info.data ? (themeFor(info.data.theme, info.data.wallpaper) ? canonicalKey(info.data.theme) : null) : null;
  // undefined = nothing picked yet, so the current theme shows as selected.
  const [draft, setDraft] = useState<string | null | undefined>(undefined);
  const [photo, setPhoto] = useState<LocalMedia | null>(null);
  const selected = draft === undefined ? current : draft;
  const previewWallpaper = selected === PHOTO_KEY ? photo?.uri ?? info.data?.wallpaper ?? null : null;
  const changed = draft !== undefined && (draft !== current || (draft === PHOTO_KEY && !!photo));
  const tileW = Math.floor((width - 32 - GAP * (COLUMNS - 1)) / COLUMNS);

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
  const previewTheme = themeFor(selected, previewWallpaper);

  return (
    <Screen scroll={false} contentStyle={styles.screen} header={<TopBar title={t('chatTheme.title')} />}>
      <View style={[styles.preview, { borderBottomColor: colors.border, backgroundColor: colors.bg }]} accessibilityLabel={t('chatTheme.preview')}>
        <ChatBackground theme={selected} wallpaper={previewWallpaper} />
        <View style={styles.previewBody} importantForAccessibility="no-hide-descendants">
          <SampleBubbles theme={previewTheme} size="large" />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        <Text style={[styles.note, { color: colors.muted }]}>{t('chatTheme.sharedNote')}</Text>

        <View style={styles.grid}>
          <Tile width={tileW} label={t('chatTheme.default')} selected={selected == null} onPress={() => setDraft(null)}>
            <ChatBackground theme={null} />
            <SampleBubbles theme={null} size="small" />
          </Tile>
          <Tile
            width={tileW}
            label={t('chatTheme.photo')}
            selected={selected === PHOTO_KEY}
            onPress={() => (hasPhoto && selected !== PHOTO_KEY ? setDraft(PHOTO_KEY) : void pickPhoto())}
          >
            {hasPhoto ? (
              <Image source={{ uri: photo?.uri ?? info.data.wallpaper ?? undefined }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: colors.bg2 }]}>
                <Ionicons name="image-outline" size={28} color={colors.muted} />
              </View>
            )}
          </Tile>
          {THEMES.map((th) => (
            <Tile key={th.key} width={tileW} label={t(th.name)} selected={selected === th.key} onPress={() => setDraft(th.key)}>
              <ChatBackground theme={th.key} />
              <SampleBubbles theme={th} size="small" />
            </Tile>
          ))}
        </View>
        {hasPhoto ? (
          <Pressable onPress={() => void pickPhoto()} style={styles.linkRow} accessibilityRole="button" hitSlop={8}>
            <Ionicons name="images-outline" size={18} color={colors.primary2} />
            <Text style={[styles.link, { color: colors.primary2 }]}>{t('chatTheme.changePhoto')}</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border, paddingBottom: 12 + insets.bottom }]}>
        <Button title={t('chatTheme.apply')} onPress={() => apply.mutate()} disabled={!changed} loading={apply.isPending} />
      </View>
    </Screen>
  );
}

// A received and a sent bubble in the theme's own colours.
const SampleBubbles = memo(function SampleBubbles({ theme, size }: { theme: ChatTheme | null; size: 'small' | 'large' }) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const small = size === 'small';
  const mine = theme ? theme.mine : [colors.primary];
  const theirsBg = theme ? theme.theirs : isDark ? colors.bg3 : colors.bg2;
  const theirsFg = theme ? theme.theirsText : colors.text;
  const mineFg = theme ? theme.mineText : colors.onPrimary;
  return (
    <View style={small ? styles.sampleSmall : styles.sampleLarge}>
      <View style={[small ? styles.bubbleSmall : styles.bubbleLarge, styles.theirs, { backgroundColor: theirsBg }]}>
        {small ? null : <Text style={[styles.bubbleText, { color: theirsFg }]}>{t('chatTheme.sampleTheirs')}</Text>}
      </View>
      <View style={[small ? styles.bubbleSmall : styles.bubbleLarge, styles.mine, styles.clip]}>
        {mine.length > 1 ? (
          <LinearGradient colors={mine as [string, string, ...string[]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: mine[0] }]} />
        )}
        {small ? null : <Text style={[styles.bubbleText, { color: mineFg }]}>{t('chatTheme.sampleMine')}</Text>}
      </View>
    </View>
  );
});

function Tile({
  width,
  label,
  selected,
  onPress,
  children,
}: {
  width: number;
  label: string;
  selected: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.tileWrap, { width }]} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={label}>
      <View
        style={[
          styles.tile,
          { height: Math.round(width * 1.35), borderColor: selected ? colors.primary : colors.border, backgroundColor: colors.bg },
          selected && styles.tileOn,
        ]}
      >
        {children}
        {selected ? (
          <View style={[styles.check, { backgroundColor: colors.primary, borderColor: colors.bg }]}>
            <Ionicons name="checkmark" size={14} color={colors.onPrimary} />
          </View>
        ) : null}
      </View>
      <Text style={[styles.tileLabel, { color: colors.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: 0, paddingVertical: 0 },
  loading: { marginTop: 60 },
  center: { alignItems: 'center', justifyContent: 'center' },
  preview: { height: 210, overflow: 'hidden', borderBottomWidth: StyleSheet.hairlineWidth },
  previewBody: { flex: 1, justifyContent: 'center', paddingHorizontal: 16 },
  sampleLarge: { gap: 8 },
  sampleSmall: { flex: 1, justifyContent: 'flex-end', padding: 8, gap: 6 },
  bubbleLarge: { maxWidth: '75%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  bubbleSmall: { width: '62%', height: 16, borderRadius: 8 },
  theirs: { alignSelf: 'flex-start', borderBottomStartRadius: 5 },
  mine: { alignSelf: 'flex-end', borderBottomEndRadius: 5 },
  clip: { overflow: 'hidden' },
  bubbleText: { fontSize: 15, textAlign: 'left' },
  list: { padding: 16, paddingBottom: 24 },
  note: { fontSize: 13, marginBottom: 14, textAlign: 'left' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tileWrap: { gap: 6, marginBottom: 6 },
  tile: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  tileOn: { borderWidth: 3 },
  tileLabel: { fontSize: 12.5, fontWeight: '600', textAlign: 'center' },
  check: {
    position: 'absolute',
    top: 6,
    end: 6,
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
