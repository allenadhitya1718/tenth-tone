import { useCallback, useEffect, useState } from 'react';

// Counts down to zero once a second. Used to hold back "Resend" until
// Supabase would actually accept another send.
export function useCooldown(initial = 0) {
  const [left, setLeft] = useState(initial);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  const start = useCallback((seconds: number) => setLeft(seconds), []);
  return { left, start };
}
