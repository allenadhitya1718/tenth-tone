import { useSyncExternalStore } from 'react';

// Who is speaking right now, by Agora uid. Agora reports volumes every few
// hundred milliseconds; keeping them in a store outside React means only the
// tile whose ring changes re-renders, not the whole room.
export type SpeakingStore = {
  set: (uids: number[]) => void;
  has: (uid: number) => boolean;
  hasOtherThan: (known: ReadonlySet<number>) => boolean;
  subscribe: (cb: () => void) => () => void;
};

export function createSpeakingStore(): SpeakingStore {
  let current = new Set<number>();
  const listeners = new Set<() => void>();
  return {
    set(uids) {
      const next = new Set(uids);
      if (next.size === current.size && uids.every((u) => current.has(u))) return;
      current = next;
      listeners.forEach((l) => l());
    },
    has: (uid) => current.has(uid),
    hasOtherThan: (known) => {
      for (const u of current) if (!known.has(u)) return true;
      return false;
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

export function useIsSpeaking(store: SpeakingStore, uid: number | null, unknownFallback?: ReadonlySet<number>) {
  return useSyncExternalStore(store.subscribe, () => {
    if (uid != null && store.has(uid)) return true;
    return unknownFallback ? store.hasOtherThan(unknownFallback) : false;
  });
}
