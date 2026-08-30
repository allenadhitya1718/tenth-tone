/* === Mobile router === */
(function () {
  const app = document.getElementById('app');

  const PUBLIC_PATHS = ['/', '/onboarding', '/welcome', '/login', '/register', '/otp', '/forgot', '/reset-otp', '/home', '/legal'];
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
    { p: /^\/upload$/, v: () => Views.editVideo() },
    { p: /^\/edit-video$/, v: () => Views.editVideo() },
    { p: /^\/publish$/, v: () => Views.publish() },
    { p: /^\/inbox$/, v: () => Views.inbox() },
    { p: /^\/chat-new\/(group|dm)$/, v: (q, m) => Views.chatNew({ id: m[1] }) },
    { p: /^\/chat\/(.+)$/, v: (q, m) => Views.chat({ id: m[1] }) },
    { p: /^\/profile$/, v: () => Views.profile() },
    { p: /^\/profile\/edit$/, v: () => Views.editProfile() },
    { p: /^\/profile\/(.+)$/, v: (q, m) => Views.userProfile({ id: m[1] }) },
    { p: /^\/list\/(followers|following)$/, v: (q, m) => Views.userList({ id: m[1] }) },
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

  async function render() {
    const { path, q } = parseHash();

    // Auth guard: gate non-public paths until we know whether the user is signed in
    if (!sessionChecked) {
      try { session = await window.SB.getSession(); } catch (e) { session = null; }
      sessionChecked = true;
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
      location.hash = '#/home';
      return;
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
    });
  }

  window.addEventListener('hashchange', render);
  // Language switch re-renders the current view from its Arabic source
  window.addEventListener('tt-rerender', render);
  window.addEventListener('DOMContentLoaded', render);
  if (document.readyState !== 'loading') render();
})();
