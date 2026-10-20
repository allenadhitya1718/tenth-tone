import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Href, router, useFocusEffect } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  FlatList,
  I18nManager,
  Linking,
  type ListRenderItem,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { chatKeys, type ChatListItem } from '@/api/chat';
import {
  deleteGroup,
  fetchGroup,
  groupErrorKey,
  groupKeys,
  groupQueryKeys,
  type GroupMember,
  type GroupRole,
  isAdminRole,
  leaveGroup,
  MAX_GROUP_NAME,
  removeMember,
  renameGroup,
  setAdmin,
  setGroupPhoto,
} from '@/api/groups';
import type { LocalMedia } from '@/api/upload';
import { NotFoundState } from '@/components/NotFoundState';
import { showToast } from '@/components/Toast';
import { Button, Screen, TopBar } from '@/components/ui';
import { atHandle } from '@/lib/handle';
import { BottomSheet } from '@/features/safety/BottomSheet';
import { pickAvatar } from '@/features/settings/avatarImage';
import { useTheme } from '@/providers/ThemeProvider';

import { Avatar } from './Avatar';
import { translateTitle } from './format';
import { ImageViewer } from './ImageViewer';
import { useGroupLive } from './useGroupLive';

type MenuItem = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; destructive?: boolean; onPress: () => void };

// Group Info (owner request: tapping a group's name did nothing). Opened
// from the group thread's header. Everyone sees the photo, name, members and
// can leave; admins (0147) also rename, change the photo, add and remove
// people and make admins; the owner can delete the group.
//
// No per-chat mute exists in the API or database, so there is no mute row;
// reports cannot target a chat (reports.target_type), so there is no report
// row. Both are listed in the 0147 notes.
export function GroupInfo({ chatId }: { chatId: string }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();

  const group = useQuery({ queryKey: groupKeys.detail(chatId), queryFn: () => fetchGroup(chatId) });
  useGroupLive(chatId);
  // Removed while away, or changed from another device: read again on focus.
  const refetch = group.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const data = group.data;
  const myRole: GroupRole | null = data?.myRole ?? null;
  const admin = isAdminRole(myRole);
  const owner = myRole === 'owner';
  const title = translateTitle(data?.name || t('chat.groupFallback'), t);
  const members = data?.members;
  const memberCount = members?.length ?? 0;

  const [photoMenu, setPhotoMenu] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [memberMenu, setMemberMenu] = useState<GroupMember | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    for (const key of groupQueryKeys(chatId)) void qc.invalidateQueries({ queryKey: key, exact: true });
  }, [qc, chatId]);

  const fail = useCallback(
    (e: unknown) => {
      const key = groupErrorKey(e);
      if (key === 'groupInfo.err.generic') console.warn('group info: action failed:', (e as Error)?.message ?? e);
      Alert.alert(t(key));
      if (key === 'groupInfo.err.gone' || key === 'groupInfo.err.notAdmin' || key === 'groupInfo.err.targetGone') refresh();
    },
    [t, refresh],
  );

  // ---------- Name ----------

  const rename = useMutation({
    mutationFn: (name: string) => renameGroup(chatId, name),
    onSuccess: () => {
      setEditing(false);
      refresh();
      showToast(t('groupInfo.nameSaved'));
    },
    onError: (e) => {
      const key = groupErrorKey(e);
      if (key === 'groupInfo.err.nameRequired' || key === 'groupInfo.err.nameTooLong') setNameError(t(key));
      else fail(e);
    },
  });

  const startEdit = () => {
    setDraft(data?.name ?? '');
    setNameError(null);
    setEditing(true);
  };
  const saveName = () => {
    const clean = draft.trim();
    if (!clean) {
      setNameError(t('groupInfo.err.nameRequired'));
      return;
    }
    if (clean === (data?.name ?? '').trim()) {
      setEditing(false);
      return;
    }
    rename.mutate(clean);
  };

  // ---------- Photo ----------

  const photo = useMutation({
    mutationFn: (media: LocalMedia | null) => setGroupPhoto(chatId, media),
    onSuccess: (_v, media) => {
      refresh();
      showToast(media ? t('groupInfo.photoSaved') : t('groupInfo.photoRemovedToast'));
    },
    onError: (e) => {
      const key = groupErrorKey(e);
      Alert.alert(key === 'groupInfo.err.generic' ? t('groupInfo.err.photoFailed') : t(key));
    },
  });

  const pick = async (source: 'library' | 'camera') => {
    setPhotoMenu(false);
    try {
      const r = await pickAvatar(source);
      if (!r) return;
      if ('denied' in r) {
        Alert.alert(t('groupInfo.cameraDeniedTitle'), t('groupInfo.cameraDenied'), [
          { text: t('groupInfo.cancel'), style: 'cancel' },
          { text: t('groupInfo.openSettings'), onPress: () => Linking.openSettings().catch(() => {}) },
        ]);
        return;
      }
      photo.mutate(r.media);
    } catch {
      Alert.alert(t('groupInfo.err.photoFailed'));
    }
  };

  const onPhotoPress = () => {
    if (admin) setPhotoMenu(true);
    else if (data?.photo_url) setViewing(data.photo_url);
  };

  const photoItems: MenuItem[] = [
    ...(data?.photo_url
      ? [{ key: 'view', label: t('groupInfo.viewPhoto'), icon: 'expand-outline' as const, onPress: () => {
          setPhotoMenu(false);
          setViewing(data.photo_url);
        } }]
      : []),
    { key: 'lib', label: t('groupInfo.choosePhoto'), icon: 'images-outline', onPress: () => void pick('library') },
    { key: 'cam', label: t('groupInfo.takePhoto'), icon: 'camera-outline', onPress: () => void pick('camera') },
    ...(data?.photo_url
      ? [{ key: 'rm', label: t('groupInfo.removePhoto'), icon: 'trash-outline' as const, destructive: true, onPress: () => {
          setPhotoMenu(false);
          Alert.alert(t('groupInfo.removePhotoTitle'), undefined, [
            { text: t('groupInfo.cancel'), style: 'cancel' },
            { text: t('groupInfo.removePhotoConfirm'), style: 'destructive', onPress: () => photo.mutate(null) },
          ]);
        } }]
      : []),
  ];

  // ---------- Members ----------

  const memberAction = useMutation({
    mutationFn: async ({ kind, m }: { kind: 'remove' | 'admin' | 'unadmin'; m: GroupMember }) => {
      if (kind === 'remove') await removeMember(chatId, m.id);
      else await setAdmin(chatId, m.id, kind === 'admin');
    },
    onSuccess: (_v, { kind, m }) => {
      refresh();
      const name = m.name || m.handle || t('groupInfo.sys.someone');
      const msg =
        kind === 'remove'
          ? t('groupInfo.removed', { name })
          : kind === 'admin'
            ? t('groupInfo.madeAdmin', { name })
            : t('groupInfo.unmadeAdmin', { name });
      showToast(msg);
      AccessibilityInfo.announceForAccessibility(msg);
    },
    onError: fail,
  });

  // What I may do to this member: mirrors the 0147 rules so the menu never
  // offers something the server refuses.
  const actionsFor = useCallback(
    (m: GroupMember): ('admin' | 'unadmin' | 'remove')[] => {
      if (!admin || m.isMe || m.role === 'owner') return [];
      if (m.role === 'admin') return owner ? ['unadmin', 'remove'] : [];
      return ['admin', 'remove'];
    },
    [admin, owner],
  );

  const confirmRemove = (m: GroupMember) => {
    const name = m.name || m.handle || t('groupInfo.sys.someone');
    Alert.alert(t('groupInfo.removeTitle', { name }), t('groupInfo.removeBody'), [
      { text: t('groupInfo.cancel'), style: 'cancel' },
      { text: t('groupInfo.removeConfirm'), style: 'destructive', onPress: () => memberAction.mutate({ kind: 'remove', m }) },
    ]);
  };

  const memberItems: MenuItem[] = memberMenu
    ? actionsFor(memberMenu).map((a) => {
        const m = memberMenu;
        if (a === 'admin')
          return { key: a, label: t('groupInfo.makeAdmin'), icon: 'shield-checkmark-outline', onPress: () => {
            setMemberMenu(null);
            memberAction.mutate({ kind: 'admin', m });
          } };
        if (a === 'unadmin')
          return { key: a, label: t('groupInfo.removeAdmin'), icon: 'shield-outline', onPress: () => {
            setMemberMenu(null);
            memberAction.mutate({ kind: 'unadmin', m });
          } };
        return { key: a, label: t('groupInfo.removeMember'), icon: 'person-remove-outline', destructive: true, onPress: () => {
          setMemberMenu(null);
          confirmRemove(m);
        } };
      })
    : [];

  const openMember = useCallback((m: GroupMember) => router.push(`/user/${m.id}`), []);
  const openMemberMenu = useCallback((m: GroupMember) => setMemberMenu(m), []);

  // ---------- Leave / delete ----------

  const goInbox = () => router.dismissTo('/inbox' as Href);

  const dropFromInbox = () => {
    qc.setQueryData<ChatListItem[]>(chatKeys.chats(), (l) => l?.filter((c) => c.id !== chatId));
    void qc.invalidateQueries({ queryKey: chatKeys.chats(), exact: true });
    qc.removeQueries({ queryKey: groupKeys.detail(chatId), exact: true });
    qc.removeQueries({ queryKey: chatKeys.info(chatId), exact: true });
  };

  const leave = useMutation({
    mutationFn: () => leaveGroup(chatId),
    onSuccess: (r) => {
      dropFromInbox();
      showToast(r.deleted ? t('groupInfo.deleted') : t('groupInfo.left', { name: title }), 'exit-outline');
      goInbox();
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: () => deleteGroup(chatId),
    onSuccess: () => {
      dropFromInbox();
      showToast(t('groupInfo.deleted'), 'trash-outline');
      goInbox();
    },
    onError: fail,
  });

  // The server's succession rule (0147): the longest-standing admin, else
  // the longest-standing member.
  const heir = useMemo(() => {
    const others = (members ?? []).filter((m) => !m.isMe);
    const byJoin = (a: GroupMember, b: GroupMember) => (a.joined_at ?? '').localeCompare(b.joined_at ?? '');
    return others.filter((m) => m.role === 'admin').sort(byJoin)[0] ?? others.slice().sort(byJoin)[0] ?? null;
  }, [members]);

  const confirmLeave = () => {
    const body =
      memberCount <= 1
        ? t('groupInfo.leaveBodyLast')
        : owner && heir
          ? t('groupInfo.leaveBodyOwner', { heir: heir.name || heir.handle || t('groupInfo.sys.someone') })
          : t('groupInfo.leaveBody');
    Alert.alert(t('groupInfo.leaveTitle', { name: title }), body, [
      { text: t('groupInfo.cancel'), style: 'cancel' },
      { text: t('groupInfo.leaveConfirm'), style: 'destructive', onPress: () => leave.mutate() },
    ]);
  };

  const confirmDelete = () =>
    Alert.alert(t('groupInfo.deleteTitle', { name: title }), t('groupInfo.deleteBody'), [
      { text: t('groupInfo.cancel'), style: 'cancel' },
      { text: t('groupInfo.deleteConfirm'), style: 'destructive', onPress: () => remove.mutate() },
    ]);

  // ---------- Rendering ----------

  const renderItem = useCallback<ListRenderItem<GroupMember>>(
    ({ item }) => (
      <MemberRow
        member={item}
        hasActions={actionsFor(item).length > 0}
        busy={memberAction.isPending && memberAction.variables?.m.id === item.id}
        onOpen={openMember}
        onMenu={openMemberMenu}
      />
    ),
    [actionsFor, memberAction.isPending, memberAction.variables, openMember, openMemberMenu],
  );

  if (group.isLoading) {
    return (
      <Screen scroll={false} header={<TopBar title={t('groupInfo.title')} />}>
        <ActivityIndicator style={styles.loading} color={colors.primary} accessibilityLabel={t('groupInfo.loading')} />
      </Screen>
    );
  }
  if (group.isError && !data) {
    return (
      <Screen scroll={false} header={<TopBar title={t('groupInfo.title')} />}>
        <View style={styles.center}>
          <Text style={[styles.centerText, { color: colors.text }]} accessibilityRole="alert">
            {t('groupInfo.loadFailed')}
          </Text>
          <Button title={t('groupInfo.retry')} variant="secondary" onPress={() => void group.refetch()} style={styles.retry} />
        </View>
      </Screen>
    );
  }
  if (!data || data.missing || data.notGroup) {
    return <NotFoundState icon="people-outline" title={t('groupInfo.goneTitle')} body={t('groupInfo.goneBody')} />;
  }

  const created = data.created_at ? new Date(data.created_at) : null;
  const createdLabel =
    created && !Number.isNaN(created.getTime())
      ? t('groupInfo.created', {
          date: created.toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' }),
        })
      : '';
  const busyAll = leave.isPending || remove.isPending;

  const header = (
    <View>
      <View style={styles.hero}>
        <Pressable
          onPress={onPhotoPress}
          disabled={!admin && !data.photo_url}
          accessibilityRole={admin || data.photo_url ? 'button' : 'image'}
          accessibilityLabel={t('groupInfo.photoA11y')}
          accessibilityHint={admin ? t('groupInfo.photoHintAdmin') : data.photo_url ? t('groupInfo.photoHintView') : undefined}
          style={styles.photoWrap}
        >
          <Avatar uri={data.photo_url} name={title} size={104} />
          {photo.isPending ? (
            <View style={[styles.photoBusy, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : null}
          {admin ? (
            <View style={[styles.camBadge, { backgroundColor: colors.primary, borderColor: colors.bg }]}>
              <Ionicons name="camera" size={15} color={colors.onPrimary} />
            </View>
          ) : null}
        </Pressable>

        {editing ? (
          <View style={styles.editWrap}>
            <View style={[styles.editBox, { backgroundColor: colors.bg2, borderColor: nameError ? colors.danger : colors.border }]}>
              <TextInput
                value={draft}
                onChangeText={(v) => {
                  setDraft(v.slice(0, MAX_GROUP_NAME));
                  if (nameError) setNameError(null);
                }}
                autoFocus
                maxLength={MAX_GROUP_NAME}
                returnKeyType="done"
                onSubmitEditing={saveName}
                placeholder={t('groupInfo.nameLabel')}
                placeholderTextColor={colors.muted}
                accessibilityLabel={t('groupInfo.nameLabel')}
                style={[styles.editInput, { color: colors.text }]}
              />
              <Text style={[styles.counter, { color: colors.muted }]} accessibilityLabel={t('groupInfo.counterA11y', { n: draft.length, max: MAX_GROUP_NAME })}>
                {draft.length}/{MAX_GROUP_NAME}
              </Text>
            </View>
            {nameError ? (
              <Text style={[styles.fieldError, { color: colors.danger }]} accessibilityRole="alert">
                {nameError}
              </Text>
            ) : null}
            <View style={styles.editActions}>
              <Button title={t('groupInfo.cancel')} variant="secondary" onPress={() => setEditing(false)} disabled={rename.isPending} style={styles.flex} />
              <Button title={t('groupInfo.save')} onPress={saveName} loading={rename.isPending} style={styles.flex} />
            </View>
          </View>
        ) : (
          <View style={styles.nameLine}>
            <Text style={[styles.name, { color: colors.text }]} numberOfLines={2} accessibilityRole="header">
              {title}
            </Text>
            {admin ? (
              <Pressable
                onPress={startEdit}
                hitSlop={10}
                style={styles.iconBtn}
                accessibilityRole="button"
                accessibilityLabel={t('groupInfo.editName')}
              >
                <Ionicons name="pencil" size={18} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
        )}
        <Text style={[styles.sub, { color: colors.muted }]}>
          {[t('chat.members', { count: memberCount }), createdLabel].filter(Boolean).join(' · ')}
        </Text>
        {!admin ? <Text style={[styles.note, { color: colors.muted }]}>{t('groupInfo.adminsOnlyNote')}</Text> : null}
      </View>

      <View style={[styles.sectionHead, { borderTopColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.muted }]} accessibilityRole="header">
          {t('chat.members', { count: memberCount })}
        </Text>
      </View>
      {admin ? (
        <Pressable
          onPress={() => router.push(`/chat-add/${chatId}` as Href)}
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bg2 }]}
          accessibilityRole="button"
          accessibilityLabel={t('groupInfo.addMembers')}
        >
          <View style={[styles.addIcon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="person-add" size={20} color={colors.primary} />
          </View>
          <Text style={[styles.rowLabel, { color: colors.primary }]}>{t('groupInfo.addMembers')}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  const footer = (
    <View style={[styles.actions, { borderTopColor: colors.border }]}>
      <ActionRow icon="exit-outline" label={t('groupInfo.leave')} danger busy={leave.isPending} disabled={busyAll} onPress={confirmLeave} />
      {owner ? (
        <ActionRow icon="trash-outline" label={t('groupInfo.delete')} danger busy={remove.isPending} disabled={busyAll} onPress={confirmDelete} />
      ) : null}
    </View>
  );

  return (
    <Screen scroll={false} contentStyle={styles.screen} header={<TopBar title={t('groupInfo.title')} />}>
      <FlatList
        data={members}
        keyExtractor={keyOf}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        refreshing={group.isRefetching && !group.isLoading}
        onRefresh={() => void group.refetch()}
      />

      <ActionSheet visible={photoMenu} title={t('groupInfo.photoMenuTitle')} items={photoItems} onClose={() => setPhotoMenu(false)} />
      <ActionSheet
        visible={!!memberMenu}
        title={memberMenu ? memberMenu.name || memberMenu.handle || '' : ''}
        items={[
          ...(memberMenu
            ? [{ key: 'profile', label: t('groupInfo.viewProfile'), icon: 'person-outline' as const, onPress: () => {
                const m = memberMenu;
                setMemberMenu(null);
                openMember(m);
              } }]
            : []),
          ...memberItems,
        ]}
        onClose={() => setMemberMenu(null)}
      />
      <ImageViewer uri={viewing} onClose={() => setViewing(null)} />
    </Screen>
  );
}

const keyOf = (m: GroupMember) => m.id;

const MemberRow = memo(function MemberRow({
  member,
  hasActions,
  busy,
  onOpen,
  onMenu,
}: {
  member: GroupMember;
  hasActions: boolean;
  busy: boolean;
  onOpen: (m: GroupMember) => void;
  onMenu: (m: GroupMember) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const display = member.name || member.handle || t('groupInfo.sys.someone');
  const badge = member.role === 'owner' ? t('groupInfo.owner') : member.role === 'admin' ? t('groupInfo.admin') : null;
  const a11y = [display, member.isMe ? t('groupInfo.you') : null, member.handle ? atHandle(member.handle) : null, badge]
    .filter(Boolean)
    .join(', ');
  return (
    <View style={styles.memberRow}>
      <Pressable
        onPress={() => onOpen(member)}
        onLongPress={hasActions ? () => onMenu(member) : undefined}
        delayLongPress={300}
        style={({ pressed }) => [styles.row, styles.flex, pressed && { backgroundColor: colors.bg2 }]}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityHint={t('groupInfo.memberHint')}
      >
        <Avatar uri={member.avatar_url} name={display} size={46} />
        <View style={styles.rowBody}>
          <View style={styles.nameRow}>
            <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
              {display}
            </Text>
            {member.verified ? <Ionicons name="checkmark-circle" size={15} color={colors.primary2} /> : null}
            {member.isMe ? <Text style={[styles.you, { color: colors.muted }]}>({t('groupInfo.you')})</Text> : null}
          </View>
          {member.handle ? (
            <Text style={[styles.handle, { color: colors.muted }]} numberOfLines={1}>
              {atHandle(member.handle)}
            </Text>
          ) : null}
        </View>
        {badge ? (
          <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
            <Text style={[styles.badgeText, { color: colors.primary }]}>{badge}</Text>
          </View>
        ) : null}
        {busy ? <ActivityIndicator color={colors.primary} /> : null}
      </Pressable>
      {hasActions ? (
        <Pressable
          onPress={() => onMenu(member)}
          hitSlop={6}
          style={styles.more}
          accessibilityRole="button"
          accessibilityLabel={t('groupInfo.memberActions', { name: display })}
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
});

function ActionRow({
  icon,
  label,
  danger,
  busy,
  disabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  danger?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const color = danger ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bg2 }, disabled && !busy && styles.dim]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
    >
      <View style={styles.actionIcon}>
        {busy ? <ActivityIndicator color={color} /> : <Ionicons name={icon} size={22} color={color} />}
      </View>
      <Text style={[styles.rowLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

function ActionSheet({ visible, title, items, onClose }: { visible: boolean; title: string; items: MenuItem[]; onClose: () => void }) {
  const { colors } = useTheme();
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {title ? (
        <Text style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      {items.map((it) => (
        <Pressable
          key={it.key}
          onPress={it.onPress}
          style={({ pressed }) => [styles.sheetRow, pressed && { backgroundColor: colors.bg2 }]}
          accessibilityRole="button"
          accessibilityLabel={it.label}
        >
          <Ionicons name={it.icon} size={22} color={it.destructive ? colors.danger : colors.text} />
          <Text style={[styles.sheetLabel, { color: it.destructive ? colors.danger : colors.text }]}>{it.label}</Text>
        </Pressable>
      ))}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { paddingHorizontal: 0, paddingVertical: 0 },
  listContent: { paddingBottom: 32 },
  loading: { marginTop: 60 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  centerText: { fontSize: 15, textAlign: 'center' },
  retry: { paddingHorizontal: 24 },
  hero: { alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 18, gap: 8 },
  photoWrap: { width: 104, height: 104, marginBottom: 6 },
  photoBusy: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, borderRadius: 52, alignItems: 'center', justifyContent: 'center' },
  camBadge: {
    position: 'absolute',
    bottom: 0,
    end: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, maxWidth: '100%' },
  name: { fontSize: 22, fontWeight: '800', textAlign: 'center', flexShrink: 1 },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  sub: { fontSize: 14, textAlign: 'center' },
  note: { fontSize: 12.5, textAlign: 'center', marginTop: 2 },
  editWrap: { alignSelf: 'stretch', gap: 8 },
  editBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: 48 },
  editInput: { flex: 1, fontSize: 17, fontWeight: '600', paddingVertical: 10, textAlign: I18nManager.isRTL ? 'right' : 'left' },
  counter: { fontSize: 12 },
  fieldError: { fontSize: 13, textAlign: 'left' },
  editActions: { flexDirection: 'row', gap: 10 },
  sectionHead: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6, borderTopWidth: StyleSheet.hairlineWidth },
  sectionTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, textAlign: 'left' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 9, minHeight: 60 },
  rowLabel: { fontSize: 16, fontWeight: '600', flex: 1, textAlign: 'left' },
  addIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  memberRow: { flexDirection: 'row', alignItems: 'center' },
  rowBody: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  memberName: { fontSize: 16, fontWeight: '600', flexShrink: 1, textAlign: 'left' },
  you: { fontSize: 13 },
  handle: { fontSize: 13, textAlign: 'left' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  more: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginEnd: 6 },
  actions: { marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6 },
  actionIcon: { width: 46, alignItems: 'center' },
  dim: { opacity: 0.5 },
  sheetTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center', paddingHorizontal: 48, paddingVertical: 10 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, minHeight: 54 },
  sheetLabel: { fontSize: 16, fontWeight: '500', flex: 1, textAlign: 'left' },
});
