import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  I18nManager,
  type ListRenderItem,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { type AddStatus, addMembers, fetchGroup, groupErrorKey, groupKeys, groupQueryKeys, isAdminRole } from '@/api/groups';
import { fetchFollowing, profileKeys, searchProfiles } from '@/api/profiles';
import type { UserSummary } from '@/api/types';
import { NotFoundState } from '@/components/NotFoundState';
import { showToast } from '@/components/Toast';
import { Button, Screen, TopBar } from '@/components/ui';
import { atHandle } from '@/lib/handle';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/providers/ThemeProvider';

import { Avatar } from './Avatar';

const EMPTY: UserSummary[] = [];

// Why a person could not be added, per person, from add_group_members
// (0147). "Blocked" and "privacy settings" read the same on purpose: saying
// which would tell you that someone blocked you.
const STATUS_KEY: Partial<Record<AddStatus, string>> = {
  blocked: 'groupInfo.addStatus.notAllowed',
  not_allowed: 'groupInfo.addStatus.notAllowed',
  not_found: 'groupInfo.addStatus.notFound',
  group_full: 'groupInfo.addStatus.groupFull',
};

// Add people to a group (admins). The same picker as New chat: with nothing
// typed, the people you follow; typing searches everyone. People already in
// the group are shown but cannot be picked.
export function AddGroupMembers({ chatId }: { chatId: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { session } = useAuth();
  const me = session?.user.id;
  const qc = useQueryClient();

  const group = useQuery({ queryKey: groupKeys.detail(chatId), queryFn: () => fetchGroup(chatId) });
  const memberIds = useMemo(() => new Set((group.data?.members ?? []).map((m) => m.id)), [group.data?.members]);

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<Map<string, UserSummary>>(() => new Map());
  const [refused, setRefused] = useState<Map<string, string>>(() => new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  const following = useQuery({
    queryKey: profileKeys.following(me ?? ''),
    queryFn: () => fetchFollowing(me),
    enabled: !!me && !debounced,
  });
  const search = useQuery({
    queryKey: profileKeys.search(debounced),
    queryFn: () => searchProfiles(debounced),
    enabled: !!debounced,
  });
  const source = debounced ? search : following;
  const people = useMemo(() => (source.data ?? EMPTY).filter((u) => u.id !== me), [source.data, me]);

  const add = useMutation({
    mutationFn: () => addMembers(chatId, Array.from(selected.keys())),
    onSuccess: (results) => {
      for (const key of groupQueryKeys(chatId)) void qc.invalidateQueries({ queryKey: key, exact: true });
      const added = results.filter((r) => r.status === 'added' || r.status === 'already_member');
      const failed = results.filter((r) => STATUS_KEY[r.status]);
      if (!failed.length) {
        showToast(t('groupInfo.addedToast', { count: added.length }), 'person-add');
        router.back();
        return;
      }
      // Stay, and say next to each person why they were not added. The
      // ones that went in leave the selection.
      const next = new Map<string, string>();
      for (const r of failed) next.set(r.user_id, t(STATUS_KEY[r.status] as string));
      setRefused(next);
      setSelected((prev) => {
        const keep = new Map<string, UserSummary>();
        for (const [id, u] of prev) if (next.has(id)) keep.set(id, u);
        return keep;
      });
      const msg = added.length
        ? t('groupInfo.addedSome', { added: added.length, failed: failed.length })
        : t('groupInfo.addedNone');
      setError(msg);
      AccessibilityInfo.announceForAccessibility(msg);
    },
    onError: (e) => setError(t(groupErrorKey(e))),
  });

  const onPick = useCallback((u: UserSummary) => {
    setError(null);
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(u.id)) next.delete(u.id);
      else next.set(u.id, u);
      return next;
    });
  }, []);

  const submit = () => {
    if (!selected.size) {
      setError(t('groupInfo.pickSomeone'));
      return;
    }
    setError(null);
    add.mutate();
  };

  const renderItem = useCallback<ListRenderItem<UserSummary>>(
    ({ item }) => (
      <PickRow
        user={item}
        inGroup={memberIds.has(item.id)}
        selected={selected.has(item.id)}
        refusal={refused.get(item.id) ?? null}
        onPick={onPick}
      />
    ),
    [memberIds, selected, refused, onPick],
  );

  if (group.data && (group.data.missing || group.data.notGroup || !isAdminRole(group.data.myRole))) {
    return (
      <NotFoundState
        icon="people-outline"
        title={group.data.missing ? t('groupInfo.goneTitle') : t('groupInfo.addMembers')}
        body={group.data.missing ? t('groupInfo.goneBody') : t('groupInfo.err.notAdmin')}
      />
    );
  }

  return (
    <Screen scroll={false} contentStyle={styles.screen} header={<TopBar title={t('groupInfo.addMembers')} />}>
      <View style={styles.top}>
        <View style={[styles.search, { backgroundColor: colors.bg2 }]}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('groupInfo.searchPeople')}
            placeholderTextColor={colors.muted}
            style={[styles.searchInput, { color: colors.text }]}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel={t('groupInfo.searchPeople')}
          />
          {search.isFetching && debounced ? <ActivityIndicator size="small" color={colors.muted} /> : null}
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('groupInfo.clearSearch')}>
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
        {selected.size ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
            {Array.from(selected.values()).map((u) => (
              <Pressable
                key={u.id}
                onPress={() => onPick(u)}
                style={[styles.chip, { backgroundColor: refused.has(u.id) ? colors.dangerSoft : colors.primarySoft }]}
                accessibilityRole="button"
                accessibilityLabel={t('groupInfo.unselect', { name: u.name || u.handle || '' })}
              >
                <Text style={[styles.chipText, { color: colors.text }]} numberOfLines={1}>
                  {u.name || u.handle}
                </Text>
                <Ionicons name="close" size={14} color={colors.muted} />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {error ? (
          <Text style={[styles.error, { color: colors.danger }]} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
      </View>

      <FlatList
        data={people}
        keyExtractor={keyOf}
        renderItem={renderItem}
        extraData={selected}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          source.isLoading ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} accessibilityLabel={t('groupInfo.loading')} />
          ) : source.isError ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: colors.text }]} accessibilityRole="alert">
                {t('groupInfo.loadPeopleFailed')}
              </Text>
              <Button title={t('groupInfo.retry')} variant="secondary" onPress={() => void source.refetch()} style={styles.retry} />
            </View>
          ) : (
            <Text style={[styles.emptyText, styles.empty, { color: colors.muted }]}>
              {debounced ? t('groupInfo.noPeople') : t('groupInfo.followToAdd')}
            </Text>
          )
        }
      />

      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.bg }]}>
        <Button
          title={selected.size ? t('groupInfo.addCount', { count: selected.size }) : t('groupInfo.addNone')}
          onPress={submit}
          loading={add.isPending}
          disabled={!selected.size}
        />
      </View>
    </Screen>
  );
}

const keyOf = (u: UserSummary) => u.id;

const PickRow = memo(function PickRow({
  user,
  inGroup,
  selected,
  refusal,
  onPick,
}: {
  user: UserSummary;
  inGroup: boolean;
  selected: boolean;
  refusal: string | null;
  onPick: (u: UserSummary) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const display = user.name || user.handle || '';
  const sub = inGroup ? t('groupInfo.addStatus.alreadyMember') : refusal;
  return (
    <Pressable
      onPress={() => onPick(user)}
      disabled={inGroup}
      style={({ pressed }) => [styles.row, (pressed || selected) && { backgroundColor: colors.bg2 }, inGroup && styles.dim]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected || inGroup, disabled: inGroup }}
      accessibilityLabel={[display, user.handle ? atHandle(user.handle) : null, sub].filter(Boolean).join(', ')}
    >
      <Avatar uri={user.avatar_url} name={display} size={46} />
      <View style={styles.rowBody}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
          {display}
        </Text>
        {sub ? (
          <Text style={[styles.handle, { color: refusal && !inGroup ? colors.danger : colors.muted }]} numberOfLines={2}>
            {sub}
          </Text>
        ) : user.handle ? (
          <Text style={[styles.handle, { color: colors.muted }]} numberOfLines={1}>
            {atHandle(user.handle)}
          </Text>
        ) : null}
      </View>
      <Ionicons
        name={inGroup || selected ? 'checkmark-circle' : 'ellipse-outline'}
        size={26}
        color={inGroup ? colors.muted2 : selected ? colors.primary : colors.muted2}
      />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  screen: { paddingHorizontal: 0, paddingVertical: 0 },
  top: { paddingHorizontal: 16, paddingTop: 12 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 44, borderRadius: 12, marginBottom: 8 },
  searchInput: { flex: 1, fontSize: 15, height: '100%', textAlign: I18nManager.isRTL ? 'right' : 'left' },
  chips: { gap: 8, paddingBottom: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, minHeight: 32, borderRadius: 16, maxWidth: 160 },
  chipText: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  error: { fontSize: 13.5, marginBottom: 8, textAlign: 'left' },
  listContent: { flexGrow: 1, paddingBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 9, minHeight: 64 },
  rowBody: { flex: 1, minWidth: 0 },
  name: { fontSize: 16, fontWeight: '600', textAlign: 'left' },
  handle: { fontSize: 13, textAlign: 'left' },
  dim: { opacity: 0.55 },
  loading: { marginTop: 40 },
  empty: { padding: 40, alignItems: 'center', gap: 12 },
  emptyText: { fontSize: 15, textAlign: 'center' },
  retry: { paddingHorizontal: 24 },
  footer: { paddingHorizontal: 16, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth },
});
