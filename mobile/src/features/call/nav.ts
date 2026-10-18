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

// /call/dial is also reachable from OUTSIDE the app (flyp://call/dial?to=...),
// so the route itself proves nothing: a link from a web page or another app
// could place a call the moment it was opened, under any name and photo it
// liked ("name=Mom"). So the dial details never travel in the URL. dialPath()
// files them here under the link's nonce, in this JS context only, and the
// dial screen dials straight away ONLY for a nonce it finds here with the
// same callee. Anything else is treated as an outside link: the screen asks
// first and shows the callee's name and photo from the server.
const DIAL_INTENT_TTL_MS = 10 * 60 * 1000;
const dialIntents = new Map<string, { p: DialParams; at: number }>();

export function dialPath(p: DialParams) {
  // A fresh nonce per tap: the screen dials once for it, and a re-render or
  // remount of the same screen never rings twice.
  const nonce =
    Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const now = Date.now();
  for (const [k, v] of dialIntents) if (now - v.at > DIAL_INTENT_TTL_MS) dialIntents.delete(k);
  dialIntents.set(nonce, { p, at: now });
  const q = new URLSearchParams();
  q.set('to', p.to);
  q.set('kind', p.kind);
  q.set('n', nonce);
  return `/call/dial?${q.toString()}`;
}

/** The in-app dial request behind a /call/dial link, or null for an outside link. */
export function dialIntent(nonce: string | undefined, to: string | undefined): DialParams | null {
  if (!nonce || !to) return null;
  const it = dialIntents.get(nonce);
  if (!it || it.p.to !== to || Date.now() - it.at > DIAL_INTENT_TTL_MS) return null;
  return it.p;
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
