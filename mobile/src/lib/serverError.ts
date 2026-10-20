import { ApiError } from '@/api/client';

// Why a server call was refused, as a translation key under "errors." (same
// pattern as authErrorKey). Null when the cause is not one we can name; the
// caller then shows only its own headline. Never shows raw Postgres text.
//
//   rate limit  : "too many ... please wait" (check_violation, 0050) or too_soon
//   denied      : row-level security refused the insert (blocked, who-can-message,
//                 who-can-comment, comments off): the database does not say which
//   network     : no connection / timeout
export type RefusalKind = 'rate' | 'denied' | 'network';

export function refusalKind(e: unknown): RefusalKind | null {
  if (e instanceof ApiError && (e.code === 'too_soon' || e.code === 'rate_limited' || e.code === 'support_rate_limited')) {
    return 'rate';
  }
  const err = e as { message?: unknown; code?: unknown; status?: unknown } | null;
  const m = String(err?.message ?? '');
  const code = String(err?.code ?? '');
  if (/too many|rate limit|please wait|slow down/i.test(m) || err?.status === 429) return 'rate';
  if (code === '42501' || /row-level security|permission denied|\bblocked\b|not allowed|forbidden/i.test(m) || err?.status === 403) {
    return 'denied';
  }
  if (/network|failed to fetch|timed? ?out|offline|internet/i.test(m)) return 'network';
  return null;
}

export function sendRefusalKey(e: unknown): string | null {
  const k = refusalKind(e);
  return k === 'rate' ? 'errors.rateLimited' : k === 'denied' ? 'errors.sendDenied' : k === 'network' ? 'errors.network' : null;
}

export function commentRefusalKey(e: unknown): string | null {
  const k = refusalKind(e);
  return k === 'rate' ? 'errors.rateLimited' : k === 'denied' ? 'errors.commentDenied' : k === 'network' ? 'errors.network' : null;
}
