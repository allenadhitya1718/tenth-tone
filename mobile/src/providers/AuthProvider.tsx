import type { Session } from '@supabase/supabase-js';
import { router, type Href } from 'expo-router';
import i18n from 'i18next';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { queryClient } from '@/api/queryClient';
import { showToast } from '@/components/Toast';
import { supabase } from '@/lib/supabase';

type AuthState = {
  session: Session | null;
  ready: boolean;
  // True while a password reset is mid-way. Verifying a recovery code signs
  // the device in, and without this the router would jump into the app
  // before the new password is set.
  recovering: boolean;
  setRecovering: (v: boolean) => void;
  // Holds data from the signup wizard until the code is verified, the way
  // the web app used sessionStorage. Memory only, on purpose.
  pending: Pending;
  setPending: (p: Pending) => void;
};

export type Pending = { signupEmail?: string; birthDate?: string; resetEmail?: string };

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [pending, setPending] = useState<Pending>({});

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useAccountGate(session?.user.id ?? null, recovering);

  const value = useMemo(
    () => ({ session, ready, recovering, setRecovering, pending, setPending }),
    [session, ready, recovering, pending],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

export const BANNED_ROUTE = '/appeals/banned';

// Once per signed-in account per app run (a fresh sign-in or a restored
// session): reactivate a deactivated account, cancel a scheduled deletion,
// or send a banned account to the banned screen. Not while a password reset
// is mid-way: the app routes are not mounted yet.
function useAccountGate(userId: string | null, recovering: boolean) {
  const checked = useRef<string | null>(null);
  useEffect(() => {
    if (!userId) {
      checked.current = null;
      return;
    }
    if (recovering || checked.current === userId) return;
    checked.current = userId;
    // Loaded lazily: the gate reaches the settings API, which imports the
    // auth helpers, whose push module imports this provider.
    import('@/features/appeals/accountGate')
      .then((m) => m.runAccountGate())
      .then((r) => {
        if (checked.current !== userId) return; // signed out meanwhile
        if (r.kind === 'reactivated') {
          showToast(
            i18n.t(r.deletionCancelled ? 'settings2.appeals.gate.deletionCancelled' : 'settings2.appeals.gate.welcomeBack'),
          );
          void queryClient.invalidateQueries({ queryKey: ['accountStatus'] });
        } else if (r.kind === 'banned') {
          void queryClient.invalidateQueries({ queryKey: ['accountStatus'] });
          openBannedScreen();
        }
      })
      .catch(() => {});
  }, [userId, recovering]);
}

// The (app) stack mounts on the same render that delivers the session; a
// replace before the navigator is ready throws, so it is retried briefly.
function openBannedScreen(attempt = 0) {
  try {
    router.replace(BANNED_ROUTE as Href);
  } catch {
    if (attempt < 8) setTimeout(() => openBannedScreen(attempt + 1), 250);
  }
}
