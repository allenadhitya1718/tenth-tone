/* === Deep linking ===
 * Maps shareable web URLs to in-app screens, so a link texted to a
 * friend opens the native app on that exact screen instead of a browser.
 *
 * Canonical link formats (all served from the site root):
 *   https://tenthtone.app/v/<videoId>    → the video, in the feed
 *   https://tenthtone.app/u/<userId>     → a user's profile
 *   https://tenthtone.app/live/<liveId>  → a live stream
 *
 * Three entry paths are handled:
 *   1. Native app already running  → Capacitor 'appUrlOpen' event
 *   2. Native app cold-started     → Capacitor getLaunchUrl()
 *   3. Plain web / PWA             → clean path rewritten to a hash route
 *
 * For the OS to hand these links to the app rather than the browser, the
 * domain must also serve the two association files (see web/.well-known/)
 * and the native projects must declare the domain — Android via the
 * intent-filters in AndroidManifest.xml, iOS via the Associated Domains
 * capability. See DEEPLINKS.md for the full setup checklist.
 */
window.DeepLink = (function () {

  const DOMAIN = 'tenthtone.app';
  const ORIGIN = 'https://' + DOMAIN;
  const SCHEME = 'tenthtone'; // custom-scheme fallback: tenthtone://v/<id>

  // Clean web path → in-app hash route.
  const PATH_ROUTES = [
    [/^\/v\/(.+)$/i,    (m) => '/v/' + m[1]],
    [/^\/u\/(.+)$/i,    (m) => '/profile/' + m[1]],
    [/^\/live\/(.+)$/i, (m) => '/live/' + m[1]],
  ];

  // ── Building share links ──
  function videoLink(id)   { return ORIGIN + '/v/' + encodeURIComponent(id); }
  function profileLink(id) { return ORIGIN + '/u/' + encodeURIComponent(id); }
  function liveLink(id)    { return ORIGIN + '/live/' + encodeURIComponent(id); }

  // ── Resolving incoming links ──
  // Accepts a full URL (https://… or tenthtone://…) or a bare path, and
  // returns the matching in-app route, or null if it isn't a deep link.
  function routeForUrl(url) {
    if (!url) return null;
    let path;
    try {
      if (url.indexOf(SCHEME + '://') === 0) {
        // tenthtone://v/123 — host is the first segment, so re-prefix it
        path = '/' + url.slice((SCHEME + '://').length);
      } else if (/^https?:\/\//i.test(url)) {
        const u = new URL(url);
        if (u.hostname !== DOMAIN && u.hostname !== 'www.' + DOMAIN) return null;
        path = u.pathname;
      } else {
        path = url.charAt(0) === '/' ? url : '/' + url;
      }
    } catch (e) {
      return null;
    }
    path = path.replace(/\/+$/, '') || '/';

    for (let i = 0; i < PATH_ROUTES.length; i++) {
      const m = path.match(PATH_ROUTES[i][0]);
      if (m) return PATH_ROUTES[i][1](m);
    }
    return null;
  }

  // Navigates to the link's target if it resolves. Returns true if handled.
  function open(url) {
    const route = routeForUrl(url);
    if (!route) return false;
    location.hash = '#' + route;
    return true;
  }

  // ── Wiring ──
  function init() {
    // 1 & 2. Native app: links arriving while running, and the launch URL.
    const cap = window.Capacitor;
    const AppPlugin = cap && cap.Plugins && cap.Plugins.App;
    if (AppPlugin) {
      try {
        AppPlugin.addListener('appUrlOpen', (data) => {
          if (data && data.url) open(data.url);
        });
      } catch (e) { console.warn('[DeepLink] appUrlOpen listener failed:', e); }

      try {
        AppPlugin.getLaunchUrl().then((res) => {
          if (res && res.url) open(res.url);
        }).catch(() => {});
      } catch (e) { /* getLaunchUrl unavailable on this platform */ }
    }

    // 3. Web / PWA: the host rewrites unknown paths to index.html, so a
    // visit to /v/123 lands here with that path still in the address bar.
    if (!location.hash && location.pathname && location.pathname !== '/') {
      open(location.pathname);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { videoLink, profileLink, liveLink, routeForUrl, open, DOMAIN, ORIGIN, SCHEME };
})();
