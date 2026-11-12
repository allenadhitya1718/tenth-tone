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
  /** 'live' = cut from a live; 'voice' = a voice clip recorded in the app
   *  (0170). Missing before 0170 is applied: treat as 'live'. */
  kind?: 'live' | 'voice';
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
  saved: () => ['highlights', 'saved'] as const,
  savedIds: () => ['highlights', 'saved', 'ids'] as const,
};

// Every column (so `kind` comes along once 0170 adds it, and nothing breaks
// before), plus the host.
const COLS = '*, host:profiles!live_highlights_host_id_fkey (id, name, handle, avatar_url)';

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

export type PostVoiceClipInput = {
  /** The recording: .m4a from the in-app recorder. */
  audio: LocalMedia;
  durationMs: number;
  title?: string | null;
  /** A background photo; none = the person's profile photo (server). */
  cover?: LocalMedia | null;
};

/** A voice clip recorded in the app, up to 5 minutes (0170). Shown with
 *  highlights in Explore, Home and on the profile. */
export async function postVoiceClip({ audio, durationMs, title, cover }: PostVoiceClipInput, onProgress?: (p: number) => void) {
  const clean = title?.trim() || null;
  if (clean) {
    const verdict = await checkText('live_title', clean);
    if (verdict.blocked) throw new ApiError('content_blocked', verdict.message ?? undefined);
  }
  let coverUrl: string | null = null;
  if (cover) {
    const verdict = await checkImage('live_cover', cover);
    if (verdict.blocked) throw new ApiError('content_blocked', verdict.message ?? undefined);
    coverUrl = await uploadToR2({ ...cover, mimeType: cover.mimeType || 'image/jpeg' });
  }
  const url = await uploadToR2({ ...audio, mimeType: 'audio/mp4', name: 'voice.m4a' }, (sent, total) =>
    onProgress?.(total > 0 ? Math.min(1, sent / total) : 0),
  );
  try {
    const { data, error } = await supabase.rpc('create_voice_clip', {
      p_audio_url: url,
      p_title: clean,
      p_duration_ms: Math.round(durationMs),
      p_cover_url: coverUrl,
    });
    if (error) throw asHighlightError(error);
    return data as unknown as LiveHighlight;
  } catch (e) {
    throw asHighlightError(e);
  }
}

export async function deleteHighlight(id: string): Promise<void> {
  must(await supabase.rpc('delete_live_highlight', { p_id: id }));
}

// ---------- saved highlights (0171) ----------
// Private to the person who saved them; backs the profile's Saved tab.

/** Ids of the highlights I saved, for the bookmark on each feed card. */
export async function fetchSavedHighlightIds(): Promise<Set<string>> {
  const me = await uid();
  if (!me) return new Set();
  const data = must(await supabase.from('highlight_saves').select('highlight_id').eq('user_id', me).limit(1000));
  return new Set(((data ?? []) as { highlight_id: Uuid }[]).map((r) => r.highlight_id));
}

/** The highlights I saved, newest save first. */
export async function fetchSavedHighlights(limit = 60): Promise<LiveHighlight[]> {
  const me = await uid();
  if (!me) return [];
  const data = must(
    await supabase
      .from('highlight_saves')
      .select(`created_at, highlight:live_highlights!highlight_saves_highlight_id_fkey ( ${COLS} )`)
      .eq('user_id', me)
      .order('created_at', { ascending: false })
      .limit(limit),
  );
  // A highlight hidden or blocked since it was saved comes back null.
  return ((data ?? []) as unknown as { highlight: LiveHighlight | null }[]).map((r) => r.highlight).filter((h): h is LiveHighlight => !!h);
}

export async function saveHighlight(id: string): Promise<void> {
  const me = await uid();
  if (!me) throw new ApiError('not_signed_in');
  must(await supabase.from('highlight_saves').upsert({ user_id: me, highlight_id: id }, { ignoreDuplicates: true }));
}

export async function unsaveHighlight(id: string): Promise<void> {
  const me = await uid();
  if (!me) throw new ApiError('not_signed_in');
  must(await supabase.from('highlight_saves').delete().eq('user_id', me).eq('highlight_id', id));
}

/** Once per person per hour on the server; fire and forget. */
export function countHighlightPlay(id: string) {
  fireAndForget(supabase.rpc('count_highlight_play', { p_id: id }), 'highlight play');
}
