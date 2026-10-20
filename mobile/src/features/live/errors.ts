import { ApiError } from '@/api/client';
import type { ErrorMsg } from '@/components/ui';
import { refusalKind } from '@/lib/serverError';

// ApiError codes the live and wallet screens can meet (src/api/live.ts,
// gifts.ts, agora.ts, wallet.ts). Each has a string under live.errors.<code>.
const KNOWN = new Set([
  'not_signed_in',
  'live_not_found',
  'live_not_live',
  'not_host',
  'host_is_you',
  'blocked',
  'not_watching',
  'stage_full',
  'removed_by_host',
  'too_soon',
  'no_invitation',
  'no_request',
  'not_on_stage',
  'live_guests_unavailable',
  'empty_comment',
  'comment_too_long',
  'content_blocked',
  'insufficient_balance',
  'gift_not_found',
  'gift_invalid_price',
  'gift_no_recipient',
  'gift_to_self',
  'gift_recipient_not_in_live',
  'gift_unavailable',
  'agora_bad_request',
  'agora_forbidden',
  'agora_unavailable',
  'agora_no_token',
  'agora_not_installed',
  'agora_join_failed',
  'mic_denied',
  'same_uid_login',
]);

export function errorCode(e: unknown): string | null {
  return e instanceof ApiError ? e.code : null;
}

// A translation key (not text), so a message on screen follows a language
// switch, the same convention as ErrorBox.
export function liveError(e: unknown, fallback = 'live.errors.generic'): NonNullable<ErrorMsg> {
  const code = errorCode(e);
  if (code && KNOWN.has(code)) return { key: `live.errors.${code}` };
  // A database rate limit ("too many ... please wait"), or no connection.
  const kind = refusalKind(e);
  if (kind === 'rate') return { key: 'errors.rateLimited' };
  if (kind === 'network') return { key: 'errors.network' };
  return { key: fallback };
}

// The server's own words for a refused title, cover or comment (Arabic), when
// it gave any. Shown under the translated headline.
export function serverDetail(e: unknown): string | undefined {
  if (e instanceof ApiError && e.code === 'content_blocked' && e.message && e.message !== e.code) return e.message;
  return undefined;
}
