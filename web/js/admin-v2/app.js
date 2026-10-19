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
  function errorBox(e) { return h('div', { class: 'notice bad', text: errText(e) }); }
  function loading() { return h('div', { class: 'loading', text: L('Loading...', 'جارٍ التحميل...') }); }
  function empty(msg) { return h('div', { class: 'empty', text: msg || L('Nothing here.', 'لا يوجد شيء هنا.') }); }

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
  function modal(title, body, actions) {
    return new Promise((resolve) => {
      const bd = h('div', { class: 'backdrop' });
      const close = (v) => { bd.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') close(null); };
      document.addEventListener('keydown', onKey);
      const foot = h('div', { class: 'm-foot' });
      (actions || [{ label: L('Close', 'إغلاق'), value: null }]).forEach((a) => {
        foot.appendChild(h('button', { type: 'button', class: 'btn ' + (a.kind || ''), onclick: () => close(typeof a.value === 'function' ? a.value() : a.value) }, a.label));
      });
      const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
        h('div', { class: 'm-head' }, [h('h3', { text: title }), h('button', { type: 'button', class: 'x', 'aria-label': L('Close', 'إغلاق'), onclick: () => close(null) }, '×')]),
        h('div', { class: 'm-body' }, body),
        foot,
      ]);
      bd.addEventListener('click', (e) => { if (e.target === bd) close(null); });
      bd.appendChild(box);
      document.body.appendChild(bd);
      const f = box.querySelector('input, textarea, select');
      if (f) f.focus();
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
      { k: 'dashboard', l: () => L('Dashboard', 'الرئيسية') },
      { k: 'moderation', l: () => L('AI screening log', 'سجل الفحص الآلي') },
    ] },
    { sec: () => L('Moderation', 'الإشراف'), items: [
      { k: 'reports', l: () => L('Reports', 'البلاغات'), badge: 'open_reports' },
      { k: 'videos', l: () => L('Videos', 'الفيديوهات') },
      { k: 'stories', l: () => L('Stories', 'القصص'), badge: 'reported_stories' },
      { k: 'live', l: () => L('Live streams', 'البث المباشر'), badge: 'live_now' },
    ] },
    { sec: () => L('Accounts', 'الحسابات'), items: [
      { k: 'users', l: () => L('Users', 'المستخدمون') },
      { k: 'tickets', l: () => L('Support tickets', 'تذاكر الدعم'), badge: 'open_tickets' },
      { k: 'deletions', l: () => L('Deletion queue', 'طلبات الحذف'), badge: 'pending_deletions' },
      { k: 'exports', l: () => L('Data requests', 'طلبات البيانات'), badge: 'pending_exports' },
    ] },
    { sec: () => L('System', 'النظام'), items: [
      { k: 'wallet', l: () => L('Coins & gifts', 'العملات والهدايا') },
      { k: 'storage', l: () => L('Storage & limits', 'التخزين والحدود') },
      { k: 'logs', l: () => L('Audit log', 'سجل الأنشطة') },
    ] },
  ];

  function shell(active, content) {
    const nav = h('nav', { class: 'side', 'aria-label': L('Sections', 'الأقسام') });
    nav.appendChild(h('div', { class: 'brand' }, [
      h('img', { src: '/icons/flyp-mark.png', alt: '', class: 'logo' }),
      h('div', {}, [h('strong', { text: 'FLYP Admin' }), h('span', { class: 'tag', text: 'v2 · Mumbai' })]),
    ]));
    NAV.forEach((g) => {
      nav.appendChild(h('div', { class: 'sec', text: g.sec() }));
      g.items.forEach((it) => {
        const n = Number(COUNTS[it.badge] || 0);
        nav.appendChild(h('a', { href: '#/' + it.k, class: 'nav' + (active === it.k ? ' on' : ''), 'aria-current': active === it.k ? 'page' : null }, [
          h('span', { text: it.l() }),
          it.badge && n ? h('span', { class: 'nb', text: n > 99 ? '99+' : String(n) }) : null,
        ]));
      });
    });
    const top = h('header', { class: 'top' }, [
      h('div', { class: 'who' }, [
        avatar(ME && ME.avatar, ME && (ME.name || ME.email)),
        h('div', {}, [h('div', { class: 'name', text: (ME && (ME.name || ME.handle)) || '' }), h('div', { class: 'muted small', text: (ME && ME.email) || '' })]),
      ]),
      h('div', { class: 'top-actions' }, [
        h('div', { class: 'lang' }, [
          h('button', { type: 'button', class: LANG === 'ar' ? 'on' : '', onclick: () => setLang('ar') }, 'AR'),
          h('button', { type: 'button', class: LANG === 'en' ? 'on' : '', onclick: () => setLang('en') }, 'EN'),
        ]),
        btn(L('Sign out', 'خروج'), async () => { await API.signOut(); location.hash = '#/login'; render(); }, 'ghost'),
      ]),
    ]);
    return h('div', { class: 'layout' }, [nav, h('main', { class: 'main' }, [top, h('div', { class: 'page' }, content)])]);
  }
  function header(title, sub, right) {
    return h('div', { class: 'ph' }, [
      h('div', {}, [h('h1', { text: title }), sub ? h('p', { class: 'muted', text: sub }) : null]),
      right ? h('div', { class: 'ph-right' }, right) : null,
    ]);
  }
  function tabs(options, value, onChange) {
    const w = h('div', { class: 'tabs', role: 'tablist' });
    options.forEach(([v, label]) => {
      w.appendChild(h('button', { type: 'button', role: 'tab', 'aria-selected': v === value ? 'true' : 'false', class: v === value ? 'on' : '', onclick: () => onChange(v) }, label));
    });
    return w;
  }
  async function refreshCounts() {
    try { COUNTS = (await API.counts()) || {}; } catch (e) { COUNTS = {}; }
    document.querySelectorAll('.side a.nav').forEach((a) => {
      const k = a.getAttribute('href').slice(2);
      const it = NAV.flatMap((g) => g.items).find((x) => x.k === k);
      if (!it || !it.badge) return;
      let b = a.querySelector('.nb');
      const n = Number(COUNTS[it.badge] || 0);
      if (!n) { if (b) b.remove(); return; }
      if (!b) { b = h('span', { class: 'nb' }); a.appendChild(b); }
      b.textContent = n > 99 ? '99+' : String(n);
    });
  }

  // ---------- login ----------
  function viewLogin(note) {
    let mode = 'password';
    const email = h('input', { type: 'email', class: 'input', autocomplete: 'username', placeholder: L('Email', 'البريد الإلكتروني') });
    const pass = h('input', { type: 'password', class: 'input', autocomplete: 'current-password', placeholder: L('Password', 'كلمة المرور') });
    const code = h('input', { type: 'text', class: 'input', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', placeholder: L('6-digit code', 'الرمز المكوّن من 6 أرقام') });
    const err = h('div', { class: 'notice bad', hidden: true });
    const info = h('div', { class: 'notice', hidden: true });
    const box = h('div', { class: 'fields' });
    let otpSent = false;

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
    }, 'primary wide');

    function draw() {
      box.innerHTML = '';
      box.appendChild(email);
      if (mode === 'password') box.appendChild(pass);
      if (mode === 'otp' && otpSent) box.appendChild(code);
      submit.textContent = mode === 'password' ? L('Sign in', 'تسجيل الدخول') : otpSent ? L('Verify code', 'تحقق من الرمز') : L('Email me a code', 'أرسل لي رمزًا');
    }
    const modeTabs = tabs([['password', L('Password', 'كلمة المرور')], ['otp', L('Email code', 'رمز بالبريد')]], mode, (v) => {
      mode = v; otpSent = false; info.hidden = true; err.hidden = true;
      modeTabs.querySelectorAll('button').forEach((b, i) => { const on = (i === 0) === (v === 'password'); b.className = on ? 'on' : ''; b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      draw();
    });
    draw();
    const form = h('form', { class: 'login-card', onsubmit: (e) => { e.preventDefault(); submit.click(); } }, [
      h('div', { class: 'lang center' }, [
        h('button', { type: 'button', class: LANG === 'ar' ? 'on' : '', onclick: () => setLang('ar') }, 'AR'),
        h('button', { type: 'button', class: LANG === 'en' ? 'on' : '', onclick: () => setLang('en') }, 'EN'),
      ]),
      h('img', { src: '/icons/flyp-logo-wide.png', alt: 'FLYP', class: 'login-logo' }),
      h('h1', { text: L('Admin panel', 'لوحة التحكم') }),
      h('p', { class: 'muted', text: L('New app backend (Mumbai). Admin accounts only.', 'خادم التطبيق الجديد (Mumbai). لحسابات المشرفين فقط.') }),
      note ? h('div', { class: 'notice bad', text: note }) : null,
      modeTabs, box, err, info, submit,
      h('button', { type: 'submit', hidden: true }),
    ]);
    return h('div', { class: 'login' }, form);
  }

  // ---------- dashboard ----------
  function stat(label, value, href, tone) {
    const inner = [h('div', { class: 'sv', text: num(value) }), h('div', { class: 'sl', text: label })];
    return href ? h('a', { href, class: 'stat ' + (tone || '') }, inner) : h('div', { class: 'stat ' + (tone || '') }, inner);
  }
  function viewDashboard() {
    const body = h('div', {}, loading());
    (async () => {
      try {
        const c = await API.counts();
        COUNTS = c || {};
        body.innerHTML = '';
        body.appendChild(h('div', { class: 'grid stats' }, [
          stat(L('Open reports', 'بلاغات مفتوحة'), c.open_reports, '#/reports', c.open_reports ? 'warn' : ''),
          stat(L('AI flags waiting', 'تنبيهات آلية بانتظار المراجعة'), c.ai_flags_pending, '#/reports?type=ai'),
          stat(L('Reported stories', 'قصص مُبلّغ عنها'), c.reported_stories, '#/reports?type=story'),
          stat(L('Live reports', 'بلاغات البث'), c.reported_live, '#/reports?type=live'),
          stat(L('Live now', 'بث الآن'), c.live_now, '#/live'),
          stat(L('Support tickets open', 'تذاكر دعم مفتوحة'), c.open_tickets, '#/tickets'),
          stat(L('Users', 'المستخدمون'), c.users_total, '#/users'),
          stat(L('New users today', 'مستخدمون جدد اليوم'), c.users_today),
          stat(L('Published videos', 'فيديوهات منشورة'), c.videos_total, '#/videos'),
          stat(L('Active stories', 'قصص نشطة'), c.active_stories, '#/stories'),
          stat(L('Banned accounts', 'حسابات محظورة'), c.banned_users, '#/users?status=banned'),
          stat(L('Scheduled deletions', 'حذف مجدول'), c.pending_deletions, '#/deletions'),
          stat(L('Data requests', 'طلبات البيانات'), c.pending_exports, '#/exports'),
          stat(L('Top-ups pending', 'شحنات معلّقة'), c.pending_topups, '#/wallet'),
          stat(L('Sharing location now', 'يشاركون موقعهم الآن'), c.location_sharers),
          stat(L('Unscanned uploads (24 h)', 'محتوى لم يُفحص (24 س)'), c.scans_unavailable_24h, '#/moderation', c.scans_unavailable_24h ? 'bad' : ''),
          stat(L('Blocked by AI (24 h)', 'محظور آليًا (24 س)'), c.content_blocked_24h, '#/moderation'),
        ]));
        const g = await API.growth(14);
        if (g && g.length) {
          const max = Math.max(1, ...g.map((r) => Number(r.signups) + Number(r.videos)));
          const chart = h('div', { class: 'bars', role: 'img', 'aria-label': L('Daily sign-ups and videos, last 14 days', 'التسجيلات والفيديوهات اليومية، آخر 14 يومًا') });
          g.forEach((r) => {
            chart.appendChild(h('div', { class: 'bar', title: r.day + ' · ' + L('sign-ups', 'تسجيلات') + ' ' + r.signups + ' · ' + L('videos', 'فيديوهات') + ' ' + r.videos }, [
              h('div', { class: 'b1', style: { height: (Number(r.signups) / max) * 100 + '%' } }),
              h('div', { class: 'b2', style: { height: (Number(r.videos) / max) * 100 + '%' } }),
              h('span', { class: 'bl', text: String(r.day).slice(5) }),
            ]));
          });
          body.appendChild(h('section', { class: 'card' }, [
            h('h2', { text: L('Last 14 days', 'آخر 14 يومًا') }),
            h('div', { class: 'legend' }, [h('span', { class: 'k1' }, L('Sign-ups', 'التسجيلات')), h('span', { class: 'k2' }, L('Videos', 'الفيديوهات'))]),
            chart,
          ]));
        }
        try {
          const s = await API.storage();
          body.appendChild(storageSummary(s));
        } catch (e) { /* storage card is optional */ }
      } catch (e) { body.innerHTML = ''; body.appendChild(errorBox(e)); }
    })();
    return [header(L('Dashboard', 'الرئيسية'), L('What needs attention on the new app.', 'ما يحتاج إلى متابعة في التطبيق الجديد.')), body];
  }
  function storageSummary(s) {
    const pct = Number(s.pct_used || 0);
    const alertBand = s.alert && Number(s.alert.last_band || 0);
    return h('section', { class: 'card' }, [
      h('h2', { text: L('Storage', 'التخزين') }),
      h('div', { class: 'meter' + (pct >= 85 ? ' bad' : pct >= 70 ? ' warn' : ''), role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, h('div', { style: { width: Math.min(100, pct) + '%' } })),
      h('p', { text: bytes(s.used_bytes) + ' / ' + bytes(s.limit_bytes) + ' (' + pct + '%)' }),
      alertBand ? h('div', { class: 'notice ' + (alertBand >= 2 ? 'bad' : 'warn'), text: L('Storage alert active (band ', 'تنبيه التخزين نشط (المستوى ') + alertBand + L('/3). Uploads stop at 100%.', '/3). يتوقف الرفع عند 100%.') }) : null,
      h('a', { href: '#/storage', class: 'more', text: L('Storage & limits →', 'التخزين والحدود ←') }),
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
        if (!rows.length) { list.appendChild(empty(L('No reports here.', 'لا توجد بلاغات هنا.'))); return; }
        rows.forEach((r) => list.appendChild(reportCard(r, load)));
      } catch (e) { list.innerHTML = ''; list.appendChild(errorBox(e)); }
    }
    drawTabs(); load();
    return [header(L('Reports', 'البلاغات'), L('Reports from people and from the AI screening. Resolving one closes every pending report on the same item.', 'بلاغات المستخدمين والفحص الآلي. معالجة بلاغ تغلق كل البلاغات المعلقة على العنصر نفسه.')), statusTabs, typeTabs, list];
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
      preview.appendChild(h('div', { class: 'muted', text: L('The reported item no longer exists (deleted or expired).', 'العنصر المُبلّغ عنه لم يعد موجودًا (حُذف أو انتهى).') }));
    } else {
      if (r.target_type === 'video') preview.appendChild(media(t.video_url, 'video', t.thumbnail));
      if (r.target_type === 'story') preview.appendChild(media(t.media_url, t.media_kind, t.poster_url));
      if (r.target_type === 'live_stream' && t.thumbnail) preview.appendChild(media(t.thumbnail, 'image'));
      if (r.target_type === 'user') preview.appendChild(avatar(t.avatar_url, t.owner_name));
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
      h('div', {}, [h('strong', { text: L('Reason: ', 'السبب: ') }), r.reason || '-']),
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
    return h('article', { class: 'card rc' }, [head, preview, meta, acts]);
  }

  // ---------- users ----------
  function viewUsers(q) {
    let status = q.status || 'all';
    const search = h('input', { type: 'search', class: 'input', placeholder: L('Search handle, name, email or user id', 'ابحث بالمعرّف أو الاسم أو البريد أو رقم المستخدم') });
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
            h('td', { 'data-l': L('User', 'المستخدم') }, h('div', { class: 'ucell' }, [avatar(u.avatar_url, u.name), h('div', {}, [h('div', { text: u.name || '-' }), h('div', { class: 'muted small', text: u.handle ? '@' + u.handle : '' })])])),
            h('td', { 'data-l': L('Email', 'البريد') }, u.email || '-'),
            h('td', { 'data-l': L('Status', 'الحالة') }, [
              u.is_admin ? badge(L('admin', 'مشرف'), 'type') : null,
              u.verified ? badge(L('verified', 'موثّق'), 'ok') : null,
              banned ? badge(L('banned', 'محظور'), 'bad') : null,
              u.deletion_scheduled_at ? badge(L('deleting', 'قيد الحذف'), 'warn') : null,
              u.deactivated_at && !u.deletion_scheduled_at ? badge(L('deactivated', 'معطّل'), 'warn') : null,
              Number(u.open_reports) ? badge(u.open_reports + ' ' + L('reports', 'بلاغات'), 'warn') : null,
            ]),
            h('td', { 'data-l': L('Videos', 'فيديوهات') }, num(u.videos_count)),
            h('td', { 'data-l': L('Followers', 'متابعون') }, num(u.followers_count)),
            h('td', { 'data-l': L('Joined', 'انضم') }, when(u.created_at)),
          ]));
        });
        table.appendChild(h('table', { class: 'table' }, [
          h('thead', {}, h('tr', {}, [L('User', 'المستخدم'), L('Email', 'البريد'), L('Status', 'الحالة'), L('Videos', 'فيديوهات'), L('Followers', 'متابعون'), L('Joined', 'انضم')].map((x) => h('th', { text: x })))),
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
    return [header(L('Users', 'المستخدمون'), L('Look up any account by handle, name, email or id.', 'ابحث عن أي حساب بالمعرّف أو الاسم أو البريد أو الرقم.')), h('div', { class: 'toolbar' }, search), stTabs, table];
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
        h('div', { class: 'muted small', text: 'id ' + p.id }),
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
    body.appendChild(acts);
    modal(L('Account', 'الحساب'), body);
  }

  // ---------- videos ----------
  function viewVideos(q) {
    let filter = q.filter || 'reported';
    const search = h('input', { type: 'search', class: 'input', placeholder: L('Search caption or @handle', 'ابحث في الوصف أو @المعرّف') });
    const grid = h('div', { class: 'cards' });
    const tb = h('div');
    function drawTabs() { tb.innerHTML = ''; tb.appendChild(tabs([['reported', L('Reported', 'مُبلّغ عنها')], ['hidden', L('Hidden', 'مخفية')], ['published', L('Published', 'منشورة')], ['draft', L('Drafts', 'مسودات')], ['all', L('All', 'الكل')]], filter, (v) => { filter = v; drawTabs(); load(); })); }
    async function load() {
      grid.innerHTML = ''; grid.appendChild(loading());
      try {
        const rows = await API.listVideos(filter, search.value.trim(), 80, 0);
        grid.innerHTML = '';
        if (!rows.length) { grid.appendChild(empty()); return; }
        rows.forEach((v) => grid.appendChild(h('article', { class: 'card vc' + (v.is_hidden ? ' hidden' : '') }, [
          media(v.video_url, 'video', v.thumbnail),
          h('div', { class: 'vc-body' }, [
            h('div', {}, [userLink(v.user_id, v.owner_handle, v.owner_name), h('span', { class: 'muted small', text: ' · ' + ago(v.created_at) })]),
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
    drawTabs(); load();
    return [header(L('Videos', 'الفيديوهات'), L('Hide keeps the video for its owner only; delete removes it and its file.', 'الإخفاء يُبقي الفيديو لصاحبه فقط؛ الحذف يزيله مع ملفه.')), h('div', { class: 'toolbar' }, search), tb, grid];
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
        if (!rows.length) { grid.appendChild(empty()); return; }
        rows.forEach((s) => grid.appendChild(h('article', { class: 'card vc' }, [
          media(s.media_url, s.media_kind, s.poster_url),
          h('div', { class: 'vc-body' }, [
            h('div', {}, [userLink(s.user_id, s.owner_handle, s.owner_name), h('span', { class: 'muted small', text: ' · ' + ago(s.created_at) })]),
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
    drawTabs(); load();
    return [header(L('Stories', 'القصص'), L('Stories disappear after 24 hours. Deleting one also queues its file for removal from storage.', 'تختفي القصص بعد 24 ساعة. حذف قصة يضع ملفها في قائمة الحذف من التخزين.')), tb, grid];
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
    drawTabs(); load();
    return [header(L('Live streams', 'البث المباشر'), L('Force-ending marks the stream as banned, so the host cannot reopen it.', 'الإنهاء الإجباري يجعل البث محظورًا فلا يستطيع المضيف إعادة فتحه.')), tb, grid];
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
    modal(L('Live chat', 'دردشة البث') + ' · @' + (l.host_handle || ''), list);
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
          h('td', { 'data-l': L('When', 'الوقت') }, when(r.created_at)),
          h('td', { 'data-l': L('Surface', 'النوع') }, r.kind),
          h('td', { 'data-l': L('Outcome', 'النتيجة') }, badge(r.outcome, r.outcome === 'block' ? 'bad' : r.outcome === 'review' ? 'warn' : r.outcome === 'unavailable' ? 'bad' : '')),
          h('td', { 'data-l': L('Category', 'الفئة') }, (r.top_category || '-') + (r.top_score != null ? ' (' + Number(r.top_score).toFixed(2) + ')' : '')),
          h('td', { 'data-l': L('Image', 'صورة') }, r.had_image ? '✓' : ''),
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
        if (!rows.length) { list.appendChild(empty(L('No tickets.', 'لا توجد تذاكر.'))); return; }
        rows.forEach((t) => {
          const u = t.profiles || {};
          list.appendChild(h('article', { class: 'card' }, [
            h('div', { class: 'rc-head' }, [badge(t.category, 'type'), badge(t.status, t.status === 'open' ? 'warn' : 'ok'), h('span', { class: 'muted small', text: ago(t.created_at) })]),
            h('div', {}, [userLink(t.user_id, u.handle, u.name), t.app_version ? h('span', { class: 'muted small', text: ' · v' + t.app_version }) : null, t.device ? h('span', { class: 'muted small', text: ' · ' + t.device }) : null]),
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
    drawTabs(); load();
    return [header(L('Support tickets', 'تذاكر الدعم'), L('"Report a problem" and "Contact us" from the app.', 'من "الإبلاغ عن مشكلة" و"تواصل معنا" في التطبيق.')), tb, list];
  }

  // ---------- deletions ----------
  function viewDeletions() {
    const body = h('div', {}, loading());
    async function load() {
      body.innerHTML = ''; body.appendChild(loading());
      try {
        const rows = await API.pendingDeletions();
        body.innerHTML = '';
        if (!rows.length) { body.appendChild(empty(L('No accounts are scheduled for deletion.', 'لا توجد حسابات مجدولة للحذف.'))); return; }
        const tb = h('tbody');
        rows.forEach((r) => tb.appendChild(h('tr', {}, [
          h('td', { 'data-l': L('User', 'المستخدم') }, h('div', { class: 'ucell' }, [avatar(r.avatar_url, r.name), userLink(r.id, r.handle, r.name)])),
          h('td', { 'data-l': L('Requested', 'طُلب') }, when(r.deactivated_at)),
          h('td', { 'data-l': L('Erased on', 'يُمحى في') }, when(r.deletion_scheduled_at)),
          h('td', { 'data-l': L('Days left', 'أيام متبقية') }, badge(String(r.days_left), r.days_left <= 3 ? 'bad' : 'warn')),
          h('td', {}, btn(L('Cancel deletion', 'إلغاء الحذف'), async () => {
            if (!(await confirmBox(L('Cancel this deletion?', 'إلغاء هذا الحذف؟'), L('Only do this when the account owner asked for it.', 'افعل ذلك فقط بطلب من صاحب الحساب.'), L('Cancel deletion', 'إلغاء الحذف')))) return;
            await API.cancelDeletion(r.id); toast(L('Deletion cancelled', 'أُلغي الحذف')); load(); refreshCounts();
          }, 'primary')),
        ])));
        body.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, [h('thead', {}, h('tr', {}, [L('User', 'المستخدم'), L('Requested', 'طُلب'), L('Erased on', 'يُمحى في'), L('Days left', 'أيام متبقية'), ''].map((x) => h('th', { text: x })))), tb])));
      } catch (e) { body.innerHTML = ''; body.appendChild(errorBox(e)); }
    }
    load();
    return [header(L('Deletion queue', 'طلبات الحذف'), L('Accounts deleted in the app are erased automatically when the grace period ends.', 'الحسابات المحذوفة من التطبيق تُمحى تلقائيًا عند انتهاء مهلة السماح.')), body];
  }

  // ---------- data export requests ----------
  function viewExports() {
    const body = h('div', {}, loading());
    async function load() {
      body.innerHTML = ''; body.appendChild(loading());
      try {
        const rows = await API.exports();
        body.innerHTML = '';
        if (!rows.length) { body.appendChild(empty(L('No data requests.', 'لا توجد طلبات بيانات.'))); return; }
        const tb = h('tbody');
        rows.forEach((r) => {
          const u = r.profiles || {};
          tb.appendChild(h('tr', {}, [
            h('td', { 'data-l': L('User', 'المستخدم') }, userLink(r.user_id, u.handle, u.name)),
            h('td', { 'data-l': L('Requested', 'طُلب') }, when(r.requested_at)),
            h('td', { 'data-l': L('Status', 'الحالة') }, badge(r.status, r.status === 'pending' ? 'warn' : r.status === 'ready' ? 'ok' : 'bad')),
            h('td', {}, r.status === 'pending' ? h('div', { class: 'actions' }, [
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
    load();
    return [header(L('Data requests', 'طلبات البيانات'), L('Requests for a copy of personal data.', 'طلبات الحصول على نسخة من البيانات الشخصية.')), body];
  }

  // ---------- wallet (read-only) ----------
  function viewWallet(q) {
    let days = Number(q.days || 30);
    const body = h('div', {}, loading());
    const tb = h('div');
    function drawTabs() { tb.innerHTML = ''; tb.appendChild(tabs([['7', L('7 days', '7 أيام')], ['30', L('30 days', '30 يومًا')], ['90', L('90 days', '90 يومًا')], ['365', L('1 year', 'سنة')]], String(days), (v) => { days = Number(v); drawTabs(); load(); })); }
    function small(title, headers, rows) {
      if (!rows || !rows.length) return h('section', { class: 'card' }, [h('h2', { text: title }), empty()]);
      return h('section', { class: 'card' }, [h('h2', { text: title }), h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, [
        h('thead', {}, h('tr', {}, headers.map((x) => h('th', { text: x })))),
        h('tbody', {}, rows.map((cells) => h('tr', {}, cells.map((c, i) => h('td', { 'data-l': headers[i] }, c))))),
      ]))]);
    }
    async function load() {
      body.innerHTML = ''; body.appendChild(loading());
      try {
        const w = await API.wallet(days);
        body.innerHTML = '';
        const ts = w.topups_by_status || {};
        body.appendChild(h('div', { class: 'grid stats' }, [
          stat(L('Coins held in wallets', 'العملات في المحافظ'), w.coins_in_wallets),
          stat(L('Wallets with a balance', 'محافظ برصيد'), w.wallets_with_balance),
          stat(L('Coins bought (credited)', 'عملات مشتراة (مضافة)'), ts.credited ? ts.credited.coins : 0),
          stat(L('Purchases credited', 'عمليات شراء مضافة'), ts.credited ? ts.credited.count : 0),
          stat(L('Purchases pending', 'عمليات معلقة'), ts.pending ? ts.pending.count : 0, null, ts.pending && ts.pending.count ? 'warn' : ''),
          stat(L('Purchases rejected', 'عمليات مرفوضة'), ts.rejected ? ts.rejected.count : 0, null, ts.rejected && ts.rejected.count ? 'bad' : ''),
          stat(L('Gifts sent', 'هدايا مرسلة'), w.gifts ? w.gifts.count : 0),
          stat(L('Coins spent on gifts', 'عملات أُنفقت على الهدايا'), w.gifts ? w.gifts.coins : 0),
        ]));
        body.appendChild(h('div', { class: 'notice', text: L('Read-only. Coins are bought only through Apple / Google in-app purchase and verified server-side; refunds are decided by the stores. "Flagged" means purchases that are stuck or rejected, coin credits with no store receipt behind them, store refunds, and accounts the refund handling marked for review.', 'للعرض فقط. تُشترى العملات عبر الشراء داخل التطبيق من Apple / Google ويتم التحقق منها على الخادم؛ قرار الاسترداد للمتاجر. "المُعلَّم" يعني عمليات شراء معلقة أو مرفوضة، وعملات بلا إيصال متجر، واستردادات المتاجر، وحسابات علّمها نظام الاسترداد للمراجعة.') }));
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
    return [header(L('Coins & gifts', 'العملات والهدايا'), L('Overview of in-app coin purchases and live gifts.', 'نظرة على شراء العملات داخل التطبيق وهدايا البث.')), tb, body];
  }

  // ---------- storage ----------
  function viewStorage() {
    const body = h('div', {}, loading());
    async function load() {
      body.innerHTML = ''; body.appendChild(loading());
      try {
        const s = await API.storage();
        body.innerHTML = '';
        body.appendChild(storageSummary(s));
        const bucketTable = (title, rows) => h('section', { class: 'card' }, [h('h2', { text: title }), rows && rows.length ? h('table', { class: 'table' }, [
          h('thead', {}, h('tr', {}, [L('Bucket', 'الحاوية'), L('Files', 'الملفات'), L('Size', 'الحجم')].map((x) => h('th', { text: x })))),
          h('tbody', {}, rows.map((b) => h('tr', {}, [h('td', { text: b.bucket }), h('td', { text: num(b.files) }), h('td', { text: bytes(b.bytes) })]))),
        ]) : empty()]);
        body.appendChild(bucketTable(L('Cloudflare R2 (media)', 'Cloudflare R2 (الوسائط)'), s.r2_buckets));
        body.appendChild(bucketTable(L('Supabase Storage', 'تخزين Supabase'), s.supabase_buckets));
        const dq = s.delete_queue || {};
        body.appendChild(h('section', { class: 'card' }, [
          h('h2', { text: L('Media delete queue', 'قائمة حذف الوسائط') }),
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
          h('h2', { text: L('Upload limits', 'حدود الرفع') }),
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
        if (!rows.length) { body.appendChild(empty()); return; }
        const tb = h('tbody');
        rows.forEach((r) => tb.appendChild(h('tr', {}, [
          h('td', { 'data-l': L('When', 'الوقت') }, when(r.created_at)),
          h('td', { 'data-l': L('Admin', 'المشرف') }, r.admin ? '@' + (r.admin.handle || r.admin.name || '?') : '-'),
          h('td', { 'data-l': L('Action', 'الإجراء') }, h('code', { text: r.action })),
          h('td', { 'data-l': L('Target', 'الهدف') }, r.target_type === 'user' && r.target_id ? userLink(r.target_id, null, r.target_id.slice(0, 8)) : (r.target_type || '') + (r.target_id ? ' ' + String(r.target_id).slice(0, 8) : '')),
          h('td', { 'data-l': L('Details', 'التفاصيل') }, r.payload ? h('code', { class: 'small', text: JSON.stringify(r.payload).slice(0, 160) }) : ''),
        ])));
        body.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, [h('thead', {}, h('tr', {}, [L('When', 'الوقت'), L('Admin', 'المشرف'), L('Action', 'الإجراء'), L('Target', 'الهدف'), L('Details', 'التفاصيل')].map((x) => h('th', { text: x })))), tb])));
      } catch (e) { body.innerHTML = ''; body.appendChild(errorBox(e)); }
    })();
    return [header(L('Audit log', 'سجل الأنشطة'), L('Every admin action, newest first.', 'كل إجراءات المشرفين، الأحدث أولًا.')), body];
  }

  // ---------- router ----------
  const ROUTES = {
    dashboard: viewDashboard, reports: viewReports, users: viewUsers, videos: viewVideos,
    stories: viewStories, live: viewLive, moderation: viewModeration, tickets: viewTickets,
    deletions: viewDeletions, exports: viewExports, wallet: viewWallet, storage: viewStorage, logs: viewLogs,
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
      root.replaceChildren(h('div', { class: 'loading full', text: L('Checking access...', 'جارٍ التحقق من الصلاحيات...') }));
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
