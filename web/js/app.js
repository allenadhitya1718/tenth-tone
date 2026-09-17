/* === Mobile router === */
(function () {
  const app = document.getElementById('app');

  // '/contact' and '/guidelines' are public on purpose. Apple 1.2 wants
  // published contact information and the content rules to be reachable, and
  // the visitor most likely to need them is the one who has not signed up -
  // which is exactly the state App Review was in when it rejected 1.0.
  const PUBLIC_PATHS = ['/', '/onboarding', '/welcome', '/login', '/register', '/otp', '/forgot', '/reset-otp', '/home', '/legal', '/contact', '/guidelines'];
  // Prefixes that are also public — deep-linked videos must open for
  // signed-out visitors, otherwise a shared link is a dead end.
  const PUBLIC_PREFIXES = ['/v/'];

  function isPublic(path) {
    return PUBLIC_PATHS.includes(path) || PUBLIC_PREFIXES.some(p => path.startsWith(p));
  }

  const routes = [
    // First visit gets the feature tour; every visit after that goes to the
    // new-or-returning fork. `#/onboarding?tour=1` re-opens the tour.
    { p: /^\/?$/, v: () => (localStorage.getItem('tt-onboarded') === '1' ? Views.welcome() : Views.onboarding()) },
    { p: /^\/onboarding$/, v: () => Views.onboarding() },
    { p: /^\/welcome$/, v: () => Views.welcome() },
    { p: /^\/login$/, v: () => Views.login() },
    { p: /^\/register$/, v: () => Views.register() },
    { p: /^\/otp$/, v: () => Views.otp() },
    { p: /^\/forgot$/, v: () => Views.forgot() },
    { p: /^\/home$/, v: q => Views.home({ q }) },
    // Deep-linked single video: opens the feed with that video pinned first
    { p: /^\/v\/(.+)$/, v: (q, m) => Views.home({ q, videoId: m[1] }) },
    { p: /^\/discover$/, v: () => Views.discover() },
    { p: /^\/create$/, v: () => Views.create() },
    { p: /^\/camera$/, v: q => Views.camera({ q }) },
    // pick: true - "Upload" must open the picker, never replay the draft
    // that is still sitting in _ttPendingClip.
    { p: /^\/upload$/, v: () => Views.editVideo({ pick: true }) },
    { p: /^\/edit-video$/, v: () => Views.editVideo() },
    { p: /^\/publish$/, v: () => Views.publish() },
    { p: /^\/inbox$/, v: () => Views.inbox() },
    { p: /^\/chat-new\/(group|dm)$/, v: (q, m) => Views.chatNew({ id: m[1] }) },
    { p: /^\/chat\/(.+)$/, v: (q, m) => Views.chat({ id: m[1] }) },
    { p: /^\/profile$/, v: () => Views.profile() },
    { p: /^\/profile\/edit$/, v: () => Views.editProfile() },
    { p: /^\/profile\/(.+)$/, v: (q, m) => Views.userProfile({ id: m[1] }) },
    // The id is optional: /list/followers is still your own list, and
    // /list/followers/<uuid> is that person's. Without the second half the
    // route had no notion of a subject, so tapping a follower count on
    // someone else's profile opened YOUR list under THEIR number.
    { p: /^\/list\/(followers|following)(?:\/([0-9a-f-]{36}))?$/i,
      v: (q, m) => Views.userList({ id: m[1], user: m[2] || null }) },
    { p: /^\/notifications$/, v: () => Views.notifications() },
    { p: /^\/comments\/(.+)$/, v: (q, m) => Views.comments({ id: m[1] }) },
    // kind distinguishes sharing a profile from sharing a video; both use the
    // same screen, and without it a shared profile link pointed at a video.
    { p: /^\/share(?:\/(.+))?$/, v: (q, m) => Views.share({ id: m[1], kind: q.kind || 'video' }) },
    { p: /^\/live\/start$/, v: () => Views.liveStart() },
    { p: /^\/live\/host-list$/, v: () => Views.liveHostList() },
    { p: /^\/live\/(.+)$/, v: (q, m) => Views.live({ id: m[1] }) },
    { p: /^\/map$/, v: q => Views.map({ q }) },
    { p: /^\/settings$/, v: () => Views.settings() },
    { p: /^\/blocked$/, v: () => Views.blockedUsers() },
    { p: /^\/restricted$/, v: () => Views.restrictedUsers() },
    { p: /^\/muted$/, v: () => Views.mutedUsers() },
    { p: /^\/hidden-words$/, v: () => Views.hiddenWords() },
    { p: /^\/change-password$/, v: () => Views.changePassword() },
    { p: /^\/change-email$/, v: () => Views.changeEmail() },
    { p: /^\/reset-otp$/, v: () => Views.resetOtp() },
    { p: /^\/settings\/notifications$/, v: () => Views.notificationSettings() },
    { p: /^\/settings\/devices$/, v: () => Views.loginActivity() },
    { p: /^\/settings\/permissions$/, v: () => Views.devicePermissions() },
    { p: /^\/settings\/archive$/, v: () => Views.archiveDownload() },
    { p: /^\/settings\/activity$/, v: () => Views.accountActivity() },
    { p: /^\/archive$/, v: () => Views.archive() },
    { p: /^\/close-friends$/, v: () => Views.closeFriends() },
    { p: /^\/follow-requests$/, v: () => Views.followRequests() },
    { p: /^\/legal$/, v: () => Views.legal({}) },
    { p: /^\/legal\/(terms|privacy)$/, v: (q, m) => Views.legal({ doc: m[1] }) },
    { p: /^\/report-problem$/, v: () => Views.reportProblem() },
    { p: /^\/contact$/, v: () => Views.contactUs() },
    { p: /^\/guidelines$/, v: () => Views.guidelines() },
    { p: /^\/account-status$/, v: () => Views.accountStatus() },
    { p: /^\/u\/([A-Za-z0-9_.]+)$/, v: (q, m) => Views.userByHandle({ handle: m[1] }) },
    { p: /^\/invite$/, v: () => Views.inviteFriends() },
    { p: /^\/saved$/, v: () => Views.saved() },
    { p: /^\/call\/(.+)$/, v: (q, m) => Views.call({ id: m[1] }) },
    { p: /^\/sound\/(.+)$/, v: (q, m) => Views.sound({ id: m[1] }) },
    { p: /^\/tag\/(.+)$/, v: (q, m) => Views.hashtag({ id: m[1] }) },
  ];

  // Restore an explicit dark-mode preference before the first paint, so the
  // app never flashes light on the way in.
  try { if (localStorage.getItem('tt-theme') === 'dark') document.body.classList.add('dark'); } catch (e) {}

  // Signup and login are light; the app itself is dark. Someone who has never
  // touched the setting therefore flips to dark the moment they are signed in,
  // and back to light on the auth screens. An explicit choice in Settings wins
  // in both directions, which is why this only decides when nothing is stored.
  function applyTheme(signedIn) {
    let pref = null;
    try { pref = localStorage.getItem('tt-theme'); } catch (e) {}
    document.body.classList.toggle('dark', pref ? pref === 'dark' : !!signedIn);
  }

  function parseHash() {
    const raw = (location.hash || '#/').slice(1) || '/';
    const [path, qs] = raw.split('?');
    const q = {};
    if (qs) qs.split('&').forEach(pair => {
      const [k, v] = pair.split('=');
      if (k) q[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
    });
    return { path, q };
  }

  let sessionChecked = false;
  let session = null;

  // ── The session check must never be able to hold the first paint ──
  //
  // supabase-js refreshes an expired access token inside getSession(), and
  // that refresh has no timeout of its own. With a stale token and a network
  // that stalls - which is every user who leaves the app open long enough for
  // the token to age - the promise simply never settles. render() awaited it
  // BEFORE touching #app, so the app drew absolutely nothing: no spinner, no
  // error, no bounce to sign-in. A permanently blank screen.
  //
  // So race it. Whichever answer arrives first decides this paint. The real
  // answer is still awaited in the background and, if it turns out to be a
  // valid session, the screen is re-rendered with it - a merely slow network
  // still ends up signed in, which is why the timeout does not simply
  // overwrite the session with null and forget about it.
  const SESSION_TIMEOUT_MS = 4000;
  let sessionProbe = null;

  function sessionWithinTimeout() {
    if (sessionProbe) return sessionProbe;
    let timedOut = false;
    const real = (async () => {
      try { return await window.SB.getSession(); } catch (e) { return null; }
    })();
    real.then(s => {
      session = s;
      sessionChecked = true;    // only the REAL answer is ever remembered
      if (timedOut && s) onLateSession();
    }, () => { sessionChecked = true; });
    sessionProbe = Promise.race([
      real,
      new Promise(res => setTimeout(() => { timedOut = true; res(null); }, SESSION_TIMEOUT_MS)),
    ]);
    return sessionProbe;
  }

  // The session turned up after we had already painted as signed-out.
  function onLateSession() {
    const { path } = parseHash();
    const onAuthScreen = ['/', '/login', '/welcome', '/onboarding'].indexOf(path) > -1;
    // Someone already typing their credentials must not be yanked away
    // mid-word, even though they are in fact signed in.
    const typing = [].slice.call(document.querySelectorAll('#app input, #app textarea'))
      .some(function (i) { return i.value; });
    // Replace the auth screen in history rather than stacking the feed on
    // top of it, or Android's back button walks straight back to "sign in".
    if (onAuthScreen && !typing) { history.replaceState(null, '', '#/home'); }
    render();
  }

  async function render() {
    const { path, q } = parseHash();

    // Auth guard: gate non-public paths until we know whether the user is signed in
    if (!sessionChecked) {
      const s = await sessionWithinTimeout();
      // Guard again: the real answer may have landed while we awaited, and it
      // outranks the timeout's null.
      if (!sessionChecked) session = s;
    }

    applyTheme(!!session);

    if (!session && !isPublic(path)) {
      location.hash = '#/login';
      return;
    }
    // A signed-in person lands on their feed. A signed-out one falls through
    // to the route table, which shows the tour on a first visit and the
    // welcome fork after that. (This used to force '#/login', which is why
    // the welcome screen never appeared.)
    if (path === '/' && session) {
      // Replace, so the landing route never sits under the feed in history.
      history.replaceState(null, '', '#/home');
      return render();
    }

    for (const r of routes) {
      const m = path.match(r.p);
      if (m) {
        try {
          app.innerHTML = '';
          const node = r.v(q, m);
          if (node) app.appendChild(node);
          // Translate the freshly-rendered view to English when that language is active
          try { if (window.I18N) window.I18N.apply(document.body); } catch (e) {}
          window.scrollTo(0, 0);
        } catch (e) {
          console.error('render error', e);
          app.innerHTML = '<div style="padding:24px">خطأ في التحميل: ' + e.message + '</div>';
        }
        return;
      }
    }
    location.hash = '#/';
  }

  // Coming back cancels leaving.
  //
  // Both the account-status screen and the privacy policy promise that a
  // deactivated account returns "the moment you sign in", and that signing in
  // during the 30-day grace period cancels a scheduled deletion. Nothing kept
  // that promise: reactivate_account() (migration 0034) existed and was
  // wrapped as API.reactivateAccount, but nothing ever called it, and no
  // trigger did it either. A deactivated account therefore stayed invisible
  // forever, and the only working way out of a scheduled deletion was the
  // explicit button on the account-status screen.
  //
  // The status read is one indexed primary-key lookup, and the write only
  // happens for the rare account that is actually dormant.
  async function reactivateIfDormant() {
    const API = window.API;
    if (!API || !API.fetchAccountStatus || !API.reactivateAccount) return;
    // null when migration 0034 has not been applied yet, or when the profile
    // row does not exist yet (a brand-new sign-up reaches here too).
    const st = await API.fetchAccountStatus();
    if (!st || (!st.deactivated_at && !st.deletion_scheduled_at)) return;
    await API.reactivateAccount();
  }

  // Listen for sign-in / sign-out events from Supabase to keep `session` fresh
  if (window.SB) {
    window.SB.onAuthChange((event, sess) => {
      session = sess;
      sessionChecked = true;
      // Signing in or out changes which default applies, and this fires
      // before any navigation does, so the switch is immediate.
      applyTheme(!!sess);
      if (event === 'SIGNED_OUT') location.hash = '#/login';
      // Record the device on sign-in. A device never seen before raises a
      // login alert (see record_session in migration 0027).
      if (event === 'SIGNED_IN' && window.API && window.API.recordSession) {
        window.API.recordSession().catch(() => {});
      }
      // Push notifications: ask once, register the phone's token against
      // this account. Also on INITIAL_SESSION, so a phone that was already
      // signed in when the app launched registers without signing in again.
      // No-op on the web (see push.js).
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && sess && window.Push) {
        window.Push.register();
      }
      // Signing in is the clearest possible statement that the account was
      // not meant to go away. Not awaited: it changes how OTHER people see
      // this account, so nothing on the screen we are about to render is
      // waiting on it. If it fails, the account-status screen still offers
      // the explicit cancel button.
      if (event === 'SIGNED_IN') {
        reactivateIfDormant().catch(e => console.warn('reactivate on sign-in failed:', e && e.message));
      }
    });
  }

  // Last line of defence. Nothing above should be able to leave #app empty
  // any more, but "blank screen with no way out" is the one failure a user
  // cannot report and cannot escape, so it gets an explicit backstop rather
  // than trust. Only ever fires when the app really has drawn nothing.
  setTimeout(function () {
    if (app.children.length) return;
    app.innerHTML = '';
    const box = document.createElement('div');
    box.style.cssText = 'padding:32px 24px;text-align:center;font-family:Tajawal,Cairo,sans-serif';
    box.setAttribute('dir', 'rtl');
    const msg = document.createElement('p');
    msg.textContent = 'تعذر بدء التطبيق. تحقق من اتصالك وحاول مرة أخرى.';
    msg.style.cssText = 'margin:0 0 18px;font-size:15px';
    const btn = document.createElement('button');
    btn.textContent = 'إعادة المحاولة';
    btn.style.cssText = 'padding:12px 26px;border:0;border-radius:999px;background:#1e56d6;color:#fff;font-size:15px;font-weight:700';
    btn.onclick = function () { location.reload(); };
    const alt = document.createElement('button');
    alt.textContent = 'تسجيل الدخول';
    alt.style.cssText = 'display:block;margin:14px auto 0;padding:10px 22px;border:0;background:none;color:#1e56d6;font-size:14px;font-weight:600';
    alt.onclick = function () { location.hash = '#/login'; render(); };
    box.appendChild(msg); box.appendChild(btn); box.appendChild(alt);
    app.appendChild(box);
  }, 9000);

  window.addEventListener('hashchange', render);

  // Android's back button. Capacitor delivers it here; without a listener
  // the WebView walked its own history, and the entry under the feed was the
  // login screen - so "back" from the feed asked a signed-in person to sign
  // in again. On a root screen, back leaves the app, like every other app.
  // Anywhere else it goes back one step. iOS has no such button; harmless.
  (function () {
    const cap = window.Capacitor;
    const App = cap && cap.Plugins && cap.Plugins.App;
    if (!App || typeof App.addListener !== 'function') return;
    const ROOTS = ['/', '/home', '/discover', '/inbox', '/profile', '/login', '/welcome', '/onboarding'];
    App.addListener('backButton', function () {
      const { path } = parseHash();
      if (ROOTS.indexOf(path) > -1 || history.length <= 1) {
        try { App.exitApp(); } catch (e) {}
        return;
      }
      history.back();
    });
  })();
  // Language switch re-renders the current view from its Arabic source
  window.addEventListener('tt-rerender', render);
  window.addEventListener('DOMContentLoaded', render);
  if (document.readyState !== 'loading') render();
})();
