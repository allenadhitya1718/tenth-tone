import type { TFunction } from 'i18next';

// "now", "5m", "3h", "2d", "4w", then a date. Short forms, as on the web
// app's comment and notification rows.
export function timeAgo(iso: string, t: TFunction, locale: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t('time.now');
  if (s < 3600) return t('time.m', { n: Math.floor(s / 60) });
  if (s < 86400) return t('time.h', { n: Math.floor(s / 3600) });
  if (s < 604800) return t('time.d', { n: Math.floor(s / 86400) });
  if (s < 2419200) return t('time.w', { n: Math.floor(s / 604800) });
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}
