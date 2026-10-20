// Sounds and hashtags. Port of the matching parts of web/js/db.js.
//
// An "original sound" is the audio of someone's own video. No licensing is
// involved, which is why it is the only kind of sound the app creates. Its
// audio_url points at the origin video file; players happily play just the
// audio track of an mp4, so no separate audio file is extracted.
//
// ApiError codes introduced here: none (only the shared 'not_signed_in').
import { requireUid, supabase, uid } from './client';
import type { Iso, UserSummary, Uuid } from './types';
import type { VideoTile } from './videos';

export const soundKeys = {
  sound: (id: Uuid) => ['sound', id] as const,
  soundVideos: (id: Uuid) => ['soundVideos', id] as const,
  favorited: (id: Uuid) => ['soundFavorited', id] as const,
  list: () => ['sounds'] as const,
  byUser: (userId: Uuid) => ['sounds', 'by', userId] as const,
  hashtag: (tag: string) => ['hashtag', normalizeTag(tag)] as const,
  hashtagVideos: (tag: string) => ['hashtagVideos', normalizeTag(tag)] as const,
};

export type Sound = {
  id: Uuid;
  title: string | null;
  author_name: string | null;
  cover_url: string | null;
  audio_url: string | null;
  duration: number | null;
  usage_count?: number | null;
  created_by?: Uuid | null;
  origin_video_id?: Uuid | null;
  is_original?: boolean | null;
  created_at?: Iso;
  creator?: Pick<UserSummary, 'id' | 'name' | 'handle' | 'avatar_url'> | null;
  [column: string]: unknown;
};

export type Hashtag = { tag: string; usage_count: number; [column: string]: unknown };

// ---------- Original sounds ----------

export async function createOriginalSound({
  videoId,
  title,
  coverUrl = null,
  duration = 30,
  audioUrl = null,
}: {
  videoId?: Uuid | null;
  title?: string | null;
  coverUrl?: string | null;
  duration?: number | null;
  audioUrl?: string | null;
}): Promise<Sound> {
  const me = await requireUid();
  const { data: prof } = await supabase.from('profiles').select('name, handle').eq('id', me).maybeSingle();
  const p = prof as { name: string | null; handle: string | null } | null;
  const author = (p && (p.name || p.handle)) || '';
  const { data, error } = await supabase
    .from('sounds')
    .insert({
      // Stored data, not UI text: every client shows this title as is.
      title: title || 'صوت أصلي',
      author_name: author,
      cover_url: coverUrl,
      audio_url: audioUrl,
      duration: Math.max(1, Math.round(duration || 30)),
      created_by: me,
      origin_video_id: videoId || null,
      is_original: true,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Sound;
}

// The creator join needs sounds.created_by (0023). Falls back to a plain
// read so the page still works before that is applied.
export async function fetchSound(soundId: Uuid): Promise<Sound | null> {
  const withCreator = await supabase
    .from('sounds')
    .select('*, creator:profiles!sounds_created_by_fkey ( id, name, handle, avatar_url )')
    .eq('id', soundId)
    .maybeSingle();
  if (!withCreator.error) return (withCreator.data as Sound | null) ?? null;
  const { data, error } = await supabase.from('sounds').select('*').eq('id', soundId).maybeSingle();
  if (error) throw error;
  return (data as Sound | null) ?? null;
}

export async function fetchSoundVideos(soundId: Uuid, limit = 60): Promise<VideoTile[]> {
  const { data, error } = await supabase
    .from('videos')
    .select('id, description, thumbnail, video_url, likes_count, views_count, created_at')
    .eq('sound_id', soundId)
    .eq('is_draft', false)
    .eq('is_hidden', false)
    .order('likes_count', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as VideoTile[];
}

export async function isSoundFavorited(soundId: Uuid): Promise<boolean> {
  const me = await uid();
  if (!me) return false;
  const { count } = await supabase
    .from('sound_favorites')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', me)
    .eq('sound_id', soundId);
  return (count || 0) > 0;
}

export async function favoriteSound(soundId: Uuid): Promise<void> {
  const me = await requireUid();
  const { error } = await supabase.from('sound_favorites').insert({ user_id: me, sound_id: soundId });
  if (error && error.code !== '23505') throw error;
}

export async function unfavoriteSound(soundId: Uuid): Promise<void> {
  const me = await uid();
  if (!me) return;
  const { error } = await supabase.from('sound_favorites').delete().eq('user_id', me).eq('sound_id', soundId);
  if (error) throw error;
}

// The most used sounds. Never throws: an error gives an empty list.
export async function fetchSounds(): Promise<Sound[]> {
  const { data, error } = await supabase.from('sounds').select('*').order('usage_count', { ascending: false }).limit(50);
  if (error && error.code !== 'PGRST116') return [];
  return (data ?? []) as Sound[];
}

// The original sounds someone's videos created: the profile's Audio tab
// (client note 28). created_by is set by createOriginalSound (0023), and only
// public posts get one, so nothing private is exposed here.
export async function fetchUserSounds(userId: Uuid, limit = 60): Promise<Sound[]> {
  const { data, error } = await supabase
    .from('sounds')
    .select('*')
    .eq('created_by', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Sound[];
}

// ---------- Hashtags ----------
// Lookups go through the video_hashtags join table (0025), so a tag match is
// exact and indexed. The old path was a LIKE over captions, which also
// matched #travelling when you asked for #travel. Counts are maintained by
// the sync_hashtags trigger (0016).

function normalizeTag(tag: string | null | undefined) {
  return String(tag ?? '').replace(/^#/, '').toLowerCase();
}

export async function fetchHashtag(tag: string): Promise<Hashtag> {
  const clean = normalizeTag(tag);
  const { data } = await supabase.from('hashtags').select('*').eq('tag', clean).maybeSingle();
  return (data as Hashtag | null) ?? { tag: clean, usage_count: 0 };
}

export async function fetchHashtagVideos(tag: string, limit = 60): Promise<VideoTile[]> {
  const clean = normalizeTag(tag);
  const link = await supabase.from('video_hashtags').select('video_id').eq('tag', clean).limit(limit);
  if (link.error) {
    // Before 0025 there is no join table: fall back to the caption search.
    const { data } = await supabase
      .from('videos')
      .select('id, description, thumbnail, video_url, likes_count, views_count, created_at')
      .ilike('description', `%#${clean}%`)
      .eq('is_draft', false)
      .limit(limit);
    return (data ?? []) as VideoTile[];
  }
  const ids = ((link.data ?? []) as { video_id: Uuid }[]).map((r) => r.video_id);
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('videos')
    .select('id, description, thumbnail, video_url, likes_count, views_count, created_at')
    .in('id', ids)
    .eq('is_draft', false)
    .eq('is_hidden', false)
    .order('likes_count', { ascending: false });
  if (error) throw error;
  return (data ?? []) as VideoTile[];
}
