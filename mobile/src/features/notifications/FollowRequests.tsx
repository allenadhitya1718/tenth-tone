import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { type FollowRequest, fetchFollowRequests, profileKeys } from '@/api/profiles';
import { TopBar } from '@/components/ui';
import { go, userPath } from '@/features/discover/nav';
import { Avatar, EmptyState, ErrorState, LoadingState } from '@/features/discover/parts';
import { timeAgo } from '@/lib/timeAgo';
import { useTheme } from '@/providers/ThemeProvider';

import { PillButton } from './PillButton';
import { useFollowRequestDecision } from './useFollowRequestDecision';

// People asking to follow your private account, newest first. A decided row
// leaves the list at once (the mutation updates the cache).
export function FollowRequests() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const list = useQuery({ queryKey: profileKeys.followRequests(), queryFn: fetchFollowRequests });
  const { refetch } = list;
  const onRefresh = useCallback(() => void refetch(), [refetch]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <TopBar title={t('discover.requests.title')} />
      <FlashList
        data={list.data ?? []}
        keyExtractor={keyOf}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={onRefresh} tintColor={colors.muted} />}
        ListEmptyComponent={
          list.isLoading ? (
            <LoadingState />
          ) : list.isError ? (
            <ErrorState onRetry={onRefresh} />
          ) : (
            <EmptyState icon="person-add-outline" title={t('discover.requests.empty')} sub={t('discover.requests.emptySub')} />
          )
        }
      />
    </SafeAreaView>
  );
}

const keyOf = (r: FollowRequest) => r.id;
const renderItem = ({ item }: { item: FollowRequest }) => <RequestRow request={item} />;

const RequestRow = memo(function RequestRow({ request }: { request: FollowRequest }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const decide = useFollowRequestDecision(request.id);
  const name = request.name || request.handle || '';

  return (
    <View style={styles.row}>
      <Pressable
        style={styles.main}
        onPress={() => go(userPath(request.id))}
        accessibilityRole="button"
        accessibilityLabel={[name, request.handle ? `@${request.handle}` : null].filter(Boolean).join(', ')}
      >
        <Avatar uri={request.avatar_url} name={name} size={48} />
        <View style={styles.text}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[styles.meta, { color: colors.muted }]} numberOfLines={1}>
            {[request.handle ? `@${request.handle}` : null, timeAgo(request.requested_at, t, i18n.language)]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      </Pressable>
      <View style={styles.actions}>
        <PillButton
          title={t('discover.requests.approve')}
          label={t('discover.requests.approveA11y', { name })}
          primary
          loading={decide.isPending && decide.variables === 'approve'}
          disabled={decide.isPending}
          onPress={() => decide.mutate('approve')}
        />
        <PillButton
          title={t('discover.requests.decline')}
          label={t('discover.requests.declineA11y', { name })}
          loading={decide.isPending && decide.variables === 'decline'}
          disabled={decide.isPending}
          onPress={() => decide.mutate('decline')}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  text: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '700', alignSelf: 'flex-start', maxWidth: '100%' },
  meta: { fontSize: 13, alignSelf: 'flex-start', maxWidth: '100%' },
  actions: { flexDirection: 'row', gap: 6 },
});
