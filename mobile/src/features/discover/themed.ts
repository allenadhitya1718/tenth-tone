import { useTheme } from '@/providers/ThemeProvider';
import type { Colors } from '@/theme/colors';

// Colour-dependent styles for list rows, built once per palette (there are
// two) instead of as fresh objects on every render of every row.
export function makeThemed<T>(factory: (c: Colors) => T) {
  const cache = new WeakMap<Colors, T>();
  return function useThemed(): T {
    const { colors } = useTheme();
    let v = cache.get(colors);
    if (v === undefined) {
      v = factory(colors);
      cache.set(colors, v);
    }
    return v;
  };
}
