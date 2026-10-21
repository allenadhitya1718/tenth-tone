// The saved cache (owner request): the inbox, recent chats, notifications and
// your own profile are kept on the phone, so after a restart they show at
// once (even offline) and refresh from the server behind them. No server
// cache is involved: this is TanStack Query's own cache (queryClient.ts),
// written to AsyncStorage and read back before the first screen.
//
// Rules:
//   * Only the query keys in PERSIST, and only queries that loaded fine.
//   * Threads: the 25 most recently updated, each trimmed to its last 50
//     messages, sends still in flight left out.
//   * Not the video feed: a refresh would swap the clip under your thumb.
//   * One blob kept under 2 MB (Android's AsyncStorage refuses bigger rows);
//     the oldest threads go first when it is too big.
//   * Tied to the account, the app version and the over-the-air update, at
//     most 7 days old; anything else found on start is thrown away. Signing
//     out deletes it.
//   * Saved a couple of seconds after the cache changes, and at once when the
//     app goes to the background. Reading or writing never throws.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dehydrate, type DehydratedState, hydrate, type Query, type QueryClient, type QueryKey } from '@tanstack/react-query';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { AppState } from 'react-native';

const STORAGE_KEY = 'flyp.queryCache.v1';
const MAX_AGE_MS = 7 * 24 * 3600_000;
// Characters, not bytes: Arabic text is two bytes a character in UTF-8, so
// this stays under 2 MB either way.
const BUDGET_CHARS = 900_000;
const MAX_THREADS = 25;
const MAX_MESSAGES = 50;
const SAVE_DELAY_MS = 2_000;

type Blob = { v: 1; uid: string; app: string; savedAt: number; state: DehydratedState };

// The app version AND the over-the-air update running: an update keeps the
// version (2.0.0) but can change what a cached query holds, so each update
// starts from an empty saved cache rather than misreading the last one's.
const appVersion = () => `${Constants.expoConfig?.version ?? ''}+${Updates.updateId ?? 'embedded'}`;

// First key segment, and for 'chats' / 'notifications' the second too.
function persistable(key: QueryKey): boolean {
  const [a, b] = key as unknown[];
  switch (a) {
    case 'chats':
      // The list, a chat's header info, its receipts, the unread badge.
      return b === undefined || b === 'info' || b === 'receipts' || b === 'unreadCount';
    case 'profile':
      // A person's profile, not searches or handle lookups.
      return key.length === 2 && b !== 'search' && b !== 'handle' && b !== 'handles';
    case 'messages':
    case 'storyTray':
    case 'userSettings':
    case 'mySettings':
      return true;
    case 'notifications':
      return b === 'list' || b === 'unreadCount';
    default:
      return false;
  }
}

type DQuery = DehydratedState['queries'][number];
type Msg = { pending?: boolean; localId?: string };

function trimmed(state: DehydratedState): DehydratedState {
  const threads: DQuery[] = [];
  const rest: DQuery[] = [];
  for (const q of state.queries) {
    if (q.queryKey[0] !== 'messages') {
      rest.push(q);
      continue;
    }
    const list = Array.isArray(q.state.data) ? (q.state.data as Msg[]) : [];
    const kept = list.filter((m) => !m.pending && !m.localId).slice(-MAX_MESSAGES);
    threads.push({ ...q, state: { ...q.state, data: kept } });
  }
  threads.sort((x, y) => y.state.dataUpdatedAt - x.state.dataUpdatedAt);
  return { mutations: [], queries: [...rest, ...threads.slice(0, MAX_THREADS)] };
}

// Within the budget: drop the oldest threads, then anything else, until it
// fits. Null when nothing useful fits.
function serialise(state: DehydratedState, uid: string): string | null {
  let s = state;
  for (;;) {
    const blob: Blob = { v: 1, uid, app: appVersion(), savedAt: Date.now(), state: s };
    const json = JSON.stringify(blob);
    if (json.length <= BUDGET_CHARS) return json;
    const lastThread = s.queries.map((q) => q.queryKey[0]).lastIndexOf('messages');
    const drop = lastThread >= 0 ? lastThread : s.queries.length - 1;
    if (drop < 0) return null;
    s = { ...s, queries: s.queries.filter((_, i) => i !== drop) };
  }
}

/** Puts the saved cache for this account into the query client. */
export async function restoreQueryCache(qc: QueryClient, uid: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const blob = JSON.parse(raw) as Partial<Blob>;
    const fresh = typeof blob.savedAt === 'number' && Date.now() - blob.savedAt < MAX_AGE_MS;
    if (blob.v !== 1 || blob.uid !== uid || blob.app !== appVersion() || !fresh || !blob.state) {
      await AsyncStorage.removeItem(STORAGE_KEY);
      return;
    }
    // hydrate never replaces newer data already in the cache.
    hydrate(qc, blob.state);
  } catch (e) {
    console.warn('saved cache: could not restore:', (e as Error)?.message ?? e);
    void AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  }
}

/** Keeps the saved cache up to date for whoever `getUid` returns. */
export function persistQueryCache(qc: QueryClient, getUid: () => string | null): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const save = async () => {
    timer = null;
    const uid = getUid();
    if (!uid) return;
    try {
      const state = dehydrate(qc, {
        shouldDehydrateQuery: (q: Query) => q.state.status === 'success' && persistable(q.queryKey),
        shouldDehydrateMutation: () => false,
      });
      const json = serialise(trimmed(state), uid);
      if (json) await AsyncStorage.setItem(STORAGE_KEY, json);
    } catch (e) {
      console.warn('saved cache: could not save:', (e as Error)?.message ?? e);
    }
  };
  const later = () => {
    if (!timer) timer = setTimeout(() => void save(), SAVE_DELAY_MS);
  };
  const now = () => {
    if (timer) clearTimeout(timer);
    void save();
  };

  const unsubCache = qc.getQueryCache().subscribe((e) => {
    if (e.type === 'updated' || e.type === 'removed') {
      if (persistable(e.query.queryKey)) later();
    }
  });
  const app = AppState.addEventListener('change', (s) => {
    if (s !== 'active') now();
  });
  return () => {
    unsubCache();
    app.remove();
    if (timer) clearTimeout(timer);
  };
}

/** Forgets the saved cache (signing out). */
export async function clearSavedQueryCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {}
}
