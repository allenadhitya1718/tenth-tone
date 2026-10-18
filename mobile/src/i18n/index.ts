import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DevSettings, I18nManager, Platform } from 'react-native';

import ar from './locales/ar.json';
import en from './locales/en.json';

// Note 14 adds Chinese, Hindi, Urdu, French, Spanish, Turkish and Indonesian.
// Each goes in here with its locale file; `rtl` drives the layout direction.
export const LANGUAGES = [
  { code: 'ar', native: 'العربية', rtl: true },
  { code: 'en', native: 'English', rtl: false },
] as const;

export type LangCode = (typeof LANGUAGES)[number]['code'];

const KEY = 'tt-lang';
// The app is authored in Arabic and, like the web app, starts there.
const DEFAULT_LANG: LangCode = 'ar';

const isRtl = (code: string) => LANGUAGES.find((l) => l.code === code)?.rtl ?? false;

async function storedLanguage(): Promise<LangCode> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (LANGUAGES.some((l) => l.code === v)) return v as LangCode;
  } catch {}
  return DEFAULT_LANG;
}

// React Native only reads the layout direction at startup, so a change of
// direction needs a reload. Returns true when one is under way.
async function applyDirection(code: string): Promise<boolean> {
  const rtl = isRtl(code);
  if (Platform.OS === 'web') {
    if (typeof document !== 'undefined') document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    return false;
  }
  if (I18nManager.isRTL === rtl) return false;
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  try {
    await Updates.reloadAsync();
  } catch {
    // expo-updates cannot reload a development build served by Metro.
    DevSettings.reload();
  }
  return true;
}

export async function initI18n() {
  const lng = await storedLanguage();
  await i18n.use(initReactI18next).init({
    resources: { ar: { translation: ar }, en: { translation: en } },
    lng,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return { lng, reloading: await applyDirection(lng) };
}

export async function setLanguage(code: LangCode) {
  try {
    await AsyncStorage.setItem(KEY, code);
  } catch {}
  await i18n.changeLanguage(code);
  await applyDirection(code);
}

export const languageIsRtl = isRtl;
export default i18n;
