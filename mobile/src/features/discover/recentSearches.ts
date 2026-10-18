import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'tt-recent-searches';
const MAX = 12;

// Recent searches stay on the device: they are a convenience, not account
// data, and nothing else needs to read them.
async function load(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function save(items: string[]) {
  AsyncStorage.setItem(KEY, JSON.stringify(items)).catch(() => {});
}

export function useRecentSearches() {
  const [items, setItems] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    void load().then((v) => alive && setItems(v));
    return () => {
      alive = false;
    };
  }, []);

  const add = useCallback((q: string) => {
    const term = q.trim();
    if (!term) return;
    setItems((prev) => {
      // Case-insensitive, so "Sara" and "sara" do not both sit in the list.
      const next = [term, ...prev.filter((p) => p.toLowerCase() !== term.toLowerCase())].slice(0, MAX);
      save(next);
      return next;
    });
  }, []);

  const remove = useCallback((q: string) => {
    setItems((prev) => {
      const next = prev.filter((p) => p !== q);
      save(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    AsyncStorage.removeItem(KEY).catch(() => {});
  }, []);

  return { items, add, remove, clear };
}
