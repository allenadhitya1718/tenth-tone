import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// Server state lives here (TanStack Query), replacing the hand-written
// cached()/swr() cache in web/js/db.js: data paints from cache instantly and
// refreshes behind it, N callers share one request, and mutations update
// the cache in place.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: 1,
    },
  },
});

// React Native has no window focus; refetch stale queries when the app comes
// back to the foreground instead.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));
  onlineManager.setOnline(true);
}

// Signing out must not leave the previous account's data behind.
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') queryClient.clear();
});
