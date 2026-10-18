import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SystemUI from 'expo-system-ui';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { dark, light, type Colors } from '@/theme/colors';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'tt-theme';

type ThemeState = {
  colors: Colors;
  isDark: boolean;
  pref: ThemePref;
  setPref: (p: ThemePref) => void;
};

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [pref, setPrefState] = useState<ThemePref>('system');

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => {
        if (v === 'light' || v === 'dark' || v === 'system') setPrefState(v);
      })
      .catch(() => {});
  }, []);

  const isDark = pref === 'system' ? system === 'dark' : pref === 'dark';
  const colors = isDark ? dark : light;

  // The root view shows through during screen transitions and keyboard moves.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});
  }, [colors.bg]);

  const value = useMemo<ThemeState>(
    () => ({
      colors,
      isDark,
      pref,
      setPref: (p) => {
        setPrefState(p);
        AsyncStorage.setItem(KEY, p).catch(() => {});
      },
    }),
    [colors, isDark, pref],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme outside ThemeProvider');
  return ctx;
}
