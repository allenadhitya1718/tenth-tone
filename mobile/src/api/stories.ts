// Stories: a photo or short video that disappears after 24 hours, with an
// optional sound, caption and audience. Backed by
// supabase/migrations/0102_stories.sql; read that header for who sees what
// and what happens to the media. Caching is TanStack Query's job; see
// storyKeys.
//
// ApiError codes introduced here:
//   story_rate_limited  50 stories in the last 24 hours (database trigger)
//   story_not_found     update / delete matched no row of yours
//   video_not_shareable shareVideoToStory: not a public post you can share (0155)
// Also thrown: 'content_blocked' (as in videos.ts: moderation refused it,
// message carries the server's Arabic text), 'not_signed_in' (client.ts),
// the upload.ts codes, and Postgrest errors as-is.
import { openOrCreateDm } from './chat';
import { ApiError, requireUid, supabase } from './client';
import { checkImage } from './moderation';
import type { Iso, Uuid } from './types';
import { type LocalMedia, type Progress, releaseMedia, uploadToR2 } from './upload';

export const storyKeys = {
  all: ['stories'] as const,
  tray: () => ['storyTray'] as const,
  user: (userId: Uuid) => ['userStories', userId] as const,
  viewers: (storyId: Uuid) => ['storyViewers', storyId] as const,
};

export type StoryKind = 'image' | 'video';
export type StoryAudience = 'everyone' | 'followers' | 'close_friends';

// A row of public.stories.
export type StoryRow = {
  id: Uuid;
  user_id: Uuid;
  media_url: string;
  media_kind: StoryKind;
  poster_url: string | null;
  sound_id: Uuid | null;
  sound_start_ms: number;
  caption: string | null;
  audience: StoryAudience;
  created_at: Iso;
  expires_at: Iso;
};

// fetch_story_tray: one entry per person with a live story, you first.
export type StoryTrayEntry = {
  user_id: Uuid;
  handle: string | null;
  name: string | null;
  avatar_url: string | null;
  verified: boolean | null;
  is_me: boolean;
  story_count: number;
  latest_story_at: Iso;
  has_unseen: boolean;
  has_close_friends: boolean;
};

// fetch_user_stories: oldest first, the order they play in. seen is always
// true for your own; view_count is set only for your own (null otherwise).
export type UserStory = {
  id: Uuid;
  user_id: Uuid;
  media_url: string;
  media_kind: StoryKind;
  poster_url: string | null;
  sound_id: Uuid | null;
  sound_title: string | null;
  sound_author: string | null;
  sound_audio_url: string | null;
  sound_start_ms: number;
  caption: string | null;
  audience: StoryAudience;
  created_at: Iso;
  expires_at: Iso;
  seen: boolean;
  view_count: number | null;
  // 0151: you liked this story (someone else's). Absent before 0151.
  liked?: boolean;
  // 0155: a feed video added to the story. shared_visible is false when the
  // caller can no longer see the video (only the owner gets such a row).
  shared_video_id?: Uuid | null;
  shared_visible?: boolean | null;
  shared_handle?: string | null;
  shared_name?: string | null;
  shared_avatar?: string | null;
};

/** A shared video the viewer can no longer watch. */
export const isUnavailableShare = (s: Pick<UserStory, 'shared_video_id' | 'shared_visible'>) =>
  !!s.shared_video_id && s.shared_visible === false;

// fetch_story_viewers: "seen by", newest view first. Owner only.
export type StoryViewer = {
  viewer_id: Uuid;
  handle: string | null;
  name: string | null;
  avatar_url: string | null;
  verified: boolean | null;
  viewed_at: Iso;
  // 0151: this viewer liked the story.
  liked?: boolean;
};

// Mirrors stories_caption_length and stories_sound_start_check, so a value
// the database would refuse is fixed here rather than failing the insert
// after the upload.
const MAX_CAPTION = 500;
const MAX_SOUND_START_MS = 600_000;

function cleanCaption(caption: string | null | undefined) {
  const c = (caption ?? '').trim().slice(0, MAX_CAPTION);
  return c || null;
}

function cleanStart(ms: number | null | undefined) {
  const n = Math.round(Number(ms) || 0);
  return Math.max(0, Math.min(MAX_SOUND_START_MS, n));
}

// rate_limit_exceeded() (0050) raises "too many stories - please wait ...".
function isRateLimited(e: { message?: string } | null) {
  return /too many stories/i.test(e?.message || '');
}

// ---------- Posting ----------

export type CreateStoryInput = {
  media: LocalMedia;
  kind: StoryKind;
  // A frame of a video story, shown while it loads. Ignored for photos.
  poster?: LocalMedia | null;
  soundId?: Uuid | null;
  soundStartMs?: number;
  caption?: string;
  audience?: StoryAudience;
  onProgress?: Progress;
};

// Photos must already be JPEG: the R2 bucket takes jpg/jpeg images and
// mp4/mov/webm video only, and nothing is converted here.
export async function createStory({
  media,
  kind,
  poster = null,
  soundId = null,
  soundStartMs = 0,
  caption,
  audience = 'followers',
  onProgress,
}: CreateStoryInput): Promise<StoryRow> {
  const userId = await requireUid();
  const text = cleanCaption(caption);
  const frame = kind === 'image' ? media : poster;

  // Screening runs alongside the upload and gates the insert, as in
  // publishVideo: nothing is visible until the row exists. checkImage falls
  // back to the caption alone when there is no frame. .catch here so an
  // upload that throws first leaves no unhandled rejection.
  const screening = checkImage('story', frame, text).catch(() => null);

  const media_url = await uploadToR2(media, onProgress);

  // A failed poster never fails the story; the player shows the video itself.
  let poster_url: string | null = null;
  if (kind === 'video' && poster) {
    try {
      poster_url = await uploadToR2(poster);
    } catch (e) {
      console.warn('story poster:', (e as Error)?.message);
    }
  }

  const verdict = await screening;
  if (verdict?.blocked) {
    releaseMedia([media_url, poster_url]);
    throw new ApiError('content_blocked', verdict.message ?? undefined);
  }

  // No created_at / expires_at: the database sets both, whatever is sent.
  const { data, error } = await supabase
    .from('stories')
    .insert({
      user_id: userId,
      media_url,
      media_kind: kind,
      poster_url,
      sound_id: soundId,
      sound_start_ms: cleanStart(soundStartMs),
      caption: text,
      audience,
    })
    .select()
    .single();
  if (error) {
    // No row points at the uploaded bytes, so hand them back now.
    releaseMedia([media_url, poster_url]);
    if (isRateLimited(error)) throw new ApiError('story_rate_limited', error.message, error);
    throw error;
  }
  return data as StoryRow;
}

// ---------- Adding a feed video (0155) ----------

// Posts a story that plays someone's feed video with a card linking to it.
// The database fills in the media from the video (whatever is sent here)
// and refuses a post that is not public, from a private account, or across
// a block. Before 0155 the column is missing: ApiError('needs_update').
export async function shareVideoToStory(videoId: Uuid, audience: StoryAudience = 'followers'): Promise<void> {
  const userId = await requireUid();
  const { error } = await supabase.from('stories').insert({
    user_id: userId,
    shared_video_id: videoId,
    // Replaced by the database from the video's own row.
    media_url: 'https://flyp.app/shared',
    media_kind: 'video',
    audience,
  });
  if (!error) return;
  if (error.code === 'PGRST204' || error.code === '42703') throw new ApiError('needs_update', error.message, error);
  if (/video_not_shareable/.test(error.message ?? '')) throw new ApiError('video_not_shareable', error.message, error);
  if (isRateLimited(error)) throw new ApiError('story_rate_limited', error.message, error);
  throw error;
}

// ---------- Reading ----------

export async function fetchStoryTray(limit = 100): Promise<StoryTrayEntry[]> {
  const { data, error } = await supabase.rpc('fetch_story_tray', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as StoryTrayEntry[];
}

export async function fetchUserStories(userId: Uuid): Promise<UserStory[]> {
  const { data, error } = await supabase.rpc('fetch_user_stories', { p_user_id: userId });
  if (error) throw error;
  return (data ?? []) as UserStory[];
}

// Records a view. Safe to call without awaiting and never throws: a lost
// view only means the ring stays coloured. Resolves true when a view was
// recorded now, false otherwise (already seen, your own, not visible, error).
export async function markStoryViewed(storyId: Uuid): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('mark_story_viewed', { p_story_id: storyId });
    if (error) {
      console.warn('mark story viewed:', error.message);
      return false;
    }
    return data === true;
  } catch (e) {
    console.warn('mark story viewed:', (e as Error)?.message);
    return false;
  }
}

// Only the story's owner gets rows; anyone else gets an empty list.
export async function fetchStoryViewers(storyId: Uuid, limit = 200, offset = 0): Promise<StoryViewer[]> {
  const { data, error } = await supabase.rpc('fetch_story_viewers', {
    p_story_id: storyId,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return (data ?? []) as StoryViewer[];
}

// ---------- Likes and replies (0151) ----------

// Like or unlike someone else's story. Resolves whether it is now liked.
// Before 0151 is applied the function is missing: ApiError('needs_update').
export async function likeStory(storyId: Uuid, liked: boolean): Promise<boolean> {
  const { data, error, status } = await supabase.rpc('like_story', { p_story_id: storyId, p_liked: liked });
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883' || status === 404) throw new ApiError('needs_update');
    throw error;
  }
  return data === true;
}

const REPLY_ERRORS = new Set(['story_gone', 'blocked', 'empty_reply', 'reply_too_long', 'bad_chat', 'own_story']);

// A reply goes to the story's owner as a message in your DM with them, with
// a picture of the story above it (the server takes the picture from the
// story). Opens the DM first; a person who does not take messages from you
// refuses it there. Resolves the chat id.
export async function replyToStory(story: Pick<UserStory, 'id' | 'user_id'>, text: string): Promise<Uuid> {
  const body = text.trim();
  if (!body) throw new ApiError('empty_reply');
  const chatId = await openOrCreateDm(story.user_id);
  // The reply needs your view of the story on record; usually it already is.
  await markStoryViewed(story.id);
  const { error, status } = await supabase.rpc('reply_to_story', { p_story_id: story.id, p_chat_id: chatId, p_text: body });
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883' || status === 404) throw new ApiError('needs_update');
    if (REPLY_ERRORS.has(error.message)) throw new ApiError(error.message, error.message);
    throw error;
  }
  return chatId;
}

// ---------- Editing and deleting ----------

export type StoryPatch = {
  caption?: string | null;
  audience?: StoryAudience;
  sound_id?: Uuid | null;
  sound_start_ms?: number;
};

// Caption, audience and sound only. The media, owner and times are frozen by
// a trigger, so they are not offered here. A changed caption is screened.
export async function updateStory(id: Uuid, patch: StoryPatch): Promise<StoryRow> {
  const me = await requireUid();
  const row: Record<string, unknown> = {};
  if (patch.caption !== undefined) row.caption = cleanCaption(patch.caption);
  if (patch.audience !== undefined) row.audience = patch.audience;
  if (patch.sound_id !== undefined) row.sound_id = patch.sound_id;
  if (patch.sound_start_ms !== undefined) row.sound_start_ms = cleanStart(patch.sound_start_ms);

  if (typeof row.caption === 'string') {
    const verdict = await checkImage('story', null, row.caption).catch(() => null);
    if (verdict?.blocked) throw new ApiError('content_blocked', verdict.message ?? undefined);
  }

  const { data, error } = await supabase.from('stories').update(row).eq('id', id).eq('user_id', me).select();
  if (error) throw error;
  const updated = (data ?? []) as StoryRow[];
  if (!updated.length) throw new ApiError('story_not_found');
  return updated[0];
}

// Deleting your own story, and its media. The delete trigger also queues the
// URLs (media_delete_queue), but nothing consumes that queue yet, so the
// owner's delete releases them directly, as deleteVideo does.
export async function deleteStory(id: Uuid): Promise<true> {
  // Read the URLs while the row still exists. A failure costs only cleanup.
  let media: (string | null)[] = [];
  try {
    const { data: s } = await supabase.from('stories').select('media_url, poster_url').eq('id', id).maybeSingle();
    const row = s as { media_url: string | null; poster_url: string | null } | null;
    if (row) media = [row.media_url, row.poster_url];
  } catch {}

  // .select() so a policy-blocked delete (removes nothing, raises nothing)
  // is distinguishable from a real one.
  const { data, error } = await supabase.from('stories').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data || !data.length) throw new ApiError('story_not_found');

  // Only on a delete that really happened; never awaited.
  releaseMedia(media);
  return true;
}
