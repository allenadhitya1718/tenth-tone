import { type Href, router } from 'expo-router';

// Paths to the call screens, and opening one without stacking duplicates.
//
// Three things can open the same ringing call within a second of each other:
// the realtime INSERT, the poll that backs it up, and a tapped push. Each
// would push its own screen; only the first within a few seconds goes
// through, and none while a screen for that call is already mounted.
export const callPath = (callId: string) => `/call/${encodeURIComponent(callId)}`;

export type DialParams = {
  to: string;
  kind: 'audio' | 'video';
  chat?: string | null;
  name?: string | null;
  handle?: string | null;
  avatar?: string | null;
};

export function dialPath(p: DialParams) {
  const q = new URLSearchParams();
  q.set('to', p.to);
  q.set('kind', p.kind);
  // A fresh nonce per tap: the screen dials once for it, and a re-render or
  // remount of the same screen never rings twice.
  q.set('n', Math.random().toString(36).slice(2, 10) + Date.now().toString(36));
  if (p.chat) q.set('chat', p.chat);
  if (p.name) q.set('name', p.name);
  if (p.handle) q.set('handle', p.handle);
  if (p.avatar) q.set('avatar', p.avatar);
  return `/call/dial?${q.toString()}`;
}

const mounted = new Map<string, number>();
let last: { id: string; at: number } | null = null;

/** The call screen registers itself while mounted. Returns the cleanup. */
export function markCallScreen(callId: string) {
  mounted.set(callId, (mounted.get(callId) ?? 0) + 1);
  return () => {
    const n = (mounted.get(callId) ?? 1) - 1;
    if (n <= 0) mounted.delete(callId);
    else mounted.set(callId, n);
  };
}

export const callScreenOpen = (callId: string) => (mounted.get(callId) ?? 0) > 0;

export function openCallScreen(callId: string) {
  if (callScreenOpen(callId)) return;
  if (last && last.id === callId && Date.now() - last.at < 5000) return;
  last = { id: callId, at: Date.now() };
  router.push(callPath(callId) as Href);
}

export function leaveCallScreen() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
