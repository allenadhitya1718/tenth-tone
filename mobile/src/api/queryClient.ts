import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

import { clearSavedQueryCache, persistQueryCache, restoreQueryCache } from './persistCache';

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

// Who the saved cache belongs to right now.
let cacheUid: string | null = null;

// Signing out must not leave the previous account's data behind, in memory
// or on the phone.
supabase.auth.onAuthStateChange((event, session) => {
  cacheUid = session?.user.id ?? null;
  if (event === 'SIGNED_OUT') {
    queryClient.clear();
    void clearSavedQueryCache();
  }
});

let booted = false;

// Before the first screen: the saved cache of the signed-in account is put
// back (persistCache.ts), then kept up to date. Never throws, and gives up
// waiting after 1.5 s so a slow disk cannot hold the app on the splash.
export async function bootQueryCache(): Promise<void> {
  if (booted) return;
  booted = true;
  const restore = (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      cacheUid = data.session?.user.id ?? null;
      if (cacheUid) await restoreQueryCache(queryClient, cacheUid);
    } catch {}
  })();
  await Promise.race([restore, new Promise((r) => setTimeout(r, 1_500))]);
  persistQueryCache(queryClient, () => cacheUid);
}
