import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { fetchPresence, presenceKeys, touchPresence } from '@/api/presence';

const HEARTBEAT_MS = 60_000;
// Within this of the last heartbeat counts as "Active now".
const ONLINE_MS = 2.5 * 60_000;

// While signed in and the app is in front: "I am here" now, then every
// minute; once more on going to the back, so "last seen" is when you left.
export function usePresenceHeartbeat(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      void touchPresence();
      if (!timer) timer = setInterval(() => void touchPresence(), HEARTBEAT_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') start();
      else {
        void touchPresence();
        stop();
      }
    });
    return () => {
      sub.remove();
      stop();
    };
  }, [signedIn]);
}

// Another person's last activity, refreshed every minute while shown.
export function usePresence(userId: string | null | undefined) {
  return useQuery({
    queryKey: presenceKeys.user(userId ?? ''),
    queryFn: () => fetchPresence(userId!),
    enabled: !!userId,
    refetchInterval: HEARTBEAT_MS,
    staleTime: 30_000,
  });
}

// "Active now", "Active 5m ago", "Last seen today at 21:40", "Last seen
// yesterday at 21:40", "Last seen 12 Oct". Null when nothing is shown.
export function presenceLabel(iso: string | null | undefined, t: TFunction, locale: string, now = Date.now()): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const ago = Math.max(0, now - at);
  if (ago < ONLINE_MS) return t('presence.activeNow');
  const mins = Math.round(ago / 60_000);
  if (mins < 60) return t('presence.activeMinutes', { count: mins });
  const d = new Date(at);
  const time = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const today = new Date(now);
  const yesterday = new Date(now - 86_400_000);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return t('presence.lastSeenToday', { time });
  if (sameDay(d, yesterday)) return t('presence.lastSeenYesterday', { time });
  return t('presence.lastSeenDate', { date: d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }) });
}
