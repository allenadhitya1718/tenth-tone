/* === Shared helpers / icons / components === */
window.H = (function () {
  function el(tag, props = {}, children = []) {
    const e = document.createElement(tag);
    for (const k in props) {
      if (k === 'class') e.className = props[k];
      else if (k === 'html') e.innerHTML = props[k];
      else if (k.startsWith('on') && typeof props[k] === 'function') e.addEventListener(k.slice(2).toLowerCase(), props[k]);
      else if (k === 'style' && typeof props[k] === 'object') Object.assign(e.style, props[k]);
      else if (k in e) e[k] = props[k];
      else e.setAttribute(k, props[k]);
    }
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c == null || c === false) return;
      // Numbers are as ordinary a child as strings. Without this they fall
      // through to appendChild and throw "parameter 1 is not of type 'Node'",
      // which surfaces as a broken panel rather than as a type error.
      if (typeof c === 'string' || typeof c === 'number') {
        e.appendChild(document.createTextNode(String(c)));
      } else {
        e.appendChild(c);
      }
    });
    return e;
  }

  // Build via tagged template-ish — actually just html escape helper
  function esc(s) {
    return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  // Allow only http(s) and data:image URLs through to img.src — blocks javascript:, vbscript:, etc.
  function safeUrl(u) {
    if (u == null) return '';
    const s = String(u).trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (/^\/\//.test(s)) return s;
    if (s.startsWith('/')) return s;
    if (/^data:image\/(png|jpe?g|gif|webp|avif|heic);base64,/i.test(s)) return s;
    return '';
  }

  function fmt(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n || 0);
  }

  function go(path) {
    if (location.hash !== '#' + path) location.hash = path;
  }

  function back() {
    if (history.length > 1) history.back();
    else go('/home');
  }

  function toast(msg) {
    const existing = document.querySelectorAll('.toast');
    existing.forEach(t => t.remove());
    const t = el('div', { class: 'toast', textContent: msg });
    document.body.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transition = 'opacity 0.25s ease';
      setTimeout(() => t.remove(), 250);
    }, 2200);
  }

  // ── Haptics ──
  // @capacitor/haptics has been a dependency since the first build and was
  // never called once, so the plugin shipped inside the APK doing nothing.
  // Instagram and TikTok both answer a like, a follow and a tab change with a
  // short tap; without one, every control in this app feels identical to every
  // other one.
  //
  // Three layers, because the app runs in three places: the Capacitor plugin on
  // a device, navigator.vibrate in an Android browser, and nothing at all on
  // desktop and iOS Safari - where silence is correct, not degraded.
  //
  // Never awaited and never allowed to throw. Feedback must not be able to fail
  // the action it is decorating.
  const VIBE = { light: 12, medium: 22, heavy: 34, success: [10, 40, 16], warning: [22, 60, 22] };
  function haptic(style) {
    style = style || 'light';
    try {
      const P = window.Capacitor && window.Capacitor.Plugins;
      const HP = P && P.Haptics;
      if (HP) {
        if ((style === 'success' || style === 'warning') && HP.notification) {
          HP.notification({ type: style.toUpperCase() });
          return;
        }
        if (HP.impact) {
          HP.impact({ style: style === 'heavy' ? 'HEAVY' : style === 'medium' ? 'MEDIUM' : 'LIGHT' });
          return;
        }
      }
      if (navigator.vibrate) navigator.vibrate(VIBE[style] || VIBE.light);
    } catch (e) { /* silence beats a broken action */ }
  }

  // Drag a bottom sheet down to dismiss it. Sheets could only be closed by
  // tapping the backdrop or hunting for a close button; every app in this
  // category dismisses one with a downward swipe, and the grabber bar added in
  // CSS is the affordance that says so.
  //
  // The scrollTop guard is the part that matters: a sheet is also a scrolling
  // container, so dragging from anywhere but the top must scroll it, not close
  // it. Only a drag that begins at the top becomes a dismiss.
  function attachSheetDrag(sheet, close) {
    let startY = 0, dy = 0, dragging = false;
    const BASE = 'translateX(-50%)';
    const start = e => {
      if (sheet.scrollTop > 0) return;
      const t = e.touches && e.touches[0]; if (!t) return;
      startY = t.clientY; dy = 0; dragging = true;
      sheet.style.transition = 'none';
    };
    const move = e => {
      if (!dragging) return;
      const t = e.touches && e.touches[0]; if (!t) return;
      dy = t.clientY - startY;
      // Upward does nothing: a sheet is already against the bottom edge.
      if (dy <= 0) { dy = 0; sheet.style.transform = BASE; return; }
      sheet.style.transform = BASE + ' translateY(' + dy + 'px)';
      if (e.cancelable) e.preventDefault();
    };
    const end = () => {
      if (!dragging) return;
      dragging = false;
      sheet.style.transition = 'transform .22s ease';
      // Proportional, so a short sheet does not need the same throw as a tall
      // one, and capped so a tall one is not a workout.
      const limit = Math.min(120, sheet.getBoundingClientRect().height * 0.28);
      if (dy > limit) {
        sheet.style.transform = BASE + ' translateY(110%)';
        setTimeout(close, 190);
      } else {
        sheet.style.transform = BASE;
      }
    };
    sheet.addEventListener('touchstart', start, { passive: true });
    sheet.addEventListener('touchmove', move, { passive: false });
    sheet.addEventListener('touchend', end);
    sheet.addEventListener('touchcancel', end);
  }

  function modal(content) {
    const bd = el('div', { class: 'backdrop', onclick: close });
    function close() { bd.remove(); content.remove(); }
    document.body.appendChild(bd);
    document.body.appendChild(content);
    if (content.classList && content.classList.contains('sheet')) attachSheetDrag(content, close);
    return close;
  }

  // === Modern, Crisp Icon Set (Feather / Lucide Style) ===
  const icons = {
    // Brand Logos
    // The FLYP wordmark. Was a hand-drawn SVG of a purple gradient square
    // with a letter T — the old Tenth Tone mark. The real logo has glows and
    // a waveform that cannot sensibly be redrawn as SVG paths, so it is the
    // artwork itself. Sized by whatever container it is dropped into.
    logo: '<img src="icons/flyp-logo-wide.png" alt="FLYP" style="width:100%;height:auto;display:block;border-radius:12px">',
    // Square mark, for tight spaces like the admin header.
    logoMark: '<img src="icons/flyp-mark.png" alt="FLYP" style="width:100%;height:100%;display:block;border-radius:8px;object-fit:cover">',

    // Navigation & Primary Actions
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    homeFill: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
    inboxFill: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    userFill: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>',
    
    // Social interactions
    heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
    heartOutline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>',
    comment: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.7 10.3 13.7 2.3c-.4-.4-1-.4-1.4 0-.4.4-.4 1 0 1.4L18.6 10H6c-3.3 0-6 2.7-6 6v5c0 .6.4 1 1 1s1-.4 1-1v-5c0-2.2 1.8-4 4-4h12.6l-6.3 6.3c-.4.4-.4 1 0 1.4.4.4 1 .4 1.4 0l8-8c.4-.4.4-1 0-1.4z"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>',
    music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    
    // UI Helpers & Arrows
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    chevR: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
    chevL: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
    chevD: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    chevU: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',
    arrowR: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
    arrowL: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>',
    arrowUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>',
    sendOutline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>',
    moreH: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="12" r="2"/></svg>',
    shareBox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="m8 7 4-4 4 4"/><path d="M20 14v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.8V4h6v6.8l2.4 2.6a1 1 0 0 1-.73 1.68H7.33a1 1 0 0 1-.73-1.68L9 10.8z"/></svg>',
    mapPin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    telegram: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.9 4.3 18.7 19.4c-.2 1-.9 1.3-1.7.8l-4.7-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.9L18.2 6c.4-.3-.1-.5-.6-.2L6.6 12.6l-4.7-1.5c-1-.3-1-1 .2-1.5l18.4-7.1c.9-.3 1.6.2 1.4 1.8z"/></svg>',
    xTwitter: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 3h3.1l-6.8 7.8L22 21h-6.3l-4.9-6.4L5 21H1.9l7.3-8.3L2 3h6.5l4.4 5.9L17.5 3zm-1.1 16.2h1.7L7.7 4.7H5.9l10.5 14.5z"/></svg>',
    moreV: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
    // Feed rail uses thin outline icons (the filled set above stays for
    // everywhere else in the app).
    feedHeart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    feedComment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    feedSend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>',
    feedBookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>',
    feedMore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 10h10"/><path d="M7 14h10"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',

    // Media & Camera
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>',
    flip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0-4.4-3.6-8-8-8s-8 3.6-8 8v1"/><polyline points="1 8 4 11 7 8"/><path d="M4 14c0 4.4 3.6 8 8 8s8-3.6 8-8v-1"/><polyline points="23 16 20 13 17 16"/></svg>',
    flash: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    timer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>',

    // Call controls. Each "off" icon carries the struck-through slash, so a
    // muted mic reads as muted from the shape alone and does not depend on
    // the button's colour — which matters on the call screen, where the
    // active state is a white fill that a colourblind user may not separate
    // from the inactive grey.
    micOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><path d="M19 10v2a7 7 0 0 1-.11 1.23"/><path d="M5 10v2a7 7 0 0 0 12 5"/><line x1="12" x2="12" y1="19" y2="22"/><line x1="2" x2="22" y1="2" y2="22"/></svg>',
    speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
    speakerOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/></svg>',
    videoOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.66 6H14a2 2 0 0 1 2 2v2.34l1 1L22 8v8"/><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2l10 10Z"/><line x1="2" x2="22" y1="2" y2="22"/></svg>',

    // Location & Wallet
    map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" x2="9" y1="3" y2="18"/><line x1="15" x2="15" y1="6" y2="21"/></svg>',
    wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/></svg>',
    gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></svg>',
    sparkle: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>',
    filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
    text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/></svg>',
    sticker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>',

    // Auth & Communication
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    paperclip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>',
    flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>',
    // Delete. Added because the only close-enough icon was `x`, and a
    // close-cross labelled "delete" reads as "dismiss this menu".
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>',
    fire: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>',
    // Was missing: referenced by the wallet transaction rows and the share
    // sheet, where `icons.download` resolved to undefined and rendered the
    // literal text "undefined".
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',

    // Social network icons
    snapchat: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.4c-3.2 0-5.8 2.6-5.8 5.8 0 .9.05 1.75.05 2.4 0 .5-.35.75-.8.6-.4-.13-.8-.3-1.1-.42-.55-.2-1.05.35-.75.85.42.7 1.4 1.15 2.1 1.4.3.1.4.3.3.6-.45 1.3-1.7 2.5-3.25 3-.5.17-.5.8 0 .95.9.28 1.9.45 2.5.5.3.03.45.2.5.5.06.35.14.7.25.95.13.3.45.42.8.36.5-.08 1.1-.2 1.7-.2.85 0 1.45.28 2.05.7.7.5 1.45.95 2.45.95s1.75-.45 2.45-.95c.6-.42 1.2-.7 2.05-.7.6 0 1.2.12 1.7.2.35.06.67-.06.8-.36.11-.25.19-.6.25-.95.05-.3.2-.47.5-.5.6-.05 1.6-.22 2.5-.5.5-.15.5-.78 0-.95-1.55-.5-2.8-1.7-3.25-3-.1-.3 0-.5.3-.6.7-.25 1.68-.7 2.1-1.4.3-.5-.2-1.05-.75-.85-.3.12-.7.29-1.1.42-.45.15-.8-.1-.8-.6 0-.65.05-1.5.05-2.4 0-3.2-2.6-5.8-5.8-5.8z"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.52 3.48A11.9 11.9 0 0 0 12.05 0C5.5 0 .18 5.32.18 11.87c0 2.09.55 4.13 1.6 5.93L0 24l6.34-1.66a11.86 11.86 0 0 0 5.7 1.45h.01c6.55 0 11.87-5.32 11.87-11.87 0-3.17-1.23-6.15-3.4-8.44zM12.05 21.8h-.01a9.86 9.86 0 0 1-5.03-1.38l-.36-.21-3.76.99 1-3.66-.23-.38a9.85 9.85 0 0 1-1.51-5.29c0-5.45 4.43-9.88 9.9-9.88 2.64 0 5.13 1.03 7 2.9a9.83 9.83 0 0 1 2.9 6.99c0 5.45-4.43 9.92-9.9 9.92zm5.43-7.4c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51l-.57-.01c-.2 0-.52.07-.79.37s-1.04 1.02-1.04 2.49 1.07 2.89 1.22 3.09c.15.2 2.11 3.22 5.11 4.51.71.31 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2-1.41.25-.69.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35z"/></svg>',
  };

  function svg(name, props = {}) {
    const wrap = el('span', { html: icons[name] || '', class: 'icon ' + (props.class || ''), style: props.style || {} });
    return wrap.firstElementChild || wrap;
  }

  // Bottom navigation bar
  function bottomNav(active) {
    const nav = document.getElementById('bottom-nav');
    if (!nav) return;
    nav.hidden = false;
    nav.style.display = '';
    const items = [
      { key: 'home', label: 'الرئيسية', icon: active === 'home' ? 'homeFill' : 'home', go: '/home' },
      { key: 'discover', label: 'استكشف', icon: 'search', go: '/discover' },
      { key: 'create', label: '', icon: 'plus', go: '/create', special: true },
      { key: 'inbox', label: 'البريد', icon: active === 'inbox' ? 'inboxFill' : 'inbox', go: '/inbox' },
      { key: 'profile', label: 'البروفايل', icon: active === 'profile' ? 'userFill' : 'user', go: '/profile' },
    ];
    nav.innerHTML = '';
    items.forEach(it => {
      const btn = el('button', { class: 'bn-item' + (it.key === active ? ' active' : ''), onclick: () => go(it.go) }, [
        it.special
          ? el('span', { class: 'bn-create', html: icons.plus })
          : svg(it.icon),
        it.label && el('span', {}, it.label),
      ]);
      nav.appendChild(btn);
    });
    // The nav used to go black on the Home tab only, so it flipped colour as
    // you moved between tabs. It now follows the app theme instead: light
    // theme = white, dark theme = black, on every screen.
    nav.classList.remove('dark');
    try { if (window.I18N) window.I18N.apply(nav); } catch (e) {}
  }

  function hideNav() {
    const nav = document.getElementById('bottom-nav');
    if (!nav) return;
    nav.hidden = true;
    nav.style.display = 'none';
    nav.innerHTML = '';
    nav.classList.remove('dark');
  }

  function topBar({ title, back: showBack = true, dark = false, right = null, onBack } = {}) {
    return el('header', { class: 'top-bar' + (dark ? ' dark' : '') }, [
      showBack
        // back-btn + chevL, mirrored for RTL by CSS. This was a bare chevR,
        // which points forwards in English — every screen built with topBar
        // had a back arrow pointing the wrong way once the app was in
        // English, while the five hand-rolled ones had been corrected.
        ? el('button', { class: 'icon-btn back-btn' + (dark ? ' dark' : ''), onclick: onBack || (() => back()), html: icons.chevL })
        : el('span', { style: { width: '36px' } }),
      title ? el('h1', { class: 'title' }, title) : el('span'),
      right || el('span', { style: { width: '36px' } }),
    ]);
  }

  // Deterministic avatar colours. Every user without a photo used to get the
  // same purple disc, so a list of people read as a row of identical blobs.
  // Each name maps to a fixed pair, so the same person is always the same
  // colour - and it is derived from the ORIGINAL name, not the translated
  // one, so switching language does not recolour everybody.
  const AVATAR_COLORS = [
    ['#1e56d6', '#5b9bf5'], // brand blue
    ['#4f46e5', '#818cf8'], // indigo
    ['#0284c7', '#38bdf8'], // blue
    ['#0d9488', '#2dd4bf'], // teal
    ['#15803d', '#4ade80'], // green
    ['#b45309', '#fbbf24'], // amber
    ['#c2410c', '#fb923c'], // orange
    ['#be123c', '#fb7185'], // rose
    ['#a21caf', '#e879f9'], // fuchsia
    ['#475569', '#94a3b8'], // slate
  ];

  function avatarColors(key) {
    const k = String(key || '').trim().toLowerCase() || 'flyp';
    let h = 5381;
    for (let i = 0; i < k.length; i++) h = (((h << 5) + h + k.charCodeAt(i)) >>> 0);
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }

  function avatar(src, alt = '', size = 44) {
    const pair = avatarColors(alt);
    const w = el('div', {
      class: 'avatar',
      style: {
        width: size + 'px',
        height: size + 'px',
        borderRadius: '50%',
        overflow: 'hidden',
        background: 'linear-gradient(135deg, ' + pair[0] + ' 0%, ' + pair[1] + ' 100%)',
        flexShrink: '0',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative'
      }
    });

    // Derive the initial from the DISPLAYED name, so a translated name
    // ("Khaled") doesn't end up next to an initial from the original
    // string ("خ").
    const shownName = (window.I18N && alt) ? window.I18N.t(alt) : alt;
    const fallbackInitial = (shownName && String(shownName).trim().charAt(0)) || 'T';
    const fallbackDiv = el('div', {
      textContent: fallbackInitial,
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#ffffff',
        fontWeight: '700',
        fontSize: Math.max(12, Math.floor(size * 0.42)) + 'px',
        textTransform: 'uppercase',
      }
    });

    if (src) {
      const img = el('img', {
        src: safeUrl(src) || src,
        alt: alt || '',
        loading: 'lazy',
        style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }
      });
      img.onerror = () => {
        img.replaceWith(fallbackDiv);
      };
      w.appendChild(img);
    } else {
      w.appendChild(fallbackDiv);
    }

    return w;
  }

  // Shared empty state — shown wherever a screen has no real data yet.
  // opts: { icon, title, sub, actionLabel, onAction, onDark, isError }
  function emptyState(opts = {}) {
    const cls = 'empty-state'
      + (opts.onDark ? ' on-dark' : '')
      + (opts.isError ? ' is-error' : '');
    const children = [];
    if (opts.icon !== false) {
      children.push(el('div', { class: 'empty-icon', html: icons[opts.icon] || icons.inbox }));
    }
    if (opts.title) children.push(el('div', { class: 'empty-title' }, opts.title));
    if (opts.sub) children.push(el('div', { class: 'empty-sub' }, opts.sub));
    if (opts.actionLabel && opts.onAction) {
      children.push(el('button', { class: 'btn btn-outline', onclick: opts.onAction }, opts.actionLabel));
    }
    return el('div', { class: cls }, children);
  }

  // In-app replacements for window.prompt / window.confirm.
  // Native dialogs are unavailable in the app webview - calling prompt()
  // throws, which killed the handler before it could show anything, so the
  // button looked dead. These return promises instead.
  function dialog({ title, message, confirmLabel, cancelLabel, danger, field }) {
    return new Promise(resolve => {
      const card = el('div', { class: 'dlg' });
      let done = false;
      const finish = (v) => { if (done) return; done = true; close(); resolve(v); };
      const close = modal(card);
      // Backdrop click resolves as a cancel rather than leaving a dangling promise.
      const bd = document.querySelector('.backdrop');
      if (bd) bd.onclick = () => finish(field ? null : false);

      card.appendChild(el('h4', { class: 'dlg-title' }, title));
      if (message) card.appendChild(el('p', { class: 'dlg-msg' }, message));

      let input = null;
      if (field) {
        input = el('input', {
          class: 'dlg-input',
          type: field.type || 'text',
          placeholder: field.placeholder || '',
          autocomplete: field.type === 'password' ? 'new-password' : 'off',
        });
        card.appendChild(input);
      }

      const err = el('p', { class: 'dlg-err', style: { display: 'none' } });
      card.appendChild(err);

      const submit = () => {
        if (!field) return finish(true);
        const v = input.value.trim();
        const bad = field.validate ? field.validate(v) : (v ? null : ' ');
        if (bad) {
          err.textContent = bad === ' ' ? '' : bad;
          err.style.display = bad === ' ' ? 'none' : 'block';
          input.classList.add('bad');
          input.focus();
          return;
        }
        finish(v);
      };

      const okBtn = el('button', { class: 'dlg-ok' + (danger ? ' danger' : ''), onclick: submit }, confirmLabel || 'تأكيد');
      const noBtn = el('button', { class: 'dlg-cancel', onclick: () => finish(field ? null : false) }, cancelLabel || 'إلغاء');
      card.appendChild(el('div', { class: 'dlg-actions' }, [noBtn, okBtn]));

      if (input) {
        input.addEventListener('input', () => { input.classList.remove('bad'); err.style.display = 'none'; });
        input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
        setTimeout(() => input.focus(), 40);
      }
      try { if (window.I18N) window.I18N.apply(card); } catch (e) {}
    });
  }

  // Resolves to the typed string, or null if cancelled.
  const ask = (opts) => dialog(Object.assign({ field: {} }, opts, {
    field: Object.assign({}, opts.field, {
      type: opts.type, placeholder: opts.placeholder, validate: opts.validate,
    }),
  }));

  // Resolves to true / false.
  const confirmDialog = (opts) => dialog(Object.assign({}, opts, { field: null }));

  // Turns @handles and #hashtags in a piece of text into tappable spans.
  // Returns an array of nodes rather than HTML, so the text is never parsed
  // as markup - a caption is user input and must not be able to inject any.
  function richText(text, opts = {}) {
    const out = [];
    const str = String(text == null ? '' : text);
    if (!str) return out;

    // Handles are ASCII-only, matching what signup allows, so Arabic text
    // around them is left alone. The @ must not follow a word character, or
    // the domain half of an email address reads as a mention.
    const re = /(?:^|[^A-Za-z0-9_.])(@[A-Za-z0-9_](?:[A-Za-z0-9_.]{1,29})?)|(?:^|\s)(#[^\s#@]{1,60})/g;
    let last = 0, m;
    while ((m = re.exec(str)) !== null) {
      const token = m[1] || m[2];
      const at = m.index + m[0].indexOf(token);
      if (at > last) out.push(document.createTextNode(str.slice(last, at)));
      if (m[1]) {
        // Trailing dots and punctuation belong to the sentence, not the handle.
        const handle = token.slice(1).replace(/[.]+$/, '');
        out.push(el('span', {
          class: 'mention',
          onclick: (e) => {
            e.stopPropagation();
            if (opts.onMention) opts.onMention(handle);
            else go('/u/' + handle);
          },
        }, '@' + handle));
        if (handle.length !== token.length - 1) {
          out.push(document.createTextNode(token.slice(handle.length + 1)));
        }
      } else {
        // Same for hashtags: "#dance!" is the tag "dance" and an exclamation.
        const tag = token.slice(1).replace(/[!?.,:;،؟]+$/, '');
        if (!tag) { out.push(document.createTextNode(token)); last = at + token.length; continue; }
        out.push(el('span', {
          class: 'hashtag',
          onclick: (e) => {
            e.stopPropagation();
            if (opts.onHashtag) opts.onHashtag(tag);
            else go('/tag/' + encodeURIComponent(tag));
          },
        }, '#' + tag));
        if (tag.length !== token.length - 1) {
          out.push(document.createTextNode(token.slice(tag.length + 1)));
        }
      }
      last = at + token.length;
    }
    if (last < str.length) out.push(document.createTextNode(str.slice(last)));
    return out;
  }

  // Convenience: an empty state for a failed load, with a Retry button.
  function errorState(onRetry, sub) {
    return emptyState({
      icon: 'alert',
      title: 'تعذر التحميل',
      sub: sub || 'تحقق من اتصالك وحاول مرة أخرى',
      actionLabel: onRetry ? 'إعادة المحاولة' : null,
      onAction: onRetry,
      isError: true,
    });
  }

  // ── Turning a database error into something a person can act on ──
  //
  // Thirty-three places used to do `toast(e.message || 'something failed')`,
  // which shows the raw Postgres error whenever there is one. People were
  // being told things like:
  //
  //   duplicate key value violates unique constraint "follows_pkey"
  //   new row violates row-level security policy for table "messages"
  //
  // That is not an error message, it is a stack trace with a friendly font.
  // It tells the person nothing they can do, and it leaks the shape of the
  // database to anyone reading it.
  //
  // Known cases are translated. Anything unrecognised falls back to the
  // caller's own wording — never to the raw text.
  function friendlyError(e, fallback) {
    const generic = fallback || 'حدث خطأ، حاول مرة أخرى';
    if (!e) return generic;

    const code = e.code || '';
    const raw = String(e.message || '');

    // Rate limits (0050) raise their own sentence. Matched on the shape
    // rather than the exact text so a reworded limit still lands here.
    if (/too many/i.test(raw)) {
      if (/follow/i.test(raw))   return 'تتابع بسرعة كبيرة، انتظر قليلًا';
      if (/comment/i.test(raw))  return 'تعلّق بسرعة كبيرة، انتظر قليلًا';
      if (/message/i.test(raw))  return 'ترسل بسرعة كبيرة، انتظر قليلًا';
      if (/report/i.test(raw))   return 'أرسلت بلاغات كثيرة، حاول لاحقًا';
      if (/broadcast/i.test(raw)) return 'بدأت بثوثًا كثيرة، حاول لاحقًا';
      return 'تجاوزت الحد المسموح، انتظر قليلًا';
    }

    switch (code) {
      case '23505': return 'تم هذا الإجراء بالفعل';       // duplicate key
      case '23503': return 'العنصر لم يعد موجودًا';        // missing reference
      case '23514': return 'قيمة غير صالحة';               // check constraint
      case '42501': return 'ليس لديك صلاحية لهذا الإجراء'; // insufficient privilege
      case 'PGRST301': return 'انتهت الجلسة، سجّل الدخول مرة أخرى';
      default: break;
    }

    // Row Level Security refusals arrive with varying codes but a stable
    // phrase. This is the app's authorization boundary, so it is worth
    // naming clearly rather than lumping in with "something went wrong".
    if (/row-level security|violates row level/i.test(raw)) {
      return 'ليس لديك صلاحية لهذا الإجراء';
    }
    if (/not signed in|JWT|not authenticated/i.test(raw)) {
      return 'سجّل الدخول للمتابعة';
    }
    if (/Failed to fetch|NetworkError|network/i.test(raw)) {
      return 'تحقق من اتصالك بالإنترنت';
    }

    // Anything already written in Arabic came from our own code and is
    // meant for the person, so it passes through.
    if (/[؀-ۿ]/.test(raw)) return raw;

    // Unrecognised: log it for us, show the caller's wording to them.
    try { console.warn('unmapped error:', code, raw); } catch (err) {}
    return generic;
  }

  return { el, esc, safeUrl, fmt, go, back, toast, haptic, modal, ask, confirmDialog, richText, icons, svg, bottomNav, hideNav, topBar, avatar, emptyState, errorState, friendlyError };
})();
