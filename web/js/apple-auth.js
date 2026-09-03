/* === Sign in with Apple ===
 *
 * Two different flows behind one call:
 *
 *   Native iOS  — the @capacitor-community/apple-sign-in plugin puts up the
 *                 system sheet (Face ID / password), hands back an Apple
 *                 identity token, and we trade that token for a Supabase
 *                 session with signInWithIdToken. No browser, no redirect.
 *
 *   Web / PWA   — Supabase's own OAuth redirect. The page leaves, Apple
 *                 authenticates, and the user lands back here with a session
 *                 (detectSessionInUrl in supabase.js picks it up).
 *
 * The native path is the one App Review looks at, and it is the only one that
 * satisfies guideline 4.8 / 5.1.1(v) properly — a redirect out to Safari does
 * not count as the native button.
 */
(function () {
  const SCOPES = 'name email';

  // The app is authored in Arabic and i18n.js swaps labels after each render
  // by exact string match. That walk never reached this button's text, which
  // is written from script and rewritten on every state change, so the one
  // control on an otherwise English login screen stayed in Arabic. Picking
  // the string here is the same thing views.js does for its own live labels.
  function L(ar, en) {
    try {
      return (window.I18N && window.I18N.getLang && window.I18N.getLang() === 'en') ? en : ar;
    } catch (e) { return ar; }
  }

  // Apple only returns the name on the FIRST authorization, ever. Miss it and
  // it is gone for that Apple ID until the user revokes the app in Settings,
  // so it gets stashed the moment it arrives.
  const NAME_KEY = 'tt-apple-name';

  // localStorage throws outright in some webview configurations (private mode,
  // blocked storage). Losing the cached name is survivable; losing the login
  // over it is not.
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  function cap() {
    return (typeof window !== 'undefined' && window.Capacitor) || null;
  }

  // True only inside the real iOS shell. Capacitor injects its bridge before
  // any of our scripts run, so this is safe at load time.
  function isNativeIOS() {
    const c = cap();
    if (!c) return false;
    const native = typeof c.isNativePlatform === 'function' ? c.isNativePlatform() : !!c.isNative;
    const platform = typeof c.getPlatform === 'function' ? c.getPlatform() : c.platform;
    return !!native && platform === 'ios';
  }

  function plugin() {
    const c = cap();
    return (c && c.Plugins && c.Plugins.SignInWithApple) || null;
  }

  // Shown on iOS always; elsewhere only when the OAuth provider is configured.
  // (Apple's own guidance: do not offer the button on platforms where it
  // cannot complete — a dead button is worse than no button.)
  function isAvailable() {
    return isNativeIOS() || !!(window.SB && window.SB.signInWithAppleOAuth);
  }

  function randomString(len) {
    const bytes = new Uint8Array(len);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    return Array.from(bytes, b => ('0' + b.toString(16)).slice(-2)).join('');
  }

  // Apple stamps whatever we hand it into the token's `nonce` claim verbatim;
  // Supabase hashes the raw value we give it and compares. So Apple gets the
  // hash and Supabase gets the original.
  //
  // crypto.subtle needs a secure context, and the iOS shell runs on a custom
  // scheme that may not qualify. If it is missing we go without a nonce rather
  // than fail the whole sign-in — the token is still verified against Apple's
  // public keys, we just lose replay protection on that hop.
  async function makeNonce() {
    const raw = randomString(16);
    const subtle = window.crypto && window.crypto.subtle;
    if (!subtle) return { raw: null, hashed: null };
    try {
      const digest = await subtle.digest('SHA-256', new TextEncoder().encode(raw));
      const hashed = Array.from(new Uint8Array(digest), b => ('0' + b.toString(16)).slice(-2)).join('');
      return { raw, hashed };
    } catch (e) {
      return { raw: null, hashed: null };
    }
  }

  async function signIn() {
    if (isNativeIOS()) return await signInNative();
    return await signInWeb();
  }

  async function signInNative() {
    const p = plugin();
    if (!p) throw new Error('apple-plugin-missing');

    const nonce = await makeNonce();
    const opts = { clientId: 'com.flyp.social', redirectURI: '', scopes: SCOPES };
    if (nonce.hashed) opts.nonce = nonce.hashed;

    const result = await p.authorize(opts);
    const res = (result && result.response) || result || {};
    const token = res.identityToken;
    if (!token) throw new Error('apple-no-token');

    // First-authorization-only name, kept for the profile row below.
    const given = res.givenName || '';
    const family = res.familyName || '';
    const fullName = [given, family].filter(Boolean).join(' ').trim();
    if (fullName) store.set(NAME_KEY, fullName);

    const data = await window.SB.signInWithApple({ token, nonce: nonce.raw });
    await syncProfileName(data);
    return data;
  }

  async function signInWeb() {
    // Redirects away; the promise never resolves in the normal case.
    return await window.SB.signInWithAppleOAuth();
  }

  // Apple hands over a name once and never again, and hides the real email
  // behind a relay address when the user asks it to. Neither ends up in the
  // profiles row on its own, so fill in what is missing after the session
  // exists — and only what is missing, so a user who has since renamed
  // themselves in the app does not get overwritten on the next login.
  async function syncProfileName(data) {
    try {
      const user = (data && data.user) || (await window.SB.getUser());
      if (!user) return;
      const stored = store.get(NAME_KEY) || '';
      const profile = await window.SB.getProfile(user.id);
      if (profile && profile.name) { store.del(NAME_KEY); return; }
      const name = stored || (user.user_metadata && user.user_metadata.full_name) || '';
      if (!name) return;
      await window.SB.updateProfile(user.id, { name });
      store.del(NAME_KEY);
    } catch (e) {
      // A profile that could not be named is not a failed login.
      console.warn('Apple profile name sync skipped:', e);
    }
  }

  // ---------- Button ----------
  // Apple's Human Interface Guidelines are strict about this control: their
  // mark, their wording, no smaller than the surrounding buttons. Built as a
  // plain DOM node so any view can drop it in.
  const APPLE_MARK =
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M17.05 12.54c-.02-2.2 1.8-3.26 1.88-3.31-1.02-1.5-2.62-1.7-3.18-1.72-1.35-.14-2.64.79-3.33.79-.69 0-1.75-.77-2.87-.75-1.48.02-2.84.86-3.6 2.18-1.54 2.67-.39 6.62 1.1 8.79.73 1.06 1.6 2.25 2.74 2.21 1.1-.04 1.52-.71 2.85-.71 1.33 0 1.7.71 2.86.69 1.18-.02 1.93-1.08 2.65-2.14.84-1.23 1.18-2.42 1.2-2.48-.03-.01-2.3-.88-2.3-3.55zM14.9 5.9c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.55 1.31-.56.64-1.05 1.68-.92 2.67.97.08 1.96-.49 2.57-1.22z"/>' +
    '</svg>';

  function injectStyles() {
    if (document.getElementById('apple-auth-styles')) return;
    const s = document.createElement('style');
    s.id = 'apple-auth-styles';
    s.textContent = [
      '.apple-signin-btn{display:flex;align-items:center;justify-content:center;gap:8px;',
      'width:100%;min-height:48px;padding:12px 18px;border:0;border-radius:999px;',
      'background:#000;color:#fff;font-family:inherit;font-size:16px;font-weight:600;',
      'cursor:pointer;-webkit-appearance:none;appearance:none;line-height:1;}',
      '.apple-signin-btn:disabled{opacity:.6;cursor:default;}',
      '.apple-signin-btn:active{opacity:.85;}',
      '.apple-signin-btn svg{flex:0 0 auto;margin-bottom:2px;}',
      '.auth-divider{display:flex;align-items:center;gap:12px;width:100%;margin:18px 0 14px;',
      'color:rgba(255,255,255,.55);font-size:13px;}',
      '.auth-divider::before,.auth-divider::after{content:"";flex:1;height:1px;',
      'background:currentColor;opacity:.35;}',
    ].join('');
    document.head.appendChild(s);
  }

  // opts: { label, busyLabel, onError(message), onSuccess() }
  function button(opts) {
    opts = opts || {};
    injectStyles();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'apple-signin-btn';
    const label = opts.label || L('تسجيل الدخول باستخدام Apple', 'Sign in with Apple');
    const busy = opts.busyLabel || L('جاري تسجيل الدخول...', 'Signing in...');
    const setLabel = (text, withMark) => {
      btn.innerHTML = (withMark ? APPLE_MARK : '') + '<span>' + text + '</span>';
    };
    setLabel(label, true);

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      setLabel(busy, false);
      try {
        await signIn();
        if (opts.onSuccess) opts.onSuccess();
      } catch (e) {
        btn.disabled = false;
        setLabel(label, true);
        const msg = describeError(e);
        // A user who taps Cancel on the sheet has not hit an error.
        if (msg && opts.onError) opts.onError(msg);
      }
    });
    return btn;
  }

  function divider(text) {
    injectStyles();
    const d = document.createElement('div');
    d.className = 'auth-divider';
    d.appendChild(document.createTextNode(text || L('أو', 'or')));
    return d;
  }

  // Returns null when the user simply backed out.
  function describeError(e) {
    const m = String((e && (e.message || e.error || e)) || '');
    if (/canceled|cancelled|1001|AuthorizationError\s*error\s*1001|user.?cancel/i.test(m)) return null;
    if (/apple-plugin-missing/.test(m)) return L('تسجيل الدخول عبر Apple غير متاح على هذا الجهاز', 'Sign in with Apple is not available on this device');
    if (/apple-no-token/.test(m)) return L('تعذر التحقق من حساب Apple — حاول مجددًا', 'Could not verify your Apple account — try again');
    if (/network|fetch|offline/i.test(m)) return L('تعذر الاتصال — تحقق من الإنترنت', 'Connection failed — check your internet');
    return L('تعذر تسجيل الدخول عبر Apple — حاول مجددًا', 'Could not sign in with Apple — try again');
  }

  window.AppleAuth = { isAvailable, isNativeIOS, signIn, button, divider, describeError };
})();
