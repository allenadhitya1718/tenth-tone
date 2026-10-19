import { useTheme } from '@/providers/ThemeProvider';

import { LogoMark } from './LogoMark';

// The wide FLYP wordmark, blended into whatever page it sits on: the glowing
// mark in dark mode, the ink-and-blue mark in light mode. No baked-in navy
// rectangle, so it no longer looks like a sticker.
export function Logo({ width = 165 }: { width?: number }) {
  const { isDark } = useTheme();
  return <LogoMark width={width} tone={isDark ? 'dark' : 'light'} />;
}
