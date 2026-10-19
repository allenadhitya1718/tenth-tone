import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
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

import { chatKeys, createGroup, openOrCreateDm } from '@/api/chat';
import { ApiError } from '@/api/client';
import { fetchFollowing, profileKeys, searchProfiles } from '@/api/profiles';
import type { UserSummary } from '@/api/types';
import { showToast } from '@/components/Toast';
import { Button, ErrorBox, type ErrorMsg, Screen, TextField, TopBar } from '@/components/ui';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/providers/ThemeProvider';

import { Avatar } from './Avatar';
import { atHandle } from '@/lib/handle';

const EMPTY: UserSummary[] = [];
const MAX_NAME = 60;

// Start a conversation. With nothing typed the list is the people you
// follow: listing every account on the platform was a stranger-contact
// problem on the web app. Typing searches everyone, which is how you reach
// someone new on purpose. Group mode picks several people and a name.
export function NewChat({ initialGroup = false }: { initialGroup?: boolean }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { session } = useAuth();
  const me = session?.user.id;
  const qc = useQueryClient();

  const [group, setGroup] = useState(initialGroup);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<Map<string, UserSummary>>(() => new Map());
  const [name, setName] = useState('');
  const [error, setError] = useState<ErrorMsg>(null);

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

  const dm = useMutation({
    mutationFn: (userId: string) => openOrCreateDm(userId),
    onSuccess: (chatId) => {
      void qc.invalidateQueries({ queryKey: chatKeys.chats(), exact: true });
      router.replace(`/chat/${chatId}`);
    },
    onError: (e) =>
      setError({ key: e instanceof ApiError && e.code === 'cannot_dm_yourself' ? 'chat.errSelf' : 'chat.errOpen' }),
  });

  const make = useMutation({
    mutationFn: () => createGroup({ name: name.trim(), memberIds: Array.from(selected.keys()) }),
    onSuccess: ({ chatId, skipped }) => {
      void qc.invalidateQueries({ queryKey: chatKeys.chats(), exact: true });
      // People whose privacy settings do not allow you to add them (0116).
      if (skipped.length) showToast(t('chat.membersSkipped', { count: skipped.length }), 'information-circle');
      router.replace(`/chat/${chatId}`);
    },
    onError: () => setError({ key: 'chat.errCreateGroup' }),
  });

  const startDm = dm.mutate;
  const dmBusy = dm.isPending;
  const onPick = useCallback(
    (u: UserSummary) => {
      setError(null);
      if (!group) {
        if (!dmBusy) startDm(u.id);
        return;
      }
      setSelected((prev) => {
        const next = new Map(prev);
        if (next.has(u.id)) next.delete(u.id);
        else next.set(u.id, u);
        return next;
      });
    },
    [group, dmBusy, startDm],
  );

  const createPressed = () => {
    if (!name.trim()) return setError({ key: 'chat.errGroupName' });
    if (!selected.size) return setError({ key: 'chat.errGroupMembers' });
    setError(null);
    make.mutate();
  };

  const renderItem = useCallback<ListRenderItem<UserSummary>>(
    ({ item }) => (
      <PersonRow
        user={item}
        group={group}
        selected={selected.has(item.id)}
        busy={dm.isPending && dm.variables === item.id}
        onPick={onPick}
      />
    ),
    [group, selected, dm.isPending, dm.variables, onPick],
  );

  const list = (
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
          <ActivityIndicator style={styles.loading} color={colors.primary} accessibilityLabel={t('chat.loading')} />
        ) : source.isError ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: colors.text }]} accessibilityRole="alert">
              {t('chat.loadPeopleFailed')}
            </Text>
            <Button title={t('chat.retry')} variant="secondary" onPress={() => void source.refetch()} style={styles.retry} />
          </View>
        ) : (
          <Text style={[styles.emptyText, styles.empty, { color: colors.muted }]}>
            {debounced ? t('chat.noPeople') : t('chat.followToChat')}
          </Text>
        )
      }
    />
  );

  return (
    <Screen
      scroll={false}
      contentStyle={styles.screen}
      header={
        <TopBar
          title={group ? t('chat.newGroup') : t('chat.newMessage')}
          right={
            <Pressable
              onPress={() => {
                setGroup((g) => !g);
                setError(null);
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={group ? t('chat.switchToDm') : t('chat.newGroup')}
            >
              <Ionicons name={group ? 'person-outline' : 'people-outline'} size={24} color={colors.text} />
            </Pressable>
          }
        />
      }
    >
      <View style={styles.top}>
        {group ? (
          <TextField
            value={name}
            onChangeText={(v) => setName(v.slice(0, MAX_NAME))}
            placeholder={t('chat.groupName')}
            accessibilityLabel={t('chat.groupName')}
            returnKeyType="next"
          />
        ) : null}
        <View style={[styles.search, { backgroundColor: colors.bg2 }]}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('chat.searchPeople')}
            placeholderTextColor={colors.muted}
            style={[styles.searchInput, { color: colors.text }]}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel={t('chat.searchPeople')}
          />
          {search.isFetching && debounced ? <ActivityIndicator size="small" color={colors.muted} /> : null}
        </View>
        {group && selected.size ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
            {Array.from(selected.values()).map((u) => (
              <Pressable
                key={u.id}
                onPress={() => onPick(u)}
                style={[styles.chip, { backgroundColor: colors.primarySoft }]}
                accessibilityRole="button"
                accessibilityLabel={t('chat.removeMember', { name: u.name || u.handle || '' })}
              >
                <Text style={[styles.chipText, { color: colors.text }]} numberOfLines={1}>
                  {u.name || u.handle}
                </Text>
                <Ionicons name="close" size={14} color={colors.muted} />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <ErrorBox error={error} />
      </View>

      {list}

      {group ? (
        <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.bg }]}>
          <Button
            title={selected.size ? t('chat.createGroupCount', { count: selected.size }) : t('chat.createGroup')}
            onPress={createPressed}
            loading={make.isPending}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const keyOf = (u: UserSummary) => u.id;

const PersonRow = memo(function PersonRow({
  user,
  group,
  selected,
  busy,
  onPick,
}: {
  user: UserSummary;
  group: boolean;
  selected: boolean;
  busy: boolean;
  onPick: (u: UserSummary) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const display = user.name || user.handle || '';
  return (
    <Pressable
      onPress={() => onPick(user)}
      style={({ pressed }) => [styles.row, (pressed || selected) && { backgroundColor: colors.bg2 }]}
      accessibilityRole={group ? 'checkbox' : 'button'}
      accessibilityState={group ? { checked: selected } : { busy }}
      accessibilityLabel={user.handle ? `${display}, @${user.handle}` : display}
      accessibilityHint={group ? undefined : t('chat.startChatHint')}
    >
      <Avatar uri={user.avatar_url} name={display} size={46} />
      <View style={styles.rowBody}>
        <View style={styles.nameLine}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {display}
          </Text>
          {user.verified ? <Ionicons name="checkmark-circle" size={15} color={colors.primary2} /> : null}
        </View>
        {user.handle ? (
          <Text style={[styles.handle, { color: colors.muted }]} numberOfLines={1}>
            {atHandle(user.handle)}
          </Text>
        ) : null}
      </View>
      {group ? (
        <Ionicons
          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
          size={26}
          color={selected ? colors.primary : colors.muted2}
        />
      ) : busy ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={20} color={colors.muted2} />
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  screen: { paddingHorizontal: 0, paddingVertical: 0 },
  top: { paddingHorizontal: 16, paddingTop: 12 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 15, height: '100%', textAlign: I18nManager.isRTL ? 'right' : 'left' },
  chips: { gap: 8, paddingBottom: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, minHeight: 32, borderRadius: 16, maxWidth: 160 },
  chipText: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  listContent: { flexGrow: 1, paddingBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 9, minHeight: 64 },
  rowBody: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { fontSize: 16, fontWeight: '600', flexShrink: 1, textAlign: 'left' },
  handle: { fontSize: 13, textAlign: 'left' },
  loading: { marginTop: 40 },
  empty: { padding: 40, alignItems: 'center', gap: 12 },
  emptyText: { fontSize: 15, textAlign: 'center' },
  retry: { paddingHorizontal: 24 },
  footer: { paddingHorizontal: 16, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth },
});
