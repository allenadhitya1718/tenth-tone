/* === FLYP admin v2 - UI ===
 *
 * Hash-routed single page for the NEW backend (Mumbai). Plain DOM, no build
 * step, nothing shared with the old panel (web/admin.html + web/js/admin.js),
 * which keeps working against the old project.
 *
 * All text from the database is put on the page with textContent, never as
 * HTML, and media URLs are only used when they are https.
 */
(function () {
  const API = window.AdminV2API;
  const root = document.getElementById('app');

  // ---------- language ----------
  let LANG = 'ar';
  try { LANG = localStorage.getItem('flyp-admin-v2-lang') === 'en' ? 'en' : 'ar'; } catch (e) { /* private mode */ }
  const L = (en, ar) => (LANG === 'ar' ? ar : en);
  function applyLang() {
    document.documentElement.lang = LANG;
    document.documentElement.dir = LANG === 'ar' ? 'rtl' : 'ltr';
  }
  function setLang(l) {
    LANG = l;
    try { localStorage.setItem('flyp-admin-v2-lang', l); } catch (e) { /* ignore */ }
    applyLang();
    render();
  }
  applyLang();

  // ---------- DOM helpers ----------
  function h(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
        else n.setAttribute(k, v === true ? '' : String(v));
      }
    }
    (Array.isArray(children) ? children : children == null ? [] : [children]).forEach((c) => {
      if (c == null || c === false) return;
      n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return n;
  }
  function safeUrl(u) {
    try { const x = new URL(String(u || '')); return x.protocol === 'https:' ? x.href : null; } catch (e) { return null; }
  }
  const nf = () => new Intl.NumberFormat(LANG === 'ar' ? 'ar-SA' : 'en-GB');
  const num = (n) => nf().format(Number(n || 0));
  function when(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleString(LANG === 'ar' ? 'ar-SA' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  }
  function ago(iso) {
    if (!iso) return '-';
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(LANG, { numeric: 'auto' });
    const abs = Math.abs(s);
    if (abs < 60) return rtf.format(-s, 'second');
    if (abs < 3600) return rtf.format(-Math.round(s / 60), 'minute');
    if (abs < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
    return rtf.format(-Math.round(s / 86400), 'day');
  }
  function bytes(b) {
    b = Number(b || 0);
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return (i ? b.toFixed(1) : b) + ' ' + u[i];
  }
  function toast(msg, bad) {
    const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status', text: msg });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  function errText(e) {
    if (!e) return L('Something went wrong', 'حدث خطأ');
    if (e.message === 'MIGRATION_MISSING') {
      return L('The database is missing migration 0128_admin_v2.sql. Apply it in the Supabase SQL editor (Mumbai project).',
        'قاعدة البيانات تفتقد الترحيل 0128_admin_v2.sql. طبّقه في محرر SQL لمشروع Mumbai.');
    }
    if (e.message === 'NOT_ADMIN') return L('This account is not an admin.', 'هذا الحساب ليس مشرفًا.');
    return e.message || String(e);
  }
  // ---------- icons (inline SVG, one stroke weight; static strings only) ----------
  const ICONS = {
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
    gauge: '<path d="M4.2 16.5a8 8 0 1 1 15.6 0"/><path d="M12 15l3.6-4.6"/><circle cx="12" cy="15.2" r="1.3"/><path d="M5 20h14"/>',
    flag: '<path d="M5.5 21V4"/><path d="M5.5 4.5h11.5l-2.2 4 2.2 4H5.5"/>',
    scan: '<path d="M4 8.5V6.5A2.5 2.5 0 0 1 6.5 4h2M15.5 4h2A2.5 2.5 0 0 1 20 6.5v2M20 15.5v2a2.5 2.5 0 0 1-2.5 2.5h-2M8.5 20h-2A2.5 2.5 0 0 1 4 17.5v-2"/><path d="M12 7.8l1.3 2.9 2.9 1.3-2.9 1.3-1.3 2.9-1.3-2.9-2.9-1.3 2.9-1.3z"/>',
    film: '<rect x="3" y="5" width="18" height="14" rx="3.5"/><path d="M10.2 9.3v5.4l4.6-2.7z"/>',
    story: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="3.2 2.4"/><circle cx="12" cy="12" r="3.8"/>',
    live: '<circle cx="12" cy="12" r="2"/><path d="M8.6 15.4a4.8 4.8 0 0 1 0-6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8M5.7 18.3a8.9 8.9 0 0 1 0-12.6M18.3 5.7a8.9 8.9 0 0 1 0 12.6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.7a3.5 3.5 0 0 1 0 6.6M18.2 14.3A6.5 6.5 0 0 1 21.5 20"/>',
    chat: '<path d="M20 11.5a8 8 0 0 1-11.7 7.1L4 19.8l1.1-4A8 8 0 1 1 20 11.5z"/><path d="M8.8 10.5h6.4M8.8 13.6h4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4.5h6V7"/>',
    download: '<path d="M12 4v10.5M7.6 10.2 12 14.6l4.4-4.4"/><path d="M4 15.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.5"/>',
    coins: '<ellipse cx="9" cy="7" rx="6" ry="2.8"/><path d="M3 7v4c0 1.6 2.7 2.8 6 2.8s6-1.2 6-2.8V7"/><path d="M9 13.8V17c0 1.6 2.7 2.8 6 2.8s6-1.2 6-2.8v-4c0-1.5-2.3-2.7-5.2-2.8"/>',
    database: '<ellipse cx="12" cy="6" rx="7.5" ry="2.8"/><path d="M4.5 6v6c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8V6M4.5 12v6c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8v-6"/>',
    log: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 3.5h6V6H9zM9 10.5h6M9 14h6M9 17.5h3.5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    bell: '<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2.3 2.3 0 0 0 4 0"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.6 3.4 5.4 3.4 8.5s-1 5.9-3.4 8.5c-2.4-2.6-3.4-5.4-3.4-8.5s1-5.9 3.4-8.5z"/>',
    chevL: '<path d="M14.5 6l-6 6 6 6"/>',
    chevR: '<path d="M9.5 6l6 6-6 6"/>',
    chevUD: '<path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    warn: '<path d="M10.3 4.4 2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 16.8v.1"/>',
    up: '<path d="M7 17 17 7M9.5 7H17v7.5"/>',
    down: '<path d="M7 7l10 10M17 9.5V17H9.5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    logout: '<path d="M14.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3.5M10 16l-4-4 4-4M6 12h10"/>',
    refresh: '<path d="M19.5 11A7.6 7.6 0 0 0 6 7.2L4.5 9M4.5 4.5V9H9M4.5 13A7.6 7.6 0 0 0 18 16.8l1.5-1.8M19.5 19.5V15H15"/>',
    inbox: '<path d="M3.5 13.5 6.1 6.3A2 2 0 0 1 8 5h8a2 2 0 0 1 1.9 1.3l2.6 7.2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M3.5 13.5H8l1.5 2.5h5l1.5-2.5h4.5"/>',
    shield: '<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/>',
    userPlus: '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z"/><circle cx="12" cy="10" r="2.3"/>',
    hourglass: '<path d="M7 3.5h10M7 20.5h10M8 3.5v3a4 4 0 0 0 1.6 3.2L12 12l2.4-2.3A4 4 0 0 0 16 6.5v-3M8 20.5v-3a4 4 0 0 1 1.6-3.2L12 12l2.4 2.3a4 4 0 0 1 1.6 3.2v3"/>',
    eyeOff: '<path d="M3.5 3.5l17 17M10.6 6.1A9.6 9.6 0 0 1 12 6c5 0 8.5 4.5 9.5 6-.5.8-1.6 2.3-3.2 3.6M6.4 7.9C4.6 9.2 3.2 11 2.5 12c1 1.5 4.5 6 9.5 6 1.6 0 3-.4 4.3-1M9.9 10a3 3 0 0 0 4.1 4.2"/>',
    gift: '<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7M12 8v12.5M12 8S10.5 3.5 8 4.5 9 8 12 8zM12 8s1.5-4.5 4-3.5S15 8 12 8z"/>',
    arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M4 7l8 6 8-6"/>',
    collapse: '<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M9.5 4v16M15.5 10l-2 2 2 2"/>',
    bank: '<path d="M3.5 9.5 12 4l8.5 5.5M5 20h14M3.5 20.5h17"/><path d="M6 10.5V17M10 10.5V17M14 10.5V17M18 10.5V17"/>',
    idcard: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16a3.2 3.2 0 0 1 6 0M14 10h4M14 13.5h3"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
    pause: '<circle cx="12" cy="12" r="8.5"/><path d="M10 9v6M14 9v6"/>',
    diamond: '<path d="M6.5 4.5h11L21 9.5l-9 10-9-10z"/><path d="M3 9.5h18M9.5 4.5 8 9.5l4 10 4-10-1.5-5"/>',
  };
  const FLIP = { chevL: 1, chevR: 1, arrowR: 1, collapse: 1, logout: 1 };
  function icon(name, cls) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    s.setAttribute('class', 'ic' + (FLIP[name] ? ' flip' : '') + (cls ? ' ' + cls : ''));
    s.innerHTML = ICONS[name] || '';
    return s;
  }
  function tile(name, tone) { return h('span', { class: 'tile' + (tone ? ' ' + tone : '') }, icon(name)); }
  // FLYP mark: a small waveform in a rounded tile (drawn, so it works on any ground).
  function brandMark(cls) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 40 40');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', 'mark' + (cls ? ' ' + cls : ''));
    s.innerHTML = '<rect width="40" height="40" rx="11" fill="#1e56d6"/><g stroke="#fff" stroke-width="2.6" stroke-linecap="round">'
      + '<path d="M10 17.5v5"/><path d="M15 13v14"/><path d="M20 9.5v21"/><path d="M25 14v12"/><path d="M30 17.5v5"/></g>';
    return s;
  }

  function errorBox(e) { return h('div', { class: 'notice bad', role: 'alert' }, [icon('warn'), h('span', { text: errText(e) })]); }
  function loading() {
    return h('div', { class: 'skel', role: 'status', 'aria-live': 'polite' }, [
      h('span', { class: 'sr', text: L('Loading...', 'جارٍ التحميل...') }),
      h('i', { class: 'sk w60' }), h('i', { class: 'sk w90' }), h('i', { class: 'sk w75' }), h('i', { class: 'sk w40' }),
    ]);
  }
  function empty(msg) {
    return h('div', { class: 'empty' }, [h('span', { class: 'empty-ic' }, icon('inbox')), h('p', { text: msg || L('Nothing here.', 'لا يوجد شيء هنا.') })]);
  }
  // Search field with a leading icon; the input itself is unchanged.
  function searchBox(input) { return h('label', { class: 'search' }, [icon('search'), input]); }
  // Count pill next to a page title (set after a list loads).
  function setCount(el, n) { if (!el) return; el.textContent = n == null ? '' : num(n); el.hidden = n == null; }

  function btn(label, onClick, kind) {
    const b = h('button', { type: 'button', class: 'btn' + (kind ? ' ' + kind : '') }, label);
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (b.disabled) return;
      b.disabled = true;
      try { await onClick(ev); } catch (e) { toast(errText(e), true); } finally { b.disabled = false; }
    });
    return b;
  }
  // Status words stored in English in the database, shown in the panel language.
  const WORDS = () => ({
    pending: L('pending', 'معلّق'), resolved: L('resolved', 'تمت المعالجة'), dismissed: L('dismissed', 'مرفوض'),
    reviewed: L('reviewed', 'تمت المراجعة'), open: L('open', 'مفتوحة'), in_progress: L('in progress', 'قيد المعالجة'),
    closed: L('closed', 'مغلقة'), live: L('live', 'مباشر'), ended: L('ended', 'منتهي'), banned: L('force-ended', 'أُنهي إداريًا'),
    ready: L('ready', 'جاهز'), failed: L('failed', 'فشل'), credited: L('credited', 'مضاف'), rejected: L('rejected', 'مرفوض'),
    pending_over_1h: L('pending > 1 h', 'معلّق > ساعة'), followers: L('followers', 'المتابعون'),
    requested: L('requested', 'مطلوب'), approved: L('approved', 'مقبول'), paid: L('paid', 'مدفوع'),
    cancelled: L('cancelled', 'ملغى'), available: L('available', 'متاح'), withheld: L('withheld', 'محجوز'),
    reversed: L('reversed', 'مُلغى نهائيًا'), withdrawn: L('withdrawn', 'مسحوب'),
    close_friends: L('close friends', 'الأصدقاء المقربون'), everyone: L('everyone', 'الجميع'),
    bug: L('bug', 'خلل'), account: L('account', 'الحساب'), payment: L('payment', 'الدفع'),
    content: L('content', 'المحتوى'), safety: L('safety', 'الأمان'), other: L('other', 'أخرى'),
    public: L('public', 'عام'), friends: L('friends', 'الأصدقاء'), private: L('private', 'خاص'),
  });
  function badge(text, tone) { return h('span', { class: 'badge ' + (tone || '') }, WORDS()[text] || text); }
  function avatar(url, name) {
    const s = safeUrl(url);
    if (s) return h('img', { class: 'av', src: s, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    return h('span', { class: 'av fallback' }, String(name || '?').trim().charAt(0).toUpperCase() || '?');
  }
  function userLink(id, handle, name) {
    if (!id) return h('span', { class: 'muted' }, L('(deleted)', '(محذوف)'));
    return h('a', { href: '#/users?id=' + encodeURIComponent(id), class: 'ulink' }, [
      handle ? '@' + handle : (name || id.slice(0, 8)),
    ]);
  }
  function media(url, kind, poster) {
    const s = safeUrl(url);
    if (!s) return h('div', { class: 'media none' }, L('no media', 'لا وسائط'));
    const isVideo = kind === 'video' || /\.(mp4|mov|m4v|webm)(\?|$)/i.test(s);
    if (isVideo) {
      return h('video', { class: 'media', src: s, poster: safeUrl(poster) || undefined, controls: true, preload: 'none', playsinline: true });
    }
    return h('img', { class: 'media', src: s, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  }

  // ---------- dialogs ----------
  // An action's value() returns KEEP to leave the dialog open (failed validation).
  const KEEP = {};
  // opts.drawer: slide-over panel from the inline-end edge (details); default
  // is a centred dialog (confirmations and short forms).
  function modal(title, body, actions, opts) {
    const drawer = !!(opts && opts.drawer);
    return new Promise((resolve) => {
      const before = document.activeElement;
      const bd = h('div', { class: 'backdrop' + (drawer ? ' drawer-bd' : '') });
      const close = (v) => {
        bd.remove(); document.removeEventListener('keydown', onKey); resolve(v);
        if (before && before.isConnected && before.focus) before.focus();
      };
      const onKey = (e) => {
        if (e.key === 'Escape') close(null);
        if (e.key === 'Tab' && bd.isConnected) { // keep focus inside the dialog
          const f = [...box.querySelectorAll('a[href], button:not([disabled]), input, textarea, select, video, [tabindex="0"]')].filter((x) => x.offsetParent !== null);
          if (!f.length) return;
          if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
        }
      };
      document.addEventListener('keydown', onKey);
      const foot = h('div', { class: 'm-foot' });
      (actions || [{ label: L('Close', 'إغلاق'), value: null }]).forEach((a) => {
        foot.appendChild(h('button', { type: 'button', class: 'btn ' + (a.kind || ''), onclick: () => {
          const v = typeof a.value === 'function' ? a.value() : a.value;
          if (v !== KEEP) close(v); // KEEP: the form showed its own error
        } }, a.label));
      });
      const tid = 'm' + Math.random().toString(36).slice(2, 8);
      const x = h('button', { type: 'button', class: 'x', 'aria-label': L('Close', 'إغلاق'), onclick: () => close(null) }, icon('x'));
      const box = h('div', { class: 'modal' + (drawer ? ' drawer' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': tid }, [
        h('div', { class: 'm-head' }, [h('h3', { id: tid, text: title }), x]),
        h('div', { class: 'm-body' }, body),
        foot,
      ]);
      bd.addEventListener('click', (e) => { if (e.target === bd) close(null); });
      bd.appendChild(box);
      document.body.appendChild(bd);
      const f = box.querySelector('input, textarea, select');
      if (f) f.focus(); else x.focus();
    });
  }
  function confirmBox(title, message, okLabel, danger) {
    return modal(title, h('p', { text: message }), [
      { label: L('Cancel', 'إلغاء'), value: false },
      { label: okLabel || L('Confirm', 'تأكيد'), value: true, kind: danger ? 'danger' : 'primary' },
    ]);
  }
  function askText(title, label, initial, multiline) {
    const input = multiline
      ? h('textarea', { rows: 5, class: 'input' })
      : h('input', { type: 'text', class: 'input' });
    input.value = initial || '';
    return modal(title, [h('label', { class: 'lbl', text: label }), input], [
      { label: L('Cancel', 'إلغاء'), value: null },
      { label: L('OK', 'موافق'), value: () => input.value, kind: 'primary' },
    ]);
  }
  async function askBan() {
    const sel = h('select', { class: 'input' }, [
      h('option', { value: '1' }, L('1 day', 'يوم واحد')),
      h('option', { value: '7' }, L('7 days', '7 أيام')),
      h('option', { value: '30' }, L('30 days', '30 يومًا')),
      h('option', { value: '36500' }, L('Permanent', 'دائم')),
    ]);
    sel.value = '7';
    const reason = h('input', { type: 'text', class: 'input', placeholder: L('Reason (kept in the audit log)', 'السبب (يُحفظ في سجل الأنشطة)') });
    const v = await modal(L('Ban account', 'حظر الحساب'), [
      h('label', { class: 'lbl', text: L('Duration', 'المدة') }), sel,
      h('label', { class: 'lbl', text: L('Reason', 'السبب') }), reason,
      h('p', { class: 'muted small', text: L('A banned account cannot post or go live, and any live it is hosting is ended.', 'لا يستطيع الحساب المحظور النشر أو البث، ويُنهى أي بث يستضيفه.') }),
    ], [
      { label: L('Cancel', 'إلغاء'), value: null },
      { label: L('Ban', 'حظر'), value: () => ({ days: Number(sel.value), reason: reason.value.trim() }), kind: 'danger' },
    ]);
    if (!v) return null;
    return { until: new Date(Date.now() + v.days * 86400000).toISOString(), reason: v.reason };
  }

  // ---------- shell ----------
  let ME = null;
  let COUNTS = {};
  const NAV = [
    { sec: () => L('Overview', 'نظرة عامة'), items: [
      { k: 'dashboard', i: 'grid', l: () => L('Dashboard', 'الرئيسية') },
      { k: 'usage', i: 'gauge', l: () => L('Usage & billing', 'الاستخدام والفوترة'), badge: 'usage_open' },
    ] },
    { sec: () => L('Moderation', 'الإشراف'), items: [
      { k: 'reports', i: 'flag', l: () => L('Reports', 'البلاغات'), badge: 'open_reports' },
      { k: 'moderation', i: 'scan', l: () => L('AI screening log', 'سجل الفحص الآلي') },
      { k: 'videos', i: 'film', l: () => L('Videos', 'الفيديوهات') },
      { k: 'stories', i: 'story', l: () => L('Stories', 'القصص'), badge: 'reported_stories' },
      { k: 'live', i: 'live', l: () => L('Live streams', 'البث المباشر'), badge: 'live_now' },
    ] },
    { sec: () => L('People', 'الأشخاص'), items: [
      { k: 'users', i: 'users', l: () => L('Users', 'المستخدمون') },
      { k: 'tickets', i: 'chat', l: () => L('Support tickets', 'تذاكر الدعم'), badge: 'open_tickets' },
      { k: 'deletions', i: 'trash', l: () => L('Deletion queue', 'طلبات الحذف'), badge: 'pending_deletions' },
      { k: 'exports', i: 'download', l: () => L('Data requests', 'طلبات البيانات'), badge: 'pending_exports' },
    ] },
    { sec: () => L('Money', 'المال'), items: [
      { k: 'wallet', i: 'coins', l: () => L('Coins & gifts', 'العملات والهدايا') },
      { k: 'payouts', i: 'bank', l: () => L('Payouts', 'الأرباح والسحب'), badge: 'payouts_waiting' },
      { k: 'kyc', i: 'idcard', l: () => L('Identity checks', 'التحقق من الهوية'), badge: 'kyc_pending' },
      { k: 'payout-settings', i: 'sliders', l: () => L('Payout settings', 'إعدادات الأرباح') },
    ] },
    { sec: () => L('System', 'النظام'), items: [
      { k: 'storage', i: 'database', l: () => L('Storage & limits', 'التخزين والحدود') },
      { k: 'logs', i: 'log', l: () => L('Audit log', 'سجل الأنشطة') },
    ] },
  ];
  const NAV_ITEMS = () => NAV.flatMap((g) => g.items);

  let COLLAPSED = false;
  try { COLLAPSED = localStorage.getItem('flyp-admin-v2-collapsed') === '1'; } catch (e) { /* private mode */ }

  async function signOut() { await API.signOut(); location.hash = '#/login'; render(); }

  // Small anchored menus (notifications, settings, account). One open at a time.
  let closeMenu = null;
  function popMenu(anchor, content, cls) {
    if (closeMenu) { const was = closeMenu.anchor; closeMenu(); if (was === anchor) return; }
    const m = h('div', { class: 'pop ' + (cls || ''), role: 'menu' }, content);
    anchor.parentNode.appendChild(m);
    anchor.setAttribute('aria-expanded', 'true');
    const off = (e) => { if (!m.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
    const key = (e) => { if (e.key === 'Escape') { closeMenu(); anchor.focus(); } };
    closeMenu = () => { m.remove(); anchor.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', off, true); document.removeEventListener('keydown', key); closeMenu = null; };
    closeMenu.anchor = anchor;
    setTimeout(() => { document.addEventListener('click', off, true); document.addEventListener('keydown', key); }, 0);
    const f = m.querySelector('a, button'); if (f) f.focus();
  }

  // Everything that is waiting on an admin, used by the bell and the dashboard.
  function attentionItems(extra) {
    const c = COUNTS || {};
    return [
      { n: c.open_reports, l: L('Pending reports', 'بلاغات معلّقة'), href: '#/reports', i: 'flag' },
      { n: c.ai_flags_pending, l: L('AI flags waiting', 'تنبيهات آلية بانتظار المراجعة'), href: '#/reports?type=ai', i: 'scan' },
      { n: c.reported_live, l: L('Live reports', 'بلاغات البث'), href: '#/reports?type=live', i: 'live' },
      { n: (USAGE_OPEN || []).filter((a) => Number(a.pct) >= 70).length, l: L('Usage alerts', 'تنبيهات الاستخدام'), href: '#/usage', i: 'gauge', tone: 'bad' },
      { n: c.scans_unavailable_24h, l: L('Unscanned uploads (24 h)', 'محتوى لم يُفحص (24 س)'), href: '#/moderation', i: 'eyeOff', tone: 'bad' },
      { n: c.payouts_waiting, l: L('Withdrawals waiting', 'طلبات سحب بانتظار المعالجة'), href: '#/payouts', i: 'bank' },
      { n: c.kyc_pending, l: L('Identity checks waiting', 'تحقق هوية بانتظار المراجعة'), href: '#/kyc', i: 'idcard' },
      { n: extra && extra.refundFlags, l: L('Refund flags to review', 'استردادات بانتظار المراجعة'), href: '#/wallet', i: 'coins' },
      { n: c.open_tickets, l: L('Open support tickets', 'تذاكر دعم مفتوحة'), href: '#/tickets', i: 'chat' },
      { n: c.pending_exports, l: L('Data requests', 'طلبات البيانات'), href: '#/exports', i: 'download' },
      { n: c.pending_topups, l: L('Top-ups pending', 'شحنات معلّقة'), href: '#/wallet', i: 'hourglass' },
    ].filter((x) => Number(x.n) > 0);
  }
  function bellCount() {
    const c = COUNTS || {};
    return Number(c.open_reports || 0) + Number(c.usage_open || 0) + Number(c.open_tickets || 0)
      + Number(c.payouts_waiting || 0) + Number(c.kyc_pending || 0);
  }
  function drawBell(b) {
    const n = bellCount();
    let dot = b.querySelector('.bell-n');
    b.setAttribute('aria-label', L('Notifications', 'الإشعارات') + (n ? ' (' + n + ')' : ''));
    if (!n) { if (dot) dot.remove(); return; }
    if (!dot) { dot = h('span', { class: 'bell-n' }); b.appendChild(dot); }
    dot.textContent = n > 99 ? '99+' : num(n);
  }
  function openNotifications(anchor) {
    const items = attentionItems();
    popMenu(anchor, [
      h('div', { class: 'pop-head' }, [h('strong', { text: L('Needs attention', 'يحتاج إلى متابعة') })]),
      items.length
        ? h('div', { class: 'pop-list' }, items.map((x) => h('a', { href: x.href, class: 'pop-item', role: 'menuitem', onclick: () => closeMenu && closeMenu() }, [
          tile(x.i, x.tone || 'amber'), h('span', { class: 'pi-l', text: x.l }), h('span', { class: 'pi-n', text: num(x.n) }),
        ])))
        : h('div', { class: 'pop-empty' }, [icon('check'), h('span', { text: L('All clear. Nothing is waiting.', 'لا شيء بانتظارك.') })]),
    ], 'pop-notes');
  }
  function openSettings(anchor) {
    popMenu(anchor, [
      ME ? h('div', { class: 'pop-head' }, [h('strong', { text: ME.name || ME.handle || L('Admin', 'مشرف') }), h('span', { class: 'muted small', text: ME.email || '' })]) : null,
      h('button', { type: 'button', class: 'pop-item', role: 'menuitem', onclick: () => { closeMenu && closeMenu(); setLang(LANG === 'ar' ? 'en' : 'ar'); } }, [icon('globe'), h('span', { class: 'pi-l', text: LANG === 'ar' ? 'English' : 'العربية' })]),
      h('button', { type: 'button', class: 'pop-item hide-phone', role: 'menuitem', onclick: () => { closeMenu && closeMenu(); setCollapsed(!COLLAPSED); } }, [icon('collapse'), h('span', { class: 'pi-l', text: COLLAPSED ? L('Expand sidebar', 'توسيع الشريط الجانبي') : L('Collapse sidebar', 'طي الشريط الجانبي') })]),
      h('button', { type: 'button', class: 'pop-item danger', role: 'menuitem', onclick: async () => { closeMenu && closeMenu(); await signOut(); } }, [icon('logout'), h('span', { class: 'pi-l', text: L('Sign out', 'خروج') })]),
    ], 'pop-settings');
  }
  function setCollapsed(v) {
    COLLAPSED = v;
    try { localStorage.setItem('flyp-admin-v2-collapsed', v ? '1' : '0'); } catch (e) { /* ignore */ }
    const lay = document.querySelector('.layout');
    if (lay) lay.classList.toggle('collapsed', v);
    const t = document.querySelector('.side-collapse');
    if (t) { t.setAttribute('aria-expanded', v ? 'false' : 'true'); t.setAttribute('aria-label', v ? L('Expand sidebar', 'توسيع الشريط الجانبي') : L('Collapse sidebar', 'طي الشريط الجانبي')); }
  }

  function shell(active, content) {
    const nav = h('nav', { class: 'side-nav', 'aria-label': L('Sections', 'الأقسام') });
    const groups = [];
    NAV.forEach((g) => {
      const list = h('div', { class: 'grp' }, [h('div', { class: 'sec', text: g.sec() })]);
      g.items.forEach((it) => {
        const n = Number(COUNTS[it.badge] || 0);
        list.appendChild(h('a', { href: '#/' + it.k, class: 'nav' + (active === it.k ? ' on' : ''), 'aria-current': active === it.k ? 'page' : null, 'data-tip': it.l() }, [
          icon(it.i),
          h('span', { class: 'nl', text: it.l() }),
          it.badge && n ? h('span', { class: 'nb', text: n > 99 ? '99+' : String(n) }) : null,
        ]));
      });
      groups.push(list);
      nav.appendChild(list);
    });

    // Sidebar search: filters the sections; Enter looks the text up as a user.
    const q = h('input', { type: 'search', class: 'side-q', placeholder: L('Search sections or users', 'ابحث في الأقسام أو المستخدمين'), 'aria-label': L('Search sections or users', 'ابحث في الأقسام أو المستخدمين') });
    q.addEventListener('input', () => {
      const t = q.value.trim().toLowerCase();
      groups.forEach((g) => {
        let any = false;
        g.querySelectorAll('a.nav').forEach((a) => { const hit = !t || a.textContent.toLowerCase().includes(t); a.hidden = !hit; any = any || hit; });
        g.hidden = !any;
      });
    });
    q.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const t = q.value.trim();
      const first = nav.querySelector('a.nav:not([hidden])');
      if (!t) return;
      if (first && t.length < 3) location.hash = first.getAttribute('href');
      else location.hash = '#/users?q=' + encodeURIComponent(t);
    });

    const collapseBtn = h('button', { type: 'button', class: 'side-collapse', 'aria-expanded': COLLAPSED ? 'false' : 'true', 'aria-label': COLLAPSED ? L('Expand sidebar', 'توسيع الشريط الجانبي') : L('Collapse sidebar', 'طي الشريط الجانبي'), onclick: () => setCollapsed(!COLLAPSED) }, icon('chevL'));
    const meName = (ME && (ME.name || ME.handle)) || L('Admin', 'مشرف');
    const userBtn = h('button', { type: 'button', class: 'me', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: (e) => openSettings(e.currentTarget) }, [
      avatar(ME && ME.avatar, ME && (ME.name || ME.email)),
      h('span', { class: 'me-t' }, [h('span', { class: 'me-n', text: meName }), h('span', { class: 'me-r', text: L('Administrator', 'مشرف') })]),
      icon('chevUD', 'me-c'),
    ]);
    // Collapsed rail: the label shows as a tooltip on hover and keyboard focus.
    let tip = null;
    const hideTip = () => { if (tip) { tip.remove(); tip = null; } };
    const showTip = (e) => {
      const a = e.target.closest && e.target.closest('a.nav');
      hideTip();
      if (!a || !COLLAPSED || window.matchMedia('(max-width: 900px)').matches) return;
      const r = a.getBoundingClientRect();
      tip = h('div', { class: 'rail-tip', role: 'tooltip', text: a.getAttribute('data-tip') });
      tip.style.top = (r.top + r.height / 2) + 'px';
      if (document.documentElement.dir === 'rtl') tip.style.right = (window.innerWidth - r.left + 12) + 'px';
      else tip.style.left = (r.right + 12) + 'px';
      document.body.appendChild(tip);
    };
    nav.addEventListener('mouseover', showTip);
    nav.addEventListener('focusin', showTip);
    nav.addEventListener('mouseleave', hideTip);
    nav.addEventListener('focusout', hideTip);
    nav.addEventListener('scroll', hideTip, { passive: true });
    window.addEventListener('hashchange', hideTip, { once: true });
    const side = h('aside', { class: 'side', id: 'side' }, [
      h('div', { class: 'brand' }, [
        brandMark(),
        h('div', { class: 'brand-t' }, [h('span', { class: 'tag', text: L('Admin portal', 'بوابة الإدارة') }), h('strong', { text: 'FLYP' })]),
        collapseBtn,
      ]),
      h('div', { class: 'side-search' }, [
        h('button', { type: 'button', class: 'side-q-ic', 'aria-label': L('Search', 'بحث'), onclick: () => { if (COLLAPSED) setCollapsed(false); q.focus(); } }, icon('search')),
        q,
      ]),
      nav,
      h('div', { class: 'side-foot' }, userBtn),
    ]);

    // Phone: the sidebar is an off-canvas drawer.
    const scrim = h('div', { class: 'side-scrim', onclick: () => toggleDrawer(false) });
    function toggleDrawer(open) {
      side.classList.toggle('open', open);
      scrim.classList.toggle('open', open);
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { const a = side.querySelector('a.nav.on') || side.querySelector('a.nav'); if (a) a.focus(); }
    }
    side.addEventListener('keydown', (e) => { if (e.key === 'Escape' && side.classList.contains('open')) { toggleDrawer(false); menuBtn.focus(); } });
    const menuBtn = h('button', { type: 'button', class: 'icon-btn menu-btn', 'aria-controls': 'side', 'aria-expanded': 'false', 'aria-label': L('Open menu', 'فتح القائمة'), onclick: () => toggleDrawer(!side.classList.contains('open')) }, icon('menu'));

    const cur = NAV_ITEMS().find((x) => x.k === active);
    const bell = h('button', { type: 'button', class: 'icon-btn dark', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: (e) => openNotifications(e.currentTarget) }, icon('bell'));
    drawBell(bell);
    const top = h('header', { class: 'top' }, [
      menuBtn,
      h('nav', { class: 'crumbs', 'aria-label': L('Breadcrumb', 'مسار التنقل') }, [
        h('a', { href: '#/dashboard', text: L('FLYP Admin', 'إدارة FLYP') }),
        icon('chevR'),
        h('span', { 'aria-current': 'page', text: cur ? cur.l() : '' }),
      ]),
      h('div', { class: 'top-actions' }, [
        h('button', { type: 'button', class: 'lang-pill', lang: LANG === 'ar' ? 'en' : 'ar', onclick: () => setLang(LANG === 'ar' ? 'en' : 'ar') }, LANG === 'ar' ? 'English' : 'العربية'),
        h('div', { class: 'pop-anchor' }, bell),
        h('div', { class: 'pop-anchor' }, h('button', { type: 'button', class: 'icon-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': L('Settings', 'الإعدادات'), onclick: (e) => openSettings(e.currentTarget) }, icon('gear'))),
      ]),
    ]);
    return h('div', { class: 'layout' + (COLLAPSED ? ' collapsed' : '') }, [
      h('a', { href: '#main', class: 'skip', text: L('Skip to content', 'تخطَّ إلى المحتوى'), onclick: (e) => { e.preventDefault(); const m = document.getElementById('main'); if (m) m.focus(); } }),
      side, scrim,
      h('main', { class: 'main', id: 'main', tabindex: '-1' }, [top, usageBanner(), h('div', { class: 'page' }, content)]),
    ]);
  }
  // Page title, optional count pill (filled in by setCount once a list loads),
  // muted subline and actions on the right.
  function header(title, sub, right, withCount) {
    const cnt = withCount ? h('span', { class: 'ph-count', hidden: true }) : null;
    const el = h('div', { class: 'ph' }, [
      h('div', { class: 'ph-t' }, [h('h1', {}, [title, cnt]), sub ? h('p', { class: 'ph-sub', text: sub }) : null]),
      right ? h('div', { class: 'ph-right' }, right) : null,
    ]);
    el.count = cnt;
    return el;
  }
  function tabs(options, value, onChange) {
    const w = h('div', { class: 'tabs', role: 'tablist' });
    options.forEach(([v, label]) => {
      w.appendChild(h('button', { type: 'button', role: 'tab', 'aria-selected': v === value ? 'true' : 'false', class: v === value ? 'on' : '', onclick: () => onChange(v) }, label));
    });
    return w;
  }
  async function refreshCounts() {
    const [c, u, pc] = await Promise.all([API.counts().catch(() => ({})), API.usageOpenAlerts(), API.payoutCounts()]);
    COUNTS = Object.assign(c || {}, pc);
    USAGE_OPEN = u;
    COUNTS.usage_open = u.length;
    document.querySelectorAll('.ubanner-slot').forEach(drawUsageBanner);
    document.querySelectorAll('.side a.nav').forEach((a) => {
      const k = a.getAttribute('href').slice(2);
      const it = NAV_ITEMS().find((x) => x.k === k);
      if (!it || !it.badge) return;
      let b = a.querySelector('.nb');
      const n = Number(COUNTS[it.badge] || 0);
      if (!n) { if (b) b.remove(); return; }
      if (!b) { b = h('span', { class: 'nb' }); a.appendChild(b); }
      b.textContent = n > 99 ? '99+' : String(n);
    });
    document.querySelectorAll('.top .icon-btn.dark').forEach(drawBell);
  }

  // ---------- login ----------
  function viewLogin(note) {
    let mode = 'password';
    const email = h('input', { type: 'email', id: 'lg-email', class: 'input', autocomplete: 'username', placeholder: 'name@flyp.app' });
    const pass = h('input', { type: 'password', id: 'lg-pass', class: 'input', autocomplete: 'current-password' });
    const code = h('input', { type: 'text', id: 'lg-code', class: 'input', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', placeholder: '000000' });
    const err = h('div', { class: 'notice bad', role: 'alert', hidden: true });
    const info = h('div', { class: 'notice', role: 'status', hidden: true });
    const box = h('div', { class: 'fields' });
    let otpSent = false;
    const field = (id, label, input) => h('div', { class: 'field' }, [h('label', { for: id, text: label }), input]);
    const fEmail = field('lg-email', L('Work email', 'البريد الإلكتروني'), email);
    const fPass = field('lg-pass', L('Password', 'كلمة المرور'), pass);
    const fCode = field('lg-code', L('6-digit code', 'الرمز المكوّن من 6 أرقام'), code);

    function showErr(e) { err.textContent = typeof e === 'string' ? e : (/Invalid login/i.test((e && e.message) || '') ? L('Wrong email or password.', 'البريد أو كلمة المرور غير صحيحة.') : errText(e)); err.hidden = false; }

    async function afterSignIn() {
      let ok = false;
      try { ok = await API.isAdmin(); } catch (e) { ok = false; }
      if (!ok) {
        await API.signOut();
        showErr(L('This account is not an admin on the new backend. Access refused.', 'هذا الحساب ليس مشرفًا على الخادم الجديد. تم رفض الدخول.'));
        return;
      }
      location.hash = '#/dashboard';
      render();
    }

    const submit = btn(L('Sign in', 'تسجيل الدخول'), async () => {
      err.hidden = true;
      const em = email.value.trim();
      if (!em) return showErr(L('Enter your email.', 'أدخل بريدك الإلكتروني.'));
      try {
        if (mode === 'password') {
          await API.signInPassword(em, pass.value);
          await afterSignIn();
        } else if (!otpSent) {
          await API.sendOtp(em);
          otpSent = true;
          info.textContent = L('If this email has an account, a 6-digit code is on its way.', 'إذا كان لهذا البريد حساب فسيصلك رمز من 6 أرقام.');
          info.hidden = false;
          draw();
        } else {
          await API.verifyOtp(em, code.value.trim());
          await afterSignIn();
        }
      } catch (e) { showErr(e); }
    }, 'navy wide');

    function draw() {
      box.innerHTML = '';
      box.appendChild(fEmail);
      if (mode === 'password') box.appendChild(fPass);
      if (mode === 'otp' && otpSent) box.appendChild(fCode);
      submit.textContent = mode === 'password' ? L('Sign in', 'تسجيل الدخول') : otpSent ? L('Verify code', 'تحقق من الرمز') : L('Email me a code', 'أرسل لي رمزًا');
    }
    const modeTabs = tabs([['password', L('Password', 'كلمة المرور')], ['otp', L('Email code', 'رمز بالبريد')]], mode, (v) => {
      mode = v; otpSent = false; info.hidden = true; err.hidden = true;
      modeTabs.querySelectorAll('button').forEach((b, i) => { const on = (i === 0) === (v === 'password'); b.className = on ? 'on' : ''; b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      draw();
    });
    modeTabs.classList.add('full');
    draw();
    const form = h('form', { class: 'login-card', novalidate: true, onsubmit: (e) => { e.preventDefault(); submit.click(); } }, [
      h('div', { class: 'wordmark' }, [brandMark(), h('span', { text: 'FLYP' }), h('em', { text: L('Admin', 'الإدارة') })]),
      h('h1', { text: L('Admin portal', 'بوابة الإدارة') }),
      h('p', { class: 'login-sub', text: L('New app backend (Mumbai). Admin accounts only.', 'خادم التطبيق الجديد (Mumbai). لحسابات المشرفين فقط.') }),
      note ? h('div', { class: 'notice bad', role: 'alert', text: note }) : null,
      modeTabs, box, err, info, submit,
      h('button', { type: 'submit', hidden: true }),
      h('div', { class: 'login-foot' }, [
        h('span', { class: 'muted small', text: L('Sessions stay on this device. Sign out on shared computers.', 'تبقى الجلسة على هذا الجهاز. سجّل الخروج على الأجهزة المشتركة.') }),
        h('button', { type: 'button', class: 'linkish', lang: LANG === 'ar' ? 'en' : 'ar', onclick: () => setLang(LANG === 'ar' ? 'en' : 'ar') }, LANG === 'ar' ? 'English' : 'العربية'),
      ]),
    ]);
    return h('div', { class: 'login' }, [h('div', { class: 'login-glow', 'aria-hidden': 'true' }), form]);
  }

  // ---------- dashboard ----------
  // stat(label, value, href, tone, icon, caption) - tone: '' | 'warn' | 'bad'
  function stat(label, value, href, tone, ic, caption) {
    const inner = [
      ic ? tile(ic, tone === 'bad' ? 'red' : tone === 'warn' ? 'amber' : '') : null,
      h('div', { class: 'sl', text: label }),
      // value: a number, or { text } when already formatted (money).
      h('div', { class: 'sv' + (value && typeof value === 'object' ? ' sm' : ''), text: value && typeof value === 'object' ? value.text : num(value) }),
      caption ? h('div', { class: 'sc', text: caption }) : null,
      href ? icon('chevR', 'go') : null,
    ];
    return href ? h('a', { href, class: 'stat ' + (tone || '') }, inner) : h('div', { class: 'stat ' + (tone || '') }, inner);
  }
  function delta(cur, prev) {
    cur = Number(cur || 0); prev = Number(prev || 0);
    if (!prev && !cur) return null;
    const pct = prev ? ((cur - prev) / prev) * 100 : 100;
    const up = pct >= 0;
    return h('span', { class: 'delta ' + (up ? 'up' : 'down') }, [icon(up ? 'up' : 'down'), (up ? '+' : '') + new Intl.NumberFormat(LANG === 'ar' ? 'ar-SA' : 'en-GB', { maximumFractionDigits: 1 }).format(pct) + '%']);
  }
  function viewDashboard() {
    const body = h('div', { class: 'dash' }, loading());
    (async () => {
      try {
        const c = await API.counts();
        COUNTS = Object.assign(c || {}, { usage_open: USAGE_OPEN.length });
        const [g, s, u, flags, pc] = await Promise.all([
          API.growth(14).catch(() => []),
          API.storage().catch(() => null),
          API.usageOpenAlerts(),
          API.walletFlags().catch(() => null),
          API.payoutCounts(),
        ]);
        USAGE_OPEN = u; COUNTS.usage_open = u.length;
        Object.assign(COUNTS, pc);
        body.innerHTML = '';

        // ---- hero: users + sign-ups, and what needs attention ----
        const rows = g || [];
        const last7 = rows.slice(-7).reduce((a, r) => a + Number(r.signups || 0), 0);
        const prev7 = rows.slice(-14, -7).reduce((a, r) => a + Number(r.signups || 0), 0);
        const maxS = Math.max(1, ...rows.map((r) => Number(r.signups || 0)));
        const spark = h('div', { class: 'spark', role: 'img', 'aria-label': L('Daily sign-ups, last 14 days', 'التسجيلات اليومية، آخر 14 يومًا') },
          rows.map((r, i) => h('div', { class: 'sp' + (i === rows.length - 1 ? ' now' : ''), title: r.day + ' · ' + num(r.signups) }, [
            h('i', { style: { height: Math.max(4, (Number(r.signups || 0) / maxS) * 100) + '%' } }),
            (i % 2 === rows.length % 2 || i === rows.length - 1) ? h('span', { text: String(r.day).slice(8) }) : h('span', { text: '' }),
          ])));
        const hero = h('a', { href: '#/users', class: 'card hero' }, [
          h('div', { class: 'hero-l' }, [
            h('div', { class: 'hero-top' }, [tile('users', 'blue'), icon('chevR', 'go')]),
            h('div', { class: 'sl', text: L('Registered users', 'المستخدمون المسجّلون') }),
            h('div', { class: 'hero-v', text: num(c.users_total) }),
            h('div', { class: 'hero-d' }, [delta(last7, prev7), h('span', { class: 'cap', text: L('sign-ups vs previous 7 days', 'تسجيلات مقابل 7 أيام سابقة') })]),
            h('div', { class: 'sc', text: num(c.users_today) + ' ' + L('new today', 'جديد اليوم') + ' · ' + num(c.banned_users) + ' ' + L('banned', 'محظور') }),
          ]),
          rows.length ? spark : null,
        ]);
        const items = attentionItems({ refundFlags: flags ? flags.filter((f) => !f.reviewed_at).length : 0 });
        const attn = h('section', { class: 'card attn' + (items.length ? '' : ' clear') }, [
          h('div', { class: 'attn-head' }, [tile(items.length ? 'warn' : 'check', items.length ? 'amber' : 'green'), h('div', {}, [
            h('h2', { text: L('Needs attention', 'يحتاج إلى متابعة') }),
            h('p', { class: 'sc', text: items.length ? L('Queues waiting on an admin', 'قوائم بانتظار مشرف') : L('All clear. Nothing is waiting.', 'لا شيء بانتظارك.') }),
          ])]),
          items.length ? h('ul', { class: 'attn-list' }, items.slice(0, 8).map((x) => h('li', {}, h('a', { href: x.href }, [
            h('span', { class: 'al', text: x.l }), h('span', { class: 'an' + (x.tone ? ' ' + x.tone : ''), text: num(x.n) }), icon('chevR'),
          ])))) : null,
        ]);
        body.appendChild(h('div', { class: 'dash-top' }, [hero, attn]));

        // ---- every counter, grouped like the sidebar ----
        const grp = (title, cards) => h('section', { class: 'dgroup' }, [h('h2', { class: 'dg-t', text: title }), h('div', { class: 'grid stats c' + cards.length }, cards)]);
        body.appendChild(grp(L('Moderation', 'الإشراف'), [
          stat(L('Open reports', 'بلاغات مفتوحة'), c.open_reports, '#/reports', c.open_reports ? 'warn' : '', 'flag'),
          stat(L('AI flags waiting', 'تنبيهات آلية بانتظار المراجعة'), c.ai_flags_pending, '#/reports?type=ai', '', 'scan'),
          stat(L('Reported stories', 'قصص مُبلّغ عنها'), c.reported_stories, '#/reports?type=story', '', 'story'),
          stat(L('Live reports', 'بلاغات البث'), c.reported_live, '#/reports?type=live', '', 'live'),
          stat(L('Unscanned uploads (24 h)', 'محتوى لم يُفحص (24 س)'), c.scans_unavailable_24h, '#/moderation', c.scans_unavailable_24h ? 'bad' : '', 'eyeOff'),
          stat(L('Blocked by AI (24 h)', 'محظور آليًا (24 س)'), c.content_blocked_24h, '#/moderation', '', 'shield'),
        ]));
        body.appendChild(grp(L('Content & people', 'المحتوى والأشخاص'), [
          stat(L('Live now', 'بث الآن'), c.live_now, '#/live', '', 'live'),
          stat(L('Published videos', 'فيديوهات منشورة'), c.videos_total, '#/videos', '', 'film'),
          stat(L('Active stories', 'قصص نشطة'), c.active_stories, '#/stories', '', 'story'),
          stat(L('New users today', 'مستخدمون جدد اليوم'), c.users_today, null, '', 'userPlus'),
          stat(L('Banned accounts', 'حسابات محظورة'), c.banned_users, '#/users?status=banned', '', 'shield'),
          stat(L('Sharing location now', 'يشاركون موقعهم الآن'), c.location_sharers, null, '', 'pin'),
        ]));
        body.appendChild(grp(L('Requests & money', 'الطلبات والمال'), [
          stat(L('Support tickets open', 'تذاكر دعم مفتوحة'), c.open_tickets, '#/tickets', '', 'chat'),
          stat(L('Scheduled deletions', 'حذف مجدول'), c.pending_deletions, '#/deletions', '', 'trash'),
          stat(L('Data requests', 'طلبات البيانات'), c.pending_exports, '#/exports', '', 'download'),
          stat(L('Top-ups pending', 'شحنات معلّقة'), c.pending_topups, '#/wallet', '', 'coins'),
          pc.payouts_waiting != null ? stat(L('Withdrawals waiting', 'طلبات سحب بانتظار المعالجة'), pc.payouts_waiting, '#/payouts', pc.payouts_waiting ? 'warn' : '', 'bank') : null,
          pc.kyc_pending != null ? stat(L('Identity checks waiting', 'تحقق هوية بانتظار المراجعة'), pc.kyc_pending, '#/kyc', pc.kyc_pending ? 'warn' : '', 'idcard') : null,
        ].filter(Boolean)));

        // ---- growth chart + storage ----
        const lower = h('div', { class: 'dash-row' });
        if (g && g.length) {
          const max = Math.max(1, ...g.map((r) => Math.max(Number(r.signups), Number(r.videos))));
          const chart = h('div', { class: 'bars', role: 'img', 'aria-label': L('Daily sign-ups and videos, last 14 days', 'التسجيلات والفيديوهات اليومية، آخر 14 يومًا') });
          g.forEach((r) => {
            chart.appendChild(h('div', { class: 'bar', title: r.day + ' · ' + L('sign-ups', 'تسجيلات') + ' ' + r.signups + ' · ' + L('videos', 'فيديوهات') + ' ' + r.videos }, [
              h('div', { class: 'b1', style: { height: (Number(r.signups) / max) * 100 + '%' } }),
              h('div', { class: 'b2', style: { height: (Number(r.videos) / max) * 100 + '%' } }),
              h('span', { class: 'bl', text: String(r.day).slice(5) }),
            ]));
          });
          lower.appendChild(h('section', { class: 'card chart' }, [
            h('div', { class: 'card-head' }, [
              h('div', {}, [h('h2', { text: L('Sign-ups and videos', 'التسجيلات والفيديوهات') }), h('p', { class: 'sc', text: L('Last 14 days, per day', 'آخر 14 يومًا، لكل يوم') })]),
              h('div', { class: 'legend' }, [h('span', { class: 'k1' }, L('Sign-ups', 'التسجيلات')), h('span', { class: 'k2' }, L('Videos', 'الفيديوهات'))]),
            ]),
            chart,
          ]));
        }
        if (s) lower.appendChild(storageSummary(s));
        if (lower.childNodes.length) body.appendChild(lower);
      } catch (e) { body.innerHTML = ''; body.appendChild(errorBox(e)); }
    })();
    return [header(L('Dashboard', 'الرئيسية'), L('What needs attention on the new app.', 'ما يحتاج إلى متابعة في التطبيق الجديد.')), body];
  }
  function storageSummary(s) {
    const pct = Number(s.pct_used || 0);
    const alertBand = s.alert && Number(s.alert.last_band || 0);
    const tone = pct >= 85 ? 'bad' : pct >= 70 ? 'warn' : '';
    return h('section', { class: 'card storage-sum' }, [
      h('div', { class: 'card-head' }, [
        h('div', { class: 'ch-l' }, [tile('database', tone === 'bad' ? 'red' : tone === 'warn' ? 'amber' : ''), h('h2', { text: L('Storage', 'التخزين') })]),
        h('a', { href: '#/storage', class: 'more' }, [L('Storage & limits', 'التخزين والحدود'), icon('arrowR')]),
      ]),
      h('div', { class: 'big-pct' }, [h('strong', { text: pct + '%' }), h('span', { class: 'sc', text: bytes(s.used_bytes) + ' / ' + bytes(s.limit_bytes) })]),
      h('div', { class: 'meter' + (tone ? ' ' + tone : ''), role: 'meter', 'aria-label': L('Storage used', 'التخزين المستخدم'), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, h('div', { style: { width: Math.min(100, pct) + '%' } })),
      h('p', { class: 'sc', text: L('Uploads stop at 100%.', 'يتوقف الرفع عند 100%.') }),
      alertBand ? h('div', { class: 'notice ' + (alertBand >= 2 ? 'bad' : 'warn'), text: L('Storage alert active (band ', 'تنبيه التخزين نشط (المستوى ') + alertBand + L('/3). Uploads stop at 100%.', '/3). يتوقف الرفع عند 100%.') }) : null,
    ]);
  }

  // ---------- reports ----------
  const TYPE_LABEL = () => ({
    video: L('Video', 'فيديو'), comment: L('Comment', 'تعليق'), user: L('Account', 'حساب'),
    live_stream: L('Live stream', 'بث مباشر'), story: L('Story', 'قصة'), live_comment: L('Live comment', 'تعليق بث'),
  });
  function viewReports(q) {
    let status = q.status || 'pending';
    let type = q.type || 'all';
    const list = h('div', { class: 'list' });
    const statusTabs = h('div');
    const typeTabs = h('div');
    function drawTabs() {
      statusTabs.innerHTML = ''; typeTabs.innerHTML = '';
      statusTabs.appendChild(tabs([['pending', L('Pending', 'قيد الانتظار')], ['resolved', L('Resolved', 'تمت المعالجة')], ['dismissed', L('Dismissed', 'مرفوضة')], ['all', L('All', 'الكل')]], status, (v) => { status = v; drawTabs(); load(); }));
      typeTabs.appendChild(tabs([['all', L('All types', 'كل الأنواع')], ['video', L('Videos', 'فيديوهات')], ['comment', L('Comments', 'تعليقات')], ['story', L('Stories', 'قصص')], ['live', L('Lives & live chat', 'البث وتعليقاته')], ['user', L('Accounts', 'حسابات')], ['ai', L('AI flags', 'تنبيهات آلية')]], type, (v) => { type = v; drawTabs(); load(); }));
    }
    async function load() {
      list.innerHTML = ''; list.appendChild(loading());
      try {
        const rows = await API.listReports(status, type, 150, 0);
        list.innerHTML = '';
        setCount(ph.count, rows.length);
        if (!rows.length) { list.appendChild(empty(L('No reports here.', 'لا توجد بلاغات هنا.'))); return; }
        rows.forEach((r) => list.appendChild(reportCard(r, load)));
      } catch (e) { list.innerHTML = ''; list.appendChild(errorBox(e)); }
    }
    const ph = header(L('Reports', 'البلاغات'), L('Reports from people and from the AI screening. Resolving one closes every pending report on the same item.', 'بلاغات المستخدمين والفحص الآلي. معالجة بلاغ تغلق كل البلاغات المعلقة على العنصر نفسه.'), null, true);
    drawTabs(); load();
    return [ph, h('div', { class: 'filterbar' }, [statusTabs, typeTabs]), list];
  }
  function reportCard(r, reload) {
    const t = r.target || null;
    const TL = TYPE_LABEL();
    const head = h('div', { class: 'rc-head' }, [
      badge(TL[r.target_type] || r.target_type, 'type'),
      r.is_ai ? badge(L('AI', 'آلي'), 'ai') : null,
      Number(r.same_target_pending) > 1 ? badge(r.same_target_pending + ' ' + L('reports', 'بلاغات'), 'warn') : null,
      badge(r.status, r.status === 'pending' ? 'warn' : 'ok'),
      h('span', { class: 'muted small', text: ago(r.created_at) }),
    ]);
    const preview = h('div', { class: 'rc-preview' });
    if (!t) {
      preview.appendChild(h('div', { class: 'rc-gone' }, [icon('eyeOff'), h('span', { text: L('The reported item no longer exists (deleted or expired).', 'العنصر المُبلّغ عنه لم يعد موجودًا (حُذف أو انتهى).') })]));
    } else {
      if (r.target_type === 'video') preview.appendChild(media(t.video_url, 'video', t.thumbnail));
      if (r.target_type === 'story') preview.appendChild(media(t.media_url, t.media_kind, t.poster_url));
      if (r.target_type === 'live_stream' && t.thumbnail) preview.appendChild(media(t.thumbnail, 'image'));
      if (r.target_type === 'user') preview.appendChild(avatar(t.avatar_url, t.owner_name));
      if (r.target_type === 'comment' || r.target_type === 'live_comment' || (r.target_type === 'live_stream' && !t.thumbnail)) preview.appendChild(h('div', { class: 'media none ic-only' }, icon(r.target_type === 'live_stream' ? 'live' : 'chat')));
      const lines = h('div', { class: 'rc-lines' });
      lines.appendChild(h('div', {}, [h('span', { class: 'muted', text: L('Owner: ', 'المالك: ') }), userLink(t.owner_id, t.owner_handle, t.owner_name)]));
      const txt = t.text || t.description || t.caption || t.title;
      if (txt) lines.appendChild(h('blockquote', { text: txt }));
      if (t.is_hidden) lines.appendChild(badge(L('hidden', 'مخفي') + (t.hidden_reason ? ' · ' + t.hidden_reason : ''), 'bad'));
      if (t.status) lines.appendChild(badge(t.status, t.status === 'live' ? 'live' : ''));
      if (t.banned_until && new Date(t.banned_until) > new Date()) lines.appendChild(badge(L('banned until ', 'محظور حتى ') + when(t.banned_until), 'bad'));
      if (t.expires_at) lines.appendChild(h('div', { class: 'muted small', text: (new Date(t.expires_at) > new Date() ? L('Expires ', 'تنتهي ') : L('Expired ', 'انتهت ')) + when(t.expires_at) }));
      preview.appendChild(lines);
    }
    const meta = h('div', { class: 'rc-meta' }, [
      h('div', { class: 'rc-reason' }, [h('span', { class: 'muted', text: L('Reason: ', 'السبب: ') }), h('strong', { text: r.reason || '-' })]),
      h('div', { class: 'muted small' }, [L('Reported by ', 'أبلغ عنه '), r.is_ai ? L('automatic screening', 'الفحص الآلي') : userLink(r.reporter_id, r.reporter_handle, r.reporter_name), ' · ', when(r.created_at)]),
      r.action_taken ? h('div', { class: 'muted small', text: L('Action: ', 'الإجراء: ') + r.action_taken }) : null,
    ]);

    const acts = h('div', { class: 'actions' });
    const done = async (label) => { await API.resolveReport(r.id, 'resolved', label, true); toast(L('Done', 'تم')); reload(); refreshCounts(); };
    if (t) {
      const ty = r.target_type;
      if (ty === 'video' || ty === 'comment') {
        if (!t.is_hidden) acts.appendChild(btn(L('Hide & resolve', 'إخفاء ومعالجة'), async () => { await API.setHidden(ty, r.target_id, true, r.reason); await done(L('hidden', 'إخفاء')); }, 'warn'));
        else acts.appendChild(btn(L('Unhide', 'إظهار'), async () => { await API.setHidden(ty, r.target_id, false); toast(L('Visible again', 'أصبح ظاهرًا')); reload(); }));
      }
      if (['video', 'comment', 'story', 'live_comment'].includes(ty)) {
        acts.appendChild(btn(L('Delete & resolve', 'حذف ومعالجة'), async () => {
          if (!(await confirmBox(L('Delete permanently?', 'حذف نهائي؟'), L('This removes the item for everyone and cannot be undone.', 'سيُحذف العنصر للجميع ولا يمكن التراجع.'), L('Delete', 'حذف'), true))) return;
          await API.deleteContent(ty, r.target_id, r.reason); await done(L('deleted', 'حذف'));
        }, 'danger'));
      }
      if (ty === 'live_stream' && t.status === 'live') {
        acts.appendChild(btn(L('End live & resolve', 'إنهاء البث ومعالجة'), async () => {
          if (!(await confirmBox(L('End this live?', 'إنهاء هذا البث؟'), L('The stream is stopped and cannot be restarted by the host.', 'سيتوقف البث ولن يستطيع المضيف إعادة تشغيله.'), L('End live', 'إنهاء'), true))) return;
          await API.endLive(r.target_id, r.reason); await done(L('live ended', 'إنهاء البث'));
        }, 'danger'));
      }
      if (t.owner_id) {
        acts.appendChild(btn(L('Ban owner', 'حظر المالك'), async () => {
          const b = await askBan(); if (!b) return;
          await API.setBan(t.owner_id, b.until, b.reason || r.reason); await done(L('owner banned', 'حظر المالك'));
        }, 'danger'));
      }
    }
    if (r.status === 'pending') {
      acts.appendChild(btn(L('Resolve', 'تمت المعالجة'), async () => {
        const a = await askText(L('Resolve report', 'معالجة البلاغ'), L('What was done? (optional)', 'ما الإجراء المتخذ؟ (اختياري)'), '');
        if (a === null) return;
        await done(a || L('reviewed', 'تمت المراجعة'));
      }, 'primary'));
      acts.appendChild(btn(L('Dismiss', 'رفض البلاغ'), async () => {
        await API.resolveReport(r.id, 'dismissed', L('no violation', 'لا مخالفة'), true);
        toast(L('Dismissed. An automatic hide was undone.', 'تم الرفض، وأُلغي الإخفاء التلقائي إن وُجد.')); reload(); refreshCounts();
      }, 'ghost'));
    }
    return h('article', { class: 'card rc' + (r.is_ai ? ' is-ai' : '') }, [head, preview, meta, acts]);
  }

  // ---------- users ----------
  function viewUsers(q) {
    let status = q.status || 'all';
    const search = h('input', { type: 'search', class: 'input', 'aria-label': L('Search users', 'ابحث عن مستخدم'), placeholder: L('Search handle, name, email or user id', 'ابحث بالمعرّف أو الاسم أو البريد أو رقم المستخدم') });
    search.value = q.q || '';
    const table = h('div', { class: 'table-wrap' });
    const stTabs = h('div');
    let offset = 0;
    function drawTabs() {
      stTabs.innerHTML = '';
      stTabs.appendChild(tabs([['all', L('All', 'الكل')], ['active', L('Active', 'نشط')], ['banned', L('Banned', 'محظور')], ['deleting', L('Deleting', 'قيد الحذف')], ['deactivated', L('Deactivated', 'معطّل')], ['admin', L('Admins', 'المشرفون')]], status, (v) => { status = v; offset = 0; drawTabs(); load(); }));
    }
    async function load() {
      table.innerHTML = ''; table.appendChild(loading());
      try {
        const rows = await API.listUsers(search.value.trim(), status, 50, offset);
        table.innerHTML = '';
        if (!rows.length) { table.appendChild(empty()); return; }
        const tb = h('tbody');
        rows.forEach((u) => {
          const banned = u.banned_until && new Date(u.banned_until) > new Date();
          tb.appendChild(h('tr', { class: 'click', tabindex: '0', onclick: () => openUser(u.id, load), onkeydown: (e) => { if (e.key === 'Enter') openUser(u.id, load); } }, [
            h('td', { 'data-l': L('User', 'المستخدم') }, h('div', { class: 'ucell' }, [avatar(u.avatar_url, u.name), h('div', { class: 'u2' }, [h('div', { class: 'p1', text: u.name || '-' }), h('div', { class: 'p2', text: u.handle ? '@' + u.handle : '' })])])),
            h('td', { 'data-l': L('Email', 'البريد'), class: 'dim' }, u.email || '-'),
            h('td', { 'data-l': L('Status', 'الحالة'), class: 'chips-td' }, [
              !u.is_admin && !u.verified && !banned && !u.deletion_scheduled_at && !u.deactivated_at && !Number(u.open_reports) ? badge(L('active', 'نشط'), 'ok') : null,
              u.is_admin ? badge(L('admin', 'مشرف'), 'type') : null,
              u.verified ? badge(L('verified', 'موثّق'), 'ok') : null,
              banned ? h('span', { class: 'badge bad', text: L('banned', 'محظور') }) : null,
              u.deletion_scheduled_at ? badge(L('deleting', 'قيد الحذف'), 'warn') : null,
              u.deactivated_at && !u.deletion_scheduled_at ? badge(L('deactivated', 'معطّل'), 'warn') : null,
              Number(u.open_reports) ? badge(u.open_reports + ' ' + L('reports', 'بلاغات'), 'warn') : null,
            ]),
            h('td', { 'data-l': L('Videos', 'فيديوهات'), class: 'num' }, num(u.videos_count)),
            h('td', { 'data-l': L('Followers', 'متابعون'), class: 'num' }, num(u.followers_count)),
            h('td', { 'data-l': L('Joined', 'انضم'), class: 'dim nowrap' }, when(u.created_at)),
            h('td', { class: 'row-go', 'aria-hidden': 'true' }, icon('chevR')),
          ]));
        });
        table.appendChild(h('table', { class: 'table' }, [
          h('thead', {}, h('tr', {}, [[L('User', 'المستخدم')], [L('Email', 'البريد')], [L('Status', 'الحالة')], [L('Videos', 'فيديوهات'), 'num'], [L('Followers', 'متابعون'), 'num'], [L('Joined', 'انضم')], ['']].map(([x, c]) => h('th', { text: x, class: c || null })))),
          tb,
        ]));
        table.appendChild(h('div', { class: 'pager' }, [
          offset ? btn(L('← Previous', '→ السابق'), () => { offset = Math.max(0, offset - 50); load(); }, 'ghost') : null,
          rows.length === 50 ? btn(L('Next →', 'التالي ←'), () => { offset += 50; load(); }, 'ghost') : null,
        ]));
      } catch (e) { table.innerHTML = ''; table.appendChild(errorBox(e)); }
    }
    let timer = null;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { offset = 0; load(); }, 350); });
    drawTabs(); load();
    if (q.id) setTimeout(() => openUser(q.id, load), 0);
    const ph = header(L('Users', 'المستخدمون'), L('Look up any account by handle, name, email or id.', 'ابحث عن أي حساب بالمعرّف أو الاسم أو البريد أو الرقم.'), null, true);
    if (COUNTS.users_total != null) setCount(ph.count, COUNTS.users_total);
    return [ph, h('section', { class: 'panel' }, [h('div', { class: 'filterbar in' }, [searchBox(search), stTabs]), table])];
  }

  async function openUser(id, reload) {
    let d;
    try { d = await API.userDetail(id); } catch (e) { toast(errText(e), true); return; }
    if (!d || !d.profile) { toast(L('User not found', 'المستخدم غير موجود'), true); return; }
    const p = d.profile;
    const banned = p.banned_until && new Date(p.banned_until) > new Date();
    const c = d.counts || {};
    const body = h('div', { class: 'udetail' }, [
      h('div', { class: 'ucell big' }, [avatar(p.avatar_url, p.name), h('div', {}, [
        h('div', { class: 'name', text: p.name || '-' }),
        h('div', { class: 'muted', text: (p.handle ? '@' + p.handle : '') + (d.email ? ' · ' + d.email : '') }),
        h('div', { class: 'muted small mono', text: 'id ' + p.id }),
      ])]),
      h('div', { class: 'chips' }, [
        p.is_admin ? badge(L('admin', 'مشرف'), 'type') : null,
        p.verified ? badge(L('verified', 'موثّق'), 'ok') : null,
        banned ? badge(L('banned until ', 'محظور حتى ') + when(p.banned_until), 'bad') : null,
        p.deletion_scheduled_at ? badge(L('deletion scheduled ', 'حذف مجدول ') + when(p.deletion_scheduled_at), 'warn') : null,
        p.deactivated_at ? badge(L('deactivated ', 'معطّل ') + when(p.deactivated_at), 'warn') : null,
        p.is_private ? badge(L('private account', 'حساب خاص')) : null,
      ]),
      h('dl', { class: 'kv' }, [
        [L('Joined', 'انضم'), when(p.created_at)],
        [L('Last sign-in', 'آخر دخول'), when(d.last_sign_in_at)],
        [L('Videos (hidden)', 'فيديوهات (مخفية)'), num(c.videos) + ' (' + num(c.videos_hidden) + ')'],
        [L('Active stories', 'قصص نشطة'), num(c.stories_active)],
        [L('Comments', 'تعليقات'), num(c.comments)],
        [L('Lives hosted', 'بث مستضاف'), num(c.lives)],
        [L('Reports filed', 'بلاغات قدّمها'), num(c.reports_filed)],
        [L('Support tickets', 'تذاكر دعم'), num(c.tickets)],
        [L('Coin balance', 'رصيد العملات'), d.wallet ? num(d.wallet.balance) : '0'],
        [L('Location sharing', 'مشاركة الموقع'), d.location && d.location.sharing_enabled ? L('on, last update ', 'مفعّلة، آخر تحديث ') + ago(d.location.updated_at) : L('off', 'متوقفة')],
      ].flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: String(v) })])),
    ]);
    if (p.bio) body.appendChild(h('blockquote', { text: p.bio }));
    if ((d.reports_against || []).length) {
      body.appendChild(h('h4', { text: L('Reports against this account and its content', 'بلاغات ضد هذا الحساب ومحتواه') }));
      body.appendChild(h('ul', { class: 'mini' }, d.reports_against.map((r) => h('li', {}, [badge(TYPE_LABEL()[r.target_type] || r.target_type, 'type'), ' ', badge(r.status, r.status === 'pending' ? 'warn' : 'ok'), ' ', r.reason || '', h('span', { class: 'muted small', text: ' · ' + ago(r.created_at) })]))));
    }
    if ((d.recent_videos || []).length) {
      body.appendChild(h('h4', { text: L('Recent videos', 'أحدث الفيديوهات') }));
      body.appendChild(h('div', { class: 'thumbs' }, d.recent_videos.map((v) => h('div', { class: 'thumb' + (v.is_hidden ? ' hidden' : '') }, [media(v.video_url, 'video', v.thumbnail), h('div', { class: 'small', text: (v.description || '').slice(0, 60) })]))));
    }
    if ((d.active_stories || []).length) {
      body.appendChild(h('h4', { text: L('Active stories', 'القصص النشطة') }));
      body.appendChild(h('div', { class: 'thumbs' }, d.active_stories.map((s) => h('div', { class: 'thumb' }, [media(s.media_url, s.media_kind, s.poster_url), s.caption ? h('div', { class: 'small', text: s.caption }) : null]))));
    }
    if ((d.recent_logs || []).length) {
      body.appendChild(h('h4', { text: L('Admin history', 'سجل الإجراءات') }));
      body.appendChild(h('ul', { class: 'mini' }, d.recent_logs.map((l) => h('li', {}, [h('code', { text: l.action }), ' · @' + (l.admin_handle || '?') + ' · ' + when(l.created_at)]))));
    }
    const isSelf = ME && ME.id === p.id;
    const acts = h('div', { class: 'actions' });
    const again = async () => { document.querySelector('.backdrop')?.remove(); if (reload) reload(); openUser(id, reload); };
    if (banned) acts.appendChild(btn(L('Unban', 'رفع الحظر'), async () => { await API.setBan(p.id, null, null); toast(L('Unbanned', 'تم رفع الحظر')); again(); }, 'primary'));
    else if (!isSelf) acts.appendChild(btn(L('Ban…', 'حظر…'), async () => { const b = await askBan(); if (!b) return; await API.setBan(p.id, b.until, b.reason); toast(L('Banned', 'تم الحظر')); again(); }, 'danger'));
    acts.appendChild(btn(p.verified ? L('Remove verified badge', 'إزالة التوثيق') : L('Mark verified', 'توثيق الحساب'), async () => { await API.setVerified(p.id, !p.verified); toast(L('Saved', 'تم الحفظ')); again(); }));
    if (!isSelf) {
      acts.appendChild(btn(p.is_admin ? L('Remove admin', 'إزالة الإشراف') : L('Make admin', 'تعيين مشرفًا'), async () => {
        if (!(await confirmBox(L('Change admin rights?', 'تغيير صلاحيات الإشراف؟'), p.is_admin ? L('This account will lose access to this panel.', 'سيفقد هذا الحساب الوصول إلى اللوحة.') : L('This account will be able to moderate everything and see every account.', 'سيتمكن هذا الحساب من الإشراف على كل شيء ورؤية كل الحسابات.'), L('Confirm', 'تأكيد'), !p.is_admin))) return;
        await API.setAdmin(p.id, !p.is_admin); toast(L('Saved', 'تم الحفظ')); again();
      }, 'ghost'));
    }
    if (p.deletion_scheduled_at) {
      acts.appendChild(btn(L('Cancel scheduled deletion', 'إلغاء الحذف المجدول'), async () => { await API.cancelDeletion(p.id); toast(L('Deletion cancelled', 'أُلغي الحذف')); again(); }, 'primary'));
    }
    if (!isSelf) {
      acts.appendChild(btn(L('Delete account now…', 'حذف الحساب الآن…'), async () => {
        const typed = await askText(L('Delete account permanently', 'حذف الحساب نهائيًا'), L('This deletes the login and everything the account owns, immediately and for good. Type the handle to confirm: ', 'سيُحذف تسجيل الدخول وكل ما يملكه الحساب فورًا ونهائيًا. اكتب المعرّف للتأكيد: ') + (p.handle || p.id), '');
        if (typed === null) return;
        if (typed.trim().replace(/^@/, '') !== String(p.handle || p.id)) { toast(L('Did not match. Nothing deleted.', 'غير مطابق. لم يُحذف شيء.'), true); return; }
        await API.deleteUser(p.id); toast(L('Account deleted', 'تم حذف الحساب'));
        document.querySelector('.backdrop')?.remove(); if (reload) reload();
      }, 'danger'));
    }
    body.insertBefore(acts, body.children[2]);
    // Gift earnings, verification and withdrawals (0130); removes itself when
    // the migration is not applied.
    const kvEl = body.querySelector('.kv');
    if (kvEl) kvEl.after(payoutSection(p.id, () => { if (reload) reload(); }));
    modal(L('Account', 'الحساب'), body, null, { drawer: true });
  }

  // ---------- videos ----------
  function viewVideos(q) {
    let filter = q.filter || 'reported';
    const search = h('input', { type: 'search', class: 'input', 'aria-label': L('Search videos', 'ابحث في الفيديوهات'), placeholder: L('Search caption or @handle', 'ابحث في الوصف أو @المعرّف') });
    const grid = h('div', { class: 'cards' });
    const tb = h('div');
    function drawTabs() { tb.innerHTML = ''; tb.appendChild(tabs([['reported', L('Reported', 'مُبلّغ عنها')], ['hidden', L('Hidden', 'مخفية')], ['published', L('Published', 'منشورة')], ['draft', L('Drafts', 'مسودات')], ['all', L('All', 'الكل')]], filter, (v) => { filter = v; drawTabs(); load(); })); }
    async function load() {
      grid.innerHTML = ''; grid.appendChild(loading());
      try {
        const rows = await API.listVideos(filter, search.value.trim(), 80, 0);
        grid.innerHTML = '';
        setCount(ph.count, rows.length);
        if (!rows.length) { grid.appendChild(empty()); return; }
        rows.forEach((v) => grid.appendChild(h('article', { class: 'card vc' + (v.is_hidden ? ' hidden' : '') }, [
          media(v.video_url, 'video', v.thumbnail),
          h('div', { class: 'vc-body' }, [
            h('div', { class: 'vc-who' }, [userLink(v.user_id, v.owner_handle, v.owner_name), h('span', { class: 'muted small', text: ' · ' + ago(v.created_at) })]),
            v.description ? h('p', { class: 'clip', text: v.description }) : null,
            h('div', { class: 'chips' }, [
              v.is_hidden ? badge(L('hidden', 'مخفي') + (v.hidden_reason ? ' · ' + v.hidden_reason : ''), 'bad') : null,
              v.is_draft ? badge(L('draft', 'مسودة')) : null,
              v.privacy !== 'public' ? badge(v.privacy) : null,
              Number(v.pending_reports) ? badge(v.pending_reports + ' ' + L('reports', 'بلاغات'), 'warn') : null,
              h('span', { class: 'muted small', text: num(v.views_count) + ' ' + L('views', 'مشاهدة') }),
            ]),
            h('div', { class: 'actions' }, [
              v.is_hidden
                ? btn(L('Unhide', 'إظهار'), async () => { await API.setHidden('video', v.id, false); toast(L('Visible again', 'أصبح ظاهرًا')); load(); })
                : btn(L('Hide', 'إخفاء'), async () => { const r = await askText(L('Hide video', 'إخفاء الفيديو'), L('Reason', 'السبب'), ''); if (r === null) return; await API.setHidden('video', v.id, true, r); toast(L('Hidden', 'تم الإخفاء')); load(); }, 'warn'),
              btn(L('Delete', 'حذف'), async () => { if (!(await confirmBox(L('Delete video?', 'حذف الفيديو؟'), L('The video and its file are removed for good.', 'سيُحذف الفيديو وملفه نهائيًا.'), L('Delete', 'حذف'), true))) return; await API.deleteContent('video', v.id, null); toast(L('Deleted', 'تم الحذف')); load(); }, 'danger'),
            ]),
          ]),
        ])));
      } catch (e) { grid.innerHTML = ''; grid.appendChild(errorBox(e)); }
    }
    let timer = null;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 350); });
    const ph = header(L('Videos', 'الفيديوهات'), L('Hide keeps the video for its owner only; delete removes it and its file.', 'الإخفاء يُبقي الفيديو لصاحبه فقط؛ الحذف يزيله مع ملفه.'), null, true);
    drawTabs(); load();
    return [ph, h('div', { class: 'filterbar' }, [searchBox(search), tb]), grid];
  }

  // ---------- stories ----------
  function viewStories(q) {
    let filter = q.filter || 'reported';
    const grid = h('div', { class: 'cards' });
    const tb = h('div');
    function drawTabs() { tb.innerHTML = ''; tb.appendChild(tabs([['reported', L('Reported', 'مُبلّغ عنها')], ['active', L('Active (24 h)', 'نشطة (24 س)')], ['all', L('All kept', 'كل المحفوظة')]], filter, (v) => { filter = v; drawTabs(); load(); })); }
    async function load() {
      grid.innerHTML = ''; grid.appendChild(loading());
      try {
        const rows = await API.listStories(filter, 150);
        grid.innerHTML = '';
        setCount(ph.count, rows.length);
        if (!rows.length) { grid.appendChild(empty()); return; }
        rows.forEach((s) => grid.appendChild(h('article', { class: 'card vc' }, [
          media(s.media_url, s.media_kind, s.poster_url),
          h('div', { class: 'vc-body' }, [
            h('div', { class: 'vc-who' }, [userLink(s.user_id, s.owner_handle, s.owner_name), h('span', { class: 'muted small', text: ' · ' + ago(s.created_at) })]),
            s.caption ? h('p', { class: 'clip', text: s.caption }) : null,
            h('div', { class: 'chips' }, [
              badge(s.audience),
              new Date(s.expires_at) > new Date() ? badge(L('expires ', 'تنتهي ') + ago(s.expires_at).replace(/^-/, ''), 'ok') : badge(L('expired', 'منتهية')),
              Number(s.pending_reports) ? badge(s.pending_reports + ' ' + L('reports', 'بلاغات'), 'warn') : null,
              h('span', { class: 'muted small', text: num(s.view_count) + ' ' + L('views', 'مشاهدة') }),
            ]),
            h('div', { class: 'actions' }, [
              btn(L('Delete story', 'حذف القصة'), async () => { if (!(await confirmBox(L('Delete story?', 'حذف القصة؟'), L('The story and its media are removed for good.', 'ستُحذف القصة ووسائطها نهائيًا.'), L('Delete', 'حذف'), true))) return; await API.deleteContent('story', s.id, null); toast(L('Deleted', 'تم الحذف')); load(); refreshCounts(); }, 'danger'),
              Number(s.pending_reports) ? h('a', { class: 'btn ghost', href: '#/reports?type=story', text: L('Open reports', 'فتح البلاغات') }) : null,
            ]),
          ]),
        ])));
      } catch (e) { grid.innerHTML = ''; grid.appendChild(errorBox(e)); }
    }
    const ph = header(L('Stories', 'القصص'), L('Stories disappear after 24 hours. Deleting one also queues its file for removal from storage.', 'تختفي القصص بعد 24 ساعة. حذف قصة يضع ملفها في قائمة الحذف من التخزين.'), null, true);
    drawTabs(); load();
    return [ph, h('div', { class: 'filterbar' }, tb), grid];
  }

  // ---------- live ----------
  function viewLive(q) {
    let status = q.status || 'live';
    const grid = h('div', { class: 'cards' });
    const tb = h('div');
    function drawTabs() { tb.innerHTML = ''; tb.appendChild(tabs([['live', L('Live now', 'مباشر الآن')], ['ended', L('Ended', 'منتهي')], ['banned', L('Force-ended', 'أُنهي إداريًا')], ['all', L('All', 'الكل')]], status, (v) => { status = v; drawTabs(); load(); })); }
    async function load() {
      grid.innerHTML = ''; grid.appendChild(loading());
      try {
        const rows = await API.listLives(status, 100);
        grid.innerHTML = '';
        setCount(ph.count, rows.length);
        if (!rows.length) { grid.appendChild(empty(status === 'live' ? L('Nobody is live right now.', 'لا يوجد بث مباشر الآن.') : null)); return; }
        rows.forEach((l) => grid.appendChild(h('article', { class: 'card lc' }, [
          h('div', { class: 'lc-head' }, [avatar(l.host_avatar, l.host_name), h('div', {}, [userLink(l.host_id, l.host_handle, l.host_name), h('div', { class: 'muted small', text: l.title || L('(no title)', '(بلا عنوان)') })]), badge(l.status, l.status === 'live' ? 'live' : l.status === 'banned' ? 'bad' : '')]),
          h('dl', { class: 'kv' }, [
            [L('Started', 'بدأ'), when(l.started_at)],
            [L('Ended', 'انتهى'), l.ended_at ? when(l.ended_at) : '-'],
            [L('Viewers (peak)', 'المشاهدون (الذروة)'), num(l.viewer_count) + ' (' + num(l.viewer_count_max) + ')'],
            [L('Guests on stage', 'ضيوف على المنصة'), num(l.guests)],
            [L('Chat messages', 'رسائل الدردشة'), num(l.comments)],
            [L('Gift coins', 'عملات الهدايا'), num(l.gift_coins)],
            [L('Audience', 'الجمهور'), l.privacy || 'public'],
          ].flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: String(v) })])),
          Number(l.pending_reports) ? h('div', { class: 'notice warn', text: l.pending_reports + ' ' + L('pending reports on this live or its chat', 'بلاغات معلقة على هذا البث أو دردشته') }) : null,
          h('div', { class: 'actions' }, [
            btn(L('View chat', 'عرض الدردشة'), () => openLiveChat(l)),
            l.status === 'live' ? btn(L('Force end', 'إنهاء إجباري'), async () => {
              const r = await askText(L('Force-end this live', 'إنهاء هذا البث إجباريًا'), L('Reason (kept in the audit log)', 'السبب (يُحفظ في سجل الأنشطة)'), '');
              if (r === null) return;
              await API.endLive(l.id, r); toast(L('Live ended', 'تم إنهاء البث')); load(); refreshCounts();
            }, 'danger') : null,
            btn(L('Ban host', 'حظر المضيف'), async () => { const b = await askBan(); if (!b) return; await API.setBan(l.host_id, b.until, b.reason); toast(L('Host banned; live ended', 'تم حظر المضيف وإنهاء البث')); load(); refreshCounts(); }, 'danger'),
          ]),
        ])));
      } catch (e) { grid.innerHTML = ''; grid.appendChild(errorBox(e)); }
    }
    const ph = header(L('Live streams', 'البث المباشر'), L('Force-ending marks the stream as banned, so the host cannot reopen it.', 'الإنهاء الإجباري يجعل البث محظورًا فلا يستطيع المضيف إعادة فتحه.'), null, true);
    drawTabs(); load();
    return [ph, h('div', { class: 'filterbar' }, tb), grid];
  }
  async function openLiveChat(l) {
    const list = h('ul', { class: 'chat' }, h('li', {}, loading()));
    async function load() {
      try {
        const rows = await API.liveComments(l.id, 300);
        list.innerHTML = '';
        if (!rows.length) { list.appendChild(h('li', {}, empty(L('No chat messages.', 'لا توجد رسائل.')))); return; }
        rows.forEach((c) => list.appendChild(h('li', {}, [
          h('div', {}, [userLink(c.user_id, c.handle, c.name), h('span', { class: 'muted small', text: ' · ' + when(c.created_at) })]),
          h('div', { class: 'msg', text: c.body }),
          btn(L('Delete', 'حذف'), async () => { await API.deleteContent('live_comment', c.id, null); toast(L('Deleted', 'تم الحذف')); load(); }, 'danger small'),
        ])));
      } catch (e) { list.innerHTML = ''; list.appendChild(h('li', {}, errorBox(e))); }
    }
    load();
    modal(L('Live chat', 'دردشة البث') + ' · @' + (l.host_handle || ''), list, null, { drawer: true });
  }

  // ---------- AI screening log ----------
  function viewModeration() {
    const body = h('div', {}, loading());
    (async () => {
      try {
        const rows = await API.moderationRecent(200);
        body.innerHTML = '';
        if (!rows || !rows.length) { body.appendChild(empty(L('No screening decisions recorded yet.', 'لا توجد قرارات فحص مسجلة بعد.'))); return; }
        const tb = h('tbody');
        rows.forEach((r) => tb.appendChild(h('tr', {}, [
          h('td', { 'data-l': L('When', 'الوقت'), class: 'dim nowrap' }, when(r.created_at)),
          h('td', { 'data-l': L('Surface', 'النوع'), class: 'strong' }, r.kind),
          h('td', { 'data-l': L('Outcome', 'النتيجة') }, badge(r.outcome, r.outcome === 'block' ? 'bad' : r.outcome === 'review' ? 'warn' : r.outcome === 'unavailable' ? 'bad' : '')),
          h('td', { 'data-l': L('Category', 'الفئة') }, (r.top_category || '-') + (r.top_score != null ? ' (' + Number(r.top_score).toFixed(2) + ')' : '')),
          h('td', { 'data-l': L('Image', 'صورة') }, r.had_image ? h('span', { class: 'yes', title: L('Had an image', 'تضمّن صورة') }, [icon('check'), h('span', { class: 'sr', text: L('yes', 'نعم') })]) : ''),
          h('td', { 'data-l': L('User', 'المستخدم') }, r.user_handle ? '@' + r.user_handle : '-'),
        ])));
        body.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, [
          h('thead', {}, h('tr', {}, [L('When', 'الوقت'), L('Surface', 'النوع'), L('Outcome', 'النتيجة'), L('Category', 'الفئة'), L('Image', 'صورة'), L('User', 'المستخدم')].map((x) => h('th', { text: x })))),
          tb,
        ])));
      } catch (e) { body.innerHTML = ''; body.appendChild(errorBox(e)); }
    })();
    return [header(L('AI screening log', 'سجل الفحص الآلي'), L('Every non-"allow" decision of the automatic screening. Content itself is never stored here. "unavailable" means content went out unscanned.', 'كل قرار للفحص الآلي غير "سماح". لا يُخزَّن المحتوى نفسه هنا. "unavailable" يعني أن محتوى نُشر دون فحص.')), body];
  }

  // ---------- support tickets ----------
  function viewTickets(q) {
    let status = q.status || 'open';
    const list = h('div', { class: 'list' });
    const tb = h('div');
    function drawTabs() { tb.innerHTML = ''; tb.appendChild(tabs([['open', L('Open', 'مفتوحة')], ['in_progress', L('In progress', 'قيد المعالجة')], ['resolved', L('Resolved', 'محلولة')], ['closed', L('Closed', 'مغلقة')], ['all', L('All', 'الكل')]], status, (v) => { status = v; drawTabs(); load(); })); }
    async function load() {
      list.innerHTML = ''; list.appendChild(loading());
      try {
        const rows = await API.tickets(status);
        list.innerHTML = '';
        setCount(ph.count, rows.length);
        if (!rows.length) { list.appendChild(empty(L('No tickets.', 'لا توجد تذاكر.'))); return; }
        rows.forEach((t) => {
          const u = t.profiles || {};
          list.appendChild(h('article', { class: 'card tk' }, [
            h('div', { class: 'rc-head' }, [badge(t.category, 'type'), badge(t.status, t.status === 'open' ? 'warn' : 'ok'), h('span', { class: 'muted small', text: ago(t.created_at) })]),
            h('div', { class: 'tk-who' }, [avatar(u.avatar_url, u.name || u.handle), userLink(t.user_id, u.handle, u.name), t.app_version ? h('span', { class: 'muted small', text: ' · v' + t.app_version }) : null, t.device ? h('span', { class: 'muted small', text: ' · ' + t.device }) : null]),
            t.subject ? h('h3', { text: t.subject }) : null,
            h('blockquote', { class: 'pre', text: t.message }),
            t.admin_reply ? h('div', { class: 'reply' }, [h('strong', { text: L('Reply sent: ', 'الرد المرسل: ') }), t.admin_reply]) : null,
            h('div', { class: 'actions' }, [
              btn(t.admin_reply ? L('Reply again', 'رد مجددًا') : L('Reply & resolve', 'رد وأغلق'), async () => {
                const r = await askText(L('Reply to the user', 'الرد على المستخدم'), L('The user gets this as an in-app notification.', 'سيصل الرد للمستخدم كإشعار داخل التطبيق.'), '', true);
                if (!r || !r.trim()) return;
                await API.replyTicket(t.id, r.trim(), 'resolved', ME && ME.id); toast(L('Reply sent', 'تم إرسال الرد')); load(); refreshCounts();
              }, 'primary'),
              t.status === 'open' ? btn(L('Mark in progress', 'قيد المعالجة'), async () => { await API.setTicketStatus(t.id, 'in_progress'); load(); }) : null,
              t.status !== 'closed' ? btn(L('Close', 'إغلاق'), async () => { await API.setTicketStatus(t.id, 'closed'); load(); refreshCounts(); }, 'ghost') : null,
            ]),
          ]));
        });
      } catch (e) { list.innerHTML = ''; list.appendChild(errorBox(e)); }
    }
    const ph = header(L('Support tickets', 'تذاكر الدعم'), L('"Report a problem" and "Contact us" from the app.', 'من "الإبلاغ عن مشكلة" و"تواصل معنا" في التطبيق.'), null, true);
    drawTabs(); load();
    return [ph, h('div', { class: 'filterbar' }, tb), list];
  }

  // ---------- deletions ----------
  function viewDeletions() {
    const body = h('div', {}, loading());
    async function load() {
      body.innerHTML = ''; body.appendChild(loading());
      try {
        const rows = await API.pendingDeletions();
        body.innerHTML = '';
        setCount(ph.count, rows.length);
        if (!rows.length) { body.appendChild(empty(L('No accounts are scheduled for deletion.', 'لا توجد حسابات مجدولة للحذف.'))); return; }
        const tb = h('tbody');
        rows.forEach((r) => tb.appendChild(h('tr', {}, [
          h('td', { 'data-l': L('User', 'المستخدم') }, h('div', { class: 'ucell' }, [avatar(r.avatar_url, r.name), userLink(r.id, r.handle, r.name)])),
          h('td', { 'data-l': L('Requested', 'طُلب'), class: 'dim nowrap' }, when(r.deactivated_at)),
          h('td', { 'data-l': L('Erased on', 'يُمحى في'), class: 'dim nowrap' }, when(r.deletion_scheduled_at)),
          h('td', { 'data-l': L('Days left', 'أيام متبقية') }, badge(String(r.days_left), r.days_left <= 3 ? 'bad' : 'warn')),
          h('td', { class: 'row-act' }, btn(L('Cancel deletion', 'إلغاء الحذف'), async () => {
            if (!(await confirmBox(L('Cancel this deletion?', 'إلغاء هذا الحذف؟'), L('Only do this when the account owner asked for it.', 'افعل ذلك فقط بطلب من صاحب الحساب.'), L('Cancel deletion', 'إلغاء الحذف')))) return;
            await API.cancelDeletion(r.id); toast(L('Deletion cancelled', 'أُلغي الحذف')); load(); refreshCounts();
          }, 'primary')),
        ])));
        body.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, [h('thead', {}, h('tr', {}, [L('User', 'المستخدم'), L('Requested', 'طُلب'), L('Erased on', 'يُمحى في'), L('Days left', 'أيام متبقية'), ''].map((x) => h('th', { text: x })))), tb])));
      } catch (e) { body.innerHTML = ''; body.appendChild(errorBox(e)); }
    }
    const ph = header(L('Deletion queue', 'طلبات الحذف'), L('Accounts deleted in the app are erased automatically when the grace period ends.', 'الحسابات المحذوفة من التطبيق تُمحى تلقائيًا عند انتهاء مهلة السماح.'), null, true);
    load();
    return [ph, body];
  }

  // ---------- data export requests ----------
  function viewExports() {
    const body = h('div', {}, loading());
    async function load() {
      body.innerHTML = ''; body.appendChild(loading());
      try {
        const rows = await API.exports();
        body.innerHTML = '';
        setCount(ph.count, rows.length);
        if (!rows.length) { body.appendChild(empty(L('No data requests.', 'لا توجد طلبات بيانات.'))); return; }
        const tb = h('tbody');
        rows.forEach((r) => {
          const u = r.profiles || {};
          tb.appendChild(h('tr', {}, [
            h('td', { 'data-l': L('User', 'المستخدم') }, h('div', { class: 'ucell' }, [avatar(null, u.name || u.handle), userLink(r.user_id, u.handle, u.name)])),
            h('td', { 'data-l': L('Requested', 'طُلب'), class: 'dim nowrap' }, when(r.requested_at)),
            h('td', { 'data-l': L('Status', 'الحالة') }, badge(r.status, r.status === 'pending' ? 'warn' : r.status === 'ready' ? 'ok' : 'bad')),
            h('td', { class: 'row-act' }, r.status === 'pending' ? h('div', { class: 'actions' }, [
              btn(L('Mark ready…', 'جاهز…'), async () => {
                const url = await askText(L('Export file link', 'رابط ملف البيانات'), L('https link the user can download', 'رابط https يمكن للمستخدم تنزيله'), '');
                if (!url) return;
                if (!safeUrl(url)) { toast(L('Must be an https link', 'يجب أن يكون رابط https'), true); return; }
                await API.completeExport(r.id, url.trim()); toast(L('Saved', 'تم الحفظ')); load(); refreshCounts();
              }, 'primary'),
              btn(L('Mark failed', 'فشل'), async () => { await API.failExport(r.id); load(); refreshCounts(); }, 'ghost'),
            ]) : (r.file_url && safeUrl(r.file_url) ? h('a', { href: safeUrl(r.file_url), target: '_blank', rel: 'noopener noreferrer', text: L('file', 'الملف') }) : '')),
          ]));
        });
        body.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, [h('thead', {}, h('tr', {}, [L('User', 'المستخدم'), L('Requested', 'طُلب'), L('Status', 'الحالة'), ''].map((x) => h('th', { text: x })))), tb])));
      } catch (e) { body.innerHTML = ''; body.appendChild(errorBox(e)); }
    }
    const ph = header(L('Data requests', 'طلبات البيانات'), L('Requests for a copy of personal data.', 'طلبات الحصول على نسخة من البيانات الشخصية.'), null, true);
    load();
    return [ph, body];
  }

  // ---------- wallet (read-only) ----------
  function viewWallet(q) {
    let days = Number(q.days || 30);
    const body = h('div', {}, loading());
    const tb = h('div');
    function drawTabs() { tb.innerHTML = ''; tb.appendChild(tabs([['7', L('7 days', '7 أيام')], ['30', L('30 days', '30 يومًا')], ['90', L('90 days', '90 يومًا')], ['365', L('1 year', 'سنة')]], String(days), (v) => { days = Number(v); drawTabs(); load(); })); }
    // Columns whose cells are all plain numbers are right-aligned.
    const isNum = (c) => typeof c === 'string' && /^[-\d\u0660-\u0669.,\u066b\u066c\s]+$/.test(c) && c.trim() !== '-';
    function small(title, headers, rows) {
      const head = h('div', { class: 'card-head' }, [h('h2', { text: title }), rows && rows.length ? h('span', { class: 'ph-count', text: num(rows.length) }) : null]);
      if (!rows || !rows.length) return h('section', { class: 'card' }, [head, empty()]);
      const numCol = headers.map((_, i) => rows.every((r) => isNum(r[i]) || r[i] === '-'));
      return h('section', { class: 'card flush' }, [head, h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, [
        h('thead', {}, h('tr', {}, headers.map((x, i) => h('th', { text: x, class: numCol[i] ? 'num' : null })))),
        h('tbody', {}, rows.map((cells) => h('tr', {}, cells.map((c, i) => h('td', { 'data-l': headers[i], class: numCol[i] ? 'num' : null }, c))))),
      ]))]);
    }
    async function load() {
      body.innerHTML = ''; body.appendChild(loading());
      try {
        const w = await API.wallet(days);
        body.innerHTML = '';
        const ts = w.topups_by_status || {};
        body.appendChild(h('div', { class: 'grid stats c4' }, [
          stat(L('Coins held in wallets', 'العملات في المحافظ'), w.coins_in_wallets, null, '', 'coins'),
          stat(L('Wallets with a balance', 'محافظ برصيد'), w.wallets_with_balance, null, '', 'users'),
          stat(L('Coins bought (credited)', 'عملات مشتراة (مضافة)'), ts.credited ? ts.credited.coins : 0, null, '', 'download'),
          stat(L('Purchases credited', 'عمليات شراء مضافة'), ts.credited ? ts.credited.count : 0, null, '', 'check'),
          stat(L('Purchases pending', 'عمليات معلقة'), ts.pending ? ts.pending.count : 0, null, ts.pending && ts.pending.count ? 'warn' : '', 'hourglass'),
          stat(L('Purchases rejected', 'عمليات مرفوضة'), ts.rejected ? ts.rejected.count : 0, null, ts.rejected && ts.rejected.count ? 'bad' : '', 'x'),
          stat(L('Gifts sent', 'هدايا مرسلة'), w.gifts ? w.gifts.count : 0, null, '', 'gift'),
          stat(L('Coins spent on gifts', 'عملات أُنفقت على الهدايا'), w.gifts ? w.gifts.coins : 0, null, '', 'live'),
        ]));
        body.appendChild(h('div', { class: 'notice info', text: L('Read-only. Coins are bought only through Apple / Google in-app purchase and verified server-side; refunds are decided by the stores. "Flagged" means purchases that are stuck or rejected, coin credits with no store receipt behind them, store refunds, and accounts the refund handling marked for review.', 'للعرض فقط. تُشترى العملات عبر الشراء داخل التطبيق من Apple / Google ويتم التحقق منها على الخادم؛ قرار الاسترداد للمتاجر. "المُعلَّم" يعني عمليات شراء معلقة أو مرفوضة، وعملات بلا إيصال متجر، واستردادات المتاجر، وحسابات علّمها نظام الاسترداد للمراجعة.') }));
        const [flags, refunds] = await Promise.all([API.walletFlags().catch(() => null), API.refunds(100).catch(() => null)]);
        if (flags) {
          body.appendChild(small(L('Accounts flagged by refunds', 'حسابات مُعلَّمة بسبب الاسترداد'), [L('User', 'المستخدم'), L('Refunds', 'الاستردادات'), L('Coins refunded', 'عملات مستردة'), L('Reason', 'السبب'), L('Updated', 'التحديث'), L('Review', 'المراجعة')],
            flags.map((f) => [userLink(f.user_id, f.profiles && f.profiles.handle), num(f.refund_count), num(f.refunded_coins), f.reason || '-', when(f.updated_at),
              f.reviewed_at ? h('span', { class: 'muted small', text: L('reviewed ', 'رُوجع ') + when(f.reviewed_at) + (f.review_note ? ' · ' + f.review_note : '') })
                : btn(L('Mark reviewed', 'تمت المراجعة'), async () => { const n = await askText(L('Review note', 'ملاحظة المراجعة'), L('What did you decide? (optional)', 'ما القرار؟ (اختياري)'), ''); if (n === null) return; await API.reviewWalletFlag(f.user_id, n, ME && ME.id); toast(L('Saved', 'تم الحفظ')); load(); }, 'small')])));
        }
        if (refunds) {
          body.appendChild(small(L('Store refunds', 'استردادات المتاجر'), [L('User', 'المستخدم'), L('Outcome', 'النتيجة'), L('Coins reversed', 'عملات مسحوبة'), L('Balance after', 'الرصيد بعدها'), L('Platform', 'المنصة'), L('Reason', 'السبب'), L('Recorded', 'سُجّل')],
            refunds.map((x) => [userLink(x.user_id, x.profiles && x.profiles.handle), badge(x.outcome, x.outcome === 'reversed' ? 'warn' : ''), num(x.coins_reversed), x.balance_after == null ? '-' : num(x.balance_after), x.platform, x.reason || '-', when(x.recorded_at)])));
        }
        body.appendChild(small(L('Flagged purchases', 'عمليات شراء مُعلَّمة'), [L('User', 'المستخدم'), L('Flag', 'السبب'), L('Product', 'المنتج'), L('Platform', 'المنصة'), L('Coins', 'العملات'), L('Store transaction', 'معاملة المتجر'), L('When', 'الوقت')],
          (w.flagged_topups || []).map((t) => [userLink(t.user_id, t.handle), badge(t.flag, 'bad'), t.product_id || '-', t.platform + (t.environment ? ' / ' + t.environment : ''), num(t.coins), h('code', { text: t.store_transaction_id || '' }), when(t.created_at)])));
        body.appendChild(small(L('Coin credits without a store receipt', 'عملات بلا إيصال متجر'), [L('User', 'المستخدم'), L('Coins', 'العملات'), L('Description', 'الوصف'), L('When', 'الوقت')],
          (w.unbacked_credits || []).map((x) => [userLink(x.user_id, x.handle), num(x.amount), x.description || '-', when(x.created_at)])));
        body.appendChild(small(L('Purchases by package', 'المشتريات حسب الباقة'), [L('Product', 'المنتج'), L('Platform', 'المنصة'), L('Purchases', 'عمليات'), L('Coins', 'العملات')],
          (w.topups_by_package || []).map((x) => [x.product_id, x.platform, num(x.count), num(x.coins)])));
        body.appendChild(small(L('Gifts by type', 'الهدايا حسب النوع'), [L('Gift', 'الهدية'), L('Sent', 'مرسلة'), L('Coins', 'العملات')],
          (w.gifts_by_type || []).map((x) => [(x.emoji || '') + ' ' + (LANG === 'ar' ? x.name : (x.name_en || x.name || x.gift_id)), num(x.count), num(x.coins)])));
        body.appendChild(small(L('Top gift receivers', 'الأكثر تلقيًا للهدايا'), [L('User', 'المستخدم'), L('Gifts', 'الهدايا'), L('Coins', 'العملات')],
          (w.top_receivers || []).map((x) => [userLink(x.user_id, x.handle, x.name), num(x.gifts), num(x.coins)])));
        body.appendChild(small(L('Top gift senders', 'الأكثر إرسالًا للهدايا'), [L('User', 'المستخدم'), L('Gifts', 'الهدايا'), L('Coins', 'العملات')],
          (w.top_senders || []).map((x) => [userLink(x.user_id, x.handle, x.name), num(x.gifts), num(x.coins)])));
        body.appendChild(small(L('Largest balances', 'أعلى الأرصدة'), [L('User', 'المستخدم'), L('Balance', 'الرصيد'), L('Updated', 'التحديث')],
          (w.top_balances || []).map((x) => [userLink(x.user_id, x.handle, x.name), num(x.balance), when(x.updated_at)])));
        body.appendChild(small(L('Recent purchases', 'أحدث المشتريات'), [L('User', 'المستخدم'), L('Status', 'الحالة'), L('Product', 'المنتج'), L('Platform', 'المنصة'), L('Coins', 'العملات'), L('When', 'الوقت')],
          (w.recent_topups || []).map((t) => [userLink(t.user_id, t.handle), badge(t.status, t.status === 'credited' ? 'ok' : t.status === 'pending' ? 'warn' : 'bad'), t.product_id || '-', t.platform + (t.environment ? ' / ' + t.environment : ''), num(t.coins), when(t.created_at)])));
        body.appendChild(small(L('Recent gifts', 'أحدث الهدايا'), [L('Gift', 'الهدية'), L('From', 'من'), L('To', 'إلى'), L('Coins', 'العملات'), L('When', 'الوقت')],
          (w.recent_gifts || []).map((g) => [(g.emoji || '') + ' ' + g.gift_id, g.from_handle ? '@' + g.from_handle : '-', g.to_handle ? '@' + g.to_handle : '-', num(g.amount), when(g.created_at)])));
      } catch (e) { body.innerHTML = ''; body.appendChild(errorBox(e)); }
    }
    drawTabs(); load();
    return [header(L('Coins & gifts', 'العملات والهدايا'), L('Overview of in-app coin purchases and live gifts.', 'نظرة على شراء العملات داخل التطبيق وهدايا البث.'), tb), body];
  }

  // ---------- storage ----------
  function viewStorage() {
    const body = h('div', {}, loading());
    async function load() {
      body.innerHTML = ''; body.appendChild(loading());
      try {
        const s = await API.storage();
        body.innerHTML = '';
        const sum = storageSummary(s);
        const self = sum.querySelector('.more'); if (self) self.remove(); // already on this page
        body.appendChild(sum);
        const twin = h('div', { class: 'twin' });
        const bucketTable = (title, rows) => h('section', { class: 'card' + (rows && rows.length ? ' flush' : '') }, [h('div', { class: 'card-head' }, h('h2', { text: title })), rows && rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, [
          h('thead', {}, h('tr', {}, [[L('Bucket', 'الحاوية')], [L('Files', 'الملفات'), 'num'], [L('Size', 'الحجم'), 'num']].map(([x, c]) => h('th', { text: x, class: c || null })))),
          h('tbody', {}, rows.map((b) => h('tr', {}, [h('td', { class: 'strong', text: b.bucket }), h('td', { class: 'num', text: num(b.files) }), h('td', { class: 'num', text: bytes(b.bytes) })]))),
        ])) : empty()]);
        twin.appendChild(bucketTable(L('Cloudflare R2 (media)', 'Cloudflare R2 (الوسائط)'), s.r2_buckets));
        twin.appendChild(bucketTable(L('Supabase Storage', 'تخزين Supabase'), s.supabase_buckets));
        body.appendChild(twin);
        const dq = s.delete_queue || {};
        body.appendChild(h('section', { class: 'card' }, [
          h('div', { class: 'card-head' }, h('div', { class: 'ch-l' }, [tile('trash'), h('h2', { text: L('Media delete queue', 'قائمة حذف الوسائط') })])),
          h('div', { class: 'chips' }, Object.keys(dq).length ? Object.keys(dq).map((k) => badge(k + ': ' + num(dq[k]), k === 'failed' ? 'bad' : '')) : [h('span', { class: 'muted', text: L('empty', 'فارغة') })]),
          h('p', { class: 'muted small', text: L('Uploads authorised but not yet confirmed: ', 'رفع مصرّح به ولم يُؤكَّد بعد: ') + num(s.r2_pending) }),
        ]));
        const lim = s.limits || {};
        const fields = [
          ['max_video_bytes', L('Max video size (MB)', 'أقصى حجم فيديو (MB)'), 1048576],
          ['user_daily_uploads', L('Uploads per user per day', 'عدد الرفع لكل مستخدم يوميًا'), 1],
          ['user_daily_bytes', L('Upload MB per user per day', 'ميجابايت لكل مستخدم يوميًا'), 1048576],
          ['global_max_bytes', L('Total storage ceiling (GB)', 'سقف التخزين الكلي (GB)'), 1073741824],
        ];
        const inputs = {};
        const form = h('div', { class: 'form' }, fields.map(([k, label, unit]) => {
          const i = h('input', { type: 'number', min: '0', step: unit === 1 ? '1' : '0.1', class: 'input' });
          i.value = lim[k] != null ? String(Math.round((Number(lim[k]) / unit) * 10) / 10) : '';
          inputs[k] = [i, unit];
          return h('label', { class: 'lbl' }, [label, i]);
        }));
        body.appendChild(h('section', { class: 'card' }, [
          h('div', { class: 'card-head' }, h('div', { class: 'ch-l' }, [tile('gauge'), h('h2', { text: L('Upload limits', 'حدود الرفع') })])),
          form,
          h('div', { class: 'actions' }, btn(L('Save limits', 'حفظ الحدود'), async () => {
            const patch = {};
            for (const k of Object.keys(inputs)) {
              const [i, unit] = inputs[k];
              const v = Number(i.value);
              if (!Number.isFinite(v) || v <= 0) { toast(L('Every limit must be a positive number', 'يجب أن تكون كل الحدود أرقامًا موجبة'), true); return; }
              patch[k] = Math.round(v * unit);
            }
            if (!(await confirmBox(L('Save new limits?', 'حفظ الحدود الجديدة؟'), L('Raising the storage ceiling can raise the hosting bill.', 'رفع سقف التخزين قد يرفع فاتورة الاستضافة.'), L('Save', 'حفظ')))) return;
            await API.updateLimits(patch); toast(L('Saved', 'تم الحفظ')); load();
          }, 'primary')),
        ]));
      } catch (e) { body.innerHTML = ''; body.appendChild(errorBox(e)); }
    }
    load();
    return [header(L('Storage & limits', 'التخزين والحدود'), L('Uploads stop when the total reaches the ceiling. Admins are emailed at 70%, 85% and 95%.', 'يتوقف الرفع عند بلوغ السقف. يُرسَل تنبيه للمشرفين عند 70% و85% و95%.')), body];
  }

  // ---------- audit log ----------
  function viewLogs() {
    const body = h('div', {}, loading());
    (async () => {
      try {
        const rows = await API.logs(300);
        body.innerHTML = '';
        setCount(ph.count, rows.length);
        if (!rows.length) { body.appendChild(empty()); return; }
        const tb = h('tbody');
        rows.forEach((r) => tb.appendChild(h('tr', {}, [
          h('td', { 'data-l': L('When', 'الوقت'), class: 'dim nowrap' }, when(r.created_at)),
          h('td', { 'data-l': L('Admin', 'المشرف'), class: 'strong' }, r.admin ? '@' + (r.admin.handle || r.admin.name || '?') : '-'),
          h('td', { 'data-l': L('Action', 'الإجراء') }, h('code', { class: 'tag-code', text: r.action })),
          h('td', { 'data-l': L('Target', 'الهدف') }, r.target_type === 'user' && r.target_id ? userLink(r.target_id, null, r.target_id.slice(0, 8)) : (r.target_type || '') + (r.target_id ? ' ' + String(r.target_id).slice(0, 8) : '')),
          h('td', { 'data-l': L('Details', 'التفاصيل') }, r.payload ? h('code', { class: 'small', text: JSON.stringify(r.payload).slice(0, 160) }) : ''),
        ])));
        body.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, [h('thead', {}, h('tr', {}, [L('When', 'الوقت'), L('Admin', 'المشرف'), L('Action', 'الإجراء'), L('Target', 'الهدف'), L('Details', 'التفاصيل')].map((x) => h('th', { text: x })))), tb])));
      } catch (e) { body.innerHTML = ''; body.appendChild(errorBox(e)); }
    })();
    const ph = header(L('Audit log', 'سجل الأنشطة'), L('Every admin action, newest first.', 'كل إجراءات المشرفين، الأحدث أولًا.'), null, true);
    return [ph, body];
  }

  // ---------- usage watcher: R2 + Agora (0129) ----------
  // Neither Cloudflare R2 nor Agora has a hard spending cap. The database
  // estimates this month's usage from its own tables every hour and raises
  // an alert at 70 / 85 / 95 / 100% of the limits set on the Usage page.
  let USAGE_OPEN = [];
  const USAGE_ORDER = ['agora_minutes', 'r2_class_a', 'r2_class_b', 'r2_storage'];
  const USAGE_METRIC = () => ({
    r2_storage: L('Cloudflare R2 storage', 'تخزين Cloudflare R2'),
    r2_class_a: L('R2 Class A operations (writes, this month)', 'عمليات R2 من الفئة A (كتابة، هذا الشهر)'),
    r2_class_b: L('R2 Class B operations (reads, this month)', 'عمليات R2 من الفئة B (قراءة، هذا الشهر)'),
    agora_minutes: L('Agora participant-minutes (this month)', 'دقائق المشاركين في Agora (هذا الشهر)'),
  });
  const USAGE_NOTE = () => ({
    r2_storage: L('Measured from the upload ledger (sizes reported by R2) plus the baseline below. Objects the ledger does not know about (the old project in the same bucket, abandoned uploads) are only included through the baseline.',
      'مقاس من سجل الرفع (الأحجام كما يبلّغ عنها R2) مضافًا إليه خط الأساس أدناه. الملفات غير المسجّلة (المشروع القديم في نفس الحاوية، الرفع المتروك) لا تُحسب إلا عبر خط الأساس.'),
    r2_class_a: L('Upper bound: one operation per upload link issued this month. Writes made by the old project are not included. Real figure: Cloudflare → R2 → Metrics.',
      'حد أعلى: عملية واحدة لكل رابط رفع صدر هذا الشهر. لا يشمل كتابات المشروع القديم. الرقم الفعلي: Cloudflare ← R2 ← Metrics.'),
    r2_class_b: L('Lower bound only: the server check after each upload. Viewers downloading media through the CDN cannot be seen from the database - check Cloudflare → R2 → Metrics for the real number.',
      'حد أدنى فقط: فحص الخادم بعد كل رفع. تنزيلات المشاهدين عبر CDN لا تظهر في قاعدة البيانات - راجع Cloudflare ← R2 ← Metrics للرقم الفعلي.'),
    agora_minutes: L('Estimate: calls (join to leave), live hosts and listeners, walkie (one hour per token, overlaps merged). Audio and video share the free 10,000 minutes. Real figure: Agora Console → Usage.',
      'تقدير: المكالمات (من الانضمام إلى المغادرة)، مضيفو البث والمستمعون، اللاسلكي (ساعة لكل رمز مع دمج التداخل). الصوت والفيديو يتشاركان 10,000 دقيقة مجانية. الرقم الفعلي: Agora Console ← Usage.'),
  });
  const USAGE_ACCURACY = () => ({
    measured: L('measured', 'مقاس'), upper_bound: L('upper bound', 'حد أعلى'),
    lower_bound: L('lower bound', 'حد أدنى'), estimate: L('estimate', 'تقدير'),
  });
  const USAGE_BAND = (b) => ({ 0: L('normal', 'طبيعي'), 1: '70%+', 2: '85%+', 3: '95%+', 4: L('over limit', 'تجاوز الحد') })[Number(b) || 0];
  function usageValue(metric, v) {
    if (metric === 'r2_storage') return bytes(v);
    return num(Math.round(Number(v || 0))) + ' ' + (metric === 'agora_minutes' ? L('min', 'دقيقة') : L('ops', 'عملية'));
  }
  function usageTone(pct) { pct = Number(pct || 0); return pct >= 85 ? 'bad' : pct >= 70 ? 'warn' : ''; }

  // The banner sits above the top bar on every page. Drawn from USAGE_OPEN,
  // which refreshCounts() reloads after each render.
  function usageBanner() {
    const slot = h('div', { class: 'ubanner-slot' });
    drawUsageBanner(slot);
    return slot;
  }
  function drawUsageBanner(slot) {
    slot.replaceChildren();
    const open = USAGE_OPEN.filter((a) => Number(a.pct) >= 70);
    if (!open.length) return;
    const M = USAGE_METRIC();
    const worst = Math.max(...open.map((a) => Number(a.pct)));
    slot.appendChild(h('div', { class: 'ubanner ' + (worst >= 85 ? 'bad' : 'warn'), role: 'alert' }, [
      tile('warn', worst >= 85 ? 'red' : 'amber'),
      h('div', { class: 'ub-text' }, [
        h('strong', { text: L('Usage alert - Cloudflare R2 and Agora have no spending cap', 'تنبيه استخدام - لا يوجد حد للإنفاق في Cloudflare R2 و Agora') }),
        h('ul', {}, open.map((a) => h('li', {}, [
          h('b', { text: Number(a.pct) + '%' }), ' ',
          (M[a.metric] || a.metric) + ' · ' + usageValue(a.metric, a.value) + ' / ' + usageValue(a.metric, a.limit_value),
          h('span', { class: 'ub-when', text: ' · ' + ago(a.created_at) }),
        ]))),
      ]),
      h('div', { class: 'ub-actions' }, [
        h('a', { href: '#/usage', class: 'btn small' }, [L('Details', 'التفاصيل'), icon('arrowR')]),
        btn(L('Acknowledge', 'تم الاطلاع'), async () => {
          await Promise.all(open.map((a) => API.ackUsageAlert(a.id)));
          USAGE_OPEN = [];
          COUNTS.usage_open = 0;
          document.querySelectorAll('.ubanner-slot').forEach(drawUsageBanner);
          toast(L('Acknowledged. You will be alerted again if usage climbs further.', 'تم. ستصلك تنبيهات جديدة إذا ارتفع الاستخدام أكثر.'));
          if (parseHash().path === 'usage') render(); else refreshCounts();
        }, 'small'),
      ]),
    ]));
  }

  function viewUsage() {
    const body = h('div', {}, loading());
    const sub = h('p', { class: 'muted', text: L('Estimated from FLYP\'s own data for the current month (UTC). The Cloudflare and Agora dashboards are the real meters.', 'تقديرات من بيانات FLYP للشهر الحالي (UTC). لوحات Cloudflare و Agora هي العدّادات الفعلية.') });
    async function load() {
      body.replaceChildren(loading());
      let u;
      try { u = await API.usage(); } catch (e) {
        body.replaceChildren(e && e.message === 'MIGRATION_MISSING'
          ? h('div', { class: 'notice bad', text: L('The database is missing migration 0129_usage_watch.sql. Apply it in the Supabase SQL editor (Mumbai project).', 'قاعدة البيانات تفتقد الترحيل 0129_usage_watch.sql. طبّقه في محرر SQL لمشروع Mumbai.') })
          : errorBox(e));
        return;
      }
      body.replaceChildren();
      const M = USAGE_METRIC(); const NOTE = USAGE_NOTE(); const ACC = USAGE_ACCURACY();
      const metrics = u.metrics || {};
      sub.textContent = L('Estimated from FLYP\'s own data for ', 'تقديرات من بيانات FLYP لشهر ') + String(u.month || '').slice(0, 7) +
        L(' (UTC), computed ', ' (UTC)، حُسبت ') + ago(u.computed_at) + L('. The Cloudflare and Agora dashboards are the real meters.', '. لوحات Cloudflare و Agora هي العدّادات الفعلية.');

      // ---- one card per metric ----
      const grid = h('div', { class: 'ugrid' });
      USAGE_ORDER.forEach((k) => {
        const m = metrics[k];
        if (!m) return;
        const pct = Number(m.pct || 0);
        const tone = usageTone(pct);
        const b = m.breakdown || {};
        let extra = null;
        if (k === 'agora_minutes') {
          extra = h('div', { class: 'chips breakdown' }, [
            [L('calls · audio', 'مكالمات · صوت'), b.calls_audio], [L('calls · video', 'مكالمات · فيديو'), b.calls_video],
            [L('live hosts', 'مضيفو البث'), b.live_hosts], [L('live listeners', 'مستمعو البث'), b.live_audience],
            [L('older lives (guessed)', 'بث أقدم (تقديري)'), b.live_audience_guess], [L('walkie', 'اللاسلكي'), b.walkie],
          ].map(([label, v]) => h('span', { class: 'badge' }, label + ': ' + num(v))));
        } else if (k === 'r2_storage') {
          extra = h('p', { class: 'muted small', text: L('Ledger ', 'السجل ') + bytes(b.ledger_bytes) + ' · ' + num(b.objects) + L(' files', ' ملف') +
            (Number(b.baseline_bytes) ? L(' · baseline ', ' · خط الأساس ') + bytes(b.baseline_bytes) : '') });
        }
        grid.appendChild(h('section', { class: 'card umetric ' + tone }, [
          h('div', { class: 'um-head' }, [
            h('div', { class: 'ch-l' }, [tile(k === 'agora_minutes' ? 'live' : k === 'r2_storage' ? 'database' : 'refresh', tone === 'bad' ? 'red' : tone === 'warn' ? 'amber' : ''), h('h2', { text: M[k] || k })]),
            h('span', { class: 'badge ' + (m.accuracy === 'measured' ? 'ok' : m.accuracy === 'lower_bound' ? 'bad' : 'warn'), text: ACC[m.accuracy] || m.accuracy }),
          ]),
          h('div', { class: 'um-num' }, [
            h('strong', { text: pct + '%' }),
            h('span', { class: 'muted', text: usageValue(k, m.value) + ' / ' + usageValue(k, m.limit) }),
            Number(m.band) ? badge(USAGE_BAND(m.band), tone || 'warn') : null,
          ]),
          h('div', { class: 'meter' + (tone ? ' ' + tone : ''), role: 'meter', 'aria-label': M[k] || k, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.min(100, pct)) },
            h('div', { style: { width: Math.min(100, pct) + '%' } })),
          extra,
          h('p', { class: 'muted small', text: NOTE[k] }),
        ]));
      });
      body.appendChild(grid);

      // ---- alert history ----
      const alerts = u.alerts || [];
      const openCount = alerts.filter((a) => !a.acknowledged_at).length;
      const tb = h('tbody');
      alerts.forEach((a) => tb.appendChild(h('tr', {}, [
        h('td', { 'data-l': L('When', 'الوقت'), class: 'dim nowrap' }, when(a.created_at)),
        h('td', { 'data-l': L('Metric', 'المقياس'), class: 'strong' }, M[a.metric] || a.metric),
        h('td', { 'data-l': L('Level', 'المستوى') }, [badge(Number(a.pct) + '%', usageTone(a.pct) || 'warn'), ' ', USAGE_BAND(a.band)]),
        h('td', { 'data-l': L('Usage / limit', 'الاستخدام / الحد') }, usageValue(a.metric, a.value) + ' / ' + usageValue(a.metric, a.limit_value)),
        h('td', { 'data-l': L('Email', 'البريد') }, a.emailed_at ? h('span', { class: 'small', text: L('handed to mailer ', 'سُلّم للمرسل ') + ago(a.emailed_at) })
          : a.email_pending ? badge(L('pending', 'معلّق'), 'warn') : h('span', { class: 'muted small', text: L('not sent', 'لم يُرسل') })),
        h('td', { 'data-l': L('Acknowledged', 'تم الاطلاع') }, a.acknowledged_at
          ? h('span', { class: 'small', text: (a.acknowledged_by_handle ? '@' + a.acknowledged_by_handle + ' · ' : '') + ago(a.acknowledged_at) })
          : btn(L('Acknowledge', 'تم الاطلاع'), async () => { await API.ackUsageAlert(a.id); toast(L('Acknowledged', 'تم')); refreshCounts(); load(); }, 'small')),
      ])));
      body.appendChild(h('section', { class: 'card' + (alerts.length ? ' flush' : '') }, [
        h('div', { class: 'card-head' }, [
          h('h2', { text: L('Alert history', 'سجل التنبيهات') }),
          openCount ? btn(L('Acknowledge all', 'تأكيد الاطلاع على الكل'), async () => { await API.ackUsageAlert(null); toast(L('Acknowledged', 'تم')); refreshCounts(); load(); }, 'small') : null,
        ]),
        alerts.length
          ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, [
            h('thead', {}, h('tr', {}, [L('When', 'الوقت'), L('Metric', 'المقياس'), L('Level', 'المستوى'), L('Usage / limit', 'الاستخدام / الحد'), L('Email', 'البريد'), L('Acknowledged', 'تم الاطلاع')].map((x) => h('th', { text: x })))),
            tb]))
          : empty(L('No alerts yet.', 'لا توجد تنبيهات بعد.')),
      ]));

      // ---- limits ----
      const lim = u.limits || {};
      const GB = 1073741824;
      const fields = [
        ['r2_storage_bytes_limit', 'r2_storage_bytes', L('R2 storage limit (GB)', 'حد تخزين R2 (GB)'), GB, L('Free: 10 GB, then about $0.015 per GB-month', 'المجاني: 10 GB، ثم نحو 0.015$ لكل GB شهريًا'), false],
        ['r2_storage_baseline_bytes', 'r2_storage_baseline_bytes', L('R2 data not in the ledger (GB)', 'بيانات R2 خارج السجل (GB)'), GB, L('Added to the measured size, e.g. the old project\'s library in the same bucket', 'تُضاف إلى الحجم المقاس، مثل مكتبة المشروع القديم في نفس الحاوية'), true],
        ['r2_class_a_ops_monthly_limit', 'r2_class_a_ops', L('R2 Class A ops per month', 'عمليات R2 الفئة A شهريًا'), 1, L('Free: 1,000,000, then about $4.50 per million', 'المجاني: 1,000,000، ثم نحو 4.50$ لكل مليون'), false],
        ['r2_class_b_ops_monthly_limit', 'r2_class_b_ops', L('R2 Class B ops per month', 'عمليات R2 الفئة B شهريًا'), 1, L('Free: 10,000,000, then about $0.36 per million', 'المجاني: 10,000,000، ثم نحو 0.36$ لكل مليون'), false],
        ['agora_minutes_monthly_limit', 'agora_minutes', L('Agora minutes per month', 'دقائق Agora شهريًا'), 1, L('Free: 10,000 (audio and video together)', 'المجاني: 10,000 (الصوت والفيديو معًا)'), false],
      ];
      const inputs = {};
      const form = h('div', { class: 'form' }, fields.map(([col, arg, label, unit, hint, zeroOk]) => {
        const i = h('input', { type: 'number', min: '0', step: unit === 1 ? '1' : '0.1', class: 'input' });
        i.value = lim[col] != null ? String(Math.round((Number(lim[col]) / unit) * 100) / 100) : '';
        inputs[arg] = [i, unit, zeroOk];
        return h('label', { class: 'lbl' }, [label, i, h('span', { class: 'hint', text: hint })]);
      }));
      const emails = h('textarea', { class: 'input', rows: 3, placeholder: 'name@example.com' });
      emails.value = (lim.alert_emails || []).join('\n');
      body.appendChild(h('section', { class: 'card' }, [
        h('div', { class: 'card-head' }, h('div', { class: 'ch-l' }, [tile('mail'), h('h2', { text: L('Limits and alert emails', 'الحدود وبريد التنبيهات') })])),
        h('p', { class: 'muted small', text: L('Alerts fire at 70%, 85%, 95% and 100% of each limit, and again every 24 h while at 85% or more. Every admin account is emailed and notified in the app; the addresses below are emailed as well.',
          'تُطلق التنبيهات عند 70% و85% و95% و100% من كل حد، ثم كل 24 ساعة ما دام الاستخدام 85% أو أكثر. يصل البريد والإشعار داخل التطبيق إلى كل حساب مشرف، وتصل رسالة أيضًا إلى العناوين أدناه.') }),
        form,
        h('label', { class: 'lbl' }, [L('Extra alert emails (one per line)', 'عناوين بريد إضافية للتنبيه (عنوان في كل سطر)'), emails]),
        h('div', { class: 'actions' }, btn(L('Save limits', 'حفظ الحدود'), async () => {
          const patch = {};
          for (const arg of Object.keys(inputs)) {
            const [i, unit, zeroOk] = inputs[arg];
            const v = Number(i.value);
            if (i.value === '' || !Number.isFinite(v) || v < 0 || (!zeroOk && v === 0)) {
              toast(L('Every limit must be a positive number', 'يجب أن تكون كل الحدود أرقامًا موجبة'), true); return;
            }
            patch[arg] = Math.round(v * unit);
          }
          const list = emails.value.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
          if (list.some((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))) { toast(L('One of the email addresses is not valid', 'أحد عناوين البريد غير صالح'), true); return; }
          if (list.length > 10) { toast(L('At most 10 extra addresses', '10 عناوين إضافية كحد أقصى'), true); return; }
          patch.alert_emails = list;
          if (!(await confirmBox(L('Save usage limits?', 'حفظ حدود الاستخدام؟'),
            L('Limits only decide when you are warned. They do not stop Cloudflare or Agora from billing.', 'الحدود تحدد وقت التنبيه فقط، ولا توقف Cloudflare أو Agora عن الفوترة.'), L('Save', 'حفظ')))) return;
          await API.setUsageLimits(patch);
          toast(L('Saved', 'تم الحفظ'));
          load();
        }, 'primary')),
        lim.updated_at ? h('p', { class: 'muted small', text: L('Last changed ', 'آخر تعديل ') + when(lim.updated_at) }) : null,
      ]));

      // ---- is anything going to reach you? ----
      const hl = u.health || {};
      const chip = (ok, label) => badge(label + ': ' + (ok === true ? L('OK', 'سليم') : ok === false ? L('missing', 'غير موجود') : L('unknown', 'غير معروف')),
        ok === true ? 'ok' : ok === false ? 'bad' : 'warn');
      body.appendChild(h('section', { class: 'card' }, [
        h('div', { class: 'card-head' }, h('div', { class: 'ch-l' }, [tile('bell'), h('h2', { text: L('Alert delivery', 'إيصال التنبيهات') })])),
        h('div', { class: 'chips' }, [
          chip(hl.cron_job, L('Hourly check (pg_cron)', 'الفحص كل ساعة (pg_cron)')),
          chip(hl.pg_net, 'pg_net'),
          chip(hl.mail_url_ok, L('Mail endpoint', 'عنوان دالة البريد')),
          chip(hl.mail_secret_ok, L('Mail secret', 'سر البريد')),
          chip(Number(hl.admins) > 0, L('Admin accounts', 'حسابات المشرفين') + ' (' + num(hl.admins) + ')'),
        ]),
        Number(hl.emails_pending) ? h('div', { class: 'notice warn', text: num(hl.emails_pending) + L(' alert email(s) not handed to the mailer yet. Check that the storage-alert function is deployed and RESEND_API_KEY / ALERT_FROM are set.', ' رسالة تنبيه لم تُسلَّم للمرسل بعد. تأكد من نشر دالة storage-alert وضبط RESEND_API_KEY و ALERT_FROM.') }) : null,
        h('p', { class: 'muted small', text: L('Set a usage alert in the Agora Console and a billing notification in Cloudflare as well - this page cannot see their real meters.', 'اضبط أيضًا تنبيه استخدام في Agora Console وإشعار فوترة في Cloudflare - هذه الصفحة لا ترى العدّادات الفعلية.') }),
      ]));
    }
    load();
    sub.className = 'ph-sub';
    const ph = header(L('Usage & billing', 'الاستخدام والفوترة'), null, btn([icon('refresh'), L('Refresh', 'تحديث')], () => load(), ''));
    ph.querySelector('.ph-t').appendChild(sub);
    return [ph, body];
  }

  // ---------- creator payouts (0130) ----------
  // Gifts earn diamonds; after the hold they can be withdrawn as SAR to a
  // verified Saudi IBAN. Every action is an admin_v2_* RPC that checks
  // is_admin(), writes admin_logs and notifies the creator.
  // replaceChildren() would print "null" for an empty slot; skip those.
  const put = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
  const fmtSar = (n) => new Intl.NumberFormat(LANG === 'ar' ? 'ar-SA' : 'en-GB', { style: 'currency', currency: 'SAR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
  const dia = (n) => num(n) + ' ' + L('diamonds', 'ماسة');
  const cleanIban = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();
  const fmtIban = (s) => cleanIban(s).replace(/(.{4})/g, '$1 ').trim();
  function maskIban(s) { const x = cleanIban(s); return x.length < 10 ? x : x.slice(0, 4) + ' •••• ' + x.slice(-4); }
  function maskId(s) { const x = String(s || ''); return x.length < 5 ? x : '•••• ' + x.slice(-4); }
  // Bank numbers stay left-to-right inside Arabic text.
  const ltr = (text, cls) => h('span', { class: 'iban' + (cls ? ' ' + cls : ''), dir: 'ltr', text });
  function copyText(text, what) {
    const done = () => toast((what || L('Copied', 'تم النسخ')) + ' ✓');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => toast(L('Could not copy', 'تعذّر النسخ'), true));
    } else toast(L('Could not copy', 'تعذّر النسخ'), true);
  }
  function ibanCell(iban, full) {
    return h('span', { class: 'iban-row' }, [
      ltr(full ? fmtIban(iban) : maskIban(iban)),
      h('button', { type: 'button', class: 'btn ghost small icon-only', 'aria-label': L('Copy IBAN', 'نسخ الآيبان'), title: L('Copy IBAN', 'نسخ الآيبان'),
        onclick: (e) => { e.stopPropagation(); copyText(cleanIban(iban), L('IBAN copied', 'تم نسخ الآيبان')); } }, icon('copy')),
    ]);
  }
  // dl.kv from [label, value] pairs; value may be a node; null rows are skipped.
  function kvList(pairs) {
    return h('dl', { class: 'kv' }, pairs.filter((x) => x && x[1] != null && x[1] !== '').flatMap(([k, v]) => [
      h('dt', { text: k }), h('dd', {}, typeof v === 'string' || typeof v === 'number' ? String(v) : v),
    ]));
  }
  const MIG0130 = () => h('div', { class: 'notice bad', role: 'alert' }, [icon('warn'), h('span', { text: L('The database is missing migration 0130_creator_payouts.sql. Apply it in the Supabase SQL editor (Mumbai project).', 'قاعدة البيانات تفتقد الترحيل 0130_creator_payouts.sql. طبّقه في محرر SQL لمشروع Mumbai.') })]);
  const payErrBox = (e) => (e && e.message === 'MIGRATION_MISSING' ? MIG0130() : errorBox(e));
  // The RPCs raise plain English messages; the common ones in Arabic too.
  function payErrText(e) {
    const m = (e && e.message) || '';
    const AR = {
      'a reason is required': 'السبب مطلوب', 'a bank reference is required': 'مرجع التحويل البنكي مطلوب',
      'you cannot approve your own withdrawal': 'لا يمكنك الموافقة على طلب سحب يخصك', 'you cannot pay your own withdrawal': 'لا يمكنك دفع طلب سحب يخصك',
      'you cannot review your own verification': 'لا يمكنك مراجعة التحقق الخاص بك', 'already paid out': 'تم صرفها بالفعل',
      NO_DOCUMENT: 'لا توجد صورة هوية لهذا الطلب',
    };
    if (m === 'NO_DOCUMENT') return L('No ID photo is stored for this submission.', AR.NO_DOCUMENT);
    if (LANG === 'ar' && AR[m]) return AR[m];
    if (/^withdrawal is /.test(m)) return L('This withdrawal changed in the meantime (' + m.slice(14) + '). Reload the list.', 'تغيّر هذا الطلب في هذه الأثناء (' + m.slice(14) + '). أعد تحميل القائمة.');
    return errText(e);
  }
  // Runs an action; on failure shows the payout-specific message.
  async function payRun(fn) { try { await fn(); return true; } catch (e) { toast(payErrText(e), true); return false; } }

  const ELIG = () => ({
    payouts_paused: L('payouts paused', 'السحب متوقف'), no_birth_date: L('no birth date', 'لا يوجد تاريخ ميلاد'),
    under_age: L('under the minimum age', 'دون السن الأدنى'), account_too_new: L('account too new', 'الحساب جديد جدًا'),
    account_restricted: L('account banned or closing', 'الحساب محظور أو قيد الإغلاق'), account_flagged: L('refund flag open', 'علامة استرداد مفتوحة'),
    on_hold: L('on admin hold', 'موقوف من الإدارة'), kyc_missing: L('no identity check', 'لا يوجد تحقق هوية'),
    kyc_pending: L('identity check pending', 'التحقق قيد المراجعة'), kyc_rejected: L('identity check rejected', 'التحقق مرفوض'),
    no_account: L('account deleted', 'الحساب محذوف'),
  });
  function withholdWhy(r) {
    if (!r) return '';
    if (r.startsWith('admin: ')) return L('admin: ', 'الإدارة: ') + r.slice(7);
    return ({
      unfunded_coins: L('unpaid coins (test, grants, re-gifted)', 'عملات غير مدفوعة (تجريبية أو ممنوحة أو مُعاد إهداؤها)'),
      sender_refund: L('sender refunded', 'المرسل استرد مشترياته'), sender_flagged: L('sender flagged', 'المرسل مُعلَّم'),
      creator_on_hold: L('creator on hold', 'صانع المحتوى موقوف'), '?': L('other', 'أخرى'),
    })[r] || r;
  }
  const W_TONE = { requested: 'warn', approved: 'ai', paid: 'ok', rejected: 'bad', cancelled: '' };
  const K_TONE = { pending: 'warn', approved: 'ok', rejected: 'bad' };
  const E_TONE = { pending: 'warn', available: 'ok', withheld: 'bad', reversed: 'bad', withdrawn: '' };

  // Red flags on an open withdrawal (spec: warn when any of these hold).
  function withdrawalIssues(w) {
    const out = [];
    if (Number(w.creator_available_diamonds) < 0) out.push(L('balance below zero', 'الرصيد بالسالب'));
    if (w.flagged) out.push(L('refund flag', 'علامة استرداد'));
    if (w.on_hold) out.push(L('on hold', 'موقوف'));
    if (w.kyc_status !== 'approved') out.push(L('ID not approved', 'الهوية غير مقبولة'));
    const el = w.eligibility;
    if (el && el.eligible === false) {
      const E = ELIG();
      (el.reasons || []).filter((r) => !['on_hold', 'account_flagged', 'kyc_missing', 'kyc_pending', 'kyc_rejected'].includes(r))
        .forEach((r) => out.push(E[r] || r));
    }
    return out;
  }
  const isOpen = (w) => w.status === 'requested' || w.status === 'approved';
  function issueChips(list) {
    return list.length ? list.map((x) => badge(x, 'bad')) : [badge(L('checks pass', 'الفحوص سليمة'), 'ok')];
  }

  // Reason dialog with inline validation; resolves to the trimmed text or null.
  function askReason(title, label, note, okLabel, danger, opts) {
    const o = opts || {};
    const input = o.multiline === false ? h('input', { type: 'text', class: 'input', maxlength: String(o.max || 500) }) : h('textarea', { rows: 3, class: 'input', maxlength: String(o.max || 500) });
    if (o.placeholder) input.placeholder = o.placeholder;
    const err = h('div', { class: 'notice bad', role: 'alert', hidden: true });
    input.addEventListener('input', () => { input.classList.remove('invalid'); err.hidden = true; });
    return modal(title, [
      ...[].concat(o.before || []),
      h('label', { class: 'lbl' }, [label, input]),
      note ? h('p', { class: 'muted small', text: note }) : null,
      ...[].concat(o.after || []),
      err,
    ], [
      { label: L('Cancel', 'إلغاء'), value: null },
      { label: okLabel, kind: danger ? 'danger' : 'primary', value: () => {
        const v = input.value.trim();
        const bad = o.optional ? null : !v ? (o.required || L('This is required.', 'هذا الحقل مطلوب.')) : o.check ? o.check(v) : null;
        if (bad) {
          err.textContent = bad; err.hidden = false;
          if (!v) { input.classList.add('invalid'); input.focus(); } // an empty field, not a failed extra check
          return KEEP;
        }
        return v;
      } },
    ]);
  }
  function withdrawalSummary(w) {
    return kvList([
      [L('Creator', 'صانع المحتوى'), (w.name || '-') + (w.handle ? ' · @' + w.handle : '')],
      [L('Account holder', 'صاحب الحساب'), w.legal_name || '-'],
      [L('Bank', 'البنك'), w.bank_name || '-'],
      [L('IBAN', 'الآيبان'), w.iban ? ibanCell(w.iban, true) : '-'],
      [L('Amount', 'المبلغ'), h('strong', { class: 'amt', text: fmtSar(w.amount_sar) })],
      [L('Diamonds', 'الماسات'), dia(w.diamonds) + ' × ' + Number(w.sar_per_diamond || 0).toFixed(4)],
    ]);
  }
  async function doApprove(w) {
    const issues = withdrawalIssues(w);
    const note = await askReason(L('Approve withdrawal', 'الموافقة على السحب'), L('Note for the audit log (optional)', 'ملاحظة لسجل الأنشطة (اختيارية)'),
      L('The creator is told it was approved. Pay it from the Approved tab once the bank transfer is sent.', 'سيُبلَّغ صانع المحتوى بالموافقة. ادفعه من تبويب "مقبولة" بعد إرسال التحويل البنكي.'),
      L('Approve', 'موافقة'), false, {
        multiline: false, optional: true,
        before: [withdrawalSummary(w), issues.length ? h('div', { class: 'notice bad' }, [icon('warn'), h('span', { text: L('Check first: ', 'تحقق أولًا: ') + issues.join(' · ') })]) : null],
      });
    if (note === null) return false;
    return payRun(async () => { await API.approveWithdrawal(w.id, note || null); toast(L('Approved. The creator was notified.', 'تمت الموافقة وأُبلغ صانع المحتوى.')); });
  }
  async function doMarkPaid(w) {
    const sent = h('input', { type: 'checkbox' });
    const ref = await askReason(L('Mark as paid', 'تأكيد الدفع'), L('Bank transfer reference', 'مرجع التحويل البنكي'),
      L('Shown to the creator. Only mark it paid after the money has actually been sent.', 'يظهر لصانع المحتوى. لا تؤكد الدفع إلا بعد إرسال المبلغ فعلًا.'),
      L('Mark paid', 'تأكيد الدفع'), false, {
        multiline: false, max: 120, placeholder: L('e.g. FT24301XYZ', 'مثال: FT24301XYZ'),
        required: L('Enter the bank reference.', 'أدخل مرجع التحويل البنكي.'),
        check: () => (sent.checked ? null : L('Confirm that the transfer was sent.', 'أكّد أن التحويل أُرسل.')),
        before: withdrawalSummary(w),
        after: h('label', { class: 'check' }, [sent, h('span', { text: L('I have sent this bank transfer.', 'أرسلتُ هذا التحويل البنكي.') })]),
      });
    if (ref === null) return false;
    return payRun(async () => { await API.markWithdrawalPaid(w.id, ref); toast(L('Marked paid. The creator was notified.', 'تم تأكيد الدفع وأُبلغ صانع المحتوى.')); });
  }
  async function doReject(w) {
    const reason = await askReason(L('Reject withdrawal', 'رفض السحب'), L('Reason (shown to the creator)', 'السبب (يظهر لصانع المحتوى)'),
      L('The diamonds go back to their available balance.', 'تعود الماسات إلى رصيده المتاح.'), L('Reject', 'رفض'), true,
      { before: withdrawalSummary(w), required: L('A reason is required.', 'السبب مطلوب.') });
    if (reason === null) return false;
    return payRun(async () => { await API.rejectWithdrawal(w.id, reason); toast(L('Rejected. The creator was notified.', 'تم الرفض وأُبلغ صانع المحتوى.')); });
  }
  // CSV for the bank upload. Cells that start like a formula are prefixed
  // so a spreadsheet does not execute them.
  function downloadCsv(name, header, rows) {
    const cell = (v) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function viewPayouts(q) {
    const TABS = ['requested', 'approved', 'paid', 'rejected'];
    let status = TABS.includes(q.status) ? q.status : 'requested';
    const kpis = h('div', {}, loading());
    const table = h('div', { class: 'table-wrap' });
    const stTabs = h('div');
    const tools = h('div', { class: 'ft-right' });
    let rows = [];
    function drawTabs() {
      put(stTabs, tabs([['requested', L('Requested', 'مطلوبة')], ['approved', L('Approved (to pay)', 'مقبولة (للدفع)')], ['paid', L('Paid', 'مدفوعة')], ['rejected', L('Rejected', 'مرفوضة')]], status, (v) => { status = v; drawTabs(); load(); }));
      put(tools, status === 'approved' ? btn([icon('download'), L('CSV for bank upload', 'ملف CSV للبنك')], () => {
        if (!rows.length) { toast(L('Nothing to export', 'لا يوجد ما يُصدَّر'), true); return; }
        downloadCsv('flyp-payouts-approved-' + new Date().toISOString().slice(0, 10) + '.csv', ['name', 'iban', 'bank', 'amount_sar', 'withdrawal_id'],
          rows.map((w) => [w.legal_name, cleanIban(w.iban), w.bank_name, Number(w.amount_sar).toFixed(2), w.id]));
      }, 'small') : null);
    }
    async function loadOverview() {
      try {
        const o = await API.payoutOverview();
        const c = o.config || {};
        const spd = Number(c.sar_per_diamond || 0);
        const req = o.requested || {}; const appr = o.approved || {};
        const pm = o.paid_this_month || {}; const pa = o.paid_all_time || {};
        const available = Math.max(0, Number(o.owed_sar || 0) - Number(req.sar || 0) - Number(appr.sar || 0));
        put(kpis,
          h('div', { class: 'grid stats c5' }, [
            stat(L('Owed to creators', 'المستحق لصناع المحتوى'), { text: fmtSar(o.owed_sar) }, null, '', 'diamond', dia(o.owed_diamonds)),
            stat(L('Available, not requested', 'متاح ولم يُطلب'), { text: fmtSar(available) }, null, '', 'coins', L('withdrawable now', 'قابل للسحب الآن')),
            stat(L('In hold period', 'في فترة الانتظار'), { text: fmtSar(Number(o.on_hold_diamonds || 0) * spd) }, null, '', 'hourglass', dia(o.on_hold_diamonds) + ' · ' + num(c.hold_days) + L(' days', ' أيام')),
            stat(L('Requested', 'طلبات سحب'), { text: fmtSar(req.sar) }, '#/payouts?status=requested', Number(req.count) ? 'warn' : '', 'inbox', num(req.count) + L(' open · approved ', ' مفتوحة · مقبولة ') + fmtSar(appr.sar)),
            stat(L('Paid this month', 'المدفوع هذا الشهر'), { text: fmtSar(pm.sar) }, '#/payouts?status=paid', '', 'check', num(pm.count) + L(' transfers · all time ', ' تحويلات · الإجمالي ') + fmtSar(pa.sar)),
          ]),
          c.active === false ? h('div', { class: 'notice warn', role: 'status' }, [icon('pause'), h('span', {}, [L('New withdrawal requests are paused. Creators keep earning. ', 'طلبات السحب الجديدة متوقفة، ويستمر صناع المحتوى في الربح. '), h('a', { href: '#/payout-settings', text: L('Payout settings', 'إعدادات الأرباح') })])]) : null,
          h('div', { class: 'notice info pay-rate' }, [
            h('span', {}, [L('1 diamond = ', '1 ماسة = '), h('strong', { text: Number(spd).toFixed(4) + ' ' + L('SAR', 'ر.س') }), L(' · minimum withdrawal ', ' · أدنى سحب '), h('strong', { text: fmtSar(c.min_withdraw_sar) }),
              Number(o.withheld_diamonds) ? L(' · withheld ', ' · محجوز ') + dia(o.withheld_diamonds) : '',
              Number(o.creators_on_hold) ? L(' · creators on hold: ', ' · صناع محتوى موقوفون: ') + num(o.creators_on_hold) : '']),
            h('a', { href: '#/payout-settings', class: 'more' }, [L('Settings', 'الإعدادات'), icon('arrowR')]),
          ]),
        );
        if ((o.top_owed || []).length) {
          const tb = h('tbody', {}, o.top_owed.map((x) => h('tr', { class: 'click', tabindex: '0', onclick: () => openPayoutCreator(x.user_id, x), onkeydown: (e) => { if (e.key === 'Enter') openPayoutCreator(x.user_id, x); } }, [
            h('td', { 'data-l': L('Creator', 'صانع المحتوى') }, h('div', { class: 'ucell' }, [avatar(null, x.name || x.handle), h('div', { class: 'u2' }, [h('div', { class: 'p1', text: x.name || '-' }), h('div', { class: 'p2', text: x.handle ? '@' + x.handle : '' })])])),
            h('td', { 'data-l': L('Diamonds', 'الماسات'), class: 'num' }, num(x.owed)),
            h('td', { 'data-l': L('Value', 'القيمة'), class: 'num' }, fmtSar(Math.floor(Number(x.owed || 0) * spd * 100) / 100)),
            h('td', { class: 'row-go', 'aria-hidden': 'true' }, icon('chevR')),
          ])));
          kpis.appendChild(h('details', { class: 'card flush fold' }, [
            h('summary', { class: 'card-head' }, [h('div', { class: 'ch-l' }, [tile('diamond'), h('h2', { text: L('Largest balances owed', 'أعلى الأرصدة المستحقة') })]), icon('chevR', 'fold-ic')]),
            h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, [
              h('thead', {}, h('tr', {}, [[L('Creator', 'صانع المحتوى')], [L('Diamonds', 'الماسات'), 'num'], [L('Value', 'القيمة'), 'num'], ['']].map(([x, cl]) => h('th', { text: x, class: cl || null })))), tb,
            ])),
          ]));
        }
      } catch (e) { put(kpis, payErrBox(e)); }
    }
    async function load() {
      put(table, loading());
      try {
        rows = await API.withdrawals(status, 200, 0);
        setCount(ph.count, rows.length);
        if (!rows.length) {
          put(table, empty(status === 'requested' ? L('No withdrawal requests waiting.', 'لا توجد طلبات سحب بانتظار المعالجة.') : status === 'approved' ? L('Nothing approved and waiting to be paid.', 'لا توجد طلبات مقبولة بانتظار الدفع.') : L('Nothing here.', 'لا يوجد شيء هنا.')));
          return;
        }
        const after = async (ok) => { if (ok) { load(); loadOverview(); refreshCounts(); } };
        const tb = h('tbody');
        rows.forEach((w) => {
          const issues = isOpen(w) ? withdrawalIssues(w) : [];
          let res;
          if (isOpen(w)) res = h('td', { 'data-l': L('Checks', 'الفحوص'), class: 'chips-td' }, issueChips(issues));
          else if (w.status === 'paid') res = h('td', { 'data-l': L('Bank reference', 'مرجع البنك') }, w.bank_reference ? h('code', { class: 'tag-code', text: w.bank_reference }) : '-');
          else res = h('td', { 'data-l': L('Reason', 'السبب'), class: 'dim clip-td', title: w.reject_reason || '' }, w.reject_reason || '-');
          const whenCol = w.status === 'paid' ? w.paid_at : w.status === 'rejected' ? w.rejected_at : w.status === 'approved' ? w.approved_at : w.requested_at;
          tb.appendChild(h('tr', { class: 'click' + (issues.length ? ' risk' : ''), tabindex: '0', onclick: () => openWithdrawal(w, () => after(true)), onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openWithdrawal(w, () => after(true)); } }, [
            h('td', { 'data-l': L('Creator', 'صانع المحتوى') }, h('div', { class: 'ucell' }, [avatar(null, w.name || w.handle), h('div', { class: 'u2' }, [h('div', { class: 'p1', text: w.name || '-' }), h('div', { class: 'p2', text: w.handle ? '@' + w.handle : L('(deleted)', '(محذوف)') })])])),
            h('td', { 'data-l': L('Amount', 'المبلغ'), class: 'num stack' }, [h('div', { class: 'amt', text: fmtSar(w.amount_sar) }), h('div', { class: 'p2', text: dia(w.diamonds) })]),
            h('td', { 'data-l': L('Bank account', 'الحساب البنكي'), class: 'stack' }, [h('div', { class: 'p1', text: w.legal_name || '-' }), h('div', { class: 'p2' }, [(w.bank_name || '') + ' · ', ltr(maskIban(w.iban))])]),
            h('td', { 'data-l': status === 'requested' ? L('Requested', 'طُلب') : status === 'approved' ? L('Approved', 'قُبل') : status === 'paid' ? L('Paid', 'دُفع') : L('Rejected', 'رُفض'), class: 'dim nowrap', title: when(whenCol) }, ago(whenCol)),
            res,
            h('td', { class: 'row-act' }, w.status === 'requested' ? h('div', { class: 'actions' }, [
              btn(L('Approve', 'موافقة'), async () => after(await doApprove(w)), 'primary small'),
              btn(L('Reject', 'رفض'), async () => after(await doReject(w)), 'danger small'),
            ]) : w.status === 'approved' ? h('div', { class: 'actions' }, [
              btn(L('Mark paid', 'تأكيد الدفع'), async () => after(await doMarkPaid(w)), 'primary small'),
              btn(L('Reject', 'رفض'), async () => after(await doReject(w)), 'danger small'),
            ]) : h('span', { class: 'row-go', 'aria-hidden': 'true' }, icon('chevR'))),
          ]));
        });
        put(table, h('table', { class: 'table dense' }, [
          h('thead', {}, h('tr', {}, [[L('Creator', 'صانع المحتوى')], [L('Amount', 'المبلغ'), 'num'], [L('Bank account', 'الحساب البنكي')],
            [status === 'requested' ? L('Requested', 'طُلب') : status === 'approved' ? L('Approved', 'قُبل') : status === 'paid' ? L('Paid', 'دُفع') : L('Rejected', 'رُفض')],
            [isOpen({ status }) ? L('Checks', 'الفحوص') : status === 'paid' ? L('Bank reference', 'مرجع البنك') : L('Reason', 'السبب')], ['']].map(([x, cl]) => h('th', { text: x, class: cl || null })))),
          tb,
        ]));
      } catch (e) { put(table, payErrBox(e)); }
    }
    const ph = header(L('Payouts', 'الأرباح والسحب'), L('Creators turn gift diamonds into SAR. Approve a request, send the bank transfer, then mark it paid with the bank reference.', 'يحوّل صناع المحتوى ماسات الهدايا إلى ريالات. وافق على الطلب، أرسل التحويل البنكي، ثم أكّد الدفع بمرجع البنك.'),
      btn([icon('refresh'), L('Refresh', 'تحديث')], () => { loadOverview(); load(); refreshCounts(); }), true);
    drawTabs(); loadOverview(); load();
    return [ph, kpis, h('section', { class: 'panel' }, [h('div', { class: 'filterbar in' }, [stTabs, tools]), table])];
  }

  async function openWithdrawal(w, reload) {
    const issues = isOpen(w) ? withdrawalIssues(w) : [];
    const body = h('div', { class: 'udetail' }, [
      h('div', { class: 'ucell big' }, [avatar(null, w.name || w.handle), h('div', {}, [
        h('div', { class: 'name', text: w.name || '-' }),
        h('div', { class: 'muted' }, [w.user_id ? userLink(w.user_id, w.handle, w.name) : L('(deleted)', '(محذوف)')]),
        h('div', { class: 'muted small mono', text: 'id ' + w.id }),
      ])]),
      h('div', { class: 'chips' }, [badge(w.status, W_TONE[w.status] || ''), ...(isOpen(w) ? issueChips(issues) : [])]),
      issues.length ? h('div', { class: 'notice bad' }, [icon('warn'), h('span', { text: L('Look into this before paying: ', 'راجع هذا قبل الدفع: ') + issues.join(' · ') + (Number(w.creator_available_diamonds) < 0 ? L('. A negative balance means diamonds were withheld after the request (a sender refunded).', '. الرصيد السالب يعني أن ماسات حُجزت بعد الطلب (مرسل استرد مشترياته).') : '') })]) : null,
      kvList([
        [L('Amount', 'المبلغ'), h('strong', { class: 'amt', text: fmtSar(w.amount_sar) })],
        [L('Diamonds', 'الماسات'), dia(w.diamonds)],
        [L('Rate at request', 'السعر وقت الطلب'), Number(w.sar_per_diamond || 0).toFixed(4) + ' ' + L('SAR / diamond', 'ر.س / ماسة')],
        [L('Account holder', 'صاحب الحساب'), w.legal_name || '-'],
        [L('Bank', 'البنك'), w.bank_name || '-'],
        [L('IBAN', 'الآيبان'), w.iban ? ibanCell(w.iban, true) : '-'],
        [L('Identity check', 'التحقق من الهوية'), w.kyc_status ? badge(w.kyc_status, K_TONE[w.kyc_status] || '') : badge(L('none', 'لا يوجد'), 'bad')],
        [L('Creator balance now', 'رصيده الآن'), h('span', { class: Number(w.creator_available_diamonds) < 0 ? 'neg' : '', text: dia(w.creator_available_diamonds) + (Number(w.creator_withheld_diamonds) ? ' · ' + L('withheld ', 'محجوز ') + num(w.creator_withheld_diamonds) : '') })],
        [L('Requested', 'طُلب'), when(w.requested_at)],
        w.approved_at ? [L('Approved', 'قُبل'), when(w.approved_at)] : null,
        w.paid_at ? [L('Paid', 'دُفع'), when(w.paid_at)] : null,
        w.bank_reference ? [L('Bank reference', 'مرجع البنك'), h('code', { class: 'tag-code', text: w.bank_reference })] : null,
        w.rejected_at ? [L('Rejected', 'رُفض'), when(w.rejected_at)] : null,
        w.reject_reason ? [L('Reason', 'السبب'), w.reject_reason] : null,
        w.cancelled_at ? [L('Cancelled by the creator', 'ألغاه صانع المحتوى'), when(w.cancelled_at)] : null,
        w.admin_note ? [L('Admin note', 'ملاحظة الإدارة'), w.admin_note] : null,
      ]),
      w.user_id ? payoutSection(w.user_id, reload) : null,
    ]);
    const own = ME && w.user_id === ME.id;
    const acts = [{ label: L('Close', 'إغلاق'), value: null }];
    if (isOpen(w)) acts.push({ label: L('Reject…', 'رفض…'), value: 'reject', kind: 'danger' });
    if (w.status === 'requested' && !own) acts.push({ label: L('Approve…', 'موافقة…'), value: 'approve', kind: 'primary' });
    if (w.status === 'approved' && !own) acts.push({ label: L('Mark paid…', 'تأكيد الدفع…'), value: 'paid', kind: 'primary' });
    const a = await modal(L('Withdrawal', 'طلب السحب'), body, acts, { drawer: true });
    let ok = false;
    if (a === 'approve') ok = await doApprove(w);
    if (a === 'paid') ok = await doMarkPaid(w);
    if (a === 'reject') ok = await doReject(w);
    if (ok && reload) reload();
  }

  async function openPayoutCreator(userId, who) {
    const x = who || {};
    modal(L('Creator payouts', 'أرباح صانع المحتوى'), h('div', { class: 'udetail' }, [
      h('div', { class: 'ucell big' }, [avatar(null, x.name || x.handle), h('div', {}, [h('div', { class: 'name', text: x.name || '-' }), h('div', { class: 'muted' }, userLink(userId, x.handle, x.name))])]),
      payoutSection(userId, null, true),
    ]), null, { drawer: true });
  }

  // Shared dialogs used from the creator section and the settings page.
  async function askBackfill() {
    const since = h('input', { type: 'date', class: 'input', dir: 'ltr', max: new Date().toISOString().slice(0, 10) });
    since.value = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const err = h('div', { class: 'notice bad', role: 'alert', hidden: true });
    const v = await modal(L('Backfill missing earnings', 'استكمال الأرباح الناقصة'), [
      h('p', { text: L('Creates diamond earnings for gifts that have none (for every creator), using the same rules as a new gift: unpaid coins and risky senders are withheld, and the hold counts from the gift\'s own time. Gifts that already have earnings are skipped.', 'ينشئ أرباح الماسات للهدايا التي لا أرباح لها (لكل صناع المحتوى) بنفس قواعد الهدية الجديدة: تُحجز العملات غير المدفوعة والمرسلون المشبوهون، وتُحسب فترة الانتظار من وقت الهدية. تُتخطى الهدايا التي لها أرباح.') }),
      h('label', { class: 'lbl' }, [L('Gifts sent since', 'الهدايا المرسلة منذ'), since]),
      err,
    ], [
      { label: L('Cancel', 'إلغاء'), value: null },
      { label: L('Run backfill', 'تشغيل الاستكمال'), kind: 'primary', value: () => {
        if (!since.value || Number.isNaN(Date.parse(since.value))) { err.textContent = L('Pick a date.', 'اختر تاريخًا.'); err.hidden = false; return KEEP; }
        return new Date(since.value + 'T00:00:00Z').toISOString();
      } },
    ]);
    if (!v) return;
    await payRun(async () => {
      const r = await API.payoutBackfill(v);
      toast(num((r && r.rows) || 0) + L(' earnings created', ' سجل أرباح أُنشئ'));
    });
  }

  // Balances, verification, hold, earnings and withdrawals of one creator.
  // Used in the user drawer, the withdrawal drawer and the top-owed list.
  function payoutSection(userId, onChanged, standalone) {
    const sec = h('section', { class: 'paysec' + (standalone ? ' alone' : '') });
    const title = () => h('h4', { text: L('Creator payouts', 'أرباح صانع المحتوى') });
    async function load() {
      put(sec, standalone ? null : title(), loading());
      let d;
      try { d = await API.payoutCreator(userId); } catch (e) {
        if (e && e.message === 'MIGRATION_MISSING' && !standalone) { sec.remove(); return; }
        put(sec, standalone ? null : title(), payErrBox(e)); return;
      }
      const changed = () => { load(); if (onChanged) onChanged(); refreshCounts(); };
      const b = d.balance || {};
      const spd = Number(d.sar_per_diamond || 0);
      const val = (n) => fmtSar(Math.floor(Number(n || 0) * spd * 100) / 100);
      const box = (label, n, sub, tone) => h('div', { class: 'pbox' + (tone ? ' ' + tone : '') }, [h('div', { class: 'pl', text: label }), h('div', { class: 'pv', text: num(n) }), h('div', { class: 'ps', text: sub })]);
      const el = d.eligibility || {};
      const E = ELIG();
      const kids = [standalone ? null : title()];
      kids.push(h('div', { class: 'pgrid' }, [
        box(L('Available', 'متاح'), b.available, val(b.available), Number(b.available) < 0 ? 'bad' : ''),
        box(L('In hold period', 'في فترة الانتظار'), b.pending, b.next_release_at ? L('next ', 'التالي ') + num(b.next_release_diamonds) + ' · ' + when(b.next_release_at) : val(b.pending)),
        box(L('Withheld', 'محجوز'), b.withheld, val(b.withheld), Number(b.withheld) ? 'warn' : ''),
        box(L('In open requests', 'في طلبات مفتوحة'), b.reserved, fmtSar(b.reserved_sar)),
        box(L('Paid out', 'تم صرفه'), b.withdrawn, fmtSar(b.withdrawn_sar)),
        box(L('Earned in total', 'إجمالي الأرباح'), b.total, val(b.total)),
      ]));
      kids.push(h('div', { class: 'chips' }, [
        d.kyc ? badge(L('ID ', 'الهوية: ') + (WORDS()[d.kyc.status] || d.kyc.status), K_TONE[d.kyc.status] || '') : badge(L('no identity check', 'لا يوجد تحقق هوية'), 'warn'),
        el.eligible ? badge(L('can withdraw', 'يمكنه السحب'), 'ok') : (el.reasons || []).map((r) => badge(E[r] || r, r === 'kyc_pending' || r === 'account_too_new' ? 'warn' : 'bad')),
        el.account_days_left ? h('span', { class: 'muted small', text: L('eligible by age of account in ', 'يصبح مؤهلًا بعمر الحساب خلال ') + num(el.account_days_left) + L(' days', ' يومًا') }) : null,
      ].flat()));
      if (d.kyc) kids.push(h('p', { class: 'muted small' }, [(d.kyc.legal_name || '') + ' · ' + (d.kyc.bank_name || '') + ' · ', ltr(maskIban(d.kyc.iban))]));
      if (d.hold) {
        kids.push(h('div', { class: 'notice bad' }, [icon('pause'), h('span', { text: L('Payouts on hold since ', 'الأرباح موقوفة منذ ') + when(d.hold.held_at) + (d.hold.reason ? ' · ' + d.hold.reason : '') })]));
      }
      const wr = d.withheld_by_reason || {};
      if (Object.keys(wr).length) {
        kids.push(h('div', { class: 'chips breakdown' }, [h('span', { class: 'muted small', text: L('Withheld: ', 'المحجوز: ') }), ...Object.keys(wr).map((k) => h('span', { class: 'badge', text: withholdWhy(k) + ': ' + num(wr[k]) }))]));
      }
      const actionsEl = h('div', { class: 'actions' }, [
        d.hold
          ? btn([icon('check'), L('Release hold…', 'رفع الإيقاف…')], async () => {
            if (!(await confirmBox(L('Release this creator?', 'رفع الإيقاف عن صانع المحتوى؟'), L('Every withheld earning comes back, including automatic ones (unpaid coins, refunds, flagged senders), and is exempt from the automatic sender checks from now on.', 'تعود كل الأرباح المحجوزة، بما فيها المحجوزة آليًا (عملات غير مدفوعة، استردادات، مرسلون مُعلَّمون)، وتُستثنى من الفحوص الآلية للمرسلين من الآن.'), L('Release', 'رفع الإيقاف')))) return;
            if (await payRun(async () => { const r = await API.payoutHold(userId, false, null); toast(L('Released ', 'أُعيد ') + num((r && r.rows) || 0) + L(' earnings', ' سجل أرباح')); })) changed();
          }, 'primary small')
          : btn([icon('pause'), L('Hold payouts…', 'إيقاف الأرباح…')], async () => {
            const reason = await askReason(L('Hold payouts', 'إيقاف الأرباح'), L('Reason (audit log)', 'السبب (لسجل الأنشطة)'),
              L('Withholds every pending and available earning, new gifts arrive withheld, and withdrawal requests are refused until you release it.', 'تُحجز كل الأرباح المعلّقة والمتاحة، وتصل الهدايا الجديدة محجوزة، وتُرفض طلبات السحب حتى ترفع الإيقاف.'),
              L('Hold', 'إيقاف'), true, { required: L('A reason is required.', 'السبب مطلوب.') });
            if (reason === null) return;
            if (await payRun(async () => { const r = await API.payoutHold(userId, true, reason); toast(L('On hold · ', 'تم الإيقاف · ') + num((r && r.rows) || 0) + L(' earnings withheld', ' سجل محجوز')); })) changed();
          }, 'danger small'),
        btn([icon('refresh'), L('Backfill missing earnings…', 'استكمال الأرباح الناقصة…')], async () => { await askBackfill(); load(); }, 'ghost small'),
      ]);
      // Nothing earned, nothing submitted: one line plus the actions (an admin
      // can still hold an account before it earns).
      if (!Number(b.total) && !d.kyc && !(d.withdrawals || []).length && !d.hold) {
        put(sec, ...[standalone ? null : title(), h('p', { class: 'muted small', text: L('No gift earnings yet.', 'لا توجد أرباح هدايا بعد.') }), actionsEl].filter(Boolean));
        return;
      }
      kids.push(actionsEl);
      if ((d.top_senders || []).length) {
        kids.push(h('h4', { text: L('Top senders', 'أكثر المرسلين') }));
        kids.push(h('ul', { class: 'mini' }, d.top_senders.map((s) => h('li', { class: 'mini-row' }, [
          s.sender_id ? userLink(s.sender_id, s.handle) : h('span', { class: 'muted', text: L('(deleted)', '(محذوف)') }),
          s.flagged ? badge(L('flagged', 'مُعلَّم'), 'bad') : null,
          h('span', { class: 'mr-end', text: dia(s.diamonds) + ' · ' + num(s.gifts) + L(' gifts', ' هدية') }),
        ]))));
      }
      const handles = {};
      (d.top_senders || []).forEach((s) => { if (s.sender_id) handles[s.sender_id] = s.handle; });
      const earn = (d.recent_earnings || []).slice(0, 12);
      if (earn.length) {
        const act = (e2, action) => async () => {
          let reason = null;
          if (action !== 'release') {
            reason = await askReason(action === 'reverse' ? L('Reverse earning', 'إلغاء الربح نهائيًا') : L('Withhold earning', 'حجز الربح'), L('Reason (audit log)', 'السبب (لسجل الأنشطة)'),
              action === 'reverse' ? L('Permanent: these diamonds are removed from the creator\'s earnings and cannot be restored.', 'نهائي: تُزال هذه الماسات من أرباح صانع المحتوى ولا يمكن استعادتها.') : L('The diamonds stay withheld until released.', 'تبقى الماسات محجوزة حتى تُطلق.'),
              action === 'reverse' ? L('Reverse', 'إلغاء نهائي') : L('Withhold', 'حجز'), true, { required: L('A reason is required.', 'السبب مطلوب.') });
            if (reason === null) return;
          } else if (!(await confirmBox(L('Release this earning?', 'إطلاق هذا الربح؟'), L('It becomes available (or pending until its hold ends) and is exempt from the automatic sender checks.', 'يصبح متاحًا (أو معلّقًا حتى انتهاء الانتظار) ويُستثنى من الفحوص الآلية للمرسلين.'), L('Release', 'إطلاق')))) return;
          if (await payRun(async () => { await API.setEarning(e2.id, action, reason); toast(L('Saved', 'تم الحفظ')); })) changed();
        };
        kids.push(h('h4', { text: L('Recent earnings', 'أحدث الأرباح') }));
        kids.push(h('div', { class: 'table-wrap mini-table' }, h('table', { class: 'table' }, [
          h('thead', {}, h('tr', {}, [[L('When', 'الوقت')], [L('From', 'من')], [L('Diamonds', 'الماسات'), 'num'], [L('Status', 'الحالة')], ['']].map(([x, cl]) => h('th', { text: x, class: cl || null })))),
          h('tbody', {}, earn.map((e2) => h('tr', {}, [
            h('td', { 'data-l': L('When', 'الوقت'), class: 'dim nowrap', title: when(e2.created_at) }, ago(e2.created_at)),
            h('td', { 'data-l': L('From', 'من') }, e2.sender_id ? userLink(e2.sender_id, handles[e2.sender_id], String(e2.sender_id).slice(0, 8)) : '-'),
            h('td', { 'data-l': L('Diamonds', 'الماسات'), class: 'num' }, num(e2.diamonds)),
            h('td', { 'data-l': L('Status', 'الحالة') }, [badge(e2.status, E_TONE[e2.status] || ''), e2.withhold_reason ? h('div', { class: 'p2', text: withholdWhy(e2.withhold_reason) }) : null]),
            h('td', { class: 'row-act' }, h('div', { class: 'actions' }, [
              e2.status === 'pending' || e2.status === 'available' ? btn(L('Withhold', 'حجز'), act(e2, 'withhold'), 'ghost small') : null,
              e2.status === 'withheld' ? btn(L('Release', 'إطلاق'), act(e2, 'release'), 'small') : null,
              ['pending', 'available', 'withheld'].includes(e2.status) ? btn(L('Reverse', 'إلغاء'), act(e2, 'reverse'), 'danger small') : null,
            ])),
          ]))),
        ])));
      }
      if ((d.withdrawals || []).length) {
        kids.push(h('h4', { text: L('Withdrawals', 'طلبات السحب') }));
        kids.push(h('ul', { class: 'mini' }, d.withdrawals.slice(0, 10).map((x2) => h('li', { class: 'mini-row' }, [
          badge(x2.status, W_TONE[x2.status] || ''),
          h('strong', { class: 'amt', text: fmtSar(x2.amount_sar) }),
          h('span', { class: 'muted small', text: when(x2.requested_at) }),
          x2.bank_reference ? h('code', { class: 'tag-code', text: x2.bank_reference }) : null,
          x2.reject_reason ? h('span', { class: 'muted small', text: x2.reject_reason }) : null,
        ]))));
      }
      put(sec, ...kids.filter(Boolean));
    }
    load();
    return sec;
  }

  // ---------- identity checks (KYC) ----------
  function ageOn(dateStr) {
    if (!dateStr) return null;
    const b = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
    if (Number.isNaN(b.getTime())) return null;
    const n = new Date();
    let a = n.getFullYear() - b.getFullYear();
    if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
    return a;
  }
  function kycIssues(k) {
    const out = [];
    const age = ageOn(k.birth_date);
    if (Number(k.same_id_accounts) > 0) out.push([L('ID on ', 'الهوية على ') + num(k.same_id_accounts) + L(' other account(s)', ' حساب آخر'), 'bad']);
    if (Number(k.same_iban_accounts) > 0) out.push([L('IBAN on ', 'الآيبان على ') + num(k.same_iban_accounts) + L(' other account(s)', ' حساب آخر'), 'bad']);
    if (k.flagged) out.push([L('refund flag open', 'علامة استرداد مفتوحة'), 'bad']);
    if (age != null && age < 18) out.push([L('under 18 (', 'دون 18 (') + num(age) + ')', 'bad']);
    if (age == null) out.push([L('no birth date', 'لا يوجد تاريخ ميلاد'), 'warn']);
    if (k.owner_attested === false) out.push([L('not the account holder', 'ليس صاحب الحساب'), 'bad']);
    if (Number(k.submissions) > 1) out.push([L('attempt ', 'المحاولة ') + num(k.submissions), 'warn']);
    return out;
  }
  const ID_TYPE = () => ({ national_id: L('National ID', 'الهوية الوطنية'), iqama: L('Iqama', 'الإقامة') });

  function viewKyc(q) {
    let status = ['pending', 'approved', 'rejected', 'all'].includes(q.status) ? q.status : 'pending';
    const table = h('div', { class: 'table-wrap' });
    const stTabs = h('div');
    function drawTabs() { put(stTabs, tabs([['pending', L('Pending', 'قيد المراجعة')], ['approved', L('Approved', 'مقبولة')], ['rejected', L('Rejected', 'مرفوضة')], ['all', L('All', 'الكل')]], status, (v) => { status = v; drawTabs(); load(); })); }
    async function load() {
      put(table, loading());
      try {
        const rows = await API.kycList(status, 200, 0);
        setCount(ph.count, rows.length);
        if (!rows.length) { put(table, empty(status === 'pending' ? L('No identity checks waiting.', 'لا توجد طلبات تحقق بانتظار المراجعة.') : null)); return; }
        const tb = h('tbody');
        rows.forEach((k) => {
          const issues = kycIssues(k);
          const open = () => openKyc(k, () => { load(); refreshCounts(); });
          tb.appendChild(h('tr', { class: 'click' + (issues.some((x) => x[1] === 'bad') ? ' risk' : ''), tabindex: '0', onclick: open, onkeydown: (e) => { if (e.key === 'Enter') open(); } }, [
            h('td', { 'data-l': L('Creator', 'صانع المحتوى') }, h('div', { class: 'ucell' }, [avatar(null, k.name || k.handle), h('div', { class: 'u2' }, [h('div', { class: 'p1', text: k.name || '-' }), h('div', { class: 'p2', text: k.handle ? '@' + k.handle : '' })])])),
            h('td', { 'data-l': L('Legal name', 'الاسم القانوني'), class: 'strong' }, k.legal_name || '-'),
            h('td', { 'data-l': L('ID', 'الهوية'), class: 'stack' }, [h('div', { class: 'p1', text: ID_TYPE()[k.id_type] || k.id_type || '-' }), h('div', { class: 'p2' }, ltr(maskId(k.id_number)))]),
            h('td', { 'data-l': L('Bank account', 'الحساب البنكي'), class: 'stack' }, [h('div', { class: 'p1', text: k.bank_name || '-' }), h('div', { class: 'p2' }, ltr(maskIban(k.iban)))]),
            h('td', { 'data-l': status === 'pending' ? L('Submitted', 'أُرسل') : L('Status', 'الحالة'), class: 'dim nowrap', title: when(k.submitted_at) },
              status === 'pending' ? ago(k.submitted_at) : [badge(k.status, K_TONE[k.status] || ''), k.reviewed_by_handle ? h('div', { class: 'p2', text: '@' + k.reviewed_by_handle + ' · ' + ago(k.reviewed_at) }) : null]),
            h('td', { 'data-l': L('Checks', 'الفحوص'), class: 'chips-td' }, issues.length ? issues.map(([t, tone]) => badge(t, tone)) : badge(L('no red flags', 'لا مؤشرات خطر'), 'ok')),
            h('td', { class: 'row-go', 'aria-hidden': 'true' }, icon('chevR')),
          ]));
        });
        put(table, h('table', { class: 'table dense' }, [
          h('thead', {}, h('tr', {}, [L('Creator', 'صانع المحتوى'), L('Legal name', 'الاسم القانوني'), L('ID', 'الهوية'), L('Bank account', 'الحساب البنكي'), status === 'pending' ? L('Submitted', 'أُرسل') : L('Status', 'الحالة'), L('Checks', 'الفحوص'), ''].map((x) => h('th', { text: x })))),
          tb,
        ]));
      } catch (e) { put(table, payErrBox(e)); }
    }
    const ph = header(L('Identity checks', 'التحقق من الهوية'), L('Creators verify their legal name, ID and IBAN before their first withdrawal. Oldest first.', 'يتحقق صناع المحتوى من الاسم القانوني والهوية والآيبان قبل أول سحب. الأقدم أولًا.'), null, true);
    drawTabs(); load();
    return [ph, h('section', { class: 'panel' }, [h('div', { class: 'filterbar in' }, stTabs), table])];
  }

  async function openKyc(k, reload) {
    const age = ageOn(k.birth_date);
    const issues = kycIssues(k);
    // ID photo: fetched only on request; the RPC logs every view and the
    // signed link lives 120 s. Nothing is cached.
    const photo = h('div', { class: 'idphoto' });
    let timer = null;
    function photoIdle(note) {
      put(photo,
        h('div', { class: 'ch-l' }, [tile('idcard'), h('div', {}, [h('strong', { text: L('ID photo', 'صورة الهوية') }), h('p', { class: 'sc', text: note || L('Opens a private link valid for 2 minutes. Each view is recorded in the audit log.', 'يفتح رابطًا خاصًا صالحًا لدقيقتين. تُسجَّل كل مشاهدة في سجل الأنشطة.') })])]),
        btn(L('Show ID photo', 'عرض صورة الهوية'), showPhoto, 'small'),
      );
    }
    async function showPhoto() {
      put(photo, loading());
      try {
        const url = safeUrl(await API.kycPhotoUrl(k.id));
        if (!url) throw new Error('NO_DOCUMENT');
        const img = h('img', { src: url, alt: L('ID photo of ', 'صورة هوية ') + (k.legal_name || ''), referrerpolicy: 'no-referrer' });
        img.addEventListener('error', () => photoIdle(L('The photo could not be loaded (the link may have expired).', 'تعذّر تحميل الصورة (ربما انتهت صلاحية الرابط).')));
        put(photo, img, h('div', { class: 'idphoto-foot' }, [h('span', { class: 'muted small', text: L('Private link, expires in 2 minutes.', 'رابط خاص، تنتهي صلاحيته خلال دقيقتين.') }), btn(L('Hide', 'إخفاء'), () => { clearTimeout(timer); photoIdle(); }, 'ghost small')]));
        clearTimeout(timer);
        timer = setTimeout(() => { if (photo.isConnected) photoIdle(L('The link expired. Show it again if you need it.', 'انتهت صلاحية الرابط. اعرضه مجددًا إذا احتجت.')); }, 120000);
      } catch (e) { photoIdle(payErrText(e)); }
    }
    photoIdle();
    const body = h('div', { class: 'udetail' }, [
      h('div', { class: 'ucell big' }, [avatar(null, k.name || k.handle), h('div', {}, [
        h('div', { class: 'name', text: k.name || '-' }),
        h('div', { class: 'muted' }, [userLink(k.user_id, k.handle, k.name), ' · ' + L('account ', 'الحساب منذ ') + ago(k.account_created_at)]),
      ])]),
      h('div', { class: 'chips' }, [badge(k.status, K_TONE[k.status] || ''), ...issues.map(([t, tone]) => badge(t, tone))]),
      k.status === 'pending' ? h('div', { class: 'checklist' }, [
        h('strong', { text: L('Before you approve', 'قبل الموافقة') }),
        h('ul', {}, [
          L('The name on the ID matches the legal name.', 'الاسم في الهوية يطابق الاسم القانوني.'),
          L('The ID number matches the photo.', 'رقم الهوية يطابق الصورة.'),
          L('The photo is the front of the ID, readable and not expired.', 'الصورة لوجه الهوية، واضحة وغير منتهية.'),
          L('The IBAN account holder is the same person (call or confirm with the bank if in doubt).', 'صاحب حساب الآيبان هو الشخص نفسه (تواصل مع البنك عند الشك).'),
          L('No duplicates: the ID and IBAN are not used by another account.', 'لا تكرار: الهوية والآيبان غير مستخدمين في حساب آخر.'),
        ].map((t) => h('li', {}, [icon('check'), h('span', { text: t })]))),
      ]) : null,
      kvList([
        [L('Legal name', 'الاسم القانوني'), k.legal_name || '-'],
        [L('ID type', 'نوع الهوية'), ID_TYPE()[k.id_type] || k.id_type || '-'],
        [L('ID number', 'رقم الهوية'), k.id_number ? ltr(k.id_number) : '-'],
        [L('Birth date', 'تاريخ الميلاد'), k.birth_date ? h('span', { class: age != null && age < 18 ? 'neg' : '', text: String(k.birth_date).slice(0, 10) + (age != null ? ' · ' + num(age) + L(' years', ' سنة') : '') }) : L('not given', 'غير مسجل')],
        [L('IBAN', 'الآيبان'), k.iban ? ibanCell(k.iban, true) : '-'],
        [L('Bank', 'البنك'), k.bank_name || '-'],
        [L('Account holder attested', 'أقرّ بأنه صاحب الحساب'), k.owner_attested ? L('yes', 'نعم') : L('no', 'لا')],
        [L('Submissions', 'عدد الإرسال'), num(k.submissions)],
        [L('Submitted', 'أُرسل'), when(k.submitted_at)],
        k.reviewed_at ? [L('Reviewed', 'رُوجع'), (k.reviewed_by_handle ? '@' + k.reviewed_by_handle + ' · ' : '') + when(k.reviewed_at)] : null,
        k.reject_reason ? [L('Reason given', 'السبب المرسل'), k.reject_reason] : null,
      ]),
      photo,
    ]);
    const own = ME && ME.id === k.user_id;
    if (own) body.appendChild(h('div', { class: 'notice warn', text: L('This is your own verification. Another admin has to review it.', 'هذا تحققك الشخصي. يجب أن يراجعه مشرف آخر.') }));
    const acts = [{ label: L('Close', 'إغلاق'), value: null }];
    if (!own && k.status !== 'rejected') acts.push({ label: k.status === 'approved' ? L('Revoke…', 'سحب الموافقة…') : L('Reject…', 'رفض…'), value: 'reject', kind: 'danger' });
    if (!own && k.status !== 'approved') acts.push({ label: L('Approve…', 'موافقة…'), value: 'approve', kind: 'primary' });
    const a = await modal(L('Identity check', 'التحقق من الهوية'), body, acts, { drawer: true });
    clearTimeout(timer);
    let ok = false;
    if (a === 'approve') {
      const bad = issues.filter((x) => x[1] === 'bad').map((x) => x[0]);
      if (await confirmBox(L('Approve identity check?', 'الموافقة على التحقق؟'),
        (bad.length ? L('Red flags: ', 'مؤشرات خطر: ') + bad.join(' · ') + '. ' : '') + L('The creator is notified and can request withdrawals once the other conditions are met.', 'سيُبلَّغ صانع المحتوى ويمكنه طلب السحب عند استيفاء بقية الشروط.'),
        L('Approve', 'موافقة'))) {
        ok = await payRun(async () => { await API.kycReview(k.id, true, null); toast(L('Approved. The creator was notified.', 'تمت الموافقة وأُبلغ صانع المحتوى.')); });
      }
    }
    if (a === 'reject') {
      const reason = await askReason(L('Reject identity check', 'رفض التحقق'), L('Reason (shown to the creator)', 'السبب (يظهر لصانع المحتوى)'),
        L('Say what to fix, e.g. "The photo is blurred" or "The IBAN is not in your name". They can submit again.', 'وضّح ما يجب إصلاحه، مثل "الصورة غير واضحة" أو "الآيبان ليس باسمك". يمكنه الإرسال مجددًا.'),
        L('Reject', 'رفض'), true, { required: L('A reason is required.', 'السبب مطلوب.') });
      if (reason !== null) ok = await payRun(async () => { await API.kycReview(k.id, false, reason); toast(L('Rejected. The creator was notified.', 'تم الرفض وأُبلغ صانع المحتوى.')); });
    }
    if (ok && reload) reload();
  }

  // ---------- payout settings ----------
  function viewPayoutSettings() {
    const body = h('div', {}, loading());
    async function load() {
      put(body, loading());
      let o;
      try { o = await API.payoutOverview(); } catch (e) { put(body, payErrBox(e)); return; }
      const c = o.config || {};
      // [column, label, hint, decimals, min, max (null = none), min exclusive]
      const F = [
        ['sar_per_diamond', L('SAR per diamond', 'ريال لكل ماسة'), L('What one diamond pays out. Changes the value of every diamond not yet requested; open requests keep their own rate.', 'قيمة الماسة عند الصرف. يغيّر قيمة كل ماسة لم تُطلب بعد؛ الطلبات المفتوحة تحتفظ بسعرها.'), 4, 0, null, true],
        ['diamonds_per_coin', L('Diamonds per coin', 'ماسات لكل عملة'), L('How many diamonds the creator earns for each coin a gift costs.', 'عدد الماسات التي يربحها صانع المحتوى عن كل عملة في الهدية.'), 4, 0, null, true],
        ['min_withdraw_sar', L('Minimum withdrawal (SAR)', 'أدنى مبلغ للسحب (ر.س)'), L('Smallest amount a creator can request.', 'أقل مبلغ يمكن طلبه.'), 2, 0, null, true],
        ['hold_days', L('Hold period (days)', 'فترة الانتظار (أيام)'), L('Days before a gift\'s diamonds can be withdrawn (refund window). Only affects gifts received after the change.', 'الأيام قبل أن تصبح ماسات الهدية قابلة للسحب (مهلة الاسترداد). يؤثر فقط على الهدايا بعد التغيير.'), 0, 0, 365],
        ['min_account_age_days', L('Minimum account age (days)', 'أدنى عمر للحساب (أيام)'), L('Accounts younger than this cannot withdraw.', 'الحسابات الأحدث من ذلك لا يمكنها السحب.'), 0, 0, 3650],
        ['min_age', L('Minimum age (years)', 'أدنى سن (سنوات)'), L('From the birth date on the account. At least 18.', 'من تاريخ الميلاد في الحساب. 18 على الأقل.'), 0, 18, 100],
        ['refund_lookback_days', L('Refund look-back (days)', 'مدة مراجعة الاسترداد (أيام)'), L('A sender with a store refund in this window has their gifts withheld.', 'المرسل الذي استرد مشتريات خلال هذه المدة تُحجز هداياه.'), 0, 0, 365],
      ];
      const inputs = {};
      const fields = F.map(([col, label, hint, dp, min, max]) => {
        const i = h('input', { type: 'number', class: 'input', dir: 'ltr', inputmode: dp ? 'decimal' : 'numeric', step: dp ? String(Math.pow(10, -dp)) : '1', min: String(min), max: max == null ? null : String(max) });
        i.value = c[col] != null ? String(Number(c[col])) : '';
        const ferr = h('span', { class: 'ferr', role: 'alert', hidden: true });
        inputs[col] = { i, ferr };
        i.addEventListener('input', () => { i.classList.remove('invalid'); ferr.hidden = true; drawExample(); });
        return h('label', { class: 'lbl' + (col === 'sar_per_diamond' ? ' key' : '') }, [label, i, h('span', { class: 'hint', text: hint }), ferr]);
      });
      const active = h('select', { class: 'input' }, [h('option', { value: 'true' }, L('Open: creators can request withdrawals', 'مفتوح: يمكن طلب السحب')), h('option', { value: 'false' }, L('Paused: no new requests (earning continues)', 'متوقف: لا طلبات جديدة (الربح مستمر)'))]);
      active.value = c.active === false ? 'false' : 'true';
      const example = h('div', { class: 'pay-example' });
      function drawExample() {
        const spd = Number(inputs.sar_per_diamond.i.value); const dpc = Number(inputs.diamonds_per_coin.i.value); const mw = Number(inputs.min_withdraw_sar.i.value);
        if (!(spd > 0 && dpc > 0)) { put(example); return; }
        const d100 = Math.floor(100 * dpc);
        put(example,
          h('div', {}, [L('A gift of 100 coins earns ', 'هدية بقيمة 100 عملة تربح '), h('strong', { text: dia(d100) }), L(', worth ', '، قيمتها '), h('strong', { text: fmtSar(Math.floor(d100 * spd * 100) / 100) }), '.']),
          mw > 0 ? h('div', {}, [L('The minimum withdrawal of ', 'أدنى سحب '), h('strong', { text: fmtSar(mw) }), L(' needs ', ' يحتاج '), h('strong', { text: dia(Math.ceil(mw / spd)) }), '.']) : null,
        );
      }
      drawExample();
      const formErr = h('div', { class: 'notice bad', role: 'alert', hidden: true });
      function collect() {
        const patch = {}; let bad = 0;
        F.forEach(([col, , , dp, min, max, exclusive]) => {
          const { i, ferr } = inputs[col];
          const raw = i.value.trim(); const v = Number(raw);
          let msg = null;
          if (raw === '' || !Number.isFinite(v)) msg = L('Enter a number.', 'أدخل رقمًا.');
          else if (exclusive ? v <= min : v < min) msg = exclusive ? L('Must be more than ', 'يجب أن يكون أكبر من ') + min + '.' : L('At least ', 'على الأقل ') + min + '.';
          else if (max != null && v > max) msg = L('At most ', 'على الأكثر ') + max + '.';
          else if (!dp && !Number.isInteger(v)) msg = L('Whole numbers only.', 'أرقام صحيحة فقط.');
          else if (dp && Math.abs(Math.round(v * Math.pow(10, dp)) - v * Math.pow(10, dp)) > 1e-6) msg = L('At most ', 'حتى ') + dp + L(' decimal places.', ' منازل عشرية.');
          if (msg) { bad++; i.classList.add('invalid'); i.setAttribute('aria-invalid', 'true'); ferr.textContent = msg; ferr.hidden = false; return; }
          i.removeAttribute('aria-invalid');
          if (Number(c[col]) !== v) patch[col] = v;
        });
        const act = active.value === 'true';
        if ((c.active !== false) !== act) patch.active = act;
        return bad ? null : patch;
      }
      const LBL = Object.fromEntries(F.map((f) => [f[0], f[1]]));
      LBL.active = L('Withdrawals', 'السحب');
      const show = (k, v) => (k === 'active' ? (v === false ? L('paused', 'متوقف') : L('open', 'مفتوح')) : String(Number(v)));
      put(body, 
        h('section', { class: 'card' }, [
          h('div', { class: 'card-head' }, h('div', { class: 'ch-l' }, [tile('diamond', 'blue'), h('h2', { text: L('What a diamond is worth', 'قيمة الماسة') })])),
          h('p', { class: 'muted', text: L('Viewers buy coins in the app and send them as gifts. The creator earns diamonds for each coin (diamonds per coin), and each diamond pays out "SAR per diamond" when withdrawn. Apple and Google keep about 30% of a purchase; the rest is split with the creator.', 'يشتري المشاهدون العملات داخل التطبيق ويرسلونها هدايا. يربح صانع المحتوى ماسات عن كل عملة (ماسات لكل عملة)، وتُصرف كل ماسة بقيمة "ريال لكل ماسة" عند السحب. تحتفظ Apple و Google بنحو 30% من الشراء، ويُقسَّم الباقي مع صانع المحتوى.') }),
          h('div', { class: 'notice info' }, [icon('sliders'), h('span', {}, [
            h('strong', { text: L('Starting rule: ', 'القاعدة الأساسية: ') }),
            L('cheapest price per coin × 0.70 (after the store fee) × 0.50 (creator share), rounded down to 4 decimals: 0.0102 SAR with the current packages. Creators were promised in-app notice before a rate change.', 'أرخص سعر للعملة × 0.70 (بعد رسوم المتجر) × 0.50 (حصة صانع المحتوى)، مقرّبًا للأسفل إلى 4 منازل: 0.0102 ريال مع الباقات الحالية. وُعد صناع المحتوى بإشعار داخل التطبيق قبل تغيير السعر.'),
          ])]),
          example,
        ]),
        h('section', { class: 'card' }, [
          h('div', { class: 'card-head' }, h('div', { class: 'ch-l' }, [tile('sliders'), h('h2', { text: L('Payout rules', 'قواعد الصرف') })])),
          h('div', { class: 'form' }, [...fields, h('label', { class: 'lbl' }, [L('New withdrawal requests', 'طلبات السحب الجديدة'), active, h('span', { class: 'hint', text: L('Pausing stops new requests only. Open requests can still be paid.', 'الإيقاف يمنع الطلبات الجديدة فقط. يمكن دفع الطلبات المفتوحة.') })])]),
          formErr,
          h('div', { class: 'actions' }, [
            btn(L('Save changes', 'حفظ التغييرات'), async () => {
              formErr.hidden = true;
              const patch = collect();
              if (!patch) { formErr.textContent = L('Fix the highlighted fields.', 'صحّح الحقول المحددة.'); formErr.hidden = false; return; }
              const keys = Object.keys(patch);
              if (!keys.length) { toast(L('Nothing changed', 'لا توجد تغييرات')); return; }
              const warn = [];
              if ('sar_per_diamond' in patch) warn.push(L('The new rate applies to every diamond not yet requested. Tell creators in the app first.', 'السعر الجديد يسري على كل ماسة لم تُطلب بعد. أبلغ صناع المحتوى داخل التطبيق أولًا.'));
              if ('hold_days' in patch) warn.push(L('The hold period only changes for gifts received from now on.', 'فترة الانتظار تتغير للهدايا الجديدة فقط.'));
              if (patch.active === false) warn.push(L('New withdrawal requests will be refused until you open them again.', 'ستُرفض طلبات السحب الجديدة حتى تفتحها مجددًا.'));
              const ok = await modal(L('Save payout settings?', 'حفظ إعدادات الأرباح؟'), [
                kvList(keys.map((k2) => [LBL[k2], h('span', { class: 'chg' }, [ltr(show(k2, c[k2]), 'old'), h('span', { class: 'arrow', 'aria-hidden': 'true' }, icon('arrowR')), ltr(show(k2, patch[k2]))])])),
                warn.length ? h('ul', { class: 'warn-list' }, warn.map((t) => h('li', { text: t }))) : null,
                h('p', { class: 'muted small', text: L('The old and new values are kept in the audit log.', 'تُحفظ القيم القديمة والجديدة في سجل الأنشطة.') }),
              ], [{ label: L('Cancel', 'إلغاء'), value: false }, { label: L('Save', 'حفظ'), value: true, kind: 'sar_per_diamond' in patch || patch.active === false ? 'danger' : 'primary' }]);
              if (!ok) return;
              if (await payRun(async () => { await API.setPayoutConfig(patch); toast(L('Saved', 'تم الحفظ')); })) load();
            }, 'primary'),
          ]),
          c.updated_at ? h('p', { class: 'muted small', text: L('Last changed ', 'آخر تعديل ') + when(c.updated_at) }) : null,
        ]),
        h('section', { class: 'card' }, [
          h('div', { class: 'card-head' }, h('div', { class: 'ch-l' }, [tile('refresh'), h('h2', { text: L('Maintenance', 'الصيانة') })])),
          h('p', { class: 'muted', text: L('A gift never fails because of payouts: if creating its earning errors, the gift goes through and the earning is skipped. Backfill creates the missing earnings, after an incident or once at launch if gifts sent before payouts should count.', 'لا تفشل الهدية بسبب الأرباح: إذا تعذّر إنشاء ربحها تمر الهدية ويُتخطى الربح. الاستكمال ينشئ الأرباح الناقصة، بعد عطل أو مرة واحدة عند الإطلاق إذا تقرر احتساب الهدايا السابقة.') }),
          h('div', { class: 'actions' }, btn([icon('refresh'), L('Backfill missing earnings…', 'استكمال الأرباح الناقصة…')], () => askBackfill())),
        ]),
      );
    }
    load();
    return [header(L('Payout settings', 'إعدادات الأرباح'), L('Rates and rules for creator withdrawals. Every change is logged with the old and new values.', 'أسعار وقواعد سحب صناع المحتوى. يُسجَّل كل تغيير بالقيم القديمة والجديدة.')), body];
  }

  // ---------- router ----------
  const ROUTES = {
    dashboard: viewDashboard, reports: viewReports, users: viewUsers, videos: viewVideos,
    stories: viewStories, live: viewLive, moderation: viewModeration, tickets: viewTickets,
    deletions: viewDeletions, exports: viewExports, wallet: viewWallet, storage: viewStorage, logs: viewLogs,
    usage: viewUsage, payouts: viewPayouts, kyc: viewKyc, 'payout-settings': viewPayoutSettings,
  };
  function parseHash() {
    const raw = (location.hash || '#/dashboard').slice(2);
    const [path, qs] = raw.split('?');
    const q = {};
    new URLSearchParams(qs || '').forEach((v, k) => { q[k] = v; });
    return { path: path || 'dashboard', q };
  }

  let adminOk = false;
  let loginNote = null;
  let rendering = 0;
  async function render() {
    const my = ++rendering;
    const { path, q } = parseHash();
    if (path === 'login') {
      root.replaceChildren(viewLogin(loginNote));
      return;
    }
    if (!adminOk) {
      root.replaceChildren(h('div', { class: 'loading full', role: 'status' }, [brandMark('pulse'), h('span', { text: L('Checking access...', 'جارٍ التحقق من الصلاحيات...') })]));
      const s = await API.session();
      if (my !== rendering) return;
      if (!s) { location.replace('#/login'); root.replaceChildren(viewLogin()); return; }
      let ok = false;
      try { ok = await API.isAdmin(); } catch (e) { ok = false; }
      if (my !== rendering) return;
      if (!ok) {
        await API.signOut();
        // Kept for the hashchange re-render that location.replace triggers.
        loginNote = L('This account is not an admin on the new backend. Access refused.', 'هذا الحساب ليس مشرفًا على الخادم الجديد. تم رفض الدخول.');
        location.replace('#/login');
        root.replaceChildren(viewLogin(loginNote));
        return;
      }
      loginNote = null;
      adminOk = true;
      try { ME = await API.me(); } catch (e) { ME = null; }
    }
    const fn = ROUTES[path] || viewDashboard;
    const active = ROUTES[path] ? path : 'dashboard';
    root.replaceChildren(shell(active, fn(q)));
    window.scrollTo(0, 0);
    refreshCounts();
  }

  API.sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') { adminOk = false; ME = null; if (parseHash().path !== 'login') { location.hash = '#/login'; } }
  });
  window.addEventListener('hashchange', render);
  render();
})();
