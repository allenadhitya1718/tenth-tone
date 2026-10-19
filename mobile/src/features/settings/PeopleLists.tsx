import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { profileKeys } from '@/api/profiles';
import {
  fetchBlocked,
  fetchMuted,
  fetchRestricted,
  safetyKeys,
  unblockUser,
  unmuteUser,
  unrestrictUser,
} from '@/api/safety';
import type { UserSummary } from '@/api/types';
import { TopBar } from '@/components/ui';
import { atHandle } from '@/lib/handle';
import { useTheme } from '@/providers/ThemeProvider';

import { confirm, EmptyView, ErrorView, LoadingView, Note, PersonRow, showError, type IconName } from './components';

// A settings screen whose body is a list. FlatList is the scroller, so it
// cannot sit inside the <Screen> ScrollView.
export function ListScreen<T>({
  title,
  note,
  query,
  keyOf,
  renderItem,
  empty,
  header,
}: {
  title: string;
  note?: string;
  query: { data?: T[]; isLoading: boolean; isError: boolean; isRefetching: boolean; refetch: () => unknown };
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactElement;
  empty: { icon: IconName; title: string; sub?: string };
  header?: ReactElement;
}) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <TopBar title={title} />
      <FlatList
        data={query.data ?? []}
        keyExtractor={keyOf}
        renderItem={({ item }) => renderItem(item)}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: colors.border }]} />}
        ListHeaderComponent={
          <>
            {note ? (
              <View style={styles.note}>
                <Note>{note}</Note>
              </View>
            ) : null}
            {header}
          </>
        }
        ListEmptyComponent={
          query.isLoading ? (
            <LoadingView />
          ) : query.isError ? (
            <ErrorView onRetry={() => query.refetch()} />
          ) : (
            <EmptyView icon={empty.icon} title={empty.title} sub={empty.sub} />
          )
        }
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.muted} />
        }
        contentContainerStyle={{ paddingBottom: 32 }}
      />
    </SafeAreaView>
  );
}

// Restricted and muted are the same screen: people you have limited, with
// one button to lift the limit.
function LimitList({
  kind,
  queryKey,
  load,
  lift,
}: {
  kind: 'restricted' | 'muted';
  queryKey: QueryKey;
  load: () => Promise<UserSummary[]>;
  lift: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const query = useQuery({ queryKey, queryFn: load });
  const [busyId, setBusyId] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: (id: string) => lift(id),
    onMutate: (id) => setBusyId(id),
    onSuccess: (_r, id) => {
      qc.setQueryData<UserSummary[]>(queryKey, (rows) => rows?.filter((r) => r.id !== id));
      qc.invalidateQueries({ queryKey: [kind] });
    },
    onError: (e) => showError(t, e, 'settings2.common.updateFailed'),
    onSettled: () => setBusyId(null),
  });

  return (
    <ListScreen
      title={t(`settings2.${kind}.title`)}
      note={t(`settings2.${kind}.note`)}
      query={query}
      keyOf={(u) => u.id}
      empty={{ icon: kind === 'muted' ? 'volume-mute-outline' : 'remove-circle-outline', title: t(`settings2.${kind}.empty`), sub: t(`settings2.${kind}.emptySub`) }}
      renderItem={(u) => (
        <PersonRow
          name={u.name || u.handle || t('settings2.common.unknownUser')}
          handle={u.handle}
          avatarUrl={u.avatar_url}
          actionLabel={t(`settings2.${kind}.lift`)}
          busy={busyId === u.id}
          onAction={() => mut.mutate(u.id)}
        />
      )}
    />
  );
}

export function RestrictedScreen() {
  return <LimitList kind="restricted" queryKey={safetyKeys.restricted()} load={fetchRestricted} lift={unrestrictUser} />;
}

export function MutedScreen() {
  return <LimitList kind="muted" queryKey={safetyKeys.muted()} load={fetchMuted} lift={unmuteUser} />;
}

export function BlockedScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: safetyKeys.blocked(), queryFn: fetchBlocked });
  const [busyId, setBusyId] = useState<string | null>(null);

  async function unblock(id: string, shown: string) {
    const yes = await confirm({
      title: t('settings2.blocked.confirmTitle'),
      message: t('settings2.blocked.confirmBody', { name: shown }),
      confirmLabel: t('settings2.blocked.unblock'),
      cancelLabel: t('common.cancel'),
    });
    if (!yes) return;
    // The row goes only after the delete comes back; removing it first would
    // show a block as lifted that the server still has.
    setBusyId(id);
    try {
      await unblockUser(id);
      qc.setQueryData(safetyKeys.blocked(), (rows: { id: string }[] | undefined) => rows?.filter((r) => r.id !== id));
      // What a block hid: follow lists, profiles, the feed, people search.
      qc.invalidateQueries({ queryKey: safetyKeys.blocked() });
      qc.invalidateQueries({ queryKey: profileKeys.all });
      qc.invalidateQueries({ queryKey: ['followers'] });
      qc.invalidateQueries({ queryKey: ['following'] });
      qc.invalidateQueries({ queryKey: ['isFollowing'] });
      qc.invalidateQueries({ queryKey: ['feed'] });
    } catch (e) {
      showError(t, e, 'settings2.blocked.unblockFailed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ListScreen
      title={t('settings2.blocked.title')}
      note={t('settings2.blocked.note')}
      query={query}
      keyOf={(u) => u.id}
      empty={{ icon: 'ban-outline', title: t('settings2.blocked.empty'), sub: t('settings2.blocked.emptySub') }}
      renderItem={(u) => {
        // A mutual block hides the other person's profile from you (0054),
        // so name and handle can be empty. Say so rather than show a blank.
        const known = !!(u.name || u.handle);
        const shown = u.name || u.handle || t('settings2.blocked.unknown');
        return (
          <PersonRow
            name={shown}
            handle={u.handle}
            avatarUrl={u.avatar_url || null}
            subtitle={known ? (u.handle ? atHandle(u.handle) : '') : t('settings2.blocked.mutual')}
            actionLabel={t('settings2.blocked.unblock')}
            busy={busyId === u.id}
            onAction={() => unblock(u.id, shown)}
          />
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  sep: { height: StyleSheet.hairlineWidth, marginStart: 70 },
  note: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
});
