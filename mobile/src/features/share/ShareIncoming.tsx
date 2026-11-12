import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import type * as ImagePicker from 'expo-image-picker';
import { router, type Href } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, I18nManager, Pressable, StyleSheet, Text, View } from 'react-native';

import { chatKeys, fetchChats } from '@/api/chat';
import { showAlert } from '@/components/Dialog';
import { AppText, Button, Screen, TopBar } from '@/components/ui';
import { Avatar } from '@/features/chat/Avatar';
import { translateTitle } from '@/features/chat/format';
import { formatClock } from '@/features/stories/SoundPicker';
import { handOverMedia } from '@/lib/pendingCamera';
import { useTheme } from '@/providers/ThemeProvider';

// A photo or video shared into FLYP from another app (the gallery's Share
// menu, expo-share-intent). The person chooses: add it to their story, or
// send it in one of their chats. The file is handed to that screen the same
// way a photo is after a camera recovery (lib/pendingCamera.ts), so the
// story composer and the chat send it exactly as if it had been picked there.
// (Owner, Nov 2026: FLYP must appear when sharing from the gallery.)
export function ShareIncoming() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { shareIntent, resetShareIntent } = useShareIntentContext();
  const [choosingChat, setChoosingChat] = useState(false);

  const file = shareIntent?.files?.[0] ?? null;
  const isVideo = !!file?.mimeType?.startsWith('video/');
  const isImage = !!file?.mimeType?.startsWith('image/');

  // The picker's asset shape, which the story composer and the chat take.
  const asset = useMemo<ImagePicker.ImagePickerAsset | null>(() => {
    if (!file || (!isVideo && !isImage)) return null;
    const uri = file.path.startsWith('/') ? `file://${file.path}` : file.path;
    return {
      uri,
      type: isVideo ? 'video' : 'image',
      mimeType: file.mimeType,
      width: file.width ?? 0,
      height: file.height ?? 0,
      fileSize: file.size ?? undefined,
      fileName: file.fileName,
      duration: file.duration ?? null,
    } as ImagePicker.ImagePickerAsset;
  }, [file, isVideo, isImage]);

  const chats = useQuery({ queryKey: chatKeys.chats(), queryFn: fetchChats, enabled: choosingChat });
  const rows = useMemo(
    () =>
      (chats.data ?? [])
        .filter((c) => !c.is_request && (c.type === 'group' || c.others[0]))
        .map((c) => ({ id: c.id, title: translateTitle(c.title, t), avatar: c.avatar ?? null })),
    [chats.data, t],
  );

  const leave = (to: Href) => {
    resetShareIntent();
    router.replace(to);
  };

  const toStory = () => {
    if (!asset) return;
    handOverMedia({ screen: 'story', kind: isVideo ? 'video' : 'image' }, asset);
    leave('/stories/new');
  };

  const toChat = (chat: { id: string; title: string }) => {
    if (!asset) return;
    showAlert(t('sendTo.in.confirmTitle', { name: chat.title }), undefined, [
      { text: t('sendTo.in.cancel'), style: 'cancel' },
      {
        text: t('sendTo.in.send'),
        onPress: () => {
          handOverMedia({ screen: 'chat', chatId: chat.id }, asset);
          leave(`/chat/${chat.id}` as Href);
        },
      },
    ]);
  };

  const header = <TopBar title={t('sendTo.in.title')} />;

  if (!asset) {
    return (
      <Screen header={header}>
        <View style={styles.empty}>
          <Ionicons name="images-outline" size={44} color={colors.muted} />
          <AppText muted center>
            {file ? t('sendTo.in.unsupported') : t('sendTo.in.nothing')}
          </AppText>
          <Button title={t('sendTo.in.home')} variant="secondary" onPress={() => leave('/')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen header={header} scroll={false}>
      <View style={[styles.preview, { backgroundColor: colors.bg2 }]}>
        {isImage ? (
          <Image source={{ uri: asset.uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
        ) : (
          <View style={styles.videoMark}>
            <Ionicons name="videocam" size={40} color={colors.text} />
            {file?.duration ? <Text style={[styles.small, { color: colors.muted }]}>{formatClock(file.duration / 1000)}</Text> : null}
          </View>
        )}
      </View>

      {!choosingChat ? (
        <View style={styles.choices}>
          <Choice icon="add-circle" title={t('sendTo.in.story')} sub={t('sendTo.in.storySub')} onPress={toStory} />
          <Choice icon="chatbubbles" title={t('sendTo.in.chat')} sub={t('sendTo.in.chatSub')} onPress={() => setChoosingChat(true)} />
          <Pressable onPress={() => leave('/')} style={styles.cancel} accessibilityRole="button" hitSlop={8}>
            <Text style={{ color: colors.muted, fontWeight: '700' }}>{t('sendTo.in.cancel')}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.chatList}>
          <View style={styles.chatHead}>
            <Pressable onPress={() => setChoosingChat(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('sendTo.in.back')}>
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </Pressable>
            <AppText style={{ fontWeight: '800' }}>{t('sendTo.in.pickChat')}</AppText>
          </View>
          {chats.isLoading ? (
            <ActivityIndicator style={{ marginTop: 24 }} color={colors.primary} />
          ) : rows.length ? (
            <FlatList
              data={rows}
              keyExtractor={(r) => r.id}
              renderItem={({ item }) => (
                <Pressable onPress={() => toChat(item)} style={styles.row} accessibilityRole="button">
                  <Avatar uri={item.avatar} name={item.title} size={44} />
                  <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Ionicons name="send" size={18} color={colors.primary} style={I18nManager.isRTL ? { transform: [{ scaleX: -1 }] } : undefined} />
                </Pressable>
              )}
            />
          ) : (
            <AppText muted center style={{ marginTop: 24 }}>
              {t('sendTo.in.noChats')}
            </AppText>
          )}
        </View>
      )}
    </Screen>
  );
}

function Choice({ icon, title, sub, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.choice, { backgroundColor: colors.bg2, borderColor: colors.border }]} accessibilityRole="button">
      <View style={[styles.choiceIcon, { backgroundColor: colors.primary }]}>
        <Ionicons name={icon} size={22} color="#fff" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText style={{ fontWeight: '800' }}>{title}</AppText>
        <Text style={[styles.small, { color: colors.muted }]}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: 14, marginTop: 80, paddingHorizontal: 24 },
  preview: { height: 260, borderRadius: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  videoMark: { alignItems: 'center', gap: 6 },
  choices: { gap: 12 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  choiceIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  cancel: { alignSelf: 'center', paddingVertical: 14 },
  chatList: { flex: 1 },
  chatHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rowTitle: { flex: 1, fontSize: 15.5, fontWeight: '600' },
  small: { fontSize: 13 },
});
