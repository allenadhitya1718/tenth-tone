/* === App configuration ===
 * Loaded before everything else so other modules can read it at define time.
 */
window.TT_CONFIG = (function () {

  // ── DEMO MODE ──
  // true  → when the database returns nothing (or isn't connected yet), screens
  //         fall back to sample content so the app can be clicked through.
  // false → those screens show real empty states ("No videos yet", etc.).
  //
  // Real data ALWAYS takes priority: this only ever fills in for an empty or
  // failed response. Set to false before shipping to production.
  //
  // Can also be overridden per-session without editing this file:
  //   ?demo=0  → force off      ?demo=1  → force on
  //
  // Now that the Supabase project is live, this defaults to OFF so the app
  // shows real data. Set to true (or use ?demo=1) to browse with sample
  // content instead.
  let demoMode = false;

  try {
    const q = new URLSearchParams(location.search);
    if (q.get('demo') === '0') demoMode = false;
    if (q.get('demo') === '1') demoMode = true;
  } catch (e) { /* URLSearchParams unavailable — keep the default */ }

  // ── OTP LENGTH ──
  // Must match Supabase: Authentication -> Sign In / Providers -> "Email OTP
  // Length". Rather than demand an exact match - a mismatch silently truncates
  // the code and rejects every correct one - the screens draw otpMaxLength
  // boxes and accept anything from otpMinLength up. That covers a 6- or an
  // 8-digit code without either setting having to be right.
  // Supabase is set to 6. If you ever change it there, change it here too -
  // a mismatch truncates the code and every correct one is rejected.
  const otpMaxLength = 6;
  const otpMinLength = 6;

  // ── CAPTCHA ──
  // Cloudflare Turnstile SITE key. This one is public by design — it appears
  // in the page for every visitor, exactly like the Supabase anon key. The
  // matching SECRET key is different: it goes into the Supabase dashboard
  // (Authentication -> Attack Protection) and must never appear in this repo.
  //
  // Leave empty and the whole CAPTCHA layer stays inert — no script is loaded
  // and no token is sent, so the app behaves exactly as it does today.
  //
  // That is deliberate. Turning CAPTCHA on in the Supabase dashboard makes it
  // MANDATORY server-side immediately: from that moment Supabase rejects any
  // sign-up, sign-in, or password reset that arrives without a token. Anyone
  // running an already-installed APK built before this key was set would be
  // locked out of logging in, and you cannot force them to update.
  //
  // So the order matters:
  //   1. Ship a build carrying this code (inert, key empty) — safe any time.
  //   2. Create the Turnstile site at Cloudflare, put the site key here,
  //      put the secret key in the Supabase dashboard.
  //   3. Rebuild and distribute the APK.
  //   4. Only once people are on that build, enable it in the dashboard.
  const captchaSiteKey = '0x4AAAAAAEiD4fQMLJ_1A_JQ';

  // ── CLOUDFLARE R2 UPLOADS ──
  // false → videos and live covers upload to Supabase Storage, exactly as they
  //         always have. Nothing about this build behaves differently.
  // true  → they go to R2 instead, via the media-upload Edge Function.
  //
  // Off by default so a build carrying this code is safe to ship before any of
  // the Cloudflare side exists.
  //
  // Turn it on only AFTER all of these are true, in this order:
  //   1. Migration 0062 applied — the quota must be able to SEE R2 before
  //      anything is written there. Skip this and storage_used_bytes() keeps
  //      reporting the old Supabase total for ever, the ceiling stops
  //      existing, and R2 fills toward the 10 GB where billing starts with
  //      nothing to warn you. See supabase/R2_ROLLOUT.md.
  //   2. The bucket, its CORS policy, and the five secrets are in place.
  //   3. `media-upload` is deployed and the step 5 tests in R2_ROLLOUT.md pass.
  //
  // Unlike the CAPTCHA switch this one is reversible without locking anybody
  // out: set it back to false and uploads return to Supabase. Files already in
  // R2 keep serving — their URLs are stored per row, so old and new can coexist
  // indefinitely.
  //
  // Overridable per session for testing, without a rebuild:
  //   ?r2=1  → force on       ?r2=0  → force off
  let r2Uploads = true;

  try {
    const q = new URLSearchParams(location.search);
    if (q.get('r2') === '0') r2Uploads = false;
    if (q.get('r2') === '1') r2Uploads = true;
  } catch (e) { /* URLSearchParams unavailable — keep the default */ }

  // ── CONTENT SCREENING ──
  // true  → text and images are checked by the moderate-content Edge Function
  //         on their way into the database (see web/js/moderation.js and
  //         supabase/migrations/0066_content_moderation.sql).
  // false → the layer is inert. Nothing is called and nothing is blocked.
  //
  // Unlike the CAPTCHA switch above, leaving this ON before the server side
  // exists is SAFE. moderation.js fails open on every path, and after three
  // failures in a row it stands down for ten minutes on its own - so a build
  // that reaches a phone before the function is deployed behaves exactly as
  // it does today, minus one wasted request every ten minutes.
  //
  // There is a second switch on the server: public.moderation_settings.enabled.
  // Prefer that one for turning screening off during an incident - it takes
  // effect within 60 seconds for everybody, on builds already installed. This
  // one only helps the build it ships in.
  //
  // Overridable per session for testing, without a rebuild:
  //   ?mod=1  → force on       ?mod=0  → force off
  // BACK ON 2026-09-01. It was turned off on 08-31 because the provider failed
  // every call, and a check that always fails is pure latency.
  //
  // What changed is that the latency is no longer paid on the paths people
  // feel. Comments, live comments and video publish now screen ALONGSIDE the
  // write instead of in front of it, so a failing scan costs nothing there -
  // measured at 183ms to post a comment with this on. Only avatars, profile
  // text and live titles still wait, because for those the write IS the
  // publication and there is no later gate to hold them at.
  //
  // Deliberately on even though moderate-content is mid-fix. The flag is baked
  // into the build; the function is not. Shipping it on means the server-side
  // fix reaches everyone already running this APK without another release,
  // and until then screening fails OPEN, which is exactly what shipping it off
  // would have done anyway.
  let aiModeration = true;

  // ── APP VERSION ──
  // Was the literal '1.0.0' hardcoded in three places, so the About screen said
  // 1.0.0 no matter which APK was installed - which made it impossible to tell
  // a tester's build apart from a six-week-old one. That cost real time during
  // a live bug hunt: two phones reporting "version 1.0.0" told us nothing.
  //
  // Keep in step with versionName in android/app/build.gradle. On a device the
  // native shell overwrites it below with the REAL installed version, so a
  // stale constant here can only ever be wrong in the browser.
  let appVersion = '1.2.5';

  try {
    const cap = window.Capacitor;
    if (cap && cap.Plugins && cap.Plugins.App && cap.Plugins.App.getInfo) {
      cap.Plugins.App.getInfo().then(function (info) {
        if (info && info.version) {
          appVersion = info.version;
          window.TT_CONFIG.appVersion = info.version;
          // Repaint anything already showing the fallback.
          try {
            // Keep the label, replace only the number. Writing the bare
            // version here dropped the word "Version" - and its translation -
            // the moment Capacitor resolved on a real device, which browser
            // testing could never show.
            var en = false;
            try { en = localStorage.getItem('tt-lang') === 'en'; } catch (e) {}
            document.querySelectorAll('[data-app-version]').forEach(function (el) {
              el.textContent = (en ? 'Version ' : '\u0627\u0644\u0625\u0635\u062f\u0627\u0631 ') + info.version;
            });
          } catch (e) {}
        }
      }).catch(function () {});
    }
  } catch (e) { /* browser, or an older Capacitor - the constant stands */ }


  try {
    const q = new URLSearchParams(location.search);
    if (q.get('mod') === '0') aiModeration = false;
    if (q.get('mod') === '1') aiModeration = true;
  } catch (e) { /* URLSearchParams unavailable — keep the default */ }

  return { demoMode, otpMaxLength, otpMinLength, captchaSiteKey, r2Uploads, aiModeration, appVersion };
})();
