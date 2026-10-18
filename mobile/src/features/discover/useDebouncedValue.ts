import { useEffect, useState } from 'react';

// The value as it was `ms` after it last changed: one search request per
// pause in typing rather than one per keystroke.
export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}
