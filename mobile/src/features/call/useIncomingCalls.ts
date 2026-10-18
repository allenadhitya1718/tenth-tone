import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';

import { declineCall, fetchIncomingCall, subscribeToIncomingCalls, type Call } from '@/api/calls';
import { showToast } from '@/components/Toast';
import { useAuth } from '@/providers/AuthProvider';

import { getCallState, isCallActive } from './callSession';
import { openCallScreen } from './nav';

// Rings this phone: mount ONCE inside the signed-in navigator (RootNavigator).
//
// Port of initIncomingCalls in web/js/views.js. Realtime is the fast path,
// not the source of truth: a ringing row in the database is. So, as the web
// app learned the hard way, there is also a look on start, on every return to
// the foreground and every 15 s while open - a dropped socket or a call
// placed in the second before the subscription attached still rings.
//
// Already in a call: the new one is declined at once, so its caller is not
// left listening to a ring nobody can answer, and a toast says so.
const POLL_MS = 15_000;
// fetchIncomingCall already ignores rings older than a minute; realtime can
// replay an insert after a reconnect, so the same limit applies to it.
const STALE_MS = 60_000;

const seen = new Set<string>();

// A call push reached the app while it is in front (background.ts): look for
// the ringing row now instead of waiting for realtime or the next poll.
let pokeCheck: (() => void) | null = null;
export function checkIncomingCallsNow() {
  pokeCheck?.();
}

export function useIncomingCalls() {
  const { session } = useAuth();
  const me = session?.user.id ?? null;
  const { t } = useTranslation();

  useEffect(() => {
    if (!me) return;
    let alive = true;

    const ring = (row: Call) => {
      if (!alive || !row || row.status !== 'ringing' || row.callee_id !== me) return;
      if (Date.now() - Date.parse(row.created_at) > STALE_MS) return;
      const s = getCallState();
      if (s.callId === row.id) return; // already on screen
      if (isCallActive(s)) {
        if (seen.has(row.id)) return;
        seen.add(row.id);
        void declineCall(row.id).catch(() => {});
        showToast(t('call.busyDeclined'), 'call');
        return;
      }
      if (seen.has(row.id)) return;
      seen.add(row.id);
      openCallScreen(row.id);
    };

    const check = () => {
      if (AppState.currentState !== 'active') return;
      fetchIncomingCall()
        .then((r) => r && ring(r))
        .catch(() => {});
    };

    const unsub = subscribeToIncomingCalls(ring);
    check();
    pokeCheck = check;
    const poll = setInterval(check, POLL_MS);
    const app = AppState.addEventListener('change', (st) => st === 'active' && check());
    return () => {
      alive = false;
      if (pokeCheck === check) pokeCheck = null;
      unsub();
      clearInterval(poll);
      app.remove();
    };
  }, [me, t]);
}
