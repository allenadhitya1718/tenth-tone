/* === FLYP admin v2 - backend config ===
 *
 * The NEW backend only: Supabase Mumbai (project vfkwipvinmnybilcrdzr), the
 * one the React Native app talks to (mobile/src/lib/config.ts).
 *
 * The publishable key is meant to ship in clients; row-level security and the
 * is_admin() checks inside the admin_v2_* functions (migration 0128) do the
 * guarding. NEVER put a service-role / secret key in this file or anywhere
 * under web/ - it would be public the moment the site deploys.
 *
 * This file is separate from web/js/supabase.js on purpose: that one points at
 * the OLD project (qnzgxihlrwanywndcmpf) and serves the old app and /admin.
 * The two panels use different localStorage keys, so a session on one is never
 * picked up by the other.
 */
(function () {
  // Never run inside another site's frame (clickjacking). GitHub Pages cannot
  // send a frame-ancestors header, so the page refuses to load framed.
  if (window.top !== window.self) {
    document.documentElement.innerHTML = '';
    try { window.top.location = window.self.location.href; } catch (_) { /* cross-origin top: page stays blank */ }
    throw new Error('FLYP admin refuses to load inside a frame');
  }

  window.FLYP_ADMIN_V2_CONFIG = Object.freeze({
    url: 'https://vfkwipvinmnybilcrdzr.supabase.co',
    key: 'sb_publishable_dgWbaJlmKOgP3VDEriA7Lg_LDHOiomD',
    projectRef: 'vfkwipvinmnybilcrdzr',
    storageKey: 'flyp-admin-v2-auth',
    sdk: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.46.1/dist/umd/supabase.min.js',
  });
})();
