// Live highlights (0167): a minute of a live, trimmed and posted by its host,
// shown in Explore and on the host's profile.
//
// ApiError codes:
//   not_host, live_not_found, bad_duration, title_too_long,
//   audio_not_uploaded, highlight_limit_live (3 per live),
//   highlight_limit_day (10 a day), content_blocked, cover_not_uploaded
import type { PostgrestError } from '@supabase/supabase-js';

import { ApiError, fireAndForget, must, supabase, uid } from './client';
import { checkImage, checkText } from './moderation';
import type { Iso, UserSummary, Uuid } from './types';
import { type LocalMedia, uploadToR2 } from './upload';

export type LiveHighlight = {
  id: Uuid;
  live_id: Uuid | null;
  host_id: Uuid;
  title: string | null;
  audio_url: string;
  cover_url: string | null;
  duration_ms: number;
  plays_count: number;
  created_at: Iso;
  host: Pick<UserSummary, 'id' | 'name' | 'handle' | 'avatar_url'> | null;
};

export const highlightKeys = {
  all: ['highlights'] as const,
  recent: () => ['highlights', 'recent'] as const,
  following: () => ['highlights', 'following'] as const,
  byUser: (userId: string) => ['highlights', 'user', userId] as const,
  one: (id: string) => ['highlights', 'one', id] as const,
};

const COLS =
  'id, live_id, host_id, title, audio_url, cover_url, duration_ms, plays_count, created_at, host:profiles!live_highlights_host_id_fkey (id, name, handle, avatar_url)';

const KNOWN = new Set([
  'not_host',
  'live_not_found',
  'bad_duration',
  'title_too_long',
  'audio_not_uploaded',
  'highlight_limit_live',
  'highlight_limit_day',
  'cover_not_uploaded',
]);

function asHighlightError(e: unknown): unknown {
  const msg = (e as PostgrestError | null)?.message ?? '';
  return KNOWN.has(msg) ? new ApiError(msg) : e;
}

/** Newest first, for Explore. */
export async function fetchRecentHighlights(limit = 30): Promise<LiveHighlight[]> {
  const data = must(
    await supabase.from('live_highlights').select(COLS).eq('is_hidden', false).order('created_at', { ascending: false }).limit(limit),
  );
  return (data ?? []) as unknown as LiveHighlight[];
}

/** Newest first, from the people you follow (Home → Following). */
export async function fetchFollowingHighlights(limit = 50): Promise<LiveHighlight[]> {
  const me = await uid();
  if (!me) return [];
  const { data: f, error: fe } = await supabase.from('follows').select('followed_id').eq('follower_id', me);
  if (fe) throw fe;
  const ids = ((f ?? []) as { followed_id: Uuid }[]).map((r) => r.followed_id);
  if (!ids.length) return [];
  const data = must(
    await supabase
      .from('live_highlights')
      .select(COLS)
      .in('host_id', ids)
      .eq('is_hidden', false)
      .order('created_at', { ascending: false })
      .limit(limit),
  );
  return (data ?? []) as unknown as LiveHighlight[];
}

export async function fetchUserHighlights(userId: string, limit = 60): Promise<LiveHighlight[]> {
  const data = must(
    await supabase.from('live_highlights').select(COLS).eq('host_id', userId).order('created_at', { ascending: false }).limit(limit),
  );
  return (data ?? []) as unknown as LiveHighlight[];
}

export async function fetchHighlight(id: string): Promise<LiveHighlight | null> {
  const data = must(await supabase.from('live_highlights').select(COLS).eq('id', id).maybeSingle());
  return (data ?? null) as unknown as LiveHighlight | null;
}

export type PostHighlightInput = {
  liveId: string;
  /** The trimmed minute, an .aac file on the phone. */
  audio: LocalMedia;
  title?: string | null;
  startMs: number;
  durationMs: number;
  /** A photo the host picked for the cover; none = the live's cover, else
   *  their profile photo (decided by the server). */
  cover?: LocalMedia | null;
};

// The server before 0169 has no p_cover_url: PostgREST answers that no
// function matches. The highlight is then posted with the default cover.
function isMissingCoverArg(e: unknown): boolean {
  const err = e as PostgrestError | null;
  return err?.code === 'PGRST202' || /create_live_highlight/.test(err?.message ?? '');
}

export async function postHighlight({ liveId, audio, title, startMs, durationMs, cover }: PostHighlightInput, onProgress?: (p: number) => void) {
  const clean = title?.trim() || null;
  if (clean) {
    const verdict = await checkText('live_title', clean);
    if (verdict.blocked) throw new ApiError('content_blocked', verdict.message ?? undefined);
  }
  // The chosen cover is screened like a live cover, then uploaded first (it
  // is small); the audio's progress is what the bar shows.
  let coverUrl: string | null = null;
  if (cover) {
    const verdict = await checkImage('live_cover', cover);
    if (verdict.blocked) throw new ApiError('content_blocked', verdict.message ?? undefined);
    coverUrl = await uploadToR2({ ...cover, mimeType: cover.mimeType || 'image/jpeg' });
  }
  // uploadToR2 reports bytes; the caller wants a fraction.
  const url = await uploadToR2({ ...audio, mimeType: 'audio/aac', name: 'highlight.aac' }, (sent, total) =>
    onProgress?.(total > 0 ? Math.min(1, sent / total) : 0),
  );
  try {
    const args = {
      p_live_id: liveId,
      p_audio_url: url,
      p_title: clean,
      p_start_ms: Math.round(startMs),
      p_duration_ms: Math.round(durationMs),
    };
    let { data, error } = await supabase.rpc('create_live_highlight', coverUrl ? { ...args, p_cover_url: coverUrl } : args);
    if (error && coverUrl && isMissingCoverArg(error)) ({ data, error } = await supabase.rpc('create_live_highlight', args));
    if (error) throw asHighlightError(error);
    return data as unknown as LiveHighlight;
  } catch (e) {
    throw asHighlightError(e);
  }
}

export async function deleteHighlight(id: string): Promise<void> {
  must(await supabase.rpc('delete_live_highlight', { p_id: id }));
}

/** Once per person per hour on the server; fire and forget. */
export function countHighlightPlay(id: string) {
  fireAndForget(supabase.rpc('count_highlight_play', { p_id: id }), 'highlight play');
}
