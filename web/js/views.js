/* === Mobile views === */
(function () {
  const { el, esc, safeUrl, fmt, go, back, toast, modal, ask, confirmDialog, richText, icons, svg, bottomNav, hideNav, topBar, avatar, emptyState, errorState, friendlyError } = window.H;
  const DB = window.DB;
  const V = window.Views = {};

  // Cached once: lets the feed hide Follow on your own posts.
  let myFeedUserId = null;
  (async () => { try { const u = await window.SB.getUser(); myFeedUserId = u && u.id; } catch (e) {} })();

  // Demo mode: when the database returns nothing, fall back to sample
  // content so the app can be demoed. Real data always takes priority.
  // Flip in js/config.js (or ?demo=0) — see that file.
  const DEMO = !!(window.TT_CONFIG && window.TT_CONFIG.demoMode);
  // Hardcoding 6 here meant an 8-digit code was cut to its first 6 and always
  // rejected. Draw the maximum, accept anything at or above the minimum, and
  // the app works whatever Supabase is set to.
  const OTP_LEN = (window.TT_CONFIG && window.TT_CONFIG.otpMaxLength) || 8;
  const OTP_MIN = (window.TT_CONFIG && window.TT_CONFIG.otpMinLength) || 6;
  // Supabase's own resend window. Anything shorter just walks the user
  // into "you can only request this after N seconds".
  const RESEND_COOLDOWN = 60;
  const otpReady = (inputs) => inputs.map(x => x.value).join('').length >= OTP_MIN;

  // True for a real database row id (a UUID), false for a demo/placeholder
  // id like 'v1' or 'live-u3'. Guards every write so demo content can never
  // be sent to the server. Replaces ad-hoc `id.length > 10` checks.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function isRealId(id) { return typeof id === 'string' && UUID_RE.test(id); }

  // Every profile is supposed to have a name — 0044 enforces that in the
  // database — but a blank one must never render as an empty gap the way it
  // did in "Featured creators", where an account appeared as a bare circle
  // and a follower count. Falls back to the handle, which always exists.
  function displayName(u) {
    if (!u) return 'مستخدم';
    const n = (u.name || '').trim();
    if (n) return n;
    const h = String(u.handle || '').replace(/^@/, '').trim();
    return h || 'مستخدم';
  }
  window.H.isRealId = isRealId;

  // Dates/times follow the active language — they were pinned to 'ar-SA',
  // so English users saw Arabic-Indic numerals and the Hijri-style format.
  function locale() { return (window.I18N && window.I18N.getLang() === 'en') ? 'en-GB' : 'ar-SA'; }
  function fmtDateTime(iso) {
    try { return new Date(iso).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' }); }
    catch (e) { return ''; }
  }
  function fmtClock(iso) {
    try { return new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }

  function isVideoUrl(u) {
    if (!u || typeof u !== 'string') return false;
    return /\.(mp4|mov|webm|m4v|m3u8)(\?|$)/i.test(u) || u.includes('geeksforgeeks') || u.includes('/sample/') || u.includes('.mp4') || u.includes('videos/') || u.includes('mixkit') || u.includes('w3schools') || u.startsWith('blob:') || u.startsWith('data:video');
  }
  window.H.isVideoUrl = isVideoUrl;

  // ===== Language switch (Arabic ⇄ English) =====
  // Small segmented control. Works anywhere window.I18N is loaded.
  function langSwitch(opts) {
    opts = opts || {};
    const cur = (window.I18N && window.I18N.getLang()) || 'ar';
    const wrap = el('div', { class: 'lang-switch' + (opts.compact ? ' compact' : '') });
    [['ar', 'العربية'], ['en', 'English']].forEach(([code, label]) => {
      const b = el('button', {
        type: 'button',
        class: 'lang-opt' + (cur === code ? ' active' : ''),
        onclick: (e) => {
          e.stopPropagation();
          if (window.I18N && window.I18N.getLang() !== code) window.I18N.setLang(code);
        },
      }, label);
      wrap.appendChild(b);
    });
    return wrap;
  }

  // ===== Splash =====
  // ===== First-run onboarding =====
  // What a new person sees before any account exists: a few slides saying
  // what the app is, then Get Started. Shown once - after that the welcome
  // screen takes over. `?tour=1` re-opens it for testing.
  const ONBOARD_KEY = 'tt-onboarded';

  function hasOnboarded() {
    try { return localStorage.getItem(ONBOARD_KEY) === '1'; } catch (e) { return true; }
  }

  V.onboarding = () => {
    hideNav();
    // Each slide is a phone showing the app's own interface over a branded
    // backdrop. No photos, no video, no borrowed content - the interface is
    // the thing worth showing, and it stays true as the app changes.
    const railIcon = (name, count) => el('div', { class: 'ph-rail-item' }, [
      el('span', { class: 'ph-rail-ic', html: icons[name] }),
      count ? el('span', { class: 'ph-rail-n' }, count) : null,
    ].filter(Boolean));

    // A letter disc in the app's own palette, so nobody's face is invented.
    const seedAv = (letter, size, tone) =>
      el('span', { class: 'ph-av t' + tone, style: { width: size + 'px', height: size + 'px' } }, letter);

    function artWatch() {
      return el('div', { class: 'ph' }, [
        el('div', { class: 'ph-bg bg-watch' }),
        el('div', { class: 'ph-topfade' }),
        el('div', { class: 'ph-tabs' }, [
          el('span', { class: 'dim' }, 'متابَعة'),
          el('span', { class: 'on' }, 'لك'),
        ]),
        el('div', { class: 'ph-rail' }, [
          railIcon('heart', '12.4K'),
          railIcon('comment', '318'),
          railIcon('share', '96'),
        ]),
        el('div', { class: 'ph-caption' }, [
          el('div', { class: 'ph-user' }, [seedAv('س', 22, 1), el('b', {}, 'sara.k')]),
          el('div', { class: 'ph-line' }, 'غروب اليوم 🌅 #تصوير'),
        ]),
        el('div', { class: 'ph-swipe' }),
      ]);
    }

    function artCreate() {
      return el('div', { class: 'ph' }, [
        el('div', { class: 'ph-bg bg-create' }),
        el('div', { class: 'ph-grid' }),
        el('div', { class: 'ph-camtop' }, [
          el('span', { class: 'ph-chip' }, '0.5x'),
          el('span', { class: 'ph-chip on' }, '1x'),
          el('span', { class: 'ph-chip' }, '2x'),
        ]),
        el('div', { class: 'ph-sound' }, [
          el('span', { class: 'ph-sound-ic', html: icons.music }),
          el('span', {}, 'صوت أصلي'),
        ]),
        el('div', { class: 'ph-timer' }, '00:07'),
        el('div', { class: 'ph-rec' }, [el('span', { class: 'ph-rec-dot' })]),
      ]);
    }

    function artLive() {
      return el('div', { class: 'ph' }, [
        el('div', { class: 'ph-bg bg-live' }),
        el('div', { class: 'ph-livebar' }, [
          el('span', { class: 'ph-live' }, 'مباشر'),
          el('span', { class: 'ph-viewers' }, '1.2K'),
        ]),
        el('div', { class: 'ph-hearts' }, [
          el('span', { class: 'ph-heart h1' }, '❤️'),
          el('span', { class: 'ph-heart h2' }, '💜'),
          el('span', { class: 'ph-heart h3' }, '❤️'),
        ]),
        el('div', { class: 'ph-livemsg' }, [
          el('div', { class: 'ph-bub' }, [seedAv('ع', 18, 2), el('span', {}, 'رائع 🔥')]),
          el('div', { class: 'ph-bub' }, [seedAv('س', 18, 1), el('span', {}, 'متابعة من الرياض 👋')]),
        ]),
      ]);
    }

    function artChat() {
      return el('div', { class: 'ph' }, [
        el('div', { class: 'ph-bg bg-chat' }),
        el('div', { class: 'ph-chat' }, [
          el('div', { class: 'ph-msg them' }, [seedAv('ن', 20, 3), el('span', { class: 'ph-msg-t' }, 'وين اليوم؟ 😄')]),
          el('div', { class: 'ph-msg me' }, [el('span', { class: 'ph-msg-t' }, 'شوف الخريطة 📍')]),
          el('div', { class: 'ph-mapcard' }, [
            el('div', { class: 'ph-map' }, [
              el('span', { class: 'ph-road r1' }),
              el('span', { class: 'ph-road r2' }),
              el('span', { class: 'ph-pin p1' }, [seedAv('س', 22, 1)]),
              el('span', { class: 'ph-pin p2' }, [seedAv('ع', 22, 2)]),
            ]),
            el('div', { class: 'ph-map-l' }, 'خريطة الأصدقاء'),
          ]),
        ]),
      ]);
    }

    const SLIDES = [
      { art: artWatch,  title: 'شاهد فيديوهات قصيرة',  sub: 'موجز لا ينتهي يتعلّم ما تحبه مع كل مشاهدة' },
      { art: artCreate, title: 'أنشئ وشارك',            sub: 'صوّر، قصّ، وأضف أصواتًا أصلية من داخل التطبيق' },
      { art: artLive,   title: 'ابدأ بثًا مباشرًا',     sub: 'شارك لحظاتك مباشرة وتفاعل مع متابعيك لحظة بلحظة' },
      { art: artChat,   title: 'تواصل مع أصدقائك',      sub: 'رسائل ومجموعات وخريطة تجمعك بمن تحب' },
    ];

    let idx = 0;

    const root = el('section', { class: 'onboard' });

    const skip = el('button', { class: 'onboard-skip', onclick: finish }, 'تخطي');
    root.appendChild(el('div', { class: 'onboard-top' }, [
      el('div', { class: 'splash-lang' }, [langSwitch({ compact: true })]),
      skip,
    ]));

    const stage = el('div', { class: 'onboard-stage' });
    root.appendChild(stage);

    const dots = el('div', { class: 'onboard-dots' });
    SLIDES.forEach((_, i) => dots.appendChild(el('span', { class: 'onboard-dot' + (i === 0 ? ' on' : '') })));
    root.appendChild(dots);

    const nextBtn = el('button', { class: 'btn btn-pill onboard-next', onclick: () => step(1) }, 'التالي');
    root.appendChild(el('div', { class: 'onboard-actions' }, [nextBtn]));

    function finish() {
      try { localStorage.setItem(ONBOARD_KEY, '1'); } catch (e) {}
      go('/welcome');
    }

    function render() {
      const s = SLIDES[idx];
      stage.innerHTML = '';
      const slide = el('div', { class: 'onboard-slide' }, [
        s.art(),
        el('h2', { class: 'onboard-title' }, s.title),
        el('p', { class: 'onboard-sub' }, s.sub),
      ]);
      stage.appendChild(slide);
      [...dots.children].forEach((d, i) => d.classList.toggle('on', i === idx));
      const last = idx === SLIDES.length - 1;
      nextBtn.textContent = last ? 'ابدأ الآن' : 'التالي';
      skip.style.visibility = last ? 'hidden' : 'visible';
      try { if (window.I18N) window.I18N.apply(root); } catch (e) {}
    }

    function step(dir) {
      if (idx === SLIDES.length - 1 && dir > 0) return finish();
      idx = Math.min(SLIDES.length - 1, Math.max(0, idx + dir));
      render();
    }

    // Swipe between slides. "Forward" follows reading direction, so the
    // gesture mirrors correctly in Arabic.
    let touchX = null;
    stage.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
    stage.addEventListener('touchend', e => {
      if (touchX == null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      touchX = null;
      if (Math.abs(dx) < 45) return;
      const rtl = document.documentElement.getAttribute('dir') !== 'ltr';
      const forward = rtl ? dx > 0 : dx < 0;
      step(forward ? 1 : -1);
    }, { passive: true });

    render();
    return root;
  };

  // ===== Welcome =====
  // The fork in the road: new person or returning one.
  // The welcome illustration: people, connected, enjoying it.
  //
  // Drawn rather than photographed. An SVG is a few hundred bytes against a
  // stock photo's couple of hundred KB — which matters on a 5 GB egress
  // allowance — it stays sharp at any screen size, it needs no network so it
  // works offline in the APK, and it inherits the brand colours instead of
  // being stuck with whatever a photo happened to contain.
  //
  // The logo used to sit here. It was removed deliberately: the artwork has a
  // dark background baked into the PNG, so on this light screen it read as a
  // sticker pasted on, and the wordmark inside it duplicated the heading
  // underneath.
  function welcomeArt() {
    const NODES = [
      { x: 150, y: 62, r: 31, c: 'a' }, { x: 58, y: 148, r: 25, c: 'b' },
      { x: 248, y: 132, r: 23, c: 'c' }, { x: 108, y: 236, r: 20, c: 'b' },
      { x: 222, y: 231, r: 18, c: 'a' }, { x: 27, y: 66, r: 15, c: 'c' },
      { x: 286, y: 212, r: 13, c: 'b' },
    ];
    const LINKS = [[0,1],[0,2],[1,3],[2,4],[3,4],[0,5],[1,5],[2,6],[4,6]];

    const person = (n) => {
      const hr = n.r * 0.30, hy = n.y - n.r * 0.20;
      const bw = n.r * 0.62, by = n.y + n.r * 0.10, bh = n.r * 0.52;
      return '<circle cx="' + n.x + '" cy="' + hy.toFixed(1) + '" r="' + hr.toFixed(1) + '" fill="#fff" opacity=".95"/>'
           + '<path d="M ' + (n.x - bw).toFixed(1) + ' ' + (by + bh).toFixed(1)
           + ' a ' + bw.toFixed(1) + ' ' + bh.toFixed(1) + ' 0 0 1 ' + (bw * 2).toFixed(1) + ' 0 Z" fill="#fff" opacity=".95"/>';
    };
    // Curved rather than straight, and fading at both ends, so it reads as an
    // open network still growing rather than a closed diagram.
    const links = LINKS.map(([i, j], k) => {
      const a = NODES[i], b = NODES[j];
      return '<path d="M ' + a.x + ' ' + a.y + ' Q ' + ((a.x + b.x) / 2).toFixed(0) + ' '
           + (((a.y + b.y) / 2) - 16).toFixed(0) + ' ' + b.x + ' ' + b.y
           + '" fill="none" stroke="url(#wl)" stroke-width="' + (k % 3 === 0 ? 2.1 : 1.4)
           + '" stroke-linecap="round" opacity="' + (k % 3 === 0 ? '.85' : '.5') + '"/>';
    }).join('');
    const nodes = NODES.map(n =>
      '<g><circle cx="' + n.x + '" cy="' + n.y + '" r="' + (n.r + 4) + '" fill="url(#wh)" opacity=".55"/>'
      + '<circle cx="' + n.x + '" cy="' + n.y + '" r="' + n.r + '" fill="url(#w' + n.c + ')"/>' + person(n) + '</g>').join('');
    const sparks = [[196,88,2.6],[86,206,2.2],[268,168,2],[132,140,1.8],[42,110,1.6]]
      .map(p => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + p[2] + '" fill="#7FB0FF" opacity=".8"/>').join('');
    // Hearts and message bubbles: without them this is a network topology
    // diagram rather than people enjoying each other's company.
    const heart = (x, y, sc, fill, op) => '<path transform="translate(' + x + ' ' + y + ') scale(' + sc + ')" '
      + 'd="M0 3.6 C -3.4 1 -5.2 -1 -5.2 -3.1 A 3.1 3.1 0 0 1 0 -5.2 A 3.1 3.1 0 0 1 5.2 -3.1 C 5.2 -1 3.4 1 0 3.6 Z" fill="' + fill + '" opacity="' + op + '"/>';
    const bubble = (x, y, sc, op) => '<g transform="translate(' + x + ' ' + y + ') scale(' + sc + ')" opacity="' + op + '">'
      + '<rect x="-7" y="-5.5" width="14" height="11" rx="4" fill="#3D7BFF"/><path d="M -2.5 5 L 0.5 8.4 L 2.4 5 Z" fill="#3D7BFF"/></g>';
    const accents = heart(196, 96, 1.5, '#FF6FA3', '.95') + heart(70, 110, 1.05, '#FF9CC0', '.75')
                  + bubble(258, 86, 1.15, '.9') + bubble(96, 192, 0.95, '.7');

    return '<svg viewBox="0 0 320 290" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" '
      + 'role="img" aria-label="People connected together">'
      + '<defs>'
      + '<linearGradient id="wa" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3D7BFF"/><stop offset="1" stop-color="#1E56D6"/></linearGradient>'
      + '<linearGradient id="wb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5B8CFF"/><stop offset="1" stop-color="#2A63E0"/></linearGradient>'
      + '<linearGradient id="wc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF7BA8"/><stop offset="1" stop-color="#E8478A"/></linearGradient>'
      + '<linearGradient id="wl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1E56D6" stop-opacity=".15"/><stop offset=".5" stop-color="#3D7BFF" stop-opacity=".75"/><stop offset="1" stop-color="#1E56D6" stop-opacity=".15"/></linearGradient>'
      + '<radialGradient id="wh"><stop offset=".55" stop-color="#3D7BFF" stop-opacity="0"/><stop offset="1" stop-color="#3D7BFF" stop-opacity=".38"/></radialGradient>'
      + '</defs>' + links + sparks + accents + nodes + '</svg>';
  }

  V.welcome = () => {
    hideNav();
    const root = el('section', { class: 'splash' }, [
      el('div', { class: 'splash-lang' }, [langSwitch({ compact: true })]),
      el('div', { class: 'splash-hero' }, [
        el('div', { class: 'splash-art', html: welcomeArt() }),
        // No heading. The name is on the icon they tapped and in the title
        // bar; repeating it here only crowded the sentence that actually says
        // what the app is for.
        el('p', {}, 'شارك لحظتك مع العالم'),
      ]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn', onclick: () => go('/register') }, 'أنا جديد هنا'),
        el('button', { class: 'btn btn-outline', onclick: () => go('/login') }, 'لدي حساب بالفعل'),
        el('p', { class: 'welcome-legal' }, [
          document.createTextNode('بالمتابعة أنت توافق على '),
          el('a', { class: 'auth-link', onclick: () => go('/legal') }, 'الشروط وسياسة الخصوصية'),
        ]),
      ]),
    ]);
    return root;
  };

  // Kept for anything still calling the old name.
  V.splash = V.welcome;

  // ===== Login =====
  V.login = () => {
    hideNav();
    let showPass = false;
    const root = el('section', { class: 'auth-screen' });

    // Background floating doodles (16 varied icons)
    const doodles = el('div', { class: 'auth-doodles' }, [
      el('div', { class: 'auth-doodle', html: icons.music }),
      el('div', { class: 'auth-doodle', html: icons.sparkle }),
      el('div', { class: 'auth-doodle', html: icons.heart }),
      el('div', { class: 'auth-doodle', html: icons.video }),
      el('div', { class: 'auth-doodle', html: icons.bookmark }),
      el('div', { class: 'auth-doodle', html: icons.flash }),
      el('div', { class: 'auth-doodle', html: icons.camera }),
      el('div', { class: 'auth-doodle', html: icons.mic }),
      el('div', { class: 'auth-doodle', html: icons.heart }),
      el('div', { class: 'auth-doodle', html: icons.music }),
      el('div', { class: 'auth-doodle', html: icons.sparkle }),
      el('div', { class: 'auth-doodle', html: icons.timer }),
      el('div', { class: 'auth-doodle', html: icons.sticker }),
      el('div', { class: 'auth-doodle', html: icons.play }),
    ]);
    root.appendChild(doodles);

    const error = el('div', { class: 'error-box', hidden: true });
    root.appendChild(el('div', { class: 'splash-lang', style: { alignSelf: 'flex-end', position: 'relative', zIndex: 2 } }, [langSwitch({ compact: true })]));
    root.appendChild(el('div', { class: 'auth-logo' }, [
      el('div', { class: 'auth-logo-svg', html: icons.logo, style: { width: '165px', height: 'auto', margin: '0 auto 14px' } }),
      el('h1', {}, 'مرحبًا بعودتك'),
      el('p', {}, 'سجّل دخولك للمتابعة'),
    ]));
    const idIn = el('input', { class: 'input', placeholder: 'البريد الإلكتروني أو رقم الهاتف' });
    const passIn = el('input', { class: 'input input-with-toggle', type: 'password', placeholder: 'كلمة المرور' });
    const togglePass = el('button', { class: 'password-toggle-btn', type: 'button', html: icons.eyeOff, onclick: () => {
      showPass = !showPass;
      passIn.type = showPass ? 'text' : 'password';
      togglePass.innerHTML = showPass ? icons.eye : icons.eyeOff;
    } });
    const passWrap = el('div', { class: 'input-wrap' }, [
      el('div', { style: { position: 'relative' } }, [passIn, togglePass]),
    ]);
    root.appendChild(error);
    root.appendChild(el('div', { class: 'input-wrap' }, [idIn]));
    root.appendChild(passWrap);
    root.appendChild(el('div', { class: 'auth-row' }, [
      el('span'),
      el('a', { class: 'auth-link', onclick: () => go('/forgot') }, 'نسيت كلمة المرور؟'),
    ]));
    const loginBtn = el('button', { class: 'btn btn-pill', onclick: async () => {
      if (!idIn.value || !passIn.value) {
        error.textContent = 'الرجاء إدخال جميع الحقول';
        error.hidden = false;
        return;
      }
      error.hidden = true;
      loginBtn.disabled = true;
      loginBtn.textContent = 'جاري تسجيل الدخول...';
      try {
        const isEmail = /.+@.+\..+/.test(idIn.value);
        const params = { password: passIn.value };
        if (isEmail) params.email = idIn.value.trim();
        else params.phone = idIn.value.replace(/\s/g, '');
        await window.SB.signIn(params);
        go('/home');
      } catch (e) {
        error.textContent = mapAuthError(e);
        error.hidden = false;
        loginBtn.disabled = false;
        loginBtn.textContent = 'تسجيل الدخول';
      }
    } }, 'تسجيل الدخول');
    root.appendChild(loginBtn);
    root.appendChild(el('div', { class: 'auth-actions text-center' }, [
      el('p', { class: 'muted' }, [document.createTextNode('ليس لديك حساب؟ '), el('a', { class: 'auth-link', onclick: () => go('/register') }, 'إنشاء حساب')]),
    ]));
    return root;
  };

  // Map Supabase error messages to Arabic
  // Supabase refuses a repeat send with "For security purposes, you can only
  // request this after 57 seconds". Pull the number out so the UI can run a
  // real countdown, instead of printing a figure that never moves.
  function retryAfterSeconds(e) {
    const hit = String((e && e.message) || '').match(/after (\d+) seconds?/i);
    return hit ? parseInt(hit[1], 10) : 0;
  }

  function mapAuthError(e) {
    const m = (e && e.message) || '';
    const wait = retryAfterSeconds(e);
    if (wait) return 'انتظر ' + wait + ' ثانية قبل طلب رمز جديد';
    if (/Invalid login credentials/i.test(m)) return 'بيانات الدخول غير صحيحة';
    if (/Email not confirmed/i.test(m)) return 'البريد لم يُفعَّل بعد — تحقق من بريدك';
    if (/User already registered/i.test(m)) return 'البريد مسجَّل مسبقًا';
    if (/Password should be at least/i.test(m)) return 'كلمة المرور قصيرة جدًا';
    if (/rate limit|too many/i.test(m)) return 'محاولات كثيرة — حاول لاحقًا';
    if (/network|fetch/i.test(m)) return 'تعذر الاتصال — تحقق من الإنترنت';
    return m || 'حدث خطأ، حاول مجددًا';
  }

  // ===== Register =====
  // A three-step wizard rather than one wall of fields. The order is
  // deliberate: the birthday comes first because someone under 13 should
  // find out before they have typed anything else.
  V.register = () => {
    hideNav();
    const root = el('section', { class: 'auth-screen reg-screen' });

    const data = { name: '', handle: '', birth: '', method: 'email', email: '', phone: '', pass: '', confirm: '' };
    let step = 0;
    const STEPS = 3;

    // Header: back inside the wizard, progress across the top.
    const segs = [];
    const progress = el('div', { class: 'reg-progress' });
    for (let i = 0; i < STEPS; i++) {
      const sg = el('span', { class: 'reg-seg' });
      segs.push(sg);
      progress.appendChild(sg);
    }
    root.appendChild(topBar({ title: 'إنشاء حساب', onBack: () => (step > 0 ? show(step - 1) : go('/welcome')) }));
    root.appendChild(progress);

    const body = el('div', { class: 'reg-body' });
    root.appendChild(body);

    const error = el('div', { class: 'error-box', hidden: true });

    function ageOf(iso) {
      const b = new Date(iso + 'T00:00:00');
      if (isNaN(b)) return null;
      const now = new Date();
      let a = now.getFullYear() - b.getFullYear();
      const m = now.getMonth() - b.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
      return a;
    }

    function fail(msg) {
      error.textContent = msg;
      error.hidden = false;
    }

    // ── Step 1: who you are ──
    const nameIn = el('input', { class: 'input', placeholder: 'الاسم', maxlength: '40', autocomplete: 'name' });
    // Username is asked for here rather than generated.
    //
    // Signup never collected one, so handle_new_user fell back to
    // 'user_' || eight hex characters. Everyone ended up as @user_d6aceb49.
    // It is editable later in Edit Profile, but nobody goes looking, so in
    // practice people keep a machine-generated handle for good — and on a
    // social app the @handle is the person's identity.
    const handleIn = el('input', {
      class: 'input', placeholder: 'اسم المستخدم', maxlength: '30',
      autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false',
    });
    const handleHint = el('p', { class: 'reg-hint' }, 'أحرف إنجليزية وأرقام و _ و . فقط');
    // Typed live so a taken name is found before the form is submitted, and
    // the input is coerced to the format the database will accept rather
    // than rejecting the person afterwards.
    let handleState = 'empty';   // empty | bad | checking | taken | free
    let handleTimer = null;

    function paintHandle(state, msg) {
      handleState = state;
      handleHint.textContent = msg;
      handleHint.style.color = state === 'free' ? 'var(--success)'
                             : (state === 'taken' || state === 'bad') ? 'var(--danger)'
                             : '';
      try { if (window.I18N) window.I18N.apply(handleHint); } catch (e) {}
    }

    handleIn.addEventListener('input', () => {
      // The database enforces ^[a-z0-9._]{3,30}$ (0007). Match it here so the
      // rules are visible while typing instead of arriving as a rejection.
      handleIn.value = handleIn.value.toLowerCase().replace(/[^a-z0-9._]/g, '');
      const v = handleIn.value;
      if (handleTimer) { clearTimeout(handleTimer); handleTimer = null; }
      if (!v) return paintHandle('empty', 'أحرف إنجليزية وأرقام و _ و . فقط');
      if (v.length < 3) return paintHandle('bad', 'ثلاثة أحرف على الأقل');
      paintHandle('checking', 'جارٍ التحقق...');
      handleTimer = setTimeout(async () => {
        try {
          const free = await window.API.isHandleAvailable(v);
          if (handleIn.value !== v) return;              // they kept typing
          paintHandle(free ? 'free' : 'taken', free ? 'متاح' : 'اسم المستخدم محجوز');
        } catch (e) {
          // Never block signup on a check that failed; the unique index is
          // the real guard and will reject a clash on insert.
          paintHandle('free', '');
        }
      }, 450);
    });

    const birthIn = el('input', { class: 'input reg-date', type: 'date', autocomplete: 'bday' });
    try { birthIn.max = new Date().toISOString().slice(0, 10); } catch (e) {}

    function step1() {
      body.innerHTML = '';
      body.appendChild(el('h2', { class: 'auth-title' }, 'عرّفنا بنفسك'));
      body.appendChild(el('p', { class: 'auth-subtitle' }, 'اسمك كما سيظهر للآخرين، واسم المستخدم، وتاريخ ميلادك'));
      body.appendChild(error);
      body.appendChild(el('div', { class: 'input-wrap' }, [nameIn]));
      body.appendChild(el('div', { class: 'input-wrap' }, [handleIn]));
      body.appendChild(handleHint);
      body.appendChild(el('label', { class: 'reg-label' }, 'تاريخ الميلاد'));
      body.appendChild(el('div', { class: 'input-wrap' }, [birthIn]));
      body.appendChild(el('p', { class: 'reg-hint' }, 'لن يظهر تاريخ ميلادك لأي شخص، ولا يمكن تغييره لاحقًا.'));
      const next = el('button', { class: 'btn btn-pill', onclick: async () => {
        nameIn.value = nameIn.value.trim();
        if (nameIn.value.length < 2) return fail('أدخل اسمك');
        if (handleIn.value.length < 3) return fail('أدخل اسم مستخدم من ثلاثة أحرف على الأقل');
        if (handleState === 'taken') return fail('اسم المستخدم محجوز، اختر غيره');
        if (!birthIn.value) return fail('أدخل تاريخ ميلادك');
        const age = ageOf(birthIn.value);
        if (age == null || age > 120) return fail('تاريخ الميلاد غير صحيح');
        if (age < 13) return fail('يجب أن يكون عمرك 13 عامًا على الأقل');
        // If they moved faster than the debounce, settle it before continuing.
        if (handleState === 'checking' || handleState === 'empty') {
          try {
            if (!(await window.API.isHandleAvailable(handleIn.value))) {
              return fail('اسم المستخدم محجوز، اختر غيره');
            }
          } catch (e) { /* fall through; the unique index still guards it */ }
        }
        data.name = nameIn.value;
        data.handle = handleIn.value;
        data.birth = birthIn.value;
        show(1);
      } }, 'التالي');
      body.appendChild(next);
    }

    // ── Step 2: how we reach you ──
    // Email only. The phone option is gone until an SMS provider is set up:
    // Supabase cannot deliver a code without one, so choosing phone led to a
    // verification screen that could never be satisfied.
    const emailIn = el('input', { class: 'input', type: 'email', placeholder: 'البريد الإلكتروني', autocomplete: 'email' });

    function step2() {
      body.innerHTML = '';
      body.appendChild(el('h2', { class: 'auth-title' }, 'ما بريدك الإلكتروني؟'));
      body.appendChild(el('p', { class: 'auth-subtitle' }, 'سنرسل رمز تحقق من ست خانات للتأكد أنه أنت'));
      body.appendChild(error);

      const paneWrap = el('div', { class: 'input-wrap' });
      paneWrap.appendChild(emailIn);
      body.appendChild(paneWrap);

      const next = el('button', { class: 'btn btn-pill', onclick: () => {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailIn.value.trim())) return fail('بريد إلكتروني غير صالح');
        data.email = emailIn.value.trim();
        data.phone = '';
        data.method = 'email';
        show(2);
      } }, 'التالي');
      body.appendChild(next);
    }

    // ── Step 3: password ──
    const pw = secretField({ label: 'كلمة المرور', placeholder: 'كلمة المرور', autocomplete: 'new-password' });
    const cf = secretField({ label: 'تأكيد كلمة المرور', placeholder: 'أعد كتابة كلمة المرور', autocomplete: 'new-password' });

    function step3() {
      body.innerHTML = '';
      body.appendChild(el('h2', { class: 'auth-title' }, 'اختر كلمة مرور'));
      body.appendChild(el('p', { class: 'auth-subtitle' }, 'قوية وسهلة التذكر لك وحدك'));
      body.appendChild(error);
      body.appendChild(pw);

      const reqList = el('ul', { class: 'sec-reqs', style: { margin: '2px 2px 14px' } });
      const reqRows = passwordChecks('').map(r => {
        const li = el('li', {}, [el('span', { class: 'sec-tick', html: icons.check }), el('span', {}, r.label)]);
        reqList.appendChild(li);
        return li;
      });
      body.appendChild(reqList);
      body.appendChild(cf);

      const create = el('button', { class: 'btn btn-pill', disabled: true }, 'إنشاء الحساب');
      body.appendChild(create);
      body.appendChild(el('p', { class: 'reg-hint', style: { textAlign: 'center' } },
        'بإنشاء حساب أنت توافق على الشروط وسياسة الخصوصية.'));

      const validate = () => {
        const checks = passwordChecks(pw.input.value);
        checks.forEach((c, i) => reqRows[i].classList.toggle('ok', c.ok));
        create.disabled = !(checks.every(c => c.ok) && cf.input.value === pw.input.value && pw.input.value);
      };
      pw.input.addEventListener('input', validate);
      cf.input.addEventListener('input', validate);
      validate();

      create.onclick = async () => {
        if (isCommonPassword(pw.input.value)) return fail('هذه كلمة مرور شائعة جدًا، اختر غيرها');
        error.hidden = true;
        create.disabled = true;
        create.textContent = 'جاري إنشاء الحساب...';
        try { if (window.I18N) window.I18N.apply(create); } catch (e) {}
        try {
          const params = { password: pw.input.value, name: data.name, handle: data.handle };
          if (data.email) params.email = data.email; else params.phone = data.phone;
          await window.SB.signUp(params);
          sessionStorage.setItem('tt-pending-otp', JSON.stringify({ email: data.email || undefined, phone: data.phone || undefined }));
          // Saved once the OTP proves the account is real - there is no
          // session to write with until then.
          sessionStorage.setItem('tt-pending-profile', JSON.stringify({ birth_date: data.birth }));
          toast('تم إرسال رمز التحقق');
          go('/otp');
          return;
        } catch (e) {
          fail(mapAuthError(e));
        }
        create.textContent = 'إنشاء الحساب';
        create.disabled = false;
        try { if (window.I18N) window.I18N.apply(create); } catch (e) {}
      };
    }

    const renderers = [step1, step2, step3];
    function show(i) {
      step = i;
      error.hidden = true;
      segs.forEach((sg, k) => sg.classList.toggle('on', k <= step));
      renderers[step]();
      try { if (window.I18N) window.I18N.apply(root); } catch (e) {}
    }

    show(0);
    return root;
  };

  // ===== OTP =====
  V.otp = () => {
    hideNav();
    const root = el('section', { class: 'auth-screen' });
    root.appendChild(topBar({ title: 'التحقق' }));
    const wrap = el('div', { style: { padding: '14px 4px', textAlign: 'center' } });
    wrap.appendChild(el('div', { class: 'auth-logo' }, [
      el('div', { class: 'auth-logo-svg', html: icons.logo, style: { width: '150px', height: 'auto', margin: '0 auto 12px' } })
    ]));
    wrap.appendChild(el('h2', { class: 'auth-title' }, 'أدخل رمز التحقق'));
    wrap.appendChild(el('p', { class: 'auth-subtitle' }, 'أرسلنا لك رمز التحقق'));
    const inputs = [];
    const row = el('div', { class: 'otp-row' });
    for (let i = 0; i < OTP_LEN; i++) {
      const inp = el('input', { class: 'otp-input', maxLength: 1, inputMode: 'numeric' });
      inp.addEventListener('input', e => {
        if (e.target.value && i < OTP_LEN - 1) inputs[i + 1].focus();
        verifyBtn.disabled = !otpReady(inputs);
      });
      inp.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !e.target.value && i > 0) inputs[i - 1].focus();
      });
      inputs.push(inp);
      row.appendChild(inp);
    }
    wrap.appendChild(row);
    const otpError = el('div', { class: 'error-box', hidden: true, style: { marginTop: '12px' } });
    wrap.appendChild(otpError);
    const pending = JSON.parse(sessionStorage.getItem('tt-pending-otp') || '{}');
    // Supabase will not send again for 60 seconds, so the link counts itself
    // down rather than letting someone press it into an error.
    const resendLink = el('a', { class: 'auth-link' }, 'إعادة الإرسال');
    wrap.appendChild(el('div', { class: 'otp-resend' }, [
      document.createTextNode('لم يصلك الرمز؟ '),
      resendLink,
    ]));

    let ticking = 0, resendTimer = null;
    function startCooldown(sec) {
      ticking = sec;
      resendLink.classList.add('disabled');
      clearInterval(resendTimer);
      const tick = () => {
        if (ticking <= 0) {
          clearInterval(resendTimer);
          resendLink.classList.remove('disabled');
          resendLink.textContent = 'إعادة الإرسال';
          try { if (window.I18N) window.I18N.apply(resendLink); } catch (e) {}
          return;
        }
        resendLink.textContent = 'إعادة الإرسال (' + ticking + ')';
        ticking--;
      };
      tick();
      resendTimer = setInterval(tick, 1000);
    }

    resendLink.onclick = async () => {
      if (resendLink.classList.contains('disabled')) return;
      try {
        await window.SB.resendSignup(pending.email);
        toast('تم إرسال الرمز مرة أخرى');
        startCooldown(RESEND_COOLDOWN);
      } catch (e) {
        otpError.textContent = mapAuthError(e);
        otpError.hidden = false;
        // If the server named a wait, honour that instead of guessing.
        startCooldown(retryAfterSeconds(e) || RESEND_COOLDOWN);
      }
    };
    // Signup has just sent one, so the clock is already running server side.
    startCooldown(RESEND_COOLDOWN);
    const verifyBtn = el('button', { class: 'btn btn-pill', disabled: true, style: { marginTop: '24px' }, onclick: async () => {
      const code = inputs.map(x => x.value).join('');
      if (code.length < OTP_MIN) return;
      verifyBtn.disabled = true;
      verifyBtn.textContent = 'جاري التحقق...';
      try {
        if (!pending.email && !pending.phone) {
          otpError.textContent = 'انتهت الجلسة — أعد التسجيل'; otpError.hidden = false;
          verifyBtn.disabled = false; verifyBtn.textContent = 'تحقق ومتابعة'; return;
        }
        // Try the right OTP type. For email signup confirmation it's 'signup';
        // for OTP login it's 'email'; for SMS it's 'sms'. Try in order.
        const isPhone = !!pending.phone;
        const tryTypes = isPhone ? ['sms'] : ['signup', 'email', 'magiclink'];
        let lastErr = null;
        for (const type of tryTypes) {
          try {
            const params = { token: code, type };
            if (pending.email) params.email = pending.email; else params.phone = pending.phone;
            await window.SB.verifyOtp(params);
            lastErr = null;
            break;
          } catch (e) { lastErr = e; }
        }
        if (lastErr) throw lastErr;
        sessionStorage.removeItem('tt-pending-otp');
        // The signup wizard collected a birthday, but there was no session to
        // write it with until this moment.
        try {
          const prof = JSON.parse(sessionStorage.getItem('tt-pending-profile') || 'null');
          if (prof && prof.birth_date && window.API) {
            await window.API.saveBirthDate(prof.birth_date);
          }
          sessionStorage.removeItem('tt-pending-profile');
        } catch (e) { console.warn('birth date save:', e); }
        go('/home');
      } catch (e) {
        otpError.textContent = mapAuthError(e);
        otpError.hidden = false;
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'تحقق ومتابعة';
      }
    } }, 'تحقق ومتابعة');
    wrap.appendChild(verifyBtn);
    root.appendChild(wrap);
    return root;
  };

  // ===== Forgot password =====
  V.forgot = () => {
    hideNav();
    const root = el('section', { class: 'auth-screen' });
    root.appendChild(topBar({ title: 'استعادة كلمة المرور' }));
    const wrap = el('div', { style: { padding: '14px 4px' } });
    wrap.appendChild(el('h2', { class: 'auth-title' }, 'نسيت كلمة المرور؟'));
    wrap.appendChild(el('p', { class: 'auth-subtitle' }, 'سنرسل رمز التحقق إلى بريدك'));
    const inp = el('input', { class: 'input', placeholder: 'البريد الإلكتروني' });
    const errBox = el('div', { class: 'error-box', hidden: true });
    wrap.appendChild(errBox);
    wrap.appendChild(el('div', { class: 'input-wrap' }, [inp]));
    const fbtn = el('button', { class: 'btn btn-pill', onclick: async () => {
      if (!inp.value) return;
      fbtn.disabled = true;
      fbtn.textContent = 'جاري الإرسال...';
      try {
        const addr = inp.value.trim();
        await window.SB.resetPassword(addr);
        try { sessionStorage.setItem('tt-reset-email', JSON.stringify(addr)); } catch (e2) {}
        go('/reset-otp');
      } catch (e) {
        errBox.textContent = mapAuthError(e);
        errBox.hidden = false;
        fbtn.disabled = false;
        fbtn.textContent = 'إرسال الرمز';
      }
    } }, 'إرسال الرمز');
    wrap.appendChild(fbtn);
    root.appendChild(wrap);
    return root;
  };

  // ===== Home Feed =====
  V.home = (params) => {
    bottomNav('home');
    const tab = (params && params.q && params.q.tab) || 'foryou';
    const root = el('section', { class: 'feed' });

    // Top: tabs
    const tabs = el('div', { class: 'feed-tabs' }, [
      // 'متابَعة' rather than 'متابعون' on purpose. The translator matches
      // whole strings, and 'متابعون' is also the profile's followers stat —
      // so this tab was rendering in English as "Followers", the opposite of
      // what it shows. One Arabic word, two meanings, one dictionary entry.
      el('button', { class: 'feed-tab' + (tab === 'following' ? ' active' : ''), onclick: () => go('/home?tab=following') }, 'متابَعة'),
      el('button', { class: 'feed-tab' + (tab === 'foryou' ? ' active' : ''), onclick: () => go('/home?tab=foryou') }, 'لك'),
      el('button', { class: 'feed-tab', onclick: () => go('/live/host-list') }, 'مباشر'),
    ]);
    root.appendChild(tabs);

    const scroll = el('div', { class: 'feed-scroll' });
    root.appendChild(scroll);

    // ── One swipe moves exactly one clip ──
    // scroll-snap-type alone does not give you this. A hard flick keeps its
    // momentum, and the snap only decides where it eventually comes to rest,
    // so a quick swipe could sail past three to five videos. The gesture is
    // driven by hand instead and the travel is clamped to a single row, so a
    // gentle swipe and a violent one both advance exactly one.
    (function oneClipPerSwipe() {
      let startY = 0, startX = 0, startTop = 0, startTs = 0;
      let dragging = false, animating = false, axis = null;
      const H = () => scroll.clientHeight || 1;

      function releaseSnap() { scroll.style.scrollSnapType = 'none'; }
      function restoreSnap() { scroll.style.scrollSnapType = 'y mandatory'; }

      scroll.addEventListener('touchstart', (e) => {
        if (animating || e.touches.length !== 1) return;
        dragging = true; axis = null;
        startY = e.touches[0].clientY;
        startX = e.touches[0].clientX;
        startTs = Date.now();
        // Start from the row we are actually resting on, not a half-scrolled
        // position, or the clamp below would be measured from the wrong place.
        startTop = Math.round(scroll.scrollTop / H()) * H();
      }, { passive: true });

      scroll.addEventListener('touchmove', (e) => {
        if (!dragging) return;
        const dy = e.touches[0].clientY - startY;
        const dx = e.touches[0].clientX - startX;

        if (!axis) {
          // Too small to read a direction from yet.
          if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
          axis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
          // Horizontal belongs to the tab switcher — let it through untouched.
          if (axis === 'h') { dragging = false; return; }
          releaseSnap();
        }

        // Clamped to one screen in either direction. This is what makes
        // momentum unable to carry the feed past the neighbouring clip.
        const clamped = Math.max(-H(), Math.min(H(), -dy));
        // Once the browser has already committed to scrolling, the event can
        // no longer be cancelled and calling preventDefault only logs a
        // warning. Drive the position by hand when we still can, and let the
        // browser get on with it when we cannot.
        if (e.cancelable) e.preventDefault();
        scroll.scrollTop = startTop + clamped;
      }, { passive: false });

      function settle(target) {
        animating = true;
        scroll.scrollTo({ top: target, behavior: 'smooth' });
        setTimeout(() => {
          animating = false;
          restoreSnap();
          playOnlyVisible();
        }, 320);
      }

      scroll.addEventListener('touchend', (e) => {
        if (!dragging) return;
        dragging = false;
        if (axis !== 'v') { restoreSnap(); return; }

        const dy = e.changedTouches[0].clientY - startY;
        const dt = Math.max(1, Date.now() - startTs);
        // Either a decisive distance or a quick flick commits the move, so a
        // short sharp swipe still advances rather than springing back.
        const commit = Math.abs(dy) > H() * 0.18 || (Math.abs(dy) / dt) > 0.4;
        let target = startTop;
        if (commit) target = startTop + (dy < 0 ? H() : -H());
        const max = Math.max(0, scroll.scrollHeight - H());
        settle(Math.max(0, Math.min(max, target)));
      });

      scroll.addEventListener('touchcancel', () => {
        if (!dragging) return;
        dragging = false;
        restoreSnap();
      });
    })();

    // Options sheet shown from the feed's "more" (⋮) button: Not interested /
    // More like this / Report — mirrors Instagram's per-post options menu.
    function openVideoOptionsSheet(v, itemEl) {
      const sheet = el('div', { class: 'sheet', style: { padding: '8px 0' } });

      function row(icon, label, onclick, danger) {
        return el('div', {
          class: 'user-row',
          style: { cursor: 'pointer', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '14px', color: danger ? 'var(--danger)' : '' },
          onclick,
        }, [
          icon ? el('span', { style: { width: '22px', height: '22px', display: 'flex' }, html: icon }) : el('span', { style: { width: '22px' } }),
          el('span', { style: { fontSize: '15px', fontWeight: 600 } }, label),
        ]);
      }

      // Both of these swallowed their errors, so the toast promised the feed
      // had been taught something even when nothing was written — and "not
      // interested" additionally removed the video, making a silent failure
      // look exactly like a success.
      const notInterestedRow = row(icons.eyeOff, 'غير مهتم', async () => {
        close();
        const isReal = typeof v.id === 'string' && v.id.length > 10 && window.API;
        if (isReal) {
          // Written first here, unlike the other actions: hiding the video is
          // not reversible on screen, so it should not happen until the
          // preference has actually been recorded.
          try {
            await window.API.setVideoFeedback(v.id, 'not_interested');
          } catch (e) {
            toast('تعذر التحديث');
            return;
          }
        }
        itemEl.style.transition = 'opacity 0.25s'; itemEl.style.opacity = '0';
        setTimeout(() => itemEl.remove(), 250);
        toast('لن نعرض لك محتوى مشابهًا كثيرًا');
      });

      const interestedRow = row(icons.heart, 'مهتم — أظهر لي المزيد مثل هذا', async () => {
        close();
        if (typeof v.id === 'string' && v.id.length > 10 && window.API) {
          try {
            await window.API.setVideoFeedback(v.id, 'interested');
          } catch (e) { toast('تعذر التحديث'); return; }
        }
        toast('سنعرض لك محتوى مشابهًا أكثر');
      });

      const reportRow = row(icons.flag, 'الإبلاغ', () => {
        close();
        openReportSheet('video', v.id);
      }, true);

      sheet.appendChild(notInterestedRow);
      sheet.appendChild(interestedRow);
      sheet.appendChild(el('div', { class: 'divider' }));
      sheet.appendChild(reportRow);
      sheet.appendChild(row(null, 'إلغاء', () => close()));

      const close = modal(sheet);
    }

    // Report sheet — pick a reason, submits to the `reports` table (auto-hides
    // the content once it crosses the report threshold — see 0012_moderation.sql).
    function openReportSheet(targetType, targetId) {
      const reasons = [
        'محتوى غير لائق', 'خطاب كراهية أو تنمر', 'عنف أو محتوى صادم',
        'انتحال شخصية', 'محتوى مضلل', 'بريد عشوائي', 'أخرى',
      ];
      const sheet = el('div', { class: 'sheet', style: { padding: '16px 0' } });
      sheet.appendChild(el('h3', { style: { margin: '0 16px 8px', textAlign: 'center' } }, 'لماذا تبلغ عن هذا؟'));
      reasons.forEach(reason => {
        sheet.appendChild(el('div', {
          class: 'user-row',
          style: { cursor: 'pointer', padding: '13px 20px' },
          onclick: async () => {
            close();
            try {
              await window.API.report({ targetType, targetId, reason });
              toast('تم استلام بلاغك، شكرًا لك');
            } catch (e) {
              toast(friendlyError(e, 'تعذر إرسال البلاغ'));
            }
          },
        }, [el('span', { style: { fontSize: '14.5px' } }, reason)]));
      });
      const close = modal(sheet);
    }
    window._openReportSheet = openReportSheet; // exposed for use from the profile screen

    // Adapt a database row to the shape the feed renderer expects.
    // A real row's own counts are always used verbatim — including zero.
    // (This previously did `v.likes_count || 1200 + idx*150`, so a genuine
    // video with 0 likes displayed 1200.) Demo placeholders are only ever
    // used for rows that aren't real, and only while demo mode is on.
    const num = (x) => (typeof x === 'number' ? x : 0);
    const adapt = (v, idx) => {
      idx = idx || 0;
      const real = !!(v && v.id);
      const demoList = (DEMO && DB && DB.videos) || [];
      const demoItem = demoList[idx % (demoList.length || 1)] || {};
      const demoBgList = (DEMO && DB && DB.VIDEO_BG) || [];
      const demoBg = demoBgList[idx % (demoBgList.length || 1)] || demoItem.bg || '';
      const rawUrl = (v && v.video_url && isVideoUrl(v.video_url)) ? v.video_url : demoBg;
      return {
        id: (v && v.id) || ('v-' + idx),
        bg: isVideoUrl(rawUrl) ? rawUrl : demoBg,
        video_url: isVideoUrl(rawUrl) ? rawUrl : demoBg,
        poster: (v && (v.thumbnail || v.poster)) || demoItem.thumbnail || '',
        thumbnail: (v && (v.thumbnail || v.poster)) || demoItem.thumbnail || '',
        desc: (v && v.description) || (real ? '' : (demoItem.desc || '')),
        music: (v && v.music) || demoItem.music || 'الأصلي',
        sound_id: (v && v.sound_id) || null,
        likes:    real ? num(v.likes_count)    : num(demoItem.likes),
        comments: real ? num(v.comments_count) : num(demoItem.comments),
        shares:   real ? num(v.shares_count)   : num(demoItem.shares),
        saves:    real ? num(v.saves_count)    : num(demoItem.saves),
        liked: !!(v && v.liked),
        saved: !!(v && v.saved),
        user: {
          id: (v && v.user && v.user.id) || ('u-' + idx),
          handle: (v && v.user && v.user.handle ? '@' + v.user.handle : (demoItem.user && demoItem.user.handle) || '@creator'),
          name: (v && v.user && v.user.name) || (demoItem.user && demoItem.user.name) || 'مستخدم',
          avatar: (v && v.user && v.user.avatar_url) || (demoItem.user && demoItem.user.avatar) || '',
        },
      };
    };

    // Demo content shows immediately so the app is browsable with no
    // backend; real rows replace it as soon as they arrive.
    const demoSeed = (DEMO && DB.videos) ? (tab === 'following' ? DB.videos.slice(0, 6) : DB.videos) : [];
    let list = demoSeed;

    function showFeedEmpty() {
      scroll.innerHTML = '';
      scroll.appendChild(emptyState(tab === 'following'
        ? { icon: 'users', onDark: true, title: 'لا تتابع أي حساب بعد',
            sub: 'تابع صُنّاع المحتوى لترى فيديوهاتهم هنا',
            actionLabel: 'استكشف حسابات', onAction: () => go('/discover') }
        : { icon: 'video', onDark: true, title: 'لا توجد فيديوهات بعد',
            sub: 'كن أول من ينشر فيديو على تِنث تون',
            actionLabel: 'إنشاء فيديو', onAction: () => go('/create') }));
    }

    (async () => {
      try {
        if (!window.API) { if (!demoSeed.length) showFeedEmpty(); return; }
        // Deep link (/v/<id>): pin the shared video to the top of the feed
        const focusId = params && params.videoId;
        let focused = null;
        if (focusId) {
          try { focused = await window.API.fetchVideo(focusId); } catch (e) { console.warn('deep-linked video fetch failed:', e); }
        }
        const real = await window.API.fetchFeed({ tab });
        if (real && real.length) {
          let rows = real;
          if (focused) rows = [focused].concat(real.filter(r => r.id !== focused.id));
          list = rows.map((r, i) => adapt(r, i));
          scroll.innerHTML = '';
          renderItems();
        } else if (focused) {
          list = [adapt(focused, 0)];
          scroll.innerHTML = '';
          renderItems();
        } else if (!demoSeed.length) {
          showFeedEmpty();
        }
      } catch (e) {
        console.warn('feed fetch failed:', e);
        if (!demoSeed.length) { scroll.innerHTML = ''; scroll.appendChild(errorState(null)); }
      }
    })();

    function renderItems() { list.forEach((v, i) => renderItem(v, i)); }
    function renderItem(v, idx) {
      // Only substitute a local sample clip in demo mode. Outside demo mode a
      // row whose video_url isn't actually a video (e.g. seed rows pointing at
      // an image) renders as a still, rather than silently playing an
      // unrelated bundled video as if it were that post's content.
      const demoBgList = (DEMO && DB.VIDEO_BG) || [];
      const fallbackUrl = demoBgList.length ? demoBgList[idx % demoBgList.length] : '';
      const videoSrc = (v.video_url && isVideoUrl(v.video_url)) ? v.video_url : ((v.bg && isVideoUrl(v.bg)) ? v.bg : fallbackUrl);
      const isVideo = !!videoSrc;
      // Hoisted out of the !isVideo branch: a video row has a thumbnail too,
      // and it was going unused, so a clip that had not loaded showed the
      // WebView's grey placeholder instead of its own still.
      const still = (v.poster || v.thumbnail || v.bg || '');
      // Show dark sleek backdrop while video streams
      const item = el('div', { class: 'feed-item', style: { background: '#000' } });
      if (!isVideo) {
        if (still) {
          item.appendChild(el('div', {
            style: {
              position: 'absolute', inset: 0, zIndex: 1,
              backgroundImage: `url(${safeUrl(still) || still})`,
              backgroundSize: 'cover', backgroundPosition: 'center',
            }
          }));
        }
      }
      if (isVideo) {
        const video = document.createElement('video');
        // The source is deliberately NOT set here — see attachSrc below.
        video.dataset.src = videoSrc;
        // Its own still if it has one, otherwise a transparent pixel. Either
        // way, never the WebView's grey play-button placeholder.
        video.poster = (still && (safeUrl(still) || still)) || BLANK_POSTER;
        // No autoplay ATTRIBUTE. It overrides preload entirely — the browser
        // fetches and plays an autoplay video whatever preload says — which is
        // why setting 'metadata' alone changed nothing. Playback is driven from
        // JS instead: autoPlay() on load and the IntersectionObserver on
        // scroll, both of which already check the clip is actually on screen.
        // Sound is a session preference, not a per-clip one. Once someone
        // turns it on it stays on as they scroll, the way every short video
        // app behaves. Starting muted is still required: browsers refuse to
        // autoplay with sound.
        video.muted = PLAYBACK.muted;
        video.defaultMuted = PLAYBACK.muted;
        armSoundOnFirstGesture();
        video.loop = true;
        video.playsInline = true;
        // 'none' until the clip is near the viewport. A page is 20 rows and
        // every one of them used to carry preload="auto" with a src already
        // set, so opening the feed started twenty whole-file downloads at
        // once. That is what made the feed cost several Mbps — not the
        // bitrate of any single clip, which measures well under 2.
        video.preload = 'none';
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        if (PLAYBACK.muted) video.setAttribute('muted', '');
        // (see above: playback is started from JS, not the attribute)
        video.setAttribute('loop', '');
        video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000;z-index:1;pointer-events:none;';

        const playBadge = el('div', {
          class: 'play-badge',
          html: icons.play,
          style: {
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(0,0,0,0.5)',
            display: 'none', alignItems: 'center', justifyContent: 'center', color: '#fff',
            zIndex: 3, pointerEvents: 'none',
          }
        });
        item.appendChild(video);
        item.appendChild(playBadge);

        // ── Only clips near the viewport are allowed on the wire ──
        // Attaching the source starts the download; removing it cancels one
        // already in flight. A clip is attached when it comes within a screen
        // of the viewport and detached once it is more than a screen away, so
        // at most about three files are ever in flight instead of twenty.
        function attachSrc() {
          if (video.getAttribute('src')) return;
          video.setAttribute('src', video.dataset.src);
          // 'metadata', not 'auto'. Attaching happens a full screen before the
          // clip is visible, and 'auto' told the browser to pull the WHOLE
          // file — so opening the feed downloaded two complete videos, about
          // 10 MB, before anything had been watched. The clip that actually
          // plays is upgraded in autoPlay(); this one may never be reached.
          video.preload = 'metadata';
          try { video.load(); } catch (e) {}
        }
        function detachSrc() {
          if (!video.getAttribute('src')) return;
          try {
            video.pause();
            video.removeAttribute('src');
            video.load(); // actually aborts the transfer; removeAttribute alone does not
          } catch (e) {}
        }
        const nearIo = new IntersectionObserver(entries => {
          entries.forEach(e => { e.isIntersecting ? attachSrc() : detachSrc(); });
        }, { rootMargin: '100% 0px' });
        nearIo.observe(item);

        video.addEventListener('error', () => {
          // A detached video fires 'error' on some engines. That is us, not a
          // broken file — ignore it or the poster gets hidden on every scroll.
          if (!video.getAttribute('src')) return;
          // In demo mode, fall through to another sample clip. Outside it,
          // leave the poster showing rather than playing unrelated content.
          if (!video._retried && demoBgList.length) {
            video._retried = true;
            // dataset.src too, so re-attaching later keeps the fallback.
            video.dataset.src = demoBgList[(idx + 1) % demoBgList.length];
            video.setAttribute('src', video.dataset.src);
            autoPlay(video);
          } else {
            video.style.display = 'none';
          }
        });

        // Direct autoplay handler
        video.addEventListener('canplay', () => autoPlay(video));
        video.addEventListener('loadeddata', () => autoPlay(video));
        // Initial play attempt
        autoPlay(video);

        // Double tap likes the clip. Assigned once the action rail below has
        // been built, since the counter and the filled heart live on it.
        item._likeFromGesture = null;

        // Flies a heart up from wherever the finger landed, the way every
        // short video app confirms a double tap.
        function heartBurst(e) {
          const r = item.getBoundingClientRect();
          const x = (e && e.clientX ? e.clientX : r.left + r.width / 2) - r.left;
          const y = (e && e.clientY ? e.clientY : r.top + r.height / 2) - r.top;
          const h = el('div', { class: 'tap-heart', html: icons.feedHeart });
          h.style.left = x + 'px';
          h.style.top = y + 'px';
          item.appendChild(h);
          setTimeout(() => { try { h.remove(); } catch (err) {} }, 900);
        }

        // Tap toggles sound; double tap likes.
        let tapTimer = null, lastTapTs = 0;
        item.addEventListener('click', (e) => {
          if (e.target.closest('.feed-actions') || e.target.closest('.feed-info') || e.target.closest('.feed-tabs')) return;
          const now = Date.now();

          if (now - lastTapTs < 300) {
            // Second tap of a pair. Cancel the sound toggle the first one
            // queued — a double tap should never also flip the audio.
            lastTapTs = 0;
            if (tapTimer) { clearTimeout(tapTimer); tapTimer = null; }
            heartBurst(e);
            // Double tap only ever likes, never unlikes, matching TikTok and
            // Instagram: tapping an already liked clip re-plays the heart and
            // leaves the like in place. Unliking is the rail button's job.
            if (item._likeFromGesture) item._likeFromGesture();
            return;
          }

          lastTapTs = now;
          // Held back briefly so a double tap can cancel it. Single tap still
          // reads as instant at this delay.
          tapTimer = setTimeout(() => {
            tapTimer = null;
            // Tapping a clip turns sound on or off for the whole session.
            // It deliberately does not pause: on a scrolling feed a stray tap
            // that freezes the video reads as the app breaking.
            setMuted(!PLAYBACK.muted);
            playOnlyVisible();
            playBadge.style.display = 'none';
          }, 260);
        });

        // ── Engagement tracking: watch time, replay count, and completion %
        // feed the personalized FYP ranking (fetch_fyp_feed RPC boosts
        // creators/sounds a user rewatches, spends real time on, or
        // watches to (near) the end — completion % is a stronger signal
        // than raw watch time since it's duration-independent). ──
        let watchStartTs = null;
        let accumWatchMs = 0;
        let lastT = 0;
        let loopCount = 0;
        let peakT = 0; // furthest playback position reached in a single pass (not accumulated across loops)

        video.addEventListener('timeupdate', () => {
          if (video.currentTime < lastT - 1) loopCount++; // wrapped around = replayed
          else if (video.currentTime > peakT) peakT = video.currentTime;
          lastT = video.currentTime;
        });

        function flushEngagement() {
          if (watchStartTs != null) {
            accumWatchMs += Date.now() - watchStartTs;
            watchStartTs = null;
          }
          if (accumWatchMs < 1500) return; // ignore noise (accidental scroll-past)
          const completionPct = video.duration ? Math.min(peakT / video.duration, 1) : 0;
          if (typeof v.id === 'string' && v.id.length > 10 && window.API) {
            window.API.trackEngagement({ videoId: v.id, watchMs: accumWatchMs, loopCount, completionPct }).catch(() => {});
          }
          accumWatchMs = 0;
          loopCount = 0;
          peakT = 0;
        }
        window.addEventListener('hashchange', flushEngagement, { once: true });

        // IntersectionObserver for vertical scrolling autoplay
        const io = new IntersectionObserver(entries => {
          entries.forEach(e => {
            if (e.isIntersecting) {
              // Scrolling a video into view is autoplay too, so it obeys the
              // preference; with it off the play badge stays up to be tapped.
              if (PLAYBACK.autoplay) {
                video.play().then(() => { playBadge.style.display = 'none'; }).catch(() => {});
              } else {
                playBadge.style.display = '';
              }
              watchStartTs = Date.now();
            } else {
              video.pause();
              flushEngagement();
            }
          });
        }, { threshold: 0.5 });
        io.observe(item);
      }


      // Music in vertical layout to the right of the small music button
      const musicRaw = v.music || 'الأصلي';
      const musicParts = musicRaw.split(' - ');
      const musicTitle = musicParts[0] || musicRaw;
      const musicAuthor = musicParts[1] || (v.user && v.user.name) || 'FLYP Sound';

      // The sound is already surfaced by the rotating disc in the right rail,
      // so the bottom-left pill was showing it a second time. Removed.

      // Right info — show plain text always; hashtags revealed on "see more"
      const fullDesc = v.desc || '';
      // Split into plain text part and hashtag part
      const hashtagMatch = fullDesc.match(/(#\S+(\s+#\S+)*\s*)$/);
      const plainText = hashtagMatch ? fullDesc.slice(0, hashtagMatch.index).trimEnd() : fullDesc;
      const hashtagText = hashtagMatch ? hashtagMatch[0].trim() : '';
      let descEl;
      if (hashtagText) {
        const seeMoreBtn = el('span', { class: 'see-more-btn', style: { fontWeight: '700', cursor: 'pointer', opacity: '0.75', marginInlineStart: '4px', fontSize: '13px' } }, 'عرض المزيد');
        const seeLessBtn = el('span', { class: 'see-less-btn', style: { display: 'none', fontWeight: '700', cursor: 'pointer', opacity: '0.75', marginInlineStart: '4px', fontSize: '13px' } }, 'عرض أقل');
        const hashtagSpan = el('span', { class: 'desc-hashtags', style: { display: 'none', color: '#5cf', marginInlineStart: '4px' } }, hashtagText);
        descEl = el('p', { class: 'desc', style: { margin: '4px 0', fontSize: '14px', lineHeight: '1.4' } }, [
          el('span', { class: 'desc-text' }, richText(plainText)),
          seeMoreBtn,
          hashtagSpan,
          seeLessBtn,
        ]);
        seeMoreBtn.onclick = (e) => {
          e.stopPropagation();
          hashtagSpan.style.display = 'inline';
          seeMoreBtn.style.display = 'none';
          seeLessBtn.style.display = 'inline';
        };
        seeLessBtn.onclick = (e) => {
          e.stopPropagation();
          hashtagSpan.style.display = 'none';
          seeLessBtn.style.display = 'none';
          seeMoreBtn.style.display = 'inline';
        };
      } else {
        descEl = el('p', { class: 'desc', style: { margin: '4px 0', fontSize: '14px', lineHeight: '1.4' } }, richText(plainText));
      }

      // Follow state is shared between the inline button next to the handle
      // and the +/check badge on the rail avatar, so the two never disagree.
      if (!window._followedUsers) window._followedUsers = {};
      let followed = !!window._followedUsers[v.user.id];

      // The follow state used to live only in memory, so after a reload every
      // creator showed "Follow" even if you already followed them - and there
      // was no way to unfollow from the feed. Ask the server once per card.
      (async () => {
        if (!window.API || !isRealId(v.user.id)) return;
        try {
          const real = await window.API.isFollowing(v.user.id);
          if (real !== followed) {
            followed = real;
            window._followedUsers[v.user.id] = real;
            applyFollowUI();
          }
        } catch (e) { /* leave the optimistic state */ }
      })();

      function applyFollowUI() {
        followBtn.textContent = followed ? 'متابَع' : 'متابعة';
        followBtn.classList.toggle('following', followed);
        // Hide the button entirely on your own posts.
        followBtn.hidden = !!(myFeedUserId && v.user.id === myFeedUserId);
        try { if (window.I18N) window.I18N.apply(followBtn); } catch (e) {}
      }

      // The call used to be fired without await inside a try/catch, which
      // catches nothing: a rejected promise escapes a synchronous try, so a
      // follow that the server refused still left the button reading
      // "Following" until the screen was rebuilt.
      async function setFollowed(next) {
        const prev = followed;
        followed = next;
        window._followedUsers[v.user.id] = followed;
        applyFollowUI();
        if (window.API && typeof v.user.id === 'string' && v.user.id.length > 4) {
          try {
            if (next) {
              const r = await window.API.follow(v.user.id);
              // A private account returns a pending request, not a follow.
              if (r === 'requested') {
                followed = false;
                window._followedUsers[v.user.id] = false;
                applyFollowUI();
                toast('تم إرسال طلب المتابعة');
              }
            } else {
              await window.API.unfollow(v.user.id);
            }
          } catch (e) {
            followed = prev;
            window._followedUsers[v.user.id] = prev;
            applyFollowUI();
            toast('تعذر التحديث');
          }
        }
      }

      const followBtn = el('button', {
        class: 'inline-follow',
        onclick: (e) => { e.stopPropagation(); setFollowed(!followed); },
      }, 'متابعة');
      applyFollowUI();

      const info = el('div', { class: 'feed-info' }, [
        el('div', {
          class: 'feed-user-row',
          style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', cursor: 'pointer' },
          // Tapping the avatar or the name opens that profile. The Follow
          // button sits inside this row, so let its own handler win.
          onclick: (e) => {
            if (e.target.closest('.inline-follow')) return;
            e.stopPropagation();
            go('/profile/' + v.user.id);
          },
        }, [
          avatar(v.user.avatar, v.user.name, 26),
          // Display name, not the @handle. Falls back to the handle (minus the
          // leading @) for accounts that have not set a name.
          el('p', { class: 'username', style: { margin: 0 } },
            (v.user.name && String(v.user.name).trim()) || String(v.user.handle || '').replace(/^@/, '')),
          followBtn,
        ]),
        descEl,
      ]);
      item.appendChild(info);

      // Left action bar
      const actions = el('div', { class: 'feed-actions' });
      // No avatar on the rail: the creator row at the bottom-left already
      // shows the same avatar and opens the same profile, and the Follow
      // button lives there too. One control per action.

      // One code path for both ways to like: the rail button toggles, the
      // double tap forces it on. Sharing this keeps the count, the filled
      // heart and the revert-on-error behaviour identical between them.
      async function applyLike(next) {
        if (v.liked === next) return;
        const wasLiked = v.liked;
        v.liked = next;
        v.likes += v.liked ? 1 : -1;
        likeBtn.classList.toggle('liked', v.liked);
        likeBtn.querySelector('.feed-action-count').textContent = fmt(v.likes);
        if (typeof v.id === 'string' && v.id.length > 10 && window.API) {
          try { wasLiked ? await window.API.unlike(v.id) : await window.API.like(v.id); }
          catch (e) { /* revert on error */ v.liked = wasLiked; v.likes += wasLiked ? 1 : -1; likeBtn.classList.toggle('liked', wasLiked); likeBtn.querySelector('.feed-action-count').textContent = fmt(v.likes); }
        }
      }

      const likeBtn = el('button', { class: 'feed-action' + (v.liked ? ' liked' : ''), onclick: () => applyLike(!v.liked) }, [
        el('span', { class: 'feed-action-icon no-bg', html: icons.feedHeart }),
        el('span', { class: 'feed-action-count' }, fmt(v.likes)),
      ]);
      actions.appendChild(likeBtn);
      // Hands the double-tap handler its way in (set on the item above).
      item._likeFromGesture = () => applyLike(true);

      const commentBtn = el('button', { class: 'feed-action', onclick: () => go('/comments/' + v.id) }, [
        el('span', { class: 'feed-action-icon no-bg', html: icons.feedComment }),
        el('span', { class: 'feed-action-count' }, fmt(v.comments)),
      ]);
      actions.appendChild(commentBtn);

      // Saving toasted and nothing else: the count above the icon never moved,
      // the icon never showed a saved state, and a failed save was swallowed
      // so the toast still claimed success. Now it behaves like the like
      // button — count, filled state, and a revert when the write fails.
      const saveBtn = el('button', { class: 'feed-action' + (v.saved ? ' saved' : ''), onclick: async () => {
        const wasSaved = v.saved;
        v.saved = !wasSaved;
        v.saves = Math.max(0, (Number(v.saves) || 0) + (v.saved ? 1 : -1));
        const paintSave = () => {
          saveBtn.classList.toggle('saved', !!v.saved);
          saveBtn.querySelector('.feed-action-count').textContent = fmt(v.saves);
        };
        paintSave();
        toast(v.saved ? 'تم الحفظ' : 'تم إلغاء الحفظ');
        if (typeof v.id === 'string' && v.id.length > 10 && window.API) {
          try {
            wasSaved ? await window.API.unsave(v.id) : await window.API.save(v.id);
          } catch (e) {
            v.saved = wasSaved;
            v.saves = Math.max(0, (Number(v.saves) || 0) + (wasSaved ? 1 : -1));
            paintSave();
            toast('تعذر التحديث');
          }
        }
      } }, [
        el('span', { class: 'feed-action-icon no-bg', html: icons.feedBookmark }),
        el('span', { class: 'feed-action-count' }, fmt(v.saves)),
      ]);
      const shareBtn = el('button', { class: 'feed-action', onclick: () => go('/share/' + v.id) }, [
        el('span', { class: 'feed-action-icon no-bg', html: icons.feedSend }),
        el('span', { class: 'feed-action-count' }, fmt(v.shares)),
      ]);
      actions.appendChild(shareBtn);
      actions.appendChild(saveBtn);

      // Options sheet — "Not interested" / "More like this" / "Report"
      const moreBtn = el('button', { class: 'feed-action', onclick: (e) => { e.stopPropagation(); openVideoOptionsSheet(v, item); } }, [
        el('span', { class: 'feed-action-icon no-bg', html: icons.feedMore }),
      ]);
      actions.appendChild(moreBtn);

      // Mini rotating music disc action button
      const musicDiscBtn = el('button', {
        class: 'feed-action feed-music-action',
        style: { marginTop: '4px' },
        // Opens the sound page (videos using it + "Use this sound").
        onclick: (e) => {
          e.stopPropagation();
          if (v.sound_id && isRealId(v.sound_id)) go('/sound/' + v.sound_id);
          // Older posts have no sound attached (migration 0023 backfills them).
          // Showing the raw seeded music string here leaked untranslated text.
          else toast('لا يوجد صوت مرتبط بهذا الفيديو');
        }
      }, [
        el('div', { class: 'music-disc-mini' }, [
          v.user.avatar
            ? el('img', { src: v.user.avatar, alt: '', onerror: (e) => { e.target.replaceWith(el('span', { class: 'disc-fallback', html: icons.music })); } })
            : el('span', { class: 'disc-fallback', html: icons.music }),
        ]),
      ]);
      actions.appendChild(musicDiscBtn);

      item.appendChild(actions);
      scroll.appendChild(item);
    }
    renderItems();
    return root;
  };

  // Helper to render real looping video card previews for profile and discover grids
  // Playback preferences, cached at module level. A card is built
  // synchronously, so it cannot await the database each time - the settings
  // screen pushes changes in here the moment they are toggled.
  // muted starts true because browsers block autoplay with sound. The first
// tap flips it for the session.
const PLAYBACK = { autoplay: true, dataSaver: false, muted: true };
try {
  // A returning visitor who turned sound off keeps it off.
  if (localStorage.getItem('tt_muted') === '0') PLAYBACK.muted = false;
} catch (e) {}
  window.PLAYBACK = PLAYBACK;

  async function refreshPlaybackPrefs() {
    try {
      if (!window.API || !window.API.fetchUserSettings) return;
      const cfg = await window.API.fetchUserSettings();
      PLAYBACK.autoplay = cfg.autoplay !== false;
      PLAYBACK.dataSaver = cfg.data_saver === true;
      document.documentElement.classList.toggle('data-saver', PLAYBACK.dataSaver);
    } catch (e) { /* signed out or table missing - the defaults stand */ }
  }
  window.refreshPlaybackPrefs = refreshPlaybackPrefs;
  refreshPlaybackPrefs();

  // Data saver keeps the file off the wire until it is actually wanted.
  // preloadMode() lived here and returned 'auto' whenever data saver was off.
  // Both callers now attach at 'metadata' and let autoPlay() upgrade only the
  // clip on screen, so returning 'auto' from a shared helper would just invite
  // the whole-file downloads back.

  // Every automatic play goes through here, so one preference governs them all.
  // Applies the sound preference to every video on the page, so a change
// affects the clip you tapped and everything after it.
// Plays whichever clip is most in view and pauses the rest. A feed must
// never have two videos audible at once.
function playOnlyVisible() {
  var vids = [].slice.call(document.querySelectorAll('video'));
  if (!vids.length) return;
  var best = null, bestArea = 0;
  vids.forEach(function (v) {
    var r = v.getBoundingClientRect();
    var vis = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    if (vis > bestArea) { bestArea = vis; best = v; }
  });
  vids.forEach(function (v) {
    if (v === best) { if (v.paused) v.play().catch(function () {}); }
    else if (!v.paused) v.pause();
  });
}

function setMuted(on) {
  PLAYBACK.muted = !!on;
  document.querySelectorAll('video').forEach(v => {
    v.muted = PLAYBACK.muted;
    v.defaultMuted = PLAYBACK.muted;
    if (PLAYBACK.muted) v.setAttribute('muted', '');
    else v.removeAttribute('muted');
  });
  try { localStorage.setItem('tt_muted', PLAYBACK.muted ? '1' : '0'); } catch (e) {}
}

// Browsers refuse to autoplay with sound until the person has interacted
// with the page at least once. The feed therefore starts muted, and the very
// first gesture anywhere turns sound on, unless they chose silence before.
function armSoundOnFirstGesture() {
  if (window._ttSoundArmed) return;
  window._ttSoundArmed = true;
  var pref = null;
  try { pref = localStorage.getItem('tt_muted'); } catch (e) {}
  if (pref === '1') return;
  var go = function () {
    setMuted(false);
    // Only the clip actually on screen may play. Calling play() on every
    // video left the off-screen ones running: the observer that pauses them
    // fires on visibility changes, and they never changed.
    playOnlyVisible();
    ['pointerdown', 'touchstart', 'keydown'].forEach(function (ev) {
      document.removeEventListener(ev, go, true);
    });
  };
  ['pointerdown', 'touchstart', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, go, true);
  });
}

function autoPlay(video) {
    if (!PLAYBACK.autoplay) return;
    // Only a clip that is actually on screen may start. Playing every video
    // as it loads was harmless while the feed was silent, but with audio it
    // means fifteen soundtracks at once. The observer that pauses off-screen
    // clips only fires when visibility changes, and these never became
    // visible in the first place.
    if (!isOnScreen(video)) return;
    // This is the one clip worth buffering ahead, so it gets upgraded from the
    // 'metadata' it was attached with. Data saver keeps it at metadata and
    // lets playback pull only what it needs.
    if (!PLAYBACK.dataSaver && video.preload !== 'auto') video.preload = 'auto';
    try { video.play().catch(() => {}); } catch (e) {}
  }

  // Generous threshold: the next clip may start a moment before it is fully
  // in view, which is what makes the scroll feel instant.
  function isOnScreen(video) {
    if (!video.isConnected) return false;
    const r = video.getBoundingClientRect();
    if (!r.height) return false;
    const visible = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
    return visible > r.height * 0.5;
  }

  function createVideoCard(v, i, onClick) {
    // Sample media only fills in while demo mode is on (DB.* is empty otherwise),
    // so a real post never displays an unrelated bundled clip as its preview.
    const demoBg = (DB && DB.VIDEO_BG && DB.VIDEO_BG.length) ? DB.VIDEO_BG[i % DB.VIDEO_BG.length] : '';
    const demoThumb = (DB && DB.THUMBNAILS && DB.THUMBNAILS.length) ? DB.THUMBNAILS[i % DB.THUMBNAILS.length] : '';
    const videoSrc = (v && v.video_url && isVideoUrl(v.video_url)) ? v.video_url : ((v && v.bg && isVideoUrl(v.bg)) ? v.bg : demoBg);
    const posterSrc = (v && (v.thumbnail || v.poster)) || demoThumb || '';

    const card = el('div', { class: 'video-card', onclick: onClick || (() => go('/home')) });

    // No playable source (e.g. an image-only row): show the still instead.
    if (!videoSrc) {
      card.appendChild(el('div', {
        style: {
          position: 'absolute', inset: 0,
          background: posterSrc ? `center/cover url(${safeUrl(posterSrc) || posterSrc})` : 'var(--bg-3)',
        }
      }));
      card.appendChild(el('div', { class: 'vc-overlay' }, [svg('play'), document.createTextNode(' ' + fmt((v && (v.likes || v.likes_count)) || 0))]));
      return card;
    }

    const video = document.createElement('video');
    video.src = videoSrc;
    if (posterSrc && !posterSrc.endsWith('.mp4')) video.poster = posterSrc;
    // No autoplay attribute here either — see the feed path.
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    // Grids attach a src to every card at once, so 'auto' here meant a whole
    // screen of full video downloads — far more than the feed ever cost.
    // autoPlay() upgrades whichever card is actually on screen.
    video.preload = 'metadata';
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('muted', '');
    // (playback started from JS)
    video.setAttribute('loop', '');
    video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;';

    video.addEventListener('canplay', () => autoPlay(video));
    video.addEventListener('loadeddata', () => autoPlay(video));
    video.addEventListener('error', () => {
      const demoList = (DB && DB.VIDEO_BG) || [];
      if (!video._retried && demoList.length) {
        video._retried = true;
        video.src = demoList[(i + 1) % demoList.length];
        autoPlay(video);
      } else {
        video.style.display = 'none'; // leave the poster showing
      }
    });

    const overlay = el('div', { class: 'vc-overlay' }, [svg('play'), document.createTextNode(' ' + fmt((v && (v.likes || v.likes_count)) || 0))]);

    card.appendChild(video);
    card.appendChild(overlay);
    return card;
  }

  // ===== Discover =====
  V.discover = () => {
    bottomNav('discover');
    const root = el('section', { class: 'discover' });
    const searchInput = el('input', { type: 'search', placeholder: 'ابحث عن مستخدمين، فيديوهات، أو أصوات' });
    root.appendChild(el('div', { class: 'discover-search' }, [
      el('div', { class: 'input-pill' }, [
        svg('search'),
        searchInput,
      ]),
    ]));

    let currentTag = 'all';
    const tags = [
      { id: 'all', ar: 'الكل', en: 'All' },
      { id: 'videos', ar: 'فيديوهات', en: 'Videos' },
      { id: 'accounts', ar: 'حسابات', en: 'Accounts' }
    ];
    const tagRow = el('div', { class: 'tag-row' });
    tags.forEach((t, i) => {
      const label = (window.I18N && window.I18N.getLang && window.I18N.getLang() === 'en') ? t.en : t.ar;
      tagRow.appendChild(el('button', {
        class: 'tag' + (i === 0 ? ' active' : ''),
        onclick: e => {
          tagRow.querySelectorAll('.tag').forEach(x => x.classList.remove('active'));
          e.currentTarget.classList.add('active');
          currentTag = t.id;
          if (searchInput.value.trim()) {
            doSearch();
          } else {
            renderDefault();
          }
        }
      }, label));
    });
    root.appendChild(tagRow);

    const resultsArea = el('div', { class: 'discover-results' });
    root.appendChild(resultsArea);

    // Loads the real Discover data, falling back to demo content only when
    // demo mode is on (DB.* is empty otherwise).
    async function loadDiscoverData() {
      const out = { trending: [], users: [], sounds: [], videos: [] };
      if (window.API) {
        const [tags, people, sounds, vids] = await Promise.all([
          window.API.fetchTrendingHashtags(8).catch(() => []),
          window.API.fetchSuggestedProfiles(20).catch(() => []),
          window.API.fetchSounds().catch(() => []),
          window.API.fetchPopularVideos(12).catch(() => []),
        ]);
        out.trending = (tags || []).map(t => ({
          tag: '#' + t.tag,
          meta: fmt(t.usage_count || 0) + ' فيديو',
        }));
        out.users = (people || []).map(p => ({
          id: p.id, name: p.name || '', handle: '@' + (p.handle || ''),
          avatar: p.avatar_url || '', bio: p.bio || '',
          followers: p.followers_count || 0, verified: !!p.verified,
        }));
        out.sounds = sounds || [];
        out.videos = vids || [];
      }
      if (!out.trending.length && DB.trending) out.trending = DB.trending;
      if (!out.users.length && DB.users) out.users = DB.users;
      if (!out.sounds.length && DB.sounds) out.sounds = DB.sounds;
      if (!out.videos.length && DB.videos) out.videos = DB.videos;
      return out;
    }

    let discoverData = { trending: [], users: [], sounds: [], videos: [] };

    // Section heading with an optional "See more" link on the trailing edge.
    // Flex + logical direction keeps the link on the correct side in RTL and LTR.
    function sectionHead(title, onMore) {
      const kids = [el('h3', { class: 'section-title' }, title)];
      if (onMore) kids.push(el('button', { class: 'see-more-link', onclick: () => onMore() }, 'مشاهدة المزيد'));
      return el('div', { class: 'section-head' }, kids);
    }

    function renderDefault() {
      resultsArea.innerHTML = '';

      const showAll = currentTag === 'all';
      const showVideos = showAll || currentTag === 'videos';
      const showAccounts = showAll || currentTag === 'accounts';
      const D = discoverData;

      // Nothing at all to show — one clear empty state beats four blank headings
      if (!D.trending.length && !D.users.length && !D.videos.length) {
        resultsArea.appendChild(emptyState({
          icon: 'search',
          title: 'لا يوجد محتوى للاستكشاف بعد',
          sub: 'عندما ينشر المستخدمون فيديوهات، ستظهر الاتجاهات وصُنّاع المحتوى هنا',
          actionLabel: 'إنشاء فيديو', onAction: () => go('/create'),
        }));
        return;
      }

      // 1. Trending Hashtags (shown in All or Videos)
      if ((showAll || showVideos) && D.trending.length) {
        const tagHead = sectionHead('هاشتاجات رائجة',
          showAll ? () => {
            paintTags(D.trending);
            const lnk = tagHead.querySelector('.see-more-link');
            if (lnk) lnk.remove();
          } : null);
        resultsArea.appendChild(tagHead);
        const trend = el('div', { class: 'trending-row' });
        const tagRow = (t, i) => el('div', { class: 'trending-item', onclick: () => go('/tag/' + encodeURIComponent(String(t.tag).replace(/^#/, ''))) }, [
          el('div', { class: 'trending-rank' }, '#' + (i + 1)),
          el('div', { class: 'trending-text' }, t.tag),
          el('div', { class: 'trending-meta' }, t.meta),
        ]);
        const paintTags = list => { trend.innerHTML = ''; list.forEach((t, i) => trend.appendChild(tagRow(t, i))); };
        paintTags(showAll ? D.trending.slice(0, 3) : D.trending);
        resultsArea.appendChild(trend);
      }

      // 2. Featured Creators / Accounts
      if (showAccounts && D.users.length) {
        resultsArea.appendChild(sectionHead(showAll ? 'صُنّاع محتوى مميزون' : 'جميع الحسابات المقترحة',
          (showAll && D.users.length > 4) ? () => {
            currentTag = 'accounts';
            const chips = tagRow.querySelectorAll('.tag');
            chips.forEach(x => x.classList.remove('active'));
            if (chips[2]) chips[2].classList.add('active');
            renderDefault();
          } : null));
        if (showAll) {
          const creatorsRow = el('div', { class: 'creator-row' });
          const creatorItem = u => el('div', {
            class: 'creator-item',
            onclick: () => go('/profile/' + u.id)
          }, [
            avatar(u.avatar, displayName(u), 62),
            el('div', { class: 'creator-name' }, displayName(u)),
            el('div', { class: 'creator-meta' }, fmt(u.followers) + ' متابع')
          ]);
          const paintCreators = list => { creatorsRow.innerHTML = ''; list.forEach(u => creatorsRow.appendChild(creatorItem(u))); };
          paintCreators(D.users.slice(0, 4));
          resultsArea.appendChild(creatorsRow);
        } else {
          // Full list of accounts when 'Accounts' filter is selected
          const accountsList = el('div', { style: { padding: '0 16px 16px' } });
          D.users.forEach(u => {
            accountsList.appendChild(el('div', { class: 'user-row', style: { cursor: 'pointer', padding: '10px 0', borderBottom: '1px solid var(--border)' }, onclick: () => go('/profile/' + u.id) }, [
              avatar(u.avatar, u.name, 50),
              el('div', { style: { flex: 1, minWidth: 0 } }, [
                el('div', { class: 'name', style: { fontWeight: '700' } }, u.name + (u.verified ? ' ✓' : '')),
                el('div', { class: 'handle' }, u.handle + ' · ' + fmt(u.followers) + ' متابع'),
                el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, u.bio),
              ]),
              el('button', { class: 'btn btn-secondary btn-sm', style: { width: 'auto' }, onclick: (e) => { e.stopPropagation(); go('/profile/' + u.id); } }, 'عرض'),
            ]));
          });
          resultsArea.appendChild(accountsList);
        }
      }

      // Trending sounds removed: the app has no licensed music library, and
      // original sounds are not created on publish yet, so the section only
      // ever showed placeholder rows with no audio behind them.

      // 4. Popular Videos Grid
      if (showVideos && D.videos.length) {
        resultsArea.appendChild(sectionHead(showAll ? 'فيديوهات شائعة' : 'جميع الفيديوهات الشائعة', null));
        const grid = el('div', { class: 'video-grid' });
        D.videos.forEach((v, i) => grid.appendChild(createVideoCard(v, i, () => go(isRealId(v.id) ? '/v/' + v.id : '/home'))));
        resultsArea.appendChild(grid);
      }
    }

    // Initial load: show a spinner, fetch, then render.
    resultsArea.innerHTML = '<div class="muted" style="padding:30px;text-align:center">جاري التحميل...</div>';
    (async () => {
      try { discoverData = await loadDiscoverData(); }
      catch (e) { console.warn('discover load failed:', e); }
      if (!searchInput.value.trim()) renderDefault();
    })();

    async function doSearch() {
      const shown = searchInput.value.trim();
      if (!shown) { delete searchInput.dataset.raw; renderDefault(); return; }
      // A tag chip puts the *translated* label in the box for display, but the
      // database stores the original term - query with that, not the label.
      const raw = searchInput.dataset.raw;
      const q = (raw && window.I18N && window.I18N.t(raw) === shown) ? raw : shown;
      resultsArea.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted)">جاري البحث...</div>';

      const showAll = currentTag === 'all';
      const showVideos = showAll || currentTag === 'videos';
      const showAccounts = showAll || currentTag === 'accounts';

      try {
        let res = window.API ? await window.API.searchAll(q).catch(() => null) : null;
        if (!res) {
          // Client-side mock search fallback
          const qLower = q.toLowerCase();
          res = {
            profiles: DB.users.filter(u => u.name.toLowerCase().includes(qLower) || u.handle.toLowerCase().includes(qLower)).map(u => ({ id: u.id, name: u.name, handle: u.handle.replace('@', ''), avatar_url: u.avatar, verified: u.verified })),
            videos: DB.videos.filter(v => (v.desc && v.desc.toLowerCase().includes(qLower)) || (v.user && v.user.name.toLowerCase().includes(qLower))),
            sounds: DB.sounds.filter(s => s.title.toLowerCase().includes(qLower) || s.author_name.toLowerCase().includes(qLower))
          };
        }
        resultsArea.innerHTML = '';

        if (showAccounts) {
          if (res.profiles && res.profiles.length) {
            resultsArea.appendChild(el('h3', { class: 'section-title' }, 'الحسابات'));
            res.profiles.forEach(p => {
              resultsArea.appendChild(el('div', { class: 'user-row', style: { cursor: 'pointer' }, onclick: () => go('/profile/' + p.id) }, [
                avatar(p.avatar_url, p.name, 44),
                el('div', { style: { flex: 1, minWidth: 0 } }, [
                  el('div', { class: 'name' }, p.name + (p.verified ? ' ✓' : '')),
                  el('div', { class: 'handle' }, '@' + (p.handle || '')),
                ]),
                el('button', { class: 'btn btn-secondary btn-sm', style: { width: 'auto' }, onclick: (e) => { e.stopPropagation(); go('/profile/' + p.id); } }, 'عرض'),
              ]));
            });
          }
        }

        if (showVideos) {
          if (res.videos && res.videos.length) {
            resultsArea.appendChild(el('h3', { class: 'section-title' }, 'الفيديوهات'));
            const grid = el('div', { class: 'video-grid' });
            res.videos.forEach((v, i) => grid.appendChild(createVideoCard(v, i, () => go('/home'))));
            resultsArea.appendChild(grid);
          }
        }

        if (!resultsArea.children.length) {
          resultsArea.appendChild(el('div', { class: 'empty-state', style: { padding: '40px', textAlign: 'center', color: 'var(--muted)' } }, 'لا توجد نتائج للبحث'));
        }
      } catch (err) {
        console.warn('search failed:', err);
        renderDefault();
      }
    }

    let tSearch;
    searchInput.addEventListener('input', () => {
      delete searchInput.dataset.raw;   // hand-typed query is its own source of truth
      clearTimeout(tSearch);
      tSearch = setTimeout(doSearch, 300);
    });

    // (initial render happens once loadDiscoverData() resolves, above)
    return root;
  };

  // ===== Create entry =====
  V.create = () => {
    bottomNav('create');
    const root = el('section', { class: 'create-wrap' });
    root.appendChild(topBar({ title: 'إنشاء جديد', back: false, right: el('button', { class: 'icon-btn', html: icons.x, onclick: () => go('/home') }) }));

    // Hidden file picker shared with the "upload" card. Video only — rejecting
    // here rather than on the publish screen means the user gets told why
    // instead of being carried forward to a screen that then empties itself.
    const fileInput = el('input', { type: 'file', accept: 'video/*', style: { display: 'none' } });
    fileInput.addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      if (!f.type.startsWith('video/')) {
        toast('يمكنك نشر مقاطع الفيديو فقط');
        fileInput.value = '';
        return;
      }
      window._ttPendingClip = f;
      go('/publish');
    });
    root.appendChild(fileInput);

    [
      { icon: 'rec', label: 'تسجيل فيديو', desc: 'استخدم الكاميرا لتصوير فيديو قصير', action: () => go('/camera') },
      { icon: 'up', label: 'رفع من الجهاز', desc: 'اختر فيديو أو صورة من المعرض', action: () => fileInput.click() },
      { icon: 'live', label: 'بث مباشر', desc: 'تواصل مع جمهورك مباشرة', action: () => go('/live/start') },
      // 'Ready templates' removed - there are no templates in the app; it
      // just opened the plain camera.
    ].forEach(item => {
      root.appendChild(el('div', { class: 'create-card', onclick: item.action }, [
        el('div', { class: 'create-icon ' + item.icon, html: item.icon === 'rec' ? icons.camera : item.icon === 'up' ? icons.upload : item.icon === 'live' ? icons.video : icons.sparkle }),
        el('div', { style: { flex: 1 } }, [
          el('p', { class: 'create-card-title' }, item.label),
          el('p', { class: 'create-card-desc' }, item.desc),
        ]),
        el('span', { class: 'icon-btn', html: icons.chevL }),
      ]));
    });
    return root;
  };

  // ===== Camera =====
  V.camera = (params) => {
    hideNav();
    // Arriving from a sound page: "/camera?sound=<id>". The chosen sound is
    // played back while recording so the user can perform to it, and is
    // carried through to publish so the new video joins that sound.
    const incomingSoundId = (params && params.q && params.q.sound) || null;
    const soundAudio = Object.assign(document.createElement('audio'), { preload: 'auto', loop: false });
    soundAudio.style.display = 'none';
    const root = el('section', { class: 'camera' });

    // Live preview <video>
    const previewWrap = el('div', { class: 'camera-preview' });
    const previewVideo = Object.assign(document.createElement('video'), {
      autoplay: true, muted: true, playsInline: true,
      // Nothing to show until getUserMedia resolves, and the permission
      // prompt can sit there for a while. Without this the WebView fills the
      // screen with its placeholder while the user reads the dialog.
      poster: BLANK_POSTER,
    });
    previewVideo.setAttribute('playsinline', '');
    previewVideo.style.cssText = 'width:100%;height:100%;object-fit:cover;background:#000';
    previewWrap.appendChild(previewVideo);
    root.appendChild(previewWrap);

    let stream = null;
    let recorder = null;
    let chunks = [];
    let facingMode = 'user'; // 'user' | 'environment'
    let secs = 0, timer = null;
    let maxSecs = 90;

    // Countdown and torch state live up here, beside the rest of the camera
    // state, rather than beside the buttons that drive them. stopAll() is
    // defined further up this function and touches both, and reading a `let`
    // before its declaration is a TDZ error rather than undefined — so
    // declaring them where they are used would make teardown throw.
    let countdownSecs = 0;
    let countdownHandle = null;
    let torchOn = false;

    // Torch availability is a property of the TRACK, not the device, so it has
    // to be re-read after every getUserMedia — flipping to the front camera
    // usually loses it. startCamera() runs before the buttons exist, so this
    // starts as a no-op and is replaced once they do.
    let onCameraReady = () => {};
    const dur = el('span', { class: 'camera-side-pill' }, '00:00');

    // Reads the standing decision without triggering a prompt. Returns
    // 'granted' | 'denied' | 'prompt' | null when the engine cannot say.
    async function permState(name) {
      try {
        if (!navigator.permissions || !navigator.permissions.query) return null;
        const st = await navigator.permissions.query({ name });
        return st.state;
      } catch (e) { return null; } // older engines reject unknown names
    }

    // Draws the blocked card. Which buttons appear depends on why it failed:
    // a permanent refusal must not offer "try again", because the browser
    // will not ask a second time and the button would do visibly nothing.
    function showCamError({ title, detail, canRetry }) {
      root.classList.add('cam-blocked');
      previewWrap.innerHTML = '';
      const card = el('div', { class: 'cam-error' }, [
        el('span', { class: 'ce-icon', html: icons.video }),
        el('p', { class: 'ce-title' }, title),
        el('p', { class: 'ce-sub' }, detail),
      ]);
      if (canRetry) {
        card.appendChild(el('button', {
          class: 'ce-btn', onclick: () => { root.classList.remove('cam-blocked'); startCamera(); },
        }, 'إعادة المحاولة'));
      }
      // There is always a way back to the permission, whether or not the
      // prompt can be shown again.
      card.appendChild(el('button', {
        class: 'ce-btn', onclick: () => { stopAll(); go('/settings/permissions'); },
      }, 'إدارة الأذونات'));
      card.appendChild(el('button', {
        class: 'ce-btn', onclick: () => { stopAll(); go('/upload'); },
      }, 'رفع من المعرض بدلًا من ذلك'));
      previewWrap.appendChild(card);
      try { if (window.I18N) window.I18N.apply(card); } catch (e) {}
    }

    async function startCamera() {
      if (stream) stream.getTracks().forEach(t => t.stop());

      // Asking when the answer is already a standing "no" re-runs a prompt the
      // browser silently suppresses, which is what made this look like the
      // permission had been granted and ignored. Check first, and say plainly
      // that it has to be changed in device settings.
      if ((await permState('camera')) === 'denied') {
        showCamError({
          title: 'الكاميرا محظورة',
          detail: 'تم رفض إذن الكاميرا سابقًا. لا يمكن للتطبيق طلبه مرة أخرى — فعّله من إعدادات جهازك.',
          canRetry: false,
        });
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: true });
        root.classList.remove('cam-blocked');
        previewVideo.srcObject = stream;
        try { onCameraReady(); } catch (e) {}
        return;
      } catch (e) {
        // Camera and microphone are one request, so a refused microphone
        // failed the whole thing and reported it as a camera problem. Retry
        // with video alone to find out which of the two actually said no.
        if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: false });
            root.classList.remove('cam-blocked');
            previewVideo.srcObject = stream;
            try { onCameraReady(); } catch (e) {}
            // The camera works; it was the microphone. Recording silently
            // would be worse than saying so.
            toast('الميكروفون محظور — سيتم التسجيل بدون صوت');
            return;
          } catch (e2) { /* genuinely the camera — fall through */ }
        }

        const name = (e && e.name) || '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          // Distinguishes "not asked yet, dismissed" from a standing refusal.
          const st = await permState('camera');
          showCamError({
            title: 'الكاميرا محظورة',
            detail: st === 'denied'
              ? 'تم رفض إذن الكاميرا. فعّله من إعدادات جهازك ثم عد.'
              : 'يحتاج التطبيق إلى إذن الكاميرا والميكروفون للتصوير.',
            canRetry: st !== 'denied',
          });
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          showCamError({
            title: 'لا توجد كاميرا',
            detail: 'لم يعثر التطبيق على كاميرا متاحة على هذا الجهاز.',
            canRetry: false,
          });
        } else if (name === 'NotReadableError' || name === 'AbortError') {
          showCamError({
            title: 'الكاميرا قيد الاستخدام',
            detail: 'تطبيق آخر يستخدم الكاميرا. أغلقه ثم أعد المحاولة.',
            canRetry: true,
          });
        } else {
          showCamError({
            title: 'تعذر فتح الكاميرا',
            detail: (e && e.message) || 'الرجاء السماح بالوصول إلى الكاميرا والميكروفون.',
            canRetry: true,
          });
        }
      }
    }
    startCamera();

    function stopAll() {
      if (timer) clearInterval(timer);
      cancelCountdown();
      // Leaving the screen must not leave the lamp burning.
      try {
        const t = stream && stream.getVideoTracks()[0];
        if (t && torchOn && t.applyConstraints) t.applyConstraints({ advanced: [{ torch: false }] });
      } catch (e) {}
      try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (e) {}
      try { soundAudio.pause(); } catch (e) {}
      if (stream) stream.getTracks().forEach(t => t.stop());
    }
    window.addEventListener('hashchange', stopAll, { once: true });

    function pickMime() {
      const candidates = ['video/mp4;codecs=h264,aac', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
      for (const m of candidates) if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
      return '';
    }

    function startRec() {
      if (!stream) return;
      chunks = [];
      const mimeType = pickMime();
      // Record at the size we actually want, rather than recording at whatever
      // the browser defaults to and re-encoding afterwards. A clip captured
      // here never goes near the compressor, so it costs no quality and cannot
      // hit the timing problems re-encoding has. Kept in step with
      // compress.js's TARGET_BITRATE — this is the same 1.4 Mbps at 720p, and
      // the voice recorder already pins audioBitsPerSecond the same way.
      const recOpts = { videoBitsPerSecond: 1400000, audioBitsPerSecond: 128000 };
      if (mimeType) recOpts.mimeType = mimeType;
      try { recorder = new MediaRecorder(stream, recOpts); }
      catch (e) {
        // Some runtimes reject the options object wholesale rather than
        // ignoring a field they do not know. Recording at the default is far
        // better than not recording at all.
        try { recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined); }
        catch (e2) { toast('المتصفح لا يدعم التسجيل'); return; }
      }
      recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = () => {
        const ext = (recorder.mimeType || '').includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunks, { type: recorder.mimeType || ('video/' + ext) });
        const file = new File([blob], `clip-${Date.now()}.${ext}`, { type: blob.type });
        // Park the file in a global so /publish picks it up
        window._ttPendingClip = file;
        stopAll();
        // Straight to review so the clip can be watched, retaken or trimmed
        // before it is posted.
        go('/edit-video');
      };
      recorder.start();
      // Play the chosen sound out loud so the performer can follow it. The
      // mic picks it up, which is how the audio ends up in the clip - the app
      // does not mix tracks together.
      if (soundAudio.src) { try { soundAudio.currentTime = 0; soundAudio.play().catch(() => {}); } catch (e) {} }
      recBtn.classList.add('recording');
      secs = 0;
      timer = setInterval(() => {
        secs++;
        dur.textContent = '00:' + String(secs).padStart(2, '0');
        if (secs >= maxSecs) stopRec();
      }, 1000);
    }
    function stopRec() {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      try { soundAudio.pause(); } catch (e) {}
      recBtn.classList.remove('recording');
      if (timer) { clearInterval(timer); timer = null; }
    }

    root.appendChild(el('div', { class: 'camera-top' }, [
      el('button', { class: 'cam-close', html: icons.x, onclick: () => { stopAll(); go('/create'); } }),
      el('button', { class: 'camera-sound-pill', onclick: () => openSoundPicker() }, [
        el('span', { class: 'sp-icon', html: icons.music }),
        el('span', { class: 'sound-name' }, 'أضف صوتًا'),
      ]),
      el('span', { class: 'cam-spacer' }),
    ]));
    let selectedSound = null;
    const soundPill = root.querySelector('.camera-sound-pill');

    // Preload a sound passed in from the sound page.
    (async () => {
      if (!incomingSoundId || !window.API) return;
      try {
        const snd = await window.API.fetchSound(incomingSoundId);
        if (!snd) return;
        selectedSound = snd;
        window._ttSelectedSound = snd;
        soundPill.querySelector('.sound-name').textContent = snd.title || 'صوت أصلي';
        soundPill.style.display = 'inline-flex';
        if (snd.audio_url) soundAudio.src = snd.audio_url;
      } catch (e) { console.warn('sound preload:', e); }
    })();

    async function openSoundPicker() {
      const sheet = el('div', { class: 'sheet-scroll', style: { maxHeight: '60vh', overflowY: 'auto' } });
      const close = () => { sheet.remove(); bd.remove(); };
      const bd = el('div', { class: 'backdrop', onclick: close });
      sheet.appendChild(el('div', { class: 'modal-head', style: { padding: '12px', textAlign: 'center', fontWeight: 700 } }, 'اختر صوتًا للفيديو 🎵'));
      const list = el('div', { style: { padding: '8px' } });
      sheet.appendChild(list);

      try {
        let sounds = window.API ? await window.API.fetchSounds().catch(() => []) : [];
        if (!sounds || !sounds.length) {
          sounds = DB.sounds || [];
        }
        list.innerHTML = '';
        sounds.forEach(s => {
          list.appendChild(el('div', { class: 'user-row', style: { cursor: 'pointer', padding: '10px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }, onclick: () => {
            selectedSound = s;
            window._ttSelectedSound = s;
            if (s.audio_url) soundAudio.src = s.audio_url;
            soundPill.querySelector('.sound-name').textContent = s.title;
            soundPill.style.display = 'inline-flex';
            toast('تم اختيار: ' + s.title);
            close();
          } }, [
            el('div', { class: 'avatar', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--primary-soft)', color: 'var(--primary)' } }, [svg('music')]),
            el('div', { style: { flex: 1, minWidth: 0 } }, [
              el('div', { class: 'name', style: { color: '#fff' } }, s.title),
              el('div', { class: 'handle', style: { color: 'rgba(255,255,255,0.6)' } }, s.author_name + ' · ' + (s.duration || 30) + 'ث'),
            ]),
            el('button', { class: 'btn btn-secondary btn-sm', style: { width: 'auto' } }, 'اختيار'),
          ]));
        });
      } catch (err) {
        list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted)">تعذر تحميل الأصوات</div>';
      }
      document.body.appendChild(bd);
      document.body.appendChild(sheet);
    }

    const sideBtn = (icon, label, onclick) => el('button', { class: 'cam-side-btn', onclick }, [
      el('span', { class: 'csb-icon', html: icons[icon] || '' }),
      el('span', { class: 'csb-label' }, label),
    ]);
    // ── Countdown timer ──
    // Cycles off -> 3s -> 10s -> off. The label doubles as the indicator, so
    // the current setting is readable without opening anything.
    // Appended to root rather than previewWrap on purpose: showCamError()
    // clears previewWrap with innerHTML = '', which detached this element for
    // good. The countdown then silently never appeared again after any camera
    // error the user retried past. .camera is position:relative, so an
    // inset:0 overlay lands identically either way.
    const countdownEl = el('div', { class: 'cam-countdown' });
    root.appendChild(countdownEl);

    function cancelCountdown() {
      if (countdownHandle) clearInterval(countdownHandle);
      countdownHandle = null;
      countdownEl.classList.remove('show');
    }

    function runCountdown(from, done) {
      let n = from;
      countdownEl.textContent = n;
      countdownEl.classList.add('show');
      countdownHandle = setInterval(() => {
        n -= 1;
        if (n <= 0) { cancelCountdown(); done(); }
        else { countdownEl.textContent = n; }
      }, 1000);
    }

    // The default label is captured on first use rather than hardcoded: i18n
    // rewrites this text after render, so restoring a literal 'مؤقت' would
    // flip an English UI back to Arabic. Reading it at the first click is
    // reliable because the button is always in its translated default then.
    //
    // The active state shows the bare number, which needs no translation.
    let timerDefaultLabel = null;
    const timerBtn = sideBtn('timer', 'مؤقت', () => {
      const lab = timerBtn.querySelector('.csb-label');
      if (timerDefaultLabel === null) timerDefaultLabel = lab.textContent;
      countdownSecs = countdownSecs === 0 ? 3 : (countdownSecs === 3 ? 10 : 0);
      timerBtn.classList.toggle('active', countdownSecs > 0);
      lab.textContent = countdownSecs ? String(countdownSecs) : timerDefaultLabel;
    });

    // ── Flash / torch ──
    // Genuinely controls the lamp rather than brightening the picture, so it
    // only exists where the hardware does. Hidden rather than disabled on the
    // front camera: a button that is visible and refuses reads as broken.
    const flashBtn = sideBtn('flash', 'فلاش', async () => {
      const track = stream && stream.getVideoTracks()[0];
      if (!track || !track.applyConstraints) return;
      torchOn = !torchOn;
      try {
        await track.applyConstraints({ advanced: [{ torch: torchOn }] });
        flashBtn.classList.toggle('active', torchOn);
      } catch (e) {
        torchOn = false;
        flashBtn.classList.remove('active');
        toast('تعذر تشغيل الفلاش');
      }
    });

    function refreshTorch() {
      torchOn = false;
      flashBtn.classList.remove('active');
      const track = stream && stream.getVideoTracks()[0];
      const caps = track && track.getCapabilities ? track.getCapabilities() : null;
      flashBtn.style.display = (caps && caps.torch) ? '' : 'none';
    }
    onCameraReady = refreshTorch;
    refreshTorch();   // the camera may already have started

    root.appendChild(el('div', { class: 'camera-side' }, [
      // Label was 'قلب' which the dictionary maps to "Heart" - the word means
      // both "flip" and "heart" in Arabic. 'تبديل الكاميرا' has no collision.
      sideBtn('flip', 'تبديل الكاميرا', async () => {
        cancelCountdown();
        facingMode = facingMode === 'user' ? 'environment' : 'user';
        await startCamera();
      }),
      timerBtn,
      flashBtn,
      // 'تجميل' (beautify), 'فلاتر' (filters) and 'مؤثرات' (effects) used to
      // sit here, each showing a "not available yet" toast. They are gone
      // rather than still pending.
      //
      // Beautify and effects need face landmarks — an ML pipeline, not a
      // button. Filters look trivial and are not: MediaRecorder records the
      // camera STREAM, so a CSS filter would appear in the preview and be
      // absent from the saved clip. Baking one in means drawing every frame
      // through a canvas, re-attaching the microphone track to the canvas
      // stream, and paying for it in frames and battery on exactly the cheap
      // phones this app targets. Worth doing properly one day; not worth a
      // control that lies about what it recorded.
    ]));

    const recBtn = el('button', { class: 'record-btn', onclick: () => {
      // Mid-countdown, the button is a cancel. Otherwise there is no way to
      // stop a 10-second timer you started by mistake except leaving.
      if (countdownHandle) { cancelCountdown(); return; }
      if (!recorder || recorder.state === 'inactive') {
        if (countdownSecs > 0) runCountdown(countdownSecs, startRec);
        else startRec();
      } else stopRec();
    } }, [el('div', { class: 'rb-inner' })]);

    const durationsRow = el('div', { class: 'cam-durations' }, [
      el('button', { class: 'cam-dur', onclick: e => setMax(90, e) }, '90s'),
      el('button', { class: 'cam-dur active', onclick: e => setMax(15, e) }, '15s'),
      el('button', { class: 'cam-dur', onclick: e => setMax(3, e) }, 'صورة'),
    ]);
    function setMax(n, e) {
      maxSecs = n;
      durationsRow.querySelectorAll('.cam-dur').forEach(x => x.classList.remove('active'));
      e.currentTarget.classList.add('active');
    }

    const sideAction = (icon, label, onclick) => el('button', { class: 'cam-action', onclick }, [
      el('span', { class: 'ca-icon', html: icons[icon] || '' }),
      el('span', { class: 'ca-label' }, label),
    ]);

    root.appendChild(el('div', { class: 'camera-bottom' }, [
      el('div', { class: 'camera-record' }, [
        // The left slot held 'مؤثرات' (effects), which only ever produced a
        // "not available yet" toast. Kept as an empty spacer so the record
        // button stays centred.
        el('span', { class: 'cam-action-spacer' }),
        recBtn,
        sideAction('image', 'رفع', () => { stopAll(); go('/upload'); }),
      ]),
      durationsRow,
      el('div', { class: 'cam-timer' }, [dur]),
    ]));

    return root;
  };

  // ===== Review / trim =====
  // Replaced a mock screen whose "preview" was the literal text "🎬 Video
  // preview" and whose seven tools (Sound, Filters, Effects, Text, Stickers,
  // Speed, Cover) had no click handlers at all.
  V.editVideo = () => {
    hideNav();
    const root = el('section', { class: 'review-screen' });

    let file = window._ttPendingClip || null;
    let duration = 0;
    let trimStart = 0;
    let trimEnd = 0;
    let objUrl = null;

    const video = Object.assign(document.createElement('video'), {
      playsInline: true, loop: false, controls: false,
    });
    video.setAttribute('playsinline', '');
    video.className = 'review-video';

    const picker = el('input', { type: 'file', accept: 'video/*', style: { display: 'none' } });
    const nextBtn = el('button', { class: 'review-next', disabled: true }, 'التالي');

    root.appendChild(el('header', { class: 'top-bar dark' }, [
      el('button', { class: 'icon-btn dark', html: icons.x, onclick: () => { cleanup(); go('/create'); } }),
      el('h1', { class: 'title' }, 'مراجعة'),
      nextBtn,
    ]));

    const stage = el('div', { class: 'review-stage' }, [video]);
    const playBtn = el('button', { class: 'review-play', html: icons.play });
    stage.appendChild(playBtn);
    root.appendChild(stage);
    root.appendChild(picker);

    // ── Trim bar ──
    const track = el('div', { class: 'trim-track' });
    const range = el('div', { class: 'trim-range' });
    const hStart = el('div', { class: 'trim-handle start' });
    const hEnd = el('div', { class: 'trim-handle end' });
    const playhead = el('div', { class: 'trim-playhead' });
    track.appendChild(range); track.appendChild(playhead);
    track.appendChild(hStart); track.appendChild(hEnd);

    const lenLabel = el('span', { class: 'trim-len' }, '0.0s');
    const trimPanel = el('div', { class: 'trim-panel' }, [
      el('div', { class: 'trim-head' }, [
        el('span', { class: 'trim-title' }, 'اقتصاص'),
        lenLabel,
      ]),
      track,
    ]);

    const retakeBtn = el('button', { class: 'review-retake' }, [
      el('span', { class: 'rr-icon', html: icons.camera }),
      el('span', {}, 'إعادة التصوير'),
    ]);

    const bar = el('div', { class: 'review-bar' }, [trimPanel, retakeBtn]);
    root.appendChild(bar);

    const progress = el('div', { class: 'review-progress', hidden: true }, [
      el('div', { class: 'rp-fill' }),
      el('div', { class: 'rp-label' }, 'جاري المعالجة...'),
    ]);
    root.appendChild(progress);

    function cleanup() {
      try { video.pause(); } catch (e) {}
      if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
    }
    window.addEventListener('hashchange', cleanup, { once: true });

    function pct(t) { return duration ? (t / duration) * 100 : 0; }

    function paintTrim() {
      range.style.insetInlineStart = pct(trimStart) + '%';
      range.style.width = Math.max(0, pct(trimEnd - trimStart)) + '%';
      hStart.style.insetInlineStart = pct(trimStart) + '%';
      hEnd.style.insetInlineStart = pct(trimEnd) + '%';
      lenLabel.textContent = (trimEnd - trimStart).toFixed(1) + 's';
    }

    function loadFile(f) {
      if (!f) return;
      file = f;
      cleanup();
      objUrl = URL.createObjectURL(f);
      video.src = objUrl;
      video.onloadedmetadata = () => {
        duration = isFinite(video.duration) ? video.duration : 0;
        trimStart = 0;
        trimEnd = duration;
        paintTrim();
        nextBtn.disabled = false;
        video.currentTime = 0;
      };
    }

    if (file) loadFile(file);
    else {
      // Reached via "Upload" with nothing recorded - ask for a file.
      nextBtn.disabled = true;
      picker.click();
    }
    picker.addEventListener('change', () => { loadFile(picker.files[0]); });

    // ── Playback constrained to the trimmed range ──
    let playing = false;
    function setPlaying(on) {
      playing = on;
      playBtn.classList.toggle('hidden', on);
      if (on) { video.play().catch(() => {}); } else { video.pause(); }
    }
    playBtn.onclick = () => setPlaying(true);
    stage.onclick = (e) => { if (e.target === playBtn) return; setPlaying(!playing); };

    video.addEventListener('timeupdate', () => {
      if (!duration) return;
      if (video.currentTime >= trimEnd) { video.currentTime = trimStart; setPlaying(false); }
      playhead.style.insetInlineStart = pct(video.currentTime) + '%';
    });

    // ── Dragging the handles ──
    function dragHandle(handle, which) {
      const move = (clientX) => {
        const r = track.getBoundingClientRect();
        let ratio = (clientX - r.left) / r.width;
        if (document.dir === 'rtl' || document.documentElement.dir === 'rtl') ratio = 1 - ratio;
        ratio = Math.max(0, Math.min(1, ratio));
        const t = ratio * duration;
        if (which === 'start') trimStart = Math.min(t, trimEnd - 0.3);
        else trimEnd = Math.max(t, trimStart + 0.3);
        trimStart = Math.max(0, trimStart);
        trimEnd = Math.min(duration, trimEnd);
        paintTrim();
        video.currentTime = which === 'start' ? trimStart : trimEnd;
      };
      const onMove = e => move(e.touches ? e.touches[0].clientX : e.clientX);
      const stop = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('mouseup', stop);
        document.removeEventListener('touchend', stop);
      };
      const start = e => {
        e.preventDefault(); e.stopPropagation();
        setPlaying(false);
        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('mouseup', stop);
        document.addEventListener('touchend', stop);
      };
      handle.addEventListener('mousedown', start);
      handle.addEventListener('touchstart', start, { passive: false });
    }
    dragHandle(hStart, 'start');
    dragHandle(hEnd, 'end');

    retakeBtn.onclick = () => {
      cleanup();
      window._ttPendingClip = null;
      go('/camera');
    };

    nextBtn.onclick = async () => {
      if (!file) return;
      const trimmed = (trimStart > 0.05) || (duration && trimEnd < duration - 0.05);
      if (!trimmed) { window._ttPendingClip = file; cleanup(); go('/publish'); return; }

      nextBtn.disabled = true;
      progress.hidden = false;
      const fill = progress.querySelector('.rp-fill');
      try {
        const out = await window.Compress.trim(file, trimStart, trimEnd, {
          onProgress: p => { fill.style.width = Math.round(p * 100) + '%'; },
        });
        window._ttPendingClip = out;
        cleanup();
        go('/publish');
      } catch (e) {
        progress.hidden = true;
        nextBtn.disabled = false;
        toast('تعذر اقتصاص الفيديو');
      }
    };

    return root;
  };

  // ===== Publish =====
  V.publish = () => {
    hideNav();
    const root = el('section');
    root.appendChild(topBar({ title: 'نشر', onBack: () => go('/edit-video') }));
    const wrap = el('div', { class: 'publish' });
    const descInput = el('textarea', { placeholder: 'صف فيديوك، أضف وسومًا (#) أو ذكر مستخدمين (@)' });
    const fileInput = el('input', { type: 'file', accept: 'video/*', style: { display: 'none' } });
    // Empty picker tile until the user chooses a file (previously seeded
    // with a sample video's still, which looked like a real selection).
    const thumb = el('div', { class: 'publish-thumb', style: {
      position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-3)', color: 'var(--muted)',
    } }, [el('span', { style: { width: '26px', height: '26px' }, html: icons.plus })]);
    let chosenFile = null;

    // If we just came from the camera screen, pick up the recorded clip
    if (window._ttPendingClip) {
      chosenFile = window._ttPendingClip;
      window._ttPendingClip = null;
    }

    function showPreview(file) {
      if (!file) return;
      thumb.innerHTML = '';
      thumb.style.backgroundImage = '';
      if (file.type.startsWith('video/')) {
        const v = Object.assign(document.createElement('video'), { src: URL.createObjectURL(file), muted: true, autoplay: true, loop: true, playsInline: true });
        v.setAttribute('playsinline', '');
        v.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:8px;background:#000';
        thumb.appendChild(v);
      } else {
        thumb.style.backgroundImage = `url(${URL.createObjectURL(file)})`;
      }
    }

    // Validates against max size / max duration; clears chosenFile and shows an
    // error toast if it fails, otherwise renders the preview.
    async function acceptFile(file) {
      if (!file) return;

      // FLYP posts are video only. The `accept` attribute is a filter hint,
      // not a rule — the OS picker lets you switch it to "All files" and a
      // drag-and-drop ignores it outright — so the real check lives here,
      // which is the one place every path (camera clip, picker, drop) lands.
      if (!file.type.startsWith('video/')) {
        toast('يمكنك نشر مقاطع الفيديو فقط');
        fileInput.value = '';
        return;
      }

      if (window.Compress) {
        const check = await window.Compress.validate(file);
        if (!check.ok) {
          toast(friendlyError(check));
          fileInput.value = '';
          return;
        }
      }

      // On-device nudity check (NSFWJS) — runs before the file is ever
      // shown/uploaded. First run in a session downloads the model (a
      // few seconds); cached after that.
      if (window.NSFWCheck) {
        thumb.style.opacity = '0.5';
        thumb.style.pointerEvents = 'none';
        toast('جاري فحص المحتوى...');
        const nsfw = await window.NSFWCheck.checkFile(file);
        thumb.style.opacity = '1';
        thumb.style.pointerEvents = '';
        if (nsfw.flagged) {
          toast(nsfw.reason);
          fileInput.value = '';
          return;
        }
      }

      chosenFile = file;
      showPreview(file);
    }

    if (chosenFile) acceptFile(chosenFile);

    fileInput.addEventListener('change', e => {
      acceptFile(e.target.files[0]);
    });
    thumb.style.cursor = 'pointer';
    thumb.onclick = () => fileInput.click();
    // Caption + thumbnail, with a live character counter.
    const capCount = el('span', { class: 'pub-count' }, '0/150');
    descInput.setAttribute('maxlength', '150');
    descInput.addEventListener('input', () => { capCount.textContent = descInput.value.length + '/150'; });
    wrap.appendChild(el('div', { class: 'publish-row' }, [
      el('div', { class: 'pub-caption' }, [descInput, capCount]),
      thumb,
      fileInput,
    ]));

    // Quick-insert for hashtags and mentions - the two things people actually
    // type into a caption, and fiddly on a phone keyboard.
    function insertAtCaret(ch) {
      const start = descInput.selectionStart || descInput.value.length;
      const end = descInput.selectionEnd || start;
      const before = descInput.value.slice(0, start);
      const after = descInput.value.slice(end);
      const needsSpace = before.length && !/\s$/.test(before);
      descInput.value = before + (needsSpace ? ' ' : '') + ch + after;
      const pos = (before + (needsSpace ? ' ' : '') + ch).length;
      descInput.focus();
      descInput.setSelectionRange(pos, pos);
      descInput.dispatchEvent(new Event('input'));
    }
    wrap.appendChild(el('div', { class: 'pub-quick' }, [
      el('button', { class: 'pub-chip', onclick: () => insertAtCaret('#') }, '# هاشتاج'),
      el('button', { class: 'pub-chip', onclick: () => insertAtCaret('@') }, '@ إشارة'),
    ]));

    // One row builder, so the icon size, label and trailing control line up
    // everywhere. Icons previously had no size cap and rendered huge, which
    // pushed every label onto two or three lines.
    function pubRow(icon, label, trailing, onclick) {
      const kids = [
        el('span', { class: 'pr-icon', html: icon ? (icons[icon] || '') : '' }),
        el('span', { class: 'pr-label' }, label),
        trailing,
      ].filter(Boolean);
      return el('div', { class: 'publish-row-link' + (onclick ? ' tappable' : ''), onclick }, kids);
    }
    const chev = () => el('span', { class: 'pr-chev', html: icons.chevL });
    const makeToggleEl = (on) => {
      const t = el('div', { class: 'toggle' + (on ? ' on' : '') });
      t.onclick = () => t.classList.toggle('on');
      return t;
    };

    const privacyPill = el('button', { class: 'privacy-pill' }, [
      el('span', { class: 'pp-ico', html: icons.globe }),
      el('span', { class: 'pp-text' }, 'عام'),
    ]);
    let privacy = 'public';
    const PRIVACY = [
      { v: 'public',  l: 'عام',      icon: 'globe' },
      { v: 'friends', l: 'الأصدقاء', icon: 'user' },
      { v: 'private', l: 'أنا فقط',  icon: 'lock' },
    ];
    privacyPill.onclick = () => {
      const sheet = el('div', { class: 'sheet', style: { padding: '8px 0 14px' } });
      const close = modal(sheet);
      sheet.appendChild(el('div', { class: 'sheet-title' }, 'من يستطيع المشاهدة'));
      PRIVACY.forEach(o => sheet.appendChild(el('button', { class: 'sheet-opt' + (o.v === privacy ? ' active' : ''), onclick: () => {
        privacy = o.v;
        privacyPill.querySelector('.pp-text').textContent = o.l;
        privacyPill.querySelector('.pp-ico').innerHTML = icons[o.icon] || '';
        try { if (window.I18N) window.I18N.apply(privacyPill); } catch (e) {}
        close();
      } }, [
        el('span', { class: 'so-ico', html: icons[o.icon] || '' }),
        el('span', {}, o.l),
      ])));
      try { if (window.I18N) window.I18N.apply(sheet); } catch (e) {}
    };

    const commentsToggle = makeToggleEl(true);
    const savingToggle = makeToggleEl(true);

    wrap.appendChild(pubRow('user', 'الإشارة إلى أشخاص', chev(), () => toast('قيد التطوير')));
    wrap.appendChild(pubRow('mapPin', 'إضافة موقع', chev(), () => toast('قيد التطوير')));
    wrap.appendChild(pubRow('lock', 'من يستطيع المشاهدة', privacyPill));
    wrap.appendChild(pubRow('comment', 'السماح بالتعليقات', commentsToggle));
    wrap.appendChild(pubRow('bookmark', 'السماح بالحفظ', savingToggle));
    const errBox = el('div', { class: 'error-box', hidden: true, style: { marginTop: '12px' } });
    wrap.appendChild(errBox);

    // Progress bar shown during compression + upload
    const progressWrap = el('div', { hidden: true, style: { marginTop: '12px' } });
    const progressLabel = el('div', { style: { fontSize: '13px', color: 'var(--muted)', marginBottom: '6px', textAlign: 'center' } }, 'جاري الضغط...');
    const progressBar = el('div', { style: { height: '4px', borderRadius: '99px', background: 'var(--surface)', overflow: 'hidden' } }, [
      el('div', { class: 'compress-bar-fill', style: { height: '100%', width: '0%', background: 'var(--primary)', borderRadius: '99px', transition: 'width 0.2s' } }),
    ]);
    progressWrap.appendChild(progressLabel);
    progressWrap.appendChild(progressBar);
    wrap.appendChild(progressWrap);

    function setProgress(ratio, label) {
      progressBar.querySelector('.compress-bar-fill').style.width = Math.round(ratio * 100) + '%';
      if (label) progressLabel.textContent = label;
    }

    // Shows the Community Guidelines agreement once per account, before their
    // first public post (Apple Guideline 1.2 requires UGC apps to get this
    // agreement). Resolves true if the user may proceed, false if they backed out.
    function ensureGuidelinesAccepted() {
      return new Promise((resolve) => {
        if (!window.API) { resolve(true); return; }
        window.API.hasAcceptedGuidelines().then(accepted => {
          if (accepted) { resolve(true); return; }
          const sheet = el('div', { class: 'sheet', style: { padding: '20px', maxWidth: '420px', margin: '0 auto', maxHeight: '70vh', overflowY: 'auto' } });
          sheet.appendChild(el('h3', { style: { margin: '0 0 12px', textAlign: 'center' } }, 'إرشادات المجتمع'));
          sheet.appendChild(el('p', { class: 'muted', style: { fontSize: '13px', lineHeight: '1.6' } },
            'قبل النشر، يرجى الموافقة على عدم نشر أي محتوى يتضمن: عري أو محتوى جنسي، عنف صريح، خطاب كراهية أو تنمر، انتحال شخصية، معلومات مضللة، انتهاك حقوق النشر، أو أي نشاط غير قانوني. نحن نزيل المحتوى المخالف ونحظر الحسابات المخالفة فور الإبلاغ عنها.'
          ));
          const agreeBtn = el('button', { class: 'btn btn-pill', style: { width: '100%', marginTop: '16px' } }, 'أوافق وأتابع');
          const cancelBtn = el('button', { class: 'btn-ghost', style: { width: '100%', marginTop: '8px' } }, 'إلغاء');
          sheet.appendChild(agreeBtn);
          sheet.appendChild(cancelBtn);
          const close = modal(sheet);
          agreeBtn.onclick = async () => {
            agreeBtn.disabled = true; agreeBtn.textContent = '...';
            try { await window.API.acceptGuidelines(); } catch (e) {}
            close();
            resolve(true);
          };
          cancelBtn.onclick = () => { close(); resolve(false); };
        }).catch(() => resolve(true));
      });
    }

    const draftBtn = el('button', { class: 'btn btn-secondary btn-pill' }, 'حفظ كمسودة');
    const pubBtn = el('button', { class: 'btn btn-pill' }, 'نشر');
    async function publish(isDraft) {
      const btn = isDraft ? draftBtn : pubBtn;
      const desc = descInput.value.trim();
      if (!chosenFile && !isDraft) { errBox.textContent = 'اختر ملف فيديو أو صورة أولاً'; errBox.hidden = false; return; }

      if (!isDraft) {
        const ok = await ensureGuidelinesAccepted();
        if (!ok) return;
      }

      errBox.hidden = true;
      btn.disabled = true; draftBtn.disabled = true; pubBtn.disabled = true;
      btn.textContent = isDraft ? 'جاري الحفظ...' : 'جاري النشر...';

      let fileToUpload = chosenFile;

      // Compress if we have a video file and the module is loaded
      if (chosenFile && chosenFile.type.startsWith('video/') && window.Compress) {
        progressWrap.hidden = false;
        setProgress(0, 'جاري ضغط الفيديو...');
        try {
          const result = await window.Compress.video(chosenFile, (ratio) => {
            setProgress(ratio * 0.85, 'جاري ضغط الفيديو... ' + Math.round(ratio * 85) + '%');
          });
          fileToUpload = result.file;
          if (!result.skipped) {
            const saved = Math.round((1 - result.compressedSize / result.originalSize) * 100);
            setProgress(0.85, 'اكتمل الضغط (' + saved + '٪ توفير) · جاري الرفع...');
          } else {
            setProgress(0.85, 'جاري الرفع...');
          }
        } catch (_) {
          setProgress(0.85, 'جاري الرفع...');
        }
      } else if (chosenFile) {
        progressWrap.hidden = false;
        setProgress(0.85, 'جاري الرفع...');
      }

      try {
        if (window.API) {
          const sound = window._ttSelectedSound || null;
          await window.API.publishVideo({
            file: fileToUpload,
            description: desc,
            music: sound ? (sound.title + ' - ' + sound.author_name) : 'الأصلي',
            allow_comments: commentsToggle.classList.contains('on'),
            allow_saving: savingToggle.classList.contains('on'),
            sound_id: sound ? sound.id : null,
            privacy,
            is_draft: isDraft
          });
          window._ttSelectedSound = null;
        }
        setProgress(1, 'تم!');
        setTimeout(() => {
          toast(isDraft ? 'تم الحفظ كمسودة' : 'تم النشر بنجاح');
          go('/profile');
        }, 400);
      } catch (e) {
        progressWrap.hidden = true;
        errBox.textContent = (e && e.message) || 'تعذر الرفع';
        errBox.hidden = false;
        btn.disabled = false; draftBtn.disabled = false; pubBtn.disabled = false;
        btn.textContent = isDraft ? 'حفظ كمسودة' : 'نشر';
      }
    }
    draftBtn.onclick = () => publish(true);
    pubBtn.onclick = () => publish(false);
    wrap.appendChild(el('div', { style: { display: 'flex', gap: '8px', marginTop: '20px' } }, [draftBtn, pubBtn]));
    root.appendChild(wrap);
    return root;
  };

  // ===== Inbox =====
  V.inbox = () => {
    bottomNav('inbox');
    const root = el('section', { class: 'inbox' });
    
    // Notifications bell. The badge count was hardcoded to "9"; it now
    // reflects the real unread count and hides entirely when there are none.
    const notifBadge = el('div', { class: 'badge', style: { position: 'absolute', top: '4px', right: '4px', background: 'var(--danger)', color: '#fff', fontSize: '10px', padding: '2px 5px', borderRadius: '10px', fontWeight: 'bold', display: 'none' } }, '');
    const notifBtn = el('button', { class: 'icon-btn', onclick: () => go('/notifications'), style: { position: 'relative' } }, [
      svg('bell'),
      notifBadge,
    ]);
    (async () => {
      try {
        if (!window.API) return;
        // Was `!n.is_read`, but the column is read_at - so every notification
        // counted as unread and the badge never cleared.
        const unread = await window.API.countUnreadNotifications();
        if (unread > 0) {
          notifBadge.textContent = unread > 99 ? '99+' : String(unread);
          notifBadge.style.display = '';
        }
      } catch (e) { /* leave the badge hidden */ }
    })();
    root.appendChild(topBar({ title: 'البريد', back: false, right: notifBtn }));

    // Friends map entry. Sits above the chat actions because it is a way of
    // seeing people, not a way of starting a conversation.
    const mapCount = el('span', { class: 'mapcard-count' }, '');
    const mapCard = el('button', { class: 'mapcard', onclick: () => go('/map') }, [
      el('span', { class: 'mapcard-icon', html: icons.map }),
      el('span', { class: 'mapcard-text' }, [
        el('span', { class: 'mapcard-title' }, 'خريطة الأصدقاء'),
        mapCount,
      ]),
      el('span', { class: 'chev', html: icons.chevL }),
    ]);
    root.appendChild(mapCard);

    (async () => {
      try {
        if (!window.API) return;
        const friends = await window.API.fetchFriendLocations();
        const n = (friends || []).length;
        mapCount.textContent = n
          ? n + ' من أصدقائك يشاركون موقعهم'
          : 'لا أحد يشارك موقعه الآن';
        try { if (window.I18N) window.I18N.apply(mapCount); } catch (e) {}
      } catch (e) { /* the card still works as a link */ }
    })();

    // Compact, sleek New group + new DM action buttons
    const cta = el('div', { style: { padding: '4px 16px 12px', display: 'flex', gap: '8px', justifyContent: 'flex-start' } }, [
      el('button', { class: 'btn btn-secondary btn-sm', style: { padding: '6px 12px', fontSize: '12px', borderRadius: '999px', display: 'inline-flex', alignItems: 'center', gap: '6px', width: 'auto', fontWeight: '700' }, onclick: () => go('/chat-new/group') }, [
        el('span', { style: { display: 'flex', alignItems: 'center', width: '14px', height: '14px' }, html: icons.user }),
        document.createTextNode('مجموعة جديدة')
      ]),
      el('button', { class: 'btn btn-secondary btn-sm', style: { padding: '6px 12px', fontSize: '12px', borderRadius: '999px', display: 'inline-flex', alignItems: 'center', gap: '6px', width: 'auto', fontWeight: '700' }, onclick: () => go('/chat-new/dm') }, [
        el('span', { style: { display: 'flex', alignItems: 'center', width: '14px', height: '14px' }, html: icons.plus }),
        document.createTextNode('محادثة جديدة')
      ]),
    ]);
    root.appendChild(cta);

    // ── Primary / Requests ──
    // A message from someone you do not follow used to land in the inbox
    // beside the people you actually talk to, indistinguishable from them.
    // It now waits in Requests until you accept it, and the tab only appears
    // when something is actually waiting — an always-visible empty tab is
    // just clutter.
    let allChats = [];
    let activeTab = 'primary';
    // False until the server has actually answered. Guards the empty state
    // above so it can only ever be shown as a fact, not as a guess.
    let chatsLoaded = false;

    const tabPrimary = el('button', { class: 'inbox-tab active', onclick: () => setTab('primary') }, 'الرسائل');
    const requestCount = el('span', { class: 'inbox-tab-count' }, '');
    const tabRequests = el('button', { class: 'inbox-tab', onclick: () => setTab('requests') }, [
      document.createTextNode('الطلبات'), requestCount,
    ]);
    const tabs = el('div', { class: 'inbox-tabs', hidden: true }, [tabPrimary, tabRequests]);
    root.appendChild(tabs);

    function setTab(t) {
      activeTab = t;
      tabPrimary.classList.toggle('active', t === 'primary');
      tabRequests.classList.toggle('active', t === 'requests');
      paint();
    }

    function paint() {
      const requests = allChats.filter(c => c.is_request);
      const primary = allChats.filter(c => !c.is_request);
      // Nothing pending: hide the tabs entirely and just show the inbox.
      tabs.hidden = requests.length === 0;
      if (!requests.length && activeTab === 'requests') activeTab = 'primary';
      tabPrimary.classList.toggle('active', activeTab === 'primary');
      tabRequests.classList.toggle('active', activeTab === 'requests');
      requestCount.textContent = requests.length ? String(requests.length) : '';
      renderChats(activeTab === 'requests' ? requests : primary);
      try { if (window.I18N) window.I18N.apply(tabs); } catch (e) {}
    }

    const list = el('div', { class: 'inbox-list' });
    root.appendChild(list);

    // Render mock by default; replace with real chats async
    function renderChats(chats) {
      list.innerHTML = '';
      if (!chats.length) {
        // "No conversations yet" is a definite statement, and this screen used
        // to make it before it had asked the server anything — so the app
        // announced you had no chats, then contradicted itself a moment later.
        // Until the answer is actually back, show placeholder rows instead:
        // they say "loading" without claiming anything untrue.
        if (!chatsLoaded) {
          for (let i = 0; i < 6; i++) {
            list.appendChild(el('div', { class: 'inbox-row skeleton-row' }, [
              el('div', { class: 'sk-circle' }),
              el('div', { class: 'sk-lines' }, [
                el('div', { class: 'sk-line w60' }),
                el('div', { class: 'sk-line w85' }),
              ]),
            ]));
          }
          return;
        }
        list.appendChild(el('div', { class: 'empty-state', style: { padding: '40px', textAlign: 'center', color: 'var(--muted)' } }, 'لا توجد محادثات بعد'));
        return;
      }
      chats.forEach(c => {
        // An opened conversation and one holding a new message used to look
        // identical. Unread now reads at a glance the way Instagram does it:
        // the name and preview go solid and bold, and a dot sits on the end.
        const unread = (c.unread_count || 0) > 0;
        const row = el('div', {
          class: 'inbox-row' + (unread ? ' unread' : ''),
          onclick: () => {
            // Clear it immediately rather than waiting for the next fetch, so
            // coming back from the chat does not still show it as unread.
            row.classList.remove('unread');
            const d = row.querySelector('.inbox-dot');
            if (d) d.remove();
            if (window.API && window.API.markChatRead) window.API.markChatRead(c.id);
            go('/chat/' + c.id);
          },
        }, [
          avatar(c.avatar || '', c.title || '', 44),
          el('div', { class: 'inbox-body' }, [
            el('div', { class: 'inbox-name' }, [
              el('span', {}, c.title),
              el('span', { class: 'time' }, _agoShort((c.last_message && c.last_message.created_at) || c.created_at)),
            ]),
            el('p', { class: 'inbox-msg' }, _msgPreview(c.last_message)),
          ]),
        ]);
        if (unread) {
          row.appendChild(el('span', {
            class: 'inbox-dot',
            // Count past 9 becomes 9+; the dot is a glance, not a report.
            title: String(c.unread_count),
          }, c.unread_count > 9 ? '9+' : String(c.unread_count)));
        }
        list.appendChild(row);
      });
    }
    function _agoShort(iso) { if (!iso) return ''; const t = Date.now() - new Date(iso).getTime(); const m = Math.floor(t / 60000); if (m < 1) return 'الآن'; if (m < 60) return m + 'د'; const h = Math.floor(m / 60); if (h < 24) return h + 'س'; const d = Math.floor(h / 24); return d + 'ي'; }
    function _msgPreview(m) {
      if (!m) return 'ابدأ محادثة';
      if (m.type === 'voice') return '🎤 رسالة صوتية';
      if (m.type === 'image') return '📷 صورة';
      if (m.type === 'video') return '🎥 فيديو';
      // A call row carries JSON in `text`, not a sentence (see the bubble
      // renderer and migration 0045). Falling through to the generic branch
      // printed that JSON straight into the inbox — {"kind":"video",...} —
      // which reads as an error message rather than a call.
      if (m.type === 'call') {
        let info = {};
        try { info = JSON.parse(m.text || '{}'); } catch (e) { info = {}; }
        const icon = info.kind === 'video' ? '📹' : '📞';
        const label = info.status === 'declined' ? 'مكالمة مرفوضة'
                    : info.status === 'missed'   ? 'مكالمة فائتة'
                    : info.kind === 'video'      ? 'مكالمة فيديو'
                    : 'مكالمة صوتية';
        return icon + ' ' + label;
      }
      // A shared reel/profile/live is a lone deep link in a text message. The
      // thread renders it as a card (buildShareCard); without this the inbox
      // still showed the naked URL, which is what a share looked like before
      // any of this and the whole reason the thread card exists.
      const t = String(m.text || '').trim();
      if (t && !/\s/.test(t) && window.DeepLink && window.DeepLink.routeForUrl) {
        const r = window.DeepLink.routeForUrl(t);
        if (r) return r.indexOf('/live/') === 0 ? '🔴 بث مباشر'
                    : r.indexOf('/profile/') === 0 ? '👤 حساب'
                    : '🎥 فيديو';
      }
      return (m.text || '').slice(0, 60);
    }

    allChats = DB.chats.map(c => ({ id: c.id, title: c.user.name, avatar: c.user.avatar, last_message: { text: c.last, created_at: new Date().toISOString() }, created_at: new Date().toISOString(), is_request: false }));
    if (allChats.length) chatsLoaded = true;   // demo data is an answer of sorts
    paint();
    (async () => {
      try {
        if (!window.API) { chatsLoaded = true; paint(); return; }
        // onFresh repaints if the background refresh turns up something
        // different from what was served out of the cache.
        const apiChats = await window.API.fetchChats({
          onFresh: (rows) => { allChats = rows || []; chatsLoaded = true; paint(); },
        });
        allChats = apiChats || [];
        chatsLoaded = true;
        paint();
      } catch (e) {
        console.warn('chats:', e);
        // Even a failure is an answer: stop showing placeholders forever.
        chatsLoaded = true;
        paint();
      }
    })();

    return root;
  };

  // ===== New chat / new group =====
  V.chatNew = (params) => {
    hideNav();
    const isGroup = params.id === 'group';
    const root = el('section');
    root.appendChild(topBar({ title: isGroup ? 'مجموعة جديدة' : 'محادثة جديدة' }));
    const wrap = el('div', { style: { padding: '14px 16px' } });
    const groupName = isGroup ? el('input', { class: 'input', placeholder: 'اسم المجموعة' }) : null;
    const groupPhoto = isGroup ? el('input', { type: 'file', accept: 'image/*' }) : null;
    if (isGroup) {
      // The native <input type="file"> ("Choose File / No file chosen") looked
      // like a raw browser control. Hidden behind a tappable avatar-style
      // circle that previews the chosen image instead.
      const picker = el('label', { class: 'photo-picker', title: 'صورة المجموعة (اختياري)' });
      const camIcon = el('span', { class: 'pp-icon', html: icons.camera });
      picker.appendChild(camIcon);
      picker.appendChild(groupPhoto);
      groupPhoto.addEventListener('change', () => {
        const f = groupPhoto.files && groupPhoto.files[0];
        if (!f) return;
        const url = URL.createObjectURL(f);
        picker.querySelectorAll('img').forEach(x => x.remove());
        camIcon.style.display = 'none';
        const img = el('img', { src: url, alt: '' });
        img.onload = () => URL.revokeObjectURL(url);
        picker.appendChild(img);
        picker.classList.add('has-photo');
      });
      wrap.appendChild(el('div', { class: 'group-setup' }, [
        picker,
        el('div', { style: { flex: 1, minWidth: 0 } }, [
          groupName,
          el('div', { class: 'photo-hint' }, 'صورة المجموعة (اختياري)'),
        ]),
      ]));
    }

    // Search bar with normal-sized icon (constrained explicitly)
    const searchIconWrap = el('span', { style: { width: '20px', height: '20px', display: 'inline-flex', flexShrink: '0', color: 'var(--muted)' } });
    searchIconWrap.appendChild(svg('search'));
    searchIconWrap.firstChild.setAttribute('width', '20');
    searchIconWrap.firstChild.setAttribute('height', '20');
    searchIconWrap.firstChild.style.width = '20px';
    searchIconWrap.firstChild.style.height = '20px';
    wrap.appendChild(el('div', { class: 'input-pill', style: { marginBottom: '10px' } }, [searchIconWrap, el('input', { id: 'search-users', placeholder: 'ابحث عن مستخدم بالاسم' })]));
    const userList = el('div', { class: 'list-screen' });
    wrap.appendChild(userList);
    const errBox = el('div', { class: 'error-box', hidden: true });
    wrap.appendChild(errBox);

    const selected = new Set();
    let allUsers = (DB && DB.users) ? DB.users.map(u => ({ id: u.id, name: u.name, handle: u.handle.replace('@', ''), avatar_url: u.avatar, verified: u.verified })) : [];
    let myId = null;
    (async () => {
      try {
        const u = await window.SB.getUser();
        myId = u && u.id;
        // Opening "new chat" listed every account on the platform, which is
        // both a stranger-contact problem and useless as a starting point.
        // The default list is now the people you follow; typing still
        // searches everyone, which is how you reach someone new on purpose.
        if (myId && window.API) {
          try {
            const following = await window.API.fetchFollowing(myId);
            if (following && following.length) allUsers = following;
            else allUsers = [];   // follow nobody yet -> empty state, not everyone
          } catch (e) { console.warn('following list:', e); }
        }
        renderUsers();
      } catch (e) {}
    })();

    // Tracked here rather than read back off the field: the search box is
    // created inline with only an id, and renderUsers needs to know whether
    // an empty list means "no results" or "you follow nobody".
    let lastQuery = '';

    async function search(q) {
      const query = (q || '').trim();
      lastQuery = query;
      try {
        if (window.API) {
          if (!query) {
            // Back to the default list rather than to everyone.
            if (myId) {
              const following = await window.API.fetchFollowing(myId).catch(() => []);
              allUsers = following || [];
            }
          } else {
            const res = await window.API.searchProfiles(query);
            allUsers = res || [];
          }
        }
      } catch (e) {
        console.warn('user search:', e);
        allUsers = [];
      }
      renderUsers();
    }
    function renderUsers() {
      userList.innerHTML = '';
      // Filter out current user so they can't try to DM themselves
      const filtered = allUsers.filter(u => u.id !== myId);
      if (!filtered.length) {
        // Two different situations, and telling them apart matters: an empty
        // default list means "you follow nobody yet", not "nobody exists".
        userList.appendChild(el('div', { style: { padding: '40px', textAlign: 'center', color: 'var(--muted)' } },
          lastQuery ? 'لا توجد نتائج' : 'تابع أشخاصًا لبدء محادثة معهم'));
        return;
      }
      filtered.forEach(u => {
        const isSel = selected.has(u.id);
        userList.appendChild(el('div', { class: 'user-row', style: { background: isSel ? 'var(--primary-soft)' : '' }, onclick: () => {
          if (isGroup) { isSel ? selected.delete(u.id) : selected.add(u.id); renderUsers(); }
          else { goCreateDm(u.id); }
        } }, [
          avatar(u.avatar_url || u.avatar, u.name, 44),
          el('div', { style: { flex: 1, minWidth: 0 } }, [
            el('div', { class: 'name' }, u.name + (u.verified ? ' ✓' : '')),
            el('div', { class: 'handle' }, '@' + (u.handle || '')),
          ]),
          isGroup ? el('span', {}, isSel ? '✓' : '') : el('span', { class: 'btn btn-secondary btn-sm' }, 'بدء'),
        ]));
      });
    }
    async function goCreateDm(otherId) {
      if (otherId === myId) { errBox.textContent = 'لا يمكنك مراسلة نفسك'; errBox.hidden = false; return; }
      try {
        const id = await window.API.openOrCreateDm(otherId);
        go('/chat/' + id);
      } catch (e) {
        const m = e.message || '';
        errBox.textContent = /cannot DM yourself/i.test(m) ? 'لا يمكنك مراسلة نفسك' : m;
        errBox.hidden = false;
      }
    }
    if (isGroup) {
      const createBtn = el('button', { class: 'btn btn-pill', style: { marginTop: '14px' }, onclick: async () => {
        if (!groupName.value.trim()) { errBox.textContent = 'أدخل اسم المجموعة'; errBox.hidden = false; return; }
        if (selected.size < 1) { errBox.textContent = 'اختر عضوًا واحدًا على الأقل'; errBox.hidden = false; return; }
        createBtn.disabled = true; createBtn.textContent = 'جاري الإنشاء...';
        try {
          const id = await window.API.createGroup({ name: groupName.value.trim(), memberIds: [...selected], photoFile: groupPhoto.files[0] || null });
          go('/chat/' + id);
        } catch (e) { errBox.textContent = e.message; errBox.hidden = false; createBtn.disabled = false; createBtn.textContent = 'إنشاء المجموعة'; }
      } }, 'إنشاء المجموعة');
      // Was appended after the full user list, so on a long list it sat far
      // below the fold and looked like there was no way to finish. Pinned to
      // the bottom of the screen instead.
      wrap.appendChild(el('div', { class: 'chatnew-footer' }, [createBtn]));
      wrap.style.paddingBottom = '86px';
    }

    const input = wrap.querySelector('#search-users');
    let t; input && input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => search(input.value), 250); });
    search('');
    root.appendChild(wrap);
    return root;
  };

  // ===== Location sharing (picker + map preview) =====
  // Deliberately key-free. Tiles come from the same public OpenStreetMap
  // endpoint the /map screen already uses, and the only geocoder is
  // Nominatim (OSM's own, free). No paid provider is configured anywhere in
  // this repo and none is introduced here.

  // The wire format is unchanged: a location message is still a plain Google
  // Maps link in `text` with type 'location'. That means messages already in
  // the database render with the new preview, and older app builds still get
  // a working link. The optional "(label)" suffix is Google Maps' own
  // labelled-point syntax, so it degrades to a normal link everywhere.
  const LOC_RE = /[?&]q=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*\(([^)]*)\))?/;

  function parseLocation(text) {
    if (typeof text !== 'string') return null;
    const m = LOC_RE.exec(text);
    if (!m) return null;
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    let label = '';
    if (m[3]) { try { label = decodeURIComponent(m[3]); } catch (e) { label = m[3]; } }
    return { lat, lng, label };
  }

  function locationLink(lat, lng, label) {
    const base = 'https://www.google.com/maps?q=' + lat.toFixed(6) + ',' + lng.toFixed(6);
    // The parentheses are the syntax, so only the label itself is encoded.
    return label ? base + '(' + encodeURIComponent(label) + ')' : base;
  }

  function fmtCoords(lat, lng) { return lat.toFixed(5) + ', ' + lng.toFixed(5); }

  // No crosshair in the shared icon set, and this is the only screen that
  // wants one, so it lives here rather than in helpers.js.
  const CROSSHAIR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';

  // A map picture without a static-map API key: the handful of raw OSM tiles
  // that cover the box, offset so the point sits dead centre, with a pin
  // drawn over them. A few <img> loads instead of a whole Leaflet instance
  // per chat bubble.
  function staticMapNode(lat, lng, opts) {
    const o = opts || {};
    // A real pixel width on purpose: the tile offsets below are derived from
    // it, so capping the box with a CSS max-width instead would slide the
    // point off centre on a narrow phone. Clamp it here where the maths sees it.
    const w = o.w || Math.max(150, Math.min(224, Math.floor((window.innerWidth || 360) * 0.6)));
    const h = o.h || 132, zoom = o.zoom || 15;
    const box = el('div', { class: 'msg-map-canvas', style: { width: w + 'px', height: h + 'px' } });
    // Map geometry is physical, not reading order. Pinning the tile layer to
    // LTR keeps the offsets below correct on this RTL page — using logical
    // properties here would mirror the world east-to-west.
    box.setAttribute('dir', 'ltr');
    const n = Math.pow(2, zoom);
    const latRad = lat * Math.PI / 180;
    const wx = (lng + 180) / 360 * n * 256;
    const wy = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n * 256;
    const left = wx - w / 2, top = wy - h / 2;
    for (let ty = Math.floor(top / 256); ty <= Math.floor((top + h - 1) / 256); ty++) {
      if (ty < 0 || ty >= n) continue; // past the poles — leave it blank
      for (let tx = Math.floor(left / 256); tx <= Math.floor((left + w - 1) / 256); tx++) {
        const wrapped = ((tx % n) + n) % n; // the world repeats east-west
        const img = el('img', {
          src: 'https://tile.openstreetmap.org/' + zoom + '/' + wrapped + '/' + ty + '.png',
          alt: '', loading: 'lazy', decoding: 'async',
          style: {
            position: 'absolute', width: '256px', height: '256px',
            left: (tx * 256 - left) + 'px', top: (ty * 256 - top) + 'px',
          },
        });
        // Offline or a blocked tile host would otherwise leave broken-image
        // glyphs scattered over the bubble.
        img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
        box.appendChild(img);
      }
    }
    box.appendChild(el('span', { class: 'msg-map-pin', html: icons.mapPin }));
    box.appendChild(el('span', { class: 'msg-map-credit' }, '© OpenStreetMap'));
    return box;
  }

  // ── Nominatim, OpenStreetMap's own geocoder ──
  // Its usage policy caps callers at one request per second and explicitly
  // rules out autocomplete, so: every call is funnelled through this gate,
  // place search only fires on an explicit submit (never per keystroke), and
  // reverse lookups wait until the map has stopped moving. The browser sets
  // Referer for us; a page cannot set User-Agent, so if OSM ever blocks this
  // origin the UI below says so out loud rather than going quiet.
  let nomAt = 0;
  function nominatim(path, params) {
    const q = new URLSearchParams(Object.assign({ format: 'jsonv2', 'accept-language': 'ar' }, params));
    const wait = Math.max(0, 1100 - (Date.now() - nomAt));
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        nomAt = Date.now();
        // No custom headers on purpose: that keeps this a simple CORS request
        // with no preflight, which Nominatim answers with a wildcard origin.
        fetch('https://nominatim.openstreetmap.org' + path + '?' + q.toString())
          .then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
          .then(resolve, reject);
      }, wait);
    });
  }

  function reverseGeocode(lat, lng) {
    return nominatim('/reverse', { lat: lat.toFixed(6), lon: lng.toFixed(6), zoom: 18 })
      .then(d => (d && (d.name || d.display_name)) || '');
  }

  function searchPlaces(q) {
    return nominatim('/search', { q: q, limit: 8 })
      .then(d => (Array.isArray(d) ? d.filter(r => isFinite(parseFloat(r.lat)) && isFinite(parseFloat(r.lon))) : []));
  }

  // Leaflet measures the container once, at construction. This screen is
  // built before it has a height, which is what made the /map screen paint a
  // single tile on grey; wait for a real size first, same as it does.
  function waitForMapSize(elm) {
    return new Promise(resolve => {
      if (elm.isConnected && elm.clientHeight > 0) return resolve();
      let tries = 0;
      const t = setInterval(() => {
        if ((elm.isConnected && elm.clientHeight > 0) || ++tries > 80) { clearInterval(t); resolve(); }
      }, 50);
    });
  }

  // Full-screen location picker. Attach > Location used to fire off the
  // current GPS fix with no map and no choice; this is the picker that was
  // missing. Calls onPick({ lat, lng, label }) only when the user actually
  // chooses to send — closing it sends nothing.
  function openLocationPicker(onPick) {
    if (typeof window.L === 'undefined') { toast('تعذر تحميل الخريطة'); return; }

    let map = null, meMarker = null, ro = null;
    let myFix = null;            // last GPS fix
    let selected = null;         // whatever sits under the centre pin
    let myLabel = '', selectedLabel = '';
    let moveTimer = null, moveSeq = 0, searchSeq = 0;
    let skipNextReverse = false, closed = false;

    const mapEl = el('div', { class: 'lp-map' });
    const pin = el('div', { class: 'lp-pin', html: icons.mapPin });
    const hint = el('div', { class: 'lp-hint' }, 'حرّك الخريطة أو اضغط عليها لاختيار مكان');
    const locateBtn = el('button', { class: 'lp-locate', title: 'موقعي الحالي', html: CROSSHAIR });
    const results = el('div', { class: 'lp-results', hidden: true });
    const searchInput = el('input', {
      class: 'lp-search-input', type: 'search', placeholder: 'ابحث عن مكان', enterkeyhint: 'search',
    });
    const searchBtn = el('button', { class: 'lp-search-btn', title: 'بحث', html: icons.search });

    function optRow(cls, iconHtml, title) {
      const t = el('div', { class: 'lp-opt-title' }, title);
      const s = el('div', { class: 'lp-opt-sub' }, '');
      const btn = el('button', { class: 'lp-opt ' + cls, disabled: true }, [
        el('span', { class: 'lp-opt-ico', html: iconHtml }),
        el('span', { class: 'lp-opt-body' }, [t, s]),
        el('span', { class: 'lp-opt-send', html: icons.send }),
      ]);
      return { btn: btn, sub: s };
    }
    const optCurrent = optRow('cur', CROSSHAIR, 'إرسال موقعي الحالي');
    const optSelected = optRow('sel', icons.mapPin, 'إرسال الموقع المحدد');

    function close() {
      if (closed) return;
      closed = true;
      clearTimeout(moveTimer);
      if (ro) { try { ro.disconnect(); } catch (e) {} }
      if (map) { try { map.remove(); } catch (e) {} map = null; }
      window.removeEventListener('hashchange', close);
      overlay.remove();
    }

    const overlay = el('div', { class: 'loc-picker' }, [
      el('header', { class: 'lp-header' }, [
        el('button', { class: 'icon-btn', title: 'إغلاق', html: icons.x, onclick: () => close() }),
        el('div', { class: 'lp-title' }, 'الموقع'),
      ]),
      el('div', { class: 'lp-search' }, [
        el('span', { class: 'lp-search-ico', html: icons.search }),
        searchInput,
        searchBtn,
      ]),
      el('div', { class: 'lp-map-wrap' }, [mapEl, pin, hint, locateBtn, results]),
      el('div', { class: 'lp-foot' }, [optCurrent.btn, optSelected.btn]),
    ]);
    document.body.appendChild(overlay);
    // Leaving the chat while the picker is open would otherwise strand a live
    // Leaflet instance and its tile requests behind the next screen.
    window.addEventListener('hashchange', close);

    function hideResults() { results.hidden = true; results.innerHTML = ''; }

    function renderResults(state, items) {
      results.innerHTML = '';
      results.hidden = false;
      if (state === 'loading') { results.appendChild(el('div', { class: 'lp-res-msg' }, 'جاري البحث...')); return; }
      if (state === 'error') {
        results.appendChild(el('div', { class: 'lp-res-msg' }, 'تعذر البحث عن الأماكن الآن — اختر المكان من الخريطة'));
        return;
      }
      if (!items.length) { results.appendChild(el('div', { class: 'lp-res-msg' }, 'لا توجد نتائج')); return; }
      items.forEach(r => {
        const full = r.display_name || '';
        const name = r.name || full.split(',')[0] || 'مكان';
        results.appendChild(el('button', {
          class: 'lp-res',
          onclick: () => {
            hideResults();
            try { searchInput.blur(); } catch (e) {}
            if (!map) return;
            // The pending reverse lookup would only re-derive the same place,
            // and the search result's own name is the better label.
            skipNextReverse = true;
            map.setView([parseFloat(r.lat), parseFloat(r.lon)], 17);
            selectedLabel = name;
            optSelected.sub.textContent = full || name;
          },
        }, [
          el('span', { class: 'lp-res-ico', html: icons.mapPin }),
          el('span', { class: 'lp-res-body' }, [
            el('span', { class: 'lp-res-name' }, name),
            el('span', { class: 'lp-res-addr' }, full),
          ]),
        ]));
      });
    }

    function doSearch() {
      const q = searchInput.value.trim();
      if (!q) { hideResults(); return; }
      const seq = ++searchSeq;
      renderResults('loading');
      searchPlaces(q).then(items => {
        if (closed || seq !== searchSeq) return;
        renderResults('ok', items);
      }, () => {
        if (closed || seq !== searchSeq) return;
        renderResults('error');
      });
    }
    // Bound to submit, never to input: Nominatim's usage policy rules out
    // using the public instance for autocomplete.
    searchBtn.onclick = doSearch;
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
    });
    searchInput.addEventListener('input', () => { if (!searchInput.value.trim()) hideResults(); });

    function onMove() {
      if (!map) return;
      const c = map.getCenter();
      selected = { lat: c.lat, lng: c.lng };
      optSelected.btn.disabled = false;
      selectedLabel = '';
      // Coordinates go up immediately, so the row is never blank even if the
      // geocoder is unreachable; the name replaces them if one comes back.
      optSelected.sub.textContent = fmtCoords(c.lat, c.lng);
      clearTimeout(moveTimer);
      // Bump the sequence before the skip check, not after: a lookup already
      // in flight for the previous centre has to be invalidated either way.
      const seq = ++moveSeq;
      if (skipNextReverse) { skipNextReverse = false; return; }
      moveTimer = setTimeout(() => {
        reverseGeocode(c.lat, c.lng).then(name => {
          if (closed || seq !== moveSeq || !name) return;
          selectedLabel = name;
          optSelected.sub.textContent = name;
        }, () => { /* the label is a nicety — the coordinates already stand */ });
      }, 700);
    }

    function drawMe() {
      if (!map || !myFix) return;
      if (meMarker) { try { map.removeLayer(meMarker); } catch (e) {} }
      meMarker = window.L.marker([myFix.lat, myFix.lng], {
        icon: window.L.divIcon({ className: 'lp-me-icon', html: '<span class="lp-me-dot"></span>', iconSize: [20, 20], iconAnchor: [10, 10] }),
        interactive: false, zIndexOffset: 400,
      }).addTo(map);
    }

    function locate(initial) {
      if (!navigator.geolocation) {
        optCurrent.sub.textContent = 'الموقع غير مدعوم على هذا الجهاز';
        return;
      }
      optCurrent.sub.textContent = 'جاري تحديد موقعك...';
      navigator.geolocation.getCurrentPosition(pos => {
        if (closed) return;
        myFix = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        optCurrent.btn.disabled = false;
        optCurrent.sub.textContent = fmtCoords(myFix.lat, myFix.lng);
        drawMe();
        if (map) { skipNextReverse = true; map.setView([myFix.lat, myFix.lng], 16); }
        // Centre and fix are the same point right now, so one lookup labels
        // both rows instead of burning two against the 1/sec budget.
        reverseGeocode(myFix.lat, myFix.lng).then(name => {
          if (closed || !name || !myFix) return;
          myLabel = name;
          optCurrent.sub.textContent = name;
          if (selected && Math.abs(selected.lat - myFix.lat) < 1e-6 && Math.abs(selected.lng - myFix.lng) < 1e-6) {
            selectedLabel = name;
            optSelected.sub.textContent = name;
          }
        }, () => {});
      }, err => {
        if (closed) return;
        optCurrent.btn.disabled = true;
        optCurrent.sub.textContent = (err && err.code === 1)
          ? 'إذن الموقع مرفوض — فعّله من إعدادات الجهاز'
          : 'تعذر تحديد موقعك';
        if (initial) toast('تعذر الوصول إلى موقعك — اختر مكانًا من الخريطة');
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
    }
    locateBtn.onclick = () => {
      if (myFix && map) {
        // This point's name is already known, so recentring must not spend
        // another lookup re-deriving it.
        skipNextReverse = true;
        map.setView([myFix.lat, myFix.lng], 16);
        selectedLabel = myLabel;
        if (myLabel) optSelected.sub.textContent = myLabel;
      } else locate(false);
    };

    function pick(p, label) {
      if (!p) return;
      close();
      try { onPick({ lat: p.lat, lng: p.lng, label: label || '' }); } catch (e) {}
    }
    optCurrent.btn.onclick = () => pick(myFix, myLabel);
    optSelected.btn.onclick = () => pick(selected, selectedLabel);

    (async function initPickerMap() {
      await waitForMapSize(mapEl);
      if (closed) return;
      // Same tiles and default centre (Riyadh) as the /map screen.
      map = window.L.map(mapEl, { zoomControl: false, attributionControl: true }).setView([24.7136, 46.6753], 12);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap',
      }).addTo(map);
      map.attributionControl.setPosition('bottomright');
      map.invalidateSize();
      requestAnimationFrame(() => { if (map) map.invalidateSize(); });
      setTimeout(() => { if (map) map.invalidateSize(); }, 300);
      if (window.ResizeObserver) {
        ro = new ResizeObserver(() => { if (map) map.invalidateSize(); });
        ro.observe(mapEl);
      }
      map.on('movestart', () => pin.classList.add('lifted'));
      // The hint teaches the gesture once; it should not sit over the tiles
      // for the whole session. Both events below are user-initiated only.
      const dropHint = () => hint.classList.add('gone');
      map.on('dragstart', dropHint);
      map.on('click', dropHint);
      setTimeout(dropHint, 6000);
      map.on('moveend', () => { pin.classList.remove('lifted'); onMove(); });
      // Tap-to-choose as well as drag-to-choose: the tapped point becomes the
      // centre, which is where the pin always sits.
      map.on('click', e => { hideResults(); map.panTo(e.latlng); });
      // Seed the selected point without naming it: this is still the default
      // centre, and the GPS fix below is about to move it anyway.
      skipNextReverse = true;
      onMove();
      locate(true);
    })();

    try { if (window.I18N) window.I18N.apply(overlay); } catch (e) {}
    return close;
  }

  // ===== Chat =====
  V.chat = (params) => {
    hideNav();
    const id = params.id;
    const root = el('section', { class: 'chat' });
    const headerName = el('div', { class: 'name' }, '...');
    const headerStatus = el('div', { class: 'status' }, '');
    // Was a raw <img src="">, which rendered as a broken-image icon.
    const headerAv = el('div', { class: 'chat-header-av' }, [avatar('', '', 36)]);
    // Avatar and name together open the other person's profile, which is
    // where you expect a name at the top of a conversation to take you.
    // Grouped into one target rather than two so the whole identity block is
    // tappable, not just the few pixels of the text itself.
    const headerIdentity = el('div', {
      class: 'chat-header-id',
      onclick: () => {
        // A group has no single profile to open, and there is no group info
        // screen yet, so it stays inert rather than going somewhere wrong.
        if (!chatInfo || chatInfo.type === 'group') return;
        const other = chatInfo.others && chatInfo.others[0];
        if (other && other.id) go('/profile/' + other.id);
      },
    }, [
      headerAv,
      el('div', { style: { flex: 1, minWidth: 0 } }, [headerName, headerStatus]),
    ]);

    root.appendChild(el('header', { class: 'chat-header' }, [
      el('button', { class: 'icon-btn back-btn', html: icons.chevL, onclick: () => go('/inbox') }),
      headerIdentity,
      el('button', { class: 'icon-btn', title: 'مكالمة صوتية', html: icons.phone, onclick: () => startCallFromChat('audio') }),
      el('button', { class: 'icon-btn', title: 'مكالمة فيديو', html: icons.video, onclick: () => startCallFromChat('video') }),
    ]));

    // These two were decoration - no handler at all. They now place a real
    // call: a row is written, the other person's device rings, and this side
    // waits on the call screen.
    async function startCallFromChat(kind) {
      try {
        const info = chatInfo || (await window.API.fetchChatInfo(id));
        const other = info && info.others && info.others[0];
        if (!other) { toast('لا يمكن بدء المكالمة'); return; }
        if (info.type === 'group') { toast('المكالمات الجماعية غير متاحة بعد'); return; }
        const c = await window.API.startCall({ calleeId: other.id, kind, chatId: id });
        go('/call/' + c.id);
      } catch (e) { toast(friendlyError(e, 'تعذر بدء المكالمة')); }
    }
    const msgs = el('div', { class: 'chat-msgs' });
    root.appendChild(msgs);

    let myUserId = null;
    // Every message id already drawn, and the optimistic bubbles still waiting
    // for their realtime echo. Together these stop a sent message appearing
    // twice in the sender's own thread — see appendMessage.
    const renderedIds = new Set();
    const pendingSends = [];
    // The message the composer is currently replying to, if any.
    let replyTo = null;
    let chatInfo = null;
    function chatIntro(info) {
      const name = (info && info.title) || '';
      const isGroup = info && info.type === 'group';
      return el('div', { class: 'chat-intro' }, [
        avatar((info && info.photo) || '', name, 76),
        el('div', { class: 'ci-name' }, name),
        // No privacy badge here on purpose: messages are stored unencrypted and
        // admins can read them, so any "private" claim would be untrue.
        el('div', { class: 'ci-sub' }, isGroup ? 'لا توجد رسائل بعد' : 'هذه بداية محادثتكما — قل مرحبًا'),
      ]);
    }
    function fmtTime(iso) { return fmtClock(iso); }
    // ── Date separators ──
    // A long thread was one unbroken run of bubbles with only clock times, so
    // there was no way to tell a message from this morning from one three
    // weeks ago. A divider is inserted whenever the day changes.
    let lastStampDay = null;
    function dayKey(iso) {
      const d = iso ? new Date(iso) : new Date();
      return isNaN(d) ? null : d.toISOString().slice(0, 10);
    }
    function dayLabel(iso) {
      const d = new Date(iso || Date.now());
      const today = new Date();
      const yest = new Date(); yest.setDate(today.getDate() - 1);
      const same = (a, b) => a.toDateString() === b.toDateString();
      if (same(d, today)) return 'اليوم';
      if (same(d, yest)) return 'أمس';
      try {
        const lang = (localStorage.getItem('tt-lang') === 'en') ? 'en-GB' : 'ar';
        return d.toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' });
      } catch (e) { return d.toDateString(); }
    }
    function maybeDateDivider(iso) {
      const k = dayKey(iso);
      if (!k || k === lastStampDay) return;
      lastStampDay = k;
      const row = el('div', { class: 'chat-day' }, el('span', {}, dayLabel(iso)));
      msgs.appendChild(row);
      try { if (window.I18N) window.I18N.apply(row); } catch (e) {}
    }

    // ── "Seen" ──
    // Placed under your own LAST message only. Repeating it on every bubble
    // is noise, and it is the most recent one you actually care about.
    const seenEl = el('div', { class: 'msg-seen' }, 'تمت المشاهدة');
    async function refreshSeen() {
      try {
        if (!window.API || !window.API.fetchOtherLastRead || !isRealId(id)) return;
        const readAt = await window.API.fetchOtherLastRead(id);
        // Find my most recent message and compare it against their last look.
        const mineBubbles = msgs.querySelectorAll('.bubble.me[data-msg-id]');
        const last = mineBubbles[mineBubbles.length - 1];
        if (!last || !readAt) { seenEl.classList.remove('show'); return; }
        const sentAt = last.dataset.sentAt ? new Date(last.dataset.sentAt) : null;
        const seen = sentAt ? (new Date(readAt) >= sentAt) : false;
        if (seen) {
          last.after(seenEl);
          seenEl.classList.add('show');
          try { if (window.I18N) window.I18N.apply(seenEl); } catch (e) {}
        } else {
          seenEl.classList.remove('show');
        }
      } catch (e) { /* a read receipt is never worth an error */ }
    }

    function appendMessage(m) {
      const mine = m.from_user_id === myUserId;

      // ── Send it once, show it once ──
      // Sending drew the bubble immediately (so it appears without waiting on
      // the round trip), and then the realtime INSERT delivered the very same
      // row back to the sender and drew it a second time. The other person
      // only ever received the realtime copy, which is why they saw one
      // message and the sender saw two.
      if (m && m.id) {
        if (renderedIds.has(m.id)) return null;   // already on screen
        if (mine) {
          // The echo of a bubble already drawn optimistically: adopt it
          // rather than appending a second one.
          const i = pendingSends.findIndex(p =>
            p.type === (m.type || 'text') && p.text === (m.text || ''));
          if (i !== -1) {
            const p = pendingSends.splice(i, 1)[0];
            renderedIds.add(m.id);
            if (p.node) p.node.dataset.msgId = m.id;
            return null;
          }
        }
        renderedIds.add(m.id);
      }

      // ── Call record ──
      // Written by a database trigger when a call reaches a terminal state
      // (0045), so it appears whichever side hung up. The row carries JSON
      // rather than a sentence, because the line has to be renderable in
      // both Arabic and English.
      if (m.type === 'call') {
        let info = {};
        try { info = JSON.parse(m.text || '{}'); } catch (e) { info = {}; }
        const isVideo = info.kind === 'video';
        const secs = Number(info.seconds) || 0;
        const answered = info.status === 'ended' && secs > 0;

        // created_at is stamped when the trigger writes the row, and the
        // trigger only fires once the call reaches a terminal state — so it
        // marks when the call ENDED. Subtracting the duration recovers when it
        // STARTED, which is the timestamp worth leading with and the one the
        // row never showed. No extra column or migration needed for it.
        const _end = m.created_at ? new Date(m.created_at) : new Date();
        const endedAt = isNaN(_end.getTime()) ? new Date() : _end;
        const startedAt = answered ? new Date(endedAt.getTime() - secs * 1000) : endedAt;

        const label = info.status === 'declined' ? 'مكالمة مرفوضة'
                    : info.status === 'missed'   ? 'مكالمة فائتة'
                    : answered                   ? (mine ? 'مكالمة صادرة' : 'مكالمة واردة')
                    // Reached when a call ended without ever being answered:
                    // hung up before pickup, or under a second long. This used
                    // to read "call not completed", which sounds like a fault
                    // in the app rather than simply nobody picking up.
                    : 'لم يتم الرد';

        const rec = el('div', {
          class: 'call-record' + (info.status === 'missed' || info.status === 'declined' ? ' missed' : ''),
        }, [
          el('span', { class: 'cr-icon', html: isVideo ? icons.video : icons.phone }),
          el('span', { class: 'cr-text' }, [
            el('span', { class: 'cr-label' }, label),
            // Time first, then length — "9:42 م · 3:14" — the shape every
            // other messenger uses. Unanswered calls have no length to show.
            el('span', { class: 'cr-meta' }, answered
              ? (fmtTime(startedAt.toISOString()) + ' · ' + fmtDuration(secs))
              : fmtTime(endedAt.toISOString())),
          ]),
        ]);
        if (m.id) rec.dataset.msgId = m.id;
        maybeDateDivider(m.created_at);
        msgs.appendChild(rec);
        try { if (window.I18N) window.I18N.apply(rec); } catch (e) {}
        return rec;
      }

      maybeDateDivider(m.created_at);
      const bubble = el('div', { class: 'bubble ' + (mine ? 'me' : 'them') });
      // A shared reel/profile/live is a lone deep link in a text message.
      const shareCard = (!m.attachment_url && (!m.type || m.type === 'text'))
        ? buildShareCard(m.text) : null;
      if (m.attachment_url && (m.type === 'image' || m.type === 'video')) {
        const tag = m.type === 'image' ? Object.assign(document.createElement('img'), { src: m.attachment_url, style: 'max-width:220px;border-radius:8px' })
                                       : Object.assign(document.createElement('video'), { src: m.attachment_url, controls: true, style: 'max-width:220px;border-radius:8px' });
        bubble.appendChild(tag);
      } else if (m.attachment_url && m.type === 'voice') {
        bubble.appendChild(Object.assign(document.createElement('audio'), { src: m.attachment_url, controls: true }));
      } else if (m.type === 'file' && m.attachment_url) {
        bubble.appendChild(el('a', {
          class: 'msg-file', href: m.attachment_url, target: '_blank', rel: 'noopener',
          download: m.text || '',
        }, [
          el('span', { class: 'mf-icon', html: icons.paperclip }),
          el('span', { class: 'mf-name' }, m.text || 'ملف'),
        ]));
        m = Object.assign({}, m, { text: '' }); // filename is already shown
      } else if (m.type === 'location') {
        // A bare link told you nothing about where the pin actually was.
        // `m.text` comes from the database and is therefore attacker-supplied:
        // the old code piped it straight into href, so a crafted 'location'
        // row could ship a javascript: URL. The link is now rebuilt from the
        // parsed coordinates and from nothing else.
        const loc = parseLocation(m.text);
        if (loc) {
          bubble.classList.add('has-map');
          bubble.appendChild(el('a', {
            class: 'msg-map', href: locationLink(loc.lat, loc.lng, loc.label),
            target: '_blank', rel: 'noopener noreferrer',
          }, [
            staticMapNode(loc.lat, loc.lng),
            el('span', { class: 'msg-map-foot' }, [
              el('span', { class: 'mm-icon', html: icons.mapPin }),
              el('span', { class: 'mm-body' }, [
                el('span', { class: 'mm-title' }, loc.label || 'موقع مشارَك'),
                el('span', { class: 'mm-sub' }, fmtCoords(loc.lat, loc.lng)),
              ]),
            ]),
          ]));
        } else {
          // Not a coordinate link we understand — keep the old plain row
          // rather than draw a map of nowhere. safeUrl blocks javascript:.
          bubble.appendChild(el('a', {
            class: 'msg-location', href: safeUrl(m.text) || '#', target: '_blank', rel: 'noopener noreferrer',
          }, [
            el('span', { class: 'ml-icon', html: icons.mapPin || icons.search }),
            el('span', {}, 'الموقع'),
          ]));
        }
        m = Object.assign({}, m, { text: '' }); // the raw URL would be noise
      } else if (shareCard) {
        bubble.classList.add('share');
        bubble.appendChild(shareCard);
        m = Object.assign({}, m, { text: '' }); // the card IS the link now
      }
      // A quoted copy of what this message answers, above its own text.
      if (m.reply_to) {
        const q = m.reply_to;
        bubble.insertBefore(el('div', {
          class: 'bubble-quote',
          onclick: () => {
            // Jump to the original and flash it, so a reply to something far
            // up the thread is actually findable.
            const target = msgs.querySelector('[data-msg-id="' + q.id + '"]');
            if (!target) return;
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.classList.add('flash');
            setTimeout(() => target.classList.remove('flash'), 1200);
          },
        }, [
          el('div', { class: 'bq-name' }, (q.from && q.from.name) || ''),
          el('div', { class: 'bq-text' }, msgPreviewText(q)),
        ]), bubble.firstChild);
      } else if (m.reply_to_id) {
        // The target was deleted; the reply itself is still real.
        bubble.insertBefore(el('div', { class: 'bubble-quote deleted' }, 'رسالة محذوفة'), bubble.firstChild);
      }

      if (m.text) bubble.appendChild(document.createTextNode(m.text));
      bubble.appendChild(el('div', { class: 't' }, fmtTime(m.created_at)));
      if (m && m.id) bubble.dataset.msgId = m.id;
      // refreshSeen compares this against the other person's last_read_at.
      if (m && m.created_at) bubble.dataset.sentAt = m.created_at;

      // ── Reactions ──
      const reactionWrap = el('div', { class: 'bubble-reactions', hidden: true });
      bubble.appendChild(reactionWrap);
      function paintReactions(list) {
        const rows = list || [];
        reactionWrap.innerHTML = '';
        if (!rows.length) { reactionWrap.hidden = true; return; }
        reactionWrap.hidden = false;
        // Grouped by emoji with a count, rather than one chip per person.
        const counts = {};
        rows.forEach(r => { counts[r.emoji] = (counts[r.emoji] || 0) + 1; });
        Object.keys(counts).forEach(e => {
          reactionWrap.appendChild(el('span', { class: 'reaction-chip' },
            counts[e] > 1 ? (e + ' ' + counts[e]) : e));
        });
      }
      let myReaction = null;
      if (m.reactions && m.reactions.length) {
        paintReactions(m.reactions);
        const mine2 = m.reactions.find(r => r.user_id === myUserId);
        myReaction = mine2 ? mine2.emoji : null;
      }
      bubble._reactions = (m.reactions || []).slice();

      async function react(emoji) {
        if (!m.id || !window.API || !window.API.toggleMessageReaction) return;
        const before = bubble._reactions.slice(), beforeMine = myReaction;
        // Optimistic: drop any previous reaction of mine, add the new one
        // unless it is the same emoji (which clears it).
        bubble._reactions = bubble._reactions.filter(r => r.user_id !== myUserId);
        myReaction = (beforeMine === emoji) ? null : emoji;
        if (myReaction) bubble._reactions.push({ user_id: myUserId, emoji: myReaction });
        paintReactions(bubble._reactions);
        try {
          await window.API.toggleMessageReaction(m.id, emoji);
        } catch (e) {
          bubble._reactions = before; myReaction = beforeMine;
          paintReactions(bubble._reactions);
          toast('تعذر التحديث');
        }
      }

      // Long press opens the reaction bar — the same gesture Instagram and
      // WhatsApp use, and the only one available without a right-click.
      const QUICK = ['❤️', '😂', '😮', '😢', '🙏', '👍'];
      function openReactionBar() {
        if (!m.id) return; // an optimistic bubble has no id to react to yet
        const bar = el('div', { class: 'reaction-bar' });
        QUICK.forEach(e => bar.appendChild(el('button', {
          class: 'reaction-pick' + (myReaction === e ? ' on' : ''), type: 'button',
          onclick: () => { close(); react(e); },
        }, e)));
        const close = modal(bar);
      }

      let pressTimer = null;
      bubble.addEventListener('touchstart', () => {
        pressTimer = setTimeout(openReactionBar, 450);
      }, { passive: true });
      ['touchend', 'touchmove', 'touchcancel'].forEach(ev =>
        bubble.addEventListener(ev, () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }, { passive: true }));
      bubble.addEventListener('contextmenu', (e) => { e.preventDefault(); openReactionBar(); });

      // ── Swipe to reply ──
      // Dragging a bubble toward the middle of the screen and letting go sets
      // it as the reply target, which is the gesture people already expect.
      (function swipeToReply() {
        let sx = 0, sy = 0, dx = 0, active = false, decided = false;
        const TRIGGER = 56;
        bubble.addEventListener('touchstart', (e) => {
          if (e.touches.length !== 1) return;
          active = true; decided = false; dx = 0;
          sx = e.touches[0].clientX; sy = e.touches[0].clientY;
        }, { passive: true });
        bubble.addEventListener('touchmove', (e) => {
          if (!active) return;
          const nx = e.touches[0].clientX - sx;
          const ny = e.touches[0].clientY - sy;
          if (!decided) {
            // Vertical wins: the thread must still scroll normally.
            if (Math.abs(ny) > Math.abs(nx)) { active = false; return; }
            if (Math.abs(nx) < 8) return;
            decided = true;
          }
          // Resisted past the trigger so it cannot be dragged across the screen.
          dx = nx;
          const shown = Math.sign(dx) * Math.min(Math.abs(dx), TRIGGER + 16);
          bubble.style.transform = 'translateX(' + shown + 'px)';
          bubble.classList.toggle('reply-armed', Math.abs(dx) > TRIGGER);
        }, { passive: true });
        function release() {
          if (!active) return;
          active = false;
          const fire = Math.abs(dx) > TRIGGER;
          bubble.style.transition = 'transform 160ms ease';
          bubble.style.transform = '';
          bubble.classList.remove('reply-armed');
          setTimeout(() => { bubble.style.transition = ''; }, 180);
          if (fire && m.id) setReplyTo(m);
        }
        bubble.addEventListener('touchend', release, { passive: true });
        bubble.addEventListener('touchcancel', release, { passive: true });
      })();

      // ── The same thing, for a mouse ──
      // swipeToReply above binds touch events only, so on a desktop browser
      // there was no way to reply to a particular message at all — no button,
      // no menu, nothing. Harmless in the APK; a dead end on the website.
      //
      // The button is the discoverable route and right-click is the shortcut
      // for people who reach for it. Both are hidden on touch devices by a
      // (hover: hover) query in app.css, where the swipe already covers this
      // and a permanent button would only clutter the bubble.
      if (m.id) {
        bubble.appendChild(el('button', {
          class: 'bubble-reply',
          title: 'رد',
          html: icons.arrowL || '',
          onclick: (e) => { e.stopPropagation(); setReplyTo(m); },
        }));
        bubble.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          setReplyTo(m);
        });
      }

      msgs.appendChild(bubble);
      return bubble; // the sender tracks this node until its echo arrives
    }

    // Demo thread as a first paint. Two guards, both needed:
    //
    // The fallback used to be `find(id) || DB.chats[0]`, so opening ANY real
    // conversation painted the FIRST demo thread — someone else's name, photo
    // and messages — for the moment before the API answered. That is the
    // "demo screen flashes for a second" on entering a chat. A demo thread is
    // now only ever used when its id genuinely matches.
    //
    // And a real chat id is a uuid, so if this looks like one there is a real
    // conversation coming and nothing should be painted over it, whether or
    // not demo mode happens to be on.
    const mockChat = (DEMO && !isRealId(id) && DB.chats)
      ? (DB.chats.find(x => x.id === id) || null)
      : null;
    if (mockChat) {
      headerName.textContent = mockChat.user.name;
      headerAv.innerHTML = ''; headerAv.appendChild(avatar(mockChat.user.avatar, mockChat.user.name, 36));
      // There is no presence system, so "online now" was mock data claiming
      // something the app cannot know. Left blank until real presence exists.
      headerStatus.textContent = '';
      mockChat.messages.forEach(m => appendMessage({ from_user_id: m.from === 'me' ? 'me' : 'them', text: m.text, created_at: new Date().toISOString() }));
    }

    let unsub = null;
    (async () => {
      try {
        const user = await window.SB.getUser(); myUserId = user && user.id;
        if (!window.API) return;
        // Load DB messages — but only if id looks like a uuid
        if (typeof id !== 'string' || id.length < 30) return;

        // Fill the header with the real chat (name + photo). Without this the
        // title stayed as the literal "..." placeholder forever.
        try {
          const info = await window.API.fetchChatInfo(id);
          chatInfo = info;
          // Only show it as tappable once we know it leads somewhere.
          if (info && info.type !== 'group' && info.others && info.others[0]) {
            headerIdentity.classList.add('tappable');
          }
          if (info) {
            headerName.textContent = info.title;
            headerAv.innerHTML = '';
            headerAv.appendChild(avatar(info.photo, info.title, 36));
            headerStatus.textContent = '';
            try { if (window.I18N) window.I18N.apply(headerName); } catch (e2) {}
          }
        } catch (e2) { console.warn('chat info:', e2); }

        const messages = await window.API.fetchMessages(id);
        msgs.innerHTML = '';
        if (!messages.length) {
          // First conversation between two people - a blank grey panel looked
          // broken, so introduce who you are talking to instead.
          msgs.appendChild(chatIntro(chatInfo));
        }
        messages.forEach(appendMessage);
        msgs.scrollTop = msgs.scrollHeight;

        // Reading the thread is what clears it from the inbox. Done here as
        // well as on the inbox row, so arriving by deep link or notification
        // counts as having read it too.
        if (window.API.markChatRead) window.API.markChatRead(id);

        // "Seen" under your own last message, if they have opened the thread
        // since you sent it. Only on DMs — a group has no single reader.
        refreshSeen();

        // Subscribe realtime
        unsub = window.API.subscribeToMessages(id, (m) => {
          appendMessage(m);
          msgs.scrollTop = msgs.scrollHeight;
          // A message arriving while the thread is open has been seen.
          if (window.API.markChatRead) window.API.markChatRead(id);
          refreshSeen();
        });

        // ── Catch up on anything the live connection missed ──
        // A websocket is not a guarantee. It drops when the phone sleeps, the
        // tab is backgrounded, or the network changes, and nothing tells the
        // screen it has gone quiet — which is why a message sent from another
        // device only appeared after a manual refresh.
        //
        // So the thread stops relying solely on the live feed: whenever it
        // becomes visible again it re-reads the conversation and appends
        // whatever is new. appendMessage already ignores anything it has
        // drawn before, so re-reading can never duplicate a message.
        async function catchUp() {
          try {
            const rows = await window.API.fetchMessages(id);
            let added = 0;
            (rows || []).forEach(m => { if (appendMessage(m)) added++; });
            if (added) {
              msgs.scrollTop = msgs.scrollHeight;
              if (window.API.markChatRead) window.API.markChatRead(id);
            }
          } catch (e) { console.warn('catch-up failed:', e); }
        }
        const onVisible = () => { if (document.visibilityState === 'visible') catchUp(); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', catchUp);
        window.addEventListener('hashchange', () => {
          document.removeEventListener('visibilitychange', onVisible);
          window.removeEventListener('online', catchUp);
        }, { once: true });
      } catch (e) { console.warn('chat load:', e); }
    })();

    // Hidden file pickers — separate ones for video clips vs other attachments
    // Photos and clips only. `audio/*` came off because voice notes are
    // RECORDED in the app, not picked off the disk, so dropping it costs the
    // feature nothing and removes a way to post arbitrary audio files.
    const fileInput = el('input', { type: 'file', accept: 'image/*,video/*', style: { display: 'none' } });
    const videoInput = el('input', { type: 'file', accept: 'video/*', style: { display: 'none' } });
    // Camera capture and documents need their own inputs: `capture` opens the
    // camera directly, and documents must not be filtered to media types.
    const cameraInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: { display: 'none' } });
    const galleryInput = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    // The document picker is gone. It carried no `accept` at all, so any file
    // type up to 20 MB could be posted into a chat — general file storage and
    // a way to pass executables around, with no product reason behind it.

    // Send any picked file, showing it optimistically first.
    async function sendPickedFile(f, type) {
      if (!f) return;
      // `accept` only filters what the picker SHOWS: the OS dialog offers "All
      // files" and a drag-and-drop ignores it outright. This is the rule, and
      // it is the one place every attachment path converges on.
      if (!/^(image|video)\//.test(f.type || '')) {
        toast('يمكنك إرسال الصور ومقاطع الفيديو فقط');
        return;
      }
      const isMedia = (type === 'image' || type === 'video');
      const temp = {
        from_user_id: myUserId || 'me',
        text: type === 'file' ? f.name : '',
        created_at: new Date().toISOString(),
        type,
        attachment_url: isMedia || type === 'file' ? URL.createObjectURL(f) : null,
      };
      appendMessage(temp); msgs.scrollTop = msgs.scrollHeight;
      if (window.API && typeof id === 'string' && id.length >= 30) {
        try { await window.API.sendMessage({ chatId: id, text: temp.text, type, file: f }); }
        catch (e) { toast('تعذر إرسال المرفق'); }
      }
    }

    cameraInput.addEventListener('change', () => { sendPickedFile(cameraInput.files[0], 'image'); cameraInput.value = ''; });
    galleryInput.addEventListener('change', () => { sendPickedFile(galleryInput.files[0], 'image'); galleryInput.value = ''; });


    // Attach > Location used to fire the current GPS fix straight into the
    // thread — no map, no confirmation, no way to send anywhere else. The
    // picker now chooses the point and this only does the sending.
    async function sendLocation(p) {
      if (!p) return;
      const link = locationLink(p.lat, p.lng, p.label);
      appendMessage({ from_user_id: myUserId || 'me', text: link, created_at: new Date().toISOString(), type: 'location' });
      msgs.scrollTop = msgs.scrollHeight;
      if (window.API && typeof id === 'string' && id.length >= 30) {
        try { await window.API.sendMessage({ chatId: id, text: link, type: 'location' }); }
        catch (e) { toast('تعذر إرسال الموقع'); }
      }
    }

    // WhatsApp-style attachment sheet. The paperclip used to jump straight
    // into the OS file browser with no choice of source.
    function openAttachSheet() {
      const items = [
        { k: 'camera',   l: 'الكاميرا',  icon: 'camera',    cls: 'cam',  act: () => cameraInput.click() },
        { k: 'gallery',  l: 'الصور',     icon: 'image',     cls: 'gal',  act: () => galleryInput.click() },
        { k: 'video',    l: 'فيديو',     icon: 'video',     cls: 'vid',  act: () => videoInput.click() },
        { k: 'location', l: 'الموقع',    icon: 'mapPin',    cls: 'loc',  act: () => openLocationPicker(sendLocation) },
      ];
      const grid = el('div', { class: 'attach-grid' });
      const sheet = el('div', { class: 'sheet attach-sheet' }, [
        el('div', { class: 'attach-title' }, 'إرفاق'),
        grid,
      ]);
      const close = modal(sheet);
      items.forEach(it => grid.appendChild(el('button', { class: 'attach-item', onclick: () => { close(); it.act(); } }, [
        el('span', { class: 'attach-icon ' + it.cls, html: icons[it.icon] || icons.paperclip }),
        el('span', { class: 'attach-label' }, it.l),
      ])));
      try { if (window.I18N) window.I18N.apply(sheet); } catch (e) {}
    }
    videoInput.addEventListener('change', async () => {
      const f = videoInput.files[0]; if (!f) return;
      const tempMsg = { from_user_id: myUserId || 'me', text: '', created_at: new Date().toISOString(), type: 'video', attachment_url: URL.createObjectURL(f) };
      appendMessage(tempMsg); msgs.scrollTop = msgs.scrollHeight;
      if (window.API && typeof id === 'string' && id.length >= 30) {
        try { await window.API.sendMessage({ chatId: id, text: '', type: 'video', file: f }); }
        catch (e) { toast('تعذر إرسال المقطع'); }
      }
      videoInput.value = '';
    });

    const inputField = el('input', { placeholder: 'اكتب رسالة...', id: 'chat-input-field' });

    // ─── Walkie-talkie: receive side only ───
    // The mic button no longer broadcasts while held — see the voice-note
    // recorder further down for why. This half stays put, so a client that
    // still streams into the channel is still heard.
    const talkingBanner = el('div', { style: { display: 'none', position: 'absolute', top: '0', left: '0', right: '0', background: 'var(--danger)', color: '#fff', textAlign: 'center', padding: '6px 10px', fontSize: '12.5px', fontWeight: 700, zIndex: '10' } });
    root.appendChild(talkingBanner);

    // Receiver side — play incoming audio chunks live + show "X talking" banner
    let receivedSeq = -1;
    let walkie = null;
    if (window.API && typeof id === 'string' && id.length >= 30) {
      walkie = window.API.openWalkieChannel(id, {
        onChunk: ({ data, mime, seq }) => {
          // Reconstruct blob from base64 and play immediately
          try {
            const bin = atob(data);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            const blob = new Blob([arr], { type: mime || 'audio/webm' });
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.play().catch(() => {}); // browsers may block autoplay; first user gesture unblocks
            audio.onended = () => URL.revokeObjectURL(url);
          } catch (e) { console.warn('chunk play:', e); }
        },
        onSpeakerChange: ({ isTalking, name }) => {
          if (isTalking) {
            talkingBanner.textContent = '🎙️ ' + (name || 'مستخدم') + ' يتحدث الآن...';
            talkingBanner.style.display = 'block';
          } else {
            talkingBanner.style.display = 'none';
          }
        },
      });
    }

    // ─── Voice notes: hold to record, slide to cancel, tap to lock ───────
    // The mic button used to be a live walkie-talkie: it streamed raw
    // MediaRecorder chunks to the other side while held and kept nothing.
    // That is why there was no timer, no level meter and nothing to review —
    // and it is also why "cancel" could never have been honest there, since
    // the audio had already left the device. It now records a voice note
    // locally, shows what the microphone is genuinely picking up, and sends
    // only when the user taps send.
    const VN_MAX_SECS   = 300;  // 5 min, then it stops itself
    const VN_MIN_MS     = 700;  // shorter than this is a mis-tap, not a note
    const VN_TAP_MS     = 260;  // a press shorter than this is a tap
    const VN_SLOP_PX    = 10;   // wobble that still counts as "did not move"
    const VN_CANCEL_PX  = 88;   // inline drag that aborts the recording
    const VN_LOCK_PX    = 56;   // upward drag that locks it hands-free

    // helpers.js is shared with every other screen, so the three icons only
    // this composer needs live here instead of being added to the global set.
    const vnIco = {
      stop:  '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>',
      pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1.4"/><rect x="14" y="4" width="4" height="16" rx="1.4"/></svg>',
      trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
    };

    // +1 when the inline axis runs left→right, -1 in RTL. Read live rather
    // than hardcoded: the language switch flips <html dir> at runtime, and
    // "slide left to cancel" in English has to become slide *right* in Arabic.
    function vnAxis() {
      try { return getComputedStyle(document.documentElement).direction === 'rtl' ? -1 : 1; }
      catch (e) { return 1; }
    }
    function vnFmt(s) {
      s = Math.max(0, Math.floor(s));
      return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }

    const micBtn = el('button', {
      class: 'icon-btn vn-mic', type: 'button', html: icons.mic,
      title: 'اضغط مطولًا للتسجيل، أو انقر للتسجيل بدون إمساك',
      'aria-label': 'تسجيل رسالة صوتية',
    });

    // ── recording bar (covers the composer while the mic is open) ──
    const recTime  = el('span', { class: 'vn-time', dir: 'ltr', role: 'timer' }, '0:00');
    const recWave  = el('canvas', { class: 'vn-wave', 'aria-hidden': 'true' });
    // The chevron points toward the inline start; app.css mirrors it in RTL.
    const recHint  = el('div', { class: 'vn-hint' }, [
      el('span', { class: 'vn-hint-chev', html: icons.chevL }),
      el('span', {}, 'اسحب للإلغاء'),
    ]);
    const recAbort = el('button', { class: 'vn-btn vn-btn-abort', type: 'button', hidden: true, html: icons.x, title: 'إلغاء', 'aria-label': 'إلغاء التسجيل' });
    const recStop  = el('button', { class: 'vn-btn vn-btn-stop', type: 'button', hidden: true, html: vnIco.stop, title: 'إيقاف', 'aria-label': 'إيقاف التسجيل' });
    const recBar   = el('div', { class: 'vn-bar', hidden: true }, [
      el('span', { class: 'vn-dot' }), recTime, recWave, recHint, recAbort, recStop,
    ]);

    // ── the lock affordance, floating just above the mic ──
    const lockPill = el('div', { class: 'vn-lock', hidden: true }, [
      el('span', { class: 'vn-lock-ico', html: icons.lock }),
      el('span', { class: 'vn-lock-up', html: icons.arrowUp }),
    ]);

    // ── playback preview (nothing is sent until send is tapped) ──
    const pvDel   = el('button', { class: 'vn-btn vn-btn-del', type: 'button', html: vnIco.trash, title: 'حذف', 'aria-label': 'حذف التسجيل' });
    const pvPlay  = el('button', { class: 'vn-btn vn-btn-play', type: 'button', html: icons.play, title: 'تشغيل', 'aria-label': 'تشغيل المعاينة' });
    const pvWave  = el('canvas', { class: 'vn-wave vn-wave-pv', 'aria-hidden': 'true' });
    const pvTime  = el('span', { class: 'vn-time', dir: 'ltr' }, '0:00');
    const pvSend  = el('button', { class: 'vn-btn vn-btn-send', type: 'button', html: icons.send, title: 'إرسال', 'aria-label': 'إرسال الرسالة الصوتية' });
    const previewBar = el('div', { class: 'vn-preview', hidden: true }, [pvDel, pvPlay, pvWave, pvTime, pvSend]);

    let vnStream = null, vnRec = null, vnChunks = [], vnMime = '';
    let vnCtx = null, vnAnalyser = null, vnBuf = null, vnRaf = 0;
    let vnTick = null, vnStartAt = 0;
    let vnPeaks = [], vnLive = [];                 // real amplitudes, not decoration
    let vnLocked = false, vnDiscard = false, vnStarting = false, vnAbandon = false;
    let vnHolding = false, vnPendingLock = false, vnPointerId = null;
    let vnPressX = 0, vnPressY = 0, vnPressAt = 0, vnMoved = false;
    let vnBlob = null, vnUrl = '', vnAudio = null, vnDur = 0, vnPlayRaf = 0;
    let vnColorsDirty = true, vnLiveColor = '#ef4444', vnPvColor = '#6c2bd9', vnPvDim = '#d4d4d8';
    // Cached: vnAxis() forces a style recalc, so it must not run per frame or
    // per pointermove. Refreshed on every state change via vnSyncColors().
    let vnRtl = vnAxis() < 0;
    function vnAx() { return vnRtl ? -1 : 1; }
    let vnPadEnd = '';   // room kept clear for the mic, measured not guessed

    // The mic keeps its place in the row while the bar is drawn over the rest
    // of the composer, so both the lock and the bar are placed from the mic's
    // real position. getBoundingClientRect is physical, hence the RTL branch.
    function vnPlaceOverlays() {
      try {
        const b = micBtn.getBoundingClientRect();
        const p = inputBar.getBoundingClientRect();
        if (!b.width || !p.width) return;
        const rtl = vnAxis() < 0;
        const lockOff = (rtl ? (p.right - b.right) : (b.left - p.left)) + b.width / 2 - 19;
        lockPill.style.insetInlineStart = Math.max(4, lockOff).toFixed(1) + 'px';
        vnPadEnd = Math.max(8, (rtl ? (b.right - p.left) : (p.right - b.left)) + 8).toFixed(0) + 'px';
      } catch (e) { vnPadEnd = ''; }
    }

    function vnSyncColors() {
      // Read once per state change, not per frame — and only colours, which
      // are not transitioned here, so there is no pre-transition value to read.
      try {
        const a = getComputedStyle(recWave);
        vnLiveColor = a.color || vnLiveColor;
        const b = getComputedStyle(pvWave);
        vnPvColor = b.color || vnPvColor;
        vnPvDim = (b.getPropertyValue('--vn-dim') || '').trim() || vnPvDim;
      } catch (e) {}
      vnRtl = vnAxis() < 0;
      vnColorsDirty = false;
    }

    function vnFitCanvas(cv) {
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(cv.clientWidth * dpr));
      const h = Math.max(1, Math.round(cv.clientHeight * dpr));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    }

    // Live meter: newest sample enters at the inline start and scrolls away.
    function vnDrawLive() {
      const g = recWave.getContext && recWave.getContext('2d');
      if (!g) return;
      if (vnColorsDirty) vnSyncColors();
      vnFitCanvas(recWave);
      const W = recWave.width, H = recWave.height;
      g.clearRect(0, 0, W, H);
      const rtl = vnRtl;
      const step = Math.max(3, Math.round(W / 84));
      const bw = Math.max(2, step - Math.max(1, Math.round(step / 3)));
      g.fillStyle = vnLiveColor;
      const n = Math.min(vnLive.length, Math.floor(W / step));
      for (let i = 0; i < n; i++) {
        const v = vnLive[vnLive.length - 1 - i];
        const x = rtl ? W - (i + 1) * step : i * step;
        // A floor of 2px, never a floor that moves: a silent room draws a
        // flat line, which is the whole point of metering the real stream.
        const h = Math.max(2, v * (H - 4));
        g.fillRect(x + (step - bw) / 2, (H - h) / 2, bw, h);
      }
    }

    // Static waveform for the preview, filled up to `progress` (0..1).
    function vnDrawPeaks(progress) {
      const g = pvWave.getContext && pvWave.getContext('2d');
      if (!g) return;
      if (vnColorsDirty) vnSyncColors();
      vnFitCanvas(pvWave);
      const W = pvWave.width, H = pvWave.height;
      g.clearRect(0, 0, W, H);
      const rtl = vnRtl;
      const step = Math.max(3, Math.round(W / 56));
      const bars = Math.max(1, Math.floor(W / step));
      const bw = Math.max(2, step - Math.max(1, Math.round(step / 3)));
      for (let i = 0; i < bars; i++) {
        let peak = 0;
        if (vnPeaks.length) {
          const from = Math.floor(i * vnPeaks.length / bars);
          const to = Math.max(from + 1, Math.floor((i + 1) * vnPeaks.length / bars));
          for (let k = from; k < to && k < vnPeaks.length; k++) peak = Math.max(peak, vnPeaks[k]);
        }
        const h = Math.max(2, peak * (H - 4));
        const x = rtl ? W - (i + 1) * step : i * step;
        g.fillStyle = ((i + 1) / bars) <= progress ? vnPvColor : vnPvDim;
        g.fillRect(x + (step - bw) / 2, (H - h) / 2, bw, h);
      }
    }

    function vnPickMime() {
      const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
      for (const m of cands) {
        try { if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m; }
        catch (e) {}
      }
      return '';
    }

    // Analyser on the live MediaStream. It is never connected to the audio
    // destination — that would loop the mic back out of the speaker.
    function vnMeterStart(stream) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;                    // no meter; recording still works
      try {
        vnCtx = new AC();
        if (vnCtx.state === 'suspended') { try { vnCtx.resume(); } catch (e) {} }
        vnAnalyser = vnCtx.createAnalyser();
        vnAnalyser.fftSize = 1024;
        vnAnalyser.smoothingTimeConstant = 0.5;
        vnCtx.createMediaStreamSource(stream).connect(vnAnalyser);
        vnBuf = new Uint8Array(vnAnalyser.fftSize);
      } catch (e) { vnCtx = null; vnAnalyser = null; vnBuf = null; return; }
      let lastPeak = 0;
      const loop = () => {
        vnRaf = requestAnimationFrame(loop);
        if (!vnAnalyser || !vnBuf) return;
        vnAnalyser.getByteTimeDomainData(vnBuf);
        let sum = 0;
        for (let i = 0; i < vnBuf.length; i++) { const v = (vnBuf[i] - 128) / 128; sum += v * v; }
        const level = Math.min(1, Math.sqrt(sum / vnBuf.length) * 3.2);   // RMS of real samples
        vnLive.push(level);
        if (vnLive.length > 120) vnLive.shift();
        const now = (window.performance && performance.now()) || Date.now();
        if (now - lastPeak >= 70) { lastPeak = now; vnPeaks.push(level); }
        vnDrawLive();
      };
      vnRaf = requestAnimationFrame(loop);
    }

    // A live track keeps the system microphone indicator lit and keeps
    // draining the battery, so nothing may outlive the recording.
    function vnReleaseMic() {
      if (vnTick) { clearInterval(vnTick); vnTick = null; }
      if (vnRaf) { cancelAnimationFrame(vnRaf); vnRaf = 0; }
      if (vnRec) {
        try {
          vnRec.ondataavailable = null; vnRec.onstop = null;
          if (vnRec.state !== 'inactive') vnRec.stop();
        } catch (e) {}
        vnRec = null;
      }
      if (vnStream) {
        try { vnStream.getTracks().forEach(t => t.stop()); } catch (e) {}
        vnStream = null;
      }
      if (vnAnalyser) { try { vnAnalyser.disconnect(); } catch (e) {} vnAnalyser = null; }
      if (vnCtx) { try { vnCtx.close(); } catch (e) {} vnCtx = null; }
      vnBuf = null;
    }

    function vnStopPlayback(resetPos) {
      if (vnPlayRaf) { cancelAnimationFrame(vnPlayRaf); vnPlayRaf = 0; }
      if (vnAudio) {
        try { vnAudio.pause(); } catch (e) {}
        if (resetPos) { try { vnAudio.currentTime = 0; } catch (e) {} }
      }
      pvPlay.innerHTML = icons.play;
      pvPlay.title = 'تشغيل';
      pvPlay.setAttribute('aria-label', 'تشغيل المعاينة');
    }

    function vnDropPreview() {
      vnStopPlayback(true);
      if (vnAudio) { try { vnAudio.removeAttribute('src'); vnAudio.load(); } catch (e) {} vnAudio = null; }
      if (vnUrl) { try { URL.revokeObjectURL(vnUrl); } catch (e) {} vnUrl = ''; }
      vnBlob = null; vnDur = 0;
    }

    function vnReset() {
      vnReleaseMic();
      vnDropPreview();
      vnPeaks = []; vnLive = [];
      vnLocked = false; vnHolding = false; vnPendingLock = false; vnDiscard = false;
      recBar.hidden = true; previewBar.hidden = true; lockPill.hidden = true;
      recAbort.hidden = true; recStop.hidden = true; recHint.hidden = false;
      recBar.style.paddingInlineEnd = '';
      lockPill.classList.remove('armed');
      lockPill.style.transform = '';
      micBtn.hidden = false;
      micBtn.style.transform = '';
      micBtn.classList.remove('vn-recording', 'vn-cancelling');
      recHint.style.transform = ''; recHint.style.opacity = '';
      recTime.textContent = '0:00';
      inputBar.classList.remove('vn-active', 'vn-locked');
    }

    function vnSetLocked(on) {
      vnLocked = !!on;
      inputBar.classList.toggle('vn-locked', vnLocked);
      micBtn.classList.toggle('vn-locked', vnLocked);
      // Hands-free: the drag targets go away and explicit buttons take over.
      lockPill.hidden = vnLocked;
      recHint.hidden = vnLocked;
      recAbort.hidden = !vnLocked;
      recStop.hidden = !vnLocked;
      micBtn.hidden = vnLocked;
      micBtn.style.transform = '';
      // Hands-free frees up the space the mic was holding.
      recBar.style.paddingInlineEnd = vnLocked ? '' : vnPadEnd;
      vnColorsDirty = true;
    }

    async function vnStart(lockNow) {
      if (vnStarting || vnRec || !previewBar.hidden) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
        toast('التسجيل الصوتي غير مدعوم على هذا الجهاز'); return;
      }
      vnStarting = true; vnAbandon = false; vnDiscard = false; vnPendingLock = !!lockNow;
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (e) {
        // A refusal must never leave a bar on screen pretending to record.
        vnStarting = false;
        vnReset();
        const n = (e && e.name) || '';
        if (n === 'NotAllowedError' || n === 'PermissionDeniedError' || n === 'SecurityError') {
          toast('لم يتم السماح بالوصول إلى الميكروفون — فعّل الإذن من إعدادات التطبيق ثم أعد المحاولة');
        } else if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError') {
          toast('لا يوجد ميكروفون متاح على هذا الجهاز');
        } else if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') {
          toast('الميكروفون مستخدم من تطبيق آخر');
        } else {
          toast('تعذر بدء التسجيل');
        }
        return;
      }
      vnStarting = false;
      // The permission sheet can outlive the press. If the finger is already
      // up and this was a hold rather than a tap, no recording was asked for —
      // hand the microphone straight back instead of opening one in silence.
      if (vnAbandon) { try { stream.getTracks().forEach(t => t.stop()); } catch (e) {} return; }
      vnStream = stream;
      vnMime = vnPickMime();
      try {
        vnRec = new MediaRecorder(stream, vnMime ? { mimeType: vnMime, audioBitsPerSecond: 64000 } : undefined);
      } catch (e) {
        vnReleaseMic(); vnReset();
        toast('المتصفح لا يدعم تسجيل الصوت'); return;
      }
      vnChunks = []; vnPeaks = []; vnLive = []; vnDiscard = false;
      vnRec.ondataavailable = (e) => { if (e.data && e.data.size) vnChunks.push(e.data); };
      vnRec.onstop = vnOnStop;
      try { vnRec.start(); }
      catch (e) { vnReleaseMic(); vnReset(); toast('تعذر بدء التسجيل'); return; }

      vnStartAt = Date.now();
      vnRtl = vnAxis() < 0;
      vnColorsDirty = true;
      recTime.textContent = '0:00';
      vnPlaceOverlays();
      recBar.hidden = false;
      lockPill.hidden = false;
      inputBar.classList.add('vn-active');
      micBtn.classList.add('vn-recording');
      vnMeterStart(stream);
      vnSetLocked(vnPendingLock);
      vnTick = setInterval(() => {
        const s = (Date.now() - vnStartAt) / 1000;
        recTime.textContent = vnFmt(s);
        if (s >= VN_MAX_SECS) { toast('تم بلوغ الحد الأقصى لمدة التسجيل'); vnStop(); }
      }, 200);
    }

    function vnStop() {
      // A cancel already in flight owns the recorder; a stray pointerup after
      // it must not turn the discarded take back into a preview.
      if (vnDiscard) return;
      if (vnStarting) { vnAbandon = true; vnDiscard = true; vnReset(); return; }
      if (!vnRec) { vnReset(); return; }
      // Only the timer and the meter stop here; the recorder still has to emit
      // its last chunk, so the microphone is released inside onstop.
      if (vnTick) { clearInterval(vnTick); vnTick = null; }
      if (vnRaf) { cancelAnimationFrame(vnRaf); vnRaf = 0; }
      if (vnRec.state === 'inactive') { vnOnStop(); return; }
      try { vnRec.stop(); } catch (e) { vnReset(); }
    }

    function vnCancel(msg) {
      vnHolding = false;   // the gesture is over the moment the threshold is crossed
      vnDiscard = true;
      if (vnStarting) { vnAbandon = true; vnReset(); if (msg) toast(msg); return; }
      if (vnTick) { clearInterval(vnTick); vnTick = null; }
      if (vnRaf) { cancelAnimationFrame(vnRaf); vnRaf = 0; }
      if (vnRec && vnRec.state !== 'inactive') { try { vnRec.stop(); } catch (e) { vnReset(); } }
      else { vnReset(); }
      if (msg) toast(msg);
    }

    function vnOnStop() {
      const heldMs = Date.now() - vnStartAt;
      const chunks = vnChunks.slice();
      const peaks = vnPeaks.slice();
      const mime = (vnRec && vnRec.mimeType) || vnMime || 'audio/webm';
      const discard = vnDiscard;
      vnReleaseMic();
      if (discard) { vnReset(); return; }
      if (heldMs < VN_MIN_MS || !chunks.length) {
        vnReset();
        toast('اضغط مطولًا للتسجيل');
        return;
      }
      vnBlob = new Blob(chunks, { type: mime });
      vnPeaks = peaks;
      vnDur = heldMs / 1000;
      vnShowPreview();
    }

    function vnShowPreview() {
      recBar.hidden = true;
      lockPill.hidden = true;
      micBtn.hidden = true;
      previewBar.hidden = false;
      inputBar.classList.add('vn-active');
      inputBar.classList.remove('vn-locked');
      vnColorsDirty = true;
      vnUrl = URL.createObjectURL(vnBlob);
      vnAudio = new Audio();
      vnAudio.preload = 'metadata';
      vnAudio.src = vnUrl;
      pvTime.textContent = vnFmt(vnDur);
      vnAudio.addEventListener('loadedmetadata', () => {
        // A streamed webm often reports Infinity, so the wall clock stays the
        // source of truth unless the file gives a real number.
        const d = vnAudio.duration;
        if (isFinite(d) && d > 0) { vnDur = d; if (vnAudio.paused) pvTime.textContent = vnFmt(vnDur); }
      });
      vnAudio.addEventListener('ended', () => { vnStopPlayback(true); vnDrawPeaks(0); pvTime.textContent = vnFmt(vnDur); });
      vnAudio.addEventListener('error', () => { toast('تعذر تشغيل التسجيل'); });
      vnDrawPeaks(0);
    }

    function vnPlayLoop() {
      vnPlayRaf = requestAnimationFrame(vnPlayLoop);
      if (!vnAudio) return;
      const t = vnAudio.currentTime || 0;
      pvTime.textContent = vnFmt(t);
      vnDrawPeaks(vnDur ? Math.min(1, t / vnDur) : 0);
    }

    function vnTogglePlay() {
      if (!vnAudio) return;
      if (vnAudio.paused) {
        const p = vnAudio.play();
        const started = () => {
          pvPlay.innerHTML = vnIco.pause;
          pvPlay.title = 'إيقاف مؤقت';
          pvPlay.setAttribute('aria-label', 'إيقاف المعاينة مؤقتًا');
          if (!vnPlayRaf) vnPlayLoop();
        };
        if (p && p.then) p.then(started).catch(() => toast('تعذر تشغيل التسجيل'));
        else started();
      } else {
        vnStopPlayback(false);   // paused: the clock keeps the position it reached
      }
    }

    async function vnSend() {
      if (!vnBlob) return;
      const blob = vnBlob;
      const mime = blob.type || 'audio/webm';
      const ext = mime.indexOf('mp4') >= 0 ? 'm4a' : mime.indexOf('ogg') >= 0 ? 'ogg' : 'webm';
      const fname = 'voice-' + Date.now() + '.' + ext;
      // sendMessage() derives the storage extension from file.name, so a bare
      // Blob would be uploaded as ".bin" and would never play back.
      let file;
      try { file = new File([blob], fname, { type: mime }); }
      catch (e) { file = blob; try { file.name = fname; } catch (e2) {} }
      const localUrl = URL.createObjectURL(blob);
      appendMessage({
        from_user_id: myUserId || 'me', text: '', created_at: new Date().toISOString(),
        type: 'voice', attachment_url: localUrl,
      });
      msgs.scrollTop = msgs.scrollHeight;
      vnReset();                        // frees the preview URL, not localUrl
      if (window.API && isRealId(id)) {
        try { await window.API.sendMessage({ chatId: id, text: '', type: 'voice', file }); }
        catch (e) { toast((e && e.message) || 'تعذر إرسال الرسالة الصوتية'); }
      }
    }

    recStop.addEventListener('click', () => vnStop());
    recAbort.addEventListener('click', () => vnCancel('تم إلغاء التسجيل'));
    pvPlay.addEventListener('click', vnTogglePlay);
    pvDel.addEventListener('click', () => { vnReset(); toast('تم حذف التسجيل'); });
    pvSend.addEventListener('click', () => { vnSend(); });

    // ── the press gesture ──
    // Held: records while held, released to review. Dragged toward the inline
    // start: cancelled. Dragged up onto the lock: hands-free. Tapped: starts
    // hands-free straight away, so a plain tap is never a no-op.
    function vnMoveTo(inlineD, upD) {
      const px = -inlineD * vnAx();
      micBtn.style.transform = 'translate(' + px.toFixed(1) + 'px, ' + (-upD).toFixed(1) + 'px)';
      recHint.style.transform = 'translateX(' + (px * 0.6).toFixed(1) + 'px)';
      recHint.style.opacity = String(Math.max(0, 1 - inlineD / VN_CANCEL_PX));
      micBtn.classList.toggle('vn-cancelling', inlineD >= VN_CANCEL_PX * 0.6);
    }

    function vnOnDown(e) {
      if (vnLocked || !previewBar.hidden) return;
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      vnPressX = e.clientX; vnPressY = e.clientY;
      vnPressAt = Date.now(); vnMoved = false; vnHolding = true;
      vnPointerId = (e.pointerId != null) ? e.pointerId : null;
      if (vnPointerId != null && micBtn.setPointerCapture) {
        try { micBtn.setPointerCapture(vnPointerId); } catch (er) {}
      }
      vnStart(false);
    }

    function vnOnMove(e) {
      if (!vnHolding) return;
      const inlineD = (vnPressX - e.clientX) * vnAx();     // + = toward inline start
      const upD = vnPressY - e.clientY;                    // + = upward
      if (Math.abs(inlineD) > VN_SLOP_PX || Math.abs(upD) > VN_SLOP_PX) vnMoved = true;
      if (!vnRec) return;                                  // nothing to steer yet
      if (upD > VN_SLOP_PX && upD > inlineD) {
        const lift = Math.min(upD, VN_LOCK_PX);
        lockPill.style.transform = 'translateY(' + (-(lift / VN_LOCK_PX) * 10).toFixed(1) + 'px)';
        lockPill.classList.toggle('armed', upD >= VN_LOCK_PX);
        vnMoveTo(0, lift);
      } else {
        lockPill.classList.remove('armed');
        lockPill.style.transform = '';
        const d = Math.max(0, inlineD);
        vnMoveTo(d, 0);
        if (d >= VN_CANCEL_PX) vnCancel('تم إلغاء التسجيل');
      }
    }

    function vnOnUp() {
      if (!vnHolding) return;
      vnHolding = false;
      if (vnPointerId != null && micBtn.releasePointerCapture) {
        try { micBtn.releasePointerCapture(vnPointerId); } catch (er) {}
      }
      vnPointerId = null;
      const armed = lockPill.classList.contains('armed');
      const quickTap = (Date.now() - vnPressAt) < VN_TAP_MS && !vnMoved;
      lockPill.classList.remove('armed');
      lockPill.style.transform = '';
      vnMoveTo(0, 0);
      micBtn.style.transform = '';
      if (armed || quickTap) {
        vnPendingLock = true;               // applied when the stream arrives
        if (vnRec) vnSetLocked(true);
        return;
      }
      if (vnStarting) { vnAbandon = true; return; }   // permission sheet outlived the press
      vnStop();
    }

    if (window.PointerEvent) {
      micBtn.addEventListener('pointerdown', vnOnDown);
      window.addEventListener('pointermove', vnOnMove);
      window.addEventListener('pointerup', vnOnUp);
      window.addEventListener('pointercancel', vnOnUp);
    } else {
      // No pointer events: fall back to tap to start hands-free, tap to stop.
      micBtn.addEventListener('click', () => {
        if (vnRec || vnStarting) vnStop(); else vnStart(true);
      });
    }

    // Leaving the chat has to hand the microphone back even mid-recording,
    // and the window-level listeners must not outlive this view.
    function vnDestroy() {
      vnDiscard = true; vnAbandon = true; vnHolding = false;
      vnReleaseMic();
      vnDropPreview();
      window.removeEventListener('pointermove', vnOnMove);
      window.removeEventListener('pointerup', vnOnUp);
      window.removeEventListener('pointercancel', vnOnUp);
    }
    window.addEventListener('hashchange', vnDestroy, { once: true });
    window.addEventListener('pagehide', vnDestroy, { once: true });

    // Cleanup walkie channel when leaving chat
    window.addEventListener('hashchange', () => { if (walkie) try { walkie.close(); } catch (e) {} }, { once: true });

    async function handleSend() {
      const text = inputField.value.trim();
      const file = fileInput.files[0];
      if (!text && !file) return;
      const tempMsg = {
        from_user_id: myUserId || 'me',
        text,
        created_at: new Date().toISOString(),
        type: file ? (file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'voice') : 'text',
        attachment_url: file ? URL.createObjectURL(file) : null
      };
      // Captured before the bar is cleared, so the send below still knows
      // what this was answering.
      const replyingTo = replyTo;
      if (replyingTo) {
        tempMsg.reply_to_id = replyingTo.id;
        tempMsg.reply_to = replyingTo;
      }
      setReplyTo(null);

      // Drawn straight away so the message appears without waiting on the
      // network, and recorded so the realtime echo of this same row adopts
      // this bubble instead of adding a second one.
      const tempNode = appendMessage(tempMsg);
      const tracked = { text, type: tempMsg.type, node: tempNode };
      pendingSends.push(tracked);
      inputField.value = '';
      msgs.scrollTop = msgs.scrollHeight;

      // Keep the demo thread in memory so it survives navigating away
      if (mockChat && mockChat.messages) {
        mockChat.messages.push({ id: 'm' + Date.now(), from: 'me', text, time: 'الآن' });
        mockChat.last = text;
      }

      if (window.API && isRealId(id)) {
        try {
          const saved = await window.API.sendMessage({
            chatId: id, text, type: tempMsg.type, file,
            replyToId: replyingTo ? replyingTo.id : null,
          });
          fileInput.value = '';
          // Claim the id now. If the echo has not arrived yet it will be
          // ignored on arrival; if it beat us here the bubble was already
          // adopted and this is a no-op.
          if (saved && saved.id) {
            renderedIds.add(saved.id);
            const i = pendingSends.indexOf(tracked);
            if (i !== -1) pendingSends.splice(i, 1);
            if (tempNode) tempNode.dataset.msgId = saved.id;
          }
        }
        catch (e) {
          const i = pendingSends.indexOf(tracked);
          if (i !== -1) pendingSends.splice(i, 1);
          toast('تعذر الإرسال');
        }
      }
      // NOTE: there used to be a fake auto-reply here that invented a
      // random Arabic message from the other person ~1.2s after every send.
      // Removed — it fabricated messages the other user never wrote.
    }

    inputField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSend();
      }
    });

    const sendBtn = el('button', {
      class: 'comment-send-btn',
      type: 'button',
      html: icons.send,
      title: 'إرسال',
      onclick: handleSend
    });

    // No in-app emoji picker: the system keyboard already has one, and a
    // second grid only competed with it for the same job while taking a slot
    // in a row that was already tight. Removed at the user's request.
    const inputBar = el('div', { class: 'chat-input' }, [
      el('button', { class: 'icon-btn', html: icons.paperclip, onclick: () => openAttachSheet(), title: 'إرفاق' }),
      fileInput, videoInput, cameraInput, galleryInput,
      inputField,
      // One gallery button rather than separate photo and video ones. The
      // picker already accepts both, so the split only cost a slot in a row
      // that was already overflowing and clipping the send button.
      el('button', { class: 'icon-btn', html: icons.image, onclick: () => fileInput.click(), title: 'صورة أو فيديو' }),
      // The mic sits next to send, at the inline end of the row. It used to be
      // three buttons further in, which left the recording bar barely 30px of
      // room for its level meter on a 360px screen.
      micBtn,
      sendBtn,
      // Absolutely positioned over the row, so the composer keeps its layout
      // (and the mic keeps its place) while a recording is in progress.
      recBar, previewBar, lockPill,
    ]);
    // ── Reply composer bar ──
    // Shows what you are replying to, above the field, until you send or
    // dismiss it. Sits outside inputBar so it spans the full width.
    const replyName = el('div', { class: 'reply-name' }, '');
    const replyText = el('div', { class: 'reply-text' }, '');
    const replyBar = el('div', { class: 'reply-bar', hidden: true }, [
      el('div', { class: 'reply-body' }, [replyName, replyText]),
      el('button', {
        class: 'icon-btn', type: 'button', title: 'إلغاء الرد',
        html: icons.x, onclick: () => setReplyTo(null),
      }),
    ]);

    function msgPreviewText(m) {
      if (!m) return '';
      if (m.type === 'image') return '📷 صورة';
      if (m.type === 'video') return '🎥 فيديو';
      if (m.type === 'voice') return '🎤 رسالة صوتية';
      if (m.type === 'file') return '📎 ملف';
      if (m.type === 'location') return '📍 موقع';
      return (m.text || '').slice(0, 80);
    }

    function setReplyTo(m) {
      replyTo = m || null;
      if (!replyTo) { replyBar.hidden = true; return; }
      replyBar.hidden = false;
      const mine = replyTo.from_user_id === myUserId;
      replyName.textContent = mine ? 'ردًا على نفسك' : ('ردًا على ' + ((replyTo.from && replyTo.from.name) || (chatInfo && chatInfo.title) || ''));
      replyText.textContent = msgPreviewText(replyTo);
      try { if (window.I18N) window.I18N.apply(replyBar); } catch (e) {}
      inputField.focus();
    }

    // ── Message request bar ──
    // Replaces the composer while this is an unaccepted request, so you
    // decide about the person before you can be drawn into a conversation.
    // Shown only once fetchChats confirms it — never guessed at.
    const requestBar = el('div', { class: 'request-bar', hidden: true }, [
      el('p', { class: 'rq-note' }, 'هذا الشخص لا تتابعه. هل تريد قبول رسالته؟'),
      el('div', { class: 'rq-actions' }, [
        el('button', { class: 'btn btn-secondary', onclick: async () => {
          try {
            await window.API.declineChatRequest(id);
            toast('تم حذف الطلب');
            go('/inbox');
          } catch (e) { toast('تعذر الحذف'); }
        } }, 'حذف'),
        el('button', { class: 'btn', onclick: async () => {
          try {
            await window.API.acceptChatRequest(id);
            requestBar.hidden = true;
            inputBar.hidden = false;
            toast('تم قبول الطلب');
          } catch (e) { toast('تعذر القبول'); }
        } }, 'قبول'),
      ]),
    ]);

    root.appendChild(replyBar);
    root.appendChild(requestBar);
    root.appendChild(inputBar);

    // Ask whether this particular thread is still an unaccepted request.
    (async () => {
      try {
        if (!window.API || !isRealId(id)) return;
        const chats = await window.API.fetchChats();
        const mine = (chats || []).find(ch => ch.id === id);
        if (mine && mine.is_request) {
          requestBar.hidden = false;
          inputBar.hidden = true;
          replyBar.hidden = true;
          try { if (window.I18N) window.I18N.apply(requestBar); } catch (e) {}
        }
      } catch (e) { console.warn('request state:', e); }
    })();

    // ── Keep the composer above the keyboard ──
    // The layout is a flex column at height 100%, which relies entirely on
    // the Capacitor keyboard plugin resizing the body. That resize arrives
    // late on some Android keyboards and not at all for floating or split
    // ones, and when it does not the composer stays behind the keyboard —
    // which is why this only happened sometimes. visualViewport reports the
    // genuinely usable area in every one of those cases, so the height is
    // driven from that rather than from trusting the resize.
    (function keepComposerAboveKeyboard() {
      const vv = window.visualViewport;
      if (!vv) return; // very old webview: fall back to the plugin's resize
      let pending = null;
      function apply() {
        pending = null;
        const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        root.style.setProperty('--kb', covered + 'px');
        // A threshold, because the URL bar collapsing also changes the
        // viewport by a few dozen pixels and is not a keyboard.
        const open = covered > 80;
        root.classList.toggle('kb-open', open);
        if (open) msgs.scrollTop = msgs.scrollHeight;
      }
      const onChange = () => { if (pending == null) pending = requestAnimationFrame(apply); };
      vv.addEventListener('resize', onChange);
      vv.addEventListener('scroll', onChange);
      apply();
      window.addEventListener('hashchange', () => {
        vv.removeEventListener('resize', onChange);
        vv.removeEventListener('scroll', onChange);
      }, { once: true });
    })();

    // The keyboard animation finishes after focus fires, so the scroll has to
    // wait for it or it lands on the pre-keyboard height.
    inputField.addEventListener('focus', () => {
      setTimeout(() => { msgs.scrollTop = msgs.scrollHeight; }, 300);
    });

    // Stop subscription when leaving
    window.addEventListener('hashchange', () => { if (unsub) try { unsub(); } catch (e) {} }, { once: true });
    setTimeout(() => { msgs.scrollTop = msgs.scrollHeight; }, 0);
    return root;
  };

  // ===== Profile =====
  // An empty shell to render while the real profile loads. Anything with a
  // value here would be shown as fact for a moment, so it all stays blank.
  function blankProfile(id) {
    return { id: id || 'me', name: '', handle: '', avatar: '', bio: '',
             followers: 0, following: 0, likes: 0, verified: false };
  }

  // Last known profile, so a return visit paints immediately instead of
  // showing a skeleton for the better part of a second. Keyed by user id so
  // one account can never show another's details, and cleared on sign-out.
  const PROFILE_CACHE_KEY = 'tt-profile-cache';
  function readProfileCache(userId) {
    try {
      const raw = JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY) || 'null');
      return raw && raw.uid === userId ? raw.profile : null;
    } catch (e) { return null; }
  }
  function writeProfileCache(userId, profile) {
    try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ uid: userId, profile })); }
    catch (e) { /* private mode or full quota - the cache is optional */ }
  }
  function clearProfileCache() {
    try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch (e) {}
  }
  window.clearProfileCache = clearProfileCache;

  function shapeProfile(p) {
    return {
      id: 'me',
      name: p.name || 'أنت',
      handle: p.handle ? '@' + p.handle : '@me',
      avatar: p.avatar_url || '',
      bio: p.bio || '',
      followers: p.followers_count || 0,
      following: p.following_count || 0,
      likes: p.likes_count || 0,
      verified: p.verified,
      is_private: p.is_private,
      link: p.link,
    };
  }

  V.profile = () => {
    bottomNav('profile');

    // getSession() reads the stored session and returns in about 0ms;
    // getUser() costs a round trip (~400ms) to re-validate the same token,
    // which is not worth paying just to learn our own id.
    let uid = null;
    try {
      const raw = JSON.parse(localStorage.getItem('tt-auth') || 'null');
      uid = raw && raw.user && raw.user.id;
    } catch (e) {}

    const cached = uid ? readProfileCache(uid) : null;
    const seed = DEMO ? DB.me : (cached || blankProfile('me'));
    const root = _renderProfile(seed, true);
    // A cached profile is real data, just possibly a few seconds stale, so it
    // does not get the skeleton treatment.
    if (!DEMO && !cached) root.classList.add('profile-loading');

    (async () => {
      try {
        const session = await window.SB.getSession();
        const userId = (session && session.user && session.user.id) || null;
        if (!userId) { root.classList.remove('profile-loading'); return; }

        // Profile and videos no longer wait for each other.
        const [p, videos] = await Promise.all([
          window.SB.getProfile(userId).catch(() => null),
          window.API ? window.API.fetchUserVideos(userId).catch(() => []) : Promise.resolve([]),
        ]);
        if (!p) { root.classList.remove('profile-loading'); return; }

        const real = shapeProfile(p);
        // There is no videos_count column, so the figure comes from the list
        // we have just fetched anyway rather than costing a second query.
        real.videos_count = videos.length;
        writeProfileCache(userId, real);
        Object.assign(DB.me, real);

        const fresh = _renderProfile(DB.me, true);
        if (videos.length) {
          const grid = fresh.querySelector('.video-grid');
          if (grid) {
            grid.innerHTML = '';
            videos.forEach((v, i) => grid.appendChild(createVideoCard(v, i, () => go('/home'))));
          }
        }
        root.replaceWith(fresh);
      } catch (e) {
        console.warn('profile load:', e);
        root.classList.remove('profile-loading');
      }
    })();
    return root;
  };

  V.userProfile = (params) => {
    hideNav();
    // Blank placeholder while the real profile loads (demo data only fills
    // this in when demo mode is on).
    const match = DEMO && DB.users ? DB.users.find(x => x.id === params.id) : null;
    const placeholder = match || blankProfile(params.id);
    const root = _renderProfile(placeholder, false);
    if (!match) root.classList.add('profile-loading');
    (async () => {
      try {
        if (!window.API) return;
        const p = await window.API.fetchProfile(params.id);
        if (!p) { root.classList.remove('profile-loading'); return; }
        // is_private was being dropped here. _renderProfile has always drawn a
        // lock beside the handle for a private account, but the flag never
        // reached it, so every profile looked public and the only way to find
        // out otherwise was to tap Follow and get "request sent" back.
        const u = { id: p.id, name: p.name, handle: '@' + (p.handle || ''), avatar: p.avatar_url || '', bio: p.bio || '',
                    followers: p.followers_count, following: p.following_count, likes: p.likes_count, verified: p.verified,
                    is_private: p.is_private, link: p.link };
        const fresh = _renderProfile(u, false);
        // Async: load real videos + follow state
        const [videos, isFollowing, hasRequested] = await Promise.all([
          window.API.fetchUserVideos(p.id).catch(() => []),
          window.API.isFollowing(p.id).catch(() => false),
          window.API.hasRequestedFollow(p.id).catch(() => false),
        ]);
        const followBtn = fresh.querySelector('.profile-actions button:first-child');
        if (followBtn) {
          const FOLLOW = 'متابعة', FOLLOWING = 'تتم المتابعة', REQUESTED = 'تم الطلب';
          let state = isFollowing ? FOLLOWING : (hasRequested ? REQUESTED : FOLLOW);

          // The follower total is the second stat. Following someone changed
          // the button but left this number untouched, so the profile went on
          // claiming the old count until the screen was reloaded.
          const followersNum = fresh.querySelectorAll('.profile-stats .profile-stat')[1];
          const followersEl = followersNum ? followersNum.querySelector('.n') : null;
          let followers = Number(p.followers_count) || 0;
          const paintFollowers = () => { if (followersEl) followersEl.textContent = fmt(followers); };

          const paint = () => {
            followBtn.textContent = state;
            followBtn.classList.toggle('requested', state === REQUESTED);
            followBtn.classList.toggle('following', state === FOLLOWING);
            try { if (window.I18N) window.I18N.apply(followBtn); } catch (e) {}
          };
          paint();

          followBtn.onclick = async () => {
            const prev = state, prevFollowers = followers;
            followBtn.disabled = true;
            try {
              if (prev === FOLLOWING) {
                await window.API.unfollow(p.id);
                state = FOLLOW; followers = Math.max(0, followers - 1);
              } else if (prev === REQUESTED) {
                // A pending request was never counted, so cancelling it must
                // not decrement anything.
                await window.API.cancelFollowRequest(p.id);
                state = FOLLOW;
              } else {
                const r = await window.API.follow(p.id);
                state = r === 'requested' ? REQUESTED : FOLLOWING;
                // A request is not a follow yet — only a real follow counts.
                if (r === 'requested') toast('تم إرسال طلب المتابعة');
                else followers += 1;
              }
              paint(); paintFollowers();
              // The counter is maintained by a database trigger. Re-read it so
              // the screen ends up on the true value rather than our guess.
              window.API.fetchProfile(p.id)
                .then(fp => { if (fp && typeof fp.followers_count === 'number') { followers = fp.followers_count; paintFollowers(); } })
                .catch(() => {});
            } catch (e) {
              state = prev; followers = prevFollowers;
              paint(); paintFollowers();
              toast(friendlyError(e, 'تعذر التحديث'));
            }
            followBtn.disabled = false;
          };
        }
        const messageBtn = fresh.querySelectorAll('.profile-actions button')[1];
        if (messageBtn) messageBtn.onclick = async () => {
          try {
            // Respect their "who can message me" setting instead of opening a
            // chat that the database would then refuse to accept messages in.
            if (!(await window.API.canMessage(p.id))) { toast('لا يمكنك مراسلة هذا المستخدم'); return; }
            const id = await window.API.openOrCreateDm(p.id);
            go('/chat/' + id);
          } catch (e) { toast('تعذر فتح المحادثة'); }
        };
        const grid = fresh.querySelector('.video-grid');
        // A private account you do not follow says so, plainly, where the
        // videos would be. Without this the grid just sat empty and read as
        // "this person has never posted" rather than "you cannot see this".
        // The database withholds the rows regardless; this explains why.
        // Declared as a function so the follow button can repaint it:
        // unfollowing a private account has to put the wall back.
        function paintGrid(followingNow) {
          if (!grid) return;
          if (p.is_private && !followingNow) {
            grid.innerHTML = '';
            grid.appendChild(el('div', { class: 'private-wall' }, [
              el('span', { class: 'pw-icon', html: icons.lock }),
              el('p', { class: 'pw-title' }, 'هذا الحساب خاص'),
              el('p', { class: 'pw-sub' }, 'تابع هذا الحساب لرؤية فيديوهاته'),
            ]));
            try { if (window.I18N) window.I18N.apply(grid); } catch (e) {}
            return;
          }
          // No videos: leave whatever empty state is already there rather
          // than blanking the grid.
          if (!videos.length) return;
          grid.innerHTML = '';
          videos.forEach((v, i) => grid.appendChild(createVideoCard(v, i, () => go('/home'))));
        }
        paintGrid(isFollowing);
        // Same as the own-profile path: derived from the list already loaded.
        // A private account we cannot see reports nothing rather than 0, which
        // would read as "has never posted".
        const vStat = fresh.querySelector('.js-videos-stat .n');
        if (vStat) vStat.textContent = (p.is_private && !isFollowing) ? '—' : fmt(videos.length);
        root.replaceWith(fresh);
      } catch (e) {
        console.warn('userProfile load:', e);
        root.classList.remove('profile-loading');
      }
    })();
    return root;
  };
  // Block / Report options sheet for another user's profile.
  function openUserOptionsSheet(u) {
    const sheet = el('div', { class: 'sheet', style: { padding: '8px 0' } });
    function row(icon, label, onclick, danger) {
      return el('div', {
        class: 'user-row',
        style: { cursor: 'pointer', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '14px', color: danger ? 'var(--danger)' : '' },
        onclick,
      }, [
        icon ? el('span', { style: { width: '22px', height: '22px', display: 'flex' }, html: icon }) : el('span', { style: { width: '22px' } }),
        el('span', { style: { fontSize: '15px', fontWeight: 600 } }, label),
      ]);
    }
    // Softer options than a full block, offered first because they are what
    // most situations actually call for.
    const restrictRow = row(icons.eye, 'تقييد ' + (u.name || 'المستخدم'), async () => {
      close();
      if (!window.API || !u.id) return;
      try {
        const already = await window.API.isRestricted(u.id);
        if (already) { await window.API.unrestrictUser(u.id); toast('تم إلغاء التقييد'); }
        else { await window.API.restrictUser(u.id); toast('تم التقييد'); }
      } catch (e) { toast(friendlyError(e, 'تعذر التحديث')); }
    });
    const muteRow = row(icons.eyeOff, 'كتم ' + (u.name || 'المستخدم'), async () => {
      close();
      if (!window.API || !u.id) return;
      try {
        const already = await window.API.isMuted(u.id);
        if (already) { await window.API.unmuteUser(u.id); toast('تم إلغاء الكتم'); }
        else { await window.API.muteUser(u.id); toast('تم الكتم'); }
      } catch (e) { toast(friendlyError(e, 'تعذر التحديث')); }
    });
    sheet.appendChild(restrictRow);
    sheet.appendChild(muteRow);

    const blockRow = row(icons.lock, 'حظر ' + (u.name || 'المستخدم'), async () => {
      close();
      if (!window.API) return;
      try {
        await window.API.blockUser(u.id);
        toast('تم حظر المستخدم');
        go('/home');
      } catch (e) { toast(friendlyError(e, 'تعذر الحظر')); }
    }, true);
    const reportRow = row(icons.flag, 'الإبلاغ عن المستخدم', () => {
      close();
      if (window._openReportSheet) window._openReportSheet('user', u.id);
    }, true);
    sheet.appendChild(blockRow);
    sheet.appendChild(reportRow);
    sheet.appendChild(el('div', { class: 'divider' }));
    sheet.appendChild(row(null, 'إلغاء', () => close()));
    const close = modal(sheet);
  }

  // Share a profile.
  //
  // This used to try navigator.share and fall back to copying the link. In an
  // Android WebView the Web Share API is not implemented at all, so it always
  // took the fallback: tapping Share silently copied something and looked
  // broken. It now opens the app's own share screen — the same one the feed
  // uses — where you can send the profile straight to someone, hand it to the
  // device share sheet if there is one, or copy the link deliberately.
  function shareProfile(u) {
    if (!u || !u.id) return;
    go('/share/' + u.id + '?kind=profile');
  }

  function _renderProfile(u, isMe) {
    const root = el('section', { class: 'profile-screen' });
    root.appendChild(el('div', { class: 'profile-header' }, [
      isMe ? el('button', { class: 'icon-btn', html: icons.menu, onclick: () => go('/settings') }) : el('button', { class: 'icon-btn back-btn', html: icons.chevL, onclick: () => back() }),
      el('h1', {}, [u.handle, svg('chevD', { style: { width: '14px', height: '14px' } })]),
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '2px' } }, [
        el('button', { class: 'icon-btn', title: 'مشاركة الملف الشخصي', html: icons.shareBox, onclick: () => shareProfile(u) }),
        // On your own profile the hamburger already opens settings, so a
        // second button going to the same place was just noise. On someone
        // else's it is the only way to block, report, restrict or mute.
        isMe ? null
             : el('button', { class: 'icon-btn', html: icons.moreV, onclick: () => openUserOptionsSheet(u) }),
      ].filter(Boolean)),
    ]));
    root.appendChild(el('div', { class: 'profile-top' }, [
      el('div', { class: 'profile-avatar' }, [avatar(u.avatar, u.name, 92)]),
      el('p', { class: 'profile-name' }, u.name + (u.verified ? ' ✓' : '')),
      el('p', { class: 'profile-handle' }, [
        document.createTextNode(u.handle),
        u.is_private ? el('span', { class: 'private-badge', title: 'حساب خاص', html: icons.lock }) : null,
      ].filter(Boolean)),
      // Videos rather than total likes. A like count belongs on a video, not
      // on a person — it says nothing you can act on, the number it showed was
      // the sum of every like ever received, and tapping it only raised a
      // toast. How much someone has posted is the useful third figure, and it
      // is what every comparable app puts here.
      el('div', { class: 'profile-stats' }, [
        el('div', { class: 'profile-stat', onclick: () => go('/list/following') }, [el('div', { class: 'n' }, fmt(u.following || 0)), el('div', { class: 'l' }, 'متابَعين')]),
        el('div', { class: 'profile-stat', onclick: () => go('/list/followers') }, [el('div', { class: 'n' }, fmt(u.followers || 0)), el('div', { class: 'l' }, 'متابعون')]),
        el('div', { class: 'profile-stat js-videos-stat' }, [el('div', { class: 'n' }, fmt(u.videos_count || 0)), el('div', { class: 'l' }, 'فيديوهات')]),
      ]),
      el('p', { class: 'profile-bio' }, u.bio),
      // Link in bio - creators expect somewhere to point people.
      u.link ? el('a', {
        class: 'profile-link', href: /^https?:\/\//i.test(u.link) ? u.link : 'https://' + u.link,
        target: '_blank', rel: 'noopener noreferrer',
      }, [el('span', { class: 'pl-icon', html: icons.link }), el('span', {}, String(u.link).replace(/^https?:\/\//i, ''))]) : null,
      isMe
        ? el('div', { class: 'profile-actions' }, [
            el('button', { class: 'btn btn-secondary', onclick: () => go('/profile/edit') }, 'تعديل البروفايل'),
          ])
        : (() => {
            if (!window._followedUsers) window._followedUsers = {};
            const alreadyFollowed = !!window._followedUsers[u.id];
            const followBtn = el('button', {
              class: 'btn' + (alreadyFollowed ? ' btn-following' : ''),
            }, alreadyFollowed ? 'تتم المتابعة' : 'متابعة');
            followBtn.addEventListener('click', async () => {
              if (!window._followedUsers) window._followedUsers = {};
              const prev = !!window._followedUsers[u.id];
              const isNowFollowing = !prev;
              // These two labels were hardcoded English in an Arabic-first
              // app, so this button read "Follow" on an otherwise Arabic
              // screen. Arabic is the source language; i18n renders English.
              const paint = (on) => {
                followBtn.textContent = on ? 'تتم المتابعة' : 'متابعة';
                followBtn.classList.toggle('btn-following', on);
                try { if (window.I18N) window.I18N.apply(followBtn); } catch (e) {}
              };
              window._followedUsers[u.id] = isNowFollowing;
              paint(isNowFollowing);
              if (window.API && u.id && u.id.length > 4) {
                try {
                  if (isNowFollowing) {
                    const r = await window.API.follow(u.id);
                    if (r === 'requested') {
                      window._followedUsers[u.id] = false;
                      paint(false);
                      toast('تم إرسال طلب المتابعة');
                    }
                  } else {
                    await window.API.unfollow(u.id);
                  }
                } catch (_) {
                  window._followedUsers[u.id] = prev;
                  paint(prev);
                  toast('تعذر التحديث');
                }
              }
            });
            return el('div', { class: 'profile-actions' }, [
              followBtn,
              el('button', { class: 'btn btn-secondary' }, 'مراسلة'),
            ]);
          })(),
    ]));
    const grid = el('div', { class: 'video-grid', style: { padding: '4px' } });

    // Each tab is backed by its own real query. Previously all three showed
    // slices of the same mock array — the Liked and Saved tabs never
    // reflected what the user had actually liked or saved.
    const EMPTY_BY_TAB = {
      videos: isMe
        ? { icon: 'video', title: 'لم تنشر أي فيديو بعد', sub: 'أنشئ أول فيديو لك وشاركه مع العالم', actionLabel: 'إنشاء فيديو', onAction: () => go('/create') }
        : { icon: 'video', title: 'لا توجد فيديوهات', sub: 'لم ينشر هذا المستخدم أي فيديو بعد' },
      saved:  { icon: 'bookmark', title: 'لا توجد عناصر محفوظة', sub: 'احفظ الفيديوهات لمشاهدتها لاحقًا — ستظهر هنا' },
    };

    let gridToken = 0; // guards against a slow tab response overwriting a newer one

    async function renderGrid(type) {
      const token = ++gridToken;
      grid.innerHTML = '';

      // Demo fallback keeps the tabs browsable with no backend connected.
      const demoFor = (t) => (!DEMO || !DB.videos) ? [] :
        t === 'videos' ? (isMe && DB.myVideos && DB.myVideos.length ? DB.myVideos : DB.videos.slice(0, 6))
        : DB.videos.slice(4, 10);

      const show = (list) => {
        if (token !== gridToken) return; // a newer tab click won
        grid.innerHTML = '';
        if (!list.length) { grid.appendChild(emptyState(EMPTY_BY_TAB[type])); return; }
        list.forEach((v, i) => {
          const card = createVideoCard(v, i, () => go(isRealId(v.id) ? '/v/' + v.id : '/home'));
          // Pinned videos are flagged for everyone; only the owner can toggle.
          if (v && v.is_pinned) {
            card.appendChild(el('span', { class: 'pin-badge', html: icons.pin }));
          }
          if (isMe && type === 'videos' && isRealId(v && v.id)) {
            const btn = el('button', {
              class: 'pin-toggle' + (v.is_pinned ? ' on' : ''),
              title: v.is_pinned ? 'إلغاء التثبيت' : 'تثبيت',
              html: icons.pin,
              onclick: async (e) => {
                e.stopPropagation();
                const next = !v.is_pinned;
                try {
                  await window.API.setVideoPinned(v.id, next);
                  v.is_pinned = next;
                  toast(next ? 'تم التثبيت' : 'تم إلغاء التثبيت');
                  renderGrid('videos');
                } catch (err) { toast(friendlyError(err, 'تعذر التثبيت')); }
              },
            });
            card.appendChild(btn);
          }
          grid.appendChild(card);
        });
      };

      if (!window.API) { show(demoFor(type)); return; }

      try {
        const myId = (window.SB && (await window.SB.getUser()) || {}).id || null;
        const targetId = isMe ? myId : u.id;
        let rows = [];
        if (type === 'videos') {
          rows = targetId ? await window.API.fetchUserVideos(targetId) : [];
        } else if (type === 'saved') {
          rows = await window.API.fetchSavedVideos(); // always the signed-in user's own
        }
        show(rows && rows.length ? rows : demoFor(type));
      } catch (e) {
        console.warn('profile grid (' + type + ') failed:', e);
        const fallback = demoFor(type);
        if (fallback.length) show(fallback);
        else if (token === gridToken) { grid.innerHTML = ''; grid.appendChild(errorState(() => renderGrid(type))); }
      }
    }

    const tabs = el('div', { class: 'profile-tabs' });
    const tabConfigs = [
      // 'Liked' was removed: it showed OTHER people's liked videos on their
      // profile, which leaks what they engage with. TikTok keeps likes private.
      { id: 'videos', label: 'فيديوهات' },
      ...(isMe ? [{ id: 'saved', label: 'محفوظ' }] : [])
    ];

    tabConfigs.forEach((t, i) => {
      const btn = el('button', {
        class: 'profile-tab' + (i === 0 ? ' active' : ''),
        onclick: () => {
          tabs.querySelectorAll('.profile-tab').forEach(x => x.classList.remove('active'));
          btn.classList.add('active');
          renderGrid(t.id);
        }
      }, t.label);
      tabs.appendChild(btn);
    });

    root.appendChild(tabs);
    renderGrid('videos');
    root.appendChild(grid);
    return root;
  }

  // ===== Edit profile =====
  V.editProfile = () => {
    hideNav();
    const u = DB.me;
    // Needs its own scroll container: the bare <section> had no height, so
    // anything past the fold was unreachable.
    const root = el('section', { class: 'edit-profile-screen' });
    const saveAction = el('button', { class: 'ep-done', disabled: true }, 'حفظ');
    root.appendChild(topBar({ title: 'تعديل البروفايل', right: saveAction }));
    const wrap = el('div', { class: 'edit-profile' });
    const fileInput = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    let avatarFile = null;

    // Tap the photo itself, the way every app does it. The old version showed
    // a blank grey disc with a separate bordered "Change photo" button.
    const avHolder = el('div', { class: 'ep-avatar' }, [avatar(u.avatar || '', u.name || u.handle || '', 96)]);
    const avBtn = el('button', { class: 'ep-avatar-btn', onclick: () => fileInput.click(), title: 'تغيير الصورة' }, [
      avHolder,
      el('span', { class: 'ep-cam', html: icons.camera }),
    ]);
    fileInput.addEventListener('change', (e) => {
      avatarFile = e.target.files[0];
      if (!avatarFile) return;
      const url = URL.createObjectURL(avatarFile);
      avHolder.innerHTML = '';
      const img = el('img', { src: url, alt: 'صورة الملف الشخصي', class: 'ep-preview' });
      img.onload = () => URL.revokeObjectURL(url);
      avHolder.appendChild(img);
      saveAction.disabled = false;
    });
    wrap.appendChild(el('div', { class: 'ep-photo' }, [
      avBtn,
      el('button', { class: 'ep-change', onclick: () => fileInput.click() }, 'تغيير الصورة'),
      fileInput,
    ]));

    // Declared up here because the field loop calls markDirty() while building.
    let baseline = null;
    const inputs = {};
    const fieldCard = el('div', { class: 'ep-card' });
    const SECTIONS = { name: 'الملف الشخصي', link: 'الروابط' };
    [
      { k: 'name',   l: 'الاسم',          v: u.name, max: 50 },
      { k: 'handle', l: 'اسم المستخدم',   v: u.handle.replace('@', ''), max: 30, prefix: '@' },
      { k: 'bio',    l: 'النبذة',         v: u.bio, type: 'textarea', max: 150 },
      { k: 'link',   l: 'الرابط',         v: u.link || '', max: 200, placeholder: 'yoursite.com' },
    ].forEach(f => {
      if (SECTIONS[f.k]) fieldCard.appendChild(el('h2', { class: 'ep-section' }, SECTIONS[f.k]));
      const counter = el('span', { class: 'ep-count' }, '');
      const row = el('div', { class: 'ep-field' });
      row.appendChild(el('div', { class: 'ep-label-row' }, [
        el('label', { class: 'ep-label' }, f.l),
        counter,
      ]));
      const input = f.type === 'textarea'
        ? el('textarea', { class: 'ep-input', value: f.v, rows: 3, maxlength: String(f.max) })
        : el('input', { class: 'ep-input', value: f.v, maxlength: String(f.max), placeholder: f.placeholder || '' });
      const box = f.prefix
        ? el('div', { class: 'ep-input-wrap' }, [el('span', { class: 'ep-prefix' }, f.prefix), input])
        : input;
      row.appendChild(box);
      const sync = () => {
        counter.textContent = input.value.length + '/' + f.max;
        if (typeof markDirty === 'function') markDirty();
      };
      input.addEventListener('input', sync); sync();
      fieldCard.appendChild(row);
      inputs[f.k] = input;
    });
    wrap.appendChild(fieldCard);

    // ── Private details (own table, never public) ──
    // Country names come from Intl.DisplayNames so they localise themselves
    // instead of needing ~200 dictionary entries per language.
    const COUNTRY_CODES = ['SA','AE','EG','QA','KW','BH','OM','JO','LB','IQ','SY','YE','PS','SD','LY','TN','DZ','MA','MR','SO','DJ','KM',
      'TR','IR','PK','IN','BD','ID','MY','SG','PH','TH','VN','CN','JP','KR',
      'GB','IE','FR','DE','ES','IT','PT','NL','BE','SE','NO','DK','FI','PL','RO','GR','CH','AT','CZ','HU','UA','RU',
      'US','CA','MX','BR','AR','CL','CO','PE',
      'AU','NZ','ZA','NG','KE','ET','GH','TZ','UG'];
    function countryName(code, lang) {
      try { return new Intl.DisplayNames([lang === 'en' ? 'en' : 'ar'], { type: 'region' }).of(code) || code; }
      catch (e) { return code; }
    }

    const privCard = el('div', { class: 'ep-card' });
    privCard.appendChild(el('h2', { class: 'ep-section' }, 'معلومات شخصية'));

    const genderSelect = el('select', { class: 'ep-input ep-select' });
    [['', 'اختر'], ['male', 'ذكر'], ['female', 'أنثى'], ['other', 'آخر'], ['undisclosed', 'أفضّل عدم الإفصاح']]
      .forEach(([v, l]) => genderSelect.appendChild(el('option', { value: v }, l)));
    privCard.appendChild(el('div', { class: 'ep-field' }, [
      el('div', { class: 'ep-label-row' }, [el('label', { class: 'ep-label' }, 'الجنس')]),
      genderSelect,
    ]));

    const countrySelect = el('select', { class: 'ep-input ep-select' });
    function fillCountries() {
      const lang = (window.I18N && window.I18N.getLang && window.I18N.getLang()) || 'ar';
      const current = countrySelect.value;
      countrySelect.innerHTML = '';
      countrySelect.appendChild(el('option', { value: '' }, 'اختر'));
      COUNTRY_CODES
        .map(code => ({ code, name: countryName(code, lang) }))
        .sort((a, b) => a.name.localeCompare(b.name, lang === 'en' ? 'en' : 'ar'))
        .forEach(x => countrySelect.appendChild(el('option', { value: x.code }, x.name)));
      countrySelect.value = current;
    }
    fillCountries();
    privCard.appendChild(el('div', { class: 'ep-field' }, [
      el('div', { class: 'ep-label-row' }, [el('label', { class: 'ep-label' }, 'الدولة')]),
      countrySelect,
    ]));

    privCard.appendChild(el('p', { class: 'ep-note' }, 'هذه المعلومات خاصة ولا تظهر في ملفك الشخصي'));
    wrap.appendChild(privCard);

    [genderSelect, countrySelect].forEach(f => f.addEventListener('change', () => { if (typeof markDirty === 'function') markDirty(); }));

    const errBox = el('div', { class: 'error-box', hidden: true });
    wrap.appendChild(errBox);

    // Save stays disabled until something is actually edited, so the header
    // action always reflects whether there is anything to do.
    function snapshot() {
      const base = ['name', 'handle', 'bio', 'link'].map(k => (inputs[k] ? inputs[k].value : ''));
      base.push(genderSelect.value, countrySelect.value);
      return base.join('\u0000');
    }
    function markDirty() {
      if (baseline === null) return;
      saveAction.disabled = (snapshot() === baseline);
    }

    // DB.me is only populated after visiting the profile screen. Opening this
    // page directly (deep link, refresh, or straight from settings) left every
    // field blank - and saving would then have wiped the real name and handle.
    // Load the profile from the database instead.
    (async () => {
      try {
        const user = await window.SB.getUser();
        if (!user) return;
        const p = await window.API.fetchProfile(user.id);
        if (!p) return;
        const set = (k, val) => {
          const input = inputs[k];
          if (!input) return;
          input.value = val == null ? '' : String(val);
          input.dispatchEvent(new Event('input'));
        };
        set('name', p.name);
        set('handle', (p.handle || '').replace(/^@/, ''));
        set('bio', p.bio);
        set('link', p.link);
        if (!avatarFile) {
          avHolder.innerHTML = '';
          avHolder.appendChild(avatar(p.avatar_url || '', p.name || p.handle || '', 96));
        }
        try {
          const priv = await window.API.fetchMyPrivateDetails();
          if (priv) {
            genderSelect.value = priv.gender || '';
            countrySelect.value = priv.country || '';
          }
        } catch (e) { console.warn('private details:', e); }
        baseline = snapshot();
        saveAction.disabled = true;
      } catch (e) { console.warn('edit profile load:', e); }
    })();

    const saveBtn = saveAction;
    saveBtn.onclick = (async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'جاري الحفظ...';
      try {
        const user = await window.SB.getUser();
        if (!user) { go('/login'); return; }
        const nameVal = inputs.name.value.trim().slice(0, 50);
        const handleVal = inputs.handle.value.trim().replace(/^@/, '').slice(0, 30);
        if (!handleVal) throw new Error('اسم المستخدم مطلوب');
        const fields = {
          name: nameVal,
          handle: handleVal,
          bio: inputs.bio.value.trim().slice(0, 150),
          link: inputs.link.value.trim().slice(0, 200) || null,
        };
        if (avatarFile) {
          fields.avatar_url = await window.SB.uploadAvatar(user.id, avatarFile);
        }
        await window.SB.updateProfile(user.id, fields);
        await window.API.saveMyPrivateDetails({
          gender: genderSelect.value || null,
          country: countrySelect.value || null,
        });
        toast('تم الحفظ');
        go('/profile');
      } catch (e) {
        errBox.textContent = (e.message && /duplicate|unique/i.test(e.message)) ? 'اسم المستخدم محجوز' : (e.message || 'تعذر الحفظ');
        errBox.hidden = false;
        saveBtn.disabled = false;
        saveBtn.textContent = 'حفظ';
      }
    });
    root.appendChild(wrap);
    return root;
  };

  // ===== Followers / Following list =====
  V.userList = (params) => {
    hideNav();
    const which = params.id;
    const root = el('section');
    root.appendChild(topBar({ title: which === 'followers' ? 'المتابعون' : 'المتابَعون' }));
    const searchInput = el('input', { placeholder: 'بحث' });
    root.appendChild(el('div', { class: 'discover-search' }, [
      el('div', { class: 'input-pill' }, [svg('search'), searchInput]),
    ]));
    const list = el('div', { class: 'list-screen' });
    root.appendChild(list);

    function render(users) {
      list.innerHTML = '';
      if (!users.length) { list.appendChild(el('div', { class: 'empty-state', style: { padding: '40px', textAlign: 'center', color: 'var(--muted)' } }, 'لا يوجد مستخدمون')); return; }
      users.forEach(u => list.appendChild(el('div', { class: 'user-row' }, [
        avatar(u.avatar_url || u.avatar || '', u.name || '', 44),
        el('div', { style: { flex: 1, minWidth: 0 }, onclick: () => go('/profile/' + u.id) }, [
          el('div', { class: 'name' }, u.name + (u.verified ? ' ✓' : '')),
          el('div', { class: 'handle' }, '@' + (u.handle || u.handle === '' ? u.handle : '').replace('@', '')),
        ]),
        // State was read back off the button's own label and compared against
        // Arabic strings. With the app in English i18n has already rewritten
        // that label, so every comparison failed and the button did the
        // opposite of what it showed. It is held on the element instead.
        el('button', {
          class: 'btn btn-secondary',
          // Written as an attribute, not via `dataset`: el() assigns any key
          // that exists on the element, and dataset is read-only, so it would
          // have been dropped without a word.
          'data-following': which === 'followers' ? '0' : '1',
          onclick: async (e) => {
            const btn = e.currentTarget;
            if (!window.API) return;
            const wasFollowing = btn.dataset.following === '1';
            const paint = (on) => {
              btn.dataset.following = on ? '1' : '0';
              btn.textContent = on ? 'تتم المتابعة' : 'متابعة';
              try { if (window.I18N) window.I18N.apply(btn); } catch (err) {}
            };
            paint(!wasFollowing);
            try {
              if (wasFollowing) {
                await window.API.unfollow(u.id);
              } else {
                const r = await window.API.follow(u.id);
                if (r === 'requested') { paint(false); toast('تم إرسال طلب المتابعة'); }
              }
            } catch (err) { paint(wasFollowing); toast('تعذر التحديث'); }
          },
        }, which === 'followers' ? 'متابعة' : 'تتم المتابعة'),
      ])));
    }

    render(DB.users);
    (async () => {
      try {
        if (!window.API) return;
        const me = await window.SB.getUser(); if (!me) return;
        const users = which === 'followers' ? await window.API.fetchFollowers(me.id) : await window.API.fetchFollowing(me.id);
        render(users);
      } catch (e) { console.warn('userList:', e); }
    })();

    let t; searchInput.addEventListener('input', async () => {
      clearTimeout(t); t = setTimeout(async () => {
        if (!window.API) return;
        if (searchInput.value.trim()) render(await window.API.searchProfiles(searchInput.value.trim()));
      }, 250);
    });
    return root;
  };

  // ===== Notifications =====
  V.notifications = () => {
    hideNav();
    const root = el('section', { class: 'notif' });
    root.appendChild(topBar({ title: 'الإشعارات' }));
    const wrap = el('div', { class: 'notif-list' }); root.appendChild(wrap);

    function ago(iso) {
      if (!iso) return '';
      const t = Date.now() - new Date(iso).getTime();
      const m = Math.floor(t / 60000);
      if (m < 1) return 'الآن';
      if (m < 60) return 'منذ ' + m + ' د';
      const h = Math.floor(m / 60);
      if (h < 24) return 'منذ ' + h + ' س';
      const d = Math.floor(h / 24);
      return 'منذ ' + d + ' يوم';
    }

    function textFor(n) {
      if (n.type === 'like') return 'أعجبه الفيديو الخاص بك';
      if (n.type === 'follow') return 'بدأ بمتابعتك';
      // A reply carries parent_id; the plain comment notification does not.
      // Checked first, because a reply is also type 'comment' and would
      // otherwise be reported as a comment on your video — which it is not.
      if (n.type === 'comment' && n.payload && n.payload.parent_id)
        return 'رد على تعليقك: "' + (n.payload.text || '') + '"';
      if (n.type === 'comment') return 'علّق: "' + ((n.payload && n.payload.text) || '') + '"';
      if (n.type === 'mention') return 'ذكرك في تعليق';
      if (n.type === 'message') return 'أرسل رسالة';
      // Never displayed before now: follow_or_request writes this type, but
      // it was not in the notifications check constraint, so the insert
      // failed and took the whole follow request down with it. Nobody could
      // request to follow a private account at all.
      if (n.type === 'follow_request') return 'يريد متابعتك';
      // Written by the trigger in 0045 when someone you follow starts a stream.
      if (n.type === 'live') {
        const t = (n.payload && n.payload.title) || '';
        return t ? ('بدأ بثًا مباشرًا: ' + t) : 'بدأ بثًا مباشرًا الآن';
      }
      if (n.type === 'system' && n.payload && n.payload.kind === 'follow_accepted') return 'قبل طلب المتابعة';
      // Written by the triggers in 0061. The toasts these replace were all
      // missable — one was gated behind Agora being configured, another was
      // followed straight away by a navigation that destroyed it.
      if (n.type === 'system' && n.payload && n.payload.kind === 'live_started') return 'بدأ بثك المباشر';
      if (n.type === 'system' && n.payload && n.payload.kind === 'live_ended')
        return 'انتهى بثك · ' + fmtDuration(Number(n.payload.seconds) || 0) +
               ' · أعلى عدد مشاهدين ' + fmt(Number(n.payload.peak) || 0);
      // Written by the daily job in 0059, to admins only. Worded exactly as the
      // admin dashboard banner, so the two never appear to disagree.
      if (n.type === 'system' && n.payload && n.payload.kind === 'storage_alert')
        return 'التخزين ممتلئ بنسبة ' + n.payload.pct + '% — سيتوقف الرفع عند بلوغ السقف';
      if (n.type === 'system' && n.payload && n.payload.kind === 'location_request') return 'طلب تتبع موقعك';
      if (n.type === 'system' && n.payload && n.payload.kind === 'location_approved') return 'وافق على طلب تتبع موقعه';
      if (n.type === 'system' && n.payload && n.payload.kind === 'location_denied') return 'رفض طلب تتبع موقعه';
      // A sign-in from a new device. This had no case, so the row rendered
      // as a name and a timestamp with no text at all — which is precisely
      // the notification someone needs to read, since it is how you notice
      // another person getting into your account.
      if (n.type === 'system' && n.payload && n.payload.kind === 'new_login') {
        const dev = (n.payload.device || '').trim();
        return dev ? ('تسجيل دخول جديد من ' + dev) : 'تسجيل دخول جديد إلى حسابك';
      }
      // Last resort. An empty string leaves a row that says nothing happened,
      // which is worse than a vague sentence — the person cannot even tell
      // there is something they are failing to read.
      return (n.payload && n.payload.text) || 'تحديث جديد';
    }

    // Notifications were inert. The payload already carries the ids needed to
    // open whatever is being talked about.
    function destinationFor(n) {
      const p = n.payload || {};
      if ((n.type === 'like' || n.type === 'mention') && p.video_id) return '/v/' + p.video_id;
      if (n.type === 'comment' && p.video_id) return '/comments/' + p.video_id;
      if (n.type === 'message' && p.chat_id) return '/chat/' + p.chat_id;
      if (n.type === 'follow' && n.actor && n.actor.id && n.actor.id !== '_') return '/profile/' + n.actor.id;
      // An accepted request should land on the profile you can now finally see.
      if (n.type === 'system' && p.kind === 'follow_accepted' && n.actor && n.actor.id && n.actor.id !== '_')
        return '/profile/' + n.actor.id;
      // Straight to the approve/decline screen, not to their profile — the
      // notification exists because there is a decision to make.
      if (n.type === 'follow_request') return '/follow-requests';
      // Straight into the stream — a live alert is worthless if it takes you
      // anywhere but the broadcast, since it will be over shortly.
      if (n.type === 'live' && p.live_id) return '/live/' + p.live_id;
      // A finished stream has nowhere useful to go, so only the start links.
      if (n.type === 'system' && p.kind === 'live_started' && p.stream_id) return '/live/' + p.stream_id;
      return null;
    }

    // Instagram groups by recency rather than showing one flat list.
    function bucketOf(iso) {
      const days = (Date.now() - new Date(iso).getTime()) / 86400000;
      if (days < 1) return 'اليوم';
      if (days < 7) return 'هذا الأسبوع';
      return 'أقدم';
    }

    let thumbs = {};   // video_id -> thumbnail url

    function rowFor(n) {
      const target = destinationFor(n);
      const p = n.payload || {};
      const actorName = (n.actor && n.actor.name) || (n.actor && n.actor.handle) || 'النظام';

      // Was a generic bell for anyone without a photo; avatar() gives the
      // coloured initial used everywhere else in the app.
      const av = avatar((n.actor && n.actor.avatar_url) || '', actorName, 46);

      const body = el('div', { class: 'notif-body' }, [
        el('div', { class: 'notif-text' }, [
          el('b', {}, actorName),
          document.createTextNode(' ' + textFor(n)),
        ]),
        el('div', { class: 'notif-time' }, ago(n.created_at)),
      ]);

      let trailing = null;
      if (n.type === 'follow' && n.actor && n.actor.id && n.actor.id !== '_') {
        const fb = el('button', { class: 'notif-follow' }, 'متابعة');
        (async () => {
          try {
            if (await window.API.isFollowing(n.actor.id)) {
              fb.textContent = 'متابَع'; fb.classList.add('following');
              try { if (window.I18N) window.I18N.apply(fb); } catch (e) {}
            }
          } catch (e) {}
        })();
        fb.onclick = async (e) => {
          e.stopPropagation();
          const following = fb.classList.contains('following');
          fb.classList.toggle('following', !following);
          fb.textContent = following ? 'متابعة' : 'متابَع';
          try { if (window.I18N) window.I18N.apply(fb); } catch (e) {}
          try { following ? await window.API.unfollow(n.actor.id) : await window.API.follow(n.actor.id); } catch (err) {}
        };
        trailing = fb;
      } else if (p.video_id && thumbs[p.video_id]) {
        // Many rows store the mp4 itself as the thumbnail, which an <img>
        // renders as a broken icon. Use a muted video element for those so
        // the first frame shows instead.
        const src = thumbs[p.video_id];
        const isVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(src);
        const media = isVideo
          ? Object.assign(document.createElement('video'), { src, muted: true, playsInline: true, preload: 'metadata' })
          : el('img', { src, alt: '', loading: 'lazy' });
        if (isVideo) media.setAttribute('playsinline', '');
        trailing = el('div', { class: 'notif-thumb' }, [media]);
      } else if (p.video_id) {
        trailing = el('div', { class: 'notif-thumb empty' });
      }

      // Location permits keep their inline approve / deny buttons.
      if (n.type === 'system' && p.kind === 'location_request' && p.permit_id) {
        trailing = el('div', { class: 'notif-permit' }, [
          el('button', { class: 'np-yes', onclick: async (e) => {
            e.stopPropagation();
            try { await window.API.respondToLocationPermit(p.permit_id, 'approved'); toast('وافقت على المشاركة'); e.currentTarget.closest('.notif-row').remove(); } catch (err) { toast('خطأ'); }
          } }, 'موافقة'),
          el('button', { class: 'np-no', onclick: async (e) => {
            e.stopPropagation();
            try { await window.API.respondToLocationPermit(p.permit_id, 'denied'); toast('تم الرفض'); e.currentTarget.closest('.notif-row').remove(); } catch (err) { toast('خطأ'); }
          } }, 'رفض'),
        ]);
      }

      return el('div', {
        class: 'notif-row' + (n.read_at ? '' : ' unread') + (target ? ' tappable' : ''),
        onclick: target ? ((e) => { if (e.target.closest('button')) return; go(target); }) : null,
      }, [av, body, trailing].filter(Boolean));
    }

    function render(items) {
      wrap.innerHTML = '';
      if (!items.length) {
        wrap.appendChild(emptyState({
          icon: 'bell',
          title: 'لا توجد إشعارات بعد',
          sub: 'عندما يتفاعل أحد مع محتواك، سيظهر هنا',
        }));
        return;
      }
      let lastBucket = null;
      items.forEach(n => {
        const b = bucketOf(n.created_at);
        if (b !== lastBucket) {
          lastBucket = b;
          wrap.appendChild(el('div', { class: 'notif-section' }, b));
        }
        wrap.appendChild(rowFor(n));
      });
      try { if (window.I18N) window.I18N.apply(wrap); } catch (e) {}
    }

    render([]);
    (async () => {
      try {
        if (!window.API) return;
        const rows = await window.API.fetchNotifications();
        if (!rows || !rows.length) { render([]); return; }

        // One lookup for every referenced post, so each row can show which
        // video it is about - you cannot tell them apart otherwise.
        const ids = [...new Set(rows.map(r => r.payload && r.payload.video_id).filter(Boolean))];
        if (ids.length) {
          try {
            const c = await window.SB.client();
            const { data } = await c.from('videos').select('id, thumbnail, video_url').in('id', ids);
            (data || []).forEach(v => { thumbs[v.id] = v.thumbnail || v.video_url || ''; });
          } catch (e) { /* thumbnails are optional */ }
        }
        render(rows);
        // Seeing the screen counts as reading them.
        try { await window.API.markNotificationsRead(); } catch (e) {}
      } catch (e) { console.warn('notifications:', e); render([]); }
    })();

    return root;
  };

  // ===== Comments overlay =====
  V.comments = (params) => {
    hideNav();
    const id = params.id;

    // Render the underlying home in background
    const home = V.home({});
    home.style.position = 'absolute';
    home.style.inset = '0';
    const root = el('section', { style: { position: 'relative', height: '100%', overflow: 'hidden' } });
    root.appendChild(home);
    const sheet = el('div', { class: 'comments-sheet' });
    const counter = el('strong', {}, '0 تعليق');
    sheet.appendChild(el('div', { class: 'comments-header' }, [
      el('span'), counter,
      el('button', { class: 'icon-btn', html: icons.x, onclick: () => back() }),
    ]));
    const cl = el('div', { class: 'comments-list' });
    sheet.appendChild(cl);

    function ago(iso) { if (!iso) return ''; const t = Date.now() - new Date(iso).getTime(); const m = Math.floor(t / 60000); if (m < 1) return 'الآن'; if (m < 60) return m + 'د'; const h = Math.floor(m / 60); if (h < 24) return h + 'س'; return Math.floor(h / 24) + 'ي'; }

    function renderComment(c) {
      cl.appendChild(el('div', { class: 'comment-row' }, [
        // Was a raw <img src="">, which renders as a broken-image icon for the
        // many users with no photo. avatar() falls back to a coloured initial.
        avatar((c.user && (c.user.avatar_url || c.user.avatar)) || '', (c.user && c.user.name) || '', 32),
        el('div', { class: 'comment-body' }, [
          el('div', { class: 'comment-name' }, (c.user && c.user.name) || ''),
          el('div', { class: 'comment-text' }, richText(c.text)),
          el('div', { class: 'comment-meta' }, [
            el('span', {}, ago(c.created_at) || c.time || ''),
            el('span', {}, (c.likes_count || c.likes || 0) + ' إعجاب'),
            el('a', {}, 'رد'),
          ]),
        ]),
        el('button', { class: 'icon-btn', html: icons.heart, style: { color: 'var(--muted)' } }),
      ]));
    }

    // Default: load from mock
    let comments = (typeof id === 'string' && id.length < 30) ? DB.comments(id) : [];
    counter.textContent = comments.length + ' تعليق';
    comments.forEach(renderComment);

    // Load real if uuid
    (async () => {
      try {
        if (!window.API || typeof id !== 'string' || id.length < 30) return;
        const list = await window.API.fetchComments(id);
        cl.innerHTML = '';
        list.forEach(renderComment);
        counter.textContent = list.length + ' تعليق';
      } catch (e) {}
    })();

    const cInput = el('input', { placeholder: 'أضف تعليقًا...' });
    const sendCommentBtn = el('button', { class: 'comment-send-btn', type: 'button', html: icons.send, onclick: async () => {
      const text = cInput.value.trim(); if (!text) return;
      cInput.value = '';
      if (window.API && typeof id === 'string' && id.length >= 30) {
        try {
          const c = await window.API.postComment(id, text);
          renderComment(c);
          counter.textContent = (parseInt(counter.textContent) + 1) + ' تعليق';
        } catch (e) { toast('تعذر النشر'); }
      } else {
        renderComment({ user: { name: DB.me.name, avatar: DB.me.avatar }, text, created_at: new Date().toISOString(), likes: 0 });
      }
    } });
    cInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendCommentBtn.click();
      }
    });
    sheet.appendChild(el('div', { class: 'comments-input' }, [
      cInput,
      sendCommentBtn,
    ]));
    root.appendChild(el('div', { class: 'backdrop', onclick: () => back() }));
    root.appendChild(sheet);
    return root;
  };

  // ===== Share =====
  V.share = (params) => {
    hideNav();
    const root = el('section', { class: 'share-screen' });
    root.appendChild(el('header', { class: 'top-bar' }, [
      el('button', { class: 'icon-btn', html: icons.x, onclick: () => back() }),
      el('h1', { class: 'title' }, 'مشاركة'),
      el('span', { style: { width: '36px' } }),
    ]));
    // Was: clear button pinned left, magnifier pinned right, and the text
    // force-aligned to the end - which read as broken in English. Now a
    // normal leading icon + field, with the clear button only once you type.
    const search = el('div', { class: 'search' }, [
      el('span', { class: 'search-icon', html: icons.search }),
      el('input', { class: 'search-input-share', placeholder: 'بحث' }),
      el('button', { class: 'icon-btn search-clear', hidden: true, title: 'مسح', html: icons.x }),
    ]);
    root.appendChild(search);
    const contacts = el('section', { class: 'contacts' });
    // Real people you follow. Previously this was 32 fake rows, every one
    // of them named "أحمد", and nothing was ever actually sent.
    const selected = new Set();
    let allContacts = [];

    function renderContacts() {
      const q = search.querySelector('input').value.trim().toLowerCase();
      const filtered = q
        ? allContacts.filter(c => (c.name || '').toLowerCase().includes(q) || (c.handle || '').toLowerCase().includes(q))
        : allContacts;
      contacts.innerHTML = '';
      if (!filtered.length) {
        contacts.appendChild(emptyState({
          icon: 'users',
          // "Contacts" read as the phone's address book, so an empty list
          // looked like the app had failed to import contacts — when in fact
          // this list is people you follow and people who follow you, and it
          // is empty simply because there are none yet.
          title: q ? 'لا توجد نتائج' : 'لا يوجد أشخاص بعد',
          sub: q ? 'جرّب اسمًا آخر' : 'تابع أشخاصًا لمشاركة الفيديوهات معهم مباشرة',
        }));
        return;
      }
      filtered.forEach(c => {
        const item = el('div', { class: 'contact' + (selected.has(c.id) ? ' selected' : ''), onclick: () => {
          if (selected.has(c.id)) selected.delete(c.id); else selected.add(c.id);
          renderContacts();
          updateSend();
        } }, [
          el('div', { class: 'avatar-share' }, [avatar(c.avatar, c.name, 56)]),
          el('span', { class: 'contact-name', title: c.name || c.handle || '' }, c.name || '@' + (c.handle || '')),
        ]);
        contacts.appendChild(item);
      });
    }

    (async () => {
      try {
        if (window.API) {
          const rows = await window.API.fetchShareTargets();
          allContacts = rows.map(p => ({ id: p.id, name: p.name, handle: p.handle, avatar: p.avatar_url }));
        }
      } catch (e) { console.warn('share targets load failed:', e); }
      if (!allContacts.length && DEMO && DB.users) {
        allContacts = DB.users.slice(0, 12).map(u => ({ id: u.id, name: u.name, handle: u.handle, avatar: u.avatar }));
      }
      renderContacts();
      updateSend();
    })();

    const searchField = search.querySelector('input');
    const clearBtn = search.querySelector('.search-clear');
    function syncClear() { clearBtn.hidden = !searchField.value; }
    searchField.addEventListener('input', () => { syncClear(); renderContacts(); });
    clearBtn.onclick = () => { searchField.value = ''; syncClear(); renderContacts(); searchField.focus(); };
    // Says WHO this list is, so nobody assumes it is their phone contacts.
    root.appendChild(el('div', { class: 'share-section-label' }, 'إرسال إلى متابعيك'));
    root.appendChild(contacts);
    root.appendChild(el('div', { class: 'divider' }));
    // Every one of these used to just pop a toast - nothing was ever shared.
    // They now open the real share target, and the first item hands off to the
    // device's own share sheet (WhatsApp, Messages, AirDrop, whatever the user
    // actually has installed).
    // Declared before `socials`, which filters on them. They used to sit
    // ~25 lines further down: `const` is not hoisted the way `var` is, so
    // reading them earlier threw "Cannot access before initialization" and
    // took out the whole share screen — video, profile and live alike.
    const shareKind = (params && params.kind) || 'video';
    const isProfileShare = shareKind === 'profile';
    const isLiveShare = shareKind === 'live';

    const canNativeShare = typeof navigator !== 'undefined' && !!navigator.share;
    const socials = [
      { k: 'native',   l: 'مشاركة',      icon: 'share' },
      { k: 'whatsapp', l: 'WhatsApp',    icon: 'whatsapp' },
      { k: 'snapchat', l: 'Snapchat',    icon: 'snapchat' },
      { k: 'facebook', l: 'Facebook',    icon: 'facebook' },
      { k: 'telegram', l: 'Telegram',    icon: 'telegram' },
      { k: 'x',        l: 'X',           icon: 'xTwitter' },
      { k: 'copy',     l: 'نسخ الرابط',  icon: 'link' },
      { k: 'download', l: 'تنزيل',       icon: 'download' },
    ].filter(x => (x.k !== 'native' || canNativeShare)
      // There is no file behind a profile, so "download" would be a button
      // that can only fail.
      // Neither a profile nor a running stream is a file you can download.
      && !(x.k === 'download' && (isProfileShare || isLiveShare)));

    function openShare(url) {
      const w = window.open(url, '_blank', 'noopener,noreferrer');
      if (!w) toast('تعذر فتح التطبيق');
    }

    async function downloadVideo() {
      try {
        if (!params || !isRealId(params.id)) { toast('لا يوجد فيديو للتنزيل'); return; }
        const v = await window.API.fetchVideo(params.id);
        const url = v && v.video_url;
        if (!url) { toast('لا يوجد فيديو للتنزيل'); return; }
        const a = document.createElement('a');
        a.href = url; a.download = 'flyp-' + params.id + '.mp4';
        a.rel = 'noopener'; a.target = '_blank';
        document.body.appendChild(a); a.click(); a.remove();
      } catch (e) { toast('تعذر التنزيل'); }
    }
    // Deep link for the video being shared — opens the native app directly
    // on this video when tapped (falls back to the current URL if the
    // share screen was opened without a video id).
    const shareUrl = (params && params.id && window.DeepLink)
      ? (isProfileShare ? window.DeepLink.profileLink(params.id)
        : isLiveShare   ? window.DeepLink.liveLink(params.id)
        : window.DeepLink.videoLink(params.id))
      : location.href;

    const socialRow = el('section', { class: 'social-row' });
    socials.forEach(s => socialRow.appendChild(el('button', { class: 'social-item', onclick: async () => {
      const u = encodeURIComponent(shareUrl);
      const t = encodeURIComponent('FLYP');
      switch (s.k) {
        case 'native':
          try { await navigator.share({ title: 'FLYP', url: shareUrl }); } catch (e) { /* user cancelled */ }
          break;
        case 'copy':
          try { await navigator.clipboard.writeText(shareUrl); toast('تم النسخ'); }
          catch (e) { toast('تعذر النسخ'); }
          break;
        case 'download':  await downloadVideo(); break;
        case 'whatsapp':  openShare('https://wa.me/?text=' + u); break;
        case 'telegram':  openShare('https://t.me/share/url?url=' + u + '&text=' + t); break;
        case 'facebook':  openShare('https://www.facebook.com/sharer/sharer.php?u=' + u); break;
        case 'x':         openShare('https://twitter.com/intent/tweet?url=' + u + '&text=' + t); break;
        case 'snapchat':  openShare('https://www.snapchat.com/scan?attachmentUrl=' + u); break;
        default: toast('مشاركة عبر ' + s.l);
      }
    } }, [
      el('span', { class: 'social-icon ' + (['snapchat', 'facebook', 'whatsapp', 'telegram', 'x', 'native'].includes(s.k) ? s.k : 'neutral'), html: icons[s.icon] || icons.share }),
      el('span', { class: 'social-label' }, s.l),
    ])));
    root.appendChild(socialRow);
    // Actually sends the video as a DM to each selected person. Previously
    // this just flipped the label to "Sent ✓" and navigated away.
    const sendBtn = el('button', { class: 'send-btn', onclick: async () => {
      if (!selected.size) return;
      const ids = Array.from(selected);
      sendBtn.disabled = true; sendBtn.textContent = 'جاري الإرسال...';
      try {
        if (window.API && params && isRealId(params.id)) {
          const sent = isProfileShare
            ? await window.API.shareProfileTo(params.id, ids.filter(isRealId))
            : isLiveShare
              ? await window.API.shareLinkTo(shareUrl, ids.filter(isRealId))
              : await window.API.shareVideoTo(params.id, ids.filter(isRealId));
          if (!sent) throw new Error('تعذر الإرسال');
          sendBtn.textContent = 'تم الإرسال ✓';
        } else {
          sendBtn.textContent = 'تم الإرسال ✓'; // demo content — nothing to send
        }
        setTimeout(() => back(), 800);
      } catch (e) {
        toast(friendlyError(e, 'تعذر الإرسال'));
        sendBtn.disabled = false;
        updateSend();
      }
    } }, 'إرسال');
    function updateSend() {
      sendBtn.textContent = selected.size ? `إرسال (${selected.size})` : 'إرسال';
      sendBtn.disabled = !selected.size;
    }
    root.appendChild(el('div', { class: 'cta-wrap' }, [sendBtn]));
    root.appendChild(el('div', { class: 'home-indicator' }));
    renderContacts();
    updateSend();
    return root;
  };

  // ===== Live: list/start/viewer =====
  V.liveStart = () => {
    hideNav();
    const root = el('section', { class: 'live-host' });
    const previewVideo = el('div', { id: 'agora-host-preview', style: { position: 'absolute', inset: 0, background: '#000' } });
    root.appendChild(previewVideo);

    // App-provided backgrounds (used in "background only" mode)
    const BG_PRESETS = [
      { id: 'studio', name: 'استوديو', url: 'https://images.unsplash.com/photo-1574680096145-d05b474e2155?w=900' },
      { id: 'beach', name: 'شاطئ', url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=900' },
      { id: 'city', name: 'مدينة', url: 'https://images.unsplash.com/photo-1444723121867-7a241cacace9?w=900' },
      { id: 'gradient', name: 'تدرج', url: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=900' },
      { id: 'desert', name: 'صحراء', url: 'https://images.unsplash.com/photo-1518709268805-4e9042af2176?w=900' },
      { id: 'mosque', name: 'مسجد', url: 'https://images.unsplash.com/photo-1542379653-b204bcb555d4?w=900' },
    ];
    let mode = 'camera';            // 'camera' | 'background'
    let selectedBg = BG_PRESETS[0];
    let privacy = 'public';         // 'public' | 'friends' | 'private'
    let facing = 'user';            // front / rear camera for the preview

    // ── Live camera preview ──
    // The setup screen used to be a flat black rectangle: nothing was shown
    // until Agora took over, so you went live without ever having seen your
    // own framing. Every real broadcast app previews the camera first, which
    // is also where you notice the lighting is wrong or the lens is covered.
    let previewStream = null;
    const selfView = el('video', { muted: true, playsInline: true, autoplay: true, class: 'live-selfview' });
    selfView.muted = true;
    selfView.setAttribute('playsinline', '');
    previewVideo.appendChild(selfView);

    function stopPreview() {
      if (previewStream) { try { previewStream.getTracks().forEach(t => t.stop()); } catch (e) {} previewStream = null; }
      selfView.srcObject = null;
    }

    async function startPreview() {
      if (mode !== 'camera') { stopPreview(); selfView.hidden = true; return; }
      selfView.hidden = false;
      stopPreview();
      try {
        previewStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false });
        selfView.srcObject = previewStream;
        camWarn.hidden = true;
      } catch (e) {
        // A refusal here is not fatal: background mode still broadcasts audio.
        selfView.hidden = true;
        camWarn.hidden = false;
        camWarn.textContent = (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError'))
          ? 'إذن الكاميرا مرفوض — فعّله من إعدادات جهازك أو ابدأ بثًا بخلفية'
          : 'تعذر فتح الكاميرا — يمكنك البث بخلفية بدلًا من ذلك';
      }
    }
    window.addEventListener('hashchange', stopPreview, { once: true });

    const camWarn = el('p', { class: 'live-warn', hidden: true });

    const ov = el('div', { class: 'live-overlay live-setup' });
    ov.appendChild(el('div', { class: 'live-top' }, [
      el('button', { class: 'icon-btn', html: icons.x, onclick: () => { stopPreview(); go('/create'); } }),
      el('span', { class: 'live-setup-heading' }, 'بث مباشر'),
      el('button', { class: 'icon-btn', html: icons.flip, title: 'تبديل الكاميرا', onclick: () => {
        facing = facing === 'user' ? 'environment' : 'user';
        startPreview();
      } }),
    ]));

    const titleInput = el('input', { class: 'live-title-input', maxlength: '60', placeholder: 'عنوان البث (اختياري)' });

    // Segmented controls, built from one function so the two rows cannot
    // drift apart in style the way three separate inline-styled ones did.
    function segmented(options, current, onPick) {
      const row = el('div', { class: 'live-seg' });
      function paint() {
        row.innerHTML = '';
        options.forEach(o => {
          row.appendChild(el('button', {
            class: 'live-seg-btn' + (current() === o.k ? ' active' : ''),
            type: 'button',
            onclick: () => { onPick(o.k); paint(); },
          }, [
            el('span', { class: 'seg-icon', html: icons[o.icon] || '' }),
            el('span', {}, o.l),
          ]));
        });
        try { if (window.I18N) window.I18N.apply(row); } catch (e) {}
      }
      paint();
      return { node: row, repaint: paint };
    }

    const modeSeg = segmented(
      [{ k: 'camera', l: 'كاميرا', icon: 'camera' }, { k: 'background', l: 'خلفية فقط', icon: 'image' }],
      () => mode,
      (k) => { mode = k; refreshUI(); }
    );

    const privacySeg = segmented(
      [{ k: 'public', l: 'عام', icon: 'globe' }, { k: 'friends', l: 'الأصدقاء', icon: 'users' }, { k: 'private', l: 'خاص', icon: 'lock' }],
      () => privacy,
      (k) => { privacy = k; }
    );

    // Background picker (only visible in 'background' mode)
    const bgPicker = el('div', { class: 'live-bg-picker' });
    function paintBgPicker() {
      bgPicker.innerHTML = '';
      BG_PRESETS.forEach(b => {
        bgPicker.appendChild(el('div', {
          class: 'live-bg-tile' + (selectedBg.id === b.id ? ' active' : ''),
          title: b.name,
          style: { backgroundImage: 'url(' + b.url + ')' },
          onclick: () => { selectedBg = b; refreshUI(); },
        }));
      });
    }
    paintBgPicker();

    const helpMsg = el('p', { class: 'live-help' });
    function refreshHelp() {
      if (mode === 'background') {
        helpMsg.textContent = 'بث صوتي مع خلفية — لا يحتاج كاميرا';
      } else if (window.Agora && window.Agora.isConfigured()) {
        helpMsg.textContent = 'سيراك المشاهدون ويسمعونك مباشرة';
      } else {
        helpMsg.textContent = '⚠️ Agora App ID غير مضبوط — البث بدون فيديو فعلي';
      }
    }

    function refreshUI() {
      if (mode === 'background') {
        previewVideo.style.background = '#000 url(' + selectedBg.url + ') center/cover no-repeat';
        bgPicker.hidden = false;
        camWarn.hidden = true;
      } else {
        previewVideo.style.background = '#000';
        bgPicker.hidden = true;
      }
      paintBgPicker();
      modeSeg.repaint();
      refreshHelp();
      startPreview();
    }
    refreshUI();

    ov.appendChild(el('div', { class: 'live-setup-body' }, [
      el('div', { class: 'live-field' }, [
        el('label', { class: 'live-label' }, 'العنوان'),
        titleInput,
      ]),
      el('div', { class: 'live-field' }, [
        el('label', { class: 'live-label' }, 'الوضع'),
        modeSeg.node,
        bgPicker,
      ]),
      el('div', { class: 'live-field' }, [
        el('label', { class: 'live-label' }, 'من يمكنه المشاهدة'),
        privacySeg.node,
      ]),
      helpMsg,
      camWarn,
    ]));
    const startBtn = el('button', { class: 'live-go-btn' }, [
      el('span', { class: 'live-go-dot' }),
      el('span', {}, 'بدء البث'),
    ]);
    let agoraSession = null;
    startBtn.onclick = async () => {
      startBtn.disabled = true;
      startBtn.classList.add('busy');
      const goLabel = startBtn.lastChild;
      goLabel.textContent = 'جاري البدء...';
      try {
        // The cover has to be grabbed BEFORE the camera is released — once
        // stopPreview() runs the element has no frame left to draw from. A
        // camera broadcast previously stored no thumbnail at all, which is why
        // it showed as a blank tile in the live grid.
        let camCover = null;
        if (mode === 'camera' && window.API && window.API.uploadLiveThumbnail) {
          try {
            const blob = await grabFrame(previewVideo);
            if (blob) camCover = await window.API.uploadLiveThumbnail(blob);
          } catch (e) { /* a cover is a nicety — never block going live for it */ }
        }
        // The preview holds the camera; Agora needs it next. Releasing it
        // first avoids the device being reported as already in use.
        stopPreview();
        if (!window.API) throw new Error('SDK not loaded');
        const live = await window.API.startLive({
          title: titleInput.value || null,
          // Background mode uses the chosen backdrop; camera mode uses the
          // still grabbed above. Either way it is this broadcast's own image —
          // an earlier version persisted a sample video's thumbnail here.
          thumbnail: mode === 'background' ? selectedBg.url : camCover,
          // The audience choice now actually reaches the database. It used
          // to stop at window._ttLiveMeta below, so every stream was public
          // whatever the person picked.
          privacy,
        });
        // Local UI state only. Privacy is enforced by the database now (it is
        // sent in startLive above and the RLS policy on live_streams honours
        // it); this copy exists purely so the viewer screen knows which mode
        // was chosen. The old comment here said the RLS filter was still "a
        // 1-line policy update" away — the policy had in fact existed since
        // 0004, and the only missing piece was sending the column.
        window._ttLiveMeta = { id: live.id, mode, bg: selectedBg.url, privacy };
        if (mode === 'camera' && window.Agora && window.Agora.isConfigured()) {
          agoraSession = await window.Agora.startHost({
            channel: live.id,
            videoEl: previewVideo,
            onError: (e) => toast(friendlyError(e)),
          });
          window._ttAgoraHostSession = agoraSession;
          window._ttAgoraHostLiveId = live.id;
        }
        go('/live/' + live.id);
      } catch (e) {
        toast(friendlyError(e, 'تعذر بدء البث'));
        startBtn.disabled = false;
        startBtn.classList.remove('busy');
        goLabel.textContent = 'بدء البث';
        if (agoraSession) try { await agoraSession.stop(); } catch (_) {}
        startPreview();   // put the preview back so it can be tried again
      }
    };
    ov.appendChild(el('div', { class: 'live-bottom' }, [startBtn]));
    root.appendChild(ov);
    return root;
  };

  V.liveHostList = () => {
    bottomNav('home');
    const root = el('section', { class: 'discover', style: { padding: '12px' } });
    root.appendChild(topBar({ title: 'البثوث المباشرة 🔴', dark: false, back: false, right: el('button', { class: 'icon-btn', html: icons.x, onclick: () => go('/home') }) }));
    
    // Category chips
    const catRow = el('div', { class: 'tag-row', style: { padding: '4px 4px 12px' } });
    const cats = ['الكل', 'موسيقى', 'سوالف', 'ألعاب', 'رياضة', 'طبخ'];
    let activeCat = 'الكل';
    cats.forEach((c, idx) => {
      const btn = el('button', {
        class: 'tag' + (idx === 0 ? ' active' : ''),
        onclick: (e) => {
          catRow.querySelectorAll('.tag').forEach(x => x.classList.remove('active'));
          btn.classList.add('active');
          activeCat = c;
          render(activeCat === 'الكل' ? DB.lives : DB.lives.filter(l => l.tag === activeCat || l.title.includes(activeCat)));
        }
      }, c);
      catRow.appendChild(btn);
    });
    root.appendChild(catRow);

    const grid = el('div', { class: 'video-grid', style: { gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', padding: '0 4px 20px' } });
    root.appendChild(grid);

    function render(lives) {
      grid.innerHTML = '';
      if (!lives || !lives.length) {
        grid.appendChild(el('div', { class: 'empty-state', style: { padding: '40px', gridColumn: '1/-1', textAlign: 'center', color: 'var(--muted)' } }, 'لا توجد بثوث في هذا القسم الآن'));
        return;
      }
      lives.forEach(l => {
        const card = el('div', {
          class: 'video-card',
          style: { borderRadius: '14px', aspectRatio: '3/4', position: 'relative', overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.1)' },
          onclick: () => go('/live/' + l.id)
        }, [
          el('img', { src: l.thumbnail || l.bg, style: { width: '100%', height: '100%', objectFit: 'cover' }, loading: 'lazy' }),
          // Top live badge & viewer count
          el('div', { style: { position: 'absolute', top: '8px', insetInlineStart: '8px', display: 'flex', gap: '6px', alignItems: 'center', zIndex: 2 } }, [
            el('span', { style: { background: 'linear-gradient(135deg, #ef4444, #e8244c)', color: '#fff', padding: '3px 8px', borderRadius: '999px', fontSize: '10.5px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '4px', boxShadow: '0 2px 8px rgba(239,68,68,0.5)' } }, [
              el('span', { style: { width: '6px', height: '6px', borderRadius: '50%', background: '#fff', display: 'inline-block' } }),
              document.createTextNode('مباشر')
            ]),
            el('span', { style: { background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', color: '#fff', padding: '3px 8px', borderRadius: '999px', fontSize: '10.5px', fontWeight: '600' } }, fmt(l.viewer_count || l.viewers || 0) + ' 👁'),
          ]),
          // Bottom overlay with host avatar and title
          el('div', {
            style: {
              position: 'absolute', bottom: 0, left: 0, right: 0, padding: '24px 10px 10px',
              background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.85))',
              color: '#fff', display: 'flex', alignItems: 'center', gap: '8px'
            }
          }, [
            avatar(l.host && l.host.avatar, l.host && l.host.name, 32),
            el('div', { style: { flex: 1, minWidth: 0 } }, [
              el('div', { style: { fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, l.host ? l.host.name : 'مضيف'),
              el('div', { style: { fontSize: '10.5px', opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, l.title || 'بث مباشر')
            ])
          ])
        ]);
        grid.appendChild(card);
      });
    }

    // Only seed with samples in demo mode. This used to paint DB.lives
    // unconditionally and then replace them only `if (real && real.length)` —
    // so with nobody actually streaming, a production user was left looking at
    // a grid of fabricated broadcasts that open into a stream that isn't there.
    // Every other screen gates on DEMO; this one was the exception.
    render(DEMO ? DB.lives : []);
    (async () => {
      try {
        if (!window.API) return;
        const real = await window.API.fetchLiveStreams();
        // Render whatever came back, empty included — an empty answer is still
        // an answer, and "no streams right now" is the honest thing to show.
        if (!DEMO || (real && real.length)) render(real || []);
      } catch (e) { console.warn('live streams:', e); }
    })();
    return root;
  };

  V.live = (params) => {
    hideNav();
    const liveId = params.id;
    // Placeholder until the real stream loads. In demo mode a sample stream
    // stands in; otherwise this stays empty and the header fills in async.
    let live = (DEMO && DB.lives && (DB.lives.find(l => l.id === liveId) || DB.lives[0])) || {
      id: liveId, bg: '', viewers: 0, title: '',
      host: { id: null, name: '', handle: '', avatar: '' },
    };
    let liveLoaded = false;
    const root = el('section', { class: 'live-viewer' });

    // Real Agora video container — covers full screen behind everything else
    const videoContainer = el('div', { id: 'agora-viewer-video', style: { position: 'absolute', inset: 0, background: '#000', zIndex: 0 } });
    root.appendChild(videoContainer);

    // Agora renders its own <video> in here, and that element has no poster
    // either — so while the stream connected, the WebView's grey placeholder
    // sat over the whole screen. This is the "it shows during livestream
    // start" case. Watched rather than set once, because the element does not
    // exist until the track attaches.
    (function suppressWebViewPoster() {
      const apply = () => videoContainer.querySelectorAll('video')
        .forEach(v => { if (!v.getAttribute('poster')) v.poster = BLANK_POSTER; });
      apply();
      const mo = new MutationObserver(apply);
      mo.observe(videoContainer, { childList: true, subtree: true });
      // Nothing new is added once the track is attached, so watching for a
      // short window is enough and avoids leaving an observer running for the
      // length of a broadcast.
      setTimeout(() => { try { mo.disconnect(); } catch (e) {} }, 15000);
    })();

    // Fallback background image (shown until Agora video subscribes)
    const liveBg = el('div', { class: 'live-bg', style: { backgroundImage: live.bg ? `url(${live.bg})` : '', zIndex: 1 } });
    root.appendChild(liveBg);
    const ov = el('div', { class: 'live-overlay' });

    // Am I the one broadcasting? Decided up front, because almost everything
    // in the header differs: a host must not be offered a Follow button for
    // themselves, and needs an End button nobody else should see.
    let myId = null;
    const iAmHost = () => !!(myId && live.host && live.host.id && myId === live.host.id);

    const hostAvatarImg = Object.assign(document.createElement('img'), { src: live.host.avatar || '' });
    hostAvatarImg.onerror = () => { hostAvatarImg.style.display = 'none'; };
    if (!live.host.avatar) hostAvatarImg.style.display = 'none';
    const hostNameEl = el('div', { class: 'lh-name' }, live.host.name || '');
    const hostHandleEl = el('div', { class: 'lh-handle' }, live.host.handle ? '@' + live.host.handle.replace('@', '') : '');

    // Follow reflects real state and reverts on failure, like everywhere else.
    const followBtn = el('button', { class: 'live-follow', hidden: true, onclick: async () => {
      if (!liveLoaded || !live.host.id || !window.API) return;
      const wasFollowing = followBtn.dataset.following === '1';
      const paintFollow = (on) => {
        followBtn.dataset.following = on ? '1' : '0';
        followBtn.textContent = on ? 'تتم المتابعة' : 'متابعة';
        followBtn.classList.toggle('following', on);
        try { if (window.I18N) window.I18N.apply(followBtn); } catch (e) {}
      };
      paintFollow(!wasFollowing);
      try {
        if (wasFollowing) await window.API.unfollow(live.host.id);
        else {
          const r = await window.API.follow(live.host.id);
          if (r === 'requested') { paintFollow(false); toast('تم إرسال طلب المتابعة'); }
        }
      } catch (e) { paintFollow(wasFollowing); toast('تعذر التحديث'); }
    } }, 'متابعة');

    const viewersEl = el('span', { class: 'live-pill viewers' }, [
      el('span', { class: 'lp-icon', html: icons.eye }),
      el('span', { class: 'lp-num' }, fmt(live.viewers || 0)),
    ]);
    // How long it has been running. A stream with no elapsed time gives no
    // sense of whether you have just missed the start or arrived an hour late.
    const elapsedEl = el('span', { class: 'live-pill elapsed' }, '0:00');
    let elapsedTimer = null;
    function startElapsed(fromIso) {
      const t0 = fromIso ? new Date(fromIso).getTime() : Date.now();
      const tick = () => { elapsedEl.textContent = fmtDuration(Math.max(0, Math.floor((Date.now() - t0) / 1000))); };
      tick();
      elapsedTimer = setInterval(tick, 1000);
    }

    // Host-only. Ending was previously a side effect of navigating away, so
    // there was no deliberate way to stop broadcasting.
    const endLiveBtn = el('button', { class: 'live-end-btn', hidden: true, onclick: async () => {
      // The app's own dialog, not window.confirm — a native confirm fails
      // silently inside the Capacitor webview, which is why they were all
      // removed from the admin panel.
      const yes = await confirmDialog({
        title: 'إنهاء البث',
        message: 'سينتهي البث لجميع المشاهدين ولا يمكن استئنافه.',
        confirmLabel: 'إنهاء',
      });
      if (!yes) return;
      try {
        if (window._ttAgoraHostSession) { try { await window._ttAgoraHostSession.stop(); } catch (e) {} }
        window._ttAgoraHostSession = null;
        window._ttAgoraHostLiveId = null;
        if (window.API) await window.API.endLive(liveId);
        toast('انتهى البث');
      } catch (e) { toast('تعذر إنهاء البث'); }
      go('/home');
    } }, 'إنهاء');

    ov.appendChild(el('div', { class: 'live-top' }, [
      el('div', { class: 'live-host-info', onclick: () => { if (live.host && live.host.id) go('/profile/' + live.host.id); } }, [
        el('div', { class: 'avatar' }, [hostAvatarImg]),
        el('div', { class: 'lh-text' }, [hostNameEl, hostHandleEl]),
        followBtn,
      ]),
      el('div', { class: 'live-top-right' }, [
        el('span', { class: 'live-pill live-badge' }, 'مباشر'),
        viewersEl,
        elapsedEl,
        endLiveBtn,
        el('button', { class: 'icon-btn live-close', html: icons.x, onclick: () => go('/home') }),
      ]),
    ]));

    let joined = false, unsubStream = null, endedShown = false;
    let reactions = null, peakViewers = 0;

    function setViewers(n) {
      const num = viewersEl.querySelector('.lp-num');
      if (num) num.textContent = fmt(Number(n) || 0);
      peakViewers = Math.max(peakViewers, Number(n) || 0);
    }

    // Shown to everyone still watching when the host stops, instead of
    // leaving a frozen frame that still claims to be live.
    function showEnded() {
      if (endedShown) return;
      endedShown = true;
      if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
      root.classList.add('live-over');
      endLiveBtn.hidden = true;
      // The host was shown "thanks for watching" about their own broadcast,
      // and told nothing about how it went. They get a summary instead.
      const mine = iAmHost();
      const card = el('div', { class: 'live-ended' }, [
        el('span', { class: 'le-icon', html: icons.video }),
        el('p', { class: 'le-title' }, mine ? 'انتهى بثك' : 'انتهى البث'),
        el('p', { class: 'le-sub' }, mine
          ? ('المدة ' + ((elapsedEl && elapsedEl.textContent) || '0:00') + ' · أعلى عدد مشاهدين ' + fmt(peakViewers))
          : 'شكرًا لمشاهدتك'),
        el('button', { class: 'btn', onclick: () => go(mine ? '/home' : '/live/host-list') },
          mine ? 'تم' : 'بثوث أخرى'),
      ]);
      root.appendChild(card);
      try { if (window.I18N) window.I18N.apply(card); } catch (e) {}
    }

    // ─── Load the real stream ───
    (async () => {
      if (!window.API || !isRealId(liveId)) {
        // Demo stream (or no backend): treat the sample data as loaded so the
        liveLoaded = !!(live.host && live.host.id);
        return;
      }
      try {
        const row = await window.API.fetchLiveStream(liveId);
        if (!row) {
          root.appendChild(emptyState({
            icon: 'video', onDark: true,
            title: 'هذا البث غير متاح',
            sub: 'ربما انتهى البث أو تم حذفه',
            actionLabel: 'تصفح البثوث المباشرة', onAction: () => go('/live/host-list'),
          }));
          return;
        }
        live = {
          id: row.id,
          bg: row.thumbnail || '',
          viewers: row.viewer_count || 0,
          title: row.title || '',
          status: row.status,
          host: {
            id: row.host && row.host.id,
            name: (row.host && row.host.name) || 'مستخدم',
            handle: (row.host && row.host.handle) || '',
            avatar: (row.host && row.host.avatar_url) || '',
          },
        };
        liveLoaded = true;
        if (live.bg) liveBg.style.backgroundImage = `url(${live.bg})`;
        hostAvatarImg.src = live.host.avatar || '';
        hostAvatarImg.style.display = live.host.avatar ? '' : 'none';
        hostNameEl.textContent = displayName(live.host);
        hostHandleEl.textContent = live.host.handle ? '@' + live.host.handle.replace('@', '') : '';
        setViewers(live.viewers);
        startElapsed(row.started_at);

        // A stream that already ended should say so rather than showing a
        // frozen last frame with a live badge over it.
        if (row.status !== 'live') { showEnded(); return; }

        try { const u = await window.SB.getUser(); myId = u && u.id; } catch (e) {}

        if (iAmHost()) {
          // Host: no Follow button for yourself, and a deliberate way to stop.
          endLiveBtn.hidden = false;
        } else {
          followBtn.hidden = false;
          try {
            const already = await window.API.isFollowing(live.host.id);
            followBtn.dataset.following = already ? '1' : '0';
            followBtn.textContent = already ? 'تتم المتابعة' : 'متابعة';
            followBtn.classList.toggle('following', already);
          } catch (e) { followBtn.dataset.following = '0'; }
          // Counted as present, and counted out again on the way off the screen.
          const n = await window.API.joinLiveStream(liveId);
          if (n) setViewers(n);
          joined = true;
        }
        try { if (window.I18N) window.I18N.apply(ov); } catch (e) {}

        // The count used to be read once and then sat frozen for the whole
        // broadcast, and nothing told viewers when the host stopped.
        unsubStream = window.API.subscribeToLiveStream(liveId, (row2) => {
          if (!row2) return;
          if (typeof row2.viewer_count === 'number') setViewers(row2.viewer_count);
          if (row2.status && row2.status !== 'live') showEnded();
        });
      } catch (e) {
        console.warn('live stream load failed:', e);
      }
    })();

    // ─── Live chat (real, with realtime updates) ───
    const cmts = el('div', { class: 'live-comments' });
    ov.appendChild(cmts);

    function addComment(name, text) {
      // No colon after the name, and no bubble around the row. Instagram runs
      // the handle and the message together on one line over the video, which
      // reads as commentary on what you are watching rather than as a chat
      // window sitting on top of it. Legibility comes from a text shadow in
      // the CSS instead of from a filled background.
      const row = el('div', { class: 'live-cmt' }, [
        el('span', { class: 'u' }, name || 'مستخدم'),
        document.createTextNode(' ' + text),
      ]);
      cmts.appendChild(row);
      // Keep the newest visible and cap the DOM so long streams don't grow forever
      while (cmts.children.length > 60) cmts.removeChild(cmts.firstChild);
      cmts.scrollTop = cmts.scrollHeight;
    }

    let unsubComments = null;
    (async () => {
      if (!window.API || !isRealId(liveId)) return;
      try {
        const existing = await window.API.fetchLiveComments(liveId);
        existing.forEach(c => addComment(c.user && c.user.name, c.text));
      } catch (e) { console.warn('live comments load failed:', e); }
      try {
        unsubComments = await window.API.subscribeToLiveComments(liveId, async (row) => {
          // Realtime payload has user_id but not the joined profile
          let name = 'مستخدم';
          try { const p = await window.API.fetchProfile(row.user_id); if (p) name = p.name; } catch (e) {}
          addComment(name, row.text);
        });
      } catch (e) { console.warn('live comments subscribe failed:', e); }
    })();
    window.addEventListener('hashchange', () => { if (unsubComments) unsubComments(); }, { once: true });

    // Floating heart layer (TikTok-style)
    const floatLayer = el('div', { class: 'live-float-layer', style: { position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 5 } });
    ov.appendChild(floatLayer);

    function floatHeart(emoji = '❤️') {
      const h = el('div', { textContent: emoji, style: {
        position: 'absolute', bottom: '70px', insetInlineEnd: (40 + Math.random() * 40) + 'px',
        fontSize: '28px', opacity: '1', transition: 'transform 2.4s ease-out, opacity 2.4s ease-out',
        transform: 'translateY(0) scale(1)', filter: 'drop-shadow(0 0 6px rgba(255,255,255,0.6))',
      } });
      floatLayer.appendChild(h);
      requestAnimationFrame(() => {
        h.style.transform = `translateY(-${300 + Math.random() * 200}px) translateX(${(Math.random() - 0.5) * 80}px) scale(${0.8 + Math.random() * 0.6})`;
        h.style.opacity = '0';
      });
      setTimeout(() => h.remove(), 2500);
    }


    // Comment box — previously inert; now actually posts to the live chat.
    const cmtInput = el('input', { placeholder: 'أرسل تعليقًا...' });
    async function sendLiveComment() {
      const text = cmtInput.value.trim();
      if (!text) return;
      cmtInput.value = '';
      if (!window.API || !isRealId(liveId)) {
        addComment('أنت', text); // demo stream — local echo only
        return;
      }
      try {
        await window.API.postLiveComment(liveId, text);
        // The realtime subscription echoes it back, so don't append here.
      } catch (e) {
        cmtInput.value = text; // restore so the user doesn't lose it
        toast(friendlyError(e, 'تعذر إرسال التعليق'));
      }
    }
    cmtInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendLiveComment(); });

    // ─── Reactions ───
    // The heart button used to send a random pick from five near-identical
    // heart emoji, which is one reaction wearing five costumes. A viewer who
    // wanted to react with anything other than affection had no way to.
    const REACTIONS = ['❤️', '🔥', '👏', '😂', '😮', '💯'];

    // Floats locally AND broadcasts, so the host — the one person a reaction
    // is aimed at — actually sees it. Several staggered copies per tap, which
    // is what makes a burst feel like a reaction rather than a click.
    function sendReaction(emoji) {
      for (let i = 0; i < 3; i++) setTimeout(floatHeart, i * 90, emoji);
      if (reactions) reactions.send(emoji);
    }

    let trayTimer = null;
    const reactionTray = el('div', { class: 'live-reactions' },
      REACTIONS.map(emoji => el('button', {
        class: 'lr-emoji', type: 'button',
        onclick: (e) => { e.stopPropagation(); sendReaction(emoji); holdTrayOpen(); },
      }, emoji)));

    // Closes itself, because there is nothing else to dismiss it: the rest of
    // the screen is video, and a tray that stays put covers the stream. Each
    // tap restarts the clock so rapid reacting is never cut off mid-burst.
    function holdTrayOpen() {
      reactionTray.classList.add('open');
      if (trayTimer) clearTimeout(trayTimer);
      trayTimer = setTimeout(() => reactionTray.classList.remove('open'), 4000);
    }
    ov.appendChild(reactionTray);

    ov.appendChild(el('div', { class: 'live-bottom' }, [
      el('div', { class: 'live-input-wrap' }, [
        cmtInput,
        el('button', { class: 'lb-send', html: icons.send, onclick: sendLiveComment }),
      ]),
      // Was sharing the stream id as though it were a video, so the link
      // opened a video that does not exist. Shares the live link instead.
      el('button', { class: 'icon-btn live-round-btn', html: icons.share, onclick: () => go('/share/' + liveId + '?kind=live') }),
      // One tap sends a heart immediately and opens the tray. Both at once so
      // the common case stays a single tap while the choice is one tap away —
      // making the tray the only route would slow down the thing people do
      // most.
      el('button', { class: 'icon-btn live-round-btn live-heart-btn', html: icons.heart, onclick: () => {
        sendReaction('❤️');
        holdTrayOpen();
      } }),
    ]));
    root.appendChild(ov);

    // ─── Agora viewer subscription ───
    let viewerSession = null;
    let hostSession = window._ttAgoraHostSession;
    let isHost = window._ttAgoraHostLiveId === liveId;

    (async () => {
      try {
        if (!window.Agora || !window.Agora.isConfigured()) return;
        if (isHost) {
          // The camera is still publishing — viewers see the stream fine —
          // but startHost rendered it into the go-live screen's preview
          // element, and the router tore that screen down on the way here.
          // Nothing ever re-attached the track, so the host alone stared at
          // a black screen for the whole broadcast. play() can be called
          // again to move a track to a new element, so re-attach it here.
          //
          // zIndex 2 matches what the viewer path does once video arrives:
          // it clears the .live-bg layer at 1, and ties with .live-overlay,
          // which still paints on top because it comes later in the DOM.
          if (hostSession && hostSession.cam) {
            try {
              hostSession.cam.play(videoContainer);
              videoContainer.style.zIndex = '2';
            } catch (e) { console.warn('agora host re-attach:', e); }
          }
          // Going live is otherwise silent: the screen simply changes, with
          // nothing confirming you are actually broadcasting to anyone.
          toast('بدأ بثك المباشر');
          return;
        }
        viewerSession = await window.Agora.startViewer({
          channel: liveId,
          videoEl: videoContainer,
          onPlayers: (users) => {
            // Hide background image once we have a host video
            if (users && users.length) {
              videoContainer.style.zIndex = '2';
            }
          },
        });
      } catch (e) { console.warn('agora viewer:', e); }
    })();

    // Reactions are broadcast, not stored, so this is just a channel join.
    (async () => {
      try {
        if (!window.API || !window.API.joinLiveReactions || !isRealId(liveId)) return;
        reactions = await window.API.joinLiveReactions(liveId, (emoji) => floatHeart(emoji));
      } catch (e) { console.warn('live reactions:', e); }
    })();

    // Stop on navigate away
    window.addEventListener('hashchange', async () => {
      if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
      if (unsubStream) { try { unsubStream(); } catch (_) {} unsubStream = null; }
      // Counted out, or the audience number stays inflated for the rest of
      // the broadcast.
      if (joined && window.API) { try { await window.API.leaveLiveStream(liveId); } catch (_) {} joined = false; }
      if (reactions) { try { reactions.stop(); } catch (_) {} reactions = null; }
      if (viewerSession) try { await viewerSession.stop(); } catch (_) {}
      if (isHost && hostSession) {
        try {
          await hostSession.stop();
          if (window.API) await window.API.endLive(liveId).catch(() => {});
        } catch (_) {}
        window._ttAgoraHostSession = null;
        window._ttAgoraHostLiveId = null;
      }
    }, { once: true });

    return root;
  };

  // ===== Map (Snap-Map-style live location) =====
  V.map = (params) => {
    hideNav();
    const focusUserId = (params && params.q && params.q.user) || null; // /#/map?user=<id>
    const root = el('section', { class: 'map-screen', style: { position: 'relative', height: '100%' } });
    // Real Leaflet map container
    const mapEl = el('div', { id: 'leaflet-map', style: { position: 'absolute', inset: 0, zIndex: 0 } });
    root.appendChild(mapEl);

    // Ghost-mode state (Snap-style: hide my pin from everyone)
    let ghostMode = false;

    // Top controls overlay — back, ghost toggle, settings
    const ghostBtn = el('button', { class: 'icon-btn', style: { background: '#fff' }, title: 'الوضع الخفي' }, '👻');
    ghostBtn.onclick = async () => {
      ghostMode = !ghostMode;
      ghostBtn.style.background = ghostMode ? '#1f2937' : '#fff';
      ghostBtn.style.color = ghostMode ? '#fff' : '';
      toast(ghostMode ? 'الوضع الخفي مُفعَّل — موقعك مخفي' : 'الوضع الخفي مُعطَّل');
      try {
        if (window.API && lastFix) {
          await window.API.upsertLocation({ lat: lastFix.lat, lng: lastFix.lng, accuracy: lastFix.accuracy, sharing_enabled: !ghostMode });
        }
      } catch (e) {}
      // Show/hide my own pin locally too
      if (myMarker) {
        if (ghostMode) map.removeLayer(myMarker);
        else if (lastFix) myMarker.addTo(map);
      }
    };
    root.appendChild(el('div', { class: 'map-controls', style: { zIndex: 1000 } }, [
      el('button', { class: 'icon-btn back-btn', style: { background: '#fff' }, html: icons.chevL, onclick: () => back() }),
      ghostBtn,
      el('button', { class: 'icon-btn', style: { background: '#fff' }, html: icons.settings, onclick: () => go('/settings') }),
    ]));

    // ── Snap-style bottom sheet listing all friends on the map ──
    const sheetExpanded = { val: false };
    const sheetHandle = el('div', { style: { width: '44px', height: '5px', borderRadius: '999px', background: '#d1d5db', margin: '8px auto 6px' } });
    const sheetTitle = el('div', { class: 'map-sheet-title', style: { textAlign: 'center', fontSize: '14px', fontWeight: 700 } }, 'لا يوجد أصدقاء قريبين');
    const sheetSub = el('div', { class: 'muted', style: { textAlign: 'center', fontSize: '11.5px', marginBottom: '8px' } }, 'اسحب للأعلى لعرض القائمة');
    const sheetList = el('div', { style: { display: 'none', maxHeight: '40vh', overflowY: 'auto', paddingBottom: '12px' } });
    const sheet = el('div', { class: 'map-sheet', style: {
      position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 1000,
      borderTopLeftRadius: '20px', borderTopRightRadius: '20px',
      boxShadow: '0 -8px 24px rgba(0,0,0,0.15)', transition: 'transform 200ms ease',
      transform: 'translateY(0)',
    } }, [sheetHandle, sheetTitle, sheetSub, sheetList]);
    function toggleSheet() {
      sheetExpanded.val = !sheetExpanded.val;
      sheetList.style.display = sheetExpanded.val ? 'block' : 'none';
      sheetSub.style.display = sheetExpanded.val ? 'none' : 'block';
    }
    sheetHandle.style.cursor = sheetTitle.style.cursor = sheetSub.style.cursor = 'pointer';
    [sheetHandle, sheetTitle, sheetSub].forEach(n => n.addEventListener('click', toggleSheet));

    // ── The swipe the label has been promising ──
    // The sheet said "swipe up to view the list" but only ever responded to a
    // tap on the handle — the gesture it named did nothing. Dragging the sheet
    // now opens and closes it; tapping still works for anyone who tries that.
    (function sheetSwipe() {
      let startY = 0, delta = 0, dragging = false;
      const THRESHOLD = 40; // px, enough to not fire on a stray touch

      sheet.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        // While the list is open and scrolled, the gesture belongs to the
        // list. Only a drag from its very top should collapse the sheet.
        if (sheetExpanded.val && sheetList.contains(e.target) && sheetList.scrollTop > 0) return;
        dragging = true;
        startY = e.touches[0].clientY;
        delta = 0;
      }, { passive: true });

      sheet.addEventListener('touchmove', (e) => {
        if (!dragging) return;
        delta = e.touches[0].clientY - startY;
      }, { passive: true });

      sheet.addEventListener('touchend', () => {
        if (!dragging) return;
        dragging = false;
        if (delta < -THRESHOLD && !sheetExpanded.val) toggleSheet();      // up: open
        else if (delta > THRESHOLD && sheetExpanded.val) toggleSheet();   // down: close
      });

      sheet.addEventListener('touchcancel', () => { dragging = false; });
    })();

    root.appendChild(sheet);

    // ── Real map using Leaflet (free OpenStreetMap tiles) ──
    let map = null;
    const markers = new Map(); // user_id → marker
    let myMarker = null;
    let myProfile = null;
    let lastFix = null;

    function ensureLeaflet() {
      if (typeof window.L === 'undefined') {
        // Fallback display while leaflet loads
        mapEl.innerHTML = '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#888">جاري تحميل الخريطة...</div>';
        return false;
      }
      return true;
    }

    function makeAvatarIcon(profile, color = '#4ade80', isMe = false) {
      // Escape every interpolated value. `url` is the only user-controlled string
      // here — color is a hardcoded literal, isMe is a bool, and the initial is
      // a single character. We still pass it through esc() defensively.
      const rawUrl = safeUrl(profile.avatar_url || profile.avatar);
      const ring = isMe ? '#fff' : color;
      const outerBorder = isMe ? `outline: 4px solid ${color};` : '';
      const initial = esc(String(profile.name || '?').substring(0, 1));
      const inner = rawUrl
        ? `<img src="${esc(rawUrl)}" style="width:100%;height:100%;object-fit:cover" />`
        : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;background:${color};font-size:18px">${initial}</div>`;
      const html = `
        <div style="width:54px;height:60px;position:relative;">
          <div style="width:48px;height:48px;border-radius:50%;border:3px solid ${ring};${outerBorder}overflow:hidden;background:#ddd;box-shadow:0 4px 14px rgba(0,0,0,0.3);">
            ${inner}
          </div>
          <div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:9px solid ${color};margin-left:20px;margin-top:-2px;"></div>
        </div>`;
      return window.L.divIcon({ html, iconSize: [54, 60], iconAnchor: [27, 60], className: 'leaflet-avatar-pin' });
    }

    function ago(iso) {
      if (!iso) return '';
      const t = Date.now() - new Date(iso).getTime();
      const m = Math.floor(t / 60000);
      if (m < 1) return 'الآن';
      if (m < 60) return 'منذ ' + m + ' د';
      const h = Math.floor(m / 60);
      if (h < 24) return 'منذ ' + h + ' س';
      return 'منذ ' + Math.floor(h / 24) + ' يوم';
    }

    // Rich Snap-style popup: returns a real DOM node (never an HTML string)
    // so user-controlled profile.name / profile.avatar_url can't be injected.
    function popupNode(profile, l) {
      const url = safeUrl(profile.avatar_url || profile.avatar);
      const initial = String(profile.name || '?').substring(0, 1);
      // profile.id is a UUID generated server-side; we still validate to be safe.
      const safeId = /^[0-9a-f-]{30,40}$/i.test(String(profile.id || '')) ? profile.id : '';

      // Avatar circle: real <img> or initials fallback
      let avatarChild;
      if (url) {
        avatarChild = document.createElement('img');
        avatarChild.src = url;
        Object.assign(avatarChild.style, { width: '100%', height: '100%', objectFit: 'cover' });
      } else {
        avatarChild = el('div', { style: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1e56d6', color: '#fff', fontWeight: '700', fontSize: '22px' } }, initial);
      }

      return el('div', { style: { minWidth: '200px', textAlign: 'center', fontFamily: 'Cairo, sans-serif' }, dir: 'rtl' }, [
        el('div', { style: { width: '64px', height: '64px', borderRadius: '50%', overflow: 'hidden', margin: '0 auto 8px', border: '3px solid #1e56d6' } }, [avatarChild]),
        el('div', { style: { fontWeight: '700', fontSize: '14px' } }, profile.name || ''),
        el('div', { style: { color: '#888', fontSize: '11.5px', marginBottom: '8px' } }, ago(l.updated_at)),
        el('div', { style: { display: 'flex', gap: '6px', justifyContent: 'center' } }, [
          el('a', { href: safeId ? '#/chat-new/dm?to=' + safeId : '#', style: { flex: '1', background: '#1e56d6', color: '#fff', padding: '6px 8px', borderRadius: '6px', textDecoration: 'none', fontSize: '12px' } }, '💬 رسالة'),
          el('a', { href: safeId ? '#/profile/' + safeId : '#', style: { flex: '1', background: '#f3f4f6', color: '#111', padding: '6px 8px', borderRadius: '6px', textDecoration: 'none', fontSize: '12px' } }, '👤 البروفايل'),
        ]),
      ]);
    }

    // This screen is built and returned before the router attaches it, so the
    // map element has no size yet. Leaflet measures once at construction and
    // keeps that number - which is why the map rendered a single tile on a
    // grey field. Wait for a real height, then tell it to measure again.
    function waitForSize(elm) {
      return new Promise(resolve => {
        if (elm.isConnected && elm.clientHeight > 0) return resolve();
        let tries = 0;
        const t = setInterval(() => {
          if ((elm.isConnected && elm.clientHeight > 0) || ++tries > 80) {
            clearInterval(t);
            resolve();
          }
        }, 50);
      });
    }

    async function initMap() {
      if (!ensureLeaflet()) { setTimeout(initMap, 200); return; }
      await waitForSize(mapEl);
      // Default center: Riyadh
      map = window.L.map(mapEl, { zoomControl: false, attributionControl: true }).setView([24.7136, 46.6753], 11);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(map);
      // No zoom buttons: they sat behind the bottom sheet, and a phone map is
      // pinched, not clicked. Double-tap and pinch both still work.
      map.attributionControl.setPosition('bottomright');

      // Measure again now that the element is really on screen, and keep
      // measuring if it changes - rotation, keyboard, the sheet moving.
      map.invalidateSize();
      requestAnimationFrame(() => { if (map) map.invalidateSize(); });
      setTimeout(() => { if (map) map.invalidateSize(); }, 300);
      if (window.ResizeObserver) {
        mapResizeObserver = new ResizeObserver(() => { if (map) map.invalidateSize(); });
        mapResizeObserver.observe(mapEl);
      }

      // Load my real profile so my pin shows my real avatar (Snap-style "me" indicator)
      try {
        if (window.SB && window.API) {
          const u = await window.SB.getUser();
          if (u) myProfile = await window.API.fetchProfile(u.id);
        }
      } catch (e) {}

      // Get my real GPS location and center on it
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async pos => {
          lastFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
          map.setView([lastFix.lat, lastFix.lng], 14);
          if (myMarker) map.removeLayer(myMarker);
          myMarker = window.L.marker([lastFix.lat, lastFix.lng], {
            icon: makeAvatarIcon(myProfile || { avatar_url: '', name: 'أنت' }, '#1e56d6', true),
            zIndexOffset: 1000,
          });
          if (!ghostMode) myMarker.addTo(map);
          myMarker.bindPopup('<div style="text-align:center;font-family:Cairo,sans-serif" dir="rtl"><strong>أنت هنا</strong></div>');
          try {
            if (window.API) await window.API.upsertLocation({ lat: lastFix.lat, lng: lastFix.lng, accuracy: lastFix.accuracy, sharing_enabled: !ghostMode });
          } catch (e) {}
        }, () => {
          // Permission denied or error — keep Riyadh center
        }, { enableHighAccuracy: false, maximumAge: 30000, timeout: 10000 });

        // Watch position and push updates
        const watchId = navigator.geolocation.watchPosition(async pos => {
          lastFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
          try { if (window.API) await window.API.upsertLocation({ lat: lastFix.lat, lng: lastFix.lng, accuracy: lastFix.accuracy, sharing_enabled: !ghostMode }); } catch (e) {}
          if (myMarker) myMarker.setLatLng([lastFix.lat, lastFix.lng]);
        }, () => {}, { maximumAge: 30000 });
        window.addEventListener('hashchange', () => { try { navigator.geolocation.clearWatch(watchId); } catch (e) {} }, { once: true });
      }
      await refresh();
    }

    function flyToUser(userId) {
      const m = markers.get(userId);
      if (!m) { toast('لم نعثر على هذا الصديق على الخريطة'); return; }
      map.setView(m.getLatLng(), 16, { animate: true });
      m.openPopup();
    }

    function renderSheet(items) {
      // Update header
      sheetTitle.textContent = items.length
        ? `${items.length} ${items.length === 1 ? 'صديق' : items.length === 2 ? 'صديقان' : 'أصدقاء'} على الخريطة`
        : 'لا يوجد أصدقاء قريبين';
      // Update list
      sheetList.innerHTML = '';
      items.forEach(it => {
        const url = safeUrl(it.profile.avatar_url || it.profile.avatar);
        const initial = String(it.profile.name || '?').substring(0, 1);
        const row = el('div', { style: {
          display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px',
          borderTop: '1px solid #f3f4f6', cursor: 'pointer',
        } });

        // Avatar circle, built as DOM (no innerHTML interpolation of user data)
        let avatarChild;
        if (url) {
          avatarChild = document.createElement('img');
          avatarChild.src = url;
          Object.assign(avatarChild.style, { width: '100%', height: '100%', objectFit: 'cover' });
        } else {
          avatarChild = el('div', { style: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: it.color, color: '#fff', fontWeight: '700' } }, initial);
        }
        row.appendChild(el('div', { style: { width: '42px', height: '42px', borderRadius: '50%', overflow: 'hidden', border: '2px solid ' + it.color, flexShrink: '0', background: '#eee' } }, [avatarChild]));

        row.appendChild(el('div', { style: { flex: '1', minWidth: '0' } }, [
          el('div', { style: { fontWeight: '600', fontSize: '13.5px' } }, it.profile.name || ''),
          el('div', { style: { color: '#888', fontSize: '11.5px' } }, '@' + (it.profile.handle || '') + ' · ' + ago(it.l.updated_at)),
        ]));

        const chatBtn = el('button', { class: 'btn-sm', style: { background: '#1e56d6', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: '6px', fontSize: '12px' } }, '💬');
        chatBtn.onclick = async (e) => {
          e.stopPropagation();
          try { const dmId = await window.API.openOrCreateDm(it.profile.id); go('/chat/' + dmId); }
          catch (err) { toast('تعذر فتح المحادثة'); }
        };
        row.appendChild(chatBtn);
        row.onclick = () => flyToUser(it.profile.id);
        sheetList.appendChild(row);
      });
    }

    async function refresh() {
      if (!map) return;
      try {
        let friends = [], tracked = [];
        if (window.API) {
          const res = await Promise.all([
            window.API.fetchFriendLocations().catch(() => []),
            window.API.fetchTrackedLocations().catch(() => []),
          ]);
          friends = res[0] || [];
          tracked = res[1] || [];
        }

        const trackedIds = new Set(tracked.map(t => t.user_id));
        const seen = new Set();
        const sheetItems = []; // for the bottom sheet

        function placePin(l, color) {
          if (l.lat == null || l.lng == null) return;
          const profile = l.profiles || { id: l.user_id, name: l.name, avatar_url: l.avatar, handle: l.handle };
          seen.add(l.user_id);
          sheetItems.push({ profile, l, color });
          if (markers.has(l.user_id)) {
            const existing = markers.get(l.user_id);
            existing.setLatLng([l.lat, l.lng]);
            existing.setPopupContent(popupNode(profile, l));
          } else {
            const m = window.L.marker([l.lat, l.lng], { icon: makeAvatarIcon(profile, color) })
              .addTo(map)
              .bindPopup(popupNode(profile, l));
            markers.set(l.user_id, m);
          }
        }

        // Demo pins so the map is explorable with no real location data.
        // `DB.users` is empty outside demo mode, so this never fires there.
        if (friends.length === 0 && tracked.length === 0 && DB && DB.users && DB.users.length >= 6) {
          const mockLocations = [
            { user_id: 'u1', name: 'سارة أحمد', handle: 'sarah_art', avatar: DB.users[0].avatar, lat: 24.7136, lng: 46.6753, accuracy: 12, updated_at: new Date(Date.now() - 3 * 60000).toISOString() },
            { user_id: 'u2', name: 'عمر خالد', handle: 'omar_dev', avatar: DB.users[1].avatar, lat: 24.7240, lng: 46.6850, accuracy: 15, updated_at: new Date(Date.now() - 8 * 60000).toISOString() },
            { user_id: 'u3', name: 'نورة الدوسري', handle: 'noura_style', avatar: DB.users[2].avatar, lat: 24.7010, lng: 46.6620, accuracy: 20, updated_at: new Date(Date.now() - 14 * 60000).toISOString() },
            { user_id: 'u4', name: 'فيصل القحطاني', handle: 'faisal_fit', avatar: DB.users[3].avatar, lat: 24.7350, lng: 46.7000, accuracy: 10, updated_at: new Date(Date.now() - 25 * 60000).toISOString() },
            { user_id: 'u5', name: 'ريم العتيبي', handle: 'reem_foodie', avatar: DB.users[4].avatar, lat: 24.6920, lng: 46.6900, accuracy: 18, updated_at: new Date(Date.now() - 32 * 60000).toISOString() },
            { user_id: 'u6', name: 'خالد المطيري', handle: 'khaled_photo', avatar: DB.users[5].avatar, lat: 24.7400, lng: 46.6500, accuracy: 14, updated_at: new Date(Date.now() - 45 * 60000).toISOString() }
          ];
          mockLocations.forEach((l, idx) => {
            placePin({
              user_id: l.user_id,
              lat: l.lat,
              lng: l.lng,
              accuracy: l.accuracy,
              updated_at: l.updated_at,
              profiles: { id: l.user_id, name: l.name, avatar_url: l.avatar, handle: l.handle }
            }, idx % 2 === 0 ? '#1e56d6' : '#4ade80');
          });
        } else {
          // Tracked-via-permit get purple border, friends get green
          tracked.forEach(l => placePin(l, '#1e56d6'));
          friends.forEach(l => { if (!trackedIds.has(l.user_id)) placePin(l, '#4ade80'); });
        }

        // Remove pins for users not in the latest data
        for (const [uid, marker] of markers) {
          if (!seen.has(uid)) { map.removeLayer(marker); markers.delete(uid); }
        }

        // Sort by most recent activity, then render the bottom-sheet list
        sheetItems.sort((a, b) => new Date(b.l.updated_at) - new Date(a.l.updated_at));
        renderSheet(sheetItems);

        // If we were asked to focus on a specific user, zoom in on them
        if (focusUserId && markers.has(focusUserId)) {
          flyToUser(focusUserId);
        }
      } catch (e) { console.warn('map refresh:', e); }
    }

    // Subscribe to realtime location changes
    let unsub = null;
    let mapResizeObserver = null;
    (async () => {
      await initMap();
      if (window.API) unsub = window.API.subscribeToFriendLocations(() => refresh());
    })();

    // Re-render the sheet every 30s so timestamps ("now", "منذ N د") stay fresh
    const tickerId = setInterval(() => { if (map) refresh(); }, 30000);
    window.addEventListener('hashchange', () => { clearInterval(tickerId); }, { once: true });

    window.addEventListener('hashchange', () => {
      if (mapResizeObserver) try { mapResizeObserver.disconnect(); } catch (e) {}
      if (map) try { map.remove(); } catch (e) {}
      if (unsub) try { unsub(); } catch (e) {}
    }, { once: true });

    return root;
  };

  // ===== Saved videos (dedicated screen, like Instagram's Saved) =====
  V.saved = () => {
    hideNav();
    const root = el('section', { class: 'settings' });
    root.appendChild(topBar({ title: 'المحفوظات' }));
    const grid = el('div', { class: 'video-grid', style: { padding: '4px' } });
    root.appendChild(grid);

    async function load() {
      grid.innerHTML = '';
      if (!window.API) {
        grid.appendChild(emptyState({ icon: 'bookmark', title: 'لا توجد عناصر محفوظة', sub: 'احفظ الفيديوهات لمشاهدتها لاحقًا — ستظهر هنا' }));
        return;
      }
      try {
        const rows = await window.API.fetchSavedVideos();
        if (!rows.length) {
          grid.appendChild(emptyState({
            icon: 'bookmark',
            title: 'لا توجد عناصر محفوظة',
            sub: 'احفظ الفيديوهات لمشاهدتها لاحقًا — ستظهر هنا',
            actionLabel: 'تصفح الفيديوهات', onAction: () => go('/home'),
          }));
          return;
        }
        rows.forEach((v, i) => grid.appendChild(createVideoCard(v, i, () => go(isRealId(v.id) ? '/v/' + v.id : '/home'))));
      } catch (e) {
        console.warn('saved videos load failed:', e);
        grid.innerHTML = '';
        grid.appendChild(errorState(load));
      }
    }
    load();
    return root;
  };

  // ===== Blocked users =====
  V.blockedUsers = () => {
    hideNav();
    const root = el('section', { class: 'settings' });
    root.appendChild(topBar({ title: 'المستخدمون المحظورون' }));
    const list = el('div', { class: 'user-list' });
    root.appendChild(list);

    async function load() {
      list.innerHTML = '<div class="muted" style="padding:30px;text-align:center">جاري التحميل...</div>';
      try {
        if (!window.API) return;
        const rows = await window.API.fetchBlocked();
        list.innerHTML = '';
        if (!rows.length) {
          list.appendChild(el('div', { class: 'empty-state', style: { padding: '60px 20px', textAlign: 'center', color: 'var(--muted)' } }, [
            el('div', { style: { fontSize: '38px', marginBottom: '8px' } }, '🚫'),
            el('div', {}, 'لا يوجد مستخدمون محظورون'),
            el('div', { style: { fontSize: '12px', marginTop: '6px' } }, 'يمكنك حظر أي شخص من بروفايله'),
          ]));
          return;
        }
        // API.fetchBlocked returns profile rows already — { id, name, handle,
        // avatar_url }. This used to read `r.profiles || { id: r.blocked_id }`,
        // unwrapping a shape the API stopped returning, so `p` was
        // `{ id: undefined }` for every row: the whole screen rendered blank
        // names and bare "@", and Unblock called unblockUser(undefined), which
        // deleted nothing and still said "تم إلغاء الحظر".
        rows.forEach(p => {
          if (!p || !p.id) return;
          const row = el('div', { class: 'inbox-item', style: { padding: '12px 14px', borderBottom: '1px solid var(--border)' } });

          // A mutual block hides the other person's profile from you (0054),
          // so name and handle can legitimately be empty. Say so rather than
          // rendering a nameless row you cannot identify.
          const known = !!(p.name || p.handle);
          const shownName = p.name || p.handle || 'حساب محظور';

          // Avatar: safe DOM-built <img> with URL whitelist
          row.appendChild(avatar(safeUrl(p.avatar_url) || '', shownName, 44));

          row.appendChild(el('div', { style: { flex: '1', minWidth: '0' } }, [
            el('div', { style: { fontWeight: '600' } }, shownName),
            el('div', { class: 'muted', style: { fontSize: '12px' } },
              known ? '@' + (p.handle || '') : 'هذا الحساب حظرك أيضًا'),
          ]));

          const unblockBtn = el('button', { class: 'btn btn-secondary', style: { padding: '6px 14px' } }, 'إلغاء الحظر');
          unblockBtn.onclick = async () => {
            const yes = await confirmDialog({
              title: 'إلغاء الحظر',
              message: 'سيتمكن ' + shownName + ' من رؤية حسابك ومراسلتك مجددًا.',
              confirmLabel: 'إلغاء الحظر',
            });
            if (!yes) return;
            // The row goes only after the delete comes back. Removing it up
            // front would show a block as lifted that the server still has.
            unblockBtn.disabled = true;
            const was = unblockBtn.textContent;
            unblockBtn.textContent = '...';
            try {
              await window.API.unblockUser(p.id);
              toast('تم إلغاء الحظر');
              load();
            } catch (e) {
              unblockBtn.textContent = was;
              unblockBtn.disabled = false;
              toast(friendlyError(e, 'تعذر إلغاء الحظر'));
            }
          };
          row.appendChild(unblockBtn);
          list.appendChild(row);
        });
      } catch (e) {
        // Was innerHTML with the raw error interpolated into it. Built as a
        // text node instead, and through friendlyError so the reader gets a
        // sentence rather than a Postgres code.
        list.innerHTML = '';
        list.appendChild(el('div', {
          class: 'muted',
          style: { padding: '30px', textAlign: 'center', color: 'var(--danger)' },
        }, friendlyError(e, 'تعذر تحميل قائمة المحظورين')));
      }
    }
    load();
    return root;
  };

  // ===== Settings =====
  V.settings = () => {
    hideNav();
    const root = el('section', { class: 'settings' });
    root.appendChild(topBar({ title: 'الإعدادات والخصوصية' }));
    function section(title, items) {
      const s = el('div', { class: 'settings-section' });
      s.appendChild(el('h3', {}, title));
      items.forEach(it => {
        let act = it.onclick;
        if (!act && it.right && it.right.classList && it.right.classList.contains('toggle')) {
          act = () => it.right.click();
        }
        s.appendChild(el('div', { class: 'settings-item', onclick: act || (() => toast('قريبًا')) }, [
        el('span', { class: 'si-icon', html: icons[it.icon] || icons.settings }),
        el('span', { class: 'si-text' }, it.label),
          it.right || el('span', { class: 'chev', html: icons.chevL }),
        ]));
      });
      root.appendChild(s);
    }
    function makeToggle(initialOn, onChange) {
      const t = el('div', { class: 'toggle' + (initialOn ? ' on' : ''), onclick: async e => {
        e.stopPropagation();
        t.classList.toggle('on');
        const on = t.classList.contains('on');
        try { await onChange(on); }
        catch (err) { t.classList.toggle('on'); toast(friendlyError(err, 'تعذر التحديث')); }
      } });
      return t;
    }

    // Toggles bound to a real column. Every one of these previously called an
    // empty function, so nothing was ever saved.
    const settingToggles = {};
    function settingToggle(key) {
      const t = makeToggle(true, async (on) => {
        await window.API.updateUserSettings({ [key]: on });
        // Playback preferences are read from a module-level cache, so it has
        // to be refreshed or the change would not show until a reload.
        if (key === 'autoplay' || key === 'data_saver') {
          try { await window.refreshPlaybackPrefs(); } catch (e) {}
        }
      });
      settingToggles[key] = t;
      return t;
    }

    // A row whose trailing control is a value the user picks from a sheet.
    const settingChoices = {};
    function choiceRow(key, options) {
      const label = el('span', { class: 'muted' }, options[0].l);
      settingChoices[key] = { el: label, options };
      return label;
    }
    function openChoice(key, title) {
      const cfg = settingChoices[key];
      if (!cfg) return;
      const sheet = el('div', { class: 'sheet', style: { padding: '8px 0 14px' } });
      const close = modal(sheet);
      sheet.appendChild(el('div', { class: 'sheet-title' }, title));
      cfg.options.forEach(o => sheet.appendChild(el('button', {
        class: 'sheet-opt' + (cfg.current === o.v ? ' active' : ''),
        onclick: async () => {
          close();
          const prev = cfg.current;
          cfg.current = o.v;
          cfg.el.textContent = o.l;
          try { if (window.I18N) window.I18N.apply(cfg.el); } catch (e) {}
          try { await window.API.updateUserSettings({ [key]: o.v }); }
          catch (err) {
            cfg.current = prev;
            const back = cfg.options.find(x => x.v === prev);
            if (back) cfg.el.textContent = back.l;
            toast(friendlyError(err, 'تعذر التحديث'));
          }
        },
      }, o.l)));
      try { if (window.I18N) window.I18N.apply(sheet); } catch (e) {}
    }

    const LOC_WITH = [
      { v: 'friends',  l: 'الأصدقاء' },
      { v: 'everyone', l: 'الجميع' },
      { v: 'none',     l: 'لا أحد' },
    ];
    const locWith = el('span', { class: 'muted' }, 'الأصدقاء');
    locWith.dataset.v = 'friends';

    // Drives sharing_enabled, which is what the read policy actually checks.
    // Sharing is 18+, enforced by a database trigger - this collects the
    // birthday from accounts that predate the signup wizard, and refuses
    // minors with a sentence instead of a server error.
    const locShareToggle = makeToggle(false, async (on) => {
      if (!window.API) return;
      if (on) {
        let bd = await window.API.getMyBirthDate();
        if (!bd) {
          const v = await ask({
            title: 'تاريخ الميلاد',
            message: 'مشاركة الموقع متاحة لمن هم 18 عامًا فما فوق. أدخل تاريخ ميلادك للمتابعة — لا يمكن تغييره لاحقًا.',
            type: 'date',
            confirmLabel: 'حفظ',
          });
          if (!v) throw new Error('لم يتم التفعيل');
          await window.API.saveBirthDate(v);
        }
        if (!(await window.API.isAdult())) {
          throw new Error('مشاركة الموقع متاحة لمن هم 18 عامًا فما فوق');
        }
      }
      await window.API.setLocationSharing(on);
      toast(on ? 'تمت مشاركة موقعك' : 'تم إيقاف المشاركة');
    });

    const reqCount = el('span', { class: 'muted' }, '');
    (async () => {
      try {
        const n = await window.API.countFollowRequests();
        reqCount.textContent = n ? String(n) : '';
      } catch (e) {}
    })();

    const REACH = [
      { v: 'everyone',  l: 'الجميع' },
      { v: 'following', l: 'الأشخاص الذين أتابعهم' },
      { v: 'nobody',    l: 'لا أحد' },
    ];

    // ── Account ──
    section('الحساب', [
      { icon: 'user', label: 'تعديل البروفايل', onclick: () => go('/profile/edit') },
      { icon: 'lock', label: 'تغيير كلمة المرور', onclick: () => go('/change-password') },
      { icon: 'mail', label: 'تغيير البريد الإلكتروني', onclick: () => go('/change-email') },
      { icon: 'heart', label: 'نشاط الحساب', onclick: () => go('/settings/activity') },
      { icon: 'user', label: 'متابعة ودعوة الأصدقاء', onclick: () => go('/invite') },
      { icon: 'bookmark', label: 'المحفوظات', onclick: () => go('/saved') },
    ]);

    // ── Privacy ──
    const privateToggle = makeToggle(false, async (on) => {
      if (!window.API) throw new Error('غير متصل');
      await window.API.setPrivate(on);
      toast(on ? 'حسابك أصبح خاصًا' : 'حسابك أصبح عامًا');
    });
    // Reflect current state from the database. Without this the screen always
    // rendered the defaults, whatever the user had actually chosen.
    (async () => {
      try {
        if (!window.API) return;
        try {
          const s = await window.API.fetchMySettings();
          if (s && s.is_private) privateToggle.classList.add('on');
        } catch (e) {}

        // Location lives in its own table, so it loads separately.
        try {
          const loc = await window.API.fetchMyLocationSettings();
          locShareToggle.classList.toggle('on', loc.sharing_enabled);
          locWith.dataset.v = loc.visibility;
          const match = LOC_WITH.find(o => o.v === loc.visibility);
          if (match) locWith.textContent = match.l;
        } catch (e) {}

        const cfg = await window.API.fetchUserSettings();
        Object.keys(settingToggles).forEach(k => {
          settingToggles[k].classList.toggle('on', cfg[k] !== false);
        });
        Object.keys(settingChoices).forEach(k => {
          const c = settingChoices[k];
          c.current = cfg[k] || c.options[0].v;
          const match = c.options.find(o => o.v === c.current) || c.options[0];
          c.el.textContent = match.l;
        });
        try { if (window.I18N) window.I18N.apply(root); } catch (e) {}
      } catch (e) { console.warn('settings load:', e); }
    })();
    section('الخصوصية والأمان', [
      { icon: 'eye', label: 'الحساب خاص', right: privateToggle },
      { icon: 'user', label: 'من يمكنه مراسلتي', right: choiceRow('who_can_message', REACH),
        onclick: () => openChoice('who_can_message', 'من يمكنه مراسلتي') },
      { icon: 'comment', label: 'من يمكنه التعليق', right: choiceRow('who_can_comment', REACH),
        onclick: () => openChoice('who_can_comment', 'من يمكنه التعليق') },
      { icon: 'user', label: 'من يمكنه الإشارة إلي', right: choiceRow('who_can_tag', REACH),
        onclick: () => openChoice('who_can_tag', 'من يمكنه الإشارة إلي') },
      { icon: 'user', label: 'طلبات المتابعة', right: reqCount, onclick: () => go('/follow-requests') },
      { icon: 'user', label: 'الأصدقاء المقربون', onclick: () => go('/close-friends') },
      { icon: 'comment', label: 'الكلمات المخفية', onclick: () => go('/hidden-words') },
      { icon: 'eye', label: 'الحسابات المقيّدة', onclick: () => go('/restricted') },
      { icon: 'user', label: 'الحسابات المكتومة', onclick: () => go('/muted') },
      { icon: 'lock', label: 'المستخدمون المحظورون', onclick: () => go('/blocked') },
      { icon: 'phone', label: 'أجهزة تسجيل الدخول', onclick: () => go('/settings/devices') },
      { icon: 'settings', label: 'أذونات الجهاز', onclick: () => go('/settings/permissions') },
      { icon: 'flag', label: 'مراجعة طلبات تتبع موقعي', onclick: async () => {
        try {
          const incoming = await window.API.fetchIncomingPermits();
          if (!incoming.length) return toast('لا توجد طلبات جديدة');
          toast(incoming.length + ' طلب — راجعها من شاشة الإشعارات');
        } catch (e) { toast(friendlyError(e)); }
      } },
    ]);

    // ── Notifications ──
    section('الإشعارات', [
      { icon: 'bell', label: 'إعدادات الإشعارات', onclick: () => go('/settings/notifications') },
    ]);

    // ── Content & Display ──
    section('المحتوى والعرض', [
      { icon: 'globe', label: 'اللغة', right: langSwitch() },
      // Reads the live state rather than localStorage: dark is now the default
      // for a signed-in user, so nothing is stored until they touch this, and
      // reading storage would show the switch off on a visibly dark screen.
      { icon: 'sparkle', label: 'الوضع الداكن', right: makeToggle(document.body.classList.contains('dark'), async (on) => {
        document.body.classList.toggle('dark', on);
        localStorage.setItem('tt-theme', on ? 'dark' : 'light');
      }) },
      { icon: 'video', label: 'تشغيل تلقائي للفيديو', right: settingToggle('autoplay') },
      { icon: 'eye', label: 'حفظ بيانات الإنترنت', right: settingToggle('data_saver') },
      { icon: 'bookmark', label: 'الأرشفة والتنزيل', onclick: () => go('/settings/archive') },
    ]);

    // ── Location ──
    section('الموقع الجغرافي', [
      { icon: 'map', label: 'خريطة الأصدقاء', onclick: () => go('/map') },
      { icon: 'map', label: 'مشاركة موقعي مع', right: locWith,
        onclick: () => {
          const sheet = el('div', { class: 'sheet', style: { padding: '8px 0 14px' } });
          const close = modal(sheet);
          sheet.appendChild(el('div', { class: 'sheet-title' }, 'مشاركة موقعي مع'));
          LOC_WITH.forEach(o => sheet.appendChild(el('button', {
            class: 'sheet-opt' + (locWith.dataset.v === o.v ? ' active' : ''),
            onclick: async () => {
              close();
              const prev = locWith.dataset.v, prevText = locWith.textContent;
              locWith.dataset.v = o.v; locWith.textContent = o.l;
              try { if (window.I18N) window.I18N.apply(locWith); } catch (e) {}
              try { await window.API.setLocationVisibility(o.v); }
              catch (err) { locWith.dataset.v = prev; locWith.textContent = prevText; toast(friendlyError(err, 'تعذر التحديث')); }
            },
          }, o.l)));
          try { if (window.I18N) window.I18N.apply(sheet); } catch (e) {}
        } },
      { icon: 'map', label: 'تفعيل مشاركة الموقع', right: locShareToggle },
    ]);

    // ── Support & Legal ──
    section('الدعم والقانوني', [
      { icon: 'flag', label: 'الإبلاغ عن مشكلة', onclick: () => go('/report-problem') },
      { icon: 'mail', label: 'تواصل معنا', onclick: () => go('/contact') },
      { icon: 'globe', label: 'الشروط وسياسة الخصوصية', onclick: () => go('/legal') },
      { icon: 'sparkle', label: 'حول التطبيق', right: el('span', { class: 'muted' }, 'الإصدار 1.0.0'),
        onclick: () => {
          const sheet = el('div', { class: 'sheet about-sheet' });
          const close = modal(sheet);
          sheet.appendChild(el('div', { class: 'about-logo' }, 'FLYP'));
          sheet.appendChild(el('div', { class: 'about-ver' }, 'الإصدار 1.0.0'));
          [
            ['الشروط وسياسة الخصوصية', () => { close(); go('/legal'); }],
            ['تواصل معنا', () => { close(); go('/contact'); }],
            ['تواصل معنا', () => { close(); window.location.href = 'mailto:support@flyp-sa.com'; }],
          ].forEach(([l, fn]) => sheet.appendChild(el('button', { class: 'sheet-opt', onclick: fn }, l)));
          sheet.appendChild(el('div', { class: 'about-foot' }, '© 2026 FLYP'));
          try { if (window.I18N) window.I18N.apply(sheet); } catch (e) {}
        } },
    ]);

    // ── Danger ──
    section('منطقة الخطر', [
      { icon: 'settings', label: 'حالة الحساب', onclick: () => go('/account-status') },
    ]);

    // Admin section — only renders if the signed-in user has is_admin = true
    (async () => {
      try {
        if (!window.API) return;
        const isAdmin = await window.API.adminCheckIsAdmin();
        if (!isAdmin) return;
        const adminSec = el('div', { class: 'settings-section', style: { background: 'var(--primary-soft)' } });
        adminSec.appendChild(el('h3', { style: { color: 'var(--primary-2)' } }, 'الإدارة'));
        const item = el('div', { class: 'settings-item', onclick: () => { window.location.href = '/admin'; } }, [
          el('span', { class: 'si-icon', style: { background: 'var(--primary)', color: '#fff' }, html: icons.settings }),
          el('span', { class: 'si-text', style: { fontWeight: 700 } }, 'فتح لوحة التحكم الإدارية'),
          el('span', { class: 'chev', html: icons.chevL }),
        ]);
        adminSec.appendChild(item);
        // Insert before the logout section
        root.insertBefore(adminSec, root.lastElementChild);
      } catch (e) { /* not admin or API failed */ }
    })();

    const logout = el('div', { class: 'settings-section' });
    logout.appendChild(el('div', { class: 'settings-item', onclick: async () => {
      try { await window.SB.signOut(); } catch (e) {}
      // The cached profile and session id belong to the account that just left.
      clearProfileCache();
      try { localStorage.removeItem('tt-session-id'); } catch (e) {}
      go('/login');
      toast('تم تسجيل الخروج');
    } }, [
      el('span', { class: 'si-text', style: { color: 'var(--danger)', textAlign: 'center', fontWeight: 700 } }, 'تسجيل الخروج'),
    ]));
    root.appendChild(logout);
    return root;
  };

  // ===== Password reset by code =====
  // One screen, two steps: verify the emailed code, then set the new password.
  // A link-based reset cannot work in the app shell, because the link opens the
  // phone's browser rather than the app.
  V.resetOtp = () => {
    hideNav();
    const root = el('section', { class: 'auth-screen' });
    root.appendChild(topBar({ title: 'إعادة تعيين كلمة المرور', onBack: () => go('/forgot') }));

    let email = '';
    try { email = (JSON.parse(sessionStorage.getItem('tt-reset-email') || '""')) || ''; } catch (e) {}

    const wrap = el('div', { style: { padding: '14px 4px', textAlign: 'center' } });
    root.appendChild(wrap);

    if (!email) {
      wrap.appendChild(emptyState({
        icon: 'mail',
        title: 'انتهت الجلسة',
        sub: 'ابدأ من جديد لإرسال رمز جديد',
        actionLabel: 'رجوع',
        onAction: () => go('/forgot'),
      }));
      try { if (window.I18N) window.I18N.apply(root); } catch (e) {}
      return root;
    }

    // ---- Step 1: the code ----
    const step1 = el('div');
    step1.appendChild(el('h2', { class: 'auth-title' }, 'أدخل رمز التحقق'));
    step1.appendChild(el('p', { class: 'auth-subtitle' }, 'أرسلنا رمز التحقق إلى'));
    step1.appendChild(el('p', { class: 'reset-email' }, email));

    const inputs = [];
    const row = el('div', { class: 'otp-row' });
    for (let i = 0; i < OTP_LEN; i++) {
      const inp = el('input', { class: 'otp-input', maxLength: 1, inputMode: 'numeric', autocomplete: i === 0 ? 'one-time-code' : 'off' });
      inp.addEventListener('input', () => {
        inp.value = inp.value.replace(/[^0-9]/g, '');
        // Retyping over a rejected code should start clean, not edit it.
        if (!codeErr.hidden) {
          inputs.forEach((x, k) => { if (k !== i) x.value = ''; });
        }
        if (inp.value && i < OTP_LEN - 1) inputs[i + 1].focus();
        codeErr.hidden = true;
        verifyBtn.disabled = !otpReady(inputs);
      });
      inp.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !inp.value && i > 0) inputs[i - 1].focus();
      });
      // Pasting the whole code into the first box should fill all six.
      inp.addEventListener('paste', e => {
        const t = (e.clipboardData || window.clipboardData).getData('text').replace(/[^0-9]/g, '');
        if (t.length < 2) return;
        e.preventDefault();
        t.slice(0, OTP_LEN).split('').forEach((ch, k) => { if (inputs[k]) inputs[k].value = ch; });
        inputs[Math.min(t.length, OTP_LEN) - 1].focus();
        verifyBtn.disabled = !otpReady(inputs);
      });
      inputs.push(inp);
      row.appendChild(inp);
    }
    step1.appendChild(row);

    const codeErr = el('div', { class: 'error-box', hidden: true, style: { marginTop: '12px' } });
    step1.appendChild(codeErr);

    // A resend that is available instantly invites hammering an inbox that is
    // rate limited anyway, so it unlocks on a timer.
    const resendLink = el('a', { class: 'auth-link' }, 'إعادة الإرسال');
    const resendWrap = el('div', { class: 'otp-resend' }, [
      document.createTextNode('لم يصلك الرمز؟ '),
      resendLink,
    ]);
    step1.appendChild(resendWrap);

    let ticking = 0, timer = null;
    function startCooldown(sec) {
      ticking = sec;
      resendLink.classList.add('disabled');
      clearInterval(timer);
      const tick = () => {
        if (ticking <= 0) {
          clearInterval(timer);
          resendLink.classList.remove('disabled');
          resendLink.textContent = 'إعادة الإرسال';
          try { if (window.I18N) window.I18N.apply(resendLink); } catch (e) {}
          return;
        }
        resendLink.textContent = 'إعادة الإرسال (' + ticking + ')';
        ticking--;
      };
      tick();
      timer = setInterval(tick, 1000);
    }

    resendLink.onclick = async () => {
      if (resendLink.classList.contains('disabled')) return;
      try {
        await window.SB.resetPassword(email);
        toast('تم إرسال الرمز مرة أخرى');
        startCooldown(RESEND_COOLDOWN);
      } catch (e) { codeErr.textContent = mapAuthError(e); codeErr.hidden = false; }
    };
    startCooldown(RESEND_COOLDOWN);

    const verifyBtn = el('button', { class: 'btn btn-pill', disabled: true, style: { marginTop: '22px' } }, 'تحقق');
    step1.appendChild(verifyBtn);
    wrap.appendChild(step1);

    // ---- Step 2: the new password ----
    const step2 = el('div', { style: { display: 'none' } });
    step2.appendChild(el('h2', { class: 'auth-title' }, 'كلمة مرور جديدة'));
    step2.appendChild(el('p', { class: 'auth-subtitle' }, 'اختر كلمة مرور لم تستخدمها من قبل'));

    const pw1 = el('input', { class: 'input', type: 'password', placeholder: 'كلمة المرور الجديدة', autocomplete: 'new-password' });
    const pw2 = el('input', { class: 'input', type: 'password', placeholder: 'أعد كتابة كلمة المرور', autocomplete: 'new-password' });
    step2.appendChild(el('div', { class: 'input-wrap' }, [pw1]));

    const reqList = el('ul', { class: 'sec-reqs', style: { textAlign: 'start', padding: '0 6px', margin: '10px 0 14px' } });
    const reqRows = passwordChecks('').map(r => {
      const li = el('li', {}, [el('span', { class: 'sec-tick', html: icons.check }), el('span', {}, r.label)]);
      reqList.appendChild(li);
      return li;
    });
    step2.appendChild(reqList);
    step2.appendChild(el('div', { class: 'input-wrap' }, [pw2]));

    const pwErr = el('div', { class: 'error-box', hidden: true, style: { marginTop: '12px' } });
    step2.appendChild(pwErr);

    const saveBtn = el('button', { class: 'btn btn-pill', disabled: true, style: { marginTop: '22px' } }, 'حفظ كلمة المرور');
    step2.appendChild(saveBtn);
    wrap.appendChild(step2);

    function validatePw() {
      const v = pw1.value;
      const checks = passwordChecks(v);
      checks.forEach((c, i) => reqRows[i].classList.toggle('ok', c.ok));
      saveBtn.disabled = !(checks.every(c => c.ok) && pw2.value === v && v.length > 0);
    }
    pw1.addEventListener('input', () => { pwErr.hidden = true; validatePw(); });
    pw2.addEventListener('input', () => { pwErr.hidden = true; validatePw(); });

    verifyBtn.onclick = async () => {
      const code = inputs.map(x => x.value).join('');
      if (code.length < OTP_MIN) return;
      verifyBtn.disabled = true;
      verifyBtn.textContent = 'جاري التحقق...';
      try { if (window.I18N) window.I18N.apply(verifyBtn); } catch (e) {}
      try {
        // Verifying a recovery code signs this device in just long enough to
        // set a new password.
        await window.SB.verifyRecoveryCode(email, code);
        clearInterval(timer);
        step1.style.display = 'none';
        step2.style.display = '';
        setTimeout(() => pw1.focus(), 60);
      } catch (e) {
        codeErr.textContent = mapAuthError(e);
        codeErr.hidden = false;
        // The digits stay put. Clearing them left an error message sitting
        // next to six empty boxes, which reads as an error about nothing -
        // especially after the tab has been in the background a while.
        // Selecting instead means the next keystroke replaces the code.
        inputs[0].focus();
        inputs[0].select();
        verifyBtn.textContent = 'تحقق';
        verifyBtn.disabled = true;
        try { if (window.I18N) window.I18N.apply(verifyBtn); } catch (e2) {}
      }
    };

    saveBtn.onclick = async () => {
      if (pw1.value !== pw2.value) { pwErr.textContent = 'كلمتا المرور غير متطابقتين'; pwErr.hidden = false; return; }
      if (isCommonPassword(pw1.value)) {
        pwErr.textContent = 'هذه كلمة مرور شائعة جدًا، اختر غيرها';
        pwErr.hidden = false; return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = 'جاري الحفظ...';
      try { if (window.I18N) window.I18N.apply(saveBtn); } catch (e) {}
      try {
        await window.SB.updatePassword(pw1.value);
        try { sessionStorage.removeItem('tt-reset-email'); } catch (e) {}
        toast('تم تغيير كلمة المرور');
        go('/home');
      } catch (e) {
        pwErr.textContent = mapAuthError(e);
        pwErr.hidden = false;
        saveBtn.textContent = 'حفظ كلمة المرور';
        saveBtn.disabled = false;
        try { if (window.I18N) window.I18N.apply(saveBtn); } catch (e2) {}
      }
    };

    try { if (window.I18N) window.I18N.apply(root); } catch (e) {}
    return root;
  };

  // ===== Follow requests =====
  // Only reachable while the account is private - a public account never
  // collects requests, because following it just works.
  V.followRequests = () => {
    hideNav();
    const root = el('section', { class: 'settings' });
    root.appendChild(topBar({ title: 'طلبات المتابعة' }));
    const list = el('div', { class: 'user-list' });
    root.appendChild(list);

    async function refresh() {
      list.innerHTML = '';
      list.appendChild(loading());
      let rows = [];
      try { rows = await window.API.fetchFollowRequests(); }
      catch (e) { list.innerHTML = ''; list.appendChild(errorState(refresh, e.message)); return; }
      list.innerHTML = '';
      if (!rows.length) {
        list.appendChild(emptyState({
          icon: 'user', title: 'لا توجد طلبات',
          sub: 'ستظهر هنا طلبات متابعة حسابك الخاص',
        }));
        try { if (window.I18N) window.I18N.apply(list); } catch (e) {}
        return;
      }
      rows.forEach(p => {
        const approve = el('button', { class: 'inline-follow' }, 'قبول');
        const decline = el('button', { class: 'mod-undo' }, 'رفض');
        const act = (fn) => async (e) => {
          e.stopPropagation();
          approve.disabled = decline.disabled = true;
          try { await fn(p.id); refresh(); }
          catch (err) { approve.disabled = decline.disabled = false; toast(friendlyError(err, 'تعذر التحديث')); }
        };
        approve.onclick = act(id => window.API.approveFollowRequest(id));
        decline.onclick = act(id => window.API.declineFollowRequest(id));
        list.appendChild(el('div', { class: 'user-row', style: { padding: '10px 16px' }, onclick: () => go('/profile/' + p.id) }, [
          avatar(p.avatar_url || '', p.name || p.handle || '', 44),
          el('div', { style: { flex: 1, minWidth: 0 } }, [
            el('div', { class: 'name' }, p.name || p.handle || ''),
            el('div', { class: 'handle' }, '@' + (p.handle || '')),
          ]),
          el('div', { class: 'req-actions' }, [approve, decline]),
        ]));
      });
      try { if (window.I18N) window.I18N.apply(list); } catch (e) {}
    }

    refresh();
    return root;
  };

  // ===== Shared building blocks for the settings sub-screens =====

  function agoText(iso) {
    if (!iso) return '';
    const t = Date.now() - new Date(iso).getTime();
    const m = Math.floor(t / 60000);
    if (m < 1) return 'الآن';
    if (m < 60) return 'منذ ' + m + ' د';
    const h = Math.floor(m / 60);
    if (h < 24) return 'منذ ' + h + ' س';
    const d = Math.floor(h / 24);
    return 'منذ ' + d + ' يوم';
  }

  function loading() {
    return el('div', { class: 'muted', style: { padding: '26px', textAlign: 'center' } }, 'جاري التحميل...');
  }

  // A settings-style list usable on any screen, not just the root page.
  function subList(items) {
    const box = el('div', { class: 'settings-section' });
    items.forEach(it => {
      let act = it.onclick;
      if (!act && it.right && it.right.classList && it.right.classList.contains('toggle')) {
        act = () => it.right.click();
      }
      box.appendChild(el('div', { class: 'settings-item', onclick: act || (() => toast('قريبًا')) }, [
        el('span', { class: 'si-icon', html: icons[it.icon] || icons.settings }),
        el('span', { class: 'si-text' }, it.label),
        it.right || el('span', { class: 'chev', html: icons.chevL }),
      ]));
    });
    return box;
  }

  // ===== Legal documents =====
  // Was a link out to a GitHub markdown file, which drops people onto a
  // developer site. App stores expect these reachable and readable in-product.
  //
  // Both languages are written out rather than run through the phrase
  // dictionary: that matches whole text nodes, and a paragraph of legal prose
  // is not a UI label. Wording this consequential should be authored, not
  // string-substituted.
  const LEGAL_UPDATED = '2026-08-29';

  const LEGAL_DOCS = {
    terms: {
      title: { ar: 'شروط الخدمة', en: 'Terms of Service' },
      sections: [
        {
          h: { ar: 'قبول الشروط', en: 'Accepting these terms' },
          p: {
            ar: 'باستخدامك تطبيق FLYP فإنك توافق على هذه الشروط. إذا لم توافق عليها، فلا تستخدم التطبيق. قد نحدّث هذه الشروط، وسنخطرك داخل التطبيق قبل سريان أي تغيير جوهري.',
            en: 'By using FLYP you agree to these terms. If you do not agree, please do not use the app. We may update these terms, and we will tell you in the app before any significant change takes effect.',
          },
        },
        {
          h: { ar: 'من يمكنه استخدام التطبيق', en: 'Who can use the app' },
          p: {
            ar: 'يجب أن يكون عمرك 13 عامًا على الأقل لإنشاء حساب. بعض الميزات، مثل مشاركة الموقع والمزايا المالية، متاحة لمن هم في سن 18 فما فوق. أنت مسؤول عن دقة معلوماتك وعن الحفاظ على سرية كلمة المرور.',
            en: 'You must be at least 13 to create an account. Some features, such as location sharing and anything involving money, are limited to people aged 18 and over. You are responsible for the accuracy of your information and for keeping your password private.',
          },
        },
        {
          h: { ar: 'المحتوى الذي تنشره', en: 'Content you post' },
          p: {
            ar: 'تحتفظ بملكية المحتوى الذي تنشره. بنشره تمنحنا ترخيصًا غير حصري لعرضه وتوزيعه داخل التطبيق لتشغيل الخدمة. يمكنك حذف محتواك في أي وقت، وقد تبقى نسخ في النسخ الاحتياطية لفترة محدودة.',
            en: 'You keep ownership of what you post. By posting it you give us a non-exclusive licence to display and distribute it within the app so the service can run. You can delete your content at any time; copies may remain in backups for a limited period.',
          },
        },
        {
          h: { ar: 'ما هو ممنوع', en: 'What is not allowed' },
          p: {
            ar: 'يُمنع نشر محتوى ينتهك القانون أو حقوق الآخرين، أو يتضمن تحرشًا أو كراهية أو عنفًا أو محتوى جنسيًا أو معلومات مضللة ضارة. يُمنع أيضًا انتحال شخصية غيرك، أو التلاعب بالأرقام، أو محاولة اختراق الخدمة.',
            en: 'Do not post content that breaks the law or infringes other people’s rights, or that involves harassment, hate, violence, sexual content, or harmful misinformation. Do not impersonate anyone, manipulate engagement numbers, or attempt to attack the service.',
          },
        },
        {
          h: { ar: 'إنهاء الحساب', en: 'Ending your account' },
          p: {
            ar: 'يمكنك حذف حسابك في أي وقت من الإعدادات. يجوز لنا تعليق أو إنهاء حساب يخالف هذه الشروط، وسنوضح السبب متى أمكن ذلك.',
            en: 'You can delete your account at any time from Settings. We may suspend or end an account that breaks these terms, and we will explain why where we can.',
          },
        },
        {
          h: { ar: 'حدود المسؤولية', en: 'Limits of our responsibility' },
          p: {
            ar: 'يُقدَّم التطبيق كما هو. لا نضمن أن يكون متاحًا دون انقطاع أو خاليًا من الأخطاء. لا نتحمل مسؤولية المحتوى الذي ينشره المستخدمون الآخرون.',
            en: 'The app is provided as it is. We do not guarantee it will be available without interruption or free of faults, and we are not responsible for content other people post.',
          },
        },
      ],
    },

    privacy: {
      title: { ar: 'سياسة الخصوصية', en: 'Privacy Policy' },
      sections: [
        {
          h: { ar: 'ما الذي نجمعه', en: 'What we collect' },
          p: {
            ar: 'بيانات الحساب: الاسم، اسم المستخدم، البريد الإلكتروني أو رقم الهاتف، وصورة الملف الشخصي إن أضفتها. المحتوى: الفيديوهات والتعليقات والرسائل التي ترسلها. بيانات الاستخدام: ما تشاهده ومدة المشاهدة، لترتيب الموجز. بيانات الجهاز: نوع الجهاز والمتصفح، لتشخيص الأعطال.',
            en: 'Account details: your name, username, email or phone number, and profile photo if you add one. Content: the videos, comments, and messages you send. Usage: what you watch and for how long, which is how the feed is ordered. Device: your device and browser type, used to diagnose faults.',
          },
        },
        {
          h: { ar: 'الموقع الجغرافي', en: 'Location' },
          p: {
            ar: 'لا نقرأ موقعك إطلاقًا ما لم تفعّل مشاركة الموقع بنفسك. عند تفعيلها نحتفظ بموقعك الحالي فقط، لا بسجل تحركاتك، ويُحذف بعد سبعة أيام من آخر تحديث. إيقاف المشاركة يمحو الإحداثيات فورًا.',
            en: 'We do not read your location at all unless you switch location sharing on yourself. When it is on we keep only your current position, never a history of your movements, and it is deleted seven days after the last update. Turning sharing off erases the coordinates immediately.',
          },
        },
        {
          h: { ar: 'من يرى بياناتك', en: 'Who can see your data' },
          p: {
            ar: 'ملفك الشخصي ومنشوراتك العامة مرئية لمن تسمح لهم بذلك حسب إعداداتك. رسائلك الخاصة لا تظهر إلا لك ولمن تراسله. لا نبيع بياناتك الشخصية لأي طرف ثالث.',
            en: 'Your profile and public posts are visible to whoever your settings allow. Your private messages are visible only to you and the people you are messaging. We do not sell your personal data to anyone.',
          },
        },
        {
          h: { ar: 'من نستعين بهم', en: 'Who we work with' },
          p: {
            ar: 'نستخدم مزوّدي خدمة لتشغيل التطبيق: استضافة قواعد البيانات والملفات، وإرسال البريد، والبث المباشر. يصل هؤلاء إلى البيانات اللازمة لأداء عملهم فقط.',
            en: 'We use service providers to run the app: database and file hosting, email delivery, and live streaming. They can access only the data needed to do that job.',
          },
        },
        {
          h: { ar: 'كم نحتفظ بها', en: 'How long we keep it' },
          p: {
            ar: 'نحتفظ ببيانات حسابك ما دام حسابك قائمًا. عند حذف الحساب تُحذف بياناتك خلال 30 يومًا، باستثناء ما يلزمنا قانونًا الاحتفاظ به. سجلات الموقع تُحذف خلال سبعة أيام.',
            en: 'We keep your account data for as long as your account exists. When you delete your account, your data is removed within 30 days, apart from anything we are legally required to keep. Location records are deleted within seven days.',
          },
        },
        {
          h: { ar: 'حقوقك', en: 'Your rights' },
          p: {
            ar: 'يمكنك طلب نسخة من بياناتك من الإعدادات، وتصحيح معلوماتك في أي وقت، وحذف حسابك نهائيًا. إذا كنت في نطاق يمنحك حقوقًا إضافية، مثل النظام الأوروبي، فيمكنك مراسلتنا لممارستها.',
            en: 'You can request a copy of your data from Settings, correct your information at any time, and delete your account permanently. If you live somewhere that gives you further rights, such as under GDPR, contact us to exercise them.',
          },
        },
        {
          h: { ar: 'الأطفال', en: 'Children' },
          p: {
            ar: 'التطبيق غير موجّه لمن هم دون 13 عامًا. إذا علمنا بوجود حساب لطفل دون هذه السن، فسنحذفه.',
            en: 'This app is not intended for anyone under 13. If we learn that an account belongs to a child under that age, we will delete it.',
          },
        },
        {
          h: { ar: 'كيف تتواصل معنا', en: 'How to reach us' },
          p: {
            ar: 'لأي سؤال عن الخصوصية، استخدم "تواصل معنا" في الإعدادات أو راسلنا على support@flyp-sa.com.',
            en: 'For any privacy question, use Contact us in Settings or email support@flyp-sa.com.',
          },
        },
      ],
    },
  };

  V.legal = (params) => {
    hideNav();
    const which = (params && params.doc === 'privacy') ? 'privacy' : 'terms';
    const root = el('section', { class: 'legal-screen' });
    root.appendChild(topBar({ title: 'الشروط وسياسة الخصوصية' }));

    const tabs = el('div', { class: 'legal-tabs' });
    const body = el('article', { class: 'legal-doc' });

    const lang = () => {
      try { return (window.I18N && window.I18N.getLang() === 'en') ? 'en' : 'ar'; }
      catch (e) { return 'ar'; }
    };

    let active = which;
    [['terms', 'الشروط'], ['privacy', 'الخصوصية']].forEach(([k, label]) => {
      const b = el('button', { class: 'legal-tab' + (k === active ? ' on' : ''), onclick: () => {
        active = k;
        [...tabs.children].forEach(c => c.classList.toggle('on', c.dataset.k === active));
        render();
        body.scrollTop = 0;
      } }, label);
      b.dataset.k = k;
      tabs.appendChild(b);
    });

    function render() {
      const L = lang();
      const doc = LEGAL_DOCS[active];
      body.innerHTML = '';
      body.setAttribute('dir', L === 'en' ? 'ltr' : 'rtl');
      body.appendChild(el('h1', { class: 'legal-title' }, doc.title[L]));
      body.appendChild(el('p', { class: 'legal-updated' },
        (L === 'en' ? 'Last updated: ' : 'آخر تحديث: ') + LEGAL_UPDATED));
      doc.sections.forEach((sec, i) => {
        body.appendChild(el('h2', { class: 'legal-h' }, (i + 1) + '. ' + sec.h[L]));
        body.appendChild(el('p', { class: 'legal-p' }, sec.p[L]));
      });
      body.appendChild(el('p', { class: 'legal-foot' }, '© 2026 FLYP'));
    }

    root.appendChild(tabs);
    root.appendChild(body);
    render();
    // Only the chrome goes through the dictionary; the document body is
    // already in the right language and must not be touched.
    try { if (window.I18N) window.I18N.apply(tabs); } catch (e) {}
    return root;
  };

  // ===== Report a problem =====
  // Was a mailto: link, which does nothing in the app webview - the button
  // looked dead. Reports now go to a table an operator can work through.
  V.reportProblem = () => {
    hideNav();
    const root = el('section', { class: 'settings sec-screen' });
    const sendBtn = el('button', { class: 'sec-save', disabled: true }, 'إرسال');
    root.appendChild(topBar({ title: 'الإبلاغ عن مشكلة', right: sendBtn }));
    root.appendChild(el('p', { class: 'sec-note' },
      'صف ما حدث بأكبر قدر من التفصيل. نرفق نوع جهازك وإصدار التطبيق تلقائيًا.'));

    const CATS = [
      { v: 'bug', l: 'عطل في التطبيق' },
      { v: 'account', l: 'مشكلة في الحساب' },
      { v: 'payment', l: 'مشكلة في الدفع أو العملات' },
      { v: 'content', l: 'محتوى غير لائق' },
      { v: 'safety', l: 'مشكلة تتعلق بالأمان' },
      { v: 'other', l: 'شيء آخر' },
    ];
    let category = 'bug';

    const chips = el('div', { class: 'rp-chips' });
    CATS.forEach(cat => {
      const b = el('button', { class: 'rp-chip' + (cat.v === category ? ' on' : ''), onclick: () => {
        category = cat.v;
        [...chips.children].forEach(c => c.classList.toggle('on', c.dataset.v === category));
      } }, cat.l);
      b.dataset.v = cat.v;
      chips.appendChild(b);
    });

    const message = el('textarea', { class: 'rp-text', rows: '7', placeholder: 'ما الذي حدث؟', maxlength: '2000' });
    const counter = el('div', { class: 'rp-count' }, '0 / 2000');
    const err = el('p', { class: 'sec-err', style: { display: 'none' } });

    root.appendChild(el('div', { class: 'sec-group' }, [
      el('h3', {}, 'نوع المشكلة'),
      chips,
    ]));
    root.appendChild(el('div', { class: 'sec-group' }, [
      el('h3', {}, 'الوصف'),
      message,
      counter,
      err,
    ]));

    message.addEventListener('input', () => {
      const n = message.value.length;
      counter.textContent = n + ' / 2000';
      err.style.display = 'none';
      // Ten characters is about the shortest useful description.
      sendBtn.disabled = message.value.trim().length < 10;
    });

    sendBtn.onclick = async () => {
      sendBtn.disabled = true;
      sendBtn.textContent = 'جارٍ الإرسال...';
      try { if (window.I18N) window.I18N.apply(sendBtn); } catch (e) {}
      try {
        await window.API.createSupportTicket({ category, message: message.value.trim() });
        root.innerHTML = '';
        root.appendChild(topBar({ title: 'الإبلاغ عن مشكلة' }));
        root.appendChild(emptyState({
          icon: 'check',
          title: 'تم استلام بلاغك',
          sub: 'سنراجعه ونرد عليك داخل التطبيق.',
          actionLabel: 'رجوع',
          onAction: () => back(),
        }));
        try { if (window.I18N) window.I18N.apply(root); } catch (e) {}
        return;
      } catch (e) {
        err.textContent = e.message || 'تعذر الإرسال';
        err.style.display = 'block';
      }
      sendBtn.textContent = 'إرسال';
      sendBtn.disabled = false;
      try { if (window.I18N) window.I18N.apply(sendBtn); } catch (e) {}
    };

    return root;
  };

  // ===== Contact us =====
  V.contactUs = () => {
    hideNav();
    const root = el('section', { class: 'settings sec-screen' });
    root.appendChild(topBar({ title: 'تواصل معنا' }));
    root.appendChild(el('p', { class: 'sec-note' },
      'اختر الطريقة الأنسب لك. البلاغ داخل التطبيق أسرع، لأنه يصلنا مع تفاصيل جهازك.'));

    root.appendChild(subList([
      { icon: 'flag', label: 'الإبلاغ عن مشكلة', onclick: () => go('/report-problem') },
      { icon: 'mail', label: 'مراسلتنا بالبريد', onclick: () => {
        window.location.href = 'mailto:support@flyp-sa.com';
      } },
      { icon: 'globe', label: 'الشروط وسياسة الخصوصية', onclick: () => go('/legal') },
    ]));

    const list = el('div', { class: 'ticket-list' });
    root.appendChild(el('div', { class: 'sec-group' }, [el('h3', {}, 'بلاغاتك السابقة')]));
    root.appendChild(list);

    (async () => {
      list.appendChild(loading());
      let rows = [];
      try { rows = await window.API.fetchMySupportTickets(); }
      catch (e) { rows = []; }
      list.innerHTML = '';
      if (!rows.length) {
        list.appendChild(emptyState({ icon: 'flag', title: 'لا توجد بلاغات سابقة' }));
        try { if (window.I18N) window.I18N.apply(list); } catch (e) {}
        return;
      }
      const STATUS = { open: 'قيد الانتظار', in_progress: 'قيد المعالجة', resolved: 'تم الحل', closed: 'مغلق' };
      rows.forEach(t => {
        list.appendChild(el('div', { class: 'ticket-row' }, [
          el('div', { style: { flex: 1, minWidth: 0 } }, [
            el('div', { class: 'ticket-msg' }, t.message || ''),
            el('div', { class: 'ticket-when' }, agoText(t.created_at)),
            t.admin_reply ? el('div', { class: 'ticket-reply' }, t.admin_reply) : null,
          ].filter(Boolean)),
          el('span', { class: 'ticket-status ' + t.status }, STATUS[t.status] || t.status),
        ]));
      });
      try { if (window.I18N) window.I18N.apply(list); } catch (e) {}
    })();

    return root;
  };

  // ===== Profile by @handle =====
  // Mentions link by handle, not id, so this resolves one to the other and
  // hands off to the normal profile screen.
  V.userByHandle = (params) => {
    hideNav();
    const root = el('section', { class: 'settings' });
    root.appendChild(topBar({ title: '@' + (params.handle || '') }));
    root.appendChild(loading());
    (async () => {
      try {
        const p = await window.API.fetchProfileByHandle(params.handle);
        if (p && p.id) { go('/profile/' + p.id); return; }
        root.innerHTML = '';
        root.appendChild(topBar({ title: '@' + (params.handle || '') }));
        root.appendChild(emptyState({
          icon: 'user',
          title: 'لا يوجد حساب بهذا الاسم',
          sub: '@' + (params.handle || ''),
        }));
        try { if (window.I18N) window.I18N.apply(root); } catch (e) {}
      } catch (e) {
        root.innerHTML = '';
        root.appendChild(errorState(null, e.message));
      }
    })();
    return root;
  };

  // ===== Account status =====
  // The old danger zone was one red row that destroyed everything instantly.
  // There is a large gap between "I want a break" and "erase me", and the two
  // should not look like the same button.
  V.accountStatus = () => {
    hideNav();
    const root = el('section', { class: 'settings sec-screen' });
    root.appendChild(topBar({ title: 'حالة الحساب' }));

    const body = el('div');
    root.appendChild(body);

    function card({ tone, title, lines, cta, onCta }) {
      const ul = el('ul', { class: 'acct-points' });
      lines.forEach(l => ul.appendChild(el('li', {}, l)));
      const btn = el('button', { class: 'acct-btn ' + tone, onclick: onCta }, cta);
      return el('div', { class: 'acct-card ' + tone }, [
        el('h3', { class: 'acct-title' }, title),
        ul,
        btn,
      ]);
    }

    function renderChoices() {
      body.innerHTML = '';
      body.appendChild(el('p', { class: 'sec-note' },
        'يمكنك إخفاء حسابك مؤقتًا أو حذفه نهائيًا. اختر ما يناسبك.'));

      body.appendChild(card({
        tone: 'warn',
        title: 'إيقاف الحساب مؤقتًا',
        lines: [
          'يختفي ملفك الشخصي وفيديوهاتك وتعليقاتك عن الجميع.',
          'لا يُحذف أي شيء، ويعود كل شيء كما كان.',
          'يكفي تسجيل الدخول مرة أخرى لتفعيله.',
        ],
        cta: 'إيقاف مؤقت',
        onCta: doDeactivate,
      }));

      body.appendChild(card({
        tone: 'danger',
        title: 'حذف الحساب نهائيًا',
        lines: [
          'تُحذف فيديوهاتك وتعليقاتك ورسائلك ومتابعوك.',
          // Wallet line removed: there is no wallet screen anywhere in the
          // app, so this warned people about losing something they were
          // never able to see. Restore it if a wallet is ever built.
          'لديك 30 يومًا لتغيير رأيك قبل الحذف الفعلي.',
        ],
        cta: 'متابعة الحذف',
        onCta: renderDeleteWarning,
      }));

      try { if (window.I18N) window.I18N.apply(body); } catch (e) {}
    }

    async function doDeactivate() {
      const sure = await confirmDialog({
        title: 'إيقاف الحساب مؤقتًا',
        message: 'سيختفي حسابك عن الجميع حتى تسجّل الدخول مرة أخرى.',
        confirmLabel: 'إيقاف مؤقت',
      });
      if (!sure) return;
      try {
        await window.API.deactivateAccount();
        toast('تم إيقاف حسابك مؤقتًا');
        go('/login');
      } catch (e) { toast(friendlyError(e, 'تعذر التنفيذ')); }
    }

    // A second screen rather than a dialog: the list of what is lost deserves
    // room, and the extra step is the point.
    function renderDeleteWarning() {
      body.innerHTML = '';
      body.appendChild(el('div', { class: 'acct-warnhead' }, [
        el('span', { class: 'acct-warnicon', html: icons.alert || icons.flag }),
        el('h3', {}, 'هذا الإجراء لا يمكن التراجع عنه'),
      ]));

      const ul = el('ul', { class: 'acct-points danger' });
      [
        'جميع فيديوهاتك وتعليقاتك ستُحذف.',
        'محادثاتك ورسائلك ستُحذف.',
        'متابعوك ومن تتابعهم سيُفقدون.',
        'اسم المستخدم الخاص بك قد يأخذه شخص آخر.',
      ].forEach(l => ul.appendChild(el('li', {}, l)));
      body.appendChild(ul);

      body.appendChild(el('p', { class: 'sec-note' },
        'سيُحذف حسابك بعد 30 يومًا. إذا سجّلت الدخول خلال هذه المدة، يُلغى الحذف تلقائيًا.'));

      const field = el('div', { class: 'sec-field', style: { padding: '0 18px' } }, [
        el('label', { class: 'sec-label' }, 'للتأكيد، اكتب: حذف'),
      ]);
      const input = el('input', { class: 'sec-input' , placeholder: 'اكتب هنا' });
      const box = el('div', { class: 'sec-box' }, [input]);
      field.appendChild(box);
      body.appendChild(field);

      const err = el('p', { class: 'sec-err', style: { display: 'none', margin: '8px 20px 0' } });
      body.appendChild(err);

      const del = el('button', { class: 'acct-btn danger', disabled: true, style: { margin: '18px' } }, 'حذف حسابي');
      const cancel = el('button', { class: 'acct-btn ghost', style: { margin: '0 18px 24px' } }, 'رجوع');
      body.appendChild(del);
      body.appendChild(cancel);

      const ACCEPT = ['حذف', 'delete'];
      input.addEventListener('input', () => {
        err.style.display = 'none';
        box.classList.remove('bad');
        del.disabled = !ACCEPT.includes(input.value.trim().toLowerCase());
      });
      cancel.onclick = renderChoices;

      del.onclick = async () => {
        del.disabled = true;
        del.textContent = 'جارٍ التنفيذ...';
        try { if (window.I18N) window.I18N.apply(del); } catch (e) {}
        try {
          await window.API.scheduleAccountDeletion();
          toast('تم جدولة حذف حسابك');
          go('/login');
          return;
        } catch (e) {
          err.textContent = e.message || 'تعذر التنفيذ';
          err.style.display = 'block';
        }
        del.textContent = 'حذف حسابي';
        del.disabled = false;
        try { if (window.I18N) window.I18N.apply(del); } catch (e) {}
      };

      try { if (window.I18N) window.I18N.apply(body); } catch (e) {}
    }

    // Someone already inside the grace period should be met with a way out,
    // not the menu that got them here.
    (async () => {
      body.appendChild(loading());
      let st = null;
      try { st = await window.API.fetchAccountStatus(); } catch (e) {}
      if (st && st.deletion_scheduled_at) {
        body.innerHTML = '';
        body.appendChild(el('div', { class: 'acct-warnhead' }, [
          el('span', { class: 'acct-warnicon', html: icons.alert || icons.flag }),
          el('h3', {}, 'حسابك مجدول للحذف'),
        ]));
        body.appendChild(el('p', { class: 'sec-note' },
          'تبقّى ' + (st.days_left != null ? st.days_left : 30) + ' يومًا. يمكنك إلغاء الحذف الآن والاحتفاظ بكل شيء.'));
        const keep = el('button', { class: 'acct-btn', style: { margin: '18px' } }, 'إلغاء الحذف والاحتفاظ بحسابي');
        keep.onclick = async () => {
          keep.disabled = true;
          try { await window.API.cancelAccountDeletion(); toast('تم إلغاء الحذف'); renderChoices(); }
          catch (e) { keep.disabled = false; toast(friendlyError(e, 'تعذر التنفيذ')); }
        };
        body.appendChild(keep);
        try { if (window.I18N) window.I18N.apply(body); } catch (e) {}
        return;
      }
      renderChoices();
    })();

    return root;
  };

  // ===== Notifications (moved off the root settings page) =====
  V.notificationSettings = () => {
    hideNav();
    const root = el('section', { class: 'settings' });
    root.appendChild(topBar({ title: 'الإشعارات' }));
    root.appendChild(el('p', { class: 'sec-note' },
      'اختر ما تريد أن نخبرك به. تنبيهات الأمان تصلك دائمًا.'));

    const store = {};
    function tg(key) {
      const t = el('div', { class: 'toggle on', onclick: async (e) => {
        e.stopPropagation();
        t.classList.toggle('on');
        const on = t.classList.contains('on');
        try { await window.API.updateUserSettings({ [key]: on }); }
        catch (err) { t.classList.toggle('on'); toast(friendlyError(err, 'تعذر التحديث')); }
      } });
      store[key] = t;
      return t;
    }

    root.appendChild(subList([
      { icon: 'heart', label: 'الإعجابات', right: tg('notif_likes') },
      { icon: 'comment', label: 'التعليقات', right: tg('notif_comments') },
      { icon: 'user', label: 'المتابعون الجدد', right: tg('notif_follows') },
      { icon: 'mail', label: 'الرسائل', right: tg('notif_messages') },
      { icon: 'video', label: 'البثوث المباشرة', right: tg('notif_live') },
    ]));

    (async () => {
      try {
        const cfg = await window.API.fetchUserSettings();
        Object.keys(store).forEach(k => store[k].classList.toggle('on', cfg[k] !== false));
      } catch (e) { console.warn('notification settings:', e); }
    })();

    try { if (window.I18N) window.I18N.apply(root); } catch (e) {}
    return root;
  };

  // ===== Login activity / devices =====
  V.loginActivity = () => {
    hideNav();
    const root = el('section', { class: 'settings' });
    root.appendChild(topBar({ title: 'أجهزة تسجيل الدخول' }));
    root.appendChild(el('p', { class: 'sec-note' },
      'هذه الأجهزة سجّلت الدخول إلى حسابك. إذا لم تتعرف على أحدها، أزله ثم غيّر كلمة المرور.'));

    const list = el('div', { class: 'dev-list' });
    root.appendChild(list);

    let mine = null;
    try { mine = localStorage.getItem('tt-session-id'); } catch (e) {}

    async function refresh() {
      list.innerHTML = '';
      list.appendChild(loading());
      let rows = [];
      try { rows = await window.API.fetchMySessions(); }
      catch (e) { list.innerHTML = ''; list.appendChild(errorState(refresh)); return; }
      list.innerHTML = '';
      if (!rows.length) {
        list.appendChild(emptyState({
          icon: 'settings', title: 'لا توجد أجهزة مسجّلة',
          sub: 'سيظهر جهازك هنا بعد إعادة فتح التطبيق',
        }));
        try { if (window.I18N) window.I18N.apply(list); } catch (e) {}
        return;
      }
      rows.forEach(r => {
        const isMe = mine && r.id === mine;
        const kind = /mobile|android|ios/i.test(r.platform || '') ? 'phone' : 'settings';
        const right = isMe
          ? el('span', { class: 'dev-current' }, 'هذا الجهاز')
          : el('button', { class: 'mod-undo', onclick: async (e) => {
              const btn = e.currentTarget;
              btn.disabled = true;
              try { await window.API.revokeSession(r.id); refresh(); }
              catch (err) { btn.disabled = false; toast(friendlyError(err, 'تعذر الإزالة')); }
            } }, 'إزالة');
        list.appendChild(el('div', { class: 'dev-row' + (isMe ? ' me' : '') }, [
          el('span', { class: 'dev-icon', html: icons[kind] || icons.settings }),
          el('div', { class: 'dev-meta' }, [
            el('div', { class: 'dev-name' }, r.device || 'جهاز غير معروف'),
            // Two nodes, not one string: the dictionary matches whole text
            // nodes, so a concatenated label would never translate.
            el('div', { class: 'dev-sub' }, [
              el('span', {}, 'آخر نشاط'),
              el('span', {}, ': '),
              el('span', {}, agoText(r.last_seen)),
            ]),
          ]),
          right,
        ]));
      });
      try { if (window.I18N) window.I18N.apply(list); } catch (e) {}
    }

    refresh();
    return root;
  };

  // ===== Device permissions =====
  // Reads the real browser permission state instead of showing a switch that
  // pretends to control something the page cannot actually set.
  V.devicePermissions = () => {
    hideNav();
    const root = el('section', { class: 'settings' });
    root.appendChild(topBar({ title: 'أذونات الجهاز' }));
    root.appendChild(el('p', { class: 'sec-note' },
      'يمنح جهازك هذه الأذونات، لا التطبيق. إذا رُفض إذن، غيّره من إعدادات جهازك.'));

    const PERMS = [
      { key: 'camera', icon: 'camera', label: 'الكاميرا', why: 'لتصوير الفيديوهات والبث المباشر',
        request: () => navigator.mediaDevices.getUserMedia({ video: true }) },
      { key: 'microphone', icon: 'mic', label: 'الميكروفون', why: 'لتسجيل الصوت والمكالمات',
        request: () => navigator.mediaDevices.getUserMedia({ audio: true }) },
      { key: 'geolocation', icon: 'map', label: 'الموقع', why: 'لمشاركة موقعك مع أصدقائك',
        request: () => new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej)) },
      { key: 'notifications', icon: 'bell', label: 'الإشعارات', why: 'لتنبيهك بالرسائل والتفاعلات',
        request: () => Notification.requestPermission() },
    ];

    const box = el('div', { class: 'settings-section' });
    root.appendChild(box);

    function paint(entry, value) {
      const { state, pm } = entry;
      state.className = 'perm-state ' + value;
      state.onclick = null;
      if (value === 'granted') { state.textContent = 'مسموح'; }
      else if (value === 'denied') { state.textContent = 'مرفوض'; }
      else {
        // 'prompt' is the only state the page can actually act on.
        state.textContent = 'السماح';
        state.classList.add('askable');
        state.onclick = async () => {
          state.textContent = '...';
          try {
            const r = await pm.request();
            // getUserMedia hands back a live stream; release it at once, we
            // only wanted the permission answer.
            if (r && r.getTracks) r.getTracks().forEach(t => t.stop());
            await check(entry);
          } catch (err) { paint(entry, 'denied'); }
        };
      }
      try { if (window.I18N) window.I18N.apply(state); } catch (e) {}
    }

    async function check(entry) {
      const { pm } = entry;
      try {
        if (pm.key === 'notifications') {
          if (typeof Notification === 'undefined') { paint(entry, 'denied'); return; }
          const v = Notification.permission;
          paint(entry, v === 'default' ? 'prompt' : v);
          return;
        }
        if (navigator.permissions && navigator.permissions.query) {
          const st = await navigator.permissions.query({ name: pm.key });
          paint(entry, st.state);
          st.onchange = () => paint(entry, st.state);
          return;
        }
        paint(entry, 'prompt');
      } catch (e) {
        // Older engines do not know every permission name. Offering the ask is
        // more useful than reporting "unknown".
        paint(entry, 'prompt');
      }
    }

    PERMS.forEach(pm => {
      const state = el('span', { class: 'perm-state' }, '...');
      box.appendChild(el('div', { class: 'perm-row' }, [
        el('span', { class: 'si-icon', html: icons[pm.icon] || icons.settings }),
        el('div', { class: 'perm-meta' }, [
          el('div', { class: 'perm-name' }, pm.label),
          el('div', { class: 'perm-why' }, pm.why),
        ]),
        state,
      ]));
      check({ pm, state });
    });

    try { if (window.I18N) window.I18N.apply(root); } catch (e) {}
    return root;
  };

  // ===== Archiving and downloading =====
  V.archiveDownload = () => {
    hideNav();
    const root = el('section', { class: 'settings' });
    root.appendChild(topBar({ title: 'الأرشفة والتنزيل' }));

    const countEl = el('span', { class: 'muted' }, '');
    root.appendChild(subList([
      { icon: 'bookmark', label: 'المنشورات المؤرشفة', right: countEl, onclick: () => go('/archive') },
    ]));
    root.appendChild(el('p', { class: 'sec-note' },
      'المنشور المؤرشف يختفي من ملفك الشخصي ومن الموجز، ويبقى محفوظًا لك وحدك.'));

    const status = el('p', { class: 'sec-note', style: { margin: '12px 0 0' } }, '');
    const dlBtn = el('button', { class: 'sec-cta' }, 'طلب نسخة من بياناتي');
    root.appendChild(el('div', { class: 'sec-group' }, [
      el('h3', {}, 'تنزيل بياناتك'),
      el('p', { class: 'sec-note', style: { margin: '0 0 14px' } },
        'نجهّز ملفًا يحتوي على منشوراتك وتعليقاتك وبيانات حسابك. يستغرق ذلك بعض الوقت.'),
      dlBtn,
      status,
    ]));

    async function loadExports() {
      try {
        const rows = await window.API.fetchDataExports();
        const ready = rows.find(r => r.status === 'ready' && r.file_url);
        const pending = rows.find(r => r.status === 'pending');
        if (ready) {
          status.innerHTML = '';
          status.appendChild(el('a', { class: 'sec-link', href: safeUrl(ready.file_url), target: '_blank' }, 'ملفك جاهز للتنزيل'));
          dlBtn.style.display = 'none';
        } else if (pending) {
          status.textContent = 'طلبك قيد التجهيز. سنخبرك عند اكتماله.';
          dlBtn.disabled = true;
        } else {
          status.textContent = '';
          dlBtn.disabled = false;
        }
        try { if (window.I18N) window.I18N.apply(status); } catch (e) {}
      } catch (e) { /* table not applied yet - the button still explains itself */ }
    }

    dlBtn.onclick = async () => {
      dlBtn.disabled = true;
      try { await window.API.requestDataExport(); toast('تم استلام طلبك'); }
      catch (e) { toast(friendlyError(e, 'تعذر الطلب')); }
      await loadExports();
    };

    (async () => {
      try { const c = await window.API.countMyContent(); countEl.textContent = String(c.archived); }
      catch (e) {}
      loadExports();
    })();

    try { if (window.I18N) window.I18N.apply(root); } catch (e) {}
    return root;
  };

  // ===== Archived posts =====
  V.archive = () => {
    hideNav();
    const root = el('section', { class: 'settings' });
    root.appendChild(topBar({ title: 'المنشورات المؤرشفة' }));
    const grid = el('div', { class: 'video-grid' });
    root.appendChild(grid);

    async function refresh() {
      grid.innerHTML = '';
      grid.appendChild(loading());
      let rows = [];
      try { rows = await window.API.fetchArchivedVideos(); }
      catch (e) { grid.innerHTML = ''; grid.appendChild(errorState(refresh)); return; }
      grid.innerHTML = '';
      if (!rows.length) {
        grid.appendChild(emptyState({
          icon: 'bookmark', title: 'لا توجد منشورات مؤرشفة',
          sub: 'أرشف منشورًا لإخفائه عن ملفك دون حذفه',
        }));
        try { if (window.I18N) window.I18N.apply(grid); } catch (e) {}
        return;
      }
      rows.forEach((v, i) => {
        const card = createVideoCard(v, i, () => go('/v/' + v.id));
        const restore = el('button', { class: 'arch-restore', onclick: async (e) => {
          e.stopPropagation();
          e.currentTarget.disabled = true;
          try { await window.API.setVideoArchived(v.id, false); toast('تمت الاستعادة'); refresh(); }
          catch (err) { e.currentTarget.disabled = false; toast(friendlyError(err, 'تعذر التحديث')); }
        } }, 'استعادة');
        card.appendChild(restore);
        grid.appendChild(card);
      });
      try { if (window.I18N) window.I18N.apply(grid); } catch (e) {}
    }

    refresh();
    return root;
  };

  // ===== Close friends =====
  V.closeFriends = () => {
    hideNav();
    const root = el('section', { class: 'settings' });
    root.appendChild(topBar({ title: 'الأصدقاء المقربون' }));
    root.appendChild(el('p', { class: 'sec-note' },
      'لن يعرف أحد أنه في هذه القائمة. يمكنك تغييرها في أي وقت.'));

    const search = el('input', { class: 'cf-search', placeholder: 'ابحث عن شخص', type: 'search' });
    root.appendChild(el('div', { class: 'cf-searchwrap' }, [search]));

    const countLine = el('div', { class: 'cf-count' }, '');
    root.appendChild(countLine);

    const list = el('div', { class: 'user-list' });
    root.appendChild(list);

    let chosen = new Set();
    let people = [];

    function render() {
      const q = search.value.trim().toLowerCase();
      const shown = !q ? people : people.filter(p =>
        (p.name || '').toLowerCase().includes(q) || (p.handle || '').toLowerCase().includes(q));
      countLine.textContent = chosen.size + ' من أصدقائك المقربين';
      list.innerHTML = '';
      if (!shown.length) {
        list.appendChild(emptyState({
          icon: 'user',
          title: q ? 'لا توجد نتائج' : 'لا يوجد من تتابعه بعد',
          sub: q ? '' : 'تابع أشخاصًا لتتمكن من إضافتهم',
        }));
        try { if (window.I18N) window.I18N.apply(root); } catch (e) {}
        return;
      }
      shown.forEach(p => {
        const on = chosen.has(p.id);
        const btn = el('button', { class: 'cf-pick' + (on ? ' on' : ''), html: on ? icons.check : '' });
        btn.onclick = async (e) => {
          e.stopPropagation();
          btn.disabled = true;
          try {
            if (chosen.has(p.id)) { await window.API.removeCloseFriend(p.id); chosen.delete(p.id); }
            else { await window.API.addCloseFriend(p.id); chosen.add(p.id); }
            render();
          } catch (err) { btn.disabled = false; toast(friendlyError(err, 'تعذر التحديث')); }
        };
        list.appendChild(el('div', { class: 'user-row', style: { padding: '10px 16px' } }, [
          avatar(p.avatar_url || '', p.name || p.handle || '', 44),
          el('div', { style: { flex: 1, minWidth: 0 } }, [
            el('div', { class: 'name' }, p.name || p.handle || ''),
            el('div', { class: 'handle' }, '@' + (p.handle || '')),
          ]),
          btn,
        ]));
      });
      try { if (window.I18N) window.I18N.apply(root); } catch (e) {}
    }

    search.addEventListener('input', render);

    (async () => {
      list.appendChild(loading());
      try {
        const me = await window.SB.getUser();
        const [following, current] = await Promise.all([
          window.API.fetchFollowing(me.id),
          window.API.fetchCloseFriends(),
        ]);
        people = following || [];
        chosen = new Set((current || []).map(p => p.id));
        // Someone already on the list who you have since unfollowed must stay
        // visible, otherwise you could never take them off.
        (current || []).forEach(p => { if (!people.some(x => x.id === p.id)) people.push(p); });
        render();
      } catch (e) {
        list.innerHTML = '';
        list.appendChild(errorState(null, e.message));
      }
    })();

    return root;
  };

  // ===== Follow and invite friends =====
  V.inviteFriends = () => {
    hideNav();
    const root = el('section', { class: 'settings' });
    root.appendChild(topBar({ title: 'متابعة ودعوة الأصدقاء' }));

    const link = location.origin + '/#/';
    const msg = 'انضم إليّ على FLYP';

    root.appendChild(el('div', { class: 'sec-group' }, [
      el('h3', {}, 'ادعُ أصدقاءك'),
      el('div', { class: 'inv-actions' }, [
        el('button', { class: 'sec-cta', onclick: async () => {
          // The device's own share sheet where there is one, a copied link where not.
          if (navigator.share) {
            try { await navigator.share({ title: 'FLYP', text: msg, url: link }); return; }
            catch (e) { if (e && e.name === 'AbortError') return; }
          }
          try { await navigator.clipboard.writeText(msg + ' ' + link); toast('تم نسخ الرابط'); }
          catch (e) { toast('تعذر النسخ'); }
        } }, 'مشاركة رابط الدعوة'),
        el('button', { class: 'sec-cta ghost', onclick: () => {
          window.location.href = 'sms:?&body=' + encodeURIComponent(msg + ' ' + link);
        } }, 'دعوة عبر رسالة نصية'),
        el('button', { class: 'sec-cta ghost', onclick: () => {
          window.location.href = 'mailto:?subject=' + encodeURIComponent('FLYP') +
            '&body=' + encodeURIComponent(msg + ' ' + link);
        } }, 'دعوة عبر البريد'),
      ]),
    ]));

    root.appendChild(el('div', { class: 'sec-group' }, [el('h3', {}, 'حسابات قد تعجبك')]));
    const sug = el('div', { class: 'user-list' });
    root.appendChild(sug);

    (async () => {
      sug.appendChild(loading());
      try {
        const rows = await window.API.fetchSuggestedProfiles(20);
        sug.innerHTML = '';
        if (!rows || !rows.length) {
          sug.appendChild(emptyState({ icon: 'user', title: 'لا توجد اقتراحات الآن' }));
          try { if (window.I18N) window.I18N.apply(sug); } catch (e) {}
          return;
        }
        rows.forEach(p => {
          const btn = el('button', { class: 'inline-follow' }, 'متابعة');
          btn.onclick = async (e) => {
            e.stopPropagation();
            btn.disabled = true;
            try {
              const r = await window.API.follow(p.id);
              btn.textContent = r === 'requested' ? 'تم الطلب' : 'تتابعه';
              btn.classList.add('following');
              try { if (window.I18N) window.I18N.apply(btn); } catch (er) {}
            } catch (err) { btn.disabled = false; toast(friendlyError(err, 'تعذر المتابعة')); }
          };
          sug.appendChild(el('div', { class: 'user-row', style: { padding: '10px 16px' }, onclick: () => go('/profile/' + p.id) }, [
            avatar(p.avatar_url || '', p.name || p.handle || '', 44),
            el('div', { style: { flex: 1, minWidth: 0 } }, [
              el('div', { class: 'name' }, p.name || p.handle || ''),
              el('div', { class: 'handle' }, '@' + (p.handle || '')),
            ]),
            btn,
          ]));
        });
        try { if (window.I18N) window.I18N.apply(sug); } catch (e) {}
      } catch (e) {
        sug.innerHTML = '';
        sug.appendChild(emptyState({ icon: 'user', title: 'تعذر تحميل الاقتراحات' }));
        try { if (window.I18N) window.I18N.apply(sug); } catch (er) {}
      }
    })();

    return root;
  };

  // ===== Account activity =====
  // What you did - as opposed to the notifications screen, which is what was
  // done to you.
  V.accountActivity = () => {
    hideNav();
    const root = el('section', { class: 'settings' });
    root.appendChild(topBar({ title: 'نشاط الحساب' }));

    const stats = el('div', { class: 'act-stats' });
    const tabs = el('div', { class: 'act-tabs' });
    const body = el('div', { class: 'act-body' });
    root.appendChild(stats);
    root.appendChild(tabs);
    root.appendChild(body);

    let active = 'likes';
    [{ k: 'likes', label: 'الإعجابات' }, { k: 'comments', label: 'التعليقات' }].forEach(t => {
      const b = el('button', { class: 'act-tab' + (t.k === active ? ' on' : ''), onclick: () => {
        active = t.k;
        [...tabs.children].forEach(c => c.classList.toggle('on', c.dataset.k === active));
        load();
      } }, t.label);
      b.dataset.k = t.k;
      tabs.appendChild(b);
    });

    (async () => {
      try {
        const c = await window.API.countMyContent();
        [['posts', 'منشورات'], ['likes', 'إعجابات'], ['comments', 'تعليقات']].forEach(([k, l]) => {
          stats.appendChild(el('div', { class: 'act-stat' }, [
            el('strong', {}, fmt(c[k])),
            el('span', {}, l),
          ]));
        });
        try { if (window.I18N) window.I18N.apply(stats); } catch (e) {}
      } catch (e) {}
    })();

    async function load() {
      body.innerHTML = '';
      body.appendChild(loading());
      try {
        if (active === 'likes') {
          const rows = await window.API.fetchMyLikedVideos();
          body.innerHTML = '';
          if (!rows.length) {
            body.appendChild(emptyState({ icon: 'heart', title: 'لم تعجب بأي شيء بعد' }));
          } else {
            const grid = el('div', { class: 'video-grid' });
            rows.forEach((v, i) => grid.appendChild(createVideoCard(v, i, () => go('/v/' + v.id))));
            body.appendChild(grid);
          }
        } else {
          const rows = await window.API.fetchMyComments();
          body.innerHTML = '';
          if (!rows.length) {
            body.appendChild(emptyState({ icon: 'comment', title: 'لم تكتب أي تعليق بعد' }));
          } else {
            rows.forEach(cm => {
              const del = el('button', { class: 'mod-undo', onclick: async (e) => {
                e.stopPropagation();
                e.currentTarget.disabled = true;
                try { await window.API.deleteMyComment(cm.id); load(); }
                catch (err) { e.currentTarget.disabled = false; toast(friendlyError(err, 'تعذر الحذف')); }
              } }, 'حذف');
              body.appendChild(el('div', { class: 'act-comment', onclick: () => go('/v/' + cm.video_id) }, [
                el('div', { style: { flex: 1, minWidth: 0 } }, [
                  el('div', { class: 'act-ctext' }, cm.text || ''),
                  el('div', { class: 'act-cwhen' }, agoText(cm.created_at)),
                ]),
                del,
              ]));
            });
          }
        }
        try { if (window.I18N) window.I18N.apply(body); } catch (e) {}
      } catch (e) {
        body.innerHTML = '';
        body.appendChild(errorState(load, e.message));
      }
    }

    load();
    return root;
  };

  // ===== Security: change password / change email =====
  // Both re-ask for the current password first. That step is the whole point:
  // it stops someone who picks up an unlocked phone from taking the account.

  // A field with a show/hide eye. People cannot check what they typed into a
  // masked box, then blame the app for saying "wrong password".
  function secretField({ label, placeholder, autocomplete }) {
    const input = el('input', {
      class: 'sec-input', type: 'password', placeholder: placeholder || '',
      autocomplete: autocomplete || 'off',
    });
    const eye = el('button', { class: 'sec-eye', type: 'button', html: icons.eye, onclick: () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      eye.classList.toggle('shown', input.type === 'text');
      input.focus();
    } });
    const box = el('div', { class: 'sec-box' }, [input, eye]);
    const err = el('p', { class: 'sec-err', style: { display: 'none' } });
    const wrap = el('div', { class: 'sec-field' }, [
      el('label', { class: 'sec-label' }, label),
      box,
      err,
    ]);
    wrap.input = input;
    wrap.setError = (msg) => {
      err.textContent = msg || '';
      err.style.display = msg ? 'block' : 'none';
      box.classList.toggle('bad', !!msg);
    };
    input.addEventListener('input', () => wrap.setError(''));
    return wrap;
  }

  // Scored the way a person reads it, not by entropy maths.
  //
  // Length does far more work than symbols do - "correct horse battery" beats
  // "P@ss1!" by a wide margin - so the minimum is 10 rather than 8, and the
  // meter rewards going longer. The symbol rule is here because people expect
  // it and it costs little.
  function passwordChecks(v) {
    return [
      { ok: v.length >= 10, label: '10 أحرف على الأقل' },
      { ok: /[A-Za-z؀-ۿ]/.test(v), label: 'حرف واحد على الأقل' },
      { ok: /[0-9]/.test(v), label: 'رقم واحد على الأقل' },
      { ok: /[^A-Za-z0-9؀-ۿ]/.test(v), label: 'رمز واحد على الأقل (!@#$...)' },
    ];
  }

  // Rules alone still wave through "Password1!" - it satisfies every one of
  // them and is among the most guessed passwords there is.
  const COMMON_PASSWORDS = [
    'password', 'password1', 'password12', 'password123', 'password1!',
    'passw0rd', 'p@ssword', 'p@ssw0rd', 'qwerty123', 'qwertyuiop',
    '1234567890', '12345678', '123456789', 'iloveyou', 'admin123',
    'welcome1', 'welcome123', 'letmein1', 'abc12345', 'football1',
    'monkey123', 'sunshine1', 'princess1', 'dragon123', 'flyp',
  ];
  function isCommonPassword(v) {
    const t = String(v || '').toLowerCase().replace(/\s+/g, '');
    if (COMMON_PASSWORDS.includes(t)) return true;
    // Trailing digits are the usual way people "strengthen" a weak word.
    const stem = t.replace(/[0-9!@#$%^&*._-]+$/, '');
    return stem.length >= 4 && COMMON_PASSWORDS.includes(stem);
  }

  V.changePassword = () => {
    hideNav();
    const root = el('section', { class: 'settings sec-screen' });

    const saveBtn = el('button', { class: 'sec-save', disabled: true }, 'حفظ');
    root.appendChild(topBar({ title: 'تغيير كلمة المرور', right: saveBtn }));

    const cur = secretField({ label: 'كلمة المرور الحالية', placeholder: 'كلمة المرور الحالية', autocomplete: 'current-password' });
    const np = secretField({ label: 'كلمة المرور الجديدة', placeholder: 'كلمة المرور الجديدة', autocomplete: 'new-password' });
    const cf = secretField({ label: 'تأكيد كلمة المرور الجديدة', placeholder: 'أعد كتابة كلمة المرور', autocomplete: 'new-password' });

    const forgot = el('button', { class: 'sec-link', onclick: async () => {
      forgot.disabled = true;
      try {
        const u = await window.SB.getUser();
        if (!u || !u.email) { toast('لا يوجد بريد إلكتروني على هذا الحساب'); forgot.disabled = false; return; }
        await window.SB.resetPassword(u.email);
        toast('أرسلنا رابط إعادة التعيين إلى بريدك');
      } catch (e) { toast(friendlyError(e, 'تعذر الإرسال')); forgot.disabled = false; }
    } }, 'نسيت كلمة المرور الحالية؟');

    // Live requirement list, so the rules are visible before you fail them.
    const reqList = el('ul', { class: 'sec-reqs' });
    const reqRows = passwordChecks('').map(r => {
      const li = el('li', {}, [el('span', { class: 'sec-tick', html: icons.check }), el('span', {}, r.label)]);
      reqList.appendChild(li);
      return li;
    });

    const bar = el('div', { class: 'sec-meter' }, [el('i')]);
    const barFill = bar.querySelector('i');
    const barText = el('span', { class: 'sec-meter-txt' }, 'ضعيفة');

    root.appendChild(el('div', { class: 'sec-group' }, [
      el('h3', {}, 'تأكيد هويتك'),
      cur,
      forgot,
    ]));
    root.appendChild(el('div', { class: 'sec-group' }, [
      el('h3', {}, 'كلمة المرور الجديدة'),
      np,
      el('div', { class: 'sec-meter-row' }, [bar, barText]),
      reqList,
      cf,
    ]));
    root.appendChild(el('p', { class: 'sec-note' },
      'بعد التغيير سيتم تسجيل الخروج من جميع أجهزتك الأخرى.'));

    const STRENGTH = ['ضعيفة', 'ضعيفة', 'متوسطة', 'قوية'];

    function validate() {
      const v = np.input.value;
      const checks = passwordChecks(v);
      checks.forEach((c, i) => reqRows[i].classList.toggle('ok', c.ok));
      const passed = checks.filter(c => c.ok).length;
      const strength = !v ? 0 : Math.min(3, Math.floor(passed * 0.75) + (v.length >= 14 ? 1 : 0));
      barFill.style.width = (strength / 3 * 100) + '%';
      bar.className = 'sec-meter s' + strength;
      barText.textContent = STRENGTH[strength] || STRENGTH[0];
      try { if (window.I18N) window.I18N.apply(barText); } catch (e) {}
      const ok = cur.input.value.length > 0 && v.length > 0 &&
        checks.every(c => c.ok) && cf.input.value === v;
      saveBtn.disabled = !ok;
      return ok;
    }
    [cur, np, cf].forEach(f => f.input.addEventListener('input', validate));

    saveBtn.onclick = async () => {
      if (!validate()) return;
      saveBtn.disabled = true;
      saveBtn.textContent = 'جارٍ الحفظ...';
      try { if (window.I18N) window.I18N.apply(saveBtn); } catch (e) {}
      try {
        if (np.input.value === cur.input.value) {
          np.setError('اختر كلمة مرور مختلفة عن الحالية');
          throw new Error('__handled__');
        }
        if (isCommonPassword(np.input.value)) {
          np.setError('هذه كلمة مرور شائعة جدًا، اختر غيرها');
          throw new Error('__handled__');
        }
        const okPw = await window.SB.verifyPassword(cur.input.value);
        if (!okPw) {
          cur.setError('كلمة المرور الحالية غير صحيحة');
          cur.input.focus();
          throw new Error('__handled__');
        }
        await window.SB.updatePassword(np.input.value);
        // Best-effort: the password is already changed, so a failure here must
        // not read as though the whole thing failed.
        try { await window.SB.signOutOtherDevices(); } catch (e) {}
        toast('تم تغيير كلمة المرور');
        back();
        return;
      } catch (e) {
        if (e.message !== '__handled__') toast(friendlyError(e, 'تعذر التغيير'));
      }
      saveBtn.textContent = 'حفظ';
      try { if (window.I18N) window.I18N.apply(saveBtn); } catch (e) {}
      validate();
    };

    validate();
    return root;
  };

  V.changeEmail = () => {
    hideNav();
    const root = el('section', { class: 'settings sec-screen' });
    const saveBtn = el('button', { class: 'sec-save', disabled: true }, 'إرسال');
    root.appendChild(topBar({ title: 'تغيير البريد الإلكتروني', right: saveBtn }));

    const curVal = el('strong', { class: 'sec-current-val' }, '—');
    (async () => {
      try { const u = await window.SB.getUser(); curVal.textContent = (u && u.email) || '—'; }
      catch (e) { curVal.textContent = '—'; }
    })();

    const pw = secretField({ label: 'كلمة المرور', placeholder: 'كلمة المرور الحالية', autocomplete: 'current-password' });

    const emailInput = el('input', { class: 'sec-input', type: 'email', placeholder: 'البريد الإلكتروني الجديد', autocomplete: 'email' });
    const emailBox = el('div', { class: 'sec-box' }, [emailInput]);
    const emailErr = el('p', { class: 'sec-err', style: { display: 'none' } });
    const setEmailErr = (m) => {
      emailErr.textContent = m || '';
      emailErr.style.display = m ? 'block' : 'none';
      emailBox.classList.toggle('bad', !!m);
    };

    root.appendChild(el('div', { class: 'sec-group' }, [
      el('div', { class: 'sec-current' }, [
        el('span', { class: 'sec-label' }, 'البريد الحالي'),
        curVal,
      ]),
    ]));
    root.appendChild(el('div', { class: 'sec-group' }, [
      el('h3', {}, 'تأكيد هويتك'),
      pw,
    ]));
    root.appendChild(el('div', { class: 'sec-group' }, [
      el('h3', {}, 'البريد الجديد'),
      el('div', { class: 'sec-field' }, [
        el('label', { class: 'sec-label' }, 'البريد الإلكتروني الجديد'),
        emailBox,
        emailErr,
      ]),
    ]));
    root.appendChild(el('p', { class: 'sec-note' },
      'سنرسل رابط تأكيد. قد تحتاج إلى التأكيد من بريدك الحالي والجديد معًا.'));

    const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    function validate() {
      const ok = pw.input.value.length > 0 && EMAIL_RE.test(emailInput.value.trim());
      saveBtn.disabled = !ok;
      return ok;
    }
    pw.input.addEventListener('input', validate);
    emailInput.addEventListener('input', () => { setEmailErr(''); validate(); });

    saveBtn.onclick = async () => {
      if (!validate()) return;
      const next = emailInput.value.trim().toLowerCase();
      if (next === (curVal.textContent || '').toLowerCase()) {
        setEmailErr('هذا هو بريدك الحالي');
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = 'جارٍ الإرسال...';
      try { if (window.I18N) window.I18N.apply(saveBtn); } catch (e) {}
      try {
        const okPw = await window.SB.verifyPassword(pw.input.value);
        if (!okPw) { pw.setError('كلمة المرور غير صحيحة'); pw.input.focus(); throw new Error('__handled__'); }
        await window.SB.changeEmail(next);
        root.innerHTML = '';
        root.appendChild(topBar({ title: 'تغيير البريد الإلكتروني' }));
        root.appendChild(emptyState({
          icon: 'mail',
          title: 'تحقق من بريدك الجديد',
          sub: 'أرسلنا رابط تأكيد إلى ' + next + '. إذا وصلتك رسالة على بريدك الحالي أيضًا، فأكّد من كليهما.',
        }));
        try { if (window.I18N) window.I18N.apply(root); } catch (e) {}
        return;
      } catch (e) {
        if (e.message !== '__handled__') toast(friendlyError(e, 'تعذر الإرسال'));
      }
      saveBtn.textContent = 'إرسال';
      try { if (window.I18N) window.I18N.apply(saveBtn); } catch (e) {}
      validate();
    };

    validate();
    return root;
  };

  // ===== Moderation lists =====
  // One list screen reused for Restricted and Muted - both are "people you
  // have limited", differing only in what the limit does.
  function peopleLimitScreen({ title, emptyTitle, emptySub, load, remove, removeLabel, note }) {
    hideNav();
    const root = el('section', { class: 'settings' });
    root.appendChild(topBar({ title }));
    if (note) root.appendChild(el('p', { class: 'mod-note' }, note));
    const list = el('div', { class: 'user-list' });
    root.appendChild(list);

    async function refresh() {
      list.innerHTML = '';
      list.appendChild(el('div', { class: 'muted', style: { padding: '26px', textAlign: 'center' } }, 'جاري التحميل...'));
      try {
        const rows = await load();
        list.innerHTML = '';
        if (!rows.length) {
          list.appendChild(emptyState({ icon: 'user', title: emptyTitle, sub: emptySub }));
          return;
        }
        rows.forEach(u => {
          const btn = el('button', { class: 'mod-undo' }, removeLabel);
          btn.onclick = async () => {
            btn.disabled = true;
            try { await remove(u.id); refresh(); }
            catch (e) { btn.disabled = false; toast(friendlyError(e, 'تعذر التحديث')); }
          };
          list.appendChild(el('div', { class: 'user-row', style: { padding: '12px 16px' } }, [
            avatar(u.avatar_url || '', u.name || u.handle || '', 44),
            el('div', { style: { flex: 1, minWidth: 0 } }, [
              el('div', { class: 'name' }, u.name || u.handle || ''),
              el('div', { class: 'handle' }, '@' + (u.handle || '')),
            ]),
            btn,
          ]));
        });
        try { if (window.I18N) window.I18N.apply(list); } catch (e) {}
      } catch (e) {
        list.innerHTML = '';
        list.appendChild(el('div', { class: 'muted', style: { padding: '26px', textAlign: 'center' } }, 'تعذر التحميل'));
      }
    }
    refresh();
    return root;
  }

  V.restrictedUsers = () => peopleLimitScreen({
    title: 'الحسابات المقيّدة',
    emptyTitle: 'لا توجد حسابات مقيّدة',
    emptySub: 'تعليقات الحسابات المقيّدة تظهر لهم فقط',
    note: 'الشخص المقيّد لا يعرف أنه مقيّد. تعليقاته على فيديوهاتك تظهر له وحده، ولا يمكنه مراسلتك.',
    load: () => window.API.fetchRestricted(),
    remove: (id) => window.API.unrestrictUser(id),
    removeLabel: 'إلغاء التقييد',
  });

  V.mutedUsers = () => peopleLimitScreen({
    title: 'الحسابات المكتومة',
    emptyTitle: 'لا توجد حسابات مكتومة',
    emptySub: 'فيديوهات الحسابات المكتومة لا تظهر في موجزك',
    note: 'الكتم يخفي فيديوهات الشخص من موجزك دون إلغاء متابعته، ولا يعرف بذلك.',
    load: () => window.API.fetchMuted(),
    remove: (id) => window.API.unmuteUser(id),
    removeLabel: 'إلغاء الكتم',
  });

  // ===== Hidden words =====
  V.hiddenWords = () => {
    hideNav();
    const root = el('section', { class: 'settings' });
    root.appendChild(topBar({ title: 'الكلمات المخفية' }));
    root.appendChild(el('p', { class: 'mod-note' },
      'التعليقات التي تحتوي على هذه الكلمات لن تظهر لك. لا يعرف صاحب التعليق بذلك.'));

    const input = el('input', { class: 'hw-input', placeholder: 'أضف كلمة أو عبارة', maxlength: '40' });
    const addBtn = el('button', { class: 'hw-add' }, 'إضافة');
    root.appendChild(el('div', { class: 'hw-form' }, [input, addBtn]));

    const chips = el('div', { class: 'hw-chips' });
    root.appendChild(chips);

    async function refresh() {
      chips.innerHTML = '';
      let words = [];
      try { words = await window.API.fetchHiddenWords(); } catch (e) {}
      if (!words.length) {
        chips.appendChild(el('div', { class: 'muted', style: { padding: '18px 4px', fontSize: '13px' } }, 'لا توجد كلمات مخفية'));
        return;
      }
      words.sort().forEach(w => {
        const x = el('button', { class: 'hw-x', html: icons.x });
        x.onclick = async () => {
          try { await window.API.removeHiddenWord(w); refresh(); }
          catch (e) { toast(friendlyError(e, 'تعذر الحذف')); }
        };
        chips.appendChild(el('span', { class: 'hw-chip' }, [el('span', {}, w), x]));
      });
    }

    async function add() {
      const w = input.value.trim();
      if (!w) return;
      addBtn.disabled = true;
      try { await window.API.addHiddenWord(w); input.value = ''; await refresh(); }
      catch (e) { toast(friendlyError(e, 'تعذر الإضافة')); }
      addBtn.disabled = false;
      input.focus();
    }
    addBtn.onclick = add;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });

    refresh();
    return root;
  };

  // ===== Hashtag =====
  // A tag gets its own page - name, video count, and every video using it -
  // rather than dumping the user into raw search results.
  V.hashtag = (params) => {
    hideNav();
    const raw = decodeURIComponent(params.id || '').replace(/^#/, '');
    const root = el('section', { class: 'tag-screen' });

    const shareBtn = el('button', { class: 'icon-btn', title: 'مشاركة', html: icons.shareBox });
    root.appendChild(el('header', { class: 'top-bar' }, [
      el('button', { class: 'icon-btn back-btn', html: icons.chevL, onclick: () => back() }),
      el('span'),
      shareBtn,
    ]));

    // The tag itself is the subject, so it leads as type rather than sitting
    // beside a purple gradient tile.
    const nameEl = el('h1', { class: 'tag-name' }, '#' + raw);
    const statVideos = el('div', { class: 'tag-stat' }, [
      el('span', { class: 'ts-n' }, '0'), el('span', { class: 'ts-l' }, 'مقاطع'),
    ]);
    const statViews = el('div', { class: 'tag-stat' }, [
      el('span', { class: 'ts-n' }, '0'), el('span', { class: 'ts-l' }, 'مشاهدة'),
    ]);
    root.appendChild(el('div', { class: 'tag-head' }, [
      nameEl,
      el('div', { class: 'tag-stats' }, [statVideos, statViews]),
    ]));

    const grid = el('div', { class: 'video-grid tag-grid' });
    root.appendChild(grid);

    root.appendChild(el('div', { class: 'tag-cta-wrap' }, [
      el('button', { class: 'tag-cta', onclick: () => go('/create') }, [
        el('span', { class: 'tc-icon', html: icons.plus }),
        el('span', {}, 'أنشئ فيديو بهذا الوسم'),
      ]),
    ]));

    (async () => {
      try {
        const [tag, vids] = await Promise.all([
          window.API.fetchHashtag(raw),
          window.API.fetchHashtagVideos(raw),
        ]);
        statVideos.querySelector('.ts-n').textContent = fmt((tag && tag.usage_count) || vids.length);
        statViews.querySelector('.ts-n').textContent = fmt(vids.reduce((a, v) => a + (v.views_count || 0), 0));
        grid.innerHTML = '';
        if (!vids.length) {
          grid.appendChild(emptyState({
            icon: 'video',
            title: 'لا توجد فيديوهات بهذا الوسم بعد',
            sub: 'كن أول من يستخدمه',
          }));
        } else {
          vids.forEach((v, i) => grid.appendChild(createVideoCard(v, i, () => go('/v/' + v.id))));
        }
        shareBtn.onclick = async () => {
          const url = (window.DeepLink && window.DeepLink.ORIGIN)
            ? window.DeepLink.ORIGIN + '/t/' + encodeURIComponent(raw) : location.href;
          if (navigator.share) { try { await navigator.share({ title: '#' + raw, url }); return; } catch (e) { return; } }
          try { await navigator.clipboard.writeText(url); toast('تم النسخ'); } catch (e) { toast('تعذر النسخ'); }
        };
        try { if (window.I18N) window.I18N.apply(root); } catch (e) {}
      } catch (e) {
        console.warn('hashtag load:', e);
        toast('تعذر تحميل الوسم');
      }
    })();

    return root;
  };

  // ===== Sound detail =====
  // Header card (art, title, author, video count, favourite) over a grid of
  // videos using it, with "Use this sound" pinned to the bottom.
  V.sound = (params) => {
    hideNav();
    const soundId = params.id;
    const root = el('section', { class: 'sound-screen' });

    const shareBtn = el('button', { class: 'icon-btn', title: 'مشاركة', html: icons.shareBox });
    root.appendChild(el('header', { class: 'top-bar' }, [
      el('button', { class: 'icon-btn back-btn', html: icons.chevL, onclick: () => back() }),
      el('span'),
      shareBtn,
    ]));

    const art = el('div', { class: 'sound-art' }, [el('span', { class: 'sa-note', html: icons.music })]);
    const titleEl = el('div', { class: 'sound-title' }, '');
    const authorEl = el('div', { class: 'sound-author' }, '');
    const countEl = el('div', { class: 'sound-count' }, '');
    const favBtn = el('button', { class: 'sound-fav' }, [
      el('span', { class: 'sf-icon', html: icons.bookmark }),
      el('span', { class: 'sf-label' }, 'إضافة إلى المفضلة'),
    ]);

    root.appendChild(el('div', { class: 'sound-head' }, [
      art,
      el('div', { class: 'sound-meta' }, [titleEl, authorEl, countEl, favBtn]),
    ]));

    const grid = el('div', { class: 'video-grid sound-grid' });
    root.appendChild(grid);

    const useBtn = el('button', { class: 'sound-use', onclick: () => go('/camera?sound=' + encodeURIComponent(soundId)) }, [
      el('span', { class: 'su-icon', html: icons.video }),
      el('span', {}, 'استخدام هذا الصوت'),
    ]);
    root.appendChild(el('div', { class: 'sound-use-wrap' }, [useBtn]));

    let favorited = false;
    function paintFav() {
      favBtn.classList.toggle('on', favorited);
      favBtn.querySelector('.sf-label').textContent = favorited ? 'في المفضلة' : 'إضافة إلى المفضلة';
      try { if (window.I18N) window.I18N.apply(favBtn); } catch (e) {}
    }
    favBtn.onclick = async () => {
      const next = !favorited;
      favorited = next; paintFav();
      try { next ? await window.API.favoriteSound(soundId) : await window.API.unfavoriteSound(soundId); }
      catch (e) { favorited = !next; paintFav(); toast(friendlyError(e, 'خطأ')); }
    };

    (async () => {
      try {
        const snd = await window.API.fetchSound(soundId);
        if (!snd) { toast('الصوت غير موجود'); back(); return; }

        titleEl.textContent = snd.title || 'صوت أصلي';
        const who = (snd.creator && (snd.creator.name || snd.creator.handle)) || snd.author_name || '';
        authorEl.textContent = who;
        if (snd.creator && snd.creator.id) {
          authorEl.classList.add('linked');
          authorEl.onclick = () => go('/profile/' + snd.creator.id);
        }
        if (snd.cover_url) {
          art.innerHTML = '';
          art.appendChild(el('img', { src: snd.cover_url, alt: '' }));
        }

        const vids = await window.API.fetchSoundVideos(soundId);
        countEl.textContent = fmt(snd.usage_count || vids.length) + ' فيديو';

        grid.innerHTML = '';
        if (!vids.length) {
          grid.appendChild(emptyState({
            icon: 'video',
            title: 'لا توجد فيديوهات بهذا الصوت بعد',
            sub: 'كن أول من يستخدمه',
          }));
        } else {
          vids.forEach((v, i) => grid.appendChild(createVideoCard(v, i, () => go('/v/' + v.id))));
        }

        favorited = await window.API.isSoundFavorited(soundId).catch(() => false);
        paintFav();

        shareBtn.onclick = async () => {
          const url = (window.DeepLink && window.DeepLink.ORIGIN)
            ? window.DeepLink.ORIGIN + '/s/' + soundId : location.href;
          if (navigator.share) { try { await navigator.share({ title: snd.title || 'FLYP', url }); return; } catch (e) { return; } }
          try { await navigator.clipboard.writeText(url); toast('تم النسخ'); } catch (e) { toast('تعذر النسخ'); }
        };

        try { if (window.I18N) window.I18N.apply(root); } catch (e) {}
      } catch (e) {
        console.warn('sound load:', e);
        toast('تعذر تحميل الصوت');
      }
    })();

    return root;
  };

  // ===== Calls =====
  // Agora carries the audio/video. Everything here - ringing, accept,
  // decline, hang up, missed calls - is our own signalling and works with
  // no Agora account. When AGORA_APP_ID is filled in, the media layer
  // attaches at the two marked points below and the flow is complete.

  function callKindLabel(kind) { return kind === 'video' ? 'مكالمة فيديو' : 'مكالمة صوتية'; }

  function fmtDuration(sec) {
    const m = Math.floor(sec / 60), r = sec % 60;
    return m + ':' + String(r).padStart(2, '0');
  }

  // A 1x1 transparent GIF, used as a <video> poster.
  //
  // Android's WebView draws its OWN placeholder for a video element that has
  // no frame yet: a grey box with a large black play triangle. It appeared
  // while the feed was loading, while the camera was waiting on a permission
  // prompt, and at the start of a live stream — anywhere a video existed but
  // had nothing to show. It is not ours and cannot be styled.
  //
  // A poster replaces it. Where there is a real thumbnail we use that; where
  // there is not, this transparent pixel suppresses the placeholder and lets
  // whatever is behind the element show through. Instagram does the same
  // thing: the still, the last frame, or nothing — never a grey stand-in.
  const BLANK_POSTER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  // A still from a playing <video>, as a JPEG blob. Resolves null when there is
  // no frame to take — metadata not loaded yet, camera denied, or a tainted
  // canvas — so every caller can carry on without a cover rather than break.
  function grabFrame(video, maxSide) {
    return new Promise((resolve) => {
      try {
        const w = video && video.videoWidth, h = video && video.videoHeight;
        if (!w || !h) return resolve(null);
        const limit = maxSide || 720;
        const scale = Math.min(1, limit / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => resolve(b || null), 'image/jpeg', 0.7);
      } catch (e) { resolve(null); }
    });
  }

  // ── Shared reel / profile / live cards ──
  // An in-app share arrives as a bare deep link inside an ordinary text
  // message, so the chat used to show a raw URL where Instagram shows a
  // preview. It is sent that way because messages.type is pinned by a database
  // constraint (text|voice|image|video|sticker|system|file|location|call);
  // giving a share its own type would mean a migration. Recognising our own
  // link instead needs no schema change, and it upgrades every link already
  // sitting in someone's history.
  //
  // Returns null for anything that is not a lone FLYP link — a link with words
  // around it is a person talking, and unfurling that would hide what they
  // actually wrote.
  function buildShareCard(text) {
    const t = String(text || '').trim();
    if (!t || /\s/.test(t)) return null;
    if (!window.DeepLink || !window.DeepLink.routeForUrl) return null;
    const route = window.DeepLink.routeForUrl(t);
    if (!route) return null;

    const kind = route.indexOf('/v/') === 0       ? 'video'
               : route.indexOf('/profile/') === 0 ? 'profile'
               : route.indexOf('/live/') === 0    ? 'live'
               : null;
    if (!kind) return null;
    const id = route.slice(route.lastIndexOf('/') + 1);

    // Instagram's shape: a tall cover filling the bubble, the author's avatar
    // and name laid over the top of it, and a play glyph in the middle. The
    // bubble itself goes transparent (.bubble.share) so the media IS the
    // message rather than sitting inside a coloured box.
    const cover = el('div', { class: 'sc-cover' });
    const by = el('div', { class: 'sc-by' });
    cover.appendChild(by);
    if (kind !== 'profile') cover.appendChild(el('span', { class: 'sc-play', html: icons.play || '' }));
    if (kind === 'live') cover.appendChild(el('span', { class: 'sc-live' }, 'بث مباشر'));

    // Built through avatar() rather than a bare styled circle, so an account
    // with no picture gets its initial on a colour derived from the name —
    // the same fallback used everywhere else in the app. A plain circle just
    // rendered as an empty grey hole, which is what it looked like next to
    // Instagram. Filled in once the row loads, so nothing is drawn from a
    // guess in the meantime.
    function setAuthor(src, name, handle) {
      by.innerHTML = '';
      const label = handle ? '@' + String(handle).replace('@', '') : (name || '');
      by.appendChild(avatar(src || '', name || label, 22));
      by.appendChild(el('span', { class: 'sc-name' }, label));
    }

    const card = el('button', {
      class: 'share-card' + (kind === 'profile' ? ' profile' : ''),
      onclick: () => go(route),
    }, [cover]);

    // Filled in once the row loads. The card is already tappable before this
    // resolves, so nothing waits on it and a failure just leaves it plain.
    (async () => {
      try {
        if (!window.API) return;
        if (kind === 'video' && window.API.fetchVideo) {
          const v = await window.API.fetchVideo(id);
          if (!v) return;
          if (v.thumbnail) cover.style.backgroundImage = 'url(' + v.thumbnail + ')';
          if (v.user) setAuthor(v.user.avatar_url, v.user.name, v.user.handle);
        } else if (kind === 'profile' && window.API.fetchProfile) {
          const u = await window.API.fetchProfile(id);
          if (!u) return;
          if (u.avatar_url) cover.style.backgroundImage = 'url(' + u.avatar_url + ')';
          setAuthor(u.avatar_url, u.name, u.handle);
        } else if (kind === 'live' && window.API.fetchLiveStream) {
          const l = await window.API.fetchLiveStream(id);
          if (!l) return;
          if (l.thumbnail) cover.style.backgroundImage = 'url(' + l.thumbnail + ')';
          if (l.host) setAuthor(l.host.avatar, l.host.name, l.host.handle);
        }
      } catch (e) { /* a plain card is a fine fallback */ }
    })();

    try { if (window.I18N) window.I18N.apply(card); } catch (e) {}
    return card;
  }

  V.call = (params) => {
    hideNav();
    const callId = params.id;
    const root = el('section', { class: 'call-screen' });

    // Rebuilt to read like a phone call rather than a settings page: the
    // person fills the screen, the state is one clear line under their name,
    // and the controls sit in a fixed row at the bottom where a thumb is.
    const avPulse = el('span', { class: 'call-pulse' });
    const avWrap = el('div', { class: 'call-avatar ringing' }, [avPulse, avatar('', '', 132)]);
    const nameEl = el('div', { class: 'call-name' }, '');
    const statusEl = el('div', { class: 'call-status' }, 'جاري الاتصال...');
    const kindEl = el('div', { class: 'call-kind' }, '');
    const mediaNote = el('div', { class: 'call-media-note', hidden: true },
      'الصوت والفيديو غير مفعلين — أضف Agora App ID');

    let call = null, me = null, unsub = null, timer = null, startedAt = null, ringTimeout = null;
    let ended = false;

    function cleanup() {
      if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
      if (timer) { clearInterval(timer); timer = null; }
      if (ringTimeout) { clearTimeout(ringTimeout); ringTimeout = null; }
      // The microphone and camera have to be handed back, and the channel
      // left, or the call keeps billing and the recording light stays on
      // after the screen is gone. Detached from `media` first so a second
      // cleanup — hangup and hashchange both call it — cannot stop it twice.
      const session = media; media = null;
      if (session) { Promise.resolve().then(() => session.stop()).catch(() => {}); }
    }
    function leaveScreen() { cleanup(); back(); }

    // A labelled round control. Every button carries its own label so none of
    // them is a bare icon you have to guess at. The icon and the label live
    // in fields because both change with the control's state.
    function ctl(cls, icon, label, onclick) {
      const iconWrap = el('span', { html: icon });
      const labelEl = el('small', {}, label);
      const btn = el('button', {
        class: 'call-btn ' + cls, type: 'button', title: label,
        'aria-pressed': 'false', onclick,
      }, [iconWrap]);
      return { btn, iconWrap, labelEl, node: el('div', { class: 'call-ctl' }, [btn, labelEl]) };
    }

    // ── Media controls ───────────────────────────────────────
    //
    // These three used to be `classList.toggle('on')` and a comment saying
    // the media layer would arrive later. Two things were wrong with that.
    //
    // The visible one: the toggled look never survived the tap. Nothing else
    // set or cleared `on`, so the class did latch — but the only feedback
    // anyone noticed was the WebView's blue tap highlight flashing and going
    // away, and with the icon unchanged there was nothing to read afterwards
    // that said "this is muted".
    //
    // The one underneath: "muted" was a claim the screen made about itself.
    // Nothing had ever touched a microphone. A local boolean that no device
    // is attached to cannot be wrong, which is exactly what makes it useless
    // — it would have gone on looking correct after the media layer landed
    // and started disagreeing with it.
    //
    // So the media layer is attached here, and `paintMedia` is the only thing
    // that writes to these buttons. It reads the live track every time and
    // draws that. A handler's job is to ask for a change, wait for it, and
    // repaint; if the SDK refuses, the repaint puts the button back where the
    // hardware actually is and the user is told.
    let media = null;                 // the Agora session, once connected
    let joining = false;

    function paintMedia() {
      const live = !!media;

      // Mute: active (white, struck-through mic) means the mic is OFF. The
      // label flips to the action the next tap performs.
      const muted = live && media.isMuted();
      mute.btn.disabled = !live;
      mute.btn.classList.toggle('on', muted);
      mute.btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
      mute.iconWrap.innerHTML = muted ? icons.micOff : icons.mic;
      mute.labelEl.textContent = muted ? 'إلغاء الكتم' : 'كتم';
      mute.btn.title = mute.labelEl.textContent;

      // Speaker: active means the loudspeaker is ON, which is the opposite
      // sense to mute. That looks inconsistent written down and is what every
      // phone does — the button always lights up for the state you switched
      // INTO, and for a speaker that state is "loud".
      const spk = live && media.isSpeakerOn();
      speaker.btn.disabled = !live || !media.canRouteAudio();
      speaker.btn.classList.toggle('on', !!spk);
      speaker.btn.setAttribute('aria-pressed', spk ? 'true' : 'false');
      speaker.iconWrap.innerHTML = spk ? icons.speaker : icons.speakerOff;
      speaker.labelEl.textContent = spk ? 'مكبر الصوت' : 'سماعة الأذن';
      speaker.btn.title = speaker.labelEl.textContent;

      // Camera: active means the camera is OFF, matching mute.
      const camOff = live && media.hasCamera() && !media.isCameraOn();
      cam.btn.disabled = !live || !media.hasCamera();
      cam.btn.classList.toggle('on', !!camOff);
      cam.btn.setAttribute('aria-pressed', camOff ? 'true' : 'false');
      cam.iconWrap.innerHTML = camOff ? icons.videoOff : icons.video;
      cam.labelEl.textContent = camOff ? 'تشغيل الكاميرا' : 'إيقاف الكاميرا';
      cam.btn.title = cam.labelEl.textContent;

      // These labels are written after the screen's one-time I18N.apply has
      // already run, so they come back as Arabic on an English device unless
      // each repaint re-translates them.
      try {
        if (window.I18N) [mute, speaker, cam].forEach(c => window.I18N.apply(c.node));
      } catch (e) {}
    }

    // Shared by all three: run the change, repaint from whatever the track
    // says afterwards, and say so if it did not take. `paintMedia` runs in
    // the failure path too — that is what puts a button that refused to move
    // back where it was instead of leaving it showing a state we only asked
    // for.
    async function toggleMedia(fn, failMsg) {
      if (!media) return;
      try { await fn(); }
      catch (e) { console.warn('call media:', e); toast(failMsg); }
      finally { paintMedia(); }
    }

    const mute = ctl('', icons.mic, 'كتم', () =>
      toggleMedia(() => media.setMuted(!media.isMuted()), 'تعذر تغيير حالة الميكروفون'));

    const speaker = ctl('', icons.speakerOff, 'مكبر الصوت', () =>
      toggleMedia(async () => media.setSpeakerOn(!media.isSpeakerOn()), 'تعذر تغيير مخرج الصوت'));

    const cam = ctl('', icons.video, 'إيقاف الكاميرا', () =>
      toggleMedia(() => media.setCameraOn(!media.isCameraOn()), 'تعذر تغيير حالة الكاميرا'));
    cam.node.hidden = true;

    const end = ctl('end', icons.phone, 'إنهاء', async () => {
      if (ended) return;
      ended = true;
      end.btn.disabled = true;
      try { if (call) await window.API.endCall(call.id); } catch (e) {}
      leaveScreen();
    });

    // Video surfaces for a video call: the other person fills the screen, you
    // sit in the corner. Both stay hidden until a track is actually playing
    // into them, so an audio call — and a video call before it connects — is
    // the avatar screen it has always been rather than two black rectangles.
    const remoteVideo = el('div', { class: 'call-remote', hidden: true });
    const localVideo = el('div', { class: 'call-local', hidden: true });
    const videoStage = el('div', { class: 'call-stage', hidden: true }, [remoteVideo, localVideo]);

    root.appendChild(videoStage);
    root.appendChild(el('div', { class: 'call-body' }, [kindEl, avWrap, nameEl, statusEl, mediaNote]));
    root.appendChild(el('div', { class: 'call-actions' }, [mute.node, speaker.node, cam.node, end.node]));
    paintMedia();     // start disabled: there is no microphone to speak of yet

    function startTimer() {
      startedAt = Date.now();
      statusEl.textContent = '0:00';
      timer = setInterval(() => {
        statusEl.textContent = fmtDuration(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);
    }

    // Both sides join the same Agora channel the moment the call is accepted.
    // applyStatus can be handed the same status more than once — the screen
    // subscribes to the call and also reads it once on open — so this guards
    // on `joining` as well as on `media`, or a double 'accepted' would join
    // twice and publish two microphones into the channel.
    async function joinMedia() {
      if (media || joining || ended) return;
      if (!(window.Agora && window.Agora.isConfigured && window.Agora.isConfigured())) {
        mediaNote.hidden = false;          // no App ID: signalling only
        paintMedia();                      // and the controls stay disabled
        return;
      }
      joining = true;
      paintMedia();
      const isVideo = call && call.kind === 'video';
      try {
        const session = await window.Agora.startCall({
          channel: (call && call.channel) || callId,
          withVideo: isVideo,
          localVideoEl: isVideo ? localVideo : null,
          remoteVideoEl: isVideo ? remoteVideo : null,
          // Fires when the other side publishes or stops publishing. The
          // speaker button is dead until there is remote audio to route, so
          // it has to be repainted when that arrives rather than only on tap.
          onRemote: (st) => {
            if (isVideo) {
              // Only show the far-side surface once they are actually sending
              // pictures. A video call where they have their camera off keeps
              // the avatar rather than covering it with a black rectangle.
              remoteVideo.hidden = !(st && st.hasRemoteVideo);
              if (!remoteVideo.hidden) videoStage.hidden = false;
            }
            paintMedia();
          },
          onError: (e) => console.warn('call media:', e),
        });
        // Hanging up during the join leaves a session nobody is holding.
        // Close it rather than leaking the microphone and the channel.
        if (ended) { try { await session.stop(); } catch (e) {} return; }
        media = session;
        if (isVideo && session.hasCamera()) {
          videoStage.hidden = false;
          localVideo.hidden = false;
        }
      } catch (e) {
        console.warn('call media join failed:', e);
        mediaNote.hidden = false;
        // The overwhelmingly common cause is a refused microphone prompt, and
        // "أضف Agora App ID" is no help to the person holding the phone.
        mediaNote.textContent = 'تعذر تشغيل الصوت — تأكد من السماح بالوصول إلى الميكروفون.';
        try { if (window.I18N) window.I18N.apply(mediaNote); } catch (e2) {}
      } finally {
        joining = false;
        paintMedia();
      }
    }

    function applyStatus(row) {
      if (!row) return;
      call = Object.assign(call || {}, row);

      // A terminal status must only be handled once. The screen subscribes to
      // the call and also ends it locally, so without this guard hanging up
      // could schedule two departures and pop the history twice.
      const terminal = (row.status === 'declined' || row.status === 'missed' || row.status === 'ended');
      if (terminal && ended) return;

      if (row.status === 'accepted' && !timer) {
        if (ringTimeout) { clearTimeout(ringTimeout); ringTimeout = null; }
        avWrap.classList.remove('ringing');
        avWrap.classList.add('connected');
        startTimer();
        joinMedia();
      } else if (terminal) {
        ended = true;
        cleanup();                       // stop the timer before it overwrites the reason
        avWrap.classList.remove('ringing', 'connected');
        avWrap.classList.add('over');
        end.btn.disabled = true;
        statusEl.textContent = row.status === 'declined' ? 'تم رفض المكالمة'
                             : row.status === 'missed'   ? 'لم يتم الرد'
                             : 'انتهت المكالمة';
        try { if (window.I18N) window.I18N.apply(statusEl); } catch (e) {}
        setTimeout(leaveScreen, 1300);
      }
    }

    (async () => {
      try {
        const u = await window.SB.getUser(); me = u && u.id;
        call = await window.API.fetchCall(callId);
        if (!call) { leaveScreen(); return; }
        const other = (call.caller_id === me) ? call.callee : call.caller;
        const oname = (other && other.name) || (other && other.handle) || '';
        avWrap.innerHTML = '';
        avWrap.appendChild(avatar((other && other.avatar_url) || '', oname, 108));
        nameEl.textContent = oname;
        kindEl.textContent = callKindLabel(call.kind);
        if (call.kind === 'video') cam.node.hidden = false;
        // Ringing out and being connected are different states and should not
        // share a label.
        if (call.status === 'ringing') {
          statusEl.textContent = (call.caller_id === me) ? 'جاري الاتصال...' : 'مكالمة واردة';
        }
        applyStatus(call);
        try { if (window.I18N) window.I18N.apply(root); } catch (e) {}

        unsub = window.API.subscribeToCall(call.id, applyStatus);

        // Caller side: give up after 35s with no answer.
        if (call.caller_id === me && call.status === 'ringing') {
          ringTimeout = setTimeout(async () => {
            try { await window.API.missCall(call.id); } catch (e) {}
            statusEl.textContent = 'لم يتم الرد';
            setTimeout(leaveScreen, 1400);
          }, 35000);
        }
      } catch (e) { console.warn('call:', e); leaveScreen(); }
    })();

    window.addEventListener('hashchange', cleanup, { once: true });
    return root;
  };

  // Global incoming-call listener: lives outside the router so a call can
  // reach you on any screen.
  (function initIncomingCalls() {
    let overlay = null;
    let ringingId = null;
    let callUnsub = null;
    let missTimer = null;

    function dismiss() {
      // The subscription and the timeout have to go with the card. Leaving
      // either behind meant a dismissed call could still fire missCall on a
      // call that had already been answered somewhere else.
      if (callUnsub) { try { callUnsub(); } catch (e) {} callUnsub = null; }
      if (missTimer) { clearTimeout(missTimer); missTimer = null; }
      if (overlay) { overlay.remove(); overlay = null; }
      ringingId = null;
    }

    async function show(row) {
      if (overlay || !row || row.status !== 'ringing') return;
      ringingId = row.id;
      let caller = row.caller;
      if (!caller) {
        try { const full = await window.API.fetchCall(row.id); caller = full && full.caller; } catch (e) {}
      }
      const cname = (caller && caller.name) || (caller && caller.handle) || '';
      const isVideo = row.kind === 'video';

      // Full-screen, the way a real incoming call looks — a small card in the
      // corner of the app read as a notification, not as a ringing phone.
      overlay = el('div', { class: 'incoming-call' }, [
        el('div', { class: 'ic-bg' }),
        el('div', { class: 'ic-card' }, [
          el('div', { class: 'ic-kind' }, callKindLabel(row.kind)),
          el('div', { class: 'ic-avatar' }, [
            el('span', { class: 'ic-pulse' }),
            el('span', { class: 'ic-pulse d2' }),
            avatar((caller && caller.avatar_url) || '', cname, 112),
          ]),
          el('div', { class: 'ic-name' }, cname),
          el('div', { class: 'ic-sub' }, 'مكالمة واردة'),
          el('div', { class: 'ic-actions' }, [
            el('div', { class: 'ic-slot' }, [
              el('button', {
                class: 'ic-btn decline', title: 'رفض',
                onclick: async () => {
                  const id = ringingId; dismiss();
                  try { await window.API.declineCall(id); } catch (e) {}
                },
              }, [el('span', { html: icons.phone })]),
              el('small', {}, 'رفض'),
            ]),
            el('div', { class: 'ic-slot' }, [
              el('button', {
                class: 'ic-btn accept', title: 'قبول',
                onclick: async () => {
                  const id = ringingId; dismiss();
                  try { await window.API.acceptCall(id); } catch (e) {}
                  go('/call/' + id);
                },
              }, [el('span', { html: isVideo ? icons.video : icons.phone })]),
              el('small', {}, 'قبول'),
            ]),
          ]),
        ]),
      ]);
      document.body.appendChild(overlay);
      try { if (window.I18N) window.I18N.apply(overlay); } catch (e) {}

      // ── The fix for a card that would not go away ──
      // subscribeToIncomingCalls listens for INSERT only, so it never hears
      // the caller hang up. Nothing was watching this call's status, and the
      // card kept ringing after the other side had already ended it — right
      // through to the 35s timeout, which then reported it as missed.
      callUnsub = window.API.subscribeToCall(row.id, (updated) => {
        if (!updated || updated.id !== ringingId) return;
        if (updated.status !== 'ringing') dismiss();   // ended, declined, or answered elsewhere
      });

      missTimer = setTimeout(() => {
        if (ringingId === row.id) {
          const id = ringingId; dismiss();
          window.API.missCall(id).catch(() => {});
        }
      }, 35000);
    }

    async function boot() {
      if (!window.API || !window.SB) return;
      try {
        const u = await window.SB.getUser();
        if (!u) return;
        const pending = await window.API.fetchIncomingCall();
        if (pending) show(pending);
        window.API.subscribeToIncomingCalls(row => show(row));
      } catch (e) { /* calls are optional - never block the app */ }
    }

    if (document.readyState !== 'loading') boot();
    else document.addEventListener('DOMContentLoaded', boot);
  })();

  // Map view ID alias
  V.locationMap = V.map;
})();

