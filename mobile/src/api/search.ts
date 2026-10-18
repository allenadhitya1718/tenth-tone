// People search and the filter helpers it needs, shared by profiles.ts and
// discover.ts so blocking and escaping are applied in exactly one place.
import { supabase, uid } from './client';
import type { UserSummary, Uuid } from './types';

export type PersonResult = UserSummary & { bio?: string | null; followers_count?: number | null };

// Handles are stored without the '@', so "@sara" matched nothing (client
// note 30). Strip it, plus surrounding space, before any people lookup.
export function normalizePeopleQuery(q: string | null | undefined) {
  return String(q ?? '').trim().replace(/^@+/, '').trim();
}

// `%` and `_` are LIKE wildcards; escape them so they match literally.
export const likePattern = (s: string) => `%${s.replace(/[\\%_]/g, '\\$&')}%`;

// A value inside a PostgREST .or() list. Raw input with a comma or bracket
// would end the condition early or inject a new one; double-quoted (with
// quotes and backslashes escaped) it is always a single literal.
export const orValue = (s: string) => `"${s.replace(/["\\]/g, '\\$&')}"`;

// The people YOU have blocked. Only that direction: `blocks read own` (0004)
// is blocker_id = auth.uid(), and 0054 already hides people who blocked you.
async function blockedIds(): Promise<Uuid[]> {
  try {
    const me = await uid();
    if (!me) return [];
    const { data } = await supabase.from('blocks').select('blocked_id').eq('blocker_id', me);
    return ((data ?? []) as { blocked_id: Uuid }[]).map((r) => r.blocked_id);
  } catch {
    return [];
  }
}

// Cosmetic filter for fallback paths only (before 0065). Nothing that has to
// hold rests on it.
export async function withoutBlocked<T extends { id: Uuid }>(rows: T[]): Promise<T[]> {
  if (!rows.length) return rows;
  const ids = new Set(await blockedIds());
  if (!ids.size) return rows;
  return rows.filter((r) => r && !ids.has(r.id));
}

// search_profiles (0065) filters blocks in BOTH directions in the database.
// It is an RPC rather than a stricter row policy because the Blocked Users
// screen must still see the people you blocked, or you could never unblock
// them. The plain query is a fallback for a database without 0065.
export async function searchPeople(query: string | null | undefined, limit: number): Promise<PersonResult[]> {
  const q = normalizePeopleQuery(query);
  if (!q) return [];
  const { data, error } = await supabase.rpc('search_profiles', { p_query: q, p_limit: limit });
  if (!error) return (data ?? []) as PersonResult[];
  console.warn('search_profiles unavailable (is 0065 applied?):', error.message);
  const term = orValue(likePattern(q));
  const r = await supabase
    .from('profiles')
    .select('id, name, handle, avatar_url, bio, verified, followers_count')
    .or(`name.ilike.${term},handle.ilike.${term}`)
    .limit(limit);
  return withoutBlocked((r.data ?? []) as PersonResult[]);
}
