import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import {
  cancelFollowRequest,
  follow,
  hasRequestedFollow,
  isFollowing,
  profileKeys,
  unfollow,
} from '@/api/profiles';
import { Alert } from '@/components/Dialog';
import { videoKeys } from '@/api/videos';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/providers/ThemeProvider';

type State = 'following' | 'requested' | 'none';

// Shares its cache keys with the profile screen, so following someone here
// is already reflected when their profile opens, and the other way round.
export const FollowButton = memo(function FollowButton({ userId, name }: { userId: string; name?: string | null }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { session } = useAuth();
  const me = session?.user.id;
  const qc = useQueryClient();
  const enabled = !!me && me !== userId;

  const following = useQuery({
    queryKey: profileKeys.isFollowing(userId),
    queryFn: () => isFollowing(userId),
    enabled,
    staleTime: 60_000,
  });
  // Only worth asking when not already following.
  const requested = useQuery({
    queryKey: profileKeys.hasRequestedFollow(userId),
    queryFn: () => hasRequestedFollow(userId),
    enabled: enabled && following.data === false,
    staleTime: 60_000,
  });

  const toggle = useMutation({
    mutationFn: async (from: State): Promise<State> => {
      if (from === 'following') {
        await unfollow(userId);
        return 'none';
      }
      if (from === 'requested') {
        await cancelFollowRequest(userId);
        return 'none';
      }
      // A private account turns this into a request; render what came back.
      return follow(userId);
    },
    onSuccess: (next) => {
      qc.setQueryData(profileKeys.isFollowing(userId), next === 'following');
      qc.setQueryData(profileKeys.hasRequestedFollow(userId), next === 'requested');
      void qc.invalidateQueries({ queryKey: profileKeys.profile(userId) });
      void qc.invalidateQueries({ queryKey: videoKeys.feed('following') });
      if (me) {
        void qc.invalidateQueries({ queryKey: profileKeys.profile(me) });
        void qc.invalidateQueries({ queryKey: profileKeys.following(me) });
      }
    },
    onError: () => Alert.alert(t('discover.follow.failed')),
  });

  // Colour styles are built once per theme, not on every render of every row.
  const tone = useMemo(
    () => ({
      on: [styles.btn, { backgroundColor: colors.primary }],
      off: [styles.btn, { backgroundColor: colors.bg3, borderColor: colors.border }],
      onText: [styles.text, { color: colors.onPrimary }],
      offText: [styles.text, { color: colors.text }],
    }),
    [colors],
  );

  if (!enabled) return null;

  const settled: State = following.data ? 'following' : requested.data ? 'requested' : 'none';
  // While the request is in flight, show where it is going.
  const state: State = toggle.isPending ? (toggle.variables === 'none' ? 'following' : 'none') : settled;
  const primary = state === 'none';
  const label = t(state === 'following' ? 'discover.follow.following' : state === 'requested' ? 'discover.follow.requested' : 'discover.follow.follow');

  return (
    <Pressable
      onPress={() => {
        // Withdrawing a request is not undone by tapping again (it is only
        // asked again from scratch), so it is confirmed first.
        if (settled === 'requested') {
          Alert.alert(t('discover.follow.cancelRequestTitle'), t('discover.follow.cancelRequestBody', { name: name ?? '' }), [
            { text: t('discover.follow.cancelRequestKeep'), style: 'cancel' },
            { text: t('discover.follow.cancelRequestConfirm'), style: 'destructive', onPress: () => toggle.mutate(settled) },
          ]);
          return;
        }
        toggle.mutate(settled);
      }}
      disabled={toggle.isPending || following.isLoading}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={name ? `${label}, ${name}` : label}
      accessibilityState={{ busy: toggle.isPending, selected: !primary }}
      style={primary ? tone.on : tone.off}
    >
      {following.isLoading ? (
        <ActivityIndicator size="small" color={colors.muted} />
      ) : (
        <Text style={primary ? tone.onText : tone.offText} numberOfLines={1}>
          {label}
        </Text>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  btn: {
    minWidth: 96,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontSize: 13.5, fontWeight: '700' },
});
