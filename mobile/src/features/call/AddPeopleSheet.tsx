import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  I18nManager,
  KeyboardAvoidingView,
  type ListRenderItem,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CallKind, CallMemberStatus, CallMemberWithProfile } from '@/api/calls';
import { fetchShareTargets } from '@/api/discover';
import { normalizePeopleQuery, searchPeople, withoutBlocked } from '@/api/search';
import type { UserSummary, Uuid } from '@/api/types';
import type { ErrorMsg } from '@/components/ui';
import { Avatar } from '@/features/chat/Avatar';
import { atHandle } from '@/lib/handle';
import { useTheme } from '@/providers/ThemeProvider';

import { GROUP_LIMIT, invitePerson } from './callSession';
import { isActiveMember } from './useCallMembers';

// "Add people" during a call. Tap Add and that person's phone rings at once;
// the row turns to "Ringing…", then "In the call", "Declined" or "No answer"
// as call_members changes. The sheet stays open so several people can be
// added in a row; Done (or tapping outside, or Back) closes it.
//
// With nothing typed the list is the people you talk to and follow, most
// recent first (the share sheet's ranking); typing searches everyone, blocks
// filtered in the database. People already in the call or ringing are left
// out, except those added from this sheet, who stay where they were so their
// row can show what happened.
const EMPTY: UserSummary[] = [];

type RowState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'member'; status: CallMemberStatus }
  | { kind: 'error'; error: NonNullable<ErrorMsg> };

export function AddPeopleSheet({
  visible,
  onClose,
  members,
  me,
  kind,
  onInvited,
}: {
  visible: boolean;
  onClose: () => void;
  members: CallMemberWithProfile[];
  me: Uuid | null;
  kind: CallKind;
  onInvited: (user: UserSummary) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  // Added from this sheet since it opened, so they stay listed.
  const [touched, setTouched] = useState<Set<Uuid>>(() => new Set());
  const [sending, setSending] = useState<Set<Uuid>>(() => new Set());
  const [errors, setErrors] = useState<Map<Uuid, NonNullable<ErrorMsg>>>(() => new Map());

  useEffect(() => {
    const id = setTimeout(() => setDebounced(normalizePeopleQuery(query)), 250);
    return () => clearTimeout(id);
  }, [query]);

  const targets = useQuery({
    queryKey: ['calls', 'addTargets'],
    queryFn: async () => withoutBlocked(await fetchShareTargets()),
    enabled: visible && !debounced,
    staleTime: 60_000,
  });
  const search = useQuery({
    queryKey: ['calls', 'addSearch', debounced],
    queryFn: () => searchPeople(debounced, 25),
    enabled: visible && !!debounced,
  });
  const source = debounced ? search : targets;

  const byId = useMemo(() => new Map(members.map((m) => [m.user_id, m] as const)), [members]);
  const inCall = useMemo(() => members.filter(isActiveMember).length, [members]);
  const max = GROUP_LIMIT[kind];
  const full = inCall >= max;

  const people = useMemo(
    () =>
      (source.data ?? EMPTY).filter((u) => {
        if (!u || u.id === me) return false;
        const m = byId.get(u.id);
        return !(m && isActiveMember(m) && !touched.has(u.id));
      }),
    [source.data, me, byId, touched],
  );

  const add = useCallback(
    async (u: UserSummary) => {
      if (sending.has(u.id)) return;
      setSending((s) => new Set(s).add(u.id));
      setErrors((e) => {
        const n = new Map(e);
        n.delete(u.id);
        return n;
      });
      const r = await invitePerson(u.id, inCall);
      setSending((s) => {
        const n = new Set(s);
        n.delete(u.id);
        return n;
      });
      if (r.ok) {
        setTouched((s) => new Set(s).add(u.id));
        onInvited(u);
      } else {
        setErrors((e) => new Map(e).set(u.id, r.error));
      }
    },
    [sending, inCall, onInvited],
  );

  const stateOf = useCallback(
    (id: Uuid): RowState => {
      if (sending.has(id)) return { kind: 'sending' };
      const err = errors.get(id);
      if (err) return { kind: 'error', error: err };
      const m = byId.get(id);
      if (m && (touched.has(id) || isActiveMember(m))) return { kind: 'member', status: m.status };
      return { kind: 'idle' };
    },
    [sending, errors, byId, touched],
  );

  const renderItem = useCallback<ListRenderItem<UserSummary>>(
    ({ item }) => <PersonRow user={item} state={stateOf(item.id)} full={full} onAdd={add} />,
    [stateOf, full, add],
  );

  const empty = source.isLoading ? (
    <ActivityIndicator style={styles.pad} color={colors.muted} />
  ) : source.isError ? (
    <View style={[styles.pad, styles.center]}>
      <Text style={[styles.emptyText, { color: colors.muted }]}>{t('call.group.loadError')}</Text>
      <Pressable
        onPress={() => void source.refetch()}
        style={[styles.retry, { borderColor: colors.border }]}
        accessibilityRole="button"
      >
        <Text style={[styles.retryText, { color: colors.text }]}>{t('call.group.retry')}</Text>
      </Pressable>
    </View>
  ) : (
    <Text style={[styles.pad, styles.emptyText, { color: colors.muted }]}>
      {debounced ? t('call.group.emptySearch', { q: debounced }) : t('call.group.emptyList')}
    </Text>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('call.close')}
        />
        <View
          style={[styles.panel, { backgroundColor: colors.bg, paddingBottom: Math.max(insets.bottom, 12) }]}
          accessibilityViewIsModal
        >
          <View style={[styles.grabber, { backgroundColor: colors.muted2 }]} />
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={styles.headText}>
              <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header" numberOfLines={1}>
                {t('call.group.sheetTitle')}
              </Text>
              <Text style={[styles.count, { color: colors.muted }]} numberOfLines={1}>
                {t('call.group.countLine', { count: inCall, max })}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.done} accessibilityRole="button">
              <Text style={[styles.doneText, { color: colors.primary2 }]}>{t('call.group.done')}</Text>
            </Pressable>
          </View>

          <View style={[styles.searchBox, { backgroundColor: colors.bg2 }]}>
            <Ionicons name="search" size={18} color={colors.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('call.group.searchPlaceholder')}
              placeholderTextColor={colors.muted}
              style={[styles.searchInput, { color: colors.text }]}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel={t('call.group.searchPlaceholder')}
            />
            {query ? (
              <Pressable
                onPress={() => setQuery('')}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('call.group.clearSearch')}
              >
                <Ionicons name="close-circle" size={18} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>

          {full ? (
            <View style={[styles.fullNote, { backgroundColor: colors.primarySoft }]} accessibilityLiveRegion="polite">
              <Ionicons name="information-circle" size={18} color={colors.primary2} />
              <Text style={[styles.fullText, { color: colors.text }]}>
                {t('call.group.full', { audio: GROUP_LIMIT.audio, video: GROUP_LIMIT.video })}
              </Text>
            </View>
          ) : null}

          <FlatList
            data={people}
            keyExtractor={keyOf}
            renderItem={renderItem}
            extraData={stateOf}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListEmptyComponent={empty}
            style={styles.list}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const keyOf = (u: UserSummary) => u.id;

const PersonRow = memo(function PersonRow({
  user,
  state,
  full,
  onAdd,
}: {
  user: UserSummary;
  state: RowState;
  full: boolean;
  onAdd: (u: UserSummary) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const name = user.name || user.handle || t('call.someone');
  const handle = user.handle ? atHandle(user.handle) : null;

  let sub: { text: string; color: string } | null = null;
  let trailing: 'add' | 'sending' | 'ringing' | 'in' = 'add';
  if (state.kind === 'sending') trailing = 'sending';
  else if (state.kind === 'error') sub = { text: t(state.error.key, state.error.params), color: colors.danger };
  else if (state.kind === 'member') {
    if (state.status === 'ringing') trailing = 'ringing';
    else if (state.status === 'joined') trailing = 'in';
    else if (state.status === 'declined') sub = { text: t('call.group.declined'), color: colors.muted };
    else if (state.status === 'missed') sub = { text: t('call.group.noAnswer'), color: colors.muted };
    else if (state.status === 'left') sub = { text: t('call.group.leftShort'), color: colors.muted };
  }
  const canAdd = trailing === 'add' && !full;

  return (
    <View style={styles.row}>
      <Avatar uri={user.avatar_url} name={name} size={44} />
      <View style={styles.rowText}>
        <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
          {name}
        </Text>
        {sub ? (
          <Text style={[styles.rowSub, { color: sub.color }]} numberOfLines={3} accessibilityLiveRegion="polite">
            {sub.text}
          </Text>
        ) : handle ? (
          <Text style={[styles.rowSub, { color: colors.muted }]} numberOfLines={1}>
            {handle}
          </Text>
        ) : null}
      </View>
      {trailing === 'sending' ? (
        <ActivityIndicator color={colors.primary2} style={styles.trailing} />
      ) : trailing === 'ringing' ? (
        <View style={[styles.trailing, styles.statusPill]} accessibilityLiveRegion="polite">
          <Ionicons name="call" size={14} color={colors.primary2} />
          <Text style={[styles.statusText, { color: colors.primary2 }]}>{t('call.group.ringing')}</Text>
        </View>
      ) : trailing === 'in' ? (
        <View style={[styles.trailing, styles.statusPill]} accessibilityLiveRegion="polite">
          <Ionicons name="checkmark-circle" size={16} color={colors.success} />
          <Text style={[styles.statusText, { color: colors.success }]}>{t('call.group.inCall')}</Text>
        </View>
      ) : (
        <Pressable
          onPress={() => onAdd(user)}
          disabled={!canAdd}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t('call.group.inviteA11y', { name })}
          accessibilityState={{ disabled: !canAdd }}
          style={({ pressed }) => [
            styles.trailing,
            styles.addBtn,
            { backgroundColor: colors.primary },
            (pressed || !canAdd) && { opacity: canAdd ? 0.8 : 0.4 },
          ]}
        >
          <Ionicons name="person-add" size={14} color={colors.onPrimary} />
          <Text style={[styles.addText, { color: colors.onPrimary }]}>{t('call.group.addShort')}</Text>
        </Pressable>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...(StyleSheet.absoluteFill as object), backgroundColor: 'rgba(0,0,0,0.45)' },
  panel: { borderTopLeftRadius: 20, borderTopRightRadius: 20, height: '82%', overflow: 'hidden' },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  headText: { flex: 1 },
  title: { fontSize: 17, fontWeight: '800', textAlign: 'left' },
  count: { fontSize: 13, marginTop: 2, textAlign: 'left' },
  done: { minHeight: 44, minWidth: 56, alignItems: 'center', justifyContent: 'center' },
  doneText: { fontSize: 16, fontWeight: '700' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 12,
    height: 42,
    borderRadius: 12,
  },
  searchInput: { flex: 1, fontSize: 15, height: '100%', textAlign: I18nManager.isRTL ? 'right' : 'left' },
  fullNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
  },
  fullText: { flex: 1, fontSize: 13, textAlign: 'left' },
  list: { flex: 1 },
  pad: { padding: 24 },
  center: { alignItems: 'center', gap: 12 },
  emptyText: { fontSize: 14, textAlign: 'center' },
  retry: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, borderWidth: 1 },
  retryText: { fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, minHeight: 60 },
  rowText: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '700', textAlign: 'left' },
  rowSub: { fontSize: 13, marginTop: 2, textAlign: 'left' },
  trailing: { minHeight: 36 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6 },
  statusText: { fontSize: 13, fontWeight: '700' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: 18 },
  addText: { fontSize: 14, fontWeight: '700' },
});
