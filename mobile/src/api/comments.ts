// Comments on videos, and your own comment history. Port of the matching
// parts of web/js/db.js.
//
// ApiError codes introduced here: none (only the shared 'not_signed_in').
import { requireUid, supabase, uid } from './client';
import { attach, checkText } from './moderation';
import type { Iso, UserSummary, Uuid } from './types';

export const commentKeys = {
  thread: (videoId: Uuid) => ['comments', videoId] as const,
  mine: () => ['myComments'] as const,
};

export type Comment = {
  id: Uuid;
  text: string;
  likes_count: number;
  created_at: Iso;
  user_id?: Uuid;
  user: Pick<UserSummary, 'id' | 'name' | 'handle' | 'avatar_url'> | null;
  // Whether I liked it. Absent when signed out or the lookup failed.
  liked?: boolean;
};

export async function fetchComments(videoId: Uuid): Promise<Comment[]> {
  const me = await uid();
  const { data, error } = await supabase
    .from('comments')
    .select(
      `
      id, text, likes_count, created_at, user_id,
      user:profiles!comments_user_id_fkey ( id, name, handle, avatar_url )
    `,
    )
    .eq('video_id', videoId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  let rows = (data ?? []) as unknown as Comment[];
  if (!me) return rows;

  // Hidden words and Restrict are per-viewer, so they are applied here rather
  // than in a database policy. Both lookups are inlined from the profile
  // settings area (fetchHiddenWords / fetchRestricted) and, like those, read
  // an error as "nothing".
  try {
    const [wordsRes, restrictedRes] = await Promise.all([
      supabase.from('hidden_words').select('word').eq('user_id', me),
      supabase.from('restricted_users').select('restricted_id').eq('user_id', me),
    ]);
    const words = wordsRes.error ? [] : ((wordsRes.data ?? []) as { word: string }[]).map((r) => r.word);
    const restrictedIds = new Set(
      restrictedRes.error
        ? []
        : ((restrictedRes.data ?? []) as { restricted_id: Uuid | null }[]).map((r) => r.restricted_id).filter(Boolean),
    );
    if (restrictedIds.size) {
      // A restricted person still sees their own comment, so it looks normal
      // to them: that is the whole point of Restrict.
      rows = rows.filter((r) => !restrictedIds.has(r.user_id ?? null) || r.user_id === me);
    }
    if (words.length) {
      const list = words.map((w) => String(w).toLowerCase());
      rows = rows.filter((r) => {
        const t = String(r.text || '').toLowerCase();
        return !list.some((w) => w && t.includes(w));
      });
    }
  } catch {
    /* filters are best-effort: never hide the whole thread */
  }

  // Which of these I liked: one query for the thread, not one per row.
  try {
    const ids = rows.map((r) => r.id).filter(Boolean);
    if (ids.length) {
      const { data: mine } = await supabase.from('comment_likes').select('comment_id').eq('user_id', me).in('comment_id', ids);
      const liked = new Set(((mine ?? []) as { comment_id: Uuid }[]).map((r) => r.comment_id));
      rows = rows.map((r) => ({ ...r, liked: liked.has(r.id) }));
    }
  } catch {
    /* the thread still renders; hearts just start empty */
  }
  return rows;
}

// comments.likes_count is maintained by a trigger (0072), so nothing here
// touches it; re-reading the row would race the trigger anyway. Screens paint
// optimistically and revert on failure, as with video likes.
export async function likeComment(commentId: Uuid): Promise<void> {
  const me = await requireUid();
  const { error } = await supabase.from('comment_likes').insert({ comment_id: commentId, user_id: me });
  // Liking twice is not worth surfacing: the end state is what was asked for.
  if (error && error.code !== '23505') throw error;
}

export async function unlikeComment(commentId: Uuid): Promise<void> {
  const me = await requireUid();
  const { error } = await supabase.from('comment_likes').delete().eq('comment_id', commentId).eq('user_id', me);
  if (error) throw error;
}

// Called when screening blocks a comment that is already posted. The web
// build removed the row from the open sheet and showed a toast; here the
// screen does both (drop it from commentKeys.thread, toast the message,
// which is the server's Arabic text or null for the default).
export type OnCommentWithdrawn = (commentId: Uuid, message: string | null) => void;

// Screening runs ALONGSIDE the insert, not in front of it. Awaiting it first
// froze the box for 1.3-2.7 s on the most-used action in the app. The trade:
// a violating comment is visible from the insert until the verdict lands
// (about a second), then it is withdrawn and its author told.
export async function postComment(videoId: Uuid, text: string, onWithdrawn?: OnCommentWithdrawn): Promise<Comment> {
  const me = await requireUid();
  const screening = checkText('comment', text).catch(() => null);

  const { data, error } = await supabase
    .from('comments')
    .insert({ video_id: videoId, user_id: me, text })
    .select(
      `
      id, text, likes_count, created_at,
      user:profiles!comments_user_id_fkey ( id, name, handle, avatar_url )
    `,
    )
    .single();
  if (error) throw error;
  const row = data as unknown as Comment;

  // Deliberately not awaited: the caller gets its row now.
  void screening.then((verdict) => {
    if (!verdict || !row?.id) return;
    if (!verdict.blocked) {
      void attach(verdict, 'comment', row.id);
      return;
    }
    void withdraw(row.id, verdict.message, onWithdrawn);
  });
  return row;
}

// Best-effort in both halves. If the delete is refused the comment simply
// stands (the same fail-open promise moderation makes everywhere). The
// callback is what the author perceives, so it runs either way.
async function withdraw(id: Uuid, message: string | null, onWithdrawn?: OnCommentWithdrawn) {
  try {
    await supabase.from('comments').delete().eq('id', id);
  } catch (e) {
    console.warn('[Moderation] could not withdraw comment', id, (e as Error)?.message);
  }
  try {
    onWithdrawn?.(id, message);
  } catch {
    /* nothing left to do */
  }
}

export async function deleteComment(id: Uuid): Promise<void> {
  const { error } = await supabase.from('comments').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Your activity ----------

export type MyComment = { id: Uuid; text: string; created_at: Iso; video_id: Uuid };

export async function fetchMyComments(limit = 60): Promise<MyComment[]> {
  const me = await uid();
  if (!me) return [];
  const { data, error } = await supabase
    .from('comments')
    .select('id, text, created_at, video_id')
    .eq('user_id', me)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as MyComment[];
}

export async function deleteMyComment(id: Uuid): Promise<void> {
  const me = await uid();
  if (!me) return;
  const { error } = await supabase.from('comments').delete().eq('id', id).eq('user_id', me);
  if (error) throw error;
}
