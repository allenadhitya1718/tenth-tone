// Chat themes (0149), Instagram style: a theme is the whole look of the chat,
// not only its background. Each one sets the background (a multi-stop
// gradient, most with a drawn pattern), YOUR bubbles (a gradient), the other
// side's bubbles, and the text colours, and the header and composer sit on
// the theme instead of a solid bar. Shared by everyone in the chat.
//
// The key is what the server stores in chats.theme (null = the app's own
// look). Keys from the first version of the picker ('solid:sand',
// 'gradient:ocean', ...) map to the closest theme here, so chats that chose
// one keep a theme. A key this app does not know draws the default.

export type ThemePattern = 'hearts' | 'stars' | 'sparkles' | 'bubbles' | 'waves' | 'leaves' | 'notes' | 'doodle' | 'petals';

export type ChatTheme = {
  key: string | null;
  /** i18n key of the theme's name. */
  name: string;
  /** Text and icons on the background: light text on a dark theme. */
  dark: boolean;
  /** Background gradient, top to bottom (diagonal when `diagonal`). */
  bg: string[];
  diagonal?: boolean;
  pattern?: ThemePattern;
  patternColor?: string;
  patternOpacity?: number;
  /** Your bubbles: a gradient (one colour for a flat bubble). */
  mine: string[];
  mineText: string;
  /** The other side's bubbles. */
  theirs: string;
  theirsText: string;
  /** Accent for the header icons and links. */
  accent: string;
};

const t = (key: string, v: Omit<ChatTheme, 'key' | 'name'>): ChatTheme => ({ key, name: `chatTheme.names.${key}`, ...v });

export const THEMES: ChatTheme[] = [
  t('love', {
    dark: true, bg: ['#2B0716', '#5A0F2E', '#8E1F4A'], pattern: 'hearts', patternColor: '#FF7AA8', patternOpacity: 0.18,
    mine: ['#D81B60', '#C2185B'], mineText: '#FFFFFF', theirs: 'rgba(255,255,255,0.14)', theirsText: '#FFFFFF', accent: '#FF8FB5',
  }),
  t('aurora', {
    dark: true, bg: ['#06122B', '#123A5C', '#0E6B6B', '#1B2B5C'], diagonal: true, pattern: 'sparkles', patternColor: '#9BF6FF', patternOpacity: 0.16,
    mine: ['#6A4CF5', '#0072B0'], mineText: '#FFFFFF', theirs: 'rgba(255,255,255,0.13)', theirsText: '#FFFFFF', accent: '#7DE3FF',
  }),
  t('sunset', {
    dark: true, bg: ['#2D1B3D', '#8C3B5E', '#E0745A', '#F2B36B'], pattern: 'sparkles', patternColor: '#FFE3B3', patternOpacity: 0.14,
    mine: ['#FF5F6D', '#FFC371'], mineText: '#2A0F05', theirs: 'rgba(30,10,30,0.5)', theirsText: '#FFFFFF', accent: '#FFD29A',
  }),
  t('ocean', {
    dark: true, bg: ['#011627', '#04395E', '#0A6E8A', '#13A3B5'], pattern: 'waves', patternColor: '#BFF4FF', patternOpacity: 0.14,
    mine: ['#0077A0', '#00566E'], mineText: '#FFFFFF', theirs: 'rgba(0,25,45,0.5)', theirsText: '#FFFFFF', accent: '#8FE9FF',
  }),
  t('galaxy', {
    dark: true, bg: ['#090014', '#2A0F4F', '#4C1D95', '#0B0322'], diagonal: true, pattern: 'stars', patternColor: '#E9D5FF', patternOpacity: 0.32,
    mine: ['#8E2DE2', '#4A00E0'], mineText: '#FFFFFF', theirs: 'rgba(255,255,255,0.12)', theirsText: '#FFFFFF', accent: '#D8B4FE',
  }),
  t('forest', {
    dark: true, bg: ['#071A10', '#123D24', '#1F5C37'], pattern: 'leaves', patternColor: '#A7F3C0', patternOpacity: 0.15,
    mine: ['#56AB2F', '#A8E063'], mineText: '#0B2414', theirs: 'rgba(255,255,255,0.13)', theirsText: '#FFFFFF', accent: '#B6F5A8',
  }),
  t('neon', {
    dark: true, bg: ['#05000F', '#14002E', '#26004D'], diagonal: true, pattern: 'sparkles', patternColor: '#FF6BFF', patternOpacity: 0.2,
    mine: ['#C000CC', '#6A1BFF'], mineText: '#FFFFFF', theirs: 'rgba(255,255,255,0.1)', theirsText: '#FFFFFF', accent: '#FF8CFF',
  }),
  t('midnight', {
    dark: true, bg: ['#000000', '#0B0F1E', '#141B33'], pattern: 'stars', patternColor: '#FFFFFF', patternOpacity: 0.22,
    mine: ['#4B6CB7', '#182848'], mineText: '#FFFFFF', theirs: 'rgba(255,255,255,0.1)', theirsText: '#FFFFFF', accent: '#9DB4FF',
  }),
  t('berry', {
    dark: true, bg: ['#1E0533', '#4A1475', '#6E2A8C'], pattern: 'bubbles', patternColor: '#F5B8FF', patternOpacity: 0.14,
    mine: ['#E5073D', '#A31577'], mineText: '#FFFFFF', theirs: 'rgba(255,255,255,0.13)', theirsText: '#FFFFFF', accent: '#FFB3C7',
  }),
  t('lofi', {
    dark: false, bg: ['#F6E9D7', '#EAD3B8', '#DDBF9C'], pattern: 'notes', patternColor: '#7A4E2D', patternOpacity: 0.12,
    mine: ['#8B5E3C', '#976B4A'], mineText: '#FFFFFF', theirs: 'rgba(255,255,255,0.85)', theirsText: '#3B2414', accent: '#6B4226',
  }),
  t('cotton', {
    dark: false, bg: ['#FFDDE7', '#F3DDFF', '#D6E8FF'], diagonal: true, pattern: 'bubbles', patternColor: '#B07CFF', patternOpacity: 0.14,
    mine: ['#FF9A9E', '#B9A5E6'], mineText: '#2A1438', theirs: 'rgba(255,255,255,0.9)', theirsText: '#3A2450', accent: '#8B5CF6',
  }),
  t('peach', {
    dark: false, bg: ['#FFF1E0', '#FFD9C2', '#FCB69F'], pattern: 'petals', patternColor: '#E8735A', patternOpacity: 0.14,
    mine: ['#FF8FA3', '#FFB3BF'], mineText: '#3D0F1A', theirs: 'rgba(255,255,255,0.9)', theirsText: '#4A1F18', accent: '#E0506B',
  }),
  t('citrus', {
    dark: false, bg: ['#FFFCE8', '#FFF0B3', '#FFE07A'], pattern: 'sparkles', patternColor: '#E58A00', patternOpacity: 0.15,
    mine: ['#F7971E', '#FFD200'], mineText: '#3A2600', theirs: 'rgba(255,255,255,0.92)', theirsText: '#3A2600', accent: '#C76A00',
  }),
  t('mint', {
    dark: false, bg: ['#E9FFF6', '#C8F3E2', '#A6E8CF'], pattern: 'leaves', patternColor: '#0F8F7A', patternOpacity: 0.13,
    mine: ['#0D8277', '#0F8366'], mineText: '#FFFFFF', theirs: 'rgba(255,255,255,0.9)', theirsText: '#0B3B33', accent: '#0F8F7A',
  }),
  t('sky', {
    dark: false, bg: ['#EAF6FF', '#CDE8FF', '#A9D4FF'], pattern: 'bubbles', patternColor: '#2F80ED', patternOpacity: 0.12,
    mine: ['#2A73D5', '#1F6FB2'], mineText: '#FFFFFF', theirs: 'rgba(255,255,255,0.92)', theirsText: '#0E2A4A', accent: '#1E63C7',
  }),
  t('mono', {
    dark: false, bg: ['#FAFAFA', '#EDEDED', '#E0E0E0'], pattern: 'doodle', patternColor: '#111111', patternOpacity: 0.06,
    mine: ['#111111'], mineText: '#FFFFFF', theirs: '#FFFFFF', theirsText: '#111111', accent: '#111111',
  }),
];

export const PHOTO_KEY = 'photo';

// The photo theme: your picture under a veil; bubbles stay FLYP blue.
const PHOTO_THEME: ChatTheme = {
  key: PHOTO_KEY,
  name: 'chatTheme.photo',
  dark: true,
  bg: ['#000000'],
  mine: ['#1E56D6'],
  mineText: '#FFFFFF',
  theirs: 'rgba(0,0,0,0.55)',
  theirsText: '#FFFFFF',
  accent: '#FFFFFF',
};

// The first picker's keys, mapped to the closest look.
const LEGACY: Record<string, string> = {
  'solid:sand': 'lofi', 'solid:mint': 'mint', 'solid:blush': 'cotton', 'solid:lavender': 'cotton',
  'solid:sky': 'sky', 'solid:lemon': 'citrus', 'solid:slate': 'mono', 'solid:graphite': 'midnight',
  'gradient:sunset': 'sunset', 'gradient:aurora': 'aurora', 'gradient:ocean': 'ocean', 'gradient:peach': 'peach',
  'gradient:forest': 'forest', 'gradient:berry': 'berry', 'gradient:dusk': 'midnight',
};

const BY_KEY = new Map(THEMES.map((th) => [th.key as string, th]));

/** The theme for a stored key; null is the app's own look. */
export function themeFor(key: string | null | undefined, wallpaper?: string | null): ChatTheme | null {
  if (!key) return null;
  if (key === PHOTO_KEY) return wallpaper ? PHOTO_THEME : null;
  return BY_KEY.get(LEGACY[key] ?? key) ?? null;
}

/** The key a stored value is shown as selected under (legacy keys included). */
export function canonicalKey(key: string | null | undefined): string | null {
  if (!key) return null;
  return LEGACY[key] ?? key;
}
