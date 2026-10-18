import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchFollowers, fetchFollowing, type FollowListRow, profileKeys } from '@/api/profiles';
import { TopBar } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';

import { EmptyState, ErrorState, LoadingState } from './parts';
import { PersonRow } from './rows';

export type FollowListKind = 'followers' | 'following';

// Someone's followers or the people they follow, filtered as you type. The
// filter runs over the loaded list: these lists are one person's, so a
// global people search would answer a different question.
export function FollowList({ kind, userId }: { kind: FollowListKind; userId: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [filter, setFilter] = useState('');

  const list = useQuery({
    queryKey: kind === 'followers' ? profileKeys.followers(userId) : profileKeys.following(userId),
    queryFn: () => (kind === 'followers' ? fetchFollowers(userId) : fetchFollowing(userId)),
  });

  const rows = useMemo(() => {
    const all = list.data ?? [];
    // "@sara" filters the same as "sara" (handles are stored without it).
    const f = filter.trim().replace(/^@+/, '').toLowerCase();
    if (!f) return all;
    return all.filter((p) => (p.name ?? '').toLowerCase().includes(f) || (p.handle ?? '').toLowerCase().includes(f));
  }, [list.data, filter]);

  const renderItem = useCallback(({ item }: { item: FollowListRow }) => <PersonRow person={item} />, []);
  const { refetch } = list;
  const onRefresh = useCallback(() => void refetch(), [refetch]);

  const title = t(kind === 'followers' ? 'discover.lists.followers' : 'discover.lists.following');

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <TopBar title={title} />
      <View style={[styles.field, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
        <Ionicons name="search" size={17} color={colors.muted} />
        <TextInput
          value={filter}
          onChangeText={setFilter}
          placeholder={t('discover.lists.filter')}
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={t('discover.lists.filter')}
          style={[styles.input, { color: colors.text, textAlign: I18nManager.isRTL ? 'right' : 'left' }]}
        />
        {filter ? (
          <Pressable onPress={() => setFilter('')} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('discover.search.clearText')}>
            <Ionicons name="close-circle" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      <FlashList
        data={rows}
        keyExtractor={keyOf}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={onRefresh} tintColor={colors.muted} />}
        ListEmptyComponent={
          list.isLoading ? (
            <LoadingState />
          ) : list.isError ? (
            <ErrorState onRetry={onRefresh} />
          ) : filter.trim() ? (
            <EmptyState icon="search-outline" title={t('discover.search.noResults')} />
          ) : (
            <EmptyState
              icon="people-outline"
              title={t(kind === 'followers' ? 'discover.lists.emptyFollowers' : 'discover.lists.emptyFollowing')}
            />
          )
        }
      />
    </SafeAreaView>
  );
}

const keyOf = (p: FollowListRow) => p.id;

const styles = StyleSheet.create({
  root: { flex: 1 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 10,
    paddingHorizontal: 12,
    height: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, fontSize: 15, height: '100%', paddingVertical: 0 },
});
