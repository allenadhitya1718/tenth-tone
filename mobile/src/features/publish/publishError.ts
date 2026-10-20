import { ApiError } from '@/api/client';
import { refusalKind } from '@/lib/serverError';

// Why a post or draft failed, as a translation key (same pattern as
// authErrorKey). Only causes we can name; null leaves the generic hint.
export function publishErrorKey(e: unknown): string | null {
  const code = e instanceof ApiError ? e.code : '';
  if (code.startsWith('quota') || code === 'file_too_large' || code === 'bad_size') return 'publish.tooLarge';
  if (code === 'bad_extension' || code === 'bad_content_type') return 'publish.errFormat';
  if (code === 'too_many_pending') return 'publish.errPending';
  if (code === 'not_signed_in') return 'publish.errSignedOut';
  if (code === 'upload_failed') return 'publish.errUploadFailed';
  if (code === 'upload_unavailable') return 'publish.errUnavailable';
  const kind = refusalKind(e);
  if (kind === 'rate') return 'errors.rateLimited';
  if (kind === 'network') return 'errors.network';
  if (kind === 'denied') return 'publish.errDenied';
  return null;
}
