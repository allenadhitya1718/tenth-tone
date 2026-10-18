import type { TFunction } from 'i18next';

import { ApiError } from '@/api/client';

// A failed post as a translated title and body. content_blocked carries the
// moderator's reason in Arabic; it is shown as is to Arabic readers and
// replaced by the translated explanation otherwise.
export function storyError(e: unknown, t: TFunction, lang: string): { title: string; body: string } {
  const code = e instanceof ApiError ? e.code : '';
  switch (code) {
    case 'story_rate_limited':
      return { title: t('stories.errRateLimited'), body: t('stories.errRateLimitedBody') };
    case 'content_blocked': {
      const reason = e instanceof ApiError && e.message && e.message !== code ? e.message : '';
      return { title: t('stories.errBlocked'), body: lang === 'ar' && reason ? reason : t('stories.errBlockedBody') };
    }
    case 'quota_exceeded':
    case 'file_too_large':
    case 'bad_size':
      return { title: t('stories.errFailed'), body: t('stories.errTooLarge') };
    case 'bad_extension':
    case 'bad_content_type':
      return { title: t('stories.errFailed'), body: t('stories.errFormat') };
    case 'not_signed_in':
      return { title: t('stories.errFailed'), body: t('stories.errSignedOut') };
    default:
      return { title: t('stories.errFailed'), body: t('stories.errFailedBody') };
  }
}
