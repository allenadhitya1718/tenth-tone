/* === Mobile router === */
(function () {
  const app = document.getElementById('app');

  const PUBLIC_PATHS = ['/', '/login', '/register', '/otp', '/forgot', '/reset', '/home'];

  const routes = [
    { p: /^\/?$/, v: () => Views.splash() },
    { p: /^\/login$/, v: () => Views.login() },
    { p: /^\/register$/, v: () => Views.register() },
    { p: /^\/otp$/, v: () => Views.otp() },
    { p: /^\/forgot$/, v: () => Views.forgot() },
    { p: /^\/reset$/, v: () => Views.reset() },
    { p: /^\/home$/, v: q => Views.home({ q }) },
    { p: /^\/discover$/, v: () => Views.discover() },
    { p: /^\/create$/, v: () => Views.create() },
    { p: /^\/camera$/, v: () => Views.camera() },
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
    { p: /^\/share(?:\/(.+))?$/, v: (q, m) => Views.share({ id: m[1] }) },
    { p: /^\/live\/start$/, v: () => Views.liveStart() },
    { p: /^\/live\/host-list$/, v: () => Views.liveHostList() },
    { p: /^\/live\/(.+)$/, v: (q, m) => Views.live({ id: m[1] }) },
    { p: /^\/map$/, v: q => Views.map({ q }) },
    { p: /^\/wallet$/, v: () => Views.wallet() },
    { p: /^\/settings$/, v: () => Views.settings() },
    { p: /^\/blocked$/, v: () => Views.blockedUsers() },
  ];

  // Restore the user's dark-mode preference from localStorage as early as possible
  try { if (localStorage.getItem('tt-theme') === 'dark') document.body.classList.add('dark'); } catch (e) {}

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

    if (!session && !PUBLIC_PATHS.includes(path)) {
      location.hash = '#/login';
      return;
    }
    // Redirect root to login if no session, else home
    if (path === '/') {
      location.hash = session ? '#/home' : '#/login';
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
      if (event === 'SIGNED_OUT') location.hash = '#/login';
    });
  }

  window.addEventListener('hashchange', render);
  // Language switch re-renders the current view from its Arabic source
  window.addEventListener('tt-rerender', render);
  window.addEventListener('DOMContentLoaded', render);
  if (document.readyState !== 'loading') render();
})();
