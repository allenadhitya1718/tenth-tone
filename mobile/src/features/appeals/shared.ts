import type { Ionicons } from '@expo/vector-icons';
import type { TFunction } from 'i18next';
import type { ComponentProps } from 'react';

import type { AppealableItem, AppealStatus, AppealTargetType } from '@/api/appeals';
import { ApiError } from '@/api/client';
import type { Iso } from '@/api/types';
import { errorText } from '@/features/settings/components';

type IconName = ComponentProps<typeof Ionicons>['name'];

const P = 'settings2.appeals';

// "Video hidden" / "Video removed" / "Account suspension" ...
export function itemLabel(t: TFunction, type: AppealTargetType, deleted?: boolean): string {
  if (type === 'user') return t(`${P}.type.ban`);
  if (type === 'live_stream') return t(`${P}.type.live_stream`);
  if (type === 'story') return t(`${P}.type.story_removed`);
  if (type === 'live_comment') return t(`${P}.type.live_comment_removed`);
  return t(`${P}.type.${type}_${deleted ? 'removed' : 'hidden'}`);
}

export function itemIcon(type: AppealTargetType): IconName {
  switch (type) {
    case 'user':
      return 'ban-outline';
    case 'video':
      return 'videocam-outline';
    case 'comment':
    case 'live_comment':
      return 'chatbubble-outline';
    case 'story':
      return 'aperture-outline';
    case 'live_stream':
      return 'radio-outline';
  }
}

// The moderation reason as the person should read it. Report-threshold
// hides read "auto: reported 5 times"; admin hides "admin: <text>".
export function moderatorReason(t: TFunction, reason: string | null | undefined): string | null {
  const r = (reason ?? '').trim();
  if (!r) return null;
  if (/^auto:/i.test(r)) return t(`${P}.reasonAuto`);
  return r.replace(/^admin:\s*/i, '') || null;
}

export function statusLabel(t: TFunction, s: AppealStatus): string {
  return t(`${P}.status_${s}`);
}

export function formatDate(iso: Iso | null | undefined, lang: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return new Date(iso).toDateString();
  }
}

// A new appeal is possible when there is none, or the last one was decided
// before the item was actioned again (the server enforces the same rule).
export function canAppeal(item: AppealableItem): boolean {
  const a = item.appeal;
  if (!a) return true;
  if (a.status === 'open') return false;
  return !!a.decided_at && new Date(a.decided_at).getTime() < new Date(item.actioned_at).getTime();
}

export function appealErrorText(e: unknown, t: TFunction): string {
  if (e instanceof ApiError && e.code.startsWith('appeal')) return t(`${P}.errors.${e.code}`);
  return errorText(e, t);
}
