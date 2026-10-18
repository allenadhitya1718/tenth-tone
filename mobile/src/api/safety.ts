// Blocking, muting, restricting and hidden words. Port of the matching
// sections of web/js/db.js.
//
// ApiError codes thrown here:
//   not_signed_in   (from requireUid in client.ts)
//   no_user_given   unblockUser called without an id
//
// Caching: none here. Screens use safetyKeys with TanStack Query. A block or
// unblock should also invalidate followers, following, isFollowing, the feed
// and any people search, which is what db.js's _forgetBlockCaches dropped.
import { ApiError, requireUid, supabase, uid } from './client';
import type { Iso, UserSummary, Uuid } from './types';

export const safetyKeys = {
  blocked: () => ['blocked'] as const,
  muted: () => ['muted'] as const,
  isMuted: (id: Uuid) => ['muted', id] as const,
  restricted: () => ['restricted'] as const,
  isRestricted: (id: Uuid) => ['restricted', id] as const,
  hiddenWords: () => ['hiddenWords'] as const,
};

// list_blocked (0065), or the pre-0065 fallback. name/handle/avatar_url may
// be empty strings when the blocked person has also blocked you.
export type BlockedUser = {
  id: Uuid;
  name: string | null;
  handle: string | null;
  avatar_url: string | null;
  blocked_at: Iso | null;
};

type ProfileJoinRow = { profiles: UserSummary | null };

// ---------- Block ----------

export async function blockUser(userId: Uuid): Promise<void> {
  const me = await requireUid();
  const { error } = await supabase.from('blocks').insert({ blocker_id: me, blocked_id: userId });
  if (error && error.code !== '23505') throw error;

  // Apple 1.2 asks that blocking also notify the developer, not merely hide
  // the content, so a block files a report into the same queue. Best effort:
  // the block is already written and the person already protected, so a
  // failure here must not report a working block as broken.
  try {
    const { error: rErr } = await supabase.from('reports').insert({
      reporter_id: me,
      target_type: 'user',
      target_id: userId,
      // Stored text read by admins, kept identical to the web app.
      reason: 'حظر المستخدم — بلاغ تلقائي',
    });
    if (rErr) console.warn('block filed, report did not:', rErr.message);
  } catch (e) {
    console.warn('block filed, report did not:', (e as Error)?.message);
  }
}

export async function unblockUser(userId: Uuid): Promise<void> {
  const me = await requireUid();
  if (!userId) throw new ApiError('no_user_given', 'no user given');
  const { error } = await supabase.from('blocks').delete().eq('blocker_id', me).eq('blocked_id', userId);
  if (error) throw error;
}

type BlockFallbackRow = {
  blocked_id: string;
  created_at: Iso;
  profiles: Pick<UserSummary, 'id' | 'name' | 'handle' | 'avatar_url'> | null;
};

// The list behind Settings > Blocked users.
//
// Joining profiles from blocks used to drop anyone who had ALSO blocked you:
// under 0054 their profile reads as null, so they vanished from the only
// screen they could be unblocked from. list_blocked (0065) is SECURITY
// DEFINER and returns only rows you created, so it sees past that policy
// without giving anything else away.
export async function fetchBlocked(): Promise<BlockedUser[]> {
  const me = await uid();
  if (!me) return [];
  const { data, error } = await supabase.rpc('list_blocked');
  if (!error) return (data as BlockedUser[] | null) ?? [];
  console.warn('list_blocked unavailable (is 0065 applied?):', error.message);
  // Pre-0065 fallback. Keeps a row for a mutual block so the Unblock button
  // still has an id even when the name and photo cannot be read.
  const r = await supabase
    .from('blocks')
    .select('blocked_id, created_at, profiles:profiles!blocks_blocked_id_fkey(id,name,handle,avatar_url)')
    .eq('blocker_id', me)
    .order('created_at', { ascending: false });
  if (r.error) throw r.error;
  const rows = (r.data as unknown as BlockFallbackRow[] | null) ?? [];
  return rows.map((row) => ({
    id: row.blocked_id,
    name: '',
    handle: '',
    avatar_url: '',
    blocked_at: row.created_at,
    ...(row.profiles ?? {}),
  }));
}

// ---------- Hidden words ----------

export async function fetchHiddenWords(): Promise<string[]> {
  const me = await uid();
  if (!me) return [];
  const { data, error } = await supabase.from('hidden_words').select('word').eq('user_id', me);
  if (error) return [];
  return ((data as { word: string }[] | null) ?? []).map((r) => r.word);
}

export async function addHiddenWord(word: string): Promise<void> {
  const me = await requireUid();
  const w = String(word ?? '').trim().toLowerCase();
  if (!w) return;
  const { error } = await supabase.from('hidden_words').insert({ user_id: me, word: w });
  if (error && error.code !== '23505') throw error;
}

export async function removeHiddenWord(word: string): Promise<void> {
  const me = await uid();
  if (!me) return;
  const { error } = await supabase
    .from('hidden_words')
    .delete()
    .eq('user_id', me)
    .eq('word', String(word).trim().toLowerCase());
  if (error) throw error;
}

// ---------- Restrict ----------

export async function fetchRestricted(): Promise<UserSummary[]> {
  const me = await uid();
  if (!me) return [];
  const { data, error } = await supabase
    .from('restricted_users')
    .select('restricted_id, profiles:profiles!restricted_users_restricted_id_fkey(id,name,handle,avatar_url)')
    .eq('user_id', me);
  if (error) return [];
  const rows = (data as unknown as ProfileJoinRow[] | null) ?? [];
  return rows.flatMap((r) => (r.profiles ? [r.profiles] : []));
}

export async function restrictUser(targetId: Uuid): Promise<void> {
  const me = await requireUid();
  const { error } = await supabase.from('restricted_users').insert({ user_id: me, restricted_id: targetId });
  if (error && error.code !== '23505') throw error;
}

export async function unrestrictUser(targetId: Uuid): Promise<void> {
  const me = await uid();
  if (!me) return;
  const { error } = await supabase
    .from('restricted_users')
    .delete()
    .eq('user_id', me)
    .eq('restricted_id', targetId);
  if (error) throw error;
}

export async function isRestricted(targetId: Uuid): Promise<boolean> {
  const me = await uid();
  if (!me) return false;
  const { count } = await supabase
    .from('restricted_users')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', me)
    .eq('restricted_id', targetId);
  return (count ?? 0) > 0;
}

// ---------- Mute ----------

export async function fetchMuted(): Promise<UserSummary[]> {
  const me = await uid();
  if (!me) return [];
  const { data, error } = await supabase
    .from('muted_users')
    .select('muted_id, profiles:profiles!muted_users_muted_id_fkey(id,name,handle,avatar_url)')
    .eq('user_id', me);
  if (error) return [];
  const rows = (data as unknown as ProfileJoinRow[] | null) ?? [];
  return rows.flatMap((r) => (r.profiles ? [r.profiles] : []));
}

export async function muteUser(targetId: Uuid): Promise<void> {
  const me = await requireUid();
  const { error } = await supabase.from('muted_users').insert({ user_id: me, muted_id: targetId });
  if (error && error.code !== '23505') throw error;
}

export async function unmuteUser(targetId: Uuid): Promise<void> {
  const me = await uid();
  if (!me) return;
  const { error } = await supabase.from('muted_users').delete().eq('user_id', me).eq('muted_id', targetId);
  if (error) throw error;
}

export async function isMuted(targetId: Uuid): Promise<boolean> {
  const me = await uid();
  if (!me) return false;
  const { count } = await supabase
    .from('muted_users')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', me)
    .eq('muted_id', targetId);
  return (count ?? 0) > 0;
}
