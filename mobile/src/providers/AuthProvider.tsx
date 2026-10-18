import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

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
