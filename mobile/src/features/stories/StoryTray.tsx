import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect, type Href } from 'expo-router';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { fetchProfile, profileKeys } from '@/api/profiles';
import { fetchStoryTray, storyKeys, type StoryTrayEntry } from '@/api/stories';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/providers/ThemeProvider';

import { StoryRing, type RingKind } from './StoryRing';

const SIZE = 64;
const ITEM_W = 76;

export const storyHref = (userId: string) => `/stories/${userId}` as Href;
export const NEW_STORY_HREF = '/stories/new' as Href;

type Props = {
  // 'overlay' sits on top of video (white text, shadow); 'surface' sits on
  // the app background.
  variant?: 'overlay' | 'surface';
  style?: StyleProp<ViewStyle>;
};

type Item = { kind: 'me'; entry: StoryTrayEntry | null } | { kind: 'other'; entry: StoryTrayEntry } | { kind: 'skeleton'; key: string };

// Client notes 22 / 25 / 31: the row of story circles. "Your story" is
// always first, with a + to post; everyone else follows in the order
// fetch_story_tray returns (unseen first).
export function StoryTray({ variant = 'surface', style }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { session } = useAuth();
  const me = session?.user.id ?? null;

  const tray = useQuery({ queryKey: storyKeys.tray(), queryFn: () => fetchStoryTray(), staleTime: 30_000 });
  const profile = useQuery({ queryKey: profileKeys.profile(me ?? ''), queryFn: () => fetchProfile(me), enabled: !!me });

  // Coming back from the viewer or the composer, the rings may have changed.
  const { refetch } = tray;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const items = useMemo<Item[]>(() => {
    const list = tray.data ?? [];
    const mine = list.find((e) => e.is_me) ?? null;
    const others: Item[] = list.filter((e) => !e.is_me).map((e) => ({ kind: 'other', entry: e }));
    const skeletons: Item[] = tray.isLoading
      ? ['a', 'b', 'c', 'd'].map((k) => ({ kind: 'skeleton', key: k }))
      : [];
    return [{ kind: 'me', entry: mine }, ...others, ...skeletons];
  }, [tray.data, tray.isLoading]);

  const overlay = variant === 'overlay';
  const textColor = overlay ? '#fff' : colors.text;
  const gap = overlay ? 'rgba(0,0,0,0.35)' : colors.bg;

  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      if (item.kind === 'skeleton') {
        return (
          <View style={styles.item} importantForAccessibility="no-hide-descendants">
            <View style={[styles.skeleton, { backgroundColor: overlay ? 'rgba(255,255,255,0.18)' : colors.bg3 }]} />
          </View>
        );
      }
      if (item.kind === 'me') {
        return (
          <MyStory
            entry={item.entry}
            avatar={profile.data?.avatar_url ?? null}
            name={profile.data?.name ?? null}
            textColor={textColor}
            gap={gap}
            overlay={overlay}
          />
        );
      }
      return <TrayItem entry={item.entry} textColor={textColor} gap={gap} overlay={overlay} />;
    },
    [profile.data?.avatar_url, profile.data?.name, textColor, gap, overlay, colors.bg3],
  );

  return (
    <FlatList
      horizontal
      data={items}
      keyExtractor={(i) => (i.kind === 'skeleton' ? `sk-${i.key}` : i.kind === 'me' ? 'me' : i.entry.user_id)}
      renderItem={renderItem}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
      style={[styles.list, style]}
      accessibilityLabel={t('stories.trayA11y')}
      initialNumToRender={6}
      windowSize={3}
    />
  );
}

const MyStory = memo(function MyStory({
  entry,
  avatar,
  name,
  textColor,
  gap,
  overlay,
}: {
  entry: StoryTrayEntry | null;
  avatar: string | null;
  name: string | null;
  textColor: string;
  gap: string;
  overlay: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const has = !!entry && entry.story_count > 0;
  const open = () => router.push(has && entry ? storyHref(entry.user_id) : NEW_STORY_HREF);
  return (
    <View style={styles.item}>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={has ? t('stories.viewYourStory') : t('stories.addStory')}
      >
        <StoryRing uri={entry?.avatar_url ?? avatar} name={entry?.name ?? name} size={SIZE} kind={has ? 'seen' : 'none'} gap={gap} />
      </Pressable>
      <Pressable
        onPress={() => router.push(NEW_STORY_HREF)}
        hitSlop={8}
        style={[styles.plus, { backgroundColor: colors.primary, borderColor: overlay ? '#000' : colors.bg }]}
        accessibilityRole="button"
        accessibilityLabel={t('stories.addStory')}
      >
        <Ionicons name="add" size={16} color={colors.onPrimary} />
      </Pressable>
      <Text style={[styles.name, { color: textColor }, overlay && styles.shadow]} numberOfLines={1}>
        {t('stories.yourStory')}
      </Text>
    </View>
  );
});

const TrayItem = memo(function TrayItem({
  entry,
  textColor,
  gap,
  overlay,
}: {
  entry: StoryTrayEntry;
  textColor: string;
  gap: string;
  overlay: boolean;
}) {
  const { t } = useTranslation();
  const name = entry.name || entry.handle || '';
  const kind: RingKind = entry.has_unseen ? (entry.has_close_friends ? 'closeFriends' : 'unseen') : 'seen';
  return (
    <Pressable
      onPress={() => router.push(storyHref(entry.user_id))}
      style={styles.item}
      accessibilityRole="button"
      accessibilityLabel={t(entry.has_unseen ? 'stories.itemA11yNew' : 'stories.itemA11ySeen', { name })}
    >
      <StoryRing uri={entry.avatar_url} name={name} size={SIZE} kind={kind} gap={gap} />
      <Text
        style={[styles.name, { color: textColor, opacity: entry.has_unseen ? 1 : 0.75 }, overlay && styles.shadow]}
        numberOfLines={1}
      >
        {name}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  list: { flexGrow: 0 },
  content: { paddingHorizontal: 10, gap: 4 },
  item: { width: ITEM_W, alignItems: 'center', paddingVertical: 6 },
  skeleton: { width: SIZE, height: SIZE, borderRadius: SIZE / 2 },
  plus: {
    position: 'absolute',
    top: 6 + SIZE - 22,
    end: (ITEM_W - SIZE) / 2 - 2,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { marginTop: 4, fontSize: 12, fontWeight: '600', maxWidth: ITEM_W - 4, textAlign: 'center' },
  shadow: { textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
});
