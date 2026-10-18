import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchStoryViewers, storyKeys, type StoryViewer } from '@/api/stories';
import { AppText } from '@/components/ui';
import { PersonAvatar } from '@/features/map/PersonAvatar';
import { timeAgo } from '@/lib/timeAgo';
import { useTheme } from '@/providers/ThemeProvider';

// "Seen by" for one of your own stories, newest view first.
export function ViewersSheet({
  storyId,
  count,
  visible,
  onClose,
}: {
  storyId: string;
  count: number | null;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const viewers = useQuery({
    queryKey: storyKeys.viewers(storyId),
    queryFn: () => fetchStoryViewers(storyId),
    enabled: visible,
  });

  const open = useCallback(
    (id: string) => {
      onClose();
      router.push(`/user/${id}`);
    },
    [onClose],
  );
  const renderItem = useCallback(({ item }: { item: StoryViewer }) => <ViewerRow v={item} onOpen={open} />, [open]);

  const total = viewers.data?.length ?? count ?? 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('stories.close')}
      />
      <View style={[styles.panel, { backgroundColor: colors.bg, paddingBottom: insets.bottom + 8 }]} accessibilityViewIsModal>
        <View style={[styles.handle, { backgroundColor: colors.muted2 }]} />
        <View style={styles.head}>
          <Ionicons name="eye-outline" size={20} color={colors.text} />
          <AppText variant="label" style={{ flex: 1 }} accessibilityRole="header">
            {t('stories.seenByCount', { count: total })}
          </AppText>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('stories.close')} style={styles.iconBtn}>
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
        </View>
        {viewers.isLoading ? (
          <ActivityIndicator style={{ marginVertical: 32 }} color={colors.muted} />
        ) : viewers.isError ? (
          <Pressable onPress={() => void viewers.refetch()} style={styles.state} accessibilityRole="button">
            <AppText style={{ color: colors.danger }} center>
              {t('stories.viewersFailed')}
            </AppText>
          </Pressable>
        ) : !viewers.data?.length ? (
          <View style={styles.state}>
            <AppText muted center>
              {t('stories.noViewers')}
            </AppText>
          </View>
        ) : (
          <FlatList data={viewers.data} keyExtractor={(v) => v.viewer_id} renderItem={renderItem} style={{ maxHeight: 420 }} />
        )}
      </View>
    </Modal>
  );
}

const ViewerRow = memo(function ViewerRow({ v, onOpen }: { v: StoryViewer; onOpen: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const name = v.name || v.handle || '';
  return (
    <Pressable
      onPress={() => onOpen(v.viewer_id)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bg2 }]}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${timeAgo(v.viewed_at, t, i18n.language)}`}
    >
      <PersonAvatar uri={v.avatar_url} name={name} size={42} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <AppText numberOfLines={1} style={{ fontWeight: '700', flexShrink: 1 }}>
            {name}
          </AppText>
          {v.verified ? <Ionicons name="checkmark-circle" size={14} color={colors.accent} /> : null}
        </View>
        {v.handle ? (
          <AppText variant="small" muted numberOfLines={1}>
            @{v.handle}
          </AppText>
        ) : null}
      </View>
      <AppText variant="small" muted>
        {timeAgo(v.viewed_at, t, i18n.language)}
      </AppText>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  panel: { position: 'absolute', start: 0, end: 0, bottom: 0, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  handle: { width: 44, height: 5, borderRadius: 3, alignSelf: 'center', marginTop: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 4 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  state: { paddingVertical: 32, paddingHorizontal: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 8, minHeight: 58 },
});
