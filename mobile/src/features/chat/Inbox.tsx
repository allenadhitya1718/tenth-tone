import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type Href, router } from 'expo-router';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AppState,
  FlatList,
  I18nManager,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItem,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  type ChatListItem,
  chatKeys,
  fetchChats,
  markAllDelivered,
  markChatRead,
  subscribeToInbox,
} from '@/api/chat';
import { Button } from '@/components/ui';
import { StoryTray } from '@/features/stories/StoryTray';
import { timeAgo } from '@/lib/timeAgo';
import { useTheme } from '@/providers/ThemeProvider';

import { Avatar } from './Avatar';
import { previewText, translateTitle } from './format';

type Segment = 'primary' | 'requests';
const EMPTY: ChatListItem[] = [];

export function Inbox() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [segment, setSegment] = useState<Segment>('primary');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);

  const chats = useQuery({ queryKey: chatKeys.chats(), queryFn: fetchChats });

  // Live: any new message in any of my chats moves the preview, the order and
  // the unread dot without the chat being opened.
  useEffect(() => {
    const unsub = subscribeToInbox(() => {
      void qc.invalidateQueries({ queryKey: chatKeys.chats(), exact: true });
      void qc.invalidateQueries({ queryKey: chatKeys.unreadCount() });
    });
    return unsub;
  }, [qc]);

  // Client note 10: the sender's second grey tick means "reached this phone",
  // so it is stamped on open and every time the app comes back to the front.
  useEffect(() => {
    void markAllDelivered();
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      void markAllDelivered();
      void qc.invalidateQueries({ queryKey: chatKeys.chats(), exact: true });
    });
    return () => sub.remove();
  }, [qc]);

  const all = chats.data ?? EMPTY;
  const requests = useMemo(() => all.filter((c) => c.is_request), [all]);
  // The Requests segment only appears while something is waiting: an
  // always-visible empty tab is clutter (same rule as the web app).
  const active: Segment = requests.length ? segment : 'primary';

  const visible = useMemo(() => {
    const list = active === 'requests' ? requests : all.filter((c) => !c.is_request);
    const q = deferredQuery.trim().replace(/^@+/, '').toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.others.some((o) => o?.handle?.toLowerCase().includes(q) || o?.name?.toLowerCase().includes(q)),
    );
  }, [all, requests, active, deferredQuery]);

  const open = useCallback(
    (chat: ChatListItem) => {
      // Cleared now rather than on the next fetch, so coming back from the
      // thread does not still show it as unread.
      if (chat.unread_count) {
        qc.setQueryData<ChatListItem[]>(chatKeys.chats(), (list) =>
          list?.map((c) => (c.id === chat.id ? { ...c, unread_count: 0 } : c)),
        );
        void markChatRead(chat.id).then(() => qc.invalidateQueries({ queryKey: chatKeys.unreadCount() }));
      }
      router.push(`/chat/${chat.id}`);
    },
    [qc],
  );

  const renderItem = useCallback<ListRenderItem<ChatListItem>>(
    ({ item }) => <ChatRow chat={item} onOpen={open} />,
    [open],
  );

  const refreshing = chats.isRefetching && !chats.isLoading;
  // Friends' stories at the top of the inbox, like WhatsApp's Status row:
  // with the home tray gone they were otherwise only on profiles. Hidden
  // while searching and on the Requests segment.
  const showStories = active === 'primary' && !deferredQuery.trim();

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          {t('chat.inboxTitle')}
        </Text>
        <Pressable
          onPress={() => router.push('/chat-new' as Href)}
          hitSlop={10}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel={t('chat.newMessage')}
        >
          <Ionicons name="create-outline" size={26} color={colors.text} />
        </Pressable>
      </View>

      <View style={[styles.search, { backgroundColor: colors.bg2 }]}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('chat.searchChats')}
          placeholderTextColor={colors.muted}
          style={[styles.searchInput, { color: colors.text }]}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          accessibilityLabel={t('chat.searchChats')}
        />
      </View>

      {requests.length ? (
        <View style={styles.segments} accessibilityRole="tablist">
          <SegmentButton label={t('chat.primary')} selected={active === 'primary'} onPress={() => setSegment('primary')} />
          <SegmentButton
            label={t('chat.requests')}
            count={requests.length}
            selected={active === 'requests'}
            onPress={() => setSegment('requests')}
          />
        </View>
      ) : null}

      {active === 'requests' ? (
        <Text style={[styles.requestNote, { color: colors.muted }]}>{t('chat.requestsNote')}</Text>
      ) : null}

      {chats.isError && !all.length ? (
        <View style={styles.center}>
          <Text style={[styles.emptyText, { color: colors.text }]} accessibilityRole="alert">
            {t('chat.loadFailed')}
          </Text>
          <Button title={t('chat.retry')} variant="secondary" onPress={() => void chats.refetch()} style={styles.retry} />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={keyOf}
          renderItem={renderItem}
          ListHeaderComponent={showStories ? STORY_ROW : undefined}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          initialNumToRender={12}
          windowSize={7}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void chats.refetch()}
              tintColor={colors.muted}
              colors={[colors.primary]}
            />
          }
          ListEmptyComponent={
            chats.isLoading ? (
              <SkeletonRows />
            ) : (
              <View style={styles.center}>
                <Ionicons name="chatbubbles-outline" size={44} color={colors.muted2} />
                <Text style={[styles.emptyText, { color: colors.muted }]}>
                  {deferredQuery.trim() ? t('chat.noResults') : t('chat.empty')}
                </Text>
                {!deferredQuery.trim() ? (
                  <Button
                    title={t('chat.newMessage')}
                    variant="secondary"
                    onPress={() => router.push('/chat-new' as Href)}
                    style={styles.retry}
                  />
                ) : null}
              </View>
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

const keyOf = (c: ChatListItem) => c.id;
// One element, so the list does not remount the tray on every render.
const STORY_ROW = <StoryTray variant="surface" style={{ marginBottom: 4 }} />;

function SegmentButton({
  label,
  selected,
  count,
  onPress,
}: {
  label: string;
  selected: boolean;
  count?: number;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={count ? `${label} ${count}` : label}
      style={[styles.segment, { backgroundColor: selected ? colors.primarySoft : colors.bg2 }]}
    >
      <Text style={[styles.segmentText, { color: selected ? colors.text : colors.muted }]}>{label}</Text>
      {count ? (
        <View style={[styles.segmentCount, { backgroundColor: colors.primary }]}>
          <Text style={[styles.segmentCountText, { color: colors.onPrimary }]}>{count > 99 ? '99+' : count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const ChatRow = memo(function ChatRow({ chat, onOpen }: { chat: ChatListItem; onOpen: (c: ChatListItem) => void }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const unread = chat.unread_count > 0;
  const title = translateTitle(chat.title, t);
  const preview = previewText(chat.last_message, t);
  const when = timeAgo(chat.last_message?.created_at || chat.created_at, t, i18n.language);
  const a11y = [title, preview, when, unread ? t('chat.unreadCount', { count: chat.unread_count }) : '']
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      onPress={() => onOpen(chat)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bg2 }]}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint={t('chat.openHint')}
    >
      <Avatar uri={chat.avatar} name={title} size={52} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text
            numberOfLines={1}
            style={[styles.rowName, { color: colors.text }, unread && styles.bold]}
          >
            {title}
          </Text>
          <Text style={[styles.rowTime, { color: unread ? colors.primary2 : colors.muted }]}>{when}</Text>
        </View>
        <View style={styles.rowTop}>
          <Text
            numberOfLines={1}
            style={[styles.rowPreview, { color: unread ? colors.text : colors.muted }, unread && styles.semi]}
          >
            {preview}
          </Text>
          {unread ? (
            <View style={[styles.dot, { backgroundColor: colors.primary }]}>
              <Text style={[styles.dotText, { color: colors.onPrimary }]}>
                {chat.unread_count > 9 ? '9+' : chat.unread_count}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
});

// Placeholder rows while the first answer is out: "no conversations yet"
// before the server has replied would be a claim, not a fact.
function SkeletonRows() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={t('chat.loading')}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={styles.row}>
          <View style={[styles.skCircle, { backgroundColor: colors.bg2 }]} />
          <View style={styles.rowBody}>
            <View style={[styles.skLine, styles.skShort, { backgroundColor: colors.bg2 }]} />
            <View style={[styles.skLine, { backgroundColor: colors.bg2 }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 52 },
  title: { fontSize: 24, fontWeight: '800' },
  headerBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 12,
  },
  searchInput: { flex: 1, fontSize: 15, height: '100%', textAlign: I18nManager.isRTL ? 'right' : 'left' },
  segments: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 6 },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    minHeight: 36,
    borderRadius: 18,
  },
  segmentText: { fontSize: 14, fontWeight: '700' },
  segmentCount: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  segmentCountText: { fontSize: 11, fontWeight: '800' },
  requestNote: { fontSize: 13, paddingHorizontal: 16, paddingVertical: 4, textAlign: 'left' },
  listContent: { flexGrow: 1, paddingBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, minHeight: 72 },
  rowBody: { flex: 1, minWidth: 0, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowName: { flex: 1, fontSize: 16, fontWeight: '600', textAlign: 'left' },
  rowTime: { fontSize: 12 },
  rowPreview: { flex: 1, fontSize: 14, textAlign: 'left' },
  bold: { fontWeight: '800' },
  semi: { fontWeight: '600' },
  dot: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  dotText: { fontSize: 11, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyText: { fontSize: 15, textAlign: 'center' },
  retry: { paddingHorizontal: 24, alignSelf: 'center' },
  skCircle: { width: 52, height: 52, borderRadius: 26 },
  skLine: { height: 12, borderRadius: 6, width: '85%' },
  skShort: { width: '55%' },
});
