// Shared plumbing for every module in src/api. Port of the helpers at the
// top of web/js/db.js.
import type { PostgrestError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

export { supabase };

// Our own user id, from the locally stored session (~1 ms). getUser() would
// re-validate with the auth server (~250 ms) on every call. The id only
// BUILDS queries; RLS derives auth.uid() from the JWT on every request, so
// nothing is authorised by trusting this value.
export async function uid(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

export async function requireUid(): Promise<string> {
  const id = await uid();
  if (!id) throw new ApiError('not_signed_in', 'not signed in');
  return id;
}

// A failure with a stable machine-readable code, so screens can map it to a
// translated message instead of showing raw server text.
export class ApiError extends Error {
  code: string;
  detail?: unknown;
  constructor(code: string, message?: string, detail?: unknown) {
    super(message ?? code);
    this.code = code;
    this.detail = detail;
  }
}

// Unwraps a Supabase response: returns data or throws its error.
export function must<T>(res: { data: T; error: PostgrestError | null }): T {
  if (res.error) throw res.error;
  return res.data;
}

// "No rows" from .single() is not an error for a lookup.
export function isNoRows(e: unknown) {
  return (e as PostgrestError | null)?.code === 'PGRST116';
}

// Runs a promise for its side effect without letting a failure surface
// (analytics, cleanup): the caller's action has already succeeded.
export function fireAndForget(p: PromiseLike<unknown>, label: string) {
  Promise.resolve(p).catch((e) => console.warn(`${label}:`, (e as Error)?.message ?? e));
}

// A unique realtime topic for a postgres_changes listener. supabase-js
// refuses (or reuses) a second channel with the same topic, so two screens
// watching the same chat would break each other. Broadcast and presence
// channels must NOT use this: their topic is how clients find each other.
export function listenerTopic(base: string) {
  return `${base}:${Math.random().toString(36).slice(2, 10)}`;
}
