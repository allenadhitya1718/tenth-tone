import { createContext, useContext } from 'react';

import type { ChatTheme } from './themes';

// The chat theme on screen (null = the app's own look), for everything drawn
// on top of it: bubbles, day labels, system lines, the header, the composer.
export const ChatThemeContext = createContext<ChatTheme | null>(null);

export const useChatTheme = () => useContext(ChatThemeContext);

// Small surfaces on the theme (day labels, system lines, the composer field,
// the reply bar): a translucent veil in the theme's own contrast.
export function themeChips(th: ChatTheme) {
  return th.dark
    ? { chip: 'rgba(0,0,0,0.35)', chipText: 'rgba(255,255,255,0.92)', field: 'rgba(255,255,255,0.14)', onBg: '#FFFFFF', onBgMuted: 'rgba(255,255,255,0.72)', line: 'rgba(255,255,255,0.12)' }
    : { chip: 'rgba(255,255,255,0.72)', chipText: 'rgba(0,0,0,0.75)', field: 'rgba(255,255,255,0.8)', onBg: '#111111', onBgMuted: 'rgba(0,0,0,0.6)', line: 'rgba(0,0,0,0.08)' };
}
