// Discover, search and sharing. Port of the matching parts of web/js/db.js.
//
// ApiError codes introduced here:
//   cannot_dm_self    shareLinkTo was given your own id (inlined
//                     openOrCreateDm; counted as a failed recipient)
//   dm_open_failed    open_or_create_dm returned no chat id (same)
// Also thrown: 'not_signed_in' (client.ts).
import { ApiError, requireUid, supabase, uid } from './client';
import { likePattern, orValue, type PersonResult, searchPeople, withoutBlocked } from './search';
import type { Sound, Hashtag } from './sounds';
import type { UserSummary, Uuid } from './types';
import type { VideoTile } from './videos';

export const discoverKeys = {
  trendingHashtags: (limit = 8) => ['trendingHashtags', limit] as const,
  suggestedProfiles: (limit = 12) => ['suggestedProfiles', limit] as const,
  popularVideos: (limit = 12) => ['popularVideos', limit] as const,
  search: (query: string) => ['search', query.trim()] as const,
  shareTargets: () => ['shareTargets'] as const,
};

// Canonical share links (web/js/deeplink.js). The https form is what the OS
// hands to the app through the associated-domain / intent-filter setup.
const LINK_ORIGIN = 'https://flyp-sa.com';
export const videoLink = (id: Uuid) => `${LINK_ORIGIN}/v/${encodeURIComponent(id)}`;
export const profileLink = (id: Uuid) => `${LINK_ORIGIN}/u/${encodeURIComponent(id)}`;

export type { PersonResult };

// ---------- Discover ----------

// Real counts, maintained by the sync_hashtags trigger. Never throws.
export async function fetchTrendingHashtags(limit = 8): Promise<Hashtag[]> {
  const { data, error } = await supabase
    .from('hashtags')
    .select('tag, usage_count')
    .order('usage_count', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as Hashtag[];
}

// Most-followed creators, excluding yourself and anyone either of you has
// blocked. The list is ordered by follower count, so a blocked account with a
// large following used to sit near the top permanently. suggested_profiles
// (0065) filters both directions in the database; the plain query is only a
// fallback for before 0065.
export async function fetchSuggestedProfiles(limit = 12): Promise<PersonResult[]> {
  const { data, error } = await supabase.rpc('suggested_profiles', { p_limit: limit });
  if (!error) return (data ?? []) as PersonResult[];
  console.warn('suggested_profiles unavailable (is 0065 applied?):', error.message);
  const me = await uid();
  let q = supabase
    .from('profiles')
    .select('id, name, handle, avatar_url, bio, verified, followers_count')
    .order('followers_count', { ascending: false })
    .limit(limit);
  if (me) q = q.neq('id', me);
  const r = await q;
  if (r.error) return [];
  return withoutBlocked((r.data ?? []) as PersonResult[]);
}

// Most-engaged public videos. Never throws.
export async function fetchPopularVideos(limit = 12): Promise<VideoTile[]> {
  const { data, error } = await supabase
    .from('videos')
    .select(
      `
      id, description, thumbnail, video_url, likes_count, comments_count, views_count, created_at,
      user:profiles!videos_user_id_fkey ( id, name, handle, avatar_url, is_private )
    `,
    )
    .eq('is_draft', false)
    .eq('privacy', 'public')
    .eq('is_hidden', false)
    .order('likes_count', { ascending: false })
    .limit(limit);
  if (error) return [];
  return onlyPublicAccounts((data ?? []) as unknown as VideoTile[]);
}

// Discover and search show what any normal user would see. The database lets
// admins read everything (for moderation), so without this an admin account
// would see videos from private accounts it does not follow here, while the
// feed (which applies the account rule itself) correctly leaves them out.
async function onlyPublicAccounts(tiles: VideoTile[]): Promise<VideoTile[]> {
  type WithPrivacy = VideoTile & { user?: { id?: string; is_private?: boolean | null } | null };
  const list = tiles as WithPrivacy[];
  const privateOwners = [...new Set(list.filter((v) => v.user?.is_private && v.user.id).map((v) => v.user!.id!))];
  if (!privateOwners.length) return tiles;
  const me = await uid();
  let followed = new Set<string>();
  if (me) {
    const { data } = await supabase.from('follows').select('followed_id').eq('follower_id', me).in('followed_id', privateOwners);
    followed = new Set((data ?? []).map((r: { followed_id: string }) => r.followed_id));
  }
  return list.filter((v) => !v.user?.is_private || v.user.id === me || (v.user.id && followed.has(v.user.id)));
}

// ---------- Search ----------

export type SearchResults = {
  hashtags: Hashtag[];
  profiles: PersonResult[];
  videos: VideoTile[];
  sounds: Sound[];
};

export async function searchAll(query: string): Promise<SearchResults> {
  const term = likePattern(query.trim());
  // Hashtags are first-class results: typing a trending tag used to find the
  // ACCOUNT with a similar name and never the tag. The leading '#' is
  // stripped so both '#city' and 'city' work.
  const tagTerm = likePattern(query.trim().replace(/^#/, ''));
  const [profiles, videosRes, soundsRes, tagsRes] = await Promise.all([
    searchPeople(query, 20),
    supabase
      .from('videos')
      .select('id, description, thumbnail, video_url, likes_count, created_at, user:profiles!videos_user_id_fkey(id,name,handle,avatar_url,is_private)')
      .ilike('description', term)
      .eq('is_draft', false)
      .limit(20),
    supabase.from('sounds').select('*').or(`title.ilike.${orValue(term)},author_name.ilike.${orValue(term)}`).limit(20),
    supabase.from('hashtags').select('tag, usage_count').ilike('tag', tagTerm).order('usage_count', { ascending: false }).limit(12),
  ]);
  return {
    hashtags: (tagsRes.data ?? []) as Hashtag[],
    profiles: profiles ?? [],
    // Videos already obey blocking: can_see_posts_of (0049) refuses across a
    // block in either direction and the videos policy goes through it.
    videos: await onlyPublicAccounts((videosRes.data ?? []) as unknown as VideoTile[]),
    sounds: (soundsRes.data ?? []) as Sound[],
  };
}

// ---------- Sharing ----------

export type ShareTarget = Pick<UserSummary, 'id' | 'name' | 'handle' | 'avatar_url'> & { _mutual: boolean };

// Who you can send something to, most likely first: people you messaged most
// recently, then mutuals, then people you follow, then people who follow you.
// Followers are included because someone who follows you but whom you have
// not followed back used to be unreachable. Recency comes from existing
// conversations rather than a "recently shared" table.
export async function fetchShareTargets(): Promise<ShareTarget[]> {
  const me = await uid();
  if (!me) return [];

  type ProfileRow = { profile: Omit<ShareTarget, '_mutual'> | null };
  const [followingRes, followerRes] = await Promise.all([
    supabase
      .from('follows')
      .select('profile:profiles!follows_followed_id_fkey ( id, name, handle, avatar_url )')
      .eq('follower_id', me)
      .limit(200),
    supabase
      .from('follows')
      .select('profile:profiles!follows_follower_id_fkey ( id, name, handle, avatar_url )')
      .eq('followed_id', me)
      .limit(200),
  ]);

  const following = ((followingRes.data ?? []) as unknown as ProfileRow[]).map((r) => r.profile).filter((p) => !!p);
  const followers = ((followerRes.data ?? []) as unknown as ProfileRow[]).map((r) => r.profile).filter((p) => !!p);

  const followingIds = new Set(following.map((p) => p.id));
  const byId = new Map<Uuid, ShareTarget>();
  following.forEach((p) => byId.set(p.id, { ...p, _mutual: false }));
  followers.forEach((p) => {
    const existing = byId.get(p.id);
    if (existing) existing._mutual = true; // both directions
    else byId.set(p.id, { ...p, _mutual: false });
  });

  // Best effort: an ordering nicety must never empty the share sheet.
  let recency = new Map<Uuid, number>();
  try {
    recency = await dmRecency(me);
  } catch (e) {
    console.warn('share target recency unavailable:', e);
  }

  const rank = (p: ShareTarget): [number, number] => {
    const r = recency.get(p.id);
    if (r !== undefined) return [0, r]; // talked to recently
    if (p._mutual) return [1, 0]; // follow each other
    if (followingIds.has(p.id)) return [2, 0]; // you follow them
    return [3, 0]; // they follow you
  };

  return Array.from(byId.values()).sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra[0] - rb[0] || ra[1] - rb[1] || (a.name || '').localeCompare(b.name || '');
  });
}

// The other person of each direct conversation, mapped to its position in
// the inbox (0 = most recent activity). The web build reused the full inbox
// read (fetchChats); this is the subset of it that ordering needs, inlined so
// this module does not depend on the chat area.
async function dmRecency(me: Uuid): Promise<Map<Uuid, number>> {
  const out = new Map<Uuid, number>();
  const { data: memberships } = await supabase.from('chat_members').select('chat_id').eq('user_id', me);
  const chatIds = ((memberships ?? []) as { chat_id: Uuid }[]).map((r) => r.chat_id);
  if (!chatIds.length) return out;

  const [{ data: chats }, lastMsgs, { data: members }] = await Promise.all([
    supabase.from('chats').select('id, type, created_at').in('id', chatIds),
    latestMessageTimes(chatIds),
    supabase.from('chat_members').select('chat_id, user_id').in('chat_id', chatIds),
  ]);

  const lastByChat = new Map<Uuid, string>();
  lastMsgs.forEach((m) => {
    if (!lastByChat.has(m.chat_id)) lastByChat.set(m.chat_id, m.created_at);
  });
  const otherByChat = new Map<Uuid, Uuid>();
  ((members ?? []) as { chat_id: Uuid; user_id: Uuid }[]).forEach((m) => {
    if (m.user_id !== me && !otherByChat.has(m.chat_id)) otherByChat.set(m.chat_id, m.user_id);
  });

  const ordered = ((chats ?? []) as { id: Uuid; type: string; created_at: string }[])
    .map((c) => ({ ...c, at: new Date(lastByChat.get(c.id) ?? c.created_at).getTime() }))
    .sort((a, b) => b.at - a.at);
  ordered.forEach((c, i) => {
    if (c.type === 'group') return;
    const other = otherByChat.get(c.id);
    if (!other || out.has(other)) return;
    out.set(other, i);
  });
  return out;
}

// The newest message time of each chat, newest first. chat_latest_messages
// (0100) returns one row per chat; before 0100 the fallback reads every
// message of every chat (newest first, so the first row per chat wins either
// way). PGRST202 / 42883 / 404 mean the function is missing; any other error
// also falls back rather than lose the ordering.
async function latestMessageTimes(chatIds: Uuid[]): Promise<{ chat_id: Uuid; created_at: string }[]> {
  const res = await supabase.rpc('chat_latest_messages', { p_chat_ids: chatIds });
  if (!res.error) return (res.data ?? []) as { chat_id: Uuid; created_at: string }[];
  const missing = res.error.code === 'PGRST202' || res.error.code === '42883' || res.status === 404;
  console.warn(
    missing ? 'chat_latest_messages unavailable (is 0100 applied?):' : 'chat_latest_messages failed:',
    res.error.message,
  );
  const { data } = await supabase
    .from('messages')
    .select('chat_id, created_at')
    .in('chat_id', chatIds)
    .order('created_at', { ascending: false });
  return (data ?? []) as { chat_id: Uuid; created_at: string }[];
}

// One conversation per pair, found or created by the database in one
// statement (0093): a client read-then-write made duplicate DMs when two
// people pressed Message at the same moment. Inlined from the chat area.
async function openOrCreateDm(otherUserId: Uuid): Promise<Uuid> {
  const me = await requireUid();
  if (otherUserId === me) throw new ApiError('cannot_dm_self');
  const { data, error } = await supabase.rpc('open_or_create_dm', { p_other: otherUserId });
  if (error) throw error;
  if (!data) throw new ApiError('dm_open_failed');
  return data as Uuid;
}

// A DM is private and deliberately NOT screened (see sendMessage in the chat
// area): this is the plain text-message insert.
async function sendTextMessage(chatId: Uuid, text: string) {
  const me = await requireUid();
  const { error } = await supabase.from('messages').insert({ chat_id: chatId, from_user_id: me, type: 'text', text });
  if (error) throw error;
}

// Sends any link to a set of people as a DM. Returns how many it reached.
// In parallel: a sequential loop cost two round trips per recipient (about
// four seconds for ten people). allSettled, so one failed recipient does not
// abandon the rest. Invalidate the inbox afterwards.
export async function shareLinkTo(link: string, userIds: Uuid[]): Promise<number> {
  if (!link || !userIds || !userIds.length) return 0;
  const results = await Promise.allSettled(
    userIds.map(async (userId) => {
      const chatId = await openOrCreateDm(userId);
      await sendTextMessage(chatId, link);
    }),
  );
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.warn('share to', userIds[i], 'failed:', (r.reason as Error)?.message);
  });
  return results.filter((r) => r.status === 'fulfilled').length;
}

export async function shareVideoTo(videoId: Uuid, userIds: Uuid[]): Promise<number> {
  if (!videoId || !userIds || !userIds.length) return 0;
  const sent = await shareLinkTo(videoLink(videoId), userIds);
  // Only a video has a share counter to bump.
  if (sent) {
    try {
      await countShare(videoId);
    } catch {}
  }
  return sent;
}

export async function shareProfileTo(userId: Uuid, userIds: Uuid[]): Promise<number> {
  if (!userId || !userIds || !userIds.length) return 0;
  return shareLinkTo(profileLink(userId), userIds);
}

// Increments a video's share counter. Never throws.
export async function countShare(videoId: Uuid): Promise<void> {
  const { error } = await supabase.rpc('increment_share_count', { p_video_id: videoId });
  if (error) console.warn('countShare failed:', error.message);
}
