// Profiles, handles, people search, follows, follow requests and close
// friends. Port of the matching sections of web/js/db.js, plus
// updateProfile / uploadAvatar from web/js/supabase.js.
//
// ApiError codes thrown here:
//   not_signed_in   (from requireUid in client.ts)
//   content_blocked moderation refused a profile edit or avatar (message is
//                   the server's text)
//
// Caching: none here. Screens use profileKeys with TanStack Query. A follow,
// unfollow or profile edit should invalidate profileKeys.profile(both ids),
// isFollowing, followers, following and the feed's Following tab, which is
// what db.js's _invalidateFollowGraph dropped by hand.
import { ApiError, isNoRows, must, requireUid, supabase, uid } from './client';
import { attach, checkText, checkImage } from './moderation';
import { type PersonResult, searchPeople } from './search';
import { uploadToStorage, type LocalMedia } from './upload';
import type { Iso, UserSummary, Uuid } from './types';

export const profileKeys = {
  all: ['profile'] as const,
  profile: (id: Uuid) => ['profile', id] as const,
  byHandle: (handle: string) => ['profile', 'handle', handle.trim().toLowerCase()] as const,
  search: (q: string) => ['profile', 'search', q.trim()] as const,
  handles: (prefix: string, limit: number) => ['profile', 'handles', prefix, limit] as const,
  isFollowing: (id: Uuid) => ['isFollowing', id] as const,
  hasRequestedFollow: (id: Uuid) => ['followRequest', 'sent', id] as const,
  followers: (id: Uuid) => ['followers', id] as const,
  following: (id: Uuid) => ['following', id] as const,
  followRequests: () => ['followRequests'] as const,
  followRequestCount: () => ['followRequests', 'count'] as const,
  closeFriends: () => ['closeFriends'] as const,
};

// ---------- Types ----------

// A row of public.profiles. The table is world-readable, which is why the
// private fields (gender, country, birth date) live in user_private instead.
export type Profile = UserSummary & {
  bio: string | null;
  link?: string | null;
  followers_count: number;
  following_count: number;
  likes_count: number;
  is_private?: boolean;
  guidelines_accepted_at?: Iso | null;
  created_at: Iso;
  updated_at: Iso;
};

// The fields a person may edit on their own profile.
export type ProfilePatch = Partial<Pick<Profile, 'name' | 'bio' | 'link' | 'avatar_url' | 'handle'>> &
  Record<string, unknown>;

// list_followers / list_following (0055).
export type FollowListRow = UserSummary & { followers_count: number | null };

// search_profiles (0065) and its fallback query.
export type PeopleSearchRow = PersonResult;

export type HandleRow = Pick<UserSummary, 'id' | 'handle' | 'name' | 'avatar_url' | 'verified'>;

export type ProfileByHandle = UserSummary & { is_private: boolean | null };

export type FollowRequest = UserSummary & { requested_at: Iso };

export type FollowResult = 'following' | 'requested';

// ---------- Profile by id / edit ----------

// Every column a client may read (0124). is_admin, banned_until,
// deactivated_at and deletion_scheduled_at are not readable by the app any
// more; your own account state comes from my_account_status() and is_admin().
// select('*') would now be refused outright, so list the columns.
export const PROFILE_COLUMNS =
  'id, handle, name, bio, avatar_url, verified, followers_count, following_count, likes_count, created_at, updated_at, guidelines_accepted_at, is_private, link';

export async function fetchProfile(userId: Uuid | null | undefined): Promise<Profile | null> {
  if (!userId) return null;
  const { data, error } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).single();
  if (error && !isNoRows(error)) throw error;
  return (data as Profile | null) ?? null;
}

// Port of SB.updateProfile. Name, bio and link are public and read on every
// comment and chat row, so the free-text fields are screened before saving
// and the verdict is attached to the account afterwards ('user' is the only
// report target a profile has). A flag-only patch screens nothing, so it
// spends no request against the moderation provider's daily cap.
export async function updateProfile(userId: Uuid, fields: ProfilePatch): Promise<Profile> {
  const words = [fields.name, fields.bio, fields.link]
    .filter((v): v is string => typeof v === 'string' && !!v.trim())
    .join('\n');
  const verdict = words ? await checkText('profile', words) : null;
  if (verdict?.blocked) throw new ApiError('content_blocked', verdict.message ?? undefined);

  const res = await supabase.from('profiles').update(fields).eq('id', userId).select(PROFILE_COLUMNS).single();
  const saved = must(res) as Profile;
  if (verdict) void attach(verdict, 'user', userId);
  return saved;
}

// Port of SB.uploadAvatar. Returns the public URL; the caller saves it with
// updateProfile({ avatar_url }). Screened BEFORE upload, so a refused image
// never reaches the public bucket. Pass a downscaled copy (the screen resizes
// with expo-image-manipulator): an image over the moderation size limit is
// skipped, which fails open.
//
// The path carries a timestamp and is never reused, so the one-year
// cacheControl in uploadToStorage is safe; avatars appear on every feed item,
// comment and chat row, so an hour meant constant re-downloads.
export async function uploadAvatar(media: LocalMedia): Promise<string> {
  const verdict = await checkImage('avatar', media);
  if (verdict.blocked) throw new ApiError('content_blocked', verdict.message ?? undefined);
  return uploadToStorage('avatars', media, { prefix: 'avatar', upsert: true });
}

// ---------- Handles ----------

export async function fetchProfileByHandle(handle: string | null | undefined): Promise<ProfileByHandle | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, handle, avatar_url, verified, is_private')
    .ilike('handle', String(handle ?? '').trim())
    .maybeSingle();
  if (error) return null;
  return (data as ProfileByHandle | null) ?? null;
}

// Typeahead for the @ picker while composing.
export async function searchHandles(prefix: string, limit = 8): Promise<HandleRow[]> {
  const { data, error } = await supabase.rpc('search_handles', { p_prefix: prefix, p_limit: limit });
  if (!error) return (data as HandleRow[] | null) ?? [];
  // Before 0035 the function does not exist; fall back to a plain query.
  const r = await supabase
    .from('profiles')
    .select('id, handle, name, avatar_url, verified')
    .ilike('handle', prefix + '%')
    .limit(limit);
  return (r.data as HandleRow[] | null) ?? [];
}

// ---------- People search ----------
//
// Every person lookup goes through searchPeople so blocking is applied in one
// place. search_profiles (0065) filters BOTH directions in the database. The
// old `.or(name.ilike, handle.ilike)` query only got "they blocked me" from
// the 0054 row policy, so someone YOU blocked kept appearing in your results.
// It is an RPC rather than a stricter policy because the Blocked Users screen
// must still see the people you blocked, or you could never unblock them.

// Used by the new-message picker and the in-list search on followers /
// following.
export async function searchProfiles(q: string): Promise<PeopleSearchRow[]> {
  return searchPeople(q, 30);
}

// ---------- Follows ----------

// Returns 'following' or 'requested'. A private account turns a follow into a
// request, so the caller must render the button from what came back rather
// than assuming it worked.
export async function follow(userId: Uuid): Promise<FollowResult> {
  const me = await requireUid();
  if (me === userId) return 'following';
  const { data, error } = await supabase.rpc('follow_or_request', { p_target: userId });
  if (!error) return ((data as FollowResult | null) ?? 'following');
  // Before 0030 the function does not exist; the plain insert still works.
  if (error.code === 'PGRST202' || /function .*follow_or_request/i.test(error.message || '')) {
    const { error: e2 } = await supabase.from('follows').insert({ follower_id: me, followed_id: userId });
    if (e2 && e2.code !== '23505') throw e2;
    return 'following';
  }
  throw error;
}

export async function hasRequestedFollow(userId: Uuid): Promise<boolean> {
  const me = await uid();
  if (!me) return false;
  const { data, error } = await supabase
    .from('follow_requests')
    .select('target_id')
    .eq('requester_id', me)
    .eq('target_id', userId)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

export async function cancelFollowRequest(userId: Uuid): Promise<void> {
  const me = await uid();
  if (!me) return;
  const { error } = await supabase.from('follow_requests').delete().eq('requester_id', me).eq('target_id', userId);
  if (error) throw error;
}

type FollowRequestRow = { requester_id: string; created_at: Iso; profiles: UserSummary | null };

export async function fetchFollowRequests(): Promise<FollowRequest[]> {
  const me = await uid();
  if (!me) return [];
  const { data, error } = await supabase
    .from('follow_requests')
    .select(
      'requester_id, created_at, profiles:profiles!follow_requests_requester_id_fkey(id,name,handle,avatar_url,verified)',
    )
    .eq('target_id', me)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data as unknown as FollowRequestRow[] | null) ?? [];
  return rows.flatMap((r) => (r.profiles ? [{ ...r.profiles, requested_at: r.created_at }] : []));
}

export async function countFollowRequests(): Promise<number> {
  const me = await uid();
  if (!me) return 0;
  const { count, error } = await supabase
    .from('follow_requests')
    .select('*', { count: 'exact', head: true })
    .eq('target_id', me);
  if (error) return 0;
  return count ?? 0;
}

export async function approveFollowRequest(requesterId: Uuid): Promise<void> {
  await requireUid();
  const { error } = await supabase.rpc('approve_follow_request', { p_requester: requesterId });
  if (error) throw error;
}

export async function declineFollowRequest(requesterId: Uuid): Promise<void> {
  const me = await uid();
  if (!me) return;
  const { error } = await supabase
    .from('follow_requests')
    .delete()
    .eq('requester_id', requesterId)
    .eq('target_id', me);
  if (error) throw error;
}

export async function unfollow(userId: Uuid): Promise<true> {
  const me = await requireUid();
  const { error } = await supabase.from('follows').delete().eq('follower_id', me).eq('followed_id', userId);
  if (error) throw error;
  return true;
}

export async function isFollowing(userId: Uuid | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const me = await uid();
  if (!me) return false;
  const { data, error } = await supabase
    .from('follows')
    .select('followed_id')
    .eq('follower_id', me)
    .eq('followed_id', userId)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

// Goes through list_followers (0055) rather than querying follows directly.
// 0054 made a follow row visible only when both people in it are visible to
// you, so a private account following a PUBLIC one vanished from that public
// account's list ("1 follower" above an empty list). A row policy cannot know
// whose list is being asked for; the function takes the subject explicitly,
// checks once whether you may see that person's lists, and returns them.
export async function fetchFollowers(userId: Uuid | null | undefined): Promise<FollowListRow[]> {
  if (!userId) return [];
  const { data, error } = await supabase.rpc('list_followers', { p_user: userId });
  if (error) throw error;
  return (data as FollowListRow[] | null) ?? [];
}

// Same reasoning as fetchFollowers (0055).
export async function fetchFollowing(userId: Uuid | null | undefined): Promise<FollowListRow[]> {
  if (!userId) return [];
  const { data, error } = await supabase.rpc('list_following', { p_user: userId });
  if (error) throw error;
  return (data as FollowListRow[] | null) ?? [];
}

// ---------- Close friends ----------

type CloseFriendRow = { friend_id: string; profiles: UserSummary | null };

export async function fetchCloseFriends(): Promise<UserSummary[]> {
  const me = await uid();
  if (!me) return [];
  const { data, error } = await supabase
    .from('close_friends')
    .select('friend_id, profiles:profiles!close_friends_friend_id_fkey(id,name,handle,avatar_url)')
    .eq('user_id', me);
  if (error) throw error;
  const rows = (data as unknown as CloseFriendRow[] | null) ?? [];
  return rows.flatMap((r) => (r.profiles ? [r.profiles] : []));
}

export async function addCloseFriend(friendId: Uuid): Promise<void> {
  const me = await requireUid();
  const { error } = await supabase.from('close_friends').insert({ user_id: me, friend_id: friendId });
  if (error && error.code !== '23505') throw error;
}

export async function removeCloseFriend(friendId: Uuid): Promise<void> {
  const me = await uid();
  if (!me) return;
  const { error } = await supabase.from('close_friends').delete().eq('user_id', me).eq('friend_id', friendId);
  if (error) throw error;
}
