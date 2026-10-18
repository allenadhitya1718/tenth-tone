import { useEffect, useState } from 'react';

import { isHandleAvailable } from '@/lib/auth';

export type HandleState = 'empty' | 'bad' | 'checking' | 'taken' | 'free';

// Checks availability 450 ms after the last keystroke, so a taken name shows
// up before the form is submitted. A failed check never blocks signup: the
// unique index is the real guard.
export function useHandleCheck(handle: string): HandleState {
  // The answer is stored against the handle it was for, so a reply for an
  // older value can never be shown for the current one.
  const [result, setResult] = useState<{ handle: string; free: boolean } | null>(null);

  useEffect(() => {
    if (handle.length < 3) return;
    let live = true;
    const id = setTimeout(() => {
      isHandleAvailable(handle)
        .then((free) => live && setResult({ handle, free }))
        .catch(() => live && setResult({ handle, free: true }));
    }, 450);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [handle]);

  if (!handle) return 'empty';
  if (handle.length < 3) return 'bad';
  if (result?.handle !== handle) return 'checking';
  return result.free ? 'free' : 'taken';
}

export const cleanHandle = (v: string) => v.toLowerCase().replace(/[^a-z0-9._]/g, '');
