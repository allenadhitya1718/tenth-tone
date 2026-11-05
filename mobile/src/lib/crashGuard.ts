// Keeps a JavaScript error thrown outside rendering (a button handler, a
// timer, a realtime callback) from closing the app. React Native's default
// handler ends the app on any "fatal" JS error in a release build; errors
// while a screen renders are caught by the ErrorBoundary instead
// (components/AppErrorBoundary.tsx).
//
// In a release build a fatal error is logged and the person gets a short
// "something went wrong" toast; the screen stays usable. In development the
// default red screen is kept, so bugs are still loud while building.
import { showToast } from '@/components/Toast';
import i18n from '@/i18n';

type Handler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsLike = { getGlobalHandler: () => Handler; setGlobalHandler: (h: Handler) => void };

let installed = false;

export function installCrashGuard() {
  if (installed) return;
  installed = true;
  const eu = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!eu) return;
  const previous = eu.getGlobalHandler();
  eu.setGlobalHandler((error, isFatal) => {
    const e = error as { message?: string; stack?: string } | null;
    console.error('FLYP JS error', isFatal ? '(fatal, kept alive)' : '', e?.message, e?.stack);
    if (__DEV__) {
      previous(error, isFatal);
      return;
    }
    if (isFatal) {
      let text = 'Something went wrong';
      try {
        text = i18n.t('errors.screenTitle', { defaultValue: text });
      } catch {}
      try {
        showToast(text, 'alert-circle');
      } catch {}
    }
    // Non-fatal errors only ever logged a yellow box; nothing to do.
  });
}
