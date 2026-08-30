/* === CAPTCHA (Cloudflare Turnstile) ===
 *
 * Why this exists
 * ---------------
 * Every rate limit in the database is per-ACCOUNT: 60 follows an hour, 40
 * comments, 300 live-chat messages. None of that constrains somebody willing
 * to register a thousand accounts — they simply get a thousand times each
 * limit. What those limits are actually worth therefore depends entirely on
 * how expensive an account is to create, and right now it is free and
 * scriptable. This is the piece that puts a price on it.
 *
 * Why Turnstile rather than hCaptcha
 * ----------------------------------
 * Supabase supports both. Turnstile is usually invisible — most people never
 * see a puzzle, they just pass — whereas hCaptcha shows a checkbox and often
 * an image grid. On a signup screen that difference is conversion, and the
 * security is comparable. Both are free.
 *
 * Inert by default
 * ----------------
 * With no site key configured, nothing here loads and token() resolves to
 * null, so callers behave exactly as they did before. See config.js for why
 * that matters and for the order these steps have to happen in.
 */
window.Captcha = (function () {

  const SITE_KEY = (window.TT_CONFIG && window.TT_CONFIG.captchaSiteKey) || '';
  // Both parameters are required together. `render=explicit` alone loads the
  // script but leaves it waiting to be told what to do, and the ready callback
  // never fires — the name has to be handed over in `onload` as well.
  const CALLBACK_NAME = 'onloadTurnstileCallback';
  const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
    + '?onload=' + CALLBACK_NAME + '&render=explicit';

  // A token is single-use and expires after about five minutes, so one is
  // fetched per attempt rather than cached.
  const TOKEN_TIMEOUT_MS = 20000;

  let scriptPromise = null;
  let widgetId = null;
  let container = null;

  function enabled() {
    return !!SITE_KEY;
  }

  function loadScript() {
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise((resolve, reject) => {
      let settled = false;
      const ok = () => {
        if (settled || !window.turnstile) return;
        settled = true;
        resolve(window.turnstile);
      };

      // The explicit-render script calls this global once it is ready.
      window[CALLBACK_NAME] = ok;

      const s = document.createElement('script');
      s.src = SCRIPT_URL;
      s.async = true;
      s.defer = true;
      // Belt and braces: if the callback contract ever changes, the script's
      // own load event still gets us there as long as the global exists.
      s.onload = ok;
      s.onerror = () => { if (!settled) { settled = true; reject(new Error('captcha-script-failed')); } };
      document.head.appendChild(s);

      // Cloudflare unreachable (offline, blocked, slow network) must not hang
      // the signup button forever. Reset so a later attempt can retry rather
      // than being stuck with this rejected promise for the whole session.
      setTimeout(() => {
        if (settled) return;
        settled = true;
        scriptPromise = null;
        reject(new Error('captcha-script-timeout'));
      }, TOKEN_TIMEOUT_MS);
    });
    return scriptPromise;
  }

  function ensureWidget(turnstile) {
    if (widgetId !== null) return widgetId;

    container = document.createElement('div');
    // Kept in the layout rather than display:none — Turnstile needs a real box
    // to render an interactive challenge into on the occasions it asks for
    // one. Zero height keeps it out of the way until that happens.
    container.id = 'tt-captcha';
    container.setAttribute('style', 'position:fixed;bottom:0;left:50%;transform:translateX(-50%);z-index:9998');
    document.body.appendChild(container);

    widgetId = turnstile.render(container, {
      sitekey: SITE_KEY,
      // Only draw anything if this particular visitor actually has to solve
      // something. The overwhelming majority pass silently.
      appearance: 'interaction-only',
      // Do not run on render; run when we ask, so the token is fresh at the
      // moment of submission rather than minutes old.
      execution: 'execute',
      language: (document.documentElement.lang === 'en' ? 'en' : 'ar'),
      callback: (t) => { if (pending) { pending.resolve(t); pending = null; } },
      'error-callback': () => { if (pending) { pending.reject(new Error('captcha-error')); pending = null; } },
      'timeout-callback': () => { if (pending) { pending.reject(new Error('captcha-timeout')); pending = null; } },
    });
    return widgetId;
  }

  let pending = null;

  /**
   * Resolves to a fresh Turnstile token, or null when CAPTCHA is switched off.
   *
   * Throws only when CAPTCHA is switched ON and a token genuinely could not be
   * obtained. Callers should let that surface: once the dashboard requires a
   * token, an attempt without one would be rejected by Supabase anyway, and a
   * clear local failure is easier to act on than a server-side rejection.
   */
  async function token() {
    if (!enabled()) return null;

    const turnstile = await loadScript();
    const id = ensureWidget(turnstile);

    // Discard any previous token; execute() then produces a new one.
    try { turnstile.reset(id); } catch (e) { /* first run — nothing to reset */ }

    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      const timer = setTimeout(() => {
        if (pending) { pending = null; reject(new Error('captcha-timeout')); }
      }, TOKEN_TIMEOUT_MS);
      const done = (fn) => (v) => { clearTimeout(timer); fn(v); };
      pending = { resolve: done(resolve), reject: done(reject) };

      try {
        turnstile.execute(id);
      } catch (e) {
        clearTimeout(timer);
        pending = null;
        reject(e);
      }
    });
  }

  return { enabled, token };
})();
