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

  return { demoMode, otpMaxLength, otpMinLength };
})();
