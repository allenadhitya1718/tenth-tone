/* === Push notifications (device registration) ===
 *
 * Android and iOS only: on the web there is no plugin and every call here is
 * a no-op. The phone hands us a token once the person allows notifications;
 * it goes into push_tokens with the platform and the app language, and the
 * send-push function reads it from there. On sign-out the token is removed
 * FIRST (while the session can still authorise the delete), so a phone that
 * signs out never keeps receiving the old account's notifications.
 *
 * A notification tapped from the shade carries `route` in its data
 * (e.g. /chat/<id>); opening it is one hash assignment, the router does the
 * rest.
 */
window.Push = (function () {
  const plugin = () => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications) || null;
  const platform = () => {
    try { const p = window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform(); return p === 'ios' || p === 'android' ? p : 'web'; }
    catch (e) { return 'web'; }
  };
  const lang = () => { try { return localStorage.getItem('tt-lang') === 'en' ? 'en' : 'ar'; } catch (e) { return 'ar'; } };

  let wired = false;
  let lastToken = '';
  let pendingRoute = '';

  function wire() {
    if (wired) return;
    const p = plugin(); if (!p) return;
    wired = true;
    p.addListener('registration', async (t) => {
      const token = (t && t.value) || '';
      if (!token) return;
      lastToken = token;
      try { if (window.API && window.API.savePushToken) await window.API.savePushToken(token, platform(), lang()); }
      catch (e) { console.warn('push: token not saved:', e && e.message); }
    });
    p.addListener('registrationError', (e) => {
      console.warn('push: registration failed:', e && (e.error || JSON.stringify(e)));
    });
    // Tapped in the shade. If the app is still booting, the router may not
    // be ready; keep the route and apply it once it is.
    p.addListener('pushNotificationActionPerformed', (a) => {
      const d = (a && a.notification && a.notification.data) || {};
      const route = typeof d.route === 'string' && d.route.charAt(0) === '/' ? d.route : '';
      if (!route) return;
      if (document.readyState === 'complete') { try { location.hash = '#' + route; } catch (e) {} }
      else pendingRoute = route;
    });
    window.addEventListener('load', () => { if (pendingRoute) { try { location.hash = '#' + pendingRoute; } catch (e) {} pendingRoute = ''; } });
  }

  // Ask once, register when allowed. Safe to call on every sign-in and every
  // launch: a token already saved is simply upserted again.
  async function register() {
    const p = plugin(); if (!p) return;
    try {
      let perm = await p.checkPermissions();
      if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await p.requestPermissions();
      if (perm.receive !== 'granted') return;
      wire();
      await p.register();
    } catch (e) { console.warn('push: register:', e && e.message); }
  }

  async function unregister() {
    const p = plugin(); if (!p) return;
    try { if (lastToken && window.API && window.API.removePushToken) await window.API.removePushToken(lastToken); }
    catch (e) { /* the token will also die on the next send that comes back invalid */ }
    lastToken = '';
  }

  return { register, unregister, platform };
})();
