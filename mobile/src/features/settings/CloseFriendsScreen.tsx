import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { addCloseFriend, fetchCloseFriends, fetchFollowing, profileKeys, removeCloseFriend } from '@/api/profiles';
import type { UserSummary } from '@/api/types';
import { AppText, TextField } from '@/components/ui';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/providers/ThemeProvider';

import { PersonRow, showError, tick } from './components';
import { ListScreen } from './PeopleLists';

type Person = Pick<UserSummary, 'id' | 'name' | 'handle' | 'avatar_url'>;

export function CloseFriendsScreen() {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const qc = useQueryClient();
  const myId = useAuth().session?.user.id ?? null;
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const following = useQuery({
    queryKey: profileKeys.following(myId ?? ''),
    queryFn: () => fetchFollowing(myId),
    enabled: !!myId,
  });
  const current = useQuery({ queryKey: profileKeys.closeFriends(), queryFn: fetchCloseFriends });

  const chosen = useMemo(() => new Set((current.data ?? []).map((p) => p.id)), [current.data]);

  // Someone already on the list whom you have since unfollowed stays
  // visible, or you could never take them off.
  const people = useMemo<Person[]>(() => {
    const base: Person[] = [...(following.data ?? [])];
    for (const p of current.data ?? []) if (!base.some((x) => x.id === p.id)) base.push(p);
    const needle = q.trim().toLowerCase().replace(/^@/, '');
    if (!needle) return base;
    return base.filter(
      (p) => (p.name ?? '').toLowerCase().includes(needle) || (p.handle ?? '').toLowerCase().includes(needle),
    );
  }, [following.data, current.data, q]);

  async function flip(p: Person) {
    const on = chosen.has(p.id);
    tick();
    setBusyId(p.id);
    try {
      if (on) await removeCloseFriend(p.id);
      else await addCloseFriend(p.id);
      qc.setQueryData<UserSummary[]>(profileKeys.closeFriends(), (rows) =>
        on ? (rows ?? []).filter((r) => r.id !== p.id) : [...(rows ?? []), { ...p }],
      );
      qc.invalidateQueries({ queryKey: profileKeys.closeFriends() });
    } catch (e) {
      showError(t, e, 'settings2.common.updateFailed');
    } finally {
      setBusyId(null);
    }
  }

  const merged = {
    data: people,
    isLoading: following.isLoading || current.isLoading,
    isError: following.isError || current.isError,
    isRefetching: following.isRefetching || current.isRefetching,
    refetch: () => Promise.all([following.refetch(), current.refetch()]),
  };

  const tone = isDark ? colors.primary2 : colors.primary;

  return (
    <ListScreen
      title={t('settings2.closeFriends.title')}
      note={t('settings2.closeFriends.note')}
      query={merged}
      keyOf={(p) => p.id}
      header={
        <View style={styles.header}>
          <TextField
            value={q}
            onChangeText={setQ}
            placeholder={t('settings2.closeFriends.search')}
            accessibilityLabel={t('settings2.closeFriends.search')}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          <AppText variant="small" muted accessibilityLiveRegion="polite">
            {t('settings2.closeFriends.count', { count: chosen.size })}
          </AppText>
        </View>
      }
      empty={
        q.trim()
          ? { icon: 'search-outline', title: t('settings2.common.noResults') }
          : { icon: 'people-outline', title: t('settings2.closeFriends.empty'), sub: t('settings2.closeFriends.emptySub') }
      }
      renderItem={(p) => {
        const on = chosen.has(p.id);
        const name = p.name || p.handle || t('settings2.common.unknownUser');
        return (
          <PersonRow
            name={name}
            handle={p.handle}
            avatarUrl={p.avatar_url}
            right={
              <Pressable
                onPress={() => flip(p)}
                disabled={busyId === p.id}
                hitSlop={8}
                accessibilityRole="checkbox"
                accessibilityLabel={t('settings2.closeFriends.toggle', { name })}
                accessibilityState={{ checked: on, busy: busyId === p.id }}
                style={[styles.pick, { borderColor: on ? tone : colors.muted2, backgroundColor: on ? tone : 'transparent' }]}
              >
                {busyId === p.id ? (
                  <ActivityIndicator size="small" color={on ? colors.onPrimary : colors.muted} />
                ) : on ? (
                  <Ionicons name="checkmark" size={18} color={colors.onPrimary} />
                ) : null}
              </Pressable>
            }
          />
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  pick: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
