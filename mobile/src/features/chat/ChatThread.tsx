import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { type Href, router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  FlatList,
  I18nManager,
  KeyboardAvoidingView,
  type ListRenderItem,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  acceptChatRequest,
  type ChatListItem,
  chatKeys,
  declineChatRequest,
  fetchChatInfo,
  fetchChats,
  type Tick,
  tickFor,
} from '@/api/chat';
import { ApiError } from '@/api/client';
import type { LocalMedia } from '@/api/upload';
import { NotFoundState } from '@/components/NotFoundState';
import { Button } from '@/components/ui';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/providers/ThemeProvider';

import { Avatar } from './Avatar';
import { ChatBackground } from './ChatBackground';
import { Composer } from './Composer';
import { dayKey, dayLabel, translateTitle } from './format';
import { ImageViewer } from './ImageViewer';
import { DaySeparator, MessageBubble } from './MessageBubble';
import { MessageMenu } from './MessageMenu';
import { type ThreadMessage, useThread } from './useThread';
import { useWalkie } from './walkie/useWalkie';
import { WalkieBanner } from './walkie/WalkieBanner';
import { useActiveChat } from '@/features/notifications/push';
import { CallButtons } from '@/features/call/CallButtons';

// Client note 26: live walkie-talkie voice (push-to-talk over an Agora
// channel per chat, nothing stored) lives in ./walkie; the thread owns the
// session so it ends with the screen.

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'msg'; key: string; msg: ThreadMessage; tick: Tick | null; author: string | null };

const EMPTY: ThreadMessage[] = [];

export function ChatThread({ chatId }: { chatId: string }) {
  // Pushes for the chat on screen are not shown as banners.
  useActiveChat(chatId);
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const { session } = useAuth();
  const me = session?.user.id;
  const qc = useQueryClient();
  const listRef = useRef<FlatList<Row>>(null);

  const info = useQuery({ queryKey: chatKeys.info(chatId), queryFn: () => fetchChatInfo(chatId) });
  // Whether this thread is an unaccepted request comes from the inbox list
  // (chat_request_flags); it is never guessed.
  const chats = useQuery({ queryKey: chatKeys.chats(), queryFn: fetchChats });
  const listed = chats.data?.find((c) => c.id === chatId);
  const isRequest = listed?.is_request === true;

  const { messages, receipts, send, react, remove } = useThread(chatId, me, info.data);

  const myName = (session?.user.user_metadata as { name?: string } | undefined)?.name ?? null;
  const walkie = useWalkie({
    chatId,
    me,
    myName,
    others: info.data?.others,
    // Not inside an unanswered request: accepting comes first.
    allowed: !!info.data && !isRequest,
  });

  const [emojiOpen, setEmojiOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<ThreadMessage | null>(null);
  const [menuFor, setMenuFor] = useState<ThreadMessage | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    AccessibilityInfo.announceForAccessibility(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const isGroup = info.data?.type === 'group';
  const other = !isGroup ? info.data?.others[0] : undefined;
  const title = translateTitle(info.data?.title ?? listed?.title ?? '', t);
  const photo = info.data?.photo || listed?.avatar || null;

  // Oldest-to-newest messages become newest-first rows for the inverted
  // list, with a day label above (after, in array order) each day's first
  // message.
  const list = messages.data ?? EMPTY;
  const receiptList = receipts.data;
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let lastDay = '';
    const names = new Map((info.data?.others ?? []).map((o) => [o.id, o.name || o.handle || '']));
    for (const m of list) {
      const day = dayKey(m.created_at);
      if (day && day !== lastDay) {
        lastDay = day;
        out.push({ kind: 'day', key: `day-${day}`, label: dayLabel(m.created_at, t, i18n.language) });
      }
      const mine = m.from_user_id === me;
      out.push({
        kind: 'msg',
        key: m.localId ?? m.id,
        msg: m,
        tick: mine && !m.pending ? tickFor(m, receiptList ?? []) : null,
        author: isGroup && !mine ? m.from?.name || names.get(m.from_user_id) || null : null,
      });
    }
    return out.reverse();
  }, [list, receiptList, me, isGroup, info.data?.others, t, i18n.language]);

  // ---------- Sending ----------

  const failSend = useCallback(
    (e: unknown) => {
      const quota = e instanceof ApiError && e.code === 'quota_exceeded';
      Alert.alert(t('chat.sendFailed'), quota ? t('chat.errQuota') : undefined);
    },
    [t],
  );

  const sendText = useCallback(
    async (text: string) => {
      const reply = replyTo;
      setReplyTo(null);
      try {
        return await send({ text, replyTo: reply });
      } catch (e) {
        failSend(e);
        return false;
      }
    },
    [send, replyTo, failSend],
  );

  const sendMedia = useCallback(
    async (type: 'image' | 'voice', media: LocalMedia) => {
      const reply = replyTo;
      setReplyTo(null);
      try {
        await send({ text: '', type, media, replyTo: reply });
      } catch (e) {
        failSend(e);
      }
    },
    [send, replyTo, failSend],
  );

  const sendVoice = useCallback((media: LocalMedia) => void sendMedia('voice', media), [sendMedia]);

  const pickImage = useCallback(async () => {
    setEmojiOpen(false);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      await sendMedia('image', {
        uri: a.uri,
        mimeType: a.mimeType ?? 'image/jpeg',
        size: a.fileSize ?? null,
        name: a.fileName ?? null,
      });
    } catch {
      showToast(t('chat.pickFailed'));
    }
  }, [sendMedia, showToast, t]);

  // ---------- Message actions ----------

  const openMenu = useCallback((m: ThreadMessage) => {
    void Haptics.selectionAsync().catch(() => {});
    setEmojiOpen(false);
    setMenuFor(m);
  }, []);

  const onReact = useCallback(
    (m: ThreadMessage, emoji: string) => {
      react(m.id, emoji).catch(() => showToast(t('chat.reactFailed')));
    },
    [react, showToast, t],
  );

  const onCopy = useCallback(
    (m: ThreadMessage) => {
      if (!m.text) return;
      void Clipboard.setStringAsync(m.text).then(() => showToast(t('chat.copied')));
    },
    [showToast, t],
  );

  const onDelete = useCallback(
    (m: ThreadMessage) => {
      // Messages are deleted outright (own messages only), so it is gone for
      // everyone in the chat; the dialog says exactly that.
      Alert.alert(t('fix4.chatDeleteTitle'), t('fix4.chatDeleteBody'), [
        { text: t('chat.cancel'), style: 'cancel' },
        {
          text: t('fix4.chatDeleteConfirm'),
          style: 'destructive',
          onPress: () => {
            if (replyTo?.id === m.id) setReplyTo(null);
            remove(m.id).catch(() => showToast(t('chat.deleteFailed')));
          },
        },
      ]);
    },
    [remove, replyTo, showToast, t],
  );

  const scrollToMessage = useCallback(
    (id: string) => {
      const index = rows.findIndex((r) => r.kind === 'msg' && r.msg.id === id);
      if (index === -1) {
        showToast(t('chat.quoteNotLoaded'));
        return;
      }
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    },
    [rows, showToast, t],
  );

  // ---------- Requests ----------

  const accept = useMutation({
    mutationFn: () => acceptChatRequest(chatId),
    onSuccess: () => {
      qc.setQueryData<ChatListItem[]>(chatKeys.chats(), (l) => l?.map((c) => (c.id === chatId ? { ...c, is_request: false } : c)));
      void qc.invalidateQueries({ queryKey: chatKeys.chats(), exact: true });
      showToast(t('chat.requestAccepted'));
    },
    onError: () => Alert.alert(t('chat.acceptFailed')),
  });

  const decline = useMutation({
    mutationFn: () => declineChatRequest(chatId),
    onSuccess: () => {
      qc.setQueryData<ChatListItem[]>(chatKeys.chats(), (l) => l?.filter((c) => c.id !== chatId));
      void qc.invalidateQueries({ queryKey: chatKeys.chats(), exact: true });
      goBack();
    },
    onError: () => Alert.alert(t('chat.declineFailed')),
  });

  const confirmDecline = () =>
    Alert.alert(t('chat.declineTitle'), t('chat.declineBody'), [
      { text: t('chat.cancel'), style: 'cancel' },
      { text: t('chat.decline'), style: 'destructive', onPress: () => decline.mutate() },
    ]);

  // ---------- Rendering ----------

  const renderItem = useCallback<ListRenderItem<Row>>(
    ({ item }) =>
      item.kind === 'day' ? (
        <DaySeparator label={item.label} />
      ) : (
        <MessageBubble
          item={item.msg}
          mine={item.msg.from_user_id === me}
          tick={item.tick}
          authorName={item.author}
          myId={me}
          onMenu={openMenu}
          onOpenImage={setViewing}
          onQuotePress={scrollToMessage}
        />
      ),
    [me, openMenu, scrollToMessage],
  );

  const replyName = replyTo
    ? replyTo.from_user_id === me
      ? t('chat.replyToYourself')
      : replyTo.from?.name || (!isGroup && title)
        ? t('chat.replyingTo', { name: replyTo.from?.name || title })
        : t('fix4.quotedMessage')
    : '';

  const closeEmoji = useCallback(() => setEmojiOpen(false), []);
  const cancelReply = useCallback(() => setReplyTo(null), []);

  // A link to a conversation that does not exist (or is not yours): no empty
  // thread with a live composer.
  if (info.data?.missing) {
    return <NotFoundState icon="chatbubbles-outline" title={t('fix4.notFoundChatTitle')} body={t('fix4.notFoundChatBody')} />;
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={goBack} hitSlop={10} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel={t('chat.back')}>
          <Ionicons name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'} size={28} color={colors.text} />
        </Pressable>
        <Pressable
          onPress={() => other && router.push(`/user/${other.id}`)}
          disabled={!other}
          style={styles.identity}
          accessibilityRole={other ? 'button' : 'header'}
          accessibilityLabel={title}
          accessibilityHint={other ? t('chat.openProfileHint') : undefined}
        >
          <Avatar uri={photo} name={title} size={38} />
          <View style={styles.identityText}>
            <Text style={[styles.headerName, { color: colors.text }]} numberOfLines={1}>
              {title || ' '}
            </Text>
            {isGroup ? (
              <Text style={[styles.headerSub, { color: colors.muted }]} numberOfLines={1}>
                {t('chat.members', { count: info.data?.memberCount ?? 0 })}
              </Text>
            ) : other?.handle ? (
              <Text style={[styles.headerSub, { color: colors.muted }]} numberOfLines={1}>
                @{other.handle}
              </Text>
            ) : null}
          </View>
        </Pressable>
        {/* Calling is one-to-one: a group has nobody single to ring. */}
        {other && !isRequest ? <CallButtons peer={other} chatId={chatId} /> : null}
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        {/* Any touch on the thread closes the emoji panel (client note 29). */}
        <View style={styles.flex} onTouchStart={emojiOpen ? closeEmoji : undefined}>
          <ChatBackground />
          {messages.isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} accessibilityLabel={t('chat.loading')} />
            </View>
          ) : messages.isError && !list.length ? (
            <View style={styles.center}>
              <Text style={[styles.centerText, { color: colors.text }]} accessibilityRole="alert">
                {t('chat.loadMessagesFailed')}
              </Text>
              <Button title={t('chat.retry')} variant="secondary" onPress={() => void messages.refetch()} style={styles.retry} />
            </View>
          ) : (
            <>
              <FlatList
                ref={listRef}
                data={rows}
                inverted
                keyExtractor={keyOf}
                renderItem={renderItem}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                onScrollBeginDrag={closeEmoji}
                contentContainerStyle={styles.listContent}
                initialNumToRender={20}
                maxToRenderPerBatch={20}
                windowSize={11}
                onScrollToIndexFailed={(e) => {
                  listRef.current?.scrollToOffset({ offset: e.averageItemLength * e.index, animated: true });
                  setTimeout(() => listRef.current?.scrollToIndex({ index: e.index, animated: true, viewPosition: 0.5 }), 250);
                }}
              />
              {!rows.length ? (
                <View style={styles.intro} pointerEvents="none">
                  <Avatar uri={photo} name={title} size={76} />
                  <Text style={[styles.introName, { color: colors.text }]}>{title}</Text>
                  <Text style={[styles.introSub, { color: colors.muted }]}>
                    {isGroup ? t('chat.noMessagesYet') : t('chat.sayHello')}
                  </Text>
                </View>
              ) : null}
            </>
          )}
          <WalkieBanner walkie={walkie} />
          {toast ? (
            <View style={[styles.toast, { backgroundColor: colors.bg3 }]} pointerEvents="none">
              <Text style={[styles.toastText, { color: colors.text }]}>{toast}</Text>
            </View>
          ) : null}
        </View>

        {isRequest ? (
          <View style={[styles.requestBar, { borderTopColor: colors.border, backgroundColor: colors.bg }]}>
            <Text style={[styles.requestNote, { color: colors.muted }]}>{t('chat.requestPrompt')}</Text>
            <View style={styles.requestActions}>
              <Button
                title={t('chat.decline')}
                variant="secondary"
                onPress={confirmDecline}
                loading={decline.isPending}
                disabled={accept.isPending}
                style={styles.flex}
              />
              <Button
                title={t('chat.accept')}
                onPress={() => accept.mutate()}
                loading={accept.isPending}
                disabled={decline.isPending}
                style={styles.flex}
              />
            </View>
          </View>
        ) : (
          <Composer
            replyTo={replyTo}
            replyName={replyName}
            onCancelReply={cancelReply}
            emojiOpen={emojiOpen}
            setEmojiOpen={setEmojiOpen}
            onSendText={sendText}
            onPickImage={pickImage}
            onSendVoice={sendVoice}
            walkie={walkie}
          />
        )}
      </KeyboardAvoidingView>

      <MessageMenu
        message={menuFor}
        mine={!!menuFor && menuFor.from_user_id === me}
        onClose={() => setMenuFor(null)}
        onReact={onReact}
        onReply={setReplyTo}
        onCopy={onCopy}
        onDelete={onDelete}
      />
      <ImageViewer uri={viewing} onClose={() => setViewing(null)} />
    </SafeAreaView>
  );
}

const keyOf = (r: Row) => r.key;

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/inbox' as Href);
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    height: 58,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  identity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  identityText: { flex: 1, minWidth: 0 },
  headerName: { fontSize: 16, fontWeight: '700', textAlign: 'left' },
  headerSub: { fontSize: 12.5, textAlign: 'left' },
  listContent: { paddingVertical: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  centerText: { fontSize: 15, textAlign: 'center' },
  retry: { paddingHorizontal: 24 },
  intro: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  introName: { fontSize: 18, fontWeight: '800', marginTop: 6 },
  introSub: { fontSize: 14, textAlign: 'center' },
  toast: { position: 'absolute', bottom: 14, alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 18 },
  toastText: { fontSize: 14, fontWeight: '600' },
  requestBar: { padding: 14, gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
  requestNote: { fontSize: 14, textAlign: 'center' },
  requestActions: { flexDirection: 'row', gap: 10 },
});
