import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { fetchUserStories, storyKeys } from '@/api/stories';
import { useTheme } from '@/providers/ThemeProvider';

import { StoryRing, type RingKind } from './StoryRing';
import { NEW_STORY_HREF, storyHref } from './StoryTray';

// The big avatar on a profile, with stories (the tray left the home feed):
//   * a gradient ring when the person has active stories the viewer may see
//     (fetch_user_stories already applies audience, blocks and expiry):
//     brand gradient while something is unseen, green when the unseen ones
//     include a close-friends story, a thin grey ring once all are seen. Your
//     own stories always count as seen server-side, so your own ring shows
//     the gradient whenever you have an active story.
//   * tap: opens the stories; on your own profile with none, the composer.
//   * own profile: a "+" badge that always opens the composer.
export const ProfileStoryAvatar = memo(function ProfileStoryAvatar({
  userId,
  isMe,
  uri,
  name,
  size = 104,
  style,
}: {
  userId: string;
  isMe: boolean;
  uri: string | null | undefined;
  name: string | null | undefined;
  // Outer size including the ring; the photo is size - 8.
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const stories = useQuery({
    queryKey: storyKeys.user(userId),
    queryFn: () => fetchUserStories(userId),
    enabled: !!userId,
    staleTime: 30_000,
    // No stories table yet, or not visible: just no ring.
    retry: false,
  });

  // Back from the viewer or the composer, the ring may have changed.
  const { refetch } = stories;
  useFocusEffect(
    useCallback(() => {
      if (userId) void refetch();
    }, [refetch, userId]),
  );

  const list = stories.data;
  const has = !!list && list.length > 0;
  const kind = useMemo<RingKind>(() => {
    if (!list || list.length === 0) return 'none';
    if (isMe) return 'unseen';
    const unseen = list.filter((s) => !s.seen);
    if (unseen.length === 0) return 'seen';
    return unseen.some((s) => s.audience === 'close_friends') ? 'closeFriends' : 'unseen';
  }, [list, isMe]);

  const label = name || '';
  const open = () => {
    if (has) router.push(storyHref(userId));
    else if (isMe) router.push(NEW_STORY_HREF);
  };
  const pressable = has || isMe;
  const a11y = isMe
    ? has
      ? t('stories.viewYourStory')
      : t('stories.addStory')
    : t(kind === 'seen' ? 'stories.itemA11ySeen' : 'stories.itemA11yNew', { name: label });

  const badge = 28;
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Pressable
        onPress={open}
        disabled={!pressable}
        accessibilityRole={pressable ? 'button' : 'image'}
        accessibilityLabel={pressable ? a11y : label}
      >
        <StoryRing uri={uri} name={name} size={size} kind={kind} gap={colors.bg} />
      </Pressable>
      {isMe ? (
        <Pressable
          onPress={() => router.push(NEW_STORY_HREF)}
          hitSlop={10}
          style={[
            styles.plus,
            {
              width: badge,
              height: badge,
              borderRadius: badge / 2,
              backgroundColor: colors.primary,
              borderColor: colors.bg,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('fix4.addNewStory')}
        >
          <Ionicons name="add" size={18} color={colors.onPrimary} />
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  plus: {
    position: 'absolute',
    bottom: 2,
    end: 2,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
