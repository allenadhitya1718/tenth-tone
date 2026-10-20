import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  I18nManager,
  KeyboardAvoidingView,
  type ListRenderItem,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { chatKeys, fetchChats } from '@/api/chat';
import { ApiError } from '@/api/client';
import { countShare, discoverKeys, fetchShareTargets, videoLink } from '@/api/discover';
import { normalizePeopleQuery, searchPeople, withoutBlocked } from '@/api/search';
import type { Uuid } from '@/api/types';
import { SEND_TO_MAX, type SendTarget, sendVideoToChats } from '@/api/videoShare';
import { showToast } from '@/components/Toast';
import { Avatar } from '@/features/chat/Avatar';
import { translateTitle } from '@/features/chat/format';
import { atHandle } from '@/lib/handle';
import { sendRefusalKey } from '@/lib/serverError';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/providers/ThemeProvider';

// "Send to", like Instagram: the share button of a video opens this sheet.
// Recent chats (groups included) come first, then people you follow or who
// follow you; typing searches those and everyone else. Tap up to
// SEND_TO_MAX to select them, add an optional message, Send. With nothing
// selected the footer offers Copy link and Share to other apps (the system
// sheet, as the share button did before).
//
// A share is counted once per completed share: once for an in-app send that
// reached at least one chat, once for a system share that really went to
// another app. Copying the link is not counted.

type Target = {
  key: string;
  title: string;
  sub: string | null;
  avatar: string | null;
  group: boolean;
  send: SendTarget;
};

const COLUMNS = 4;
const EMPTY: Target[] = [];

export function SendToSheet({
  videoId,
  visible,
  onClose,
  onShared,
}: {
  videoId: Uuid;
  visible: boolean;
  onClose: () => void;
  // A completed share (in-app or to another app), already counted on the
  // server; the caller bumps the count it shows.
  onShared: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { session } = useAuth();
  const me = session?.user.id;

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<Map<string, Target>>(() => new Map());
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  // State starts fresh on each mount: callers mount the sheet only while it
  // is open, so every opening is a clean sheet.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(normalizePeopleQuery(query)), 250);
    return () => clearTimeout(id);
  }, [query]);

  const chats = useQuery({ queryKey: chatKeys.chats(), queryFn: fetchChats, enabled: visible });
  const people = useQuery({
    queryKey: discoverKeys.shareTargets(),
    queryFn: async () => withoutBlocked(await fetchShareTargets()),
    enabled: visible,
    staleTime: 60_000,
  });
  const search = useQuery({
    queryKey: ['sendTo', 'search', debounced],
    queryFn: () => searchPeople(debounced, 20),
    enabled: visible && !!debounced,
  });

  // Recent chats first (the inbox order), then people with no DM yet. A
  // pending message request is left out: sending into it would read as an
  // answer to it.
  const base = useMemo<Target[]>(() => {
    const out: Target[] = [];
    const dmWith = new Set<Uuid>();
    for (const c of chats.data ?? []) {
      if (c.is_request) continue;
      const group = c.type === 'group';
      const other = !group ? c.others[0] : null;
      if (!group && !other) continue;
      if (other) dmWith.add(other.id);
      out.push({
        key: `c:${c.id}`,
        title: translateTitle(c.title, t),
        sub: other?.handle ? atHandle(other.handle) : null,
        avatar: c.avatar ?? null,
        group,
        send: { chatId: c.id },
      });
    }
    for (const p of people.data ?? []) {
      if (p.id === me || dmWith.has(p.id)) continue;
      out.push({
        key: `u:${p.id}`,
        title: p.name || p.handle || '',
        sub: p.handle ? atHandle(p.handle) : null,
        avatar: p.avatar_url,
        group: false,
        send: { userId: p.id },
      });
    }
    return out;
  }, [chats.data, people.data, me, t]);

  const shown = useMemo<Target[]>(() => {
    if (!debounced) return base;
    const q = debounced.toLowerCase();
    const local = base.filter((x) => x.title.toLowerCase().includes(q) || (x.sub ?? '').toLowerCase().includes(q));
    const known = new Set(local.map((x) => x.key));
    // A person already listed under their DM is not listed twice.
    const dmPeople = new Set(
      (chats.data ?? []).filter((c) => c.type !== 'group' && c.others[0]).map((c) => c.others[0]!.id),
    );
    const more = (search.data ?? [])
      .filter((p) => p.id !== me && !dmPeople.has(p.id) && !known.has(`u:${p.id}`))
      .map<Target>((p) => ({
        key: `u:${p.id}`,
        title: p.name || p.handle || '',
        sub: p.handle ? atHandle(p.handle) : null,
        avatar: p.avatar_url,
        group: false,
        send: { userId: p.id },
      }));
    return [...local, ...more];
  }, [base, debounced, search.data, chats.data, me]);

  const toggle = useCallback(
    (target: Target) => {
      setNotice(null);
      if (selected.has(target.key)) {
        const next = new Map(selected);
        next.delete(target.key);
        setSelected(next);
        return;
      }
      if (selected.size >= SEND_TO_MAX) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        setNotice({ text: t('sendTo.limit', { max: SEND_TO_MAX }), error: true });
        return;
      }
      void Haptics.selectionAsync().catch(() => {});
      setSelected(new Map(selected).set(target.key, target));
    },
    [selected, t],
  );

  const send = useMutation({
    mutationFn: (targets: Target[]) =>
      sendVideoToChats({ videoId, targets: targets.map((x) => x.send), note }).then((r) => ({ r, targets })),
    onSuccess: ({ r, targets }) => {
      void qc.invalidateQueries({ queryKey: chatKeys.chats(), exact: true });
      r.chatIds.forEach((id) => void qc.invalidateQueries({ queryKey: chatKeys.messages(id) }));
      if (r.sent) onShared();
      if (!r.failed) {
        onClose();
        showToast(t('sendTo.sent'), 'paper-plane');
        return;
      }
      // Keep the chats that did not get it selected, so Send retries just those.
      const left = new Map<string, Target>();
      targets.forEach((x, i) => {
        if (!r.ok[i]) left.set(x.key, x);
      });
      setSelected(left);
      const why =
        r.error instanceof ApiError && r.error.code === 'video_share_unsupported'
          ? t('sendTo.unsupported')
          : (sendRefusalKey(r.error) && t(sendRefusalKey(r.error)!)) || t('sendTo.failedBody');
      setNotice({
        text: r.sent
          ? `${t('sendTo.partial', { sent: r.sent, total: r.sent + r.failed })} ${t('sendTo.retryHint')}`
          : `${t('sendTo.failed')} ${why}`,
        error: true,
      });
    },
    onError: () => setNotice({ text: `${t('sendTo.failed')} ${t('sendTo.failedBody')}`, error: true }),
  });

  const link = videoLink(videoId);

  const copyLink = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(link);
      onClose();
      showToast(t('sendTo.linkCopied'), 'link');
    } catch {
      setNotice({ text: t('sendTo.copyFailed'), error: true });
    }
  }, [link, onClose, t]);

  // Only a completed share counts. iOS says so (sharedAction vs
  // dismissedAction). Android's Share.share resolves "shared" even when the
  // chooser is cancelled, so there a share counts only if the app really went
  // to the background, which is what picking a target app does and cancelling
  // the chooser does not.
  const shareOut = useCallback(async () => {
    let wentAway = false;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background' || s === 'inactive') wentAway = true;
    });
    try {
      const res = await Share.share({ message: link });
      const done = res.action === Share.sharedAction && (Platform.OS !== 'android' || wentAway);
      if (done) {
        void countShare(videoId);
        onShared();
        onClose();
      }
    } catch {
      /* a failed share sheet is not a share */
    } finally {
      sub.remove();
    }
  }, [link, onClose, onShared, videoId]);

  const selectedList = useMemo(() => Array.from(selected.values()), [selected]);
  const busy = send.isPending;

  const renderItem = useCallback<ListRenderItem<Target>>(
    ({ item }) => <TargetCell target={item} selected={selected.has(item.key)} disabled={busy} onPress={toggle} />,
    [selected, busy, toggle],
  );

  const loading = (chats.isLoading || people.isLoading) && !base.length;
  const failedLoad = chats.isError && people.isError && !base.length;
  const searching = !!debounced && search.isFetching && !shown.length;

  const empty = loading || searching ? (
    <ActivityIndicator style={styles.pad} color={colors.muted} accessibilityLabel={t('sendTo.loading')} />
  ) : failedLoad ? (
    <View style={[styles.pad, styles.center]}>
      <Text style={[styles.emptyText, { color: colors.muted }]}>{t('sendTo.loadError')}</Text>
      <Pressable
        onPress={() => {
          void chats.refetch();
          void people.refetch();
        }}
        style={[styles.retry, { borderColor: colors.border }]}
        accessibilityRole="button"
      >
        <Text style={[styles.retryText, { color: colors.text }]}>{t('sendTo.retry')}</Text>
      </Pressable>
    </View>
  ) : (
    <Text style={[styles.pad, styles.emptyText, { color: colors.muted }]}>
      {debounced ? t('sendTo.emptySearch', { q: debounced }) : t('sendTo.empty')}
    </Text>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('sendTo.close')} />
        <View
          style={[styles.panel, { backgroundColor: colors.bg, paddingBottom: Math.max(insets.bottom, 12) }]}
          accessibilityViewIsModal
        >
          <View style={[styles.grabber, { backgroundColor: colors.muted2 }]} />
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header" numberOfLines={1}>
              {t('sendTo.title')}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel={t('sendTo.close')}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>

          <View style={[styles.searchBox, { backgroundColor: colors.bg2 }]}>
            <Ionicons name="search" size={18} color={colors.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('sendTo.search')}
              placeholderTextColor={colors.muted}
              style={[styles.searchInput, { color: colors.text }]}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel={t('sendTo.search')}
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('sendTo.clearSearch')}>
                <Ionicons name="close-circle" size={18} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>

          <FlatList
            data={loading || failedLoad ? EMPTY : shown}
            keyExtractor={keyOf}
            renderItem={renderItem}
            extraData={selected}
            numColumns={COLUMNS}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListEmptyComponent={empty}
            style={styles.list}
            contentContainerStyle={styles.grid}
          />

          {notice ? (
            <View
              style={[styles.notice, { backgroundColor: notice.error ? colors.bg2 : colors.primarySoft }]}
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
            >
              <Ionicons name={notice.error ? 'alert-circle' : 'information-circle'} size={18} color={notice.error ? colors.danger : colors.primary2} />
              <Text style={[styles.noticeText, { color: colors.text }]}>{notice.text}</Text>
            </View>
          ) : null}

          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            {selectedList.length ? (
              <>
                <Text style={[styles.toLine, { color: colors.muted }]} numberOfLines={1}>
                  {t('sendTo.to', { names: selectedList.map((x) => x.title).join(', ') })}
                </Text>
                <View style={styles.sendRow}>
                  <TextInput
                    value={note}
                    onChangeText={setNote}
                    placeholder={t('sendTo.notePlaceholder')}
                    placeholderTextColor={colors.muted}
                    style={[styles.note, { color: colors.text, backgroundColor: colors.bg2 }]}
                    maxLength={1000}
                    multiline
                    editable={!busy}
                    accessibilityLabel={t('sendTo.notePlaceholder')}
                  />
                  <Pressable
                    onPress={() => send.mutate(selectedList)}
                    disabled={busy}
                    style={({ pressed }) => [styles.sendBtn, { backgroundColor: colors.primary }, (pressed || busy) && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={t('sendTo.send')}
                    accessibilityHint={t('sendTo.sendHint', { n: selectedList.length, max: SEND_TO_MAX })}
                    accessibilityState={{ busy, disabled: busy }}
                  >
                    {busy ? (
                      <ActivityIndicator color={colors.onPrimary} />
                    ) : (
                      <Text style={[styles.sendText, { color: colors.onPrimary }]}>{t('sendTo.send')}</Text>
                    )}
                  </Pressable>
                </View>
              </>
            ) : (
              <View style={styles.actions}>
                <FooterAction icon="link" label={t('sendTo.copyLink')} onPress={() => void copyLink()} />
                <FooterAction icon="share-social" label={t('sendTo.otherApps')} onPress={() => void shareOut()} />
              </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const keyOf = (x: Target) => x.key;

const TargetCell = memo(function TargetCell({
  target,
  selected,
  disabled,
  onPress,
}: {
  target: Target;
  selected: boolean;
  disabled: boolean;
  onPress: (x: Target) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const label = [target.title, target.group ? t('sendTo.group') : target.sub].filter(Boolean).join(', ');
  return (
    <Pressable
      onPress={() => onPress(target)}
      disabled={disabled}
      style={styles.cell}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
    >
      <View style={[styles.avatarWrap, selected && { borderColor: colors.primary }]}>
        <Avatar uri={target.avatar} name={target.title} size={58} />
        {target.group ? (
          <View style={[styles.groupBadge, { backgroundColor: colors.bg3, borderColor: colors.bg }]}>
            <Ionicons name="people" size={12} color={colors.text} />
          </View>
        ) : null}
        {selected ? (
          <View style={[styles.check, { backgroundColor: colors.primary, borderColor: colors.bg }]}>
            <Ionicons name="checkmark" size={14} color={colors.onPrimary} />
          </View>
        ) : null}
      </View>
      <Text style={[styles.cellName, { color: colors.text }, selected && styles.cellNameOn]} numberOfLines={2}>
        {target.title || ' '}
      </Text>
    </Pressable>
  );
});

function FooterAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} style={styles.action} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[styles.actionIcon, { backgroundColor: colors.bg2 }]}>
        <Ionicons name={icon} size={22} color={colors.text} />
      </View>
      <Text style={[styles.actionText, { color: colors.text }]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...(StyleSheet.absoluteFill as object), backgroundColor: 'rgba(0,0,0,0.45)' },
  panel: { borderTopLeftRadius: 20, borderTopRightRadius: 20, height: '80%', overflow: 'hidden' },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 8 },
  header: { flexDirection: 'row', alignItems: 'center', paddingStart: 16, paddingEnd: 8, paddingTop: 6 },
  title: { flex: 1, fontSize: 17, fontWeight: '800', textAlign: 'left' },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 42,
    borderRadius: 12,
  },
  searchInput: { flex: 1, fontSize: 15, height: '100%', textAlign: I18nManager.isRTL ? 'right' : 'left' },
  list: { flex: 1 },
  grid: { paddingHorizontal: 8, paddingBottom: 8 },
  pad: { padding: 24 },
  center: { alignItems: 'center', gap: 12 },
  emptyText: { fontSize: 14, textAlign: 'center' },
  retry: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, borderWidth: 1 },
  retryText: { fontWeight: '700' },
  cell: { width: `${100 / COLUMNS}%`, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4, gap: 6 },
  avatarWrap: { borderRadius: 34, borderWidth: 2.5, borderColor: 'transparent', padding: 2 },
  groupBadge: {
    position: 'absolute',
    bottom: 0,
    start: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    position: 'absolute',
    bottom: 0,
    end: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellName: { fontSize: 12.5, textAlign: 'center', lineHeight: 16 },
  cellNameOn: { fontWeight: '700' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: 10 },
  noticeText: { flex: 1, fontSize: 13, textAlign: 'left' },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  toLine: { fontSize: 13, textAlign: 'left' },
  sendRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  note: {
    flex: 1,
    minHeight: 44,
    maxHeight: 110,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 11,
    fontSize: 15,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
  },
  sendBtn: { minWidth: 80, height: 44, borderRadius: 22, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  sendText: { fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.75 },
  actions: { flexDirection: 'row', gap: 20, paddingBottom: 2 },
  action: { alignItems: 'center', width: 84, gap: 6 },
  actionIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 12.5, textAlign: 'center' },
});
