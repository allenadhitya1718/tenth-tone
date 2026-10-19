// People tagged in a post, and the places on a person's posts (the profile
// map). Backed by supabase/migrations/0101_post_location_and_tags.sql, which
// may not be applied yet: reads degrade to empty, and a tag that cannot be
// written is reported as a refusal rather than thrown.
//
// ApiError codes introduced here: none. Tag refusals are returned, not
// thrown, with one of these reasons:
//   tag_self          you cannot tag yourself
//   tag_not_allowed   the person's who_can_tag, or a block, refuses it
//   tag_limit         the post already tags 20 people
//   tag_not_owner     only the person who posted may tag
//   tags_unavailable  0101 is not applied (no video_tags table)
//   tag_failed        anything else (the message is kept for the log)
// Also thrown: 'not_signed_in' (client.ts) and Postgrest errors as-is.
import type { PostgrestError } from '@supabase/supabase-js';

import { requireUid, supabase } from './client';
import type { Iso, UserSummary, Uuid } from './types';
import type { VideoTile } from './videos';

export const tagKeys = {
  all: ['tags'] as const,
  videoTags: (videoId: Uuid) => ['videoTags', videoId] as const,
  taggedVideos: (userId: Uuid) => ['taggedVideos', userId] as const,
  profilePlaces: (userId: Uuid) => ['profilePlaces', userId] as const,
  postExtras: (videoId: Uuid) => ['postExtras', videoId] as const,
};

export type TagRefusal = { userId: Uuid; reason: string; message?: string };

// The installed database does not have this function / table yet.
function isMissingFunction(e: PostgrestError | null) {
  return e?.code === 'PGRST202' || e?.code === '42883';
}
function isMissingTable(e: PostgrestError | null) {
  return e?.code === 'PGRST205' || e?.code === '42P01';
}

// The trigger's messages are fixed strings (check_video_tag in 0101), so the
// reason is read from them rather than from the error code, which two of the
// refusals share.
function refusalReason(e: PostgrestError): string {
  const msg = e.message || '';
  if (isMissingTable(e)) return 'tags_unavailable';
  if (/cannot tag yourself/i.test(msg)) return 'tag_self';
  if (/does not allow tags/i.test(msg)) return 'tag_not_allowed';
  if (/at most 20 people/i.test(msg)) return 'tag_limit';
  if (/only the person who posted/i.test(msg) || e.code === '42501') return 'tag_not_owner';
  return 'tag_failed';
}

// One insert per person, in order, so each refusal is reported on its own
// and, at the 20 cap, the first people chosen are the ones that land. Never
// throws for a refused tag: the post already exists and must not fail.
export async function addVideoTags(
  videoId: Uuid,
  userIds: Uuid[],
): Promise<{ added: Uuid[]; refused: TagRefusal[] }> {
  const added: Uuid[] = [];
  const refused: TagRefusal[] = [];
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  for (const userId of ids) {
    const { error } = await supabase.from('video_tags').insert({ video_id: videoId, user_id: userId });
    // Already tagged is the state that was asked for.
    if (!error || error.code === '23505') {
      added.push(userId);
      continue;
    }
    const reason = refusalReason(error);
    refused.push({ userId, reason, message: error.message });
    // Without the table every remaining insert fails the same way.
    if (reason === 'tags_unavailable') {
      for (const rest of ids.slice(ids.indexOf(userId) + 1)) refused.push({ userId: rest, reason });
      break;
    }
  }
  return { added, refused };
}

// The post's owner removing a tag, or the tagged person removing themselves
// (both allowed by the delete policy).
export async function removeVideoTag(videoId: Uuid, userId: Uuid): Promise<void> {
  await requireUid();
  const { error } = await supabase.from('video_tags').delete().eq('video_id', videoId).eq('user_id', userId);
  if (error) throw error;
}

// The people tagged in a post, in the order they were tagged. Rows naming
// someone on the other side of a block from the reader are hidden by RLS.
export async function fetchVideoTags(videoId: Uuid): Promise<UserSummary[]> {
  const { data, error } = await supabase
    .from('video_tags')
    .select('created_at, user:profiles!video_tags_user_id_fkey ( id, name, handle, avatar_url, verified )')
    .eq('video_id', videoId)
    .order('created_at', { ascending: true });
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return ((data ?? []) as unknown as { user: UserSummary | null }[])
    .map((r) => r.user)
    .filter((u): u is UserSummary => !!u);
}

// Posts a person is tagged in, newest tag first. The inner join drops rows
// whose post the reader cannot read (the videos policies decide), and the
// filters drop drafts, archived and hidden posts even where the reader could
// read them (their own post, say): this is a public tab.
export async function fetchTaggedVideos(userId: Uuid, limit = 60): Promise<VideoTile[]> {
  const { data, error } = await supabase
    .from('video_tags')
    .select(
      `created_at,
       video:videos!video_tags_video_id_fkey!inner (
         id, description, thumbnail, video_url, likes_count, created_at,
         user:profiles!videos_user_id_fkey ( id, name, handle, avatar_url )
       )`,
    )
    .eq('user_id', userId)
    .eq('video.is_draft', false)
    .eq('video.is_archived', false)
    .eq('video.is_hidden', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return ((data ?? []) as unknown as { video: VideoTile | null }[])
    .map((r) => r.video)
    .filter((v): v is VideoTile => !!v);
}

// fetch_profile_places (0101). One row per post with a place.
export type ProfilePlace = {
  video_id: Uuid;
  place_name: string | null;
  lat: number;
  lng: number;
  thumbnail: string | null;
  created_at: Iso;
};

// The profile map. Empty, not an error, on a database without 0101.
export async function fetchProfilePlaces(userId: Uuid, limit = 200): Promise<ProfilePlace[]> {
  const { data, error } = await supabase.rpc('fetch_profile_places', { p_user_id: userId, p_limit: limit });
  if (error) {
    if (isMissingFunction(error)) return [];
    throw error;
  }
  return (data ?? []) as ProfilePlace[];
}

// What a feed card shows under the caption (client note 21): the post's
// place and the people tagged in it. The feed RPCs do not return either, so
// the card asks for them once it is on screen. Two reads in parallel; each
// degrades to empty on its own (a database without 0101, a hidden row), so a
// missing place never hides the tags or the other way round.
export type PostPlace = { name: string; lat: number | null; lng: number | null };
export type PostExtras = { place: PostPlace | null; tags: UserSummary[] };

export async function fetchPostExtras(videoId: Uuid): Promise<PostExtras> {
  const [placeRes, tags] = await Promise.all([
    supabase.from('videos').select('place_name, lat, lng').eq('id', videoId).maybeSingle(),
    fetchVideoTags(videoId).catch(() => [] as UserSummary[]),
  ]);
  let place: PostPlace | null = null;
  if (!placeRes.error && placeRes.data) {
    const r = placeRes.data as { place_name: string | null; lat: number | null; lng: number | null };
    const name = (r.place_name ?? '').trim();
    if (name) {
      const ok = typeof r.lat === 'number' && typeof r.lng === 'number';
      place = { name, lat: ok ? r.lat : null, lng: ok ? r.lng : null };
    }
  }
  return { place, tags };
}
