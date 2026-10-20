// Comments on videos, and your own comment history. Port of the matching
// parts of web/js/db.js.
//
// ApiError codes introduced here: 'comment_blocked' (the server's word
// filter refused the text, 0135), plus the shared 'not_signed_in'.
import type { PostgrestError } from '@supabase/supabase-js';

import { ApiError, requireUid, supabase, uid } from './client';
import { attach, checkText, report } from './moderation';
import type { Iso, UserSummary, Uuid } from './types';

export const commentKeys = {
  thread: (videoId: Uuid) => ['comments', videoId] as const,
  mine: () => ['myComments'] as const,
  allowed: (videoId: Uuid) => ['commentsAllowed', videoId] as const,
  mentions: (prefix: string) => ['mentions', prefix] as const,
};

export type Comment = {
  id: Uuid;
  text: string;
  likes_count: number;
  created_at: Iso;
  user_id?: Uuid;
  // Null for a top-level comment; replies sit one level under their parent.
  parent_id?: Uuid | null;
  user: Pick<UserSummary, 'id' | 'name' | 'handle' | 'avatar_url'> | null;
  // Whether I liked it. Absent when signed out or the lookup failed.
  liked?: boolean;
  // 0144: a GIF (api/gifs.ts stored form). text may then be ''.
  // Absent before 0144 is applied.
  gif_url?: string | null;
};

// Before 0144 the column does not exist and naming it fails the whole
// select (42703 from Postgres, PGRST204 from PostgREST's schema cache).
function isMissingGifColumn(e: PostgrestError | null): boolean {
  return !!e && (e.code === '42703' || e.code === 'PGRST204') && /gif_url/.test(e.message ?? '');
}

export async function fetchComments(videoId: Uuid): Promise<Comment[]> {
  const me = await uid();
  const q = (gif: boolean) =>
    supabase
      .from('comments')
      .select(
        `
      id, text, likes_count, created_at, user_id, parent_id,${gif ? ' gif_url,' : ''}
      user:profiles!comments_user_id_fkey ( id, name, handle, avatar_url )
    `,
      )
      .eq('video_id', videoId)
      .order('created_at', { ascending: false });
  let { data, error } = await q(true);
  if (isMissingGifColumn(error)) ({ data, error } = await q(false));
  if (error) throw error;
  let rows = (data ?? []) as unknown as Comment[];
  if (!me) return rows;

  // Hidden words and Restrict are per-viewer, so they are applied here rather
  // than in a database policy. Both lookups are inlined from the profile
  // settings area (fetchHiddenWords / fetchRestricted) and, like those, read
  // an error as "nothing".
  try {
    const [wordsRes, restrictedRes, blockedRes] = await Promise.all([
      supabase.from('hidden_words').select('word').eq('user_id', me),
      supabase.from('restricted_users').select('restricted_id').eq('user_id', me),
      supabase.from('blocks').select('blocked_id').eq('blocker_id', me),
    ]);
    // People I blocked: their comments are gone from my view.
    const blockedIds = new Set(
      blockedRes.error ? [] : ((blockedRes.data ?? []) as { blocked_id: Uuid }[]).map((r) => r.blocked_id),
    );
    if (blockedIds.size) rows = rows.filter((r) => !blockedIds.has(r.user_id ?? r.user?.id ?? ''));
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
// My hidden words, lower-cased. Empty on any failure (the same fail-open the
// thread filter uses).
async function myHiddenWords(me: Uuid): Promise<string[]> {
  try {
    const { data, error } = await supabase.from('hidden_words').select('word').eq('user_id', me);
    if (error) return [];
    return ((data ?? []) as { word: string }[]).map((r) => String(r.word).toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

// What fetchComments does on a refetch, applied to a comment I just posted:
// one containing one of my hidden words is not shown to me.
export function containsHiddenWord(text: string, words: string[]): boolean {
  const lower = String(text || '').toLowerCase();
  return words.some((w) => lower.includes(w));
}

export type PostedComment = Comment & { hiddenForMe?: boolean };

export async function postComment(
  videoId: Uuid,
  text: string,
  onWithdrawn?: OnCommentWithdrawn,
  parentId?: Uuid | null,
  // 0144: a GIF posted with (or instead of) the text.
  gifUrl?: string | null,
): Promise<PostedComment> {
  const me = await requireUid();
  // A GIF-only comment has no text to screen (the server does not hold it
  // either, 0144).
  const screening = text.trim() ? checkText('comment', text).catch(() => null) : Promise.resolve(null);
  const hiddenWords = myHiddenWords(me);

  const { data, error } = await supabase
    .from('comments')
    .insert({
      video_id: videoId,
      user_id: me,
      text,
      ...(parentId ? { parent_id: parentId } : {}),
      // Only sent when set, so text comments still work before 0144.
      ...(gifUrl ? { gif_url: gifUrl } : {}),
    })
    .select(
      `
      id, text, likes_count, created_at, parent_id,${gifUrl ? ' gif_url,' : ''}
      user:profiles!comments_user_id_fkey ( id, name, handle, avatar_url )
    `,
    )
    .single();
  if (isMissingGifColumn(error)) throw new ApiError('gif_unavailable', error?.message);
  if (error) throw asCommentError(error);
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
  // The comment is posted either way; this only says whether MY filter would
  // hide it, so the open thread matches what a refetch would show.
  return { ...row, hiddenForMe: containsHiddenWord(row.text, await hiddenWords) };
}

// The BEFORE INSERT word filter (0135, on comments and live_comments) raises
// 'comment_blocked'. Turned into an ApiError so screens can show their own
// translated text instead of a generic failure. Anything else is passed on.
export function isCommentBlocked(e: unknown): boolean {
  if (e instanceof ApiError) return e.code === 'comment_blocked';
  const msg = (e as PostgrestError | null)?.message;
  return typeof msg === 'string' && msg.includes('comment_blocked');
}

export function asCommentError(e: unknown): unknown {
  return isCommentBlocked(e) && !(e instanceof ApiError) ? new ApiError('comment_blocked') : e;
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Whether this video exists (for this viewer) and takes comments. `exists:
// false` is a link to a video that is gone or never was; null means the read
// itself failed, which says nothing about the video.
export async function fetchCommentsAccess(videoId: Uuid): Promise<{ exists: boolean; allowed: boolean } | null> {
  if (!UUID_RE.test(videoId)) return { exists: false, allowed: false };
  const { data, error } = await supabase.from('videos').select('allow_comments').eq('id', videoId).maybeSingle();
  if (error) return null;
  if (!data) return { exists: false, allowed: false };
  return { exists: true, allowed: (data as { allow_comments: boolean | null }).allow_comments !== false };
}

// Whether the owner has comments switched on for this video. Null while it
// cannot be read, which callers treat as "on" (the server still decides).
export async function fetchCommentsAllowed(videoId: Uuid): Promise<boolean | null> {
  const { data, error } = await supabase.from('videos').select('allow_comments').eq('id', videoId).maybeSingle();
  if (error || !data) return null;
  return (data as { allow_comments: boolean | null }).allow_comments !== false;
}

// Reports one comment into the same queue as every other report. The
// reasons are stored in the same Arabic wording the web app wrote, so the
// admin panel reads one vocabulary.
export async function reportComment(commentId: Uuid, reason: string): Promise<void> {
  await report({ targetType: 'comment', targetId: commentId, reason });
}

export type MentionCandidate = {
  id: Uuid;
  handle: string;
  name: string | null;
  avatar_url: string | null;
};

// search_handles (0035) is a prefix search that already hides blocked people
// in both directions. People I follow, or who follow me, come first.
export async function searchMentions(prefix: string, limit = 5): Promise<MentionCandidate[]> {
  const p = prefix.replace(/^@+/, '').trim();
  if (!p) return [];
  const { data, error } = await supabase.rpc('search_handles', { p_prefix: p, p_limit: 20 });
  if (error) throw error;
  const rows = ((data ?? []) as MentionCandidate[]).filter((r) => r.handle);
  const me = await uid();
  if (!me) return rows.slice(0, limit);
  const ids = rows.map((r) => r.id);
  const [following, followers] = await Promise.all([
    supabase.from('follows').select('followed_id').eq('follower_id', me).in('followed_id', ids),
    supabase.from('follows').select('follower_id').eq('followed_id', me).in('follower_id', ids),
  ]);
  const close = new Set<string>([
    ...((following.data ?? []) as { followed_id: string }[]).map((r) => r.followed_id),
    ...((followers.data ?? []) as { follower_id: string }[]).map((r) => r.follower_id),
  ]);
  const ranked = [...rows.filter((r) => close.has(r.id)), ...rows.filter((r) => !close.has(r.id))];
  return ranked.filter((r) => r.id !== me).slice(0, limit);
}

// ---------- Your activity ----------

export type MyComment = { id: Uuid; text: string; created_at: Iso; video_id: Uuid; gif_url?: string | null };

export async function fetchMyComments(limit = 60): Promise<MyComment[]> {
  const me = await uid();
  if (!me) return [];
  const q = (gif: boolean) =>
    supabase
      .from('comments')
      .select(gif ? 'id, text, created_at, video_id, gif_url' : 'id, text, created_at, video_id')
      .eq('user_id', me)
      .order('created_at', { ascending: false })
      .limit(limit);
  let { data, error } = await q(true);
  if (isMissingGifColumn(error)) ({ data, error } = await q(false));
  if (error) throw error;
  return (data ?? []) as unknown as MyComment[];
}

export async function deleteMyComment(id: Uuid): Promise<void> {
  const me = await uid();
  if (!me) return;
  const { error } = await supabase.from('comments').delete().eq('id', id).eq('user_id', me);
  if (error) throw error;
}
