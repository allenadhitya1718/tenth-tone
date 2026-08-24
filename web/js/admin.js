/* === Admin dashboard SPA === */
(function () {
  const { el, esc, safeUrl, fmt, toast, icons, svg } = window.H;
  const DB = window.DB;

  const root = document.getElementById('admin');

  const NAV = [
    { sec: 'الرئيسية', items: [
      { k: 'dashboard', l: 'الرئيسية', i: 'home', go: '#/dashboard' },
      { k: 'analytics', l: 'الإحصائيات', i: 'sparkle', go: '#/analytics' },
    ]},
    { sec: 'المحتوى', items: [
      { k: 'users', l: 'إدارة الحسابات', i: 'user', go: '#/users' },
      { k: 'videos', l: 'الفيديوهات', i: 'video', go: '#/videos' },
      { k: 'comments', l: 'التعليقات', i: 'comment', go: '#/comments' },
      { k: 'reports', l: 'البلاغات', i: 'flag', go: '#/reports' },
      { k: 'live', l: 'البث المباشر', i: 'eye', go: '#/live' },
    ]},
    { sec: 'النقدية', items: [
      { k: 'wallet', l: 'الهدايا والمحفظة', i: 'gift', go: '#/wallet' },
      { k: 'ads', l: 'الإعلانات', i: 'image', go: '#/ads' },
    ]},
    { sec: 'النظام', items: [
      { k: 'notif', l: 'الإشعارات', i: 'bell', go: '#/notifications' },
      { k: 'employees', l: 'الموظفون', i: 'user', go: '#/employees' },
      { k: 'roles', l: 'الأدوار والصلاحيات', i: 'lock', go: '#/roles' },
      { k: 'logs', l: 'سجل الأنشطة', i: 'eye', go: '#/logs' },
      { k: 'location', l: 'الموقع الجغرافي', i: 'map', go: '#/location' },
      { k: 'settings', l: 'الإعدادات', i: 'settings', go: '#/settings' },
    ]},
  ];

  const me = { name: 'المشرف الرئيسي', role: 'Super Admin', avatar: 'https://i.pravatar.cc/100?u=admin' };

  // Language switch (Arabic ⇄ English) for the admin topbar
  function admLangSwitch() {
    const cur = (window.I18N && window.I18N.getLang()) || 'ar';
    const wrap = el('div', { class: 'lang-switch compact' });
    [['ar', 'ع'], ['en', 'EN']].forEach(([code, label]) => {
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
    card.appendChild(el('div', { class: 'auth-logo-svg', html: icons.logo, style: { width: '64px', height: '64px', margin: '0 auto 12px' } }));
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
      el('div', {}, [el('div', { class: 'name' }, 'Tenth Tone'), el('div', { class: 'sub' }, 'Admin Panel')]),
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
        nav.appendChild(el('a', { href: it.go, class: 'adm-nav' + (it.k === active ? ' active' : ''), onclick: () => closeSidebar() }, [
          svg(it.i),
          el('span', {}, it.l),
        ]));
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
    top.appendChild(el('button', { class: 'icon-btn', html: icons.menu, onclick: toggleSidebar, style: { display: 'none' }, id: 'sidebar-toggle' }));
    top.appendChild(el('div', { class: 'search' }, [el('input', { placeholder: 'بحث سريع...' })]));
    top.appendChild(el('span', { class: 'spacer' }));
    top.appendChild(admLangSwitch());
    top.appendChild(el('button', { class: 'icon-btn', html: icons.bell }, [el('span', { class: 'badge' }, '5')]));
    top.appendChild(el('button', { class: 'icon-btn', html: icons.settings, onclick: () => location.hash = '#/settings' }));
    top.appendChild(el('div', { class: 'adm-user' }, [
      el('div', { class: 'avatar' }, [Object.assign(document.createElement('img'), { src: me.avatar })]),
      el('div', {}, [el('div', { class: 'name' }, me.name), el('div', { class: 'role' }, me.role)]),
      svg('chevD', { style: { width: '14px', height: '14px' } }),
    ]));
    main.appendChild(top);
    main.appendChild(content);
    shell.appendChild(main);

    function toggleSidebar() { side.classList.toggle('open'); }
    function closeSidebar() { side.classList.remove('open'); }
    return shell;
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
      <defs><linearGradient id="grad-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6c2bd9" stop-opacity="0.5"/><stop offset="100%" stop-color="#6c2bd9" stop-opacity="0"/></linearGradient></defs>
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

  // ===== Pages =====
  function viewDashboard() {
    const page = el('div', { class: 'adm-page' });
    page.appendChild(pageHeader('لوحة التحكم', 'نظرة عامة على المنصة'));
    const stats = el('div', { class: 'stats-grid' });
    const c1 = statCard({ label: 'إجمالي المستخدمين', value: '...', icon: 'user', tone: 'primary' });
    const c2 = statCard({ label: 'إجمالي الفيديوهات', value: '...', icon: 'video', tone: 'info' });
    const c3 = statCard({ label: 'بثوث مباشرة الآن', value: '...', icon: 'eye', tone: 'success' });
    const c4 = statCard({ label: 'بلاغات قيد المراجعة', value: '...', icon: 'flag', tone: 'danger' });
    stats.appendChild(c1); stats.appendChild(c2); stats.appendChild(c3); stats.appendChild(c4);
    page.appendChild(stats);
    // Async load real stats
    (async () => {
      try {
        if (!window.API) return;
        const s = await window.API.adminStats();
        c1.querySelector('.value').textContent = fmt(s.total_users || 0);
        c2.querySelector('.value').textContent = fmt(s.total_videos || 0);
        c3.querySelector('.value').textContent = fmt(s.live_now || 0);
        c4.querySelector('.value').textContent = fmt(s.pending_reports || 0);
      } catch (e) { console.warn('admin stats:', e); }
    })();

    // 2-col: line chart + donut
    const grid = el('div', { class: 'grid-2' });
    const left = el('div', { class: 'card' });
    left.appendChild(el('div', { class: 'card-h' }, [el('h3', {}, 'النشاط خلال الأسبوع'), el('div', { class: 'actions' }, [el('button', { class: 'btn btn-secondary btn-sm' }, '7 أيام'), el('button', { class: 'btn-ghost btn-sm' }, '30 يوم')])]));
    left.appendChild(chartLine([1200, 1800, 1400, 2100, 1700, 2500, 2200], ['س', 'أ', 'إ', 'ث', 'ر', 'خ', 'ج']));
    left.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-around', color: 'var(--muted)', fontSize: '12px' } },
      ['السبت','الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة'].map(d => el('span', {}, d))));
    grid.appendChild(left);

    const right = el('div', { class: 'card' });
    right.appendChild(el('div', { class: 'card-h' }, [el('h3', {}, 'توزيع المحتوى')]));
    right.appendChild(donut([
      { v: 45, c: '#6c2bd9' }, { v: 28, c: '#8b5bff' }, { v: 17, c: '#ec4899' }, { v: 10, c: '#f59e0b' }
    ]));
    right.appendChild(el('div', { style: { padding: '14px 4px', display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' } }, [
      el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', {}, [el('span', { style: { width: '10px', height: '10px', background: '#6c2bd9', display: 'inline-block', marginEnd: '6px', borderRadius: '50%' } }), document.createTextNode(' ترفيه')]), el('strong', {}, '45%')]),
      el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', {}, [el('span', { style: { width: '10px', height: '10px', background: '#8b5bff', display: 'inline-block', marginEnd: '6px', borderRadius: '50%' } }), document.createTextNode(' طبخ')]), el('strong', {}, '28%')]),
      el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', {}, [el('span', { style: { width: '10px', height: '10px', background: '#ec4899', display: 'inline-block', marginEnd: '6px', borderRadius: '50%' } }), document.createTextNode(' رياضة')]), el('strong', {}, '17%')]),
      el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [el('span', {}, [el('span', { style: { width: '10px', height: '10px', background: '#f59e0b', display: 'inline-block', marginEnd: '6px', borderRadius: '50%' } }), document.createTextNode(' أخرى')]), el('strong', {}, '10%')]),
    ]));
    grid.appendChild(right);
    page.appendChild(grid);

    // bottom: top users + activity
    const grid2 = el('div', { class: 'grid-2', style: { marginTop: '14px' } });
    const topU = el('div', { class: 'card' });
    topU.appendChild(el('div', { class: 'card-h' }, [el('h3', {}, 'أعلى المستخدمين متابعةً'), el('a', { class: 'btn-ghost btn-sm', href: '#/users' }, 'عرض الكل')]));
    const list = el('div', { class: 'top-list' }); topU.appendChild(list);
    (async () => {
      try {
        const users = await window.API.adminFetchUsers({});
        users.sort((a, b) => (b.followers_count || 0) - (a.followers_count || 0));
        list.innerHTML = '';
        users.slice(0, 6).forEach((u, i) => list.appendChild(el('div', { class: 'top-item' }, [
          el('div', { class: 'rank' }, '#' + (i + 1)),
          el('div', { class: 'av' }, [Object.assign(document.createElement('img'), { src: u.avatar_url || '' })]),
          el('div', { class: 'body' }, [el('div', { class: 'ttl' }, u.name + (u.is_admin ? ' (مشرف)' : '')), el('div', { class: 'sub' }, '@' + (u.handle || ''))]),
          el('div', { class: 'num' }, fmt(u.followers_count || 0) + ' متابع'),
        ])));
      } catch (e) { console.warn('top users:', e); }
    })();
    grid2.appendChild(topU);

    const act = el('div', { class: 'card' });
    act.appendChild(el('div', { class: 'card-h' }, [el('h3', {}, 'آخر النشاطات'), el('a', { class: 'btn-ghost btn-sm', href: '#/logs' }, 'سجل كامل')]));
    const al = el('div', { class: 'activity-list' }); act.appendChild(al);
    (async () => {
      try {
        const logs = await window.API.adminFetchLogs({ limit: 8 });
        al.innerHTML = '';
        if (!logs.length) { al.appendChild(el('div', { class: 'muted', style: { padding: '12px' } }, 'لا توجد نشاطات بعد')); return; }
        logs.forEach(L => al.appendChild(el('div', { class: 'activity-item' }, [
          el('div', { class: 'ai-icon', style: { background: 'var(--primary-soft)', color: 'var(--primary)' }, html: icons.eye }),
          el('div', { class: 'ai-text' }, [el('b', {}, (L.admin && L.admin.name) || 'مشرف'), document.createTextNode(' · ' + L.action.replace(/_/g, ' '))]),
          el('div', { class: 'ai-time' }, _ago(L.created_at)),
        ])));
      } catch (e) { console.warn('logs:', e); }
    })();
    grid2.appendChild(act);
    page.appendChild(grid2);

    return page;
  }
  function _ago(iso) { if (!iso) return ''; const t = Date.now() - new Date(iso).getTime(); const m = Math.floor(t / 60000); if (m < 1) return 'الآن'; if (m < 60) return 'منذ ' + m + 'د'; const h = Math.floor(m / 60); if (h < 24) return 'منذ ' + h + 'س'; return 'منذ ' + Math.floor(h / 24) + 'ي'; }

  // ===== Users =====
  function viewUsers() {
    const page = el('div', { class: 'adm-page' });
    page.appendChild(pageHeader('إدارة الحسابات', 'بحث، تعديل البروفايل، المحفظة، التحقق، الحظر، الحذف'));
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
          tr.appendChild(el('td', {}, new Date(u.created_at).toLocaleDateString('ar-SA')));
          tr.appendChild(el('td', {}, [el('div', { class: 'row-actions' }, [openBtn, banBtn])]));

          // Whole row + "إدارة" button → open detail modal
          const openModal = (e) => { e && e.stopPropagation(); openUserModal(u); };
          tr.addEventListener('click', openModal);
          openBtn.onclick = openModal;
          banBtn.onclick = async (e) => {
            e.stopPropagation();
            const days = isBanned ? null : prompt('عدد أيام الحظر (فارغ = دائم):', '7');
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

    // ── Full user-management modal: profile editor + wallet + roles + delete ──
    async function openUserModal(u) {
      const body = el('div', {}, [el('div', { class: 'muted', style: { padding: '20px', textAlign: 'center' } }, 'جاري التحميل...')]);
      const close = modalAdm('إدارة المستخدم', body, []);
      let detail;
      try { detail = await window.API.adminFetchUserDetail(u.id); }
      catch (e) { body.innerHTML = ''; body.appendChild(el('div', { class: 'muted', style: { padding: '20px', color: 'var(--danger)' } }, 'تعذر التحميل: ' + (e.message || e))); return; }
      const p = (detail && detail.profile) || u;
      const w = (detail && detail.wallet) || { balance: 0 };
      const isBanned = p.banned_until && new Date(p.banned_until) > new Date();

      body.innerHTML = '';

      // Header (avatar + handle + quick badges)
      body.appendChild(el('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' } }, [
        el('div', { class: 'av', style: { width: '64px', height: '64px', borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: '#eee' } },
           [Object.assign(document.createElement('img'), { src: p.avatar_url || '', style: 'width:100%;height:100%;object-fit:cover' })]),
        el('div', { style: { flex: 1, minWidth: 0 } }, [
          el('div', { style: { fontWeight: 700, fontSize: '16px' } }, (p.name || '') + (p.verified ? ' ✓' : '')),
          el('div', { class: 'muted', style: { fontSize: '13px' } }, '@' + (p.handle || '')),
          el('div', { class: 'muted', style: { fontSize: '11.5px', marginTop: '2px' } }, 'انضم: ' + new Date(p.created_at).toLocaleDateString('ar-SA')),
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

      // ── Wallet panel
      body.appendChild(el('h4', { style: { margin: '20px 0 6px', fontSize: '13px', color: 'var(--muted)' } }, 'المحفظة'));
      const balanceEl = el('div', { style: { fontSize: '20px', fontWeight: 800 } }, '🪙 ' + fmt(w.balance || 0));
      const deltaIn = el('input', { class: 'input', type: 'number', placeholder: 'العدد (سالب للخصم)', style: { width: '140px' } });
      const reasonIn = el('input', { class: 'input', placeholder: 'السبب (اختياري)', style: { flex: 1 } });
      const walletRow = el('div', { style: { display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' } }, [
        deltaIn, reasonIn,
        el('button', { class: 'btn', onclick: async (e) => {
          const delta = parseInt(deltaIn.value, 10);
          if (!Number.isFinite(delta) || delta === 0) { toast('أدخل قيمة صحيحة ≠ 0'); return; }
          const btn = e.currentTarget; btn.disabled = true; const orig = btn.textContent; btn.textContent = '...';
          try {
            const newBal = await window.API.adminAdjustWallet(p.id, delta, reasonIn.value || null);
            balanceEl.textContent = '🪙 ' + fmt(newBal);
            deltaIn.value = ''; reasonIn.value = '';
            toast('تم تعديل الرصيد');
          } catch (err) { toast(err.message || 'فشل'); }
          finally { btn.disabled = false; btn.textContent = orig; }
        } }, 'تطبيق'),
      ]);
      body.appendChild(el('div', { style: { background: '#f6f6fa', borderRadius: '8px', padding: '12px' } }, [
        el('div', { class: 'muted', style: { fontSize: '11.5px', marginBottom: '4px' } }, 'الرصيد الحالي'),
        balanceEl,
        el('div', { class: 'muted', style: { fontSize: '11.5px', margin: '10px 0 4px' } }, 'تعديل الرصيد (+ إيداع / − خصم)'),
        walletRow,
      ]));

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
          if (!confirm((p.is_admin ? 'إزالة' : 'تعيين') + ' دور المشرف لـ ' + p.name + '?')) return;
          try { await window.API.adminToggleAdmin(p.id, !p.is_admin); toast('تم'); close(); load(); }
          catch (err) { toast(err.message); }
        } }, p.is_admin ? 'إزالة الإشراف' : 'تعيين مشرف'),
        el('button', { class: 'btn-sm btn-' + (isBanned ? 'secondary' : 'danger'), onclick: async () => {
          const days = isBanned ? null : prompt('عدد أيام الحظر (فارغ = دائم):', '7');
          if (days === null && !isBanned) return;
          try { await window.API.adminBanUser(p.id, days === null ? null : (days === '' ? 36500 : parseInt(days))); toast('تم'); close(); load(); }
          catch (err) { toast(err.message); }
        } }, isBanned ? 'إلغاء الحظر' : 'حظر مؤقت'),
        el('button', { class: 'btn-sm btn-danger', style: { marginInlineStart: 'auto' }, onclick: async () => {
          if (!confirm('حذف حساب ' + p.name + ' نهائيًا؟ هذا الإجراء غير قابل للتراجع.\nسيتم حذف جميع الفيديوهات والمحفظة والتعليقات.')) return;
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
                el('div', { class: 'muted', style: { fontSize: '11.5px' } }, new Date(v.created_at).toLocaleString('ar-SA')),
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
            if (!confirm('حذف هذا الفيديو نهائيًا؟')) return;
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
            if (!confirm('حذف هذا التعليق نهائيًا؟')) return;
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
          tr.appendChild(el('td', { class: 'muted', style: { fontSize: '12px' } }, new Date(c.created_at).toLocaleString('ar-SA')));
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
            <td>${new Date(r.created_at).toLocaleString('ar-SA')}</td>
            <td><div class="row-actions">
              <button class="btn-sm btn-danger" data-act="resolve">حسم بإجراء</button>
              <button class="btn-sm btn-secondary" data-act="dismiss">رفض</button>
            </div></td>`;
          tr.querySelector('[data-act="resolve"]').onclick = async () => {
            const action = prompt('الإجراء المتخذ (مثال: تم حذف المحتوى / تم تحذير المستخدم):', 'تم حذف المحتوى');
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
          const bg = l.thumbnail || (DB.videos[0] && DB.videos[0].bg) || '';
          card.appendChild(el('div', { style: { aspectRatio: '16/9', backgroundImage: `url(${bg})`, backgroundSize: 'cover', position: 'relative' } }, [
            el('div', { style: { position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.1), rgba(0,0,0,0.6))' } }),
            el('div', { style: { position: 'absolute', top: '8px', insetInlineStart: '8px' } }, [el('span', { class: 'badge danger' }, '● مباشر')]),
            el('div', { style: { position: 'absolute', top: '8px', insetInlineEnd: '8px' } }, [el('span', { class: 'badge muted', style: { background: 'rgba(0,0,0,0.5)', color: '#fff' } }, fmt(l.viewer_count || 0) + ' 👁')]),
            el('div', { style: { position: 'absolute', bottom: '8px', insetInlineStart: '8px', color: '#fff', fontWeight: 700 } }, l.title || 'بث مباشر'),
          ]));
          const endBtn = el('button', { class: 'btn btn-danger btn-sm' }, 'إنهاء');
          endBtn.onclick = async () => {
            if (!confirm('إنهاء هذا البث الآن؟')) return;
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

  // ===== Ads =====
  function viewAds() {
    const page = el('div', { class: 'adm-page' });
    page.appendChild(pageHeader('الإعلانات', 'إدارة الحملات الإعلانية وتتبع الأداء', [
      el('button', { class: 'btn', onclick: () => openAdModal() }, [svg('plus'), document.createTextNode(' حملة جديدة')]),
    ]));
    const stats = el('div', { class: 'stats-grid' });
    stats.appendChild(statCard({ label: 'حملات نشطة', value: '24', icon: 'sparkle', tone: 'success' }));
    stats.appendChild(statCard({ label: 'مشاهدات اليوم', value: '4.2M', icon: 'eye', tone: 'info' }));
    stats.appendChild(statCard({ label: 'نقرات', value: '128K', delta: '+5.2%', icon: 'arrowR', tone: 'primary' }));
    stats.appendChild(statCard({ label: 'CTR', value: '3.04%', delta: '+0.1%', icon: 'sparkle', tone: 'warn' }));
    page.appendChild(stats);

    const tableWrap = el('div', { class: 'table-wrap' });
    const table = el('table', { class: 'table' });
    table.innerHTML = `<thead><tr><th>الحملة</th><th>الفئة المستهدفة</th><th>المدة</th><th>المشاهدات</th><th>النقرات</th><th>CTR</th><th>الحالة</th><th></th></tr></thead>`;
    const tb = el('tbody');
    const camps = ['عرض رمضان الكبير', 'إطلاق الجيل الجديد', 'تخفيضات الموسم', 'مهرجان الطعام', 'دروس الطبخ المباشرة', 'بطاقات الهدايا', 'استبيان المنتج', 'باقة Premium'];
    camps.forEach((c, i) => {
      const status = i === 1 ? ['warn', 'متوقفة'] : i === 5 ? ['muted', 'منتهية'] : ['success', 'نشطة'];
      const tr = el('tr');
      tr.innerHTML = `
        <td><strong>${c}</strong><div class="muted" style="font-size:11.5px">#${1000 + i}</div></td>
        <td>${i % 2 === 0 ? '18-35 · الرياض' : '20-45 · جدة, الدمام'}</td>
        <td>${15 - i % 5} يوم متبقي</td>
        <td>${fmt(120000 + i * 50000)}</td>
        <td>${fmt(3000 + i * 1700)}</td>
        <td>${(2 + (i * 0.3) % 4).toFixed(2)}%</td>
        <td><span class="badge ${status[0]}">${status[1]}</span></td>
        <td><div class="row-actions">
          <button class="btn-icon btn-ghost" title="تحرير">${icons.settings}</button>
          <button class="btn-icon btn-ghost" title="إيقاف">${icons.x}</button>
        </div></td>`;
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    tableWrap.appendChild(table);
    page.appendChild(tableWrap);

    function openAdModal() {
      const body = el('div', {});
      body.innerHTML = `
        <div class="field"><label>عنوان الحملة</label><input placeholder="عنوان الإعلان"/></div>
        <div class="field"><label>نص الإعلان</label><textarea placeholder="نص قصير وجذاب"></textarea></div>
        <div class="field"><label>الرابط (URL)</label><input placeholder="https://"/></div>
        <div class="field-row">
          <div class="field"><label>تاريخ البداية</label><input type="date"/></div>
          <div class="field"><label>تاريخ النهاية</label><input type="date"/></div>
        </div>
        <div class="field"><label>الفئة المستهدفة</label>
          <div class="checks">
            <label class="check"><input type="checkbox"/> 18-24</label>
            <label class="check"><input type="checkbox" checked/> 25-34</label>
            <label class="check"><input type="checkbox" checked/> 35-44</label>
            <label class="check"><input type="checkbox"/> 45+</label>
          </div>
        </div>
        <div class="field"><label>الموقع الجغرافي</label>
          <select><option>الرياض</option><option>جدة</option><option>الدمام</option><option>كل المملكة</option></select>
        </div>`;
      const close = modalAdm('إنشاء حملة إعلانية', body, [
        el('button', { class: 'btn btn-secondary', onclick: () => close() }, 'إلغاء'),
        el('button', { class: 'btn', onclick: () => { close(); toast('تم إنشاء الحملة'); } }, 'حفظ ونشر'),
      ]);
    }
    return page;
  }

  // ===== Notifications =====
  function viewNotifications() {
    const page = el('div', { class: 'adm-page' });
    page.appendChild(pageHeader('الإشعارات', 'إرسال إشعارات عامة أو موجهة لفئات محددة'));
    const grid = el('div', { class: 'grid-2' });
    const composer = el('div', { class: 'card' });
    composer.appendChild(el('div', { class: 'card-h' }, [el('h3', {}, 'إشعار جديد')]));
    const cb = el('div', {});
    cb.innerHTML = `
      <div class="field"><label>نوع الإشعار</label>
        <select><option>عام (لجميع المستخدمين)</option><option>موجه (فئة محددة)</option><option>مستخدمون نشطون اليوم</option></select>
      </div>
      <div class="field"><label>العنوان</label><input placeholder="عنوان الإشعار" maxlength="100"/></div>
      <div class="field"><label>المحتوى</label><textarea placeholder="نص الإشعار" maxlength="300"></textarea></div>
      <div class="field"><label>الفئة المستهدفة (اختياري)</label>
        <div class="checks">
          <label class="check"><input type="checkbox"/> الرياض</label>
          <label class="check"><input type="checkbox"/> جدة</label>
          <label class="check"><input type="checkbox"/> ذكور</label>
          <label class="check"><input type="checkbox"/> إناث</label>
          <label class="check"><input type="checkbox"/> 18-25</label>
        </div>
      </div>
      <div class="field"><label>الجدولة</label>
        <select><option>إرسال فوري</option><option>جدولة لوقت لاحق</option></select>
      </div>`;
    composer.appendChild(cb);
    composer.appendChild(el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '14px' } }, [
      el('button', { class: 'btn btn-secondary', onclick: () => toast('تم الحفظ كمسودة') }, 'حفظ كمسودة'),
      el('button', { class: 'btn', onclick: () => toast('تم إرسال الإشعار') }, 'إرسال'),
    ]));
    grid.appendChild(composer);

    const recent = el('div', { class: 'card' });
    recent.appendChild(el('div', { class: 'card-h' }, [el('h3', {}, 'الإشعارات السابقة')]));
    [
      { t: 'تحديث جديد متاح', s: 'لجميع المستخدمين', tm: 'منذ ساعة', users: 12480 },
      { t: 'تحديات الأسبوع 🎉', s: 'مستخدمون نشطون', tm: 'أمس', users: 4231 },
      { t: 'هدية ترحيبية', s: 'مستخدمون جدد', tm: 'منذ 3 أيام', users: 982 },
      { t: 'صيانة مجدولة الليلة', s: 'لجميع المستخدمين', tm: 'منذ أسبوع', users: 12000 },
    ].forEach(n => recent.appendChild(el('div', { style: { padding: '10px 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: '8px' } }, [
      el('div', {}, [el('div', { style: { fontWeight: 700, fontSize: '13.5px' } }, n.t), el('div', { class: 'muted', style: { fontSize: '11.5px' } }, n.s + ' · وصل لـ ' + fmt(n.users))]),
      el('div', { class: 'muted', style: { fontSize: '11.5px' } }, n.tm),
    ])));
    grid.appendChild(recent);
    page.appendChild(grid);
    return page;
  }

  // ===== Analytics =====
  function viewAnalytics() {
    const page = el('div', { class: 'adm-page' });
    page.appendChild(pageHeader('الإحصائيات والتقارير', 'تتبع التفاعل واستخراج التقارير', [
      el('button', { class: 'btn btn-secondary' }, [svg('download'), document.createTextNode(' Excel')]),
      el('button', { class: 'btn btn-secondary' }, [svg('download'), document.createTextNode(' PDF')]),
      el('select', { style: { background: 'var(--surface)', border: '1px solid var(--border)', padding: '10px', borderRadius: '10px' } }, [el('option', {}, 'آخر 7 أيام'), el('option', {}, 'آخر 30 يوم'), el('option', {}, 'آخر 90 يوم')]),
    ]));
    const stats = el('div', { class: 'stats-grid' });
    stats.appendChild(statCard({ label: 'مستخدمون نشطون يوميًا', value: '128.4K', delta: '+12.3%', icon: 'user', tone: 'primary' }));
    stats.appendChild(statCard({ label: 'مستخدمون نشطون شهريًا', value: '2.8M', delta: '+8.1%', icon: 'sparkle', tone: 'info' }));
    stats.appendChild(statCard({ label: 'متوسط الجلسة', value: '24:38', delta: '+3min', icon: 'timer', tone: 'success' }));
    stats.appendChild(statCard({ label: 'معدل البقاء (DAY30)', value: '38.2%', delta: '+1.4%', icon: 'heart', tone: 'warn' }));
    page.appendChild(stats);

    const grid = el('div', { class: 'grid-2' });
    const a = el('div', { class: 'card' });
    a.appendChild(el('div', { class: 'card-h' }, [el('h3', {}, 'النمو خلال 30 يومًا')]));
    a.appendChild(chartLine([800, 900, 1100, 950, 1250, 1300, 1500, 1400, 1700, 1850, 1700, 1900, 2100, 2050, 2300, 2400, 2350, 2600, 2800, 2900, 3100, 3000, 3300, 3500, 3400, 3700, 3900, 4100, 4000, 4300]));
    grid.appendChild(a);

    const b = el('div', { class: 'card' });
    b.appendChild(el('div', { class: 'card-h' }, [el('h3', {}, 'التفاعل')]));
    b.appendChild(chartBars([
      { l: 'إعجاب', v: 4200000 }, { l: 'تعليق', v: 1800000 }, { l: 'مشاركة', v: 950000 }, { l: 'حفظ', v: 620000 }, { l: 'متابعة', v: 410000 },
    ]));
    grid.appendChild(b);
    page.appendChild(grid);

    const grid2 = el('div', { class: 'grid-2', style: { marginTop: '14px' } });
    const c = el('div', { class: 'card' });
    c.appendChild(el('div', { class: 'card-h' }, [el('h3', {}, 'أعلى الفيديوهات أداءً')]));
    const list = el('div', { class: 'top-list' });
    DB.videos.slice(0, 5).forEach((v, i) => list.appendChild(el('div', { class: 'top-item' }, [
      el('div', { class: 'rank' }, '#' + (i + 1)),
      el('div', { class: 'av', style: { width: '32px', height: '46px', borderRadius: '6px' } }, [Object.assign(document.createElement('img'), { src: v.bg })]),
      el('div', { class: 'body' }, [el('div', { class: 'ttl' }, v.desc.slice(0, 32)), el('div', { class: 'sub' }, v.user.name)]),
      el('div', { class: 'num' }, fmt(v.likes * 12) + ' 👁'),
    ])));
    c.appendChild(list);
    grid2.appendChild(c);

    const d = el('div', { class: 'card' });
    d.appendChild(el('div', { class: 'card-h' }, [el('h3', {}, 'التوزيع الجغرافي')]));
    [['الرياض', 38], ['جدة', 24], ['الدمام', 15], ['مكة', 11], ['المدينة', 7], ['أخرى', 5]].forEach(([l, v]) => d.appendChild(el('div', { style: { padding: '8px 0' } }, [
      el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' } }, [el('span', {}, l), el('strong', {}, v + '%')]),
      el('div', { style: { height: '6px', background: 'var(--bg)', borderRadius: '3px', overflow: 'hidden' } }, [el('div', { style: { width: v + '%', height: '100%', background: 'linear-gradient(90deg, var(--primary), var(--primary-2))' } })]),
    ])));
    grid2.appendChild(d);
    page.appendChild(grid2);

    return page;
  }

  // ===== Wallet/Gifts =====
  function viewWallet() {
    const page = el('div', { class: 'adm-page' });
    page.appendChild(pageHeader('الهدايا والمحفظة', 'تتبع الهدايا الافتراضية وتقارير الدخل'));
    const stats = el('div', { class: 'stats-grid' });
    stats.appendChild(statCard({ label: 'إيرادات اليوم', value: '$4,820', delta: '+18%', icon: 'gift', tone: 'success' }));
    stats.appendChild(statCard({ label: 'هدايا مرسلة (اليوم)', value: '12.4K', icon: 'sparkle', tone: 'primary' }));
    stats.appendChild(statCard({ label: 'مستخدمون يدفعون', value: '3,217', delta: '+4.5%', icon: 'user', tone: 'info' }));
    stats.appendChild(statCard({ label: 'متوسط قيمة الهدية', value: '🪙 38', icon: 'wallet', tone: 'warn' }));
    page.appendChild(stats);

    const tabs = el('div', { class: 'tabs' });
    ['كل الهدايا', 'مرسلة', 'مستلمة', 'إدارة الكتالوج'].forEach((l, i) => tabs.appendChild(el('button', { class: 'tab' + (i === 0 ? ' active' : ''), onclick: e => { tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active')); e.currentTarget.classList.add('active'); } }, l)));
    page.appendChild(tabs);

    const tableWrap = el('div', { class: 'table-wrap' });
    tableWrap.appendChild(el('div', { class: 'table-toolbar' }, [
      el('div', { class: 'search', style: { flex: 1 } }, [el('input', { placeholder: 'بحث' })]),
      el('input', { type: 'date' }),
    ]));
    const table = el('table', { class: 'table' });
    table.innerHTML = `<thead><tr><th>الهدية</th><th>المرسل</th><th>المستلم</th><th>القيمة</th><th>القناة</th><th>التاريخ</th></tr></thead>`;
    const tb = el('tbody');
    const giftRows = [];
    for (let i = 0; i < 12; i++) {
      const g = DB.gifts[i % DB.gifts.length];
      const sender = DB.users[i % DB.users.length];
      const receiver = DB.users[(i + 3) % DB.users.length];
      const tr = el('tr');
      tr.innerHTML = `
        <td><div style="display:flex;gap:8px;align-items:center"><span style="font-size:24px">${g.emoji}</span><span><div style="font-weight:700">${g.name}</div></span></div></td>
        <td><div class="user-cell"><div class="av"><img src="${sender.avatar}"></div><span>${sender.name}</span></div></td>
        <td><div class="user-cell"><div class="av"><img src="${receiver.avatar}"></div><span>${receiver.name}</span></div></td>
        <td><strong>🪙 ${g.price}</strong></td>
        <td><span class="badge primary">بث مباشر</span></td>
        <td>منذ ${i + 1} ساعة</td>`;
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    tableWrap.appendChild(table);
    tableWrap.appendChild(pagination(847, 12));
    page.appendChild(tableWrap);

    return page;
  }

  // ===== Roles =====
  function viewRoles() {
    const page = el('div', { class: 'adm-page' });
    page.appendChild(pageHeader('الأدوار والصلاحيات', 'إدارة الأدوار وتحديد الصلاحيات لكل دور', [
      el('button', { class: 'btn', onclick: () => openRoleModal() }, [svg('plus'), document.createTextNode(' دور جديد')]),
    ]));
    const tableWrap = el('div', { class: 'table-wrap' });
    const table = el('table', { class: 'table' });
    table.innerHTML = `<thead><tr><th>الدور</th><th>الموظفون</th><th>الصلاحيات</th><th>تاريخ الإنشاء</th><th></th></tr></thead>`;
    const tb = el('tbody');
    const roles = [
      { n: 'Super Admin', e: 1, p: 'كل الصلاحيات', d: '2024/01/01', sys: true },
      { n: 'مشرف محتوى', e: 8, p: 'مراجعة، حذف، تحذير', d: '2024/02/12' },
      { n: 'محلل بيانات', e: 3, p: 'عرض الإحصائيات والتقارير', d: '2024/03/05' },
      { n: 'دعم فني', e: 6, p: 'الحسابات، البلاغات', d: '2024/04/19' },
      { n: 'مسوّق', e: 2, p: 'الإعلانات والإشعارات', d: '2024/05/22' },
    ];
    roles.forEach(r => {
      const tr = el('tr');
      tr.innerHTML = `
        <td><strong>${r.n}</strong>${r.sys ? '<span class="badge primary" style="margin-inline-start:6px">نظام</span>' : ''}</td>
        <td>${r.e} موظف</td>
        <td class="muted">${r.p}</td>
        <td>${r.d}</td>
        <td><div class="row-actions">
          <button class="btn-icon btn-ghost" title="تعديل" data-act="edit">${icons.settings}</button>
          <button class="btn-icon btn-ghost" title="حذف" data-act="del" ${r.sys ? 'disabled style="opacity:0.4"' : ''}>${icons.x}</button>
        </div></td>`;
      tr.querySelector('[data-act="edit"]').onclick = () => openRoleModal(r);
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    tableWrap.appendChild(table);
    page.appendChild(tableWrap);

    function openRoleModal(r) {
      const body = el('div', {});
      body.innerHTML = `
        <div class="field"><label>اسم الدور</label><input value="${r ? r.n : ''}"/></div>
        <div class="field"><label>الوصف</label><textarea>${r ? r.p : ''}</textarea></div>
        <div class="field"><label>الصلاحيات</label>
          <div class="checks">
            ${['عرض المستخدمين','تعديل المستخدمين','حظر المستخدمين','عرض المحتوى','حذف المحتوى','مراجعة البلاغات','إنهاء البث','إدارة الإعلانات','إرسال إشعارات','عرض الإحصائيات','إدارة الموظفين','إدارة الأدوار','إدارة المحفظة','عرض السجل'].map((p, i) => `<label class="check"><input type="checkbox" ${i % 2 === 0 ? 'checked' : ''}/> ${p}</label>`).join('')}
          </div>
        </div>`;
      const close = modalAdm(r ? 'تعديل دور' : 'إنشاء دور جديد', body, [
        el('button', { class: 'btn btn-secondary', onclick: () => close() }, 'إلغاء'),
        el('button', { class: 'btn', onclick: () => { close(); toast('تم الحفظ'); } }, 'حفظ'),
      ]);
    }
    return page;
  }

  // ===== Employees =====
  function viewEmployees() {
    const page = el('div', { class: 'adm-page' });
    page.appendChild(pageHeader('الموظفون', 'إدارة موظفي لوحة التحكم وأدوارهم', [
      el('button', { class: 'btn', onclick: () => openEmpModal() }, [svg('plus'), document.createTextNode(' موظف جديد')]),
    ]));
    const tableWrap = el('div', { class: 'table-wrap' });
    tableWrap.appendChild(el('div', { class: 'table-toolbar' }, [
      el('div', { class: 'search', style: { flex: 1 } }, [el('input', { placeholder: 'بحث بالاسم أو البريد' })]),
      el('select', {}, [el('option', {}, 'كل الأدوار'), el('option', {}, 'Super Admin'), el('option', {}, 'مشرف محتوى'), el('option', {}, 'محلل بيانات'), el('option', {}, 'دعم فني')]),
      el('select', {}, [el('option', {}, 'كل الحالات'), el('option', {}, 'نشط'), el('option', {}, 'موقوف')]),
    ]));
    const table = el('table', { class: 'table' });
    table.innerHTML = `<thead><tr><th>الموظف</th><th>البريد</th><th>الدور</th><th>الحالة</th><th>آخر دخول</th><th></th></tr></thead>`;
    const tb = el('tbody');
    const empRoles = ['Super Admin', 'مشرف محتوى', 'مشرف محتوى', 'محلل بيانات', 'دعم فني', 'مسوّق', 'دعم فني', 'مشرف محتوى'];
    DB.users.slice(0, 8).forEach((u, i) => {
      const active = i !== 4;
      const tr = el('tr');
      tr.innerHTML = `
        <td><div class="user-cell"><div class="av"><img src="${u.avatar}"></div><div><div class="nm">${u.name}</div></div></div></td>
        <td>${u.handle.replace('@', '')}@tenthtone.com</td>
        <td><span class="badge primary">${empRoles[i]}</span></td>
        <td><div class="toggle ${active ? 'on' : ''}" data-i="${i}"></div></td>
        <td>منذ ${(i % 5) + 1} ساعة</td>
        <td><div class="row-actions">
          <button class="btn-icon btn-ghost" title="تعديل" data-act="edit">${icons.settings}</button>
          <button class="btn-icon btn-ghost" title="حذف" data-act="del">${icons.x}</button>
        </div></td>`;
      tr.querySelector('.toggle').onclick = e => { e.currentTarget.classList.toggle('on'); toast('تم تحديث الحالة'); };
      tr.querySelector('[data-act="edit"]').onclick = () => openEmpModal(u, empRoles[i]);
      tr.querySelector('[data-act="del"]').onclick = () => { if (confirm('حذف هذا الموظف؟')) toast('تم الحذف'); };
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    tableWrap.appendChild(table);
    page.appendChild(tableWrap);

    function openEmpModal(u, role) {
      const body = el('div', {});
      body.innerHTML = `
        <div class="field"><label>الاسم الكامل</label><input value="${u ? u.name : ''}"/></div>
        <div class="field-row">
          <div class="field"><label>البريد الإلكتروني</label><input type="email" value="${u ? u.handle.replace('@','') + '@tenthtone.com' : ''}"/></div>
          <div class="field"><label>الهاتف</label><input/></div>
        </div>
        <div class="field"><label>الدور</label>
          <select><option>Super Admin</option><option ${role === 'مشرف محتوى' ? 'selected' : ''}>مشرف محتوى</option><option>محلل بيانات</option><option>دعم فني</option><option>مسوّق</option></select>
        </div>
        <div class="field"><label>كلمة المرور المؤقتة</label><input type="text" value="${u ? '' : 'TempP@ss123'}"/><div class="hint">سيُطلب من الموظف تغييرها عند أول دخول</div></div>`;
      const close = modalAdm(u ? 'تعديل بيانات الموظف' : 'إضافة موظف جديد', body, [
        el('button', { class: 'btn btn-secondary', onclick: () => close() }, 'إلغاء'),
        el('button', { class: 'btn', onclick: () => { close(); toast('تم الحفظ'); } }, 'حفظ'),
      ]);
    }
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
          tr.appendChild(el('td', {}, new Date(L.created_at).toLocaleString('ar-SA')));
          tb.appendChild(tr);
        });
      } catch (e) { tb.innerHTML = '<tr><td colspan="4" class="table-empty">' + e.message + '</td></tr>'; }
    })();
    return page;
  }

  // ===== Location =====
  function viewLocation() {
    const page = el('div', { class: 'adm-page' });
    page.appendChild(pageHeader('الموقع الجغرافي', 'إدارة ميزة مشاركة الموقع ومتابعة المحتوى الشائع'));
    const grid = el('div', { class: 'grid-2' });
    const a = el('div', { class: 'card' });
    a.appendChild(el('div', { class: 'card-h' }, [el('h3', {}, 'إعدادات المشاركة')]));
    [
      { l: 'تفعيل ميزة مشاركة الموقع', d: 'السماح للمستخدمين بمشاركة موقعهم على الخريطة', on: true },
      { l: 'عرض الخريطة العامة', d: 'إظهار خريطة الأصدقاء داخل التطبيق', on: true },
      { l: 'المحتوى الشائع حسب الموقع', d: 'عرض الفيديوهات الرائجة حسب المنطقة', on: true },
      { l: 'مشاركة الموقع تلقائيًا', d: 'افتراضيًا للمستخدمين الجدد', on: false },
    ].forEach(s => a.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border)', gap: '10px' } }, [
      el('div', {}, [el('div', { style: { fontWeight: 700, fontSize: '14px' } }, s.l), el('div', { class: 'muted', style: { fontSize: '12px', marginTop: '2px' } }, s.d)]),
      el('div', { class: 'toggle' + (s.on ? ' on' : ''), onclick: e => { e.currentTarget.classList.toggle('on'); toast('تم التحديث'); } }),
    ])));
    grid.appendChild(a);

    const b = el('div', { class: 'card' });
    b.appendChild(el('div', { class: 'card-h' }, [el('h3', {}, 'المحتوى الشائع حسب المنطقة')]));
    const sel = el('select', { style: { width: '100%', padding: '10px', borderRadius: '10px', border: '1px solid var(--border)', marginBottom: '14px' } }, [el('option', {}, 'الرياض'), el('option', {}, 'جدة'), el('option', {}, 'الدمام'), el('option', {}, 'مكة'), el('option', {}, 'المدينة')]);
    b.appendChild(sel);
    const list = el('div', { class: 'top-list' });
    DB.videos.slice(0, 5).forEach((v, i) => list.appendChild(el('div', { class: 'top-item' }, [
      el('div', { class: 'rank' }, '#' + (i + 1)),
      el('div', { class: 'av', style: { width: '32px', height: '46px', borderRadius: '6px' } }, [Object.assign(document.createElement('img'), { src: v.bg })]),
      el('div', { class: 'body' }, [el('div', { class: 'ttl' }, v.desc.slice(0, 30)), el('div', { class: 'sub' }, v.user.name)]),
      el('div', { class: 'num' }, fmt(v.likes * 12)),
    ])));
    b.appendChild(list);
    grid.appendChild(b);

    page.appendChild(grid);
    return page;
  }

  // ===== Settings =====
  function viewSettings() {
    const page = el('div', { class: 'adm-page' });
    page.appendChild(pageHeader('الإعدادات', 'إعدادات المنصة العامة'));
    const grid = el('div', { class: 'grid-2' });

    const a = el('div', { class: 'card' });
    a.appendChild(el('div', { class: 'card-h' }, [el('h3', {}, 'عام')]));
    a.innerHTML += `
      <div class="field"><label>اسم المنصة</label><input value="Tenth Tone"/></div>
      <div class="field"><label>الوصف</label><textarea>منصة فيديو اجتماعي بالعربية</textarea></div>
      <div class="field-row">
        <div class="field"><label>اللغة الافتراضية</label><select><option>العربية</option><option>English</option></select></div>
        <div class="field"><label>المنطقة الزمنية</label><select><option>Asia/Riyadh (UTC+3)</option></select></div>
      </div>`;
    grid.appendChild(a);

    const b = el('div', { class: 'card' });
    b.appendChild(el('div', { class: 'card-h' }, [el('h3', {}, 'حدود الفيديو')]));
    b.innerHTML += `
      <div class="field-row">
        <div class="field"><label>الحد الأقصى للمدة (ث)</label><input type="number" value="60"/></div>
        <div class="field"><label>الحد الأقصى للحجم (MB)</label><input type="number" value="200"/></div>
      </div>
      <div class="field-row">
        <div class="field"><label>صيغ الفيديو المدعومة</label><input value="MP4, MOV"/></div>
        <div class="field"><label>صيغ الصور</label><input value="JPG, PNG"/></div>
      </div>`;
    grid.appendChild(b);

    const c = el('div', { class: 'card' });
    c.appendChild(el('div', { class: 'card-h' }, [el('h3', {}, 'البث المباشر')]));
    c.innerHTML += `
      <div class="field"><label>الحد الأدنى من المتابعين للبث</label><input type="number" value="100"/></div>
      <div class="field"><label>الحد الأدنى للعمر</label><input type="number" value="18"/></div>`;
    grid.appendChild(c);

    const d = el('div', { class: 'card' });
    d.appendChild(el('div', { class: 'card-h' }, [el('h3', {}, 'المحفظة والسحب')]));
    d.innerHTML += `
      <div class="field"><label>الحد الأدنى للسحب (🪙)</label><input type="number" value="1000"/></div>
      <div class="field"><label>نسبة العمولة (%)</label><input type="number" value="20"/></div>`;
    grid.appendChild(d);

    page.appendChild(grid);
    page.appendChild(el('div', { style: { marginTop: '16px', display: 'flex', gap: '8px', justifyContent: 'flex-end' } }, [
      el('button', { class: 'btn btn-secondary' }, 'إلغاء'),
      el('button', { class: 'btn', onclick: () => toast('تم حفظ الإعدادات') }, 'حفظ التغييرات'),
    ]));
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
    '/wallet': () => buildShell('wallet', viewWallet()),
    '/roles': () => buildShell('roles', viewRoles()),
    '/employees': () => buildShell('employees', viewEmployees()),
    '/logs': () => buildShell('logs', viewLogs()),
    '/location': () => buildShell('location', viewLocation()),
    '/settings': () => buildShell('settings', viewSettings()),
  };

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
