/* === Admin dashboard SPA === */
(function () {
  const { el, esc, safeUrl, fmt, toast, icons, svg } = window.H;
  const DB = window.DB;

  const root = document.getElementById('admin');

  // Sections map to work an operator actually does. Removed: Wallet & gifts
  // (the feature is gone), and Roles/Employees (the permission model is a
  // single is_admin flag, so a roles screen would govern nothing).
  const NAV = [
    { sec: 'الرئيسية', items: [
      { k: 'dashboard', l: 'الرئيسية', i: 'home', go: '#/dashboard' },
      { k: 'analytics', l: 'الإحصائيات', i: 'sparkle', go: '#/analytics' },
    ]},
    { sec: 'الإشراف', items: [
      { k: 'reports', l: 'البلاغات', i: 'flag', go: '#/reports', badge: 'open_reports' },
      { k: 'tickets', l: 'الدعم الفني', i: 'mail', go: '#/tickets', badge: 'open_tickets' },
      { k: 'videos', l: 'الفيديوهات', i: 'video', go: '#/videos' },
      { k: 'comments', l: 'التعليقات', i: 'comment', go: '#/comments' },
      { k: 'live', l: 'البث المباشر', i: 'eye', go: '#/live', badge: 'live_now' },
    ]},
    { sec: 'الحسابات', items: [
      { k: 'users', l: 'إدارة الحسابات', i: 'user', go: '#/users' },
      { k: 'deletions', l: 'طلبات الحذف', i: 'x', go: '#/deletions', badge: 'pending_deletions' },
      { k: 'exports', l: 'طلبات البيانات', i: 'download', go: '#/exports', badge: 'pending_exports' },
    ]},
    { sec: 'النظام', items: [
      { k: 'notif', l: 'إرسال إشعار', i: 'bell', go: '#/notifications' },
      { k: 'ads', l: 'الإعلانات', i: 'image', go: '#/ads' },
      { k: 'storage', l: 'التخزين والحدود', i: 'bookmark', go: '#/storage' },
      { k: 'location', l: 'الموقع الجغرافي', i: 'map', go: '#/location' },
      { k: 'logs', l: 'سجل الأنشطة', i: 'eye', go: '#/logs' },
    ]},
  ];

  // Live counts shown as badges beside the nav items that have a queue.
  let QUEUE = {};

  // Filled in from the signed-in account. It used to be a hardcoded name and
  // a stock photo, so every operator saw the same invented identity.
  const me = { name: '', role: 'Admin', avatar: '' };

  async function loadMe() {
    try {
      const u = await window.SB.getUser();
      if (!u) return;
      const p = await window.SB.getProfile(u.id);
      me.name = (p && p.name) || u.email || '';
      me.avatar = (p && p.avatar_url) || '';
      document.querySelectorAll('.adm-user .name').forEach(n => { n.textContent = me.name; });
      document.querySelectorAll('.adm-user .avatar').forEach(av => {
        av.innerHTML = '';
        if (me.avatar) {
          av.appendChild(Object.assign(document.createElement('img'), { src: me.avatar, alt: '' }));
        } else {
          av.appendChild(el('span', { class: 'avatar-fallback' }, (me.name || 'A').trim().charAt(0).toUpperCase()));
        }
      });
    } catch (e) { /* the shell still renders without it */ }
  }

  // Language switch (Arabic ⇄ English) for the admin topbar
  function admLangSwitch() {
    const cur = (window.I18N && window.I18N.getLang()) || 'ar';
    const wrap = el('div', { class: 'lang-switch compact' });
    [['ar', 'AR'], ['en', 'EN']].forEach(([code, label]) => {
      wrap.appendChild(el('button', {
        type: 'button',
        class: 'lang-opt' + (cur === code ? ' active' : ''),
        title: code === 'en' ? 'English' : 'العربية',
        onclick: (e) => { e.stopPropagation(); if (window.I18N && window.I18N.getLang() !== code) window.I18N.setLang(code); },
      }, label));
    });
    return wrap;
  }

  // ===== Login =====
  function viewLogin() {
    const r = el('div', { class: 'adm-login' });
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { style: { display: 'flex', justifyContent: 'center', marginBottom: '10px' } }, [admLangSwitch()]));
    card.appendChild(el('div', { class: 'auth-logo-svg', html: icons.logo, style: { width: '150px', height: 'auto', margin: '0 auto 14px' } }));
    card.appendChild(el('h1', {}, 'لوحة التحكم'));
    card.appendChild(el('p', {}, 'سجّل دخولك للوصول إلى لوحة الإدارة'));
    const inputStyle = { width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--border)', marginBottom: '12px', fontSize: '14px', outline: 0 };
    const u = el('input', { type: 'email', placeholder: 'البريد الإلكتروني', style: inputStyle });
    const p = el('input', { type: 'password', placeholder: 'كلمة المرور', style: inputStyle });
    const err = el('div', { style: { color: 'var(--danger)', fontSize: '13px', marginBottom: '12px', display: 'none' } });
    card.appendChild(u); card.appendChild(p); card.appendChild(err);
    const btn = el('button', { class: 'btn', style: { width: '100%' } }, 'تسجيل الدخول');
    btn.onclick = async () => {
      err.style.display = 'none'; btn.disabled = true; btn.textContent = 'جاري الدخول...';
      try {
        if (!window.SB) throw new Error('SDK not loaded');
        await window.SB.signIn({ email: u.value.trim(), password: p.value });
        if (!window.API) throw new Error('API not loaded');
        const isAdmin = await window.API.adminCheckIsAdmin();
        if (!isAdmin) { await window.SB.signOut(); throw new Error('هذا الحساب ليس لديه صلاحيات إدارية'); }
        location.hash = '#/dashboard';
      } catch (e) {
        err.textContent = (e.message && /Invalid login/i.test(e.message)) ? 'بيانات الدخول غير صحيحة' : (e.message || 'تعذر الدخول');
        err.style.display = 'block';
        btn.disabled = false; btn.textContent = 'تسجيل الدخول';
      }
    };
    card.appendChild(btn);
    r.appendChild(card);
    return r;
  }

  // ===== Shell =====
  function buildShell(active, content, breadcrumbs) {
    const shell = el('div', { class: 'adm-shell' });
    // sidebar
    const side = el('aside', { class: 'adm-sidebar' });
    side.appendChild(el('div', { class: 'adm-brand' }, [
      el('div', { class: 'adm-logo-svg', html: icons.logoMark, style: { width: '38px', height: '38px', flexShrink: '0' } }),
      el('div', {}, [el('div', { class: 'name' }, 'FLYP'), el('div', { class: 'sub' }, 'Admin Panel')]),
    ]));
    // Back-to-app link (so admins can hop back to the user-facing PWA)
    side.appendChild(el('a', {
      href: '/',
      class: 'adm-nav',
      style: { display: 'flex', gap: '10px', alignItems: 'center', padding: '10px 12px', borderRadius: '10px', fontSize: '13.5px', color: 'var(--muted)', marginBottom: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '14px' },
    }, [svg('chevR'), el('span', {}, '← العودة إلى التطبيق')]));
    NAV.forEach(g => {
      side.appendChild(el('div', { class: 'adm-section-title' }, g.sec));
      const nav = el('nav', { class: 'adm-nav' });
      g.items.forEach(it => {
                // A count beside the queues that need working, so an operator can see
        // where the work is without opening every page.
        const n = it.badge ? Number(QUEUE[it.badge] || 0) : 0;
        nav.appendChild(el('a', { href: it.go, class: 'adm-nav' + (it.k === active ? ' active' : ''), onclick: () => closeSidebar() }, [
          svg(it.i),
          el('span', {}, it.l),
          n > 0 ? el('span', { class: 'adm-nav-badge' }, n > 99 ? '99+' : String(n)) : null,
        ].filter(Boolean)));
      });
      // re-class active
      nav.querySelectorAll('a').forEach((a, i) => {
        if (g.items[i].k === active) a.classList.add('active');
      });
      side.appendChild(nav);
    });
    shell.appendChild(side);

    // main
    const main = el('main', { class: 'adm-main' });
    const top = el('header', { class: 'adm-topbar' });
    // Visibility belongs to the stylesheet. This used to carry an inline
    // display:none that no rule could override, so on a phone the sidebar
    // slid off screen with no way left to open it.
    top.appendChild(el('button', {
      class: 'icon-btn adm-menu-btn', html: icons.menu,
      onclick: toggleSidebar, id: 'sidebar-toggle',
      title: 'القائمة',
    }));
    // The brand only lives in the sidebar, which is hidden on a phone — so
    // the top bar was blank apart from a menu button and a language toggle,
    // with nothing saying which product this even is. Shown only at the
    // widths where the sidebar is away, so it is not duplicated on desktop.
    top.appendChild(el('a', {
      href: '#/', class: 'adm-topbar-brand', title: 'FLYP',
      html: icons.logoMark,
    }));
    top.appendChild(el('div', { class: 'search' }, [el('input', { placeholder: 'بحث سريع...' })]));
    top.appendChild(el('span', { class: 'spacer' }));
    top.appendChild(admLangSwitch());
    // Was a hardcoded 5. Shows the real amount of open work, and disappears
    // when there is none.
    const openWork = Number(QUEUE.open_reports || 0) + Number(QUEUE.open_tickets || 0);
    top.appendChild(el('button', {
      class: 'icon-btn', html: icons.bell,
      title: 'العمل المفتوح',
      onclick: () => { location.hash = '#/reports'; },
    }, openWork ? [el('span', { class: 'badge' }, String(openWork))] : []));
    top.appendChild(el('button', { class: 'icon-btn', html: icons.settings, onclick: () => location.hash = '#/storage' }));
    top.appendChild(el('div', { class: 'adm-user' }, [
      el('div', { class: 'avatar' }, me.avatar
        ? [Object.assign(document.createElement('img'), { src: me.avatar, alt: '' })]
        : [el('span', { class: 'avatar-fallback' }, (me.name || 'A').trim().charAt(0).toUpperCase())]),
      el('div', { class: 'meta' }, [
        el('div', { class: 'name' }, me.name),
        el('div', { class: 'role' }, me.role),
      ]),
      el('span', { class: 'chev', html: icons.chevD }),
    ]));
    main.appendChild(top);
    main.appendChild(content);
    shell.appendChild(main);

    // Dims the page behind the drawer and gives a tap target to close it.
    const scrim = el('div', { class: 'adm-scrim', onclick: () => closeSidebar() });
    shell.appendChild(scrim);

    // On a phone the drawer is a poor primary navigation, so the work an
    // operator does daily sits in a bottom bar instead. The drawer stays for
    // everything else, reached through the last slot.
    shell.appendChild(buildBottomNav(active, toggleSidebar));

    function toggleSidebar() {
      const open = side.classList.toggle('open');
      scrim.classList.toggle('on', open);
      document.body.style.overflow = open ? 'hidden' : '';
    }
    function closeSidebar() {
      side.classList.remove('open');
      scrim.classList.remove('on');
      document.body.style.overflow = '';
    }
    return shell;
  }

  // Five slots: the four pages an operator opens every day, then the drawer.
  const BOTTOM_NAV = [
    { k: 'dashboard', l: 'الرئيسية', i: 'home', go: '#/dashboard' },
    { k: 'reports', l: 'البلاغات', i: 'flag', go: '#/reports', badge: 'open_reports' },
    { k: 'tickets', l: 'الدعم', i: 'mail', go: '#/tickets', badge: 'open_tickets' },
    { k: 'users', l: 'الحسابات', i: 'user', go: '#/users' },
  ];

  function buildBottomNav(active, openDrawer) {
    const bar = el('nav', { class: 'adm-bottom', 'aria-label': 'التنقل' });
    BOTTOM_NAV.forEach(it => {
      const n = it.badge ? Number(QUEUE[it.badge] || 0) : 0;
      bar.appendChild(el('a', {
        href: it.go,
        class: 'adm-bottom-item' + (it.k === active ? ' active' : ''),
      }, [
        el('span', { class: 'ico' }, [
          svg(it.i),
          n > 0 ? el('i', { class: 'dot' }, n > 9 ? '9+' : String(n)) : null,
        ].filter(Boolean)),
        el('span', { class: 'lbl' }, it.l),
      ]));
    });
    bar.appendChild(el('button', {
      class: 'adm-bottom-item', onclick: openDrawer, type: 'button',
    }, [
      el('span', { class: 'ico' }, [svg('menu')]),
      el('span', { class: 'lbl' }, 'المزيد'),
    ]));
    return bar;
  }

  // Tables are built per view with no shared builder, so rather than editing
  // every one, each cell is stamped with its column heading here. The mobile
  // stylesheet prints that as the label when a row becomes a card.
  function labelTableCells(root) {
    (root || document).querySelectorAll('table.table').forEach(tbl => {
      const heads = [].map.call(tbl.querySelectorAll('thead th'), th => th.textContent.trim());
      if (!heads.length) return;
      tbl.querySelectorAll('tbody tr').forEach(tr => {
        [].forEach.call(tr.children, (td, i) => {
          if (heads[i]) td.setAttribute('data-label', heads[i]);
        });
      });
    });
  }

  // ===== Reusable bits =====
  function pageHeader(title, sub, actions) {
    return el('div', { class: 'adm-page-header' }, [
      el('div', {}, [el('h1', {}, title), sub ? el('div', { class: 'sub' }, sub) : null].filter(Boolean)),
      el('div', { class: 'actions' }, actions || []),
    ]);
  }
  function statCard({ label, value, delta, icon, tone = 'primary' }) {
    const tones = { primary: ['var(--primary-soft)', 'var(--primary)'], info: ['var(--info-soft)', 'var(--info)'], success: ['var(--success-soft)', 'var(--success)'], warn: ['var(--warn-soft)', 'var(--warn)'], danger: ['var(--danger-soft)', 'var(--danger)'] };
    const [bg, fg] = tones[tone];
    return el('div', { class: 'stat-card' }, [
      el('div', { class: 'icon-pill', style: { background: bg, color: fg }, html: icons[icon] || icons.sparkle }),
      el('div', { class: 'label' }, label),
      el('div', { class: 'value' }, value),
      delta ? el('span', { class: 'delta ' + (delta.startsWith('-') ? 'down' : 'up') }, delta) : null,
    ].filter(Boolean));
  }

  function chartBars(data) {
    const max = Math.max.apply(null, data.map(d => d.v)) || 1;
    const wrap = el('div', { class: 'chart-wrap' });
    const bars = el('div', { class: 'chart-bars' });
    data.forEach(d => bars.appendChild(el('div', { class: 'bar', style: { height: (d.v / max * 100) + '%' } }, [
      el('span', { class: 'v' }, fmt(d.v)),
      el('span', { class: 'l' }, d.l),
    ])));
    wrap.appendChild(bars);
    return wrap;
  }

  function chartLine(values, labels) {
    const max = Math.max.apply(null, values) * 1.1;
    const min = 0;
    const W = 600, H = 180;
    const xStep = W / (values.length - 1);
    const points = values.map((v, i) => [i * xStep, H - ((v - min) / (max - min)) * H]);
    const path = points.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    const area = path + ` L${W},${H} L0,${H} Z`;
    const wrap = el('div', { class: 'chart-line' });
    wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs><linearGradient id="grad-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#1e56d6" stop-opacity="0.5"/><stop offset="100%" stop-color="#1e56d6" stop-opacity="0"/></linearGradient></defs>
      <path class="area" d="${area}"/>
      <path class="line" d="${path}"/>
      ${points.map(p => `<circle class="dot" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3"/>`).join('')}
    </svg>`;
    return wrap;
  }

  function donut(parts) {
    const total = parts.reduce((s, p) => s + p.v, 0) || 1;
    let acc = 0;
    const r = 60, c = 80;
    const segs = parts.map(p => {
      const start = (acc / total) * 360;
      acc += p.v;
      const end = (acc / total) * 360;
      const large = end - start > 180 ? 1 : 0;
      const sx = c + r * Math.cos((start - 90) * Math.PI / 180);
      const sy = c + r * Math.sin((start - 90) * Math.PI / 180);
      const ex = c + r * Math.cos((end - 90) * Math.PI / 180);
      const ey = c + r * Math.sin((end - 90) * Math.PI / 180);
      return `<path d="M${c},${c} L${sx.toFixed(1)},${sy.toFixed(1)} A${r},${r} 0 ${large} 1 ${ex.toFixed(1)},${ey.toFixed(1)} Z" fill="${p.c}"/>`;
    }).join('');
    const w = el('div');
    w.innerHTML = `<svg class="donut" viewBox="0 0 160 160"><g>${segs}</g><circle cx="${c}" cy="${c}" r="40" fill="#fff"/></svg>`;
    return w;
  }

  function modalAdm(title, body, footer) {
    const bd = el('div', { class: 'adm-modal-bd', onclick: (e) => { if (e.target === bd) close(); } });
    const m = el('div', { class: 'adm-modal' });
    m.appendChild(el('div', { class: 'adm-modal-h' }, [
      el('h3', {}, title),
      el('button', { class: 'btn-icon btn-ghost', html: icons.x, onclick: () => close() }),
    ]));
    m.appendChild(el('div', { class: 'adm-modal-b' }, body));
    if (footer) m.appendChild(el('div', { class: 'adm-modal-f' }, footer));
    bd.appendChild(m);
    document.body.appendChild(bd);
    function close() { bd.remove(); }
    return close;
  }

  // ===== Dashboard =====
  // Everything here is queried. The previous version had a line chart drawn
  // from seven hardcoded numbers and a donut splitting content into
  // categories the app does not have.
  function viewDashboard() {
    const page = el('div', { class: 'adm-page' });
    page.appendChild(pageHeader('لوحة التحكم', 'نظرة عامة على المنصة'));

    // ── Alerts: only things that need a person to act ──
    const alerts = el('div', { class: 'adm-alerts', style: { display: 'none' } });
    page.appendChild(alerts);

    const stats = el('div', { class: 'stat-grid' });
    page.appendChild(stats);

    // ── Quick commands ──
    const QUICK = [
      { l: 'مراجعة البلاغات', i: 'flag', go: '#/reports' },
      { l: 'الدعم الفني', i: 'mail', go: '#/tickets' },
      { l: 'إدارة الحسابات', i: 'user', go: '#/users' },
      { l: 'إرسال إشعار', i: 'bell', go: '#/notifications' },
      { l: 'التخزين والحدود', i: 'bookmark', go: '#/storage' },
      { l: 'الإحصائيات', i: 'sparkle', go: '#/analytics' },
    ];
    const quick = el('div', { class: 'adm-quick' });
    QUICK.forEach(q => quick.appendChild(el('a', { class: 'adm-quick-item', href: q.go }, [
      el('span', { class: 'qi-icon', html: icons[q.i] || icons.sparkle }),
      el('span', {}, q.l),
    ])));
    page.appendChild(el('div', { class: 'adm-card' }, [el('h3', {}, 'إجراءات سريعة'), quick]));

    // ── Activity chart (real) ──
    const chartCard = el('div', { class: 'adm-card' }, [el('h3', {}, 'النشاط خلال 14 يومًا')]);
    const chartHost = el('div');
    chartCard.appendChild(chartHost);
    page.appendChild(chartCard);

    // ── Two feeds ──
    const grid2 = el('div', { class: 'grid-2', style: { marginTop: '14px' } });

    const newest = el('div', { class: 'adm-card' }, [
      el('div', { class: 'card-h' }, [el('h3', {}, 'أحدث الحسابات'), el('a', { class: 'btn-ghost btn-sm', href: '#/users' }, 'الكل')]),
    ]);
    const newestList = el('div', { class: 'top-list' });
    newest.appendChild(newestList);
    grid2.appendChild(newest);

    const act = el('div', { class: 'adm-card' }, [
      el('div', { class: 'card-h' }, [el('h3', {}, 'آخر النشاطات'), el('a', { class: 'btn-ghost btn-sm', href: '#/logs' }, 'السجل')]),
    ]);
    const al = el('div', { class: 'activity-list' });
    act.appendChild(al);
    grid2.appendChild(act);
    page.appendChild(grid2);

    (async () => {
      // Stats + queues
      try {
        const [s, q] = await Promise.all([
          window.API.adminStats().catch(() => ({})),
          window.API.adminQueueCounts().catch(() => null),
        ]);
        stats.innerHTML = '';
        stats.appendChild(statCard({ label: 'إجمالي الحسابات', value: fmt(s.total_users || s.users || 0), icon: 'user', tone: 'primary' }));
        stats.appendChild(statCard({ label: 'إجمالي الفيديوهات', value: fmt(s.total_videos || s.videos || 0), icon: 'video', tone: 'info' }));
        stats.appendChild(statCard({ label: 'بث مباشر الآن', value: fmt((q && q.live_now) || s.live_now || 0), icon: 'eye', tone: 'success' }));
        stats.appendChild(statCard({ label: 'عمل مفتوح', value: fmt(q ? (Number(q.open_reports || 0) + Number(q.open_tickets || 0)) : 0), icon: 'flag', tone: 'danger' }));

        // Alerts are derived, not decorative - each one links to the work.
        if (q) {
          const items = [];
          if (q.open_reports) items.push(['بلاغ بانتظار المراجعة: ' + q.open_reports, '#/reports']);
          // Both of these come from 0066 and are absent on a database that has
          // not run it - the truthiness check above is what keeps this panel
          // working unchanged against either.
          if (q.ai_flags_pending) items.push(['منها من الفحص التلقائي: ' + q.ai_flags_pending, '#/reports']);
          // The number that keeps failing open honest: content published in the
          // last day that could not be screened at all. Steadily non-zero means
          // the OPENAI_API_KEY is wrong or the daily request cap was reached,
          // not that people stopped posting.
          if (q.scans_unavailable_24h) items.push(['نُشر دون فحص تلقائي خلال ٢٤ ساعة: ' + q.scans_unavailable_24h + ' — تحقق من مفتاح OpenAI أو الحصة اليومية', '#/reports']);
          if (q.open_tickets) items.push(['بلاغ دعم مفتوح: ' + q.open_tickets, '#/tickets']);
          if (q.pending_exports) items.push(['طلب بيانات بانتظار المعالجة: ' + q.pending_exports, '#/exports']);
          if (q.pending_deletions) items.push(['حساب مجدول للحذف: ' + q.pending_deletions, '#/deletions']);
          try {
            const ov = await window.API.adminStorageOverview();
            if (ov && Number(ov.pct_used) >= 80) {
              items.push(['التخزين ممتلئ بنسبة ' + ov.pct_used + '% — سيتوقف الرفع عند بلوغ السقف', '#/storage']);
            }
          } catch (e) {}
          if (items.length) {
            alerts.style.display = '';
            alerts.appendChild(el('div', { class: 'adm-alerts-h' }, [
              el('span', { class: 'qi-icon', html: icons.bell }),
              el('strong', {}, 'يحتاج إلى إجراء'),
            ]));
            items.forEach(([text, href]) => alerts.appendChild(
              el('a', { class: 'adm-alert', href }, [el('span', {}, text), el('span', { class: 'chev', html: icons.chevL })])
            ));
          }
        }
      } catch (e) { console.warn('dashboard stats:', e); }

      // Chart
      try {
        const growth = await window.API.adminGrowth(14);
        chartHost.innerHTML = '';
        if (!growth.length) {
          chartHost.appendChild(el('div', { class: 'muted', style: { padding: '18px' } }, 'لا توجد بيانات بعد'));
        } else {
          const max = Math.max(1, ...growth.map(r => Math.max(r.signups, r.videos, r.comments)));
          const chart = el('div', { class: 'adm-chart' });
          growth.forEach(r => chart.appendChild(el('div', {
            class: 'adm-chart-col',
            title: chartTip(r),
          }, [
            el('i', { class: 'b1', style: { height: (r.signups / max * 100) + '%' } }),
            el('i', { class: 'b2', style: { height: (r.videos / max * 100) + '%' } }),
            el('i', { class: 'b3', style: { height: (r.comments / max * 100) + '%' } }),
          ])));
          chartHost.appendChild(chart);
          chartHost.appendChild(el('div', { class: 'adm-legend' }, [
            el('span', {}, [el('i', { class: 'b1' }), document.createTextNode(' حسابات')]),
            el('span', {}, [el('i', { class: 'b2' }), document.createTextNode(' فيديوهات')]),
            el('span', {}, [el('i', { class: 'b3' }), document.createTextNode(' تعليقات')]),
          ]));
        }
      } catch (e) {
        chartHost.innerHTML = '<div class="muted" style="padding:18px">' + esc(e.message) + '</div>';
      }

      // Newest accounts
      try {
        const users = await window.API.adminFetchUsers({});
        users.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        newestList.innerHTML = '';
        if (!users.length) {
          newestList.appendChild(el('div', { class: 'muted', style: { padding: '12px' } }, 'لا توجد حسابات بعد'));
        } else {
          users.slice(0, 6).forEach(u => newestList.appendChild(el('div', { class: 'top-item' }, [
            el('div', { class: 'av' }, u.avatar_url
              ? [Object.assign(document.createElement('img'), { src: u.avatar_url, alt: '' })]
              : [el('span', { class: 'avatar-fallback' }, (u.name || '?').trim().charAt(0).toUpperCase())]),
            el('div', { class: 'body' }, [
              el('div', { class: 'ttl' }, u.name || '—'),
              el('div', { class: 'sub' }, '@' + (u.handle || '')),
            ]),
            el('div', { class: 'num' }, u.is_admin ? 'مشرف' : _ago(u.created_at)),
          ])));
        }
      } catch (e) { console.warn('newest users:', e); }

      // Admin activity log
      try {
        const logs = await window.API.adminFetchLogs({ limit: 8 });
        al.innerHTML = '';
        if (!logs.length) {
          al.appendChild(el('div', { class: 'muted', style: { padding: '12px' } }, 'لا توجد نشاطات بعد'));
        } else {
          logs.forEach(L => al.appendChild(el('div', { class: 'activity-item' }, [
            el('div', { class: 'ai-icon', style: { background: 'var(--primary-soft)', color: 'var(--primary)' }, html: icons.eye }),
            el('div', { class: 'ai-text' }, [
              el('b', {}, (L.admin && L.admin.name) || 'مشرف'),
              document.createTextNode(' · ' + String(L.action || '').replace(/_/g, ' ')),
            ]),
            el('div', { class: 'ai-time' }, _ago(L.created_at)),
          ])));
        }
      } catch (e) { console.warn('logs:', e); }
    })();

    return page;
  }

  // Locale for dates and relative time. Was pinned to 'ar-SA', so every
  // timestamp stayed Arabic even with the interface in English.
  function chartTip(r) {
    const en = admLocale() === 'en-GB';
    return en
      ? r.day + ' — accounts ' + r.signups + ' · videos ' + r.videos + ' · comments ' + r.comments
      : r.day + ' — حسابات ' + r.signups + ' · فيديو ' + r.videos + ' · تعليق ' + r.comments;
  }

  function admLocale() {
    try { return (window.I18N && window.I18N.getLang() === 'en') ? 'en-GB' : 'ar-SA'; }
    catch (e) { return 'ar-SA'; }
  }

  function _ago(iso) {
    if (!iso) return '';
    const en = admLocale() === 'en-GB';
    const t = Date.now() - new Date(iso).getTime();
    const m = Math.floor(t / 60000);
    if (m < 1) return en ? 'now' : 'الآن';
    if (m < 60) return en ? m + 'm ago' : 'منذ ' + m + 'د';
    const h = Math.floor(m / 60);
    if (h < 24) return en ? h + 'h ago' : 'منذ ' + h + 'س';
    const d = Math.floor(h / 24);
    return en ? d + 'd ago' : 'منذ ' + d + 'ي';
  }

  // ===== Users =====
  function viewUsers() {
    const page = el('div', { class: 'adm-page' });
    page.appendChild(pageHeader('إدارة الحسابات', 'بحث، تعديل البروفايل، الصلاحيات، الحظر، الحذف'));
    const tableWrap = el('div', { class: 'table-wrap' });
    const searchIn = el('input', { placeholder: 'بحث بالاسم أو اسم المستخدم' });
    const statusSel = el('select', {}, [el('option', { value: '' }, 'كل الحالات'), el('option', { value: 'active' }, 'نشط'), el('option', { value: 'banned' }, 'محظور'), el('option', { value: 'admin' }, 'مشرف')]);
    tableWrap.appendChild(el('div', { class: 'table-toolbar' }, [
      el('div', { class: 'search', style: { flex: 1 } }, [searchIn]),
      statusSel,
    ]));
    const table = el('table', { class: 'table' });
    table.innerHTML = `<thead><tr>
      <th>المستخدم</th>
      <th>المتابعون</th>
      <th>الحالة</th>
      <th>تاريخ الانضمام</th>
      <th></th>
    </tr></thead>`;
    const tb = el('tbody');
    table.appendChild(tb);
    tableWrap.appendChild(table);
    page.appendChild(tableWrap);

    async function load() {
      tb.innerHTML = '<tr><td colspan="5" style="padding:30px;text-align:center" class="muted">جاري التحميل...</td></tr>';
      try {
        const users = await window.API.adminFetchUsers({ search: searchIn.value, status: statusSel.value });
        tb.innerHTML = '';
        if (!users.length) { tb.innerHTML = '<tr><td colspan="5" class="table-empty">لا توجد نتائج</td></tr>'; return; }
        users.forEach(u => {
          const isBanned = u.banned_until && new Date(u.banned_until) > new Date();
          const status = isBanned ? { l: 'محظور', c: 'danger' } : u.is_admin ? { l: 'مشرف', c: 'primary' } : { l: 'نشط', c: 'success' };
          const tr = el('tr', { style: { cursor: 'pointer' } });

          // ── User cell: safely build avatar + name + handle with no innerHTML interpolation ──
          const avImg = document.createElement('img');
          const safeAv = safeUrl(u.avatar_url);
          if (safeAv) avImg.src = safeAv;
          avImg.onerror = () => { avImg.style.background = '#ddd'; avImg.removeAttribute('src'); };
          const userCell = el('td', {}, [
            el('div', { class: 'user-cell' }, [
              el('div', { class: 'av' }, [avImg]),
              el('div', {}, [
                el('div', { class: 'nm' }, (u.name || '') + (u.verified ? ' ✓' : '')),
                el('div', { class: 'em' }, '@' + (u.handle || '')),
              ]),
            ]),
          ]);

          const openBtn = el('button', { class: 'btn-sm', 'data-act': 'open' }, 'إدارة');
          const banBtn = el('button', { class: 'btn-sm btn-' + (isBanned ? 'secondary' : 'danger'), 'data-act': 'ban' }, isBanned ? 'إلغاء الحظر' : 'حظر');

          tr.appendChild(userCell);
          tr.appendChild(el('td', {}, fmt(u.followers_count || 0)));
          tr.appendChild(el('td', {}, [el('span', { class: 'badge ' + status.c }, status.l)]));
          tr.appendChild(el('td', {}, new Date(u.created_at).toLocaleDateString(admLocale())));
          tr.appendChild(el('td', {}, [el('div', { class: 'row-actions' }, [openBtn, banBtn])]));

          // Whole row + "إدارة" button → open detail modal
          const openModal = (e) => { e && e.stopPropagation(); openUserModal(u); };
          tr.addEventListener('click', openModal);
          openBtn.onclick = openModal;
          banBtn.onclick = async (e) => {
            e.stopPropagation();
            const days = isBanned ? null : await admAsk('حظر الحساب', 'عدد أيام الحظر (اتركه فارغًا للحظر الدائم)', '7');
            if (days === null && !isBanned) return;
            try { await window.API.adminBanUser(u.id, days === null ? null : (days === '' ? 36500 : parseInt(days))); toast('تم'); load(); }
            catch (err) { toast(err.message); }
          };
          tb.appendChild(tr);
        });
      } catch (e) { tb.innerHTML = '<tr><td colspan="5" class="table-empty">' + e.message + '</td></tr>'; }
    }
    let t; searchIn.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
    statusSel.addEventListener('change', load);
    load();
    return page;

    // ── Full user-management modal: profile editor + roles + delete ──
    async function openUserModal(u) {
      const body = el('div', {}, [el('div', { class: 'muted', style: { padding: '20px', textAlign: 'center' } }, 'جاري التحميل...')]);
      const close = modalAdm('إدارة المستخدم', body, []);
      let detail;
      try { detail = await window.API.adminFetchUserDetail(u.id); }
      catch (e) { body.innerHTML = ''; body.appendChild(el('div', { class: 'muted', style: { padding: '20px', color: 'var(--danger)' } }, 'تعذر التحميل: ' + (e.message || e))); return; }
      const p = (detail && detail.profile) || u;
      const isBanned = p.banned_until && new Date(p.banned_until) > new Date();

      body.innerHTML = '';

      // Header (avatar + handle + quick badges)
      body.appendChild(el('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' } }, [
        el('div', { class: 'av', style: { width: '64px', height: '64px', borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: '#eee' } },
           [Object.assign(document.createElement('img'), { src: p.avatar_url || '', style: 'width:100%;height:100%;object-fit:cover' })]),
        el('div', { style: { flex: 1, minWidth: 0 } }, [
          el('div', { style: { fontWeight: 700, fontSize: '16px' } }, (p.name || '') + (p.verified ? ' ✓' : '')),
          el('div', { class: 'muted', style: { fontSize: '13px' } }, '@' + (p.handle || '')),
          el('div', { class: 'muted', style: { fontSize: '11.5px', marginTop: '2px' } }, 'انضم: ' + new Date(p.created_at).toLocaleDateString(admLocale())),
        ]),
        el('div', {}, [
          el('span', { class: 'badge ' + (isBanned ? 'danger' : p.is_admin ? 'primary' : 'success') }, isBanned ? 'محظور' : p.is_admin ? 'مشرف' : 'نشط'),
        ]),
      ]));

      // ── Stats strip
      const stats = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '14px' } });
      [['المتابعون', p.followers_count || 0], ['المتابَعون', p.following_count || 0], ['الإعجابات', p.likes_count || 0], ['الفيديوهات', detail.video_count || 0]]
        .forEach(([l, v]) => stats.appendChild(el('div', { style: { background: '#f6f6fa', borderRadius: '8px', padding: '10px', textAlign: 'center' } }, [
          el('div', { style: { fontWeight: 700, fontSize: '15px' } }, fmt(v)),
          el('div', { class: 'muted', style: { fontSize: '11px' } }, l),
        ])));
      body.appendChild(stats);

      // ── Profile edit form
      body.appendChild(el('h4', { style: { margin: '14px 0 6px', fontSize: '13px', color: 'var(--muted)' } }, 'البروفايل'));
      const nameIn   = el('input', { class: 'input', value: p.name || '' });
      const handleIn = el('input', { class: 'input', value: p.handle || '' });
      const bioIn    = el('textarea', { class: 'input', rows: 3, style: { resize: 'none' }, value: p.bio || '' });
      const verifiedIn = el('input', { type: 'checkbox' });
      verifiedIn.checked = !!p.verified;
      const form = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, [
        el('div', { class: 'field' }, [el('label', {}, 'الاسم'), nameIn]),
        el('div', { class: 'field' }, [el('label', {}, 'اسم المستخدم'), handleIn]),
        el('div', { class: 'field' }, [el('label', {}, 'النبذة'), bioIn]),
        el('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' } }, [verifiedIn, document.createTextNode(' علامة موثَّق ✓')]),
        el('button', { class: 'btn', style: { alignSelf: 'flex-start', marginTop: '4px' }, onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true; const orig = btn.textContent; btn.textContent = 'جاري الحفظ...';
          try {
            await window.API.adminUpdateProfile(p.id, {
              name: nameIn.value.trim(),
              handle: handleIn.value.trim().replace(/^@/, ''),
              bio: bioIn.value.trim(),
              verified: verifiedIn.checked,
            });
            toast('تم حفظ البروفايل');
            load();
          } catch (err) { toast(err.message || 'فشل الحفظ'); }
          finally { btn.disabled = false; btn.textContent = orig; }
        } }, 'حفظ تعديلات البروفايل'),
      ]);
      body.appendChild(form);


      // ── Recent videos thumbnail strip
      if (Array.isArray(detail.recent_videos) && detail.recent_videos.length) {
        body.appendChild(el('h4', { style: { margin: '20px 0 6px', fontSize: '13px', color: 'var(--muted)' } }, 'أحدث الفيديوهات'));
        const strip = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' } });
        detail.recent_videos.forEach(v => strip.appendChild(el('div', { style: { aspectRatio: '9/16', borderRadius: '6px', overflow: 'hidden', background: '#000', position: 'relative' } }, [
          Object.assign(document.createElement('img'), { src: v.thumbnail || v.video_url || '', style: 'width:100%;height:100%;object-fit:cover;opacity:0.85' }),
          el('div', { style: { position: 'absolute', bottom: '4px', left: '4px', color: '#fff', fontSize: '10.5px', textShadow: '0 1px 2px rgba(0,0,0,0.6)' } }, '❤ ' + fmt(v.likes_count || 0)),
        ])));
        body.appendChild(strip);
      }

      // ── Recent admin actions on this user
      if (Array.isArray(detail.recent_logs) && detail.recent_logs.length) {
        body.appendChild(el('h4', { style: { margin: '20px 0 6px', fontSize: '13px', color: 'var(--muted)' } }, 'سجل الإجراءات الإدارية'));
        const logs = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });
        detail.recent_logs.forEach(L => logs.appendChild(el('div', { style: { fontSize: '12px', display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: '#f6f6fa', borderRadius: '6px' } }, [
          el('span', {}, (L.admin && L.admin.name || 'مشرف') + ' · ' + L.action.replace(/_/g, ' ')),
          el('span', { class: 'muted', style: { fontSize: '11px' } }, new Date(L.created_at).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' })),
        ])));
        body.appendChild(logs);
      }

      // ── Danger zone: roles + ban + delete
      body.appendChild(el('h4', { style: { margin: '20px 0 6px', fontSize: '13px', color: 'var(--muted)' } }, 'إجراءات سريعة'));
      const dangerRow = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
        el('button', { class: 'btn-sm btn-secondary', onclick: async () => {
          if (!await admConfirm((p.is_admin ? 'إزالة' : 'تعيين') + ' دور المشرف', p.name)) return;
          try { await window.API.adminToggleAdmin(p.id, !p.is_admin); toast('تم'); close(); load(); }
          catch (err) { toast(err.message); }
        } }, p.is_admin ? 'إزالة الإشراف' : 'تعيين مشرف'),
        el('button', { class: 'btn-sm btn-' + (isBanned ? 'secondary' : 'danger'), onclick: async () => {
          const days = isBanned ? null : await admAsk('حظر الحساب', 'عدد أيام الحظر (اتركه فارغًا للحظر الدائم)', '7');
          if (days === null && !isBanned) return;
          try { await window.API.adminBanUser(p.id, days === null ? null : (days === '' ? 36500 : parseInt(days))); toast('تم'); close(); load(); }
          catch (err) { toast(err.message); }
        } }, isBanned ? 'إلغاء الحظر' : 'حظر مؤقت'),
        el('button', { class: 'btn-sm btn-danger', style: { marginInlineStart: 'auto' }, onclick: async () => {
          if (!await admConfirm('حذف الحساب نهائيًا', 'سيُحذف حساب ' + p.name + ' وكل فيديوهاته وتعليقاته. لا يمكن التراجع عن هذا.')) return;
          try { await window.API.adminDeleteUser(p.id); toast('تم حذف الحساب'); close(); load(); }
          catch (err) { toast(err.message); }
        } }, '🗑️ حذف الحساب نهائيًا'),
      ]);
      body.appendChild(dangerRow);
    }
  }

  function pagination(total, perPage = 10) {
    const pages = Math.max(1, Math.ceil(total / perPage));
    const wrap = el('div', { class: 'pagination' });
    wrap.appendChild(el('span', {}, `عرض 1-${Math.min(perPage, total)} من ${total}`));
    const pgs = el('div', { class: 'pages' });
    for (let i = 1; i <= Math.min(pages, 5); i++) {
      pgs.appendChild(el('button', { class: 'pg' + (i === 1 ? ' active' : '') }, String(i)));
    }
    if (pages > 5) pgs.appendChild(el('span', { class: 'muted', style: { padding: '4px' } }, '...'));
    wrap.appendChild(pgs);
    return wrap;
  }

  // ===== Videos =====
  function viewVideos() {
    const page = el('div', { class: 'adm-page' });
    page.appendChild(pageHeader('الفيديوهات', 'مراجعة المحتوى المنشور'));
    let activeTab = 'all';
    const tabs = el('div', { class: 'tabs' });
    [['all', 'الكل'], ['published', 'منشور'], ['draft', 'مسودة']].forEach(([k, l], i) => tabs.appendChild(el('button', { class: 'tab' + (i === 0 ? ' active' : ''), onclick: e => { activeTab = k; tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active')); e.currentTarget.classList.add('active'); load(); } }, l)));
    page.appendChild(tabs);
    const tableWrap = el('div', { class: 'table-wrap' });
    const searchIn = el('input', { placeholder: 'بحث بالوصف' });
    tableWrap.appendChild(el('div', { class: 'table-toolbar' }, [
      el('div', { class: 'search', style: { flex: 1 } }, [searchIn]),
    ]));
    const table = el('table', { class: 'table' });
    table.innerHTML = `<thead><tr><th>الفيديو</th><th>الناشر</th><th>المشاهدات</th><th>الإعجابات</th><th>التعليقات</th><th>الحالة</th><th></th></tr></thead>`;
    const tb = el('tbody'); table.appendChild(tb);
    tableWrap.appendChild(table); page.appendChild(tableWrap);

    async function load() {
      tb.innerHTML = '<tr><td colspan="7" style="padding:30px;text-align:center" class="muted">جاري التحميل...</td></tr>';
      try {
        const videos = await window.API.adminFetchVideos({ status: activeTab, search: searchIn.value });
        tb.innerHTML = '';
        if (!videos.length) { tb.innerHTML = '<tr><td colspan="7" class="table-empty">لا توجد فيديوهات</td></tr>'; return; }
        videos.forEach(v => {
          const status = v.is_draft ? ['warn', 'مسودة'] : ['success', 'منشور'];
          const tr = el('tr');
          const isVid = v.video_url && /\.(mp4|mov|webm)/i.test(v.video_url);

          // Build the thumbnail element via DOM, not innerHTML, so user-controlled URLs
          // can never break out of the src attribute.
          let thumb;
          if (isVid) {
            thumb = document.createElement('video');
            const safe = safeUrl(v.video_url);
            if (safe) thumb.src = safe;
            Object.assign(thumb, { muted: true, loop: true, playsInline: true });
            Object.assign(thumb.style, { width: '100%', height: '100%', objectFit: 'cover' });
            thumb.addEventListener('mouseover', () => thumb.play().catch(() => {}));
            thumb.addEventListener('mouseout',  () => thumb.pause());
          } else {
            thumb = document.createElement('img');
            const safe = safeUrl(v.thumbnail || v.video_url);
            if (safe) thumb.src = safe;
          }

          const descText = (v.description || '').slice(0, 40) || '(بلا وصف)';
          const userName = (v.user && v.user.name) || '';
          const userHandle = (v.user && v.user.handle) || '';

          const openBtn = el('button', { class: 'btn-sm btn-secondary' }, 'عرض');
          const delBtn = el('button', { class: 'btn-sm btn-danger' }, 'حذف');

          tr.appendChild(el('td', {}, [
            el('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, [
              el('div', { class: 'vthumb' }, [thumb]),
              el('div', { style: { minWidth: 0, flex: 1 } }, [
                el('div', { style: { fontWeight: 700, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' } }, descText),
                el('div', { class: 'muted', style: { fontSize: '11.5px' } }, new Date(v.created_at).toLocaleString(admLocale())),
              ]),
            ]),
          ]));
          tr.appendChild(el('td', {}, [
            document.createTextNode(userName),
            el('div', { class: 'muted', style: { fontSize: '11.5px' } }, '@' + userHandle),
          ]));
          tr.appendChild(el('td', {}, fmt(v.views_count || 0)));
          tr.appendChild(el('td', {}, fmt(v.likes_count || 0)));
          tr.appendChild(el('td', {}, String(v.comments_count || 0)));
          tr.appendChild(el('td', {}, [el('span', { class: 'badge ' + status[0] }, status[1])]));
          tr.appendChild(el('td', {}, [el('div', { class: 'row-actions' }, [openBtn, delBtn])]));

          openBtn.onclick = () => {
            const u = safeUrl(v.video_url || v.thumbnail);
            if (u) window.open(u, '_blank', 'noopener,noreferrer');
          };
          delBtn.onclick = async () => {
            if (!await admConfirm('حذف الفيديو', 'سيُحذف المقطع نهائيًا ولا يمكن التراجع.')) return;
            try { await window.API.adminDeleteVideo(v.id); toast('تم الحذف'); load(); }
            catch (e) { toast(e.message); }
          };
          tb.appendChild(tr);
        });
      } catch (e) { tb.innerHTML = '<tr><td colspan="7" class="table-empty">' + e.message + '</td></tr>'; }
    }
    let t; searchIn.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
    load();
    return page;
  }

  // ===== Comments =====
  function viewComments() {
    const page = el('div', { class: 'adm-page' });
    page.appendChild(pageHeader('التعليقات', 'مراجعة وحذف التعليقات المخالفة'));
    const tableWrap = el('div', { class: 'table-wrap' });
    const searchIn = el('input', { placeholder: 'بحث في التعليقات' });
    tableWrap.appendChild(el('div', { class: 'table-toolbar' }, [
      el('div', { class: 'search', style: { flex: 1 } }, [searchIn]),
    ]));
    const table = el('table', { class: 'table' });
    table.innerHTML = `<thead><tr><th>المستخدم</th><th>التعليق</th><th>الفيديو</th><th>التاريخ</th><th></th></tr></thead>`;
    const tb = el('tbody');
    table.appendChild(tb);
    tableWrap.appendChild(table);
    page.appendChild(tableWrap);

    async function load() {
      tb.innerHTML = '<tr><td colspan="5" style="padding:30px;text-align:center" class="muted">جاري التحميل...</td></tr>';
      try {
        if (!window.API) return;
        const comments = await window.API.adminFetchComments({ search: searchIn.value });
        tb.innerHTML = '';
        if (!comments.length) {
          tb.innerHTML = '<tr><td colspan="5" class="table-empty">لا توجد تعليقات</td></tr>';
          return;
        }
        comments.forEach(c => {
          const tr = el('tr');
          const avUrl = (c.user && c.user.avatar_url) || '';
          const uName = (c.user && c.user.name) || 'مستخدم';
          const uHandle = (c.user && c.user.handle) ? '@' + c.user.handle : '';

          const delBtn = el('button', { class: 'btn-icon btn-ghost', title: 'حذف' }, [svg('trash')]);
          delBtn.onclick = async () => {
            if (!await admConfirm('حذف التعليق', 'سيُحذف التعليق نهائيًا ولا يمكن التراجع.')) return;
            try {
              await window.API.adminDeleteComment(c.id);
              toast('تم حذف التعليق');
              tr.remove();
            } catch (err) {
              toast('تعذر الحذف: ' + err.message);
            }
          };

          tr.appendChild(el('td', {}, [
            el('div', { class: 'user-cell' }, [
              el('div', { class: 'av' }, [Object.assign(document.createElement('img'), { src: avUrl })]),
              el('div', {}, [
                el('div', { class: 'nm' }, uName),
                el('div', { class: 'hd' }, uHandle),
              ]),
            ]),
          ]));
          tr.appendChild(el('td', { style: { maxWidth: '300px', wordBreak: 'break-word' } }, c.text || ''));
          tr.appendChild(el('td', {}, [
            el('a', { class: 'muted', href: '#/videos' }, 'فيديو #' + (c.video_id ? c.video_id.slice(0, 8) : '')),
          ]));
          tr.appendChild(el('td', { class: 'muted', style: { fontSize: '12px' } }, new Date(c.created_at).toLocaleString(admLocale())));
          tr.appendChild(el('td', {}, [
            el('div', { class: 'row-actions' }, [delBtn]),
          ]));
          tb.appendChild(tr);
        });
      } catch (err) {
        tb.innerHTML = '<tr><td colspan="5" class="table-empty">' + (err.message || 'حدث خطأ') + '</td></tr>';
      }
    }

    let t;
    searchIn.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(load, 250);
    });
    load();

    return page;
  }

  // ===== Reports =====
  function viewReports() {
    const page = el('div', { class: 'adm-page' });
    page.appendChild(pageHeader('البلاغات', 'مراجعة البلاغات المقدمة من المستخدمين'));

    let activeTab = '';   // status filter: '' = pending, 'resolved', 'dismissed'
    let activeType = '';  // target_type filter
    const tabs = el('div', { class: 'tabs' });
    [['', 'قيد المراجعة'], ['resolved', 'تم الحسم'], ['dismissed', 'مرفوضة']].forEach(([k, l], i) => tabs.appendChild(el('button', { class: 'tab' + (i === 0 ? ' active' : ''), onclick: e => { activeTab = k === '' ? 'pending' : k; tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active')); e.currentTarget.classList.add('active'); load(); } }, l)));
    activeTab = 'pending';
    page.appendChild(tabs);

    const tableWrap = el('div', { class: 'table-wrap' });
    const typeSel = el('select', {}, [el('option', { value: '' }, 'كل الأنواع'), el('option', { value: 'video' }, 'فيديو'), el('option', { value: 'comment' }, 'تعليق'), el('option', { value: 'user' }, 'حساب'), el('option', { value: 'live_stream' }, 'بث مباشر')]);
    typeSel.addEventListener('change', () => { activeType = typeSel.value; load(); });
    tableWrap.appendChild(el('div', { class: 'table-toolbar' }, [typeSel]));
    const table = el('table', { class: 'table' });
    table.innerHTML = `<thead><tr><th>النوع</th><th>الكيان</th><th>المُبلِّغ</th><th>السبب</th><th>التاريخ</th><th></th></tr></thead>`;
    const tb = el('tbody'); table.appendChild(tb);
    tableWrap.appendChild(table); page.appendChild(tableWrap);

    async function load() {
      tb.innerHTML = '<tr><td colspan="6" style="padding:30px;text-align:center" class="muted">جاري التحميل...</td></tr>';
      try {
        const reports = await window.API.adminFetchReports({ status: activeTab, target_type: activeType });
        tb.innerHTML = '';
        if (!reports.length) { tb.innerHTML = '<tr><td colspan="6" class="table-empty">لا توجد بلاغات</td></tr>'; return; }
        const typeMap = { video: 'فيديو', comment: 'تعليق', user: 'حساب', live_stream: 'بث' };
        reports.forEach(r => {
          const tr = el('tr');
          tr.innerHTML = `
            <td><strong>${typeMap[r.target_type] || r.target_type}</strong></td>
            <td><code style="font-size:11px">${(r.target_id || '').slice(0, 8)}</code></td>
            <td>${(r.reporter && r.reporter.name) || '-'}</td>
            <td>${r.reason}</td>
            <td>${new Date(r.created_at).toLocaleString(admLocale())}</td>
            <td><div class="row-actions">
              <button class="btn-sm btn-danger" data-act="resolve">حسم بإجراء</button>
              <button class="btn-sm btn-secondary" data-act="dismiss">رفض</button>
            </div></td>`;
          tr.querySelector('[data-act="resolve"]').onclick = async () => {
            const action = await admAsk('إغلاق البلاغ', 'الإجراء المتخذ', 'تم حذف المحتوى');
            if (!action) return;
            try { await window.API.adminResolveReport(r.id, { action, status: 'resolved' }); toast('تم'); load(); }
            catch (e) { toast(e.message); }
          };
          tr.querySelector('[data-act="dismiss"]').onclick = async () => {
            try { await window.API.adminResolveReport(r.id, { action: 'تم الرفض', status: 'dismissed' }); toast('تم الرفض'); load(); }
            catch (e) { toast(e.message); }
          };
          tb.appendChild(tr);
        });
      } catch (e) { tb.innerHTML = '<tr><td colspan="6" class="table-empty">' + e.message + '</td></tr>'; }
    }
    load();
    return page;
  }

  // ===== Live =====
  function viewLive() {
    const page = el('div', { class: 'adm-page' });
    page.appendChild(pageHeader('البث المباشر', 'مراقبة الجلسات النشطة وإنهاء البثوث المخالفة'));
    const grid = el('div', { class: 'grid-3' });
    page.appendChild(grid);
    (async () => {
      grid.innerHTML = '<div style="padding:30px;text-align:center" class="muted">جاري التحميل...</div>';
      try {
        const lives = await window.API.adminFetchLiveStreams();
        const active = lives.filter(l => l.status === 'live');
        grid.innerHTML = '';
        if (!active.length) { grid.appendChild(el('div', { class: 'empty-state', style: { gridColumn: '1/-1' } }, 'لا توجد بثوث نشطة الآن')); return; }
        active.forEach(l => {
          const card = el('div', { class: 'card', style: { padding: 0, overflow: 'hidden' } });
          const bg = l.thumbnail || '';   // no demo fallback - an empty tile is honest
          card.appendChild(el('div', { style: { aspectRatio: '16/9', backgroundImage: `url(${bg})`, backgroundSize: 'cover', position: 'relative' } }, [
            el('div', { style: { position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.1), rgba(0,0,0,0.6))' } }),
            el('div', { style: { position: 'absolute', top: '8px', insetInlineStart: '8px' } }, [el('span', { class: 'badge danger' }, '● مباشر')]),
            el('div', { style: { position: 'absolute', top: '8px', insetInlineEnd: '8px' } }, [el('span', { class: 'badge muted', style: { background: 'rgba(0,0,0,0.5)', color: '#fff' } }, fmt(l.viewer_count || 0) + ' 👁')]),
            el('div', { style: { position: 'absolute', bottom: '8px', insetInlineStart: '8px', color: '#fff', fontWeight: 700 } }, l.title || 'بث مباشر'),
          ]));
          const endBtn = el('button', { class: 'btn btn-danger btn-sm' }, 'إنهاء');
          endBtn.onclick = async () => {
            if (!await admConfirm('إنهاء البث', 'سيتوقف البث المباشر فورًا لكل المشاهدين.')) return;
            try { await window.API.adminEndLive(l.id); toast('تم الإنهاء'); l.status = 'banned'; card.remove(); }
            catch (e) { toast(e.message); }
          };
          card.appendChild(el('div', { style: { padding: '12px' } }, [
            el('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, [
              el('div', { style: { width: '34px', height: '34px', borderRadius: '50%', overflow: 'hidden' } }, [Object.assign(document.createElement('img'), { src: (l.host && l.host.avatar_url) || '', style: 'width:100%;height:100%;object-fit:cover' })]),
              el('div', { style: { flex: 1 } }, [el('div', { style: { fontWeight: 700, fontSize: '13px' } }, (l.host && l.host.name) || ''), el('div', { class: 'muted', style: { fontSize: '11.5px' } }, '@' + ((l.host && l.host.handle) || ''))]),
              endBtn,
            ]),
          ]));
          grid.appendChild(card);
        });
      } catch (e) { grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">' + e.message + '</div>'; }
    })();
    return page;
  }

  // ===== Logs =====
  function viewLogs() {
    const page = el('div', { class: 'adm-page' });
    page.appendChild(pageHeader('سجل الأنشطة', 'مراجعة جميع الإجراءات الإدارية'));
    const tableWrap = el('div', { class: 'table-wrap' });
    const table = el('table', { class: 'table' });
    table.innerHTML = `<thead><tr><th>الموظف</th><th>الإجراء</th><th>الكيان</th><th>الوقت</th></tr></thead>`;
    const tb = el('tbody'); table.appendChild(tb);
    tableWrap.appendChild(table); page.appendChild(tableWrap);

    (async () => {
      tb.innerHTML = '<tr><td colspan="4" style="padding:30px;text-align:center" class="muted">جاري التحميل...</td></tr>';
      try {
        const logs = await window.API.adminFetchLogs({ limit: 200 });
        tb.innerHTML = '';
        if (!logs.length) { tb.innerHTML = '<tr><td colspan="4" class="table-empty">لم يتم تسجيل أي نشاط بعد</td></tr>'; return; }
        logs.forEach(L => {
          const tr = el('tr');
          const av = document.createElement('img');
          const safeAv = safeUrl(L.admin && L.admin.avatar_url);
          if (safeAv) av.src = safeAv;
          const actionText = (L.action || '').replace(/_/g, ' ');
          const targetType = L.target_type || '-';

          tr.appendChild(el('td', {}, [
            el('div', { class: 'user-cell' }, [
              el('div', { class: 'av' }, [av]),
              el('span', {}, (L.admin && L.admin.name) || '-'),
            ]),
          ]));
          tr.appendChild(el('td', {}, [el('strong', {}, actionText)]));
          const targetCell = el('td', { class: 'muted' }, [document.createTextNode(targetType + ' ')]);
          if (L.target_id) {
            targetCell.appendChild(el('code', { style: { fontSize: '11px' } }, String(L.target_id).slice(0, 8)));
          }
          tr.appendChild(targetCell);
          tr.appendChild(el('td', {}, new Date(L.created_at).toLocaleString(admLocale())));
          tb.appendChild(tr);
        });
      } catch (e) { tb.innerHTML = '<tr><td colspan="4" class="table-empty">' + e.message + '</td></tr>'; }
    })();
    return page;
  }

  // ===== Settings =====

  // ===== Prompt / confirm replacements =====
  // window.prompt is blocked in app webviews and in some embedded browsers,
  // and when it throws it kills the handler silently. These return promises.
  function admAsk(title, label, initial = '', multiline = false) {
    return new Promise(resolve => {
      const input = multiline
        ? el('textarea', { class: 'adm-input', rows: '5' })
        : el('input', { class: 'adm-input' });
      input.value = initial;
      let done = false;
      const finish = (v) => { if (done) return; done = true; close(); resolve(v); };
      const ok = el('button', { class: 'btn-sm btn-primary', onclick: () => finish(input.value.trim() || null) }, 'تأكيد');
      const no = el('button', { class: 'btn-sm btn-secondary', onclick: () => finish(null) }, 'إلغاء');
      const close = modalAdm(title, [
        el('label', { class: 'adm-label' }, label),
        input,
      ], [no, ok]);
      setTimeout(() => input.focus(), 40);
      input.addEventListener('keydown', e => { if (e.key === 'Enter' && !multiline) finish(input.value.trim() || null); });
    });
  }

  function admConfirm(title, message, confirmLabel = 'تأكيد', danger = false) {
    return new Promise(resolve => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; close(); resolve(v); };
      const ok = el('button', { class: 'btn-sm ' + (danger ? 'btn-danger' : 'btn-primary'), onclick: () => finish(true) }, confirmLabel);
      const no = el('button', { class: 'btn-sm btn-secondary', onclick: () => finish(false) }, 'إلغاء');
      const close = modalAdm(title, [el('p', { class: 'muted', style: { lineHeight: '1.7' } }, message)], [no, ok]);
    });
  }

  // A table shell shared by the new queue screens.
  function queueTable(headers, colspan) {
    const wrap = el('div', { class: 'table-wrap' });
    const table = el('table', { class: 'table' });
    table.innerHTML = '<thead><tr>' + headers.map(h => '<th>' + h + '</th>').join('') + '</tr></thead>';
    const tb = el('tbody');
    table.appendChild(tb);
    wrap.appendChild(table);
    const busy = (msg) => { tb.innerHTML = '<tr><td colspan="' + colspan + '" style="padding:30px;text-align:center" class="muted">' + msg + '</td></tr>'; };
    const empty = (msg) => { tb.innerHTML = '<tr><td colspan="' + colspan + '" class="table-empty">' + msg + '</td></tr>'; };
    return { wrap, tb, busy, empty };
  }

  function userCell(p) {
    if (!p) return '<span class="muted">—</span>';
    return '<div class="cell-user"><strong>' + esc(p.name || p.handle || '—') + '</strong>'
      + '<span class="muted">@' + esc(p.handle || '') + '</span></div>';
  }

  const fmtBytes = (b) => {
    const n = Number(b) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  };

  // ===== Support desk =====
  function viewTickets() {
    const page = el('div', { class: 'adm-page' });
    page.appendChild(pageHeader('الدعم الفني', 'البلاغات التي أرسلها المستخدمون من داخل التطبيق'));

    let status = 'open';
    const tabs = el('div', { class: 'tabs' });
    [['open', 'مفتوحة'], ['in_progress', 'قيد المعالجة'], ['resolved', 'محلولة'], ['all', 'الكل']]
      .forEach(([k, l], i) => tabs.appendChild(el('button', {
        class: 'tab' + (i === 0 ? ' active' : ''),
        onclick: e => {
          status = k;
          tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          e.currentTarget.classList.add('active');
          load();
        },
      }, l)));
    page.appendChild(tabs);

    const CATS = { bug: 'عطل', account: 'حساب', payment: 'دفع', content: 'محتوى', safety: 'أمان', other: 'أخرى' };
    const STATUS = { open: 'مفتوح', in_progress: 'قيد المعالجة', resolved: 'محلول', closed: 'مغلق' };

    const t = queueTable(['المستخدم', 'النوع', 'الرسالة', 'الجهاز', 'التاريخ', 'الحالة', ''], 7);
    page.appendChild(t.wrap);

    async function load() {
      t.busy('جاري التحميل...');
      let rows = [];
      try { rows = await window.API.adminFetchTickets(status); }
      catch (e) { t.empty(e.message); return; }
      t.tb.innerHTML = '';
      if (!rows.length) { t.empty('لا توجد بلاغات'); return; }
      rows.forEach(r => {
        const tr = el('tr');
        tr.innerHTML = `
          <td>${userCell(r.profiles)}</td>
          <td><span class="chip">${CATS[r.category] || r.category}</span></td>
          <td class="cell-wrap">${esc((r.message || '').slice(0, 140))}</td>
          <td><span class="muted" style="font-size:11px">${esc((r.device || '').slice(0, 34))}</span></td>
          <td><span class="muted">${new Date(r.created_at).toLocaleString(admLocale())}</span></td>
          <td><span class="badge s-${r.status}">${STATUS[r.status] || r.status}</span></td>
          <td><div class="row-actions">
            <button class="btn-sm btn-primary" data-act="reply">رد</button>
            <button class="btn-sm btn-secondary" data-act="progress">قيد المعالجة</button>
          </div></td>`;
        if (r.admin_reply) {
          const note = el('tr');
          note.innerHTML = `<td colspan="7" class="cell-reply"><strong>الرد:</strong> ${esc(r.admin_reply)}</td>`;
          tr.dataset.hasReply = '1';
          setTimeout(() => tr.after(note), 0);
        }
        tr.querySelector('[data-act="reply"]').onclick = async () => {
          const reply = await admAsk('الرد على البلاغ', 'سيصل الرد إلى المستخدم كإشعار داخل التطبيق.', r.admin_reply || '', true);
          if (!reply) return;
          try { await window.API.adminReplyTicket(r.id, reply, 'resolved'); toast('تم إرسال الرد'); load(); }
          catch (e) { toast(e.message); }
        };
        tr.querySelector('[data-act="progress"]').onclick = async () => {
          try { await window.API.adminSetTicketStatus(r.id, 'in_progress'); toast('تم التحديث'); load(); }
          catch (e) { toast(e.message); }
        };
        t.tb.appendChild(tr);
      });
    }
    load();
    return page;
  }

  // ===== Account deletion queue =====
  function viewDeletions() {
    const page = el('div', { class: 'adm-page' });
    page.appendChild(pageHeader('طلبات الحذف', 'حسابات مجدولة للحذف خلال 30 يومًا — يمكن إلغاء الحذف قبل انتهاء المهلة'));

    const t = queueTable(['الحساب', 'أُوقف في', 'يُحذف في', 'المتبقي', ''], 5);
    page.appendChild(t.wrap);

    async function load() {
      t.busy('جاري التحميل...');
      let rows = [];
      try { rows = await window.API.adminPendingDeletions(); }
      catch (e) { t.empty(e.message); return; }
      t.tb.innerHTML = '';
      if (!rows.length) { t.empty('لا توجد طلبات حذف'); return; }
      rows.forEach(r => {
        const urgent = r.days_left <= 3;
        const tr = el('tr');
        tr.innerHTML = `
          <td>${userCell(r)}</td>
          <td><span class="muted">${r.deactivated_at ? new Date(r.deactivated_at).toLocaleDateString(admLocale()) : '—'}</span></td>
          <td><span class="muted">${new Date(r.deletion_scheduled_at).toLocaleDateString(admLocale())}</span></td>
          <td><span class="badge ${urgent ? 's-open' : ''}">${r.days_left} يوم</span></td>
          <td><div class="row-actions">
            <button class="btn-sm btn-secondary" data-act="cancel">إلغاء الحذف</button>
          </div></td>`;
        tr.querySelector('[data-act="cancel"]').onclick = async () => {
          const ok = await admConfirm('إلغاء الحذف',
            'سيُستعاد حساب ' + (r.name || r.handle) + ' ويعود ظاهرًا للجميع. افعل ذلك فقط بناءً على طلب صاحب الحساب.',
            'إلغاء الحذف');
          if (!ok) return;
          try { await window.API.adminCancelDeletion(r.id); toast('تم إلغاء الحذف'); load(); }
          catch (e) { toast(e.message); }
        };
        t.tb.appendChild(tr);
      });
    }
    load();
    return page;
  }

  // ===== Data export requests =====
  function viewExports() {
    const page = el('div', { class: 'adm-page' });
    page.appendChild(pageHeader('طلبات البيانات', 'طلبات نسخة من البيانات — مطلوبة قانونيًا في بعض الدول'));

    const t = queueTable(['المستخدم', 'التاريخ', 'الحالة', 'الملف', ''], 5);
    page.appendChild(t.wrap);

    const ST = { pending: 'قيد الانتظار', ready: 'جاهز', failed: 'فشل' };

    async function load() {
      t.busy('جاري التحميل...');
      let rows = [];
      try { rows = await window.API.adminFetchExports(); }
      catch (e) { t.empty(e.message); return; }
      t.tb.innerHTML = '';
      if (!rows.length) { t.empty('لا توجد طلبات'); return; }
      rows.forEach(r => {
        const tr = el('tr');
        tr.innerHTML = `
          <td>${userCell(r.profiles)}</td>
          <td><span class="muted">${new Date(r.requested_at).toLocaleString(admLocale())}</span></td>
          <td><span class="badge s-${r.status}">${ST[r.status] || r.status}</span></td>
          <td>${r.file_url ? '<a href="' + esc(r.file_url) + '" target="_blank" rel="noopener">تنزيل</a>' : '<span class="muted">—</span>'}</td>
          <td><div class="row-actions">
            ${r.status === 'pending' ? '<button class="btn-sm btn-primary" data-act="ready">إرفاق الملف</button><button class="btn-sm btn-secondary" data-act="fail">تعذّر</button>' : ''}
          </div></td>`;
        const readyBtn = tr.querySelector('[data-act="ready"]');
        if (readyBtn) readyBtn.onclick = async () => {
          const url = await admAsk('إرفاق ملف البيانات', 'ألصق رابط الملف بعد رفعه. سيصل المستخدم إليه من داخل التطبيق.');
          if (!url) return;
          try { await window.API.adminCompleteExport(r.id, url); toast('تم'); load(); }
          catch (e) { toast(e.message); }
        };
        const failBtn = tr.querySelector('[data-act="fail"]');
        if (failBtn) failBtn.onclick = async () => {
          try { await window.API.adminFailExport(r.id); toast('تم وضع علامة فشل'); load(); }
          catch (e) { toast(e.message); }
        };
        t.tb.appendChild(tr);
      });
    }
    load();
    return page;
  }

  // ===== Storage and upload limits =====
  function viewStorage() {
    const page = el('div', { class: 'adm-page' });
    page.appendChild(pageHeader('التخزين والحدود', 'الحد الأقصى للتخزين هو ما يمنع تجاوز الفاتورة — الرفع يتوقف عند بلوغه'));

    const stats = el('div', { class: 'stat-grid' });
    page.appendChild(stats);

    const bar = el('div', { class: 'usage-bar' }, [el('i')]);
    const barLabel = el('div', { class: 'muted', style: { fontSize: '12.5px', marginTop: '8px' } }, '');
    page.appendChild(el('div', { class: 'adm-card' }, [
      el('h3', {}, 'الاستهلاك'),
      bar,
      barLabel,
    ]));

    const bucketWrap = el('div', { class: 'table-wrap' });
    page.appendChild(bucketWrap);

    // Editable limits
    const fields = {};
    const LIMITS = [
      ['max_video_bytes', 'أقصى حجم للملف', 'MB', 1048576],
      ['user_daily_uploads', 'حد الرفع اليومي للمستخدم', 'مقطع', 1],
      ['user_daily_bytes', 'حد الحجم اليومي للمستخدم', 'MB', 1048576],
      ['global_max_bytes', 'سقف التخزين الكلي', 'MB', 1048576],
    ];
    const form = el('div', { class: 'adm-form-grid' });
    LIMITS.forEach(([k, label, unit, div]) => {
      const inp = el('input', { class: 'adm-input', type: 'number', min: '1' });
      fields[k] = { inp, div };
      form.appendChild(el('div', {}, [
        el('label', { class: 'adm-label' }, label + ' (' + unit + ')'),
        inp,
      ]));
    });
    const saveBtn = el('button', { class: 'btn-sm btn-primary' }, 'حفظ الحدود');
    page.appendChild(el('div', { class: 'adm-card' }, [
      el('h3', {}, 'حدود الرفع'),
      el('p', { class: 'muted', style: { fontSize: '12.5px', lineHeight: '1.7', marginBottom: '14px' } },
        'المشرفون معفون من هذه الحدود. سقف التخزين الكلي يجب أن يبقى أقل من حصة مزوّد التخزين.'),
      form,
      saveBtn,
    ]));

    saveBtn.onclick = async () => {
      const patch = {};
      for (const [k, , , div] of LIMITS) {
        const v = Number(fields[k].inp.value);
        if (!v || v <= 0) return toast('أدخل قيمة صحيحة');
        patch[k] = Math.round(v * div);
      }
      saveBtn.disabled = true;
      try { await window.API.updateAppLimits(patch); toast('تم حفظ الحدود'); load(); }
      catch (e) { toast(e.message); }
      saveBtn.disabled = false;
    };

    async function load() {
      try {
        const [ov, lim] = await Promise.all([
          window.API.adminStorageOverview(),
          window.API.fetchAppLimits(),
        ]);
        stats.innerHTML = '';
        stats.appendChild(statCard({ label: 'المستهلك', value: fmtBytes(ov.total_bytes), icon: 'bookmark', tone: 'primary' }));
        stats.appendChild(statCard({ label: 'السقف', value: fmtBytes(ov.limit_bytes), icon: 'lock', tone: 'info' }));
        stats.appendChild(statCard({ label: 'النسبة', value: ov.pct_used + '%', icon: 'sparkle', tone: ov.pct_used > 80 ? 'danger' : 'success' }));
        stats.appendChild(statCard({ label: 'عدد الملفات', value: (ov.buckets || []).reduce((a, b) => a + Number(b.files || 0), 0), icon: 'video', tone: 'warn' }));

        const pct = Math.min(100, Number(ov.pct_used) || 0);
        bar.querySelector('i').style.width = pct + '%';
        bar.classList.toggle('warn', pct > 80);
        barLabel.textContent = fmtBytes(ov.total_bytes) + ' من ' + fmtBytes(ov.limit_bytes);

        bucketWrap.innerHTML = '';
        const tb = el('table', { class: 'table' });
        tb.innerHTML = '<thead><tr><th>المجلد</th><th>الملفات</th><th>الحجم</th></tr></thead>'
          + '<tbody>' + (ov.buckets || []).map(b =>
            '<tr><td><strong>' + esc(b.bucket) + '</strong></td><td>' + b.files + '</td><td>' + fmtBytes(b.bytes) + '</td></tr>'
          ).join('') + '</tbody>';
        bucketWrap.appendChild(tb);

        if (lim) {
          for (const [k, , , div] of LIMITS) {
            fields[k].inp.value = Math.round(lim[k] / div);
          }
        }
      } catch (e) {
        stats.innerHTML = '';
        stats.appendChild(el('div', { class: 'muted', style: { padding: '20px' } }, e.message));
      }
    }
    load();
    return page;
  }

  // ===== Analytics =====
  // Was a set of hardcoded sample figures. Every number here now comes from
  // the database, and the range selector actually changes the query.
  function viewAnalytics() {
    const page = el('div', { class: 'adm-page' });
    let days = 30;
    const rangeSel = el('select', { class: 'adm-input', style: { width: 'auto' } }, [
      el('option', { value: '7' }, 'آخر 7 أيام'),
      el('option', { value: '30', selected: true }, 'آخر 30 يوم'),
      el('option', { value: '90' }, 'آخر 90 يوم'),
    ]);
    rangeSel.addEventListener('change', () => { days = Number(rangeSel.value); load(); });

    const csvBtn = el('button', { class: 'btn btn-secondary' }, 'تصدير CSV');
    page.appendChild(pageHeader('الإحصائيات', 'أرقام حقيقية من قاعدة البيانات', [csvBtn, rangeSel]));

    const stats = el('div', { class: 'stat-grid' });
    page.appendChild(stats);

    const chartCard = el('div', { class: 'adm-card' });
    page.appendChild(chartCard);

    let series = [];

    csvBtn.onclick = () => {
      if (!series.length) return toast('لا توجد بيانات');
      const csv = 'day,signups,videos,comments\n'
        + series.map(r => [r.day, r.signups, r.videos, r.comments].join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'flyp-analytics-' + days + 'd.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };

    async function load() {
      chartCard.innerHTML = '<div class="muted" style="padding:26px">جاري التحميل...</div>';
      try {
        const [s, growth] = await Promise.all([
          window.API.adminStats().catch(() => null),
          window.API.adminGrowth(days),
        ]);
        series = growth || [];

        const sum = (k) => series.reduce((a, r) => a + Number(r[k] || 0), 0);
        stats.innerHTML = '';
        stats.appendChild(statCard({ label: 'إجمالي الحسابات', value: fmt(s ? (s.users || 0) : 0), icon: 'user', tone: 'primary' }));
        stats.appendChild(statCard({ label: 'حسابات جديدة', value: fmt(sum('signups')), icon: 'sparkle', tone: 'success' }));
        stats.appendChild(statCard({ label: 'فيديوهات جديدة', value: fmt(sum('videos')), icon: 'video', tone: 'info' }));
        stats.appendChild(statCard({ label: 'تعليقات جديدة', value: fmt(sum('comments')), icon: 'comment', tone: 'warn' }));

        chartCard.innerHTML = '';
        chartCard.appendChild(el('h3', {}, 'النمو اليومي'));
        if (!series.length) {
          chartCard.appendChild(el('div', { class: 'muted', style: { padding: '20px' } }, 'لا توجد بيانات في هذه الفترة'));
          return;
        }
        const max = Math.max(1, ...series.map(r => Math.max(r.signups, r.videos, r.comments)));
        const chart = el('div', { class: 'adm-chart' });
        series.forEach(r => {
          const col = el('div', { class: 'adm-chart-col', title: chartTip(r) }, [
            el('i', { class: 'b1', style: { height: (r.signups / max * 100) + '%' } }),
            el('i', { class: 'b2', style: { height: (r.videos / max * 100) + '%' } }),
            el('i', { class: 'b3', style: { height: (r.comments / max * 100) + '%' } }),
          ]);
          chart.appendChild(col);
        });
        chartCard.appendChild(chart);
        chartCard.appendChild(el('div', { class: 'adm-legend' }, [
          el('span', {}, [el('i', { class: 'b1' }), document.createTextNode(' حسابات')]),
          el('span', {}, [el('i', { class: 'b2' }), document.createTextNode(' فيديوهات')]),
          el('span', {}, [el('i', { class: 'b3' }), document.createTextNode(' تعليقات')]),
        ]));
      } catch (e) {
        chartCard.innerHTML = '<div class="muted" style="padding:26px">' + esc(e.message) + '</div>';
      }
    }
    load();
    return page;
  }

  // ===== Location =====
  // Was four toggles that saved nothing. Shows who is actually sharing right
  // now, which is the only thing an operator can act on.
  function viewLocation() {
    const page = el('div', { class: 'adm-page' });
    page.appendChild(pageHeader('الموقع الجغرافي', 'الحسابات التي تشارك موقعها حاليًا — تنتهي المشاركة تلقائيًا بعد 8 ساعات'));

    const t = queueTable(['الحساب', 'الظهور', 'آخر تحديث', 'الإحداثيات'], 4);
    page.appendChild(t.wrap);

    const VIS = { public: 'الجميع', friends: 'الأصدقاء', none: 'لا أحد' };

    async function load() {
      t.busy('جاري التحميل...');
      let rows = [];
      try { rows = await window.API.adminFetchLocations(); }
      catch (e) { t.empty(e.message); return; }
      t.tb.innerHTML = '';
      if (!rows.length) { t.empty('لا أحد يشارك موقعه حاليًا'); return; }
      rows.forEach(r => {
        const stale = (Date.now() - new Date(r.updated_at).getTime()) > 8 * 3600 * 1000;
        const tr = el('tr');
        tr.innerHTML = `
          <td>${userCell(r.profiles)}</td>
          <td><span class="chip">${VIS[r.visibility] || r.visibility}</span></td>
          <td><span class="muted">${new Date(r.updated_at).toLocaleString(admLocale())}${stale ? ' — منتهية' : ''}</span></td>
          <td><code style="font-size:11px">${Number(r.lat).toFixed(3)}, ${Number(r.lng).toFixed(3)}</code></td>`;
        t.tb.appendChild(tr);
      });
    }
    load();
    return page;
  }

  // ===== Broadcast a notification =====
  // The API existed since the beginning and was never connected to the form.
  function viewNotifications() {
    const page = el('div', { class: 'adm-page' });
    page.appendChild(pageHeader('إرسال إشعار', 'يصل الإشعار داخل التطبيق لجميع الحسابات'));

    const title = el('input', { class: 'adm-input', maxlength: '60', placeholder: 'عنوان قصير' });
    const body = el('textarea', { class: 'adm-input', rows: '4', maxlength: '200', placeholder: 'نص الإشعار' });
    const count = el('div', { class: 'muted', style: { fontSize: '12px', marginTop: '6px' } }, '');
    const sendBtn = el('button', { class: 'btn-sm btn-primary', disabled: true }, 'إرسال للجميع');

    const preview = el('div', { class: 'adm-notif-preview' }, [
      el('div', { class: 'adm-notif-icon', html: icons.bell }),
      el('div', {}, [
        el('strong', { class: 'pv-title' }, 'عنوان الإشعار'),
        el('div', { class: 'muted pv-body' }, 'نص الإشعار سيظهر هنا'),
      ]),
    ]);

    const refresh = () => {
      preview.querySelector('.pv-title').textContent = title.value || 'عنوان الإشعار';
      preview.querySelector('.pv-body').textContent = body.value || 'نص الإشعار سيظهر هنا';
      sendBtn.disabled = !(title.value.trim() && body.value.trim());
    };
    title.addEventListener('input', refresh);
    body.addEventListener('input', refresh);

    sendBtn.onclick = async () => {
      const ok = await admConfirm('إرسال إشعار',
        'سيصل هذا الإشعار إلى كل حساب في التطبيق. لا يمكن التراجع.', 'إرسال', true);
      if (!ok) return;
      sendBtn.disabled = true;
      sendBtn.textContent = 'جارٍ الإرسال...';
      try {
        await window.API.adminBroadcastNotification({ title: title.value.trim(), body: body.value.trim() });
        toast('تم الإرسال');
        title.value = ''; body.value = ''; refresh();
      } catch (e) { toast(e.message); }
      sendBtn.textContent = 'إرسال للجميع';
      sendBtn.disabled = false;
    };

    (async () => {
      try {
        const s = await window.API.adminStats();
        count.textContent = 'سيصل إلى ' + fmt(s.users || 0) + ' حساب';
      } catch (e) {}
    })();

    page.appendChild(el('div', { class: 'adm-card' }, [
      el('h3', {}, 'إشعار جديد'),
      el('label', { class: 'adm-label' }, 'العنوان'),
      title,
      el('label', { class: 'adm-label' }, 'النص'),
      body,
      count,
      el('div', { style: { marginTop: '16px' } }, [sendBtn]),
    ]));

    page.appendChild(el('div', { class: 'adm-card' }, [
      el('h3', {}, 'معاينة'),
      preview,
    ]));

    return page;
  }

  // ===== Ads =====
  // The four ad API functions have always existed; this form never called them.
  function viewAds() {
    const page = el('div', { class: 'adm-page' });
    const newBtn = el('button', { class: 'btn-sm btn-primary' }, 'حملة جديدة');
    page.appendChild(pageHeader('الإعلانات', 'حملات تظهر داخل الموجز', [newBtn]));

    const t = queueTable(['العنوان', 'الرابط', 'الحالة', 'أُنشئت', ''], 5);
    page.appendChild(t.wrap);

    newBtn.onclick = () => openAd(null);

    function openAd(row) {
      const title = el('input', { class: 'adm-input', placeholder: 'عنوان الحملة' });
      const image = el('input', { class: 'adm-input', placeholder: 'رابط الصورة' });
      const link = el('input', { class: 'adm-input', placeholder: 'رابط الوجهة' });
      if (row) { title.value = row.title || ''; image.value = row.image_url || ''; link.value = row.link_url || ''; }
      const save = el('button', { class: 'btn-sm btn-primary' }, row ? 'حفظ' : 'إنشاء');
      const cancel = el('button', { class: 'btn-sm btn-secondary', onclick: () => close() }, 'إلغاء');
      const close = modalAdm(row ? 'تعديل الحملة' : 'حملة جديدة', [
        el('label', { class: 'adm-label' }, 'العنوان'), title,
        el('label', { class: 'adm-label' }, 'الصورة'), image,
        el('label', { class: 'adm-label' }, 'الوجهة'), link,
      ], [cancel, save]);
      save.onclick = async () => {
        if (!title.value.trim()) return toast('أدخل عنوانًا');
        save.disabled = true;
        const payload = { title: title.value.trim(), image_url: image.value.trim() || null, link_url: link.value.trim() || null };
        try {
          if (row) await window.API.adminUpdateAd(row.id, payload);
          else await window.API.adminCreateAd({ ...payload, active: true });
          toast('تم'); close(); load();
        } catch (e) { toast(e.message); save.disabled = false; }
      };
    }

    async function load() {
      t.busy('جاري التحميل...');
      let rows = [];
      try { rows = await window.API.adminFetchAds(); }
      catch (e) { t.empty(e.message); return; }
      t.tb.innerHTML = '';
      if (!rows.length) { t.empty('لا توجد حملات'); return; }
      rows.forEach(r => {
        const tr = el('tr');
        tr.innerHTML = `
          <td><strong>${esc(r.title || '—')}</strong></td>
          <td>${r.link_url ? '<a href="' + esc(r.link_url) + '" target="_blank" rel="noopener">فتح</a>' : '<span class="muted">—</span>'}</td>
          <td><span class="badge ${r.active ? 's-resolved' : ''}">${r.active ? 'نشطة' : 'متوقفة'}</span></td>
          <td><span class="muted">${r.created_at ? new Date(r.created_at).toLocaleDateString(admLocale()) : '—'}</span></td>
          <td><div class="row-actions">
            <button class="btn-sm btn-secondary" data-act="edit">تعديل</button>
            <button class="btn-sm btn-secondary" data-act="toggle">${r.active ? 'إيقاف' : 'تشغيل'}</button>
            <button class="btn-sm btn-danger" data-act="del">حذف</button>
          </div></td>`;
        tr.querySelector('[data-act="edit"]').onclick = () => openAd(r);
        tr.querySelector('[data-act="toggle"]').onclick = async () => {
          try { await window.API.adminUpdateAd(r.id, { active: !r.active }); load(); }
          catch (e) { toast(e.message); }
        };
        tr.querySelector('[data-act="del"]').onclick = async () => {
          const ok = await admConfirm('حذف الحملة', 'سيُحذف الإعلان نهائيًا.', 'حذف', true);
          if (!ok) return;
          try { await window.API.adminDeleteAd(r.id); toast('تم الحذف'); load(); }
          catch (e) { toast(e.message); }
        };
        t.tb.appendChild(tr);
      });
    }
    load();
    return page;
  }

  // ===== Router =====
  const routes = {
    '/login-admin': () => viewLogin(),
    '/dashboard': () => buildShell('dashboard', viewDashboard()),
    '/users': () => buildShell('users', viewUsers()),
    '/videos': () => buildShell('videos', viewVideos()),
    '/comments': () => buildShell('comments', viewComments()),
    '/reports': () => buildShell('reports', viewReports()),
    '/live': () => buildShell('live', viewLive()),
    '/ads': () => buildShell('ads', viewAds()),
    '/notifications': () => buildShell('notif', viewNotifications()),
    '/analytics': () => buildShell('analytics', viewAnalytics()),
    '/tickets': () => buildShell('tickets', viewTickets()),
    '/deletions': () => buildShell('deletions', viewDeletions()),
    '/exports': () => buildShell('exports', viewExports()),
    '/storage': () => buildShell('storage', viewStorage()),
    '/logs': () => buildShell('logs', viewLogs()),
    '/location': () => buildShell('location', viewLocation()),
  };

  // Fetched after each page render and painted straight onto the existing
  // sidebar links, so nothing else on the page is disturbed.
  async function loadQueueCounts() {
    let q = null;
    try { q = await window.API.adminQueueCounts(); }
    catch (e) { return; }        // migration not applied yet - badges stay hidden
    if (!q) return;
    QUEUE = q;
    NAV.forEach(g => g.items.forEach(it => {
      if (!it.badge) return;
      const link = document.querySelector('.adm-sidebar a[href="' + it.go + '"]');
      if (!link) return;
      const n = Number(q[it.badge] || 0);
      let b = link.querySelector('.adm-nav-badge');
      if (!n) { if (b) b.remove(); return; }
      if (!b) { b = el('span', { class: 'adm-nav-badge' }); link.appendChild(b); }
      b.textContent = n > 99 ? '99+' : String(n);
    }));
  }

  let tableObserver = null;
  function watchTables(root) {
    if (tableObserver) tableObserver.disconnect();
    if (!('MutationObserver' in window)) return;
    tableObserver = new MutationObserver(() => labelTableCells(root));
    root.querySelectorAll('table.table tbody').forEach(tb => {
      tableObserver.observe(tb, { childList: true });
    });
  }

  let adminChecked = false;
  let isAdmin = false;
  async function render() {
    const path = (location.hash || '#/dashboard').slice(1) || '/dashboard';

    // Auth + admin gate (skip on the login page itself)
    if (path !== '/login-admin') {
      if (!adminChecked) {
        try {
          const session = await window.SB.getSession();
          if (!session) { location.hash = '#/login-admin'; return; }
          isAdmin = await window.API.adminCheckIsAdmin();
          adminChecked = true;
        } catch (e) { console.warn('admin guard:', e); location.hash = '#/login-admin'; return; }
      }
      if (!isAdmin) {
        root.innerHTML = '';
        const card = el('div', { style: { maxWidth: '420px', margin: '60px auto', padding: '24px', background: '#fff', borderRadius: '12px', textAlign: 'center', border: '1px solid var(--border)' } }, [
          el('h2', {}, 'وصول غير مسموح'),
          el('p', { class: 'muted' }, 'هذا الحساب ليس لديه صلاحيات إدارية.'),
          el('button', { class: 'btn', onclick: async () => { try { await window.SB.signOut(); } catch (e) {} location.hash = '#/login-admin'; location.reload(); } }, 'تسجيل الخروج والدخول كمشرف'),
        ]);
        root.appendChild(card);
        return;
      }
    }

    const fn = routes[path] || routes['/dashboard'];
    root.innerHTML = '';
    try {
      root.appendChild(fn());
      // Translate the freshly-rendered admin view when English is active
      try { if (window.I18N) window.I18N.apply(root); } catch (e2) {}
      window.scrollTo(0, 0);
      // Rows arrive asynchronously after the view paints, so column labels
      // are stamped again whenever a table body changes.
      labelTableCells(root);
      watchTables(root);
      // Badges arrive after the page paints. Only the sidebar counters are
      // touched - re-rendering the page would refetch everything on it.
      if (path !== '/login-admin') loadQueueCounts();
    } catch (e) {
      console.error(e);
      root.innerHTML = '<div style="padding:40px">خطأ: ' + e.message + '</div>';
    }
  }

  // override toast for admin
  window.H.toast = function (msg) {
    const t = el('div', { class: 'adm-toast', textContent: msg });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  };

  window.addEventListener('hashchange', render);
  // Language switch re-renders the current admin view from its Arabic source
  window.addEventListener('tt-rerender', render);
  if (document.readyState !== 'loading') render();
  else window.addEventListener('DOMContentLoaded', render);
})();
