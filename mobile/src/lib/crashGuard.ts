// Keeps a JavaScript error thrown outside rendering (a button handler, a
// timer, a realtime callback) from closing the app. React Native's default
// handler ends the app on any "fatal" JS error in a release build; errors
// while a screen renders are caught by the ErrorBoundary instead
// (components/AppErrorBoundary.tsx).
//
// After a fatal error the JavaScript side of the app stops handling events
// (tested on the Redmi: the screen stayed up but ignored every tap), so it
// cannot simply carry on. In a release build the guard reloads the app's
// JavaScript instead: a second later FLYP is back on its home screen and
// says "Something went wrong" once. The app process never dies, so this is
// not a crash. In development the default red screen is kept, so bugs are
// still loud while building.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';

import { showToast } from '@/components/Toast';
import i18n from '@/i18n';

type Handler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsLike = { getGlobalHandler: () => Handler; setGlobalHandler: (h: Handler) => void };

const RECOVERED_KEY = 'tt-recovered-from-error';
let installed = false;
let reloading = false;

export function installCrashGuard() {
  if (installed) return;
  installed = true;
  const eu = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!eu) return;
  const previous = eu.getGlobalHandler();
  eu.setGlobalHandler((error, isFatal) => {
    const e = error as { message?: string; stack?: string } | null;
    console.error('FLYP JS error', isFatal ? '(fatal)' : '', e?.message, e?.stack);
    if (__DEV__ || !isFatal) {
      if (__DEV__) previous(error, isFatal);
      return;
    }
    if (reloading) return;
    reloading = true;
    // The flag is written synchronously enough in practice; the reload waits
    // for it, and the default handler is the fallback if reloading fails.
    void AsyncStorage.setItem(RECOVERED_KEY, '1')
      .catch(() => {})
      .then(() => Updates.reloadAsync())
      .catch(() => previous(error, isFatal));
  });
}

/** After a recovery reload: tell the person once, then forget it. */
export async function announceRecovery() {
  try {
    if ((await AsyncStorage.getItem(RECOVERED_KEY)) !== '1') return;
    await AsyncStorage.removeItem(RECOVERED_KEY);
    const text = i18n.t('errors.screenTitle', { defaultValue: 'Something went wrong' });
    // Give the home screen a moment to appear first.
    setTimeout(() => showToast(text, 'refresh'), 1500);
  } catch {}
}
