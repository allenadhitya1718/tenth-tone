import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // AsyncStorage is undefined during web static rendering; supabase-js
    // falls back to localStorage there.
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    storageKey: 'tt-auth',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Native apps get no visibility events, so token refresh has to be paused and
// resumed by hand or a session left in the background expires underneath us.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

// A throwaway client that never stores anything, for checks that must not
// disturb the live session (see verifyPassword in auth.ts).
export function probeClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
