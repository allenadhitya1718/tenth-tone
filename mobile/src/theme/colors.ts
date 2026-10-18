// Light mirrors :root in web/css/app.css (FLYP blue). Dark is the navy the
// client asked for (note 18), taken from the logo's own ground (#000421)
// instead of the old near-black body.dark palette.
export const light = {
  bg: '#FFFFFF',
  bg2: '#F5F5F7',
  bg3: '#ECECEF',
  text: '#111111',
  muted: '#8A8A8A',
  muted2: '#B8B8BC',
  border: '#ECECEC',
  primary: '#1E56D6',
  // Text/border tone of the brand blue; never a fill behind white text.
  primary2: '#4C81E8',
  primaryPressed: '#1745AE',
  primarySoft: '#EAF1FD',
  onPrimary: '#FFFFFF',
  accent: '#3D7BFF',
  pink: '#E8478A',
  danger: '#EF4444',
  dangerSoft: '#FDECEC',
  warn: '#F59E0B',
  success: '#16A34A',
  // Read ticks sit on the brand-blue bubble in both themes.
  tickRead: '#9EE7FF',
  tabBar: '#FFFFFF',
  overlay: 'rgba(0,0,0,0.45)',
};

export type Colors = typeof light;

export const dark: Colors = {
  bg: '#000421',
  bg2: '#0A1236',
  bg3: '#121C4A',
  text: '#EEF2FF',
  muted: '#98A3C7',
  muted2: '#5D6890',
  border: '#1A2658',
  primary: '#1E56D6',
  // Blue text on a navy card needs the lighter tone to clear 4.5:1, the same
  // swap the web app makes in body.dark.
  primary2: '#5B9BF5',
  primaryPressed: '#1745AE',
  primarySoft: '#0F1C4D',
  onPrimary: '#FFFFFF',
  accent: '#3D7BFF',
  pink: '#FF6FA3',
  danger: '#F87171',
  dangerSoft: '#3A1426',
  warn: '#FBBF24',
  success: '#22C55E',
  tickRead: '#9EE7FF',
  tabBar: '#000421',
  overlay: 'rgba(0,2,16,0.65)',
};
