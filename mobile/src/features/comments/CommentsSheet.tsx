import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { type ComponentRef, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  I18nManager,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  type Comment,
  commentKeys,
  deleteComment,
  fetchComments,
  fetchCommentsAccess,
  isCommentBlocked,
  likeComment,
  type MentionCandidate,
  postComment,
  searchMentions,
  unlikeComment,
} from '@/api/comments';
import { ApiError } from '@/api/client';
import { videoKeys } from '@/api/videos';
import { NotFoundState } from '@/components/NotFoundState';
import { EmojiPanel, QuickEmojis } from '@/components/emoji/EmojiPanel';
import { patchVideoEverywhere } from '@/features/feed/cache';
import { formatCount } from '@/features/feed/format';
import { ReportSheet } from '@/features/safety/ReportSheet';
import { timeAgo } from '@/lib/timeAgo';
import { useAuth } from '@/providers/AuthProvider';
import { atHandle } from '@/lib/handle';
import { useTheme } from '@/providers/ThemeProvider';

const MAX_LEN = 500;

type Reply = { parentId: string; handle: string };
type Row =
  | { kind: 'comment'; comment: Comment; reply: boolean }
  | { kind: 'toggle'; parentId: string; count: number; open: boolean };

// Top-level comments keep the server's order (newest first). Replies sit one
// level under their parent, oldest first, behind a "View replies" toggle.
function buildRows(list: Comment[], expanded: Set<string>): Row[] {
  const ids = new Set(list.map((c) => c.id));
  const kids = new Map<string, Comment[]>();
  const tops: Comment[] = [];
  for (const c of list) {
    if (c.parent_id) {
      // A reply whose parent is gone (deleted, filtered or blocked) goes too.
      if (!ids.has(c.parent_id)) continue;
      kids.set(c.parent_id, [...(kids.get(c.parent_id) ?? []), c]);
    } else {
      tops.push(c);
    }
  }
  const rows: Row[] = [];
  for (const c of tops) {
    rows.push({ kind: 'comment', comment: c, reply: false });
    const k = (kids.get(c.id) ?? []).slice().reverse();
    if (!k.length) continue;
    const open = expanded.has(c.id);
    rows.push({ kind: 'toggle', parentId: c.id, count: k.length, open });
    if (open) for (const r of k) rows.push({ kind: 'comment', comment: r, reply: true });
  }
  return rows;
}

// The @word being typed right before the cursor, if any. The @ must start a
// word so an e-mail address does not open the list.
function mentionToken(text: string, cursor: number) {
  const m = /(^|\s)@([A-Za-z0-9_.]{1,30})$/.exec(text.slice(0, cursor));
  return m ? { prefix: m[2], start: cursor - m[2].length - 1, end: cursor } : null;
}

export function CommentsSheet({ videoId }: { videoId: string }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // The sheet sits at the bottom of a transparent modal, where KeyboardAvoidingView
  // did not lift it (seen on a Redmi, Android 12): lift the whole panel by the
  // keyboard height ourselves and shrink it so its top stays on screen.
  const [kbHeight, setKbHeight] = useState(0);
  const { session } = useAuth();
  const me = session?.user.id;
  const qc = useQueryClient();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [text, setText] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<Reply | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [reporting, setReporting] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [prefix, setPrefix] = useState('');

  const key = commentKeys.thread(videoId);
  const q = useQuery({ queryKey: key, queryFn: () => fetchComments(videoId) });
  // COMMENTS-08: the owner can switch comments off. null (unknown) is treated
  // as on; the server still has the final say.
  const access = useQuery({ queryKey: commentKeys.allowed(videoId), queryFn: () => fetchCommentsAccess(videoId) });
  const off = access.data?.exists === true && !access.data.allowed;
  // A link to a video that is gone: say so instead of an empty sheet.
  const missing = access.data?.exists === false;

  // @mentions: debounce the typed prefix, then ask search_handles.
  const token = mentionToken(text, cursor);
  useEffect(() => {
    const p = token?.prefix ?? '';
    const id = setTimeout(() => setPrefix(p), p ? 150 : 0);
    return () => clearTimeout(id);
  }, [token?.prefix]);
  const mentions = useQuery({
    queryKey: commentKeys.mentions(prefix),
    queryFn: () => searchMentions(prefix, 5),
    enabled: !!prefix && !!token,
    staleTime: 60_000,
  });
  const suggestions = token && prefix === token.prefix ? (mentions.data ?? []) : [];

  function pickMention(p: MentionCandidate) {
    if (!token) return;
    const insert = `@${p.handle} `;
    const next = (text.slice(0, token.start) + insert + text.slice(token.end)).slice(0, MAX_LEN);
    setText(next);
    setCursor(token.start + insert.length);
    setPrefix('');
    input.current?.focus();
  }

  function startReply(c: Comment) {
    const parentId = c.parent_id ?? c.id;
    const handle = c.user?.handle ?? c.user?.name ?? '';
    setReplyTo({ parentId, handle });
    setExpanded((s) => new Set(s).add(parentId));
    if (!text.trim() && handle) {
      setText(`@${handle} `);
      setCursor(handle.length + 2);
    }
    input.current?.focus();
  }

  function bumpCount(delta: number) {
    patchVideoEverywhere(qc, videoId, (v) => ({ ...v, comments_count: Math.max(0, (v.comments_count ?? 0) + delta) }));
  }

  // Note 29: the emoji panel gives way to the keyboard.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', (e) => {
      setEmojiOpen(false);
      // endCoordinates.height leaves out the navigation-bar inset on edge-to-edge
      // Android (measured: the composer sat ~24 px under the keyboard), so add it.
      setKbHeight(e.endCoordinates.height + insets.bottom);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbHeight(0));
    return () => {
      sub.remove();
      hide.remove();
    };
  }, [insets.bottom]);

  const send = useMutation({
    mutationFn: ({ body, parentId }: { body: string; parentId: string | null }) =>
      postComment(
        videoId,
        body,
        (id) => {
          // Moderation withdrew it after it was posted.
          // The server's message is Arabic only; ours follows the app language.
          qc.setQueryData<Comment[]>(key, (list) => list?.filter((c) => c.id !== id));
          bumpCount(-1);
          Alert.alert(t('comments.withdrawn'), t('comments.blockedBody'));
        },
        parentId,
      ),
    onSuccess: (comment) => {
      // A comment with one of MY hidden words stays out of my thread, as it
      // would after a refetch. It is still posted, so the counter moves.
      if (!comment.hiddenForMe) qc.setQueryData<Comment[]>(key, (list) => [comment, ...(list ?? [])]);
      // The feed's counter would otherwise stay behind until the next refetch.
      bumpCount(1);
      void qc.invalidateQueries({ queryKey: videoKeys.video(videoId) });
    },
    onError: (e, { body }) => {
      // COMMENTS-09: refused by the server's word filter (0135). Say why, in
      // the app's language, and give the text back so it can be reworded.
      if (isCommentBlocked(e)) {
        setText((v) => v || body);
        Alert.alert(t('comments.blocked'), t('comments.blockedBody'));
        return;
      }
      Alert.alert(
        t('comments.sendFailed'),
        e instanceof ApiError && e.code === 'content_blocked' ? (e.message ?? undefined) : undefined,
      );
    },
  });

  function submit() {
    const body = text.trim();
    if (!body || send.isPending) return;
    send.mutate({ body, parentId: replyTo?.parentId ?? null });
    setText('');
    setReplyTo(null);
    setCursor(0);
    // Note 8: the keyboard stays open after sending, so a second comment
    // does not need another tap on the field.
    input.current?.focus();
  }

  function addEmoji(e: string) {
    setText((v) => (v + e).slice(0, MAX_LEN));
  }

  function closeInputs() {
    setEmojiOpen(false);
    if (Keyboard.isVisible()) Keyboard.dismiss();
  }

  function toggleEmoji() {
    if (emojiOpen) {
      setEmojiOpen(false);
      input.current?.focus();
    } else {
      Keyboard.dismiss();
      setEmojiOpen(true);
    }
  }

  const comments = q.data ?? [];
  const rows = useMemo(() => buildRows(comments, expanded), [comments, expanded]);

  if (missing) {
    return (
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={() => router.back()} accessibilityLabel={t('legal.close')} />
        <SafeAreaView style={[styles.panel, { height: height * 0.5, backgroundColor: colors.bg }]} edges={['bottom']}>
          <NotFoundState embedded title={t('fix4.notFoundVideoTitle')} body={t('fix4.notFoundVideoBody')} />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.backdrop}>
    <Pressable style={{ flex: 1 }} onPress={() => router.back()} accessibilityLabel={t('legal.close')} />
    <SafeAreaView
      style={[styles.panel, { height: Math.min(height * 0.75, height - kbHeight - 120), marginBottom: kbHeight, backgroundColor: colors.bg }]}
      edges={kbHeight ? [] : ['bottom']}
    >
      <View style={[styles.grabber, { backgroundColor: colors.muted2 }]} />
      <View style={[styles.header, { borderBottomColor: colors.border }]} onTouchStart={closeInputs}>
        <Text style={[styles.title, { color: colors.text }]}>
          {t('comments.title', { count: comments.length })}
        </Text>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('legal.close')}>
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
      </View>

      <View style={{ flex: 1 }}>
        {/* Note 29: any touch on the list (a row, its buttons, or the blank
            area) closes the emoji panel and the keyboard. onTouchStart sees
            the touch without claiming it, so like, long-press and the
            avatar still work; a wrapping Pressable never ran because the
            row's own Pressable took the touch first. */}
        <View style={{ flex: 1 }} onTouchStart={closeInputs}>
          <FlatList
            data={rows}
            keyExtractor={(r) => (r.kind === 'comment' ? r.comment.id : `toggle-${r.parentId}`)}
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={() => setEmojiOpen(false)}
            contentContainerStyle={{ paddingVertical: 8, flexGrow: 1 }}
            ListEmptyComponent={
              q.isLoading ? (
                <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
              ) : off ? (
                <></>
              ) : (
                <Text style={[styles.empty, { color: colors.muted }]}>{t('comments.empty')}</Text>
              )
            }
            renderItem={({ item }) =>
              item.kind === 'toggle' ? (
                <Pressable
                  onPress={() =>
                    setExpanded((s) => {
                      const n = new Set(s);
                      if (n.has(item.parentId)) n.delete(item.parentId);
                      else n.add(item.parentId);
                      return n;
                    })
                  }
                  hitSlop={6}
                  accessibilityRole="button"
                  style={styles.toggle}
                >
                  <View style={[styles.toggleLine, { backgroundColor: colors.muted2 }]} />
                  <Text style={[styles.toggleText, { color: colors.muted }]}>
                    {item.open ? t('ugc.hideReplies') : t('ugc.viewReplies', { count: item.count })}
                  </Text>
                </Pressable>
              ) : (
                <CommentRow
                  comment={item.comment}
                  reply={item.reply}
                  videoId={videoId}
                  mine={item.comment.user?.id === me}
                  locale={i18n.language}
                  onReply={() => startReply(item.comment)}
                  onReport={() => setReporting(item.comment.id)}
                  onDeleted={(n) => bumpCount(-n)}
                />
              )
            }
          />
        </View>

        {off ? (
          <View style={[styles.off, { borderTopColor: colors.border, backgroundColor: colors.bg }]}>
            <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.muted} />
            <Text style={[styles.offText, { color: colors.muted }]}>{t('ugc.commentsOff')}</Text>
          </View>
        ) : (
          <>
            {suggestions.length ? (
              <View
                style={[styles.mentions, { borderTopColor: colors.border, backgroundColor: colors.bg }]}
                accessibilityLabel={t('ugc.mentionList')}
              >
                {suggestions.map((p) => (
                  <Pressable key={p.id} onPress={() => pickMention(p)} style={styles.mentionRow} accessibilityRole="button">
                    {p.avatar_url ? (
                      <Image source={{ uri: p.avatar_url }} style={styles.mentionAvatar} />
                    ) : (
                      <View style={[styles.mentionAvatar, { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }]}>
                        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>{(p.name ?? p.handle).slice(0, 1)}</Text>
                      </View>
                    )}
                    <Text style={[styles.mentionHandle, { color: colors.text }]} numberOfLines={1}>
                      {atHandle(p.handle)}
                    </Text>
                    {p.name ? (
                      <Text style={{ color: colors.muted, fontSize: 13, flexShrink: 1 }} numberOfLines={1}>
                        {p.name}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ) : null}
            {replyTo ? (
              <View style={[styles.chip, { borderTopColor: colors.border, backgroundColor: colors.bg2 }]}>
                <Text style={[styles.chipText, { color: colors.muted }]} numberOfLines={1}>
                  {t('ugc.replyingTo', { handle: atHandle(replyTo.handle) })}
                </Text>
                <Pressable onPress={() => setReplyTo(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('ugc.cancelReply')}>
                  <Ionicons name="close" size={18} color={colors.muted} />
                </Pressable>
              </View>
            ) : null}
            <QuickEmojis onPick={addEmoji} />
            <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.bg }]}>
              <Pressable onPress={toggleEmoji} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('comments.emoji')}>
                <Ionicons name={emojiOpen ? 'keypad-outline' : 'happy-outline'} size={26} color={colors.muted} />
              </Pressable>
              <TextInput
                ref={input}
                value={text}
                onChangeText={(v) => setText(v.slice(0, MAX_LEN))}
                onSelectionChange={(e) => setCursor(e.nativeEvent.selection.end)}
                onFocus={() => setEmojiOpen(false)}
                placeholder={t('comments.placeholder')}
                placeholderTextColor={colors.muted}
                style={[
                  styles.input,
                  { color: colors.text, backgroundColor: colors.bg2, textAlign: I18nManager.isRTL ? 'right' : 'left' },
                ]}
                returnKeyType="send"
                submitBehavior="submit"
                onSubmitEditing={submit}
                multiline={false}
              />
              <Pressable
                onPress={submit}
                disabled={!text.trim() || send.isPending}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('comments.send')}
              >
                <Ionicons
                  name="send"
                  size={24}
                  color={text.trim() ? colors.primary : colors.muted2}
                  style={I18nManager.isRTL ? { transform: [{ scaleX: -1 }] } : undefined}
                />
              </Pressable>
            </View>
          </>
        )}
        {emojiOpen && !off ? <EmojiPanel onPick={addEmoji} /> : null}
      </View>
    </SafeAreaView>
    <ReportSheet visible={!!reporting} onClose={() => setReporting(null)} targetType="comment" targetId={reporting ?? ''} />
    </View>
  );
}

function CommentRow({
  comment,
  reply,
  videoId,
  mine,
  locale,
  onReply,
  onReport,
  onDeleted,
}: {
  comment: Comment;
  reply: boolean;
  videoId: string;
  mine: boolean;
  locale: string;
  onReply: () => void;
  onReport: () => void;
  onDeleted: (removed: number) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const key = commentKeys.thread(videoId);

  const likeM = useMutation({
    mutationFn: (next: boolean) => (next ? likeComment(comment.id) : unlikeComment(comment.id)),
    onMutate: (next) =>
      qc.setQueryData<Comment[]>(key, (list) =>
        list?.map((c) =>
          c.id === comment.id ? { ...c, liked: next, likes_count: Math.max(0, c.likes_count + (next ? 1 : -1)) } : c,
        ),
      ),
    onError: () => qc.invalidateQueries({ queryKey: key }),
  });

  function confirmDelete() {
    Alert.alert(t('comments.deleteTitle'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('comments.delete'),
        style: 'destructive',
        onPress: async () => {
          // Replies go with their parent (cascade), so they leave the count too.
          const removed =
            1 + (qc.getQueryData<Comment[]>(key)?.filter((c) => c.parent_id === comment.id).length ?? 0);
          qc.setQueryData<Comment[]>(key, (list) => list?.filter((c) => c.id !== comment.id && c.parent_id !== comment.id));
          onDeleted(removed);
          try {
            await deleteComment(comment.id);
          } catch {
            void qc.invalidateQueries({ queryKey: key });
          }
        },
      },
    ]);
  }

  const name = comment.user?.name ?? comment.user?.handle ?? '';
  return (
    <Pressable onLongPress={mine ? confirmDelete : undefined} style={[styles.row, reply && styles.replyRow]}>
      <Pressable onPress={() => comment.user?.id && router.push(`/user/${comment.user.id}`)}>
        {comment.user?.avatar_url ? (
          <Image source={{ uri: comment.user.avatar_url }} style={reply ? styles.avatarSm : styles.avatar} />
        ) : (
          <View style={[reply ? styles.avatarSm : styles.avatar, { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ color: '#fff', fontWeight: '800' }}>{name.slice(0, 1)}</Text>
          </View>
        )}
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={[styles.name, { color: colors.muted }]}>
          {name} · {timeAgo(comment.created_at, t, locale)}
        </Text>
        <Text style={[styles.body, { color: colors.text }]}>
          {comment.text.split(/(@[A-Za-z0-9_][A-Za-z0-9_.]*)/g).map((part, i) =>
            part.startsWith('@') ? (
              <Text key={i} style={{ color: colors.primary2, fontWeight: '600' }}>
                {atHandle(part)}
              </Text>
            ) : (
              part
            ),
          )}
        </Text>
        <View style={styles.actions}>
          <Pressable onPress={onReply} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.action, { color: colors.muted }]}>{t('ugc.reply')}</Text>
          </Pressable>
          {mine ? (
            <Pressable onPress={confirmDelete} hitSlop={8} accessibilityRole="button">
              <Text style={[styles.action, { color: colors.muted }]}>{t('comments.delete')}</Text>
            </Pressable>
          ) : (
            <Pressable onPress={onReport} hitSlop={8} accessibilityRole="button">
              <Text style={[styles.action, { color: colors.muted }]}>{t('ugc.report')}</Text>
            </Pressable>
          )}
        </View>
      </View>
      <Pressable
        onPress={() => likeM.mutate(!comment.liked)}
        hitSlop={8}
        style={styles.like}
        accessibilityRole="button"
        accessibilityLabel={t(comment.liked ? 'feed.unlike' : 'feed.like')}
      >
        <Ionicons name={comment.liked ? 'heart' : 'heart-outline'} size={18} color={comment.liked ? '#ff2d55' : colors.muted} />
        <Text style={[styles.likeN, { color: colors.muted }]}>{formatCount(comment.likes_count)}</Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  panel: { borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: 'hidden' },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 16, fontWeight: '800' },
  empty: { textAlign: 'center', marginTop: 60, fontSize: 15 },
  row: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'flex-start' },
  replyRow: { paddingStart: 62 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarSm: { width: 26, height: 26, borderRadius: 13 },
  actions: { flexDirection: 'row', gap: 18, marginTop: 4 },
  action: { fontSize: 12.5, fontWeight: '700' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingStart: 62, paddingEnd: 16, paddingVertical: 4 },
  toggleLine: { width: 22, height: StyleSheet.hairlineWidth },
  toggleText: { fontSize: 12.5, fontWeight: '700' },
  off: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 16, borderTopWidth: StyleSheet.hairlineWidth },
  offText: { fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'center' },
  mentions: { borderTopWidth: StyleSheet.hairlineWidth },
  mentionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  mentionAvatar: { width: 28, height: 28, borderRadius: 14 },
  mentionHandle: { fontSize: 14.5, fontWeight: '700' },
  chip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  chipText: { fontSize: 13, fontWeight: '600', flex: 1 },
  name: { fontSize: 12.5, fontWeight: '600', marginBottom: 2 },
  body: { fontSize: 15, lineHeight: 21 },
  like: { alignItems: 'center', minWidth: 30 },
  likeN: { fontSize: 11, marginTop: 1 },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, height: 42, borderRadius: 21, paddingHorizontal: 16, fontSize: 15 },
});
