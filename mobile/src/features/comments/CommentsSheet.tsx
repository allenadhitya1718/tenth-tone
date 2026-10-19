import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  I18nManager,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  type Comment,
  commentKeys,
  deleteComment,
  fetchComments,
  isCommentBlocked,
  likeComment,
  postComment,
  unlikeComment,
} from '@/api/comments';
import { ApiError } from '@/api/client';
import { EmojiPanel, QuickEmojis } from '@/components/emoji/EmojiPanel';
import { formatCount } from '@/features/feed/format';
import { timeAgo } from '@/lib/timeAgo';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/providers/ThemeProvider';

const MAX_LEN = 500;

export function CommentsSheet({ videoId }: { videoId: string }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const { session } = useAuth();
  const me = session?.user.id;
  const qc = useQueryClient();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [text, setText] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);

  const key = commentKeys.thread(videoId);
  const q = useQuery({ queryKey: key, queryFn: () => fetchComments(videoId) });

  // Note 29: the emoji panel gives way to the keyboard.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => setEmojiOpen(false));
    return () => sub.remove();
  }, []);

  const send = useMutation({
    mutationFn: (body: string) =>
      postComment(videoId, body, (id) => {
        // Moderation withdrew it after it was posted.
        // The server's message is Arabic only; ours follows the app language.
        qc.setQueryData<Comment[]>(key, (list) => list?.filter((c) => c.id !== id));
        Alert.alert(t('comments.withdrawn'), t('comments.blockedBody'));
      }),
    onSuccess: (comment) => qc.setQueryData<Comment[]>(key, (list) => [comment, ...(list ?? [])]),
    onError: (e, body) => {
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
    send.mutate(body);
    setText('');
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

  return (
    <View style={styles.backdrop}>
    <Pressable style={{ flex: 1 }} onPress={() => router.back()} accessibilityLabel={t('legal.close')} />
    <SafeAreaView style={[styles.panel, { height: height * 0.75, backgroundColor: colors.bg }]} edges={['bottom']}>
      <View style={[styles.grabber, { backgroundColor: colors.muted2 }]} />
      <View style={[styles.header, { borderBottomColor: colors.border }]} onTouchStart={closeInputs}>
        <Text style={[styles.title, { color: colors.text }]}>
          {t('comments.title', { count: comments.length })}
        </Text>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('legal.close')}>
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Note 29: any touch on the list (a row, its buttons, or the blank
            area) closes the emoji panel and the keyboard. onTouchStart sees
            the touch without claiming it, so like, long-press and the
            avatar still work; a wrapping Pressable never ran because the
            row's own Pressable took the touch first. */}
        <View style={{ flex: 1 }} onTouchStart={closeInputs}>
          <FlatList
            data={comments}
            keyExtractor={(c) => c.id}
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={() => setEmojiOpen(false)}
            contentContainerStyle={{ paddingVertical: 8, flexGrow: 1 }}
            ListEmptyComponent={
              q.isLoading ? (
                <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
              ) : (
                <Text style={[styles.empty, { color: colors.muted }]}>{t('comments.empty')}</Text>
              )
            }
            renderItem={({ item }) => (
              <CommentRow comment={item} videoId={videoId} mine={item.user?.id === me} locale={i18n.language} />
            )}
          />
        </View>

        <QuickEmojis onPick={addEmoji} />
        <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.bg }]}>
          <Pressable onPress={toggleEmoji} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('comments.emoji')}>
            <Ionicons name={emojiOpen ? 'keypad-outline' : 'happy-outline'} size={26} color={colors.muted} />
          </Pressable>
          <TextInput
            ref={input}
            value={text}
            onChangeText={(v) => setText(v.slice(0, MAX_LEN))}
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
        {emojiOpen ? <EmojiPanel onPick={addEmoji} /> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
    </View>
  );
}

function CommentRow({ comment, videoId, mine, locale }: { comment: Comment; videoId: string; mine: boolean; locale: string }) {
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
          qc.setQueryData<Comment[]>(key, (list) => list?.filter((c) => c.id !== comment.id));
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
    <Pressable onLongPress={mine ? confirmDelete : undefined} style={styles.row}>
      <Pressable onPress={() => comment.user?.id && router.push(`/user/${comment.user.id}`)}>
        {comment.user?.avatar_url ? (
          <Image source={{ uri: comment.user.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ color: '#fff', fontWeight: '800' }}>{name.slice(0, 1)}</Text>
          </View>
        )}
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={[styles.name, { color: colors.muted }]}>
          {name} · {timeAgo(comment.created_at, t, locale)}
        </Text>
        <Text style={[styles.body, { color: colors.text }]}>{comment.text}</Text>
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
  avatar: { width: 36, height: 36, borderRadius: 18 },
  name: { fontSize: 12.5, fontWeight: '600', marginBottom: 2 },
  body: { fontSize: 15, lineHeight: 21 },
  like: { alignItems: 'center', minWidth: 30 },
  likeN: { fontSize: 11, marginTop: 1 },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, height: 42, borderRadius: 21, paddingHorizontal: 16, fontSize: 15 },
});
