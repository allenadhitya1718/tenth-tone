// Chat themes (0149): the backgrounds a chat's members can pick from, shared
// by everyone in the chat. The key is what the server stores in
// chats.theme; null is the default doodle. Each theme has a light and a dark
// version so it sits right in either app theme. A key this app does not
// know (added in a later version) draws the default.

export type ChatThemeKind = 'doodle' | 'solid' | 'gradient' | 'photo';

export type ChatTheme = {
  key: string | null;
  kind: ChatThemeKind;
  /** i18n key of the theme's name. */
  name: string;
  /** One colour for 'solid', two (top to bottom) for 'gradient'. */
  light: string[];
  dark: string[];
};

const solid = (id: string, light: string, dark: string): ChatTheme => ({
  key: `solid:${id}`,
  kind: 'solid',
  name: `chatTheme.names.${id}`,
  light: [light],
  dark: [dark],
});

const gradient = (id: string, light: [string, string], dark: [string, string]): ChatTheme => ({
  key: `gradient:${id}`,
  kind: 'gradient',
  name: `chatTheme.names.${id}`,
  light,
  dark,
});

export const DEFAULT_THEME: ChatTheme = { key: null, kind: 'doodle', name: 'chatTheme.default', light: [], dark: [] };
export const PHOTO_KEY = 'photo';

export const SOLID_THEMES: ChatTheme[] = [
  solid('sand', '#F4ECE1', '#2A2218'),
  solid('mint', '#DFF3EA', '#0F2A22'),
  solid('blush', '#FBE4E8', '#2E1820'),
  solid('lavender', '#ECE6FA', '#1E1836'),
  solid('sky', '#E2F0FB', '#0E2236'),
  solid('lemon', '#FBF5D9', '#2A2612'),
  solid('slate', '#E5E8EE', '#1A1F2A'),
  solid('graphite', '#D9D9DE', '#121214'),
];

export const GRADIENT_THEMES: ChatTheme[] = [
  gradient('sunset', ['#FFD3A5', '#FD8FA5'], ['#3A1C2E', '#6E2A3A']),
  gradient('aurora', ['#A8EDEA', '#FED6E3'], ['#0F3443', '#34325E']),
  gradient('ocean', ['#D6EEFB', '#A9C8FD'], ['#0B2447', '#19376D']),
  gradient('peach', ['#FFECD2', '#FCB69F'], ['#3B2418', '#5C3220']),
  gradient('forest', ['#E4FBC0', '#A6E8B0'], ['#0F2E1F', '#1E4D2B']),
  gradient('berry', ['#E8D3FC', '#A9D3FC'], ['#2A1A4A', '#14284A']),
  gradient('dusk', ['#D8DEE6', '#8E9BB0'], ['#232526', '#414345']),
];

const BY_KEY = new Map<string, ChatTheme>([...SOLID_THEMES, ...GRADIENT_THEMES].map((th) => [th.key as string, th]));

/** The theme to draw for a stored key; photo needs its wallpaper URL too. */
export function themeFor(key: string | null | undefined, wallpaper?: string | null): ChatTheme {
  if (key === PHOTO_KEY) {
    return wallpaper ? { key: PHOTO_KEY, kind: 'photo', name: 'chatTheme.photo', light: [], dark: [] } : DEFAULT_THEME;
  }
  return (key && BY_KEY.get(key)) || DEFAULT_THEME;
}
