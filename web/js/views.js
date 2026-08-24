/* === Mobile views === */
(function () {
  const { el, esc, safeUrl, fmt, go, back, toast, modal, icons, svg, bottomNav, hideNav, topBar, avatar } = window.H;
  const DB = window.DB;
  const V = window.Views = {};

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
  V.splash = () => {
    hideNav();
    return el('section', { class: 'splash' }, [
      el('div', { class: 'splash-lang' }, [langSwitch({ compact: true })]),
      el('div', { class: 'splash-hero' }, [
        el('div', { class: 'splash-logo', html: icons.logo, style: { width: '96px', height: '96px', margin: '0 auto 16px' } }),
        el('h1', {}, 'Tenth Tone'),
        el('p', {}, 'شارك لحظتك مع العالم'),
      ]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn', onclick: () => go('/login') }, 'تسجيل الدخول'),
        el('button', { class: 'btn btn-outline', onclick: () => go('/register') }, 'إنشاء حساب جديد'),
      ]),
    ]);
  };

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
      el('div', { class: 'auth-doodle', html: icons.gift }),
      el('div', { class: 'auth-doodle', html: icons.bookmark }),
      el('div', { class: 'auth-doodle', html: icons.flash }),
      el('div', { class: 'auth-doodle', html: icons.camera }),
      el('div', { class: 'auth-doodle', html: icons.mic }),
      el('div', { class: 'auth-doodle', html: icons.heart }),
      el('div', { class: 'auth-doodle', html: icons.music }),
      el('div', { class: 'auth-doodle', html: icons.sparkle }),
      el('div', { class: 'auth-doodle', html: icons.timer }),
      el('div', { class: 'auth-doodle', html: icons.gift }),
      el('div', { class: 'auth-doodle', html: icons.sticker }),
      el('div', { class: 'auth-doodle', html: icons.play }),
    ]);
    root.appendChild(doodles);

    const error = el('div', { class: 'error-box', hidden: true });
    root.appendChild(el('div', { class: 'splash-lang', style: { alignSelf: 'flex-end', position: 'relative', zIndex: 2 } }, [langSwitch({ compact: true })]));
    root.appendChild(el('div', { class: 'auth-logo' }, [
      el('div', { class: 'auth-logo-svg', html: icons.logo, style: { width: '80px', height: '80px', margin: '0 auto 12px' } }),
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
  function mapAuthError(e) {
    const m = (e && e.message) || '';
    if (/Invalid login credentials/i.test(m)) return 'بيانات الدخول غير صحيحة';
    if (/Email not confirmed/i.test(m)) return 'البريد لم يُفعَّل بعد — تحقق من بريدك';
    if (/User already registered/i.test(m)) return 'البريد مسجَّل مسبقًا';
    if (/Password should be at least/i.test(m)) return 'كلمة المرور قصيرة جدًا';
    if (/rate limit|too many/i.test(m)) return 'محاولات كثيرة — حاول لاحقًا';
    if (/network|fetch/i.test(m)) return 'تعذر الاتصال — تحقق من الإنترنت';
    return m || 'حدث خطأ، حاول مجددًا';
  }

  // ===== Register =====
  V.register = () => {
    hideNav();
    const root = el('section', { class: 'auth-screen' });
    const doodles = el('div', { class: 'auth-doodles' }, [
      el('div', { class: 'auth-doodle', html: icons.music }),
      el('div', { class: 'auth-doodle', html: icons.sparkle }),
      el('div', { class: 'auth-doodle', html: icons.heart }),
      el('div', { class: 'auth-doodle', html: icons.video }),
      el('div', { class: 'auth-doodle', html: icons.gift }),
    ]);
    root.appendChild(doodles);
    root.appendChild(topBar({ title: 'إنشاء حساب', onBack: () => go('/login') }));
    const wrap = el('div', { style: { padding: '8px 4px' } });

    function makePassField(placeholder) {
      const inp = el('input', { class: 'input input-with-toggle', type: 'password', placeholder });
      let show = false;
      const btn = el('button', { class: 'password-toggle-btn', type: 'button', html: icons.eyeOff, onclick: () => {
        show = !show;
        inp.type = show ? 'text' : 'password';
        btn.innerHTML = show ? icons.eye : icons.eyeOff;
      } });
      const container = el('div', { style: { position: 'relative' } }, [inp, btn]);
      return { inp, container };
    }

    const passObj = makePassField('كلمة المرور');
    const confirmObj = makePassField('تأكيد كلمة المرور');

    const fields = {
      email: el('input', { class: 'input', type: 'email', placeholder: 'البريد الإلكتروني' }),
      phone: el('input', { class: 'input', type: 'tel', placeholder: 'رقم الهاتف' }),
      pass: passObj.inp,
      confirm: confirmObj.inp,
    };
    const error = el('div', { class: 'error-box', hidden: true });
    wrap.appendChild(el('h2', { class: 'auth-title' }, 'انضم إلى Tenth Tone'));
    wrap.appendChild(el('p', { class: 'auth-subtitle' }, 'بإنشاء حساب أنت توافق على الشروط وسياسة الخصوصية.'));
    wrap.appendChild(error);
    wrap.appendChild(el('div', { class: 'input-wrap' }, [fields.email]));
    wrap.appendChild(el('div', { class: 'input-wrap' }, [fields.phone]));
    wrap.appendChild(el('div', { class: 'input-wrap' }, [passObj.container]));
    wrap.appendChild(el('div', { class: 'input-wrap' }, [confirmObj.container]));
    const regBtn = el('button', { class: 'btn btn-pill', onclick: async () => {
      const errs = [];
      const hasEmail = /.+@.+\..+/.test(fields.email.value);
      const hasPhone = /^[\d\s+()-]{8,}$/.test(fields.phone.value);
      if (!hasEmail && !hasPhone) errs.push('أدخل بريدًا أو رقم هاتف صحيح');
      if (fields.pass.value.length < 8) errs.push('كلمة المرور 8 أحرف على الأقل');
      if (fields.pass.value !== fields.confirm.value) errs.push('كلمتا المرور غير متطابقتين');
      if (errs.length) { error.textContent = errs[0]; error.hidden = false; return; }
      error.hidden = true;
      regBtn.disabled = true;
      regBtn.textContent = 'جاري إنشاء الحساب...';
      try {
        const params = { password: fields.pass.value };
        if (hasEmail) params.email = fields.email.value.trim();
        if (hasPhone) params.phone = fields.phone.value.replace(/\s/g, '');
        await window.SB.signUp(params);
        sessionStorage.setItem('tt-pending-otp', JSON.stringify({ email: params.email, phone: params.phone }));
        toast('تم إرسال رمز التحقق');
        go('/otp');
      } catch (e) {
        error.textContent = mapAuthError(e);
        error.hidden = false;
        regBtn.disabled = false;
        regBtn.textContent = 'تسجيل';
      }
    } }, 'تسجيل');
    wrap.appendChild(regBtn);
    root.appendChild(wrap);
    return root;
  };

  // ===== OTP =====
  V.otp = () => {
    hideNav();
    const root = el('section', { class: 'auth-screen' });
    root.appendChild(topBar({ title: 'التحقق' }));
    const wrap = el('div', { style: { padding: '14px 4px', textAlign: 'center' } });
    wrap.appendChild(el('div', { class: 'auth-logo' }, [
      el('div', { class: 'auth-logo-svg', html: icons.logo, style: { width: '72px', height: '72px', margin: '0 auto 10px' } })
    ]));
    wrap.appendChild(el('h2', { class: 'auth-title' }, 'أدخل رمز التحقق'));
    wrap.appendChild(el('p', { class: 'auth-subtitle' }, 'أرسلنا لك رمزًا مكونًا من 6 أرقام'));
    const inputs = [];
    const row = el('div', { class: 'otp-row' });
    for (let i = 0; i < 6; i++) {
      const inp = el('input', { class: 'otp-input', maxLength: 1, inputMode: 'numeric' });
      inp.addEventListener('input', e => {
        if (e.target.value && i < 5) inputs[i + 1].focus();
        if (inputs.every(x => x.value)) verifyBtn.disabled = false;
        else verifyBtn.disabled = true;
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
    wrap.appendChild(el('div', { class: 'otp-resend' }, [
      document.createTextNode('لم يصلك الرمز؟ '),
      el('a', { class: 'auth-link', onclick: async () => {
        try {
          if (pending.email) await window.SB.signInWithOtp({ email: pending.email });
          else if (pending.phone) await window.SB.signInWithOtp({ phone: pending.phone });
          toast('تم إرسال الرمز مرة أخرى');
        } catch (e) { otpError.textContent = mapAuthError(e); otpError.hidden = false; }
      } }, 'إعادة الإرسال'),
    ]));
    const verifyBtn = el('button', { class: 'btn btn-pill', disabled: true, style: { marginTop: '24px' }, onclick: async () => {
      const code = inputs.map(x => x.value).join('');
      if (code.length !== 6) return;
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
    wrap.appendChild(el('p', { class: 'auth-subtitle' }, 'سنرسل لك رابط/رمز إعادة تعيين'));
    const inp = el('input', { class: 'input', placeholder: 'البريد الإلكتروني' });
    const errBox = el('div', { class: 'error-box', hidden: true });
    wrap.appendChild(errBox);
    wrap.appendChild(el('div', { class: 'input-wrap' }, [inp]));
    const fbtn = el('button', { class: 'btn btn-pill', onclick: async () => {
      if (!inp.value) return;
      fbtn.disabled = true;
      fbtn.textContent = 'جاري الإرسال...';
      try {
        await window.SB.resetPassword(inp.value.trim());
        toast('تم إرسال رابط إعادة التعيين إلى بريدك');
        setTimeout(() => go('/login'), 1500);
      } catch (e) {
        errBox.textContent = mapAuthError(e);
        errBox.hidden = false;
        fbtn.disabled = false;
        fbtn.textContent = 'إرسال الرابط';
      }
    } }, 'إرسال الرابط');
    wrap.appendChild(fbtn);
    root.appendChild(wrap);
    return root;
  };

  // ===== Reset password =====
  V.reset = () => {
    hideNav();
    const root = el('section', { class: 'auth-screen' });
    root.appendChild(topBar({ title: 'كلمة مرور جديدة' }));
    const wrap = el('div', { style: { padding: '14px 4px' } });
    wrap.appendChild(el('h2', { class: 'auth-title' }, 'أدخل كلمة مرور جديدة'));
    wrap.appendChild(el('p', { class: 'auth-subtitle' }, '8 أحرف على الأقل، تشمل رقمًا ورمزًا.'));
    function makePassField(placeholder) {
      const inp = el('input', { class: 'input input-with-toggle', type: 'password', placeholder });
      let show = false;
      const btn = el('button', { class: 'password-toggle-btn', type: 'button', html: icons.eyeOff, onclick: () => {
        show = !show;
        inp.type = show ? 'text' : 'password';
        btn.innerHTML = show ? icons.eye : icons.eyeOff;
      } });
      const container = el('div', { style: { position: 'relative' } }, [inp, btn]);
      return { inp, container };
    }

    const p1Obj = makePassField('كلمة المرور الجديدة');
    const p2Obj = makePassField('تأكيد كلمة المرور');
    const p1 = p1Obj.inp;
    const p2 = p2Obj.inp;
    const err = el('div', { class: 'error-box', hidden: true });
    wrap.appendChild(err);
    wrap.appendChild(el('div', { class: 'input-wrap' }, [p1Obj.container]));
    wrap.appendChild(el('div', { class: 'input-wrap' }, [p2Obj.container]));
    const resetBtn = el('button', { class: 'btn btn-pill', onclick: async () => {
      if (p1.value.length < 8) { err.textContent = 'كلمة المرور 8 أحرف على الأقل'; err.hidden = false; return; }
      if (p1.value !== p2.value) { err.textContent = 'كلمتا المرور غير متطابقتين'; err.hidden = false; return; }
      err.hidden = true;
      resetBtn.disabled = true;
      resetBtn.textContent = 'جاري الحفظ...';
      try {
        await window.SB.updatePassword(p1.value);
        toast('تم تحديث كلمة المرور');
        go('/home');
      } catch (e) {
        err.textContent = mapAuthError(e);
        err.hidden = false;
        resetBtn.disabled = false;
        resetBtn.textContent = 'حفظ كلمة المرور';
      }
    } }, 'حفظ كلمة المرور');
    wrap.appendChild(resetBtn);
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
      el('button', { class: 'feed-tab' + (tab === 'following' ? ' active' : ''), onclick: () => go('/home?tab=following') }, 'متابعون'),
      el('button', { class: 'feed-tab' + (tab === 'foryou' ? ' active' : ''), onclick: () => go('/home?tab=foryou') }, 'لك'),
      el('button', { class: 'feed-tab', onclick: () => go('/live/host-list') }, 'مباشر'),
    ]);
    root.appendChild(tabs);

    const scroll = el('div', { class: 'feed-scroll' });
    root.appendChild(scroll);

    // Adapt DB row to the shape the renderer expects.
    // Prefer the actual video file URL so the feed plays real video.
    const adapt = (v, idx) => {
      idx = idx || 0;
      const vList = (DB && DB.videos) || [];
      const fallbackItem = vList[idx % (vList.length || 1)] || {};
      const videoList = (DB && DB.VIDEO_BG) || [];
      const fallbackBg = videoList[idx % (videoList.length || 1)] || fallbackItem.bg || 'videos/feed-1.mp4';
      const rawUrl = (v && v.video_url && isVideoUrl(v.video_url)) ? v.video_url : fallbackBg;
      return {
        id: (v && v.id) || ('v-' + idx),
        bg: isVideoUrl(rawUrl) ? rawUrl : fallbackBg,
        video_url: isVideoUrl(rawUrl) ? rawUrl : fallbackBg,
        poster: (v && (v.thumbnail || v.poster)) || fallbackItem.thumbnail || '',
        thumbnail: (v && (v.thumbnail || v.poster)) || fallbackItem.thumbnail || '',
        desc: (v && v.description) || fallbackItem.desc || 'Tenth Tone Video #fyp',
        music: (v && v.music) || fallbackItem.music || 'الأصلي',
        likes: (v && v.likes_count) || (1200 + idx * 150),
        comments: (v && v.comments_count) || (45 + idx * 8),
        shares: (v && v.shares_count) || (12 + idx * 3),
        saves: (20 + idx * 4),
        liked: !!(v && v.liked),
        saved: !!(v && v.saved),
        user: {
          id: (v && v.user && v.user.id) || ('u-' + idx),
          handle: (v && v.user && v.user.handle ? '@' + v.user.handle : '@creator'),
          name: (v && v.user && v.user.name) || 'مستخدم',
          avatar: (v && v.user && v.user.avatar_url) || (DB.AVATARS && DB.AVATARS[idx % DB.AVATARS.length]) || ('https://i.pravatar.cc/200?u=creator-' + idx),
        },
      };
    };

    let list = tab === 'following' ? DB.videos.slice(0, 6) : DB.videos;

    // Async fetch from Supabase, replace mock if real videos exist
    (async () => {
      try {
        if (!window.API) return;
        const real = await window.API.fetchFeed({ tab });
        if (real && real.length) {
          list = real.map((r, i) => adapt(r, i));
          scroll.innerHTML = '';
          renderItems();
        } else if (tab === 'following' && (!real || !real.length)) {
          scroll.innerHTML = '';
          scroll.appendChild(el('div', { class: 'feed-empty' }, [
            el('p', {}, 'لا تتابع أي حساب بعد'),
            el('button', { class: 'btn btn-outline', onclick: () => go('/discover') }, 'استكشف حسابات'),
          ]));
        }
      } catch (e) { console.warn('feed fetch failed, showing mock:', e); }
    })();

    function renderItems() { list.forEach((v, i) => renderItem(v, i)); }
    function renderItem(v, idx) {
      const fallbackUrl = (DB.VIDEO_BG && DB.VIDEO_BG[idx % DB.VIDEO_BG.length]) || 'videos/feed-1.mp4';
      const videoSrc = (v.video_url && isVideoUrl(v.video_url)) ? v.video_url : ((v.bg && isVideoUrl(v.bg)) ? v.bg : fallbackUrl);
      const isVideo = !!videoSrc;
      // Show dark sleek backdrop while video streams
      const item = el('div', { class: 'feed-item', style: { background: '#000' } });
      if (isVideo) {
        const video = document.createElement('video');
        video.src = videoSrc;
        video.autoplay = true;
        video.muted = true;
        video.defaultMuted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.setAttribute('muted', '');
        video.setAttribute('autoplay', '');
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

        video.addEventListener('error', () => {
          if (!video._retried) {
            video._retried = true;
            video.src = (DB.VIDEO_BG && DB.VIDEO_BG[(idx + 1) % DB.VIDEO_BG.length]) || 'videos/feed-1.mp4';
            video.play().catch(() => {});
          }
        });

        // Direct autoplay handler
        video.addEventListener('canplay', () => { video.play().catch(() => {}); });
        video.addEventListener('loadeddata', () => { video.play().catch(() => {}); });
        // Initial play attempt
        video.play().catch(() => {});

        // Tap on feed item to toggle play/pause + unmute
        item.addEventListener('click', (e) => {
          if (e.target.closest('.feed-actions') || e.target.closest('.feed-info') || e.target.closest('.feed-tabs')) return;
          if (video.muted) { video.muted = false; }
          if (video.paused) {
            video.play().then(() => { playBadge.style.display = 'none'; }).catch(() => {});
          } else {
            video.pause();
            playBadge.style.display = 'flex';
          }
        });

        // IntersectionObserver for vertical scrolling autoplay
        const io = new IntersectionObserver(entries => {
          entries.forEach(e => {
            if (e.isIntersecting) {
              video.play().then(() => { playBadge.style.display = 'none'; }).catch(() => {});
            } else {
              video.pause();
            }
          });
        }, { threshold: 0.5 });
        io.observe(item);
      }


      // Music in vertical layout to the right of the small music button
      const musicRaw = v.music || 'الأصلي';
      const musicParts = musicRaw.split(' - ');
      const musicTitle = musicParts[0] || musicRaw;
      const musicAuthor = musicParts[1] || (v.user && v.user.name) || 'Tenth Tone Sound';

      const musicRow = el('div', { class: 'feed-music-row', onclick: (e) => { e.stopPropagation(); toast('🎵 ' + musicRaw); } }, [
        el('button', { class: 'small-music-btn', title: 'صوت الموسيقى' }, [
          svg('music'),
        ]),
        el('div', { class: 'music-info-vertical' }, [
          el('span', { class: 'music-title' }, musicTitle),
          el('span', { class: 'music-author' }, musicAuthor),
        ]),
      ]);

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
          el('span', { class: 'desc-text' }, plainText),
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
        descEl = el('p', { class: 'desc', style: { margin: '4px 0', fontSize: '14px', lineHeight: '1.4' } }, plainText);
      }

      const info = el('div', { class: 'feed-info' }, [
        el('div', { class: 'feed-user-row', style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' } }, [
          avatar(v.user.avatar, v.user.name, 26),
          el('p', { class: 'username', style: { margin: 0 } }, v.user.handle),
          el('span', { class: 'hot-tag' }, '🔥 HOT')
        ]),
        descEl,
        musicRow,
      ]);
      item.appendChild(info);

      // Left action bar
      const actions = el('div', { class: 'feed-actions' });
      // Avatar with follow/unfollow toggle (synced via window._followedUsers)
      if (!window._followedUsers) window._followedUsers = {};
      let followed = !!window._followedUsers[v.user.id];
      const followBadge = el('span', { class: 'follow-plus' + (followed ? ' followed' : '') }, followed ? '✓' : '+');
      const avBtn = el('div', { class: 'feed-avatar-action' }, [
        avatar(v.user.avatar, v.user.name, 44),
        followBadge,
      ]);
      followBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        followed = !followed;
        window._followedUsers[v.user.id] = followed;
        followBadge.textContent = followed ? '✓' : '+';
        followBadge.classList.toggle('followed', followed);
        followBadge.style.transform = 'translateX(-50%) scale(1.4)';
        setTimeout(() => { followBadge.style.transform = 'translateX(-50%) scale(1)'; }, 200);
        // Rich follow toast with avatar + name
        if (followed) {
          const existingToast = document.querySelector('.toast');
          if (existingToast) existingToast.remove();
          const t = document.createElement('div');
          t.className = 'toast';
          t.innerHTML = `
            <img class="toast-avatar" src="${v.user.avatar}" alt="${v.user.name}" onerror="this.style.display='none'">
            <div class="toast-text">
              <span class="toast-title">Started following ${v.user.name}</span>
              <span class="toast-sub">Tap their profile to see their videos</span>
            </div>`;
          document.body.appendChild(t);
          setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 300); }, 2800);
        }
        if (window.API && typeof v.user.id === 'string' && v.user.id.length > 4) {
          try { followed ? window.API.follow(v.user.id) : window.API.unfollow(v.user.id); } catch(_) {}
        }
      });
      avBtn.onclick = (e) => { if (!e.target.closest('.follow-plus')) go('/profile/' + v.user.id); };
      actions.appendChild(avBtn);

      const likeBtn = el('button', { class: 'feed-action' + (v.liked ? ' liked' : ''), onclick: async () => {
        const wasLiked = v.liked;
        v.liked = !wasLiked;
        v.likes += v.liked ? 1 : -1;
        likeBtn.classList.toggle('liked', v.liked);
        likeBtn.querySelector('.feed-action-count').textContent = fmt(v.likes);
        if (typeof v.id === 'string' && v.id.length > 10 && window.API) {
          try { wasLiked ? await window.API.unlike(v.id) : await window.API.like(v.id); }
          catch (e) { /* revert on error */ v.liked = wasLiked; v.likes += wasLiked ? 1 : -1; likeBtn.classList.toggle('liked', wasLiked); likeBtn.querySelector('.feed-action-count').textContent = fmt(v.likes); }
        }
      } }, [
        el('span', { class: 'feed-action-icon no-bg', html: icons.heart }),
        el('span', { class: 'feed-action-count' }, fmt(v.likes)),
      ]);
      actions.appendChild(likeBtn);

      const commentBtn = el('button', { class: 'feed-action', onclick: () => go('/comments/' + v.id) }, [
        el('span', { class: 'feed-action-icon no-bg', html: icons.comment }),
        el('span', { class: 'feed-action-count' }, fmt(v.comments)),
      ]);
      actions.appendChild(commentBtn);

      const saveBtn = el('button', { class: 'feed-action', onclick: async () => {
        v.saved = !v.saved;
        toast(v.saved ? 'تم الحفظ' : 'تم إلغاء الحفظ');
        if (typeof v.id === 'string' && v.id.length > 10 && window.API) {
          try { v.saved ? await window.API.save(v.id) : await window.API.unsave(v.id); } catch (e) {}
        }
      } }, [
        el('span', { class: 'feed-action-icon no-bg', html: icons.bookmark }),
        el('span', { class: 'feed-action-count' }, fmt(v.saves)),
      ]);
      actions.appendChild(saveBtn);

      const shareBtn = el('button', { class: 'feed-action', onclick: () => go('/share/' + v.id) }, [
        el('span', { class: 'feed-action-icon no-bg', html: icons.share }),
        el('span', { class: 'feed-action-count' }, fmt(v.shares)),
      ]);
      actions.appendChild(shareBtn);

      // Mini rotating music disc action button
      const musicDiscBtn = el('button', {
        class: 'feed-action feed-music-action',
        style: { marginTop: '4px' },
        onclick: (e) => { e.stopPropagation(); toast('🎵 ' + musicRaw); }
      }, [
        el('div', { class: 'music-disc-mini' }, [
          el('img', { src: v.user.avatar || (DB.AVATARS && DB.AVATARS[0]), alt: 'music', onerror: (e) => { e.target.style.display = 'none'; } }),
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
  function createVideoCard(v, i, onClick) {
    const videoSrc = (v && v.video_url && isVideoUrl(v.video_url)) ? v.video_url : ((v && v.bg && isVideoUrl(v.bg)) ? v.bg : ((DB && DB.VIDEO_BG && DB.VIDEO_BG[i % DB.VIDEO_BG.length]) || 'videos/feed-1.mp4'));
    const posterSrc = (v && (v.thumbnail || v.poster)) || (DB && DB.THUMBNAILS && DB.THUMBNAILS[i % DB.THUMBNAILS.length]) || '';

    const card = el('div', { class: 'video-card', onclick: onClick || (() => go('/home')) });

    const video = document.createElement('video');
    video.src = videoSrc;
    if (posterSrc && !posterSrc.endsWith('.mp4')) video.poster = posterSrc;
    video.autoplay = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('muted', '');
    video.setAttribute('autoplay', '');
    video.setAttribute('loop', '');
    video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;';

    video.addEventListener('canplay', () => video.play().catch(() => {}));
    video.addEventListener('loadeddata', () => video.play().catch(() => {}));
    video.addEventListener('error', () => {
      if (!video._retried) {
        video._retried = true;
        video.src = (DB && DB.VIDEO_BG && DB.VIDEO_BG[(i + 1) % DB.VIDEO_BG.length]) || 'videos/feed-1.mp4';
        video.play().catch(() => {});
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
      { id: 'accounts', ar: 'حسابات', en: 'Accounts' },
      { id: 'sounds', ar: 'أصوات', en: 'Sounds' }
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

    function renderDefault() {
      resultsArea.innerHTML = '';
      
      const showAll = currentTag === 'all';
      const showVideos = showAll || currentTag === 'videos';
      const showAccounts = showAll || currentTag === 'accounts';
      const showSounds = showAll || currentTag === 'sounds';

      // 1. Trending Hashtags (shown in All or Videos)
      if (showAll || showVideos) {
        resultsArea.appendChild(el('h3', { class: 'section-title' }, 'هاشتاجات رائجة 🔥'));
        const trend = el('div', { class: 'trending-row' });
        DB.trending.forEach((t, i) => trend.appendChild(el('div', { class: 'trending-item', onclick: () => { searchInput.value = t.tag; doSearch(); } }, [
          el('div', { class: 'trending-rank' }, '#' + (i + 1)),
          el('div', { class: 'trending-text' }, t.tag),
          el('div', { class: 'trending-meta' }, t.meta),
        ])));
        resultsArea.appendChild(trend);
      }

      // 2. Featured Creators / Accounts
      if (showAccounts) {
        resultsArea.appendChild(el('h3', { class: 'section-title' }, showAll ? 'صُنّاع محتوى مميزون 🌟' : 'جميع الحسابات المقترحة 🌟'));
        if (showAll) {
          const creatorsRow = el('div', { style: { display: 'flex', gap: '12px', padding: '6px 16px 16px', overflowX: 'auto' } });
          DB.users.slice(0, 8).forEach(u => {
            const item = el('div', {
              style: { display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '80px', cursor: 'pointer', textAlign: 'center' },
              onclick: () => go('/profile/' + u.id)
            }, [
              avatar(u.avatar, u.name, 60),
              el('div', { style: { fontSize: '12px', fontWeight: '700', marginTop: '6px', maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, u.name),
              el('div', { class: 'muted', style: { fontSize: '10.5px' } }, fmt(u.followers) + ' متابع')
            ]);
            creatorsRow.appendChild(item);
          });
          resultsArea.appendChild(creatorsRow);
        } else {
          // Full list of accounts when 'Accounts' filter is selected
          const accountsList = el('div', { style: { padding: '0 16px 16px' } });
          DB.users.forEach(u => {
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

      // 3. Trending Sounds
      if (showSounds) {
        resultsArea.appendChild(el('h3', { class: 'section-title' }, 'أصوات وموسيقى رائجة 🎵'));
        const soundsList = el('div', { style: { padding: '0 16px 14px' } });
        const soundsToDisplay = showAll ? DB.sounds.slice(0, 4) : DB.sounds;
        soundsToDisplay.forEach(s => {
          soundsList.appendChild(el('div', { class: 'user-row', style: { padding: '10px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }, onclick: () => toast('صوت: ' + s.title) }, [
            el('div', { class: 'avatar', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--primary-soft)', color: 'var(--primary)' } }, [svg('music')]),
            el('div', { style: { flex: 1, minWidth: 0 } }, [
              el('div', { class: 'name', style: { fontSize: '13.5px', fontWeight: '700' } }, s.title),
              el('div', { class: 'handle', style: { fontSize: '11.5px' } }, s.author_name + ' · ' + fmt(s.usage_count) + ' فيديو · ' + (s.duration || 30) + 'ث'),
            ]),
            el('button', { class: 'btn btn-secondary btn-sm', style: { width: 'auto' }, onclick: (e) => { e.stopPropagation(); toast('استخدام هذا الصوت'); go('/camera'); } }, 'استخدام'),
          ]));
        });
        resultsArea.appendChild(soundsList);
      }

      // 4. Popular Videos Grid
      if (showVideos) {
        resultsArea.appendChild(el('h3', { class: 'section-title' }, showAll ? 'فيديوهات شائعة 🎬' : 'جميع الفيديوهات الشائعة 🎬'));
        const grid = el('div', { class: 'video-grid' });
        DB.videos.forEach((v, i) => grid.appendChild(createVideoCard(v, i, () => go('/home'))));
        resultsArea.appendChild(grid);
      }
    }

    async function doSearch() {
      const q = searchInput.value.trim();
      if (!q) { renderDefault(); return; }
      resultsArea.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted)">جاري البحث...</div>';

      const showAll = currentTag === 'all';
      const showVideos = showAll || currentTag === 'videos';
      const showAccounts = showAll || currentTag === 'accounts';
      const showSounds = showAll || currentTag === 'sounds';

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

        if (showSounds) {
          if (res.sounds && res.sounds.length) {
            resultsArea.appendChild(el('h3', { class: 'section-title' }, 'الأصوات والموسيقى'));
            res.sounds.forEach(s => {
              resultsArea.appendChild(el('div', { class: 'user-row', style: { cursor: 'pointer' }, onclick: () => toast('صوت: ' + s.title) }, [
                el('div', { class: 'avatar', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--primary-soft)', color: 'var(--primary)' } }, [svg('music')]),
                el('div', { style: { flex: 1, minWidth: 0 } }, [
                  el('div', { class: 'name' }, s.title),
                  el('div', { class: 'handle' }, s.author_name + ' · ' + fmt(s.usage_count || 0) + ' فيديو'),
                ]),
                el('button', { class: 'btn btn-secondary btn-sm', style: { width: 'auto' }, onclick: (e) => { e.stopPropagation(); toast('استخدام هذا الصوت'); go('/camera'); } }, 'استخدام'),
              ]));
            });
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
      clearTimeout(tSearch);
      tSearch = setTimeout(doSearch, 300);
    });

    renderDefault();
    return root;
  };

  // ===== Create entry =====
  V.create = () => {
    bottomNav('create');
    const root = el('section', { class: 'create-wrap' });
    root.appendChild(topBar({ title: 'إنشاء جديد', back: false, right: el('button', { class: 'icon-btn', html: icons.x, onclick: () => go('/home') }) }));

    // Hidden file picker shared with the "upload" card
    const fileInput = el('input', { type: 'file', accept: 'video/*,image/*', style: { display: 'none' } });
    fileInput.addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      window._ttPendingClip = f;
      go('/publish');
    });
    root.appendChild(fileInput);

    [
      { icon: 'rec', label: 'تسجيل فيديو', desc: 'استخدم الكاميرا لتصوير فيديو قصير', action: () => go('/camera') },
      { icon: 'up', label: 'رفع من الجهاز', desc: 'اختر فيديو أو صورة من المعرض', action: () => fileInput.click() },
      { icon: 'live', label: 'بث مباشر', desc: 'تواصل مع جمهورك مباشرة', action: () => go('/live/start') },
      { icon: 'template', label: 'قوالب جاهزة', desc: 'ابدأ من قالب وعدّله', action: () => go('/camera') },
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
  V.camera = () => {
    hideNav();
    const root = el('section', { class: 'camera' });

    // Live preview <video>
    const previewWrap = el('div', { class: 'camera-preview' });
    const previewVideo = Object.assign(document.createElement('video'), { autoplay: true, muted: true, playsInline: true });
    previewVideo.setAttribute('playsinline', '');
    previewVideo.style.cssText = 'width:100%;height:100%;object-fit:cover;background:#000';
    previewWrap.appendChild(previewVideo);
    root.appendChild(previewWrap);

    let stream = null;
    let recorder = null;
    let chunks = [];
    let facingMode = 'user'; // 'user' | 'environment'
    let secs = 0, timer = null;
    let maxSecs = 60;
    const dur = el('span', { class: 'camera-side-pill' }, '00:00');

    async function startCamera() {
      try {
        if (stream) stream.getTracks().forEach(t => t.stop());
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode },
          audio: true,
        });
        previewVideo.srcObject = stream;
      } catch (e) {
        previewWrap.innerHTML = '';
        previewWrap.appendChild(el('div', { style: { color: '#fff', padding: '20px', textAlign: 'center' } }, [
          el('p', {}, '⚠️ تعذر فتح الكاميرا'),
          el('p', { style: { fontSize: '12px', opacity: 0.7 } }, e.message || 'الرجاء السماح بالوصول إلى الكاميرا والميكروفون.'),
          el('button', { class: 'btn btn-pill', style: { marginTop: '12px' }, onclick: () => go('/upload') }, 'رفع من المعرض بدلًا من ذلك'),
        ]));
      }
    }
    startCamera();

    function stopAll() {
      if (timer) clearInterval(timer);
      try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (e) {}
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
      try { recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined); }
      catch (e) { toast('المتصفح لا يدعم التسجيل'); return; }
      recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = () => {
        const ext = (recorder.mimeType || '').includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunks, { type: recorder.mimeType || ('video/' + ext) });
        const file = new File([blob], `clip-${Date.now()}.${ext}`, { type: blob.type });
        // Park the file in a global so /publish picks it up
        window._ttPendingClip = file;
        stopAll();
        go('/publish');
      };
      recorder.start();
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
      recBtn.classList.remove('recording');
      if (timer) { clearInterval(timer); timer = null; }
    }

    root.appendChild(el('div', { class: 'camera-top', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', position: 'absolute', top: 0, width: '100%', zIndex: 10 } }, [
      el('button', { class: 'icon-btn', html: icons.x, onclick: () => { stopAll(); go('/create'); }, style: { color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.5)' } }),
      el('button', { class: 'camera-sound-pill', onclick: () => openSoundPicker(), style: { display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '6px 14px', borderRadius: '999px', fontSize: '14px', fontWeight: 'bold', backdropFilter: 'blur(8px)', cursor: 'pointer', gap: '6px' } }, [
        svg('music'),
        el('span', { class: 'sound-name' }, 'أضف صوتًا'),
      ]),
      el('div', { style: { display: 'flex', gap: '16px' } }, [
        el('button', { class: 'icon-btn', html: icons.search, style: { color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.5)' } })
      ])
    ]));
    let selectedSound = null;
    const soundPill = root.querySelector('.camera-sound-pill');

    async function openSoundPicker() {
      const sheet = el('div', { class: 'gift-sheet', style: { maxHeight: '60vh', overflowY: 'auto' } });
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

    root.appendChild(el('div', { class: 'camera-side', style: { position: 'absolute', right: '12px', top: '80px', display: 'flex', flexDirection: 'column', gap: '16px', zIndex: 10 } }, [
      el('button', { class: 'camera-side-btn', style: { background: 'transparent', border: 'none', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }, onclick: async () => { facingMode = facingMode === 'user' ? 'environment' : 'user'; await startCamera(); } }, [svg('flip'), el('span', { style: { fontSize: '10px', fontWeight: 'bold' } }, 'قلب')]),
      el('button', { class: 'camera-side-btn', style: { background: 'transparent', border: 'none', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', textShadow: '0 1px 2px rgba(0,0,0,0.5)' } }, [svg('sparkle'), el('span', { style: { fontSize: '10px', fontWeight: 'bold' } }, 'تجميل')]),
      el('button', { class: 'camera-side-btn', style: { background: 'transparent', border: 'none', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }, onclick: () => toast('مؤقت التسجيل') }, [svg('timer'), el('span', { style: { fontSize: '10px', fontWeight: 'bold' } }, 'مؤقت')]),
      el('button', { class: 'camera-side-btn', style: { background: 'transparent', border: 'none', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }, onclick: () => toast('الفلاتر') }, [svg('filter'), el('span', { style: { fontSize: '10px', fontWeight: 'bold' } }, 'فلاتر')]),
      el('button', { class: 'camera-side-btn', style: { background: 'transparent', border: 'none', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }, onclick: () => toast('فلاش') }, [svg('flash'), el('span', { style: { fontSize: '10px', fontWeight: 'bold' } }, 'فلاش')]),
    ]));

    const recBtn = el('button', { class: 'record-btn', style: { width: '80px', height: '80px', borderRadius: '50%', background: 'transparent', border: '4px solid #fe2c55', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }, onclick: () => {
      if (!recorder || recorder.state === 'inactive') startRec(); else stopRec();
    } }, [el('div', { class: 'inner', style: { width: '64px', height: '64px', borderRadius: '50%', background: '#fe2c55', transition: 'all 0.2s' } })]);

    const speedRow = el('div', { class: 'camera-speed', style: { display: 'flex', justifyContent: 'center', gap: '20px', color: '#fff', fontSize: '14px', fontWeight: 'bold', textShadow: '0 1px 2px rgba(0,0,0,0.5)', paddingBottom: '16px' } }, [
      el('span', {}, '0.3x'), el('span', {}, '0.5x'), el('span', { style: { color: '#ffaa00' } }, '1x'), el('span', {}, '2x'), el('span', {}, '3x')
    ]);

    const durationsRow = el('div', { class: 'camera-durations', style: { display: 'flex', justifyContent: 'center', gap: '24px', color: 'rgba(255,255,255,0.7)', fontSize: '13px', fontWeight: 'bold', marginTop: '16px' } }, [
      el('span', { onclick: e => setMax(60, e) }, '60s'),
      el('span', { class: 'active', style: { color: '#fff' }, onclick: e => setMax(15, e) }, '15s'),
      el('span', { onclick: e => setMax(3, e) }, 'Photo'),
    ]);
    function setMax(n, e) { maxSecs = n; durationsRow.querySelectorAll('span').forEach(s => s.style.color = 'rgba(255,255,255,0.7)'); e.currentTarget.style.color = '#fff'; }

    root.appendChild(el('div', { class: 'camera-bottom', style: { position: 'absolute', bottom: 'calc(20px + var(--safe-bottom))', width: '100%', display: 'flex', flexDirection: 'column' } }, [
      speedRow,
      el('div', { class: 'camera-record', style: { display: 'flex', justifyContent: 'space-around', alignItems: 'center', width: '100%', padding: '0 24px' } }, [
        el('button', { style: { background: 'transparent', border: 'none', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }, onclick: () => toast('مؤثرات') }, [
          el('div', { style: { width: '36px', height: '36px', borderRadius: '8px', background: '#333' } }),
          el('span', { style: { fontSize: '11px', fontWeight: 'bold' } }, 'مؤثرات')
        ]),
        recBtn,
        el('button', { style: { background: 'transparent', border: 'none', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }, onclick: () => { stopAll(); go('/upload'); } }, [
          el('div', { style: { width: '36px', height: '36px', borderRadius: '8px', background: '#333' } }),
          el('span', { style: { fontSize: '11px', fontWeight: 'bold' } }, 'رفع')
        ]),
      ]),
      durationsRow,
      el('div', { class: 'text-center', style: { color: '#fff', marginTop: '12px', fontSize: '14px', fontWeight: 'bold', textShadow: '0 1px 2px rgba(0,0,0,0.5)' } }, [dur]),
    ]));
    return root;
  };

  // ===== Edit video =====
  V.editVideo = () => {
    hideNav();
    const root = el('section', { class: 'edit-video' });
    root.appendChild(el('header', { class: 'top-bar dark' }, [
      el('button', { class: 'icon-btn dark', html: icons.x, onclick: () => go('/create') }),
      el('h1', { class: 'title' }, 'تعديل الفيديو'),
      el('button', { class: 'btn btn-sm', style: { width: 'auto' }, onclick: () => go('/publish') }, 'التالي'),
    ]));
    root.appendChild(el('div', { class: 'edit-preview' }, '🎬 معاينة الفيديو'));
    const tools = el('div', { class: 'edit-tools' });
    [
      { i: 'music', l: 'صوت' },
      { i: 'filter', l: 'فلاتر' },
      { i: 'sparkle', l: 'مؤثرات' },
      { i: 'text', l: 'نص' },
      { i: 'sticker', l: 'ملصقات' },
      { i: 'timer', l: 'سرعة' },
      { i: 'image', l: 'غلاف' },
    ].forEach(t => tools.appendChild(el('button', { class: 'edit-tool' }, [
      el('span', { class: 'edit-tool-icon', html: icons[t.i] }),
      el('span', {}, t.l),
    ])));
    root.appendChild(tools);
    return root;
  };

  // ===== Publish =====
  V.publish = () => {
    hideNav();
    const root = el('section');
    root.appendChild(topBar({ title: 'نشر', onBack: () => go('/edit-video') }));
    const v = DB.videos[0];
    const wrap = el('div', { class: 'publish' });
    const descInput = el('textarea', { placeholder: 'صف فيديوك، أضف وسومًا (#) أو ذكر مستخدمين (@)' });
    const fileInput = el('input', { type: 'file', accept: 'video/*,image/*', style: { display: 'none' } });
    const thumb = el('div', { class: 'publish-thumb', style: { backgroundImage: `url(${v.bg})`, position: 'relative' } });
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
    if (chosenFile) showPreview(chosenFile);

    fileInput.addEventListener('change', e => {
      chosenFile = e.target.files[0];
      showPreview(chosenFile);
    });
    thumb.style.cursor = 'pointer';
    thumb.onclick = () => fileInput.click();
    wrap.appendChild(el('div', { class: 'publish-row' }, [descInput, thumb, fileInput]));
    wrap.appendChild(el('div', { class: 'publish-row-link', onclick: () => toast('قيد التطوير') }, [
      el('span', { class: 'left' }, [svg('user'), document.createTextNode(' الإشارة إلى أشخاص')]),
      el('span', { class: 'chev', html: icons.chevL }),
    ]));
    wrap.appendChild(el('div', { class: 'publish-row-link', onclick: () => toast('قيد التطوير') }, [
      el('span', { class: 'left' }, [svg('map'), document.createTextNode(' إضافة موقع')]),
      el('span', { class: 'chev', html: icons.chevL }),
    ]));
    wrap.appendChild(el('div', { class: 'publish-row-link' }, [
      el('span', { class: 'left' }, [svg('lock'), document.createTextNode(' من يستطيع المشاهدة')]),
      el('span', { class: 'privacy-pill' }, [svg('globe'), document.createTextNode(' عام')]),
    ]));
    wrap.appendChild(el('div', { class: 'publish-row-link' }, [
      el('span', { class: 'left' }, ['السماح بالتعليقات']),
      el('div', { class: 'toggle on', onclick: e => e.currentTarget.classList.toggle('on') }),
    ]));
    wrap.appendChild(el('div', { class: 'publish-row-link' }, [
      el('span', { class: 'left' }, ['السماح بالحفظ']),
      el('div', { class: 'toggle on', onclick: e => e.currentTarget.classList.toggle('on') }),
    ]));
    const errBox = el('div', { class: 'error-box', hidden: true, style: { marginTop: '12px' } });
    wrap.appendChild(errBox);
    const draftBtn = el('button', { class: 'btn btn-secondary btn-pill' }, 'حفظ كمسودة');
    const pubBtn = el('button', { class: 'btn btn-pill' }, 'نشر');
    async function publish(isDraft) {
      const btn = isDraft ? draftBtn : pubBtn;
      const desc = descInput.value.trim();
      if (!chosenFile && !isDraft) { errBox.textContent = 'اختر ملف فيديو أو صورة أولاً'; errBox.hidden = false; return; }
      errBox.hidden = true; btn.disabled = true; btn.textContent = isDraft ? 'جاري الحفظ...' : 'جاري النشر...';
      try {
        if (window.API) {
          const sound = window._ttSelectedSound || null;
          await window.API.publishVideo({
            file: chosenFile,
            description: desc,
            music: sound ? (sound.title + ' - ' + sound.author_name) : 'الأصلي',
            sound_id: sound ? sound.id : null,
            privacy: 'public',
            is_draft: isDraft
          });
          window._ttSelectedSound = null;
        }
        toast(isDraft ? 'تم الحفظ كمسودة' : 'تم النشر بنجاح');
        go('/profile');
      } catch (e) {
        errBox.textContent = (e && e.message) || 'تعذر الرفع';
        errBox.hidden = false;
        btn.disabled = false;
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
    
    // Add Notifications bell icon to the top nav bar
    const notifBtn = el('button', { class: 'icon-btn', onclick: () => go('/notifications'), style: { position: 'relative' } }, [
      svg('bell'),
      el('div', { class: 'badge', style: { position: 'absolute', top: '4px', right: '4px', background: 'var(--danger)', color: '#fff', fontSize: '10px', padding: '2px 5px', borderRadius: '10px', fontWeight: 'bold' } }, '9')
    ]);
    root.appendChild(topBar({ title: 'البريد', back: false, right: notifBtn }));

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

    const list = el('div', { class: 'inbox-list' });
    root.appendChild(list);

    // Render mock by default; replace with real chats async
    function renderChats(chats) {
      list.innerHTML = '';
      if (!chats.length) { list.appendChild(el('div', { class: 'empty-state', style: { padding: '40px', textAlign: 'center', color: 'var(--muted)' } }, 'لا توجد محادثات بعد')); return; }
      chats.forEach(c => list.appendChild(el('div', { class: 'inbox-row', onclick: () => go('/chat/' + c.id) }, [
        el('div', { class: 'inbox-avatar' }, [
          Object.assign(document.createElement('img'), { src: c.avatar || '', alt: c.title, loading: 'lazy' }),
        ]),
        el('div', { class: 'inbox-body' }, [
          el('div', { class: 'inbox-name' }, [
            el('span', {}, c.title),
            el('span', { class: 'time' }, _agoShort((c.last_message && c.last_message.created_at) || c.created_at)),
          ]),
          el('p', { class: 'inbox-msg' }, _msgPreview(c.last_message)),
        ]),
      ])));
    }
    function _agoShort(iso) { if (!iso) return ''; const t = Date.now() - new Date(iso).getTime(); const m = Math.floor(t / 60000); if (m < 1) return 'الآن'; if (m < 60) return m + 'د'; const h = Math.floor(m / 60); if (h < 24) return h + 'س'; const d = Math.floor(h / 24); return d + 'ي'; }
    function _msgPreview(m) { if (!m) return 'ابدأ محادثة'; if (m.type === 'voice') return '🎤 رسالة صوتية'; if (m.type === 'image') return '📷 صورة'; if (m.type === 'video') return '🎥 فيديو'; return (m.text || '').slice(0, 60); }

    renderChats(DB.chats.map(c => ({ id: c.id, title: c.user.name, avatar: c.user.avatar, last_message: { text: c.last, created_at: new Date().toISOString() }, created_at: new Date().toISOString() })));
    (async () => {
      try { 
        if (window.API) {
          const apiChats = await window.API.fetchChats();
          if (apiChats && apiChats.length > 0) renderChats(apiChats);
        }
      } catch (e) { console.warn('chats:', e); }
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
    const groupName = isGroup ? el('input', { class: 'input', placeholder: 'اسم المجموعة', style: { marginBottom: '12px' } }) : null;
    const groupPhoto = isGroup ? el('input', { type: 'file', accept: 'image/*' }) : null;
    if (groupName) wrap.appendChild(groupName);
    if (groupPhoto) wrap.appendChild(el('div', { class: 'input-wrap' }, [el('label', { class: 'input-label' }, 'صورة المجموعة (اختياري)'), groupPhoto]));

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
    (async () => { try { const u = await window.SB.getUser(); myId = u && u.id; renderUsers(); } catch (e) {} })();

    async function search(q) {
      try {
        if (window.API) {
          const res = await window.API.searchProfiles(q || '');
          if (res && res.length) allUsers = res;
          else if (!q) allUsers = DB.users.map(u => ({ id: u.id, name: u.name, handle: u.handle.replace('@', ''), avatar_url: u.avatar, verified: u.verified }));
        }
      } catch (e) {
        if (!q && DB && DB.users) allUsers = DB.users.map(u => ({ id: u.id, name: u.name, handle: u.handle.replace('@', ''), avatar_url: u.avatar, verified: u.verified }));
      }
      renderUsers();
    }
    function renderUsers() {
      userList.innerHTML = '';
      // Filter out current user so they can't try to DM themselves
      const filtered = allUsers.filter(u => u.id !== myId);
      if (!filtered.length) {
        userList.appendChild(el('div', { style: { padding: '40px', textAlign: 'center', color: 'var(--muted)' } }, 'لا يوجد مستخدمون آخرون'));
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
      wrap.appendChild(createBtn);
    }

    const input = wrap.querySelector('#search-users');
    let t; input && input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => search(input.value), 250); });
    search('');
    root.appendChild(wrap);
    return root;
  };

  // ===== Chat =====
  V.chat = (params) => {
    hideNav();
    const id = params.id;
    const root = el('section', { class: 'chat' });
    const headerName = el('div', { class: 'name' }, '...');
    const headerStatus = el('div', { class: 'status' }, '');
    const headerImg = Object.assign(document.createElement('img'), { src: '' });
    root.appendChild(el('header', { class: 'chat-header' }, [
      el('button', { class: 'icon-btn', html: icons.chevR, onclick: () => go('/inbox') }),
      el('div', { class: 'inbox-avatar', style: { width: '36px', height: '36px' } }, [headerImg]),
      el('div', { style: { flex: 1, minWidth: 0 } }, [headerName, headerStatus]),
      el('button', { class: 'icon-btn', html: icons.phone }),
      el('button', { class: 'icon-btn', html: icons.video }),
    ]));
    const msgs = el('div', { class: 'chat-msgs' });
    root.appendChild(msgs);

    let myUserId = null;
    function fmtTime(iso) { try { return new Date(iso).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
    function appendMessage(m) {
      const mine = m.from_user_id === myUserId;
      const bubble = el('div', { class: 'bubble ' + (mine ? 'me' : 'them') });
      if (m.attachment_url && (m.type === 'image' || m.type === 'video')) {
        const tag = m.type === 'image' ? Object.assign(document.createElement('img'), { src: m.attachment_url, style: 'max-width:220px;border-radius:8px' })
                                       : Object.assign(document.createElement('video'), { src: m.attachment_url, controls: true, style: 'max-width:220px;border-radius:8px' });
        bubble.appendChild(tag);
      } else if (m.attachment_url && m.type === 'voice') {
        bubble.appendChild(Object.assign(document.createElement('audio'), { src: m.attachment_url, controls: true }));
      }
      if (m.text) bubble.appendChild(document.createTextNode(m.text));
      bubble.appendChild(el('div', { class: 't' }, fmtTime(m.created_at)));
      msgs.appendChild(bubble);
    }

    // Render mock first, swap when API loads
    const mockChat = DB.chats.find(x => x.id === id) || DB.chats[0];
    headerName.textContent = mockChat.user.name; headerImg.src = mockChat.user.avatar; headerStatus.textContent = mockChat.online ? 'متصل الآن' : 'آخر ظهور قريبًا';
    mockChat.messages.forEach(m => appendMessage({ from_user_id: m.from === 'me' ? 'me' : 'them', text: m.text, created_at: new Date().toISOString() }));

    let unsub = null;
    (async () => {
      try {
        const user = await window.SB.getUser(); myUserId = user && user.id;
        if (!window.API) return;
        // Load DB messages — but only if id looks like a uuid
        if (typeof id !== 'string' || id.length < 30) return;
        const messages = await window.API.fetchMessages(id);
        msgs.innerHTML = '';
        messages.forEach(appendMessage);
        msgs.scrollTop = msgs.scrollHeight;

        // Subscribe realtime
        unsub = window.API.subscribeToMessages(id, (m) => {
          appendMessage(m);
          msgs.scrollTop = msgs.scrollHeight;
        });
      } catch (e) { console.warn('chat load:', e); }
    })();

    // Hidden file pickers — separate ones for video clips vs other attachments
    const fileInput = el('input', { type: 'file', accept: 'image/*,video/*,audio/*', style: { display: 'none' } });
    const videoInput = el('input', { type: 'file', accept: 'video/*', style: { display: 'none' } });
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

    // ─── TRUE Walkie-Talkie button — live audio broadcast while holding ───
    const pttBtn = el('button', { class: 'icon-btn', html: icons.mic, title: 'اضغط مطولًا للتحدث', style: { transition: 'transform 120ms ease, background 120ms ease', borderRadius: '50%' } });
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

    // Sender side
    let pttRecorder = null;
    let pttStream = null;
    let seq = 0;
    async function startPtt() {
      try {
        pttStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : 'audio/webm');
        pttRecorder = new MediaRecorder(pttStream, { mimeType: mime, audioBitsPerSecond: 32000 });
        seq = 0;
        pttRecorder.ondataavailable = async e => {
          if (!e.data || !e.data.size) return;
          // Encode to base64 and broadcast immediately
          const buf = await e.data.arrayBuffer();
          let binary = '';
          const bytes = new Uint8Array(buf);
          for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
          const b64 = btoa(binary);
          if (walkie) walkie.sendChunk({ data: b64, mime, seq: seq++ });
        };
        // Emit every 250ms for ~real-time feel
        pttRecorder.start(250);
        const myName = (await window.SB.getUser())?.user_metadata?.name || 'أنت';
        if (walkie) walkie.sendTalking(true, myName);
        pttBtn.style.background = 'var(--danger)';
        pttBtn.style.color = '#fff';
        pttBtn.style.transform = 'scale(1.3)';
      } catch (e) { toast('السماح بالميكروفون مطلوب'); }
    }
    async function stopPtt() {
      pttBtn.style.background = '';
      pttBtn.style.color = '';
      pttBtn.style.transform = '';
      if (!pttRecorder || pttRecorder.state === 'inactive') return;
      pttRecorder.stop();
      if (pttStream) pttStream.getTracks().forEach(t => t.stop());
      if (walkie) walkie.sendTalking(false);
    }
    pttBtn.addEventListener('mousedown', startPtt);
    pttBtn.addEventListener('mouseup', stopPtt);
    pttBtn.addEventListener('mouseleave', stopPtt);
    pttBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startPtt(); }, { passive: false });
    pttBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopPtt(); });
    pttBtn.addEventListener('touchcancel', stopPtt);

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
      appendMessage(tempMsg);
      inputField.value = '';
      msgs.scrollTop = msgs.scrollHeight;

      // Save to mockChat in memory so when returning to chat it stays
      if (mockChat && mockChat.messages) {
        mockChat.messages.push({ id: 'm' + Date.now(), from: 'me', text, time: 'الآن' });
        mockChat.last = text;
      }

      if (window.API && typeof id === 'string' && id.length >= 30) {
        try { await window.API.sendMessage({ chatId: id, text, type: tempMsg.type, file }); fileInput.value = ''; }
        catch (e) { toast('تعذر الإرسال'); }
      } else {
        // Mock Auto-Reply simulation for amazing interactivity
        setTimeout(() => {
          const replies = [
            'تمام يا غالي! اتفقنا 👍',
            'يعطيك العافية، فكرة رائعة جداً 🔥',
            'إن شاء الله، نلتقي قريب وننسق البث القادم 🚀',
            'تسلم من ذوقك يا كابتن ❤️',
            'أكيد، الحين أراجع المقطع وأرد عليك 🎬',
            'ألف شكر على رسالتك وتفاعلك الجميل 🌹'
          ];
          const replyText = replies[Math.floor(Math.random() * replies.length)];
          const replyMsg = {
            from_user_id: 'them',
            text: replyText,
            created_at: new Date().toISOString(),
            type: 'text'
          };
          appendMessage(replyMsg);
          msgs.scrollTop = msgs.scrollHeight;
          if (mockChat && mockChat.messages) {
            mockChat.messages.push({ id: 'm' + Date.now(), from: mockChat.user.id, text: replyText, time: 'الآن' });
            mockChat.last = replyText;
          }
        }, 1200);
      }
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

    const inputBar = el('div', { class: 'chat-input' }, [
      el('button', { class: 'icon-btn', html: icons.paperclip, onclick: () => fileInput.click(), title: 'إرفاق ملف' }),
      fileInput, videoInput,
      inputField,
      pttBtn,                                                                                  // push-to-talk
      el('button', { class: 'icon-btn', html: icons.video, onclick: () => videoInput.click(), title: 'إرسال مقطع فيديو' }),
      el('button', { class: 'icon-btn', html: icons.image, onclick: () => fileInput.click(), title: 'صورة' }),
      sendBtn,
    ]);
    root.appendChild(inputBar);

    // Stop subscription when leaving
    window.addEventListener('hashchange', () => { if (unsub) try { unsub(); } catch (e) {} }, { once: true });
    setTimeout(() => { msgs.scrollTop = msgs.scrollHeight; }, 0);
    return root;
  };

  // ===== Profile =====
  V.profile = () => {
    bottomNav('profile');
    const root = _renderProfile(DB.me, true);
    // Async: load real profile from Supabase, swap in
    (async () => {
      try {
        const user = await window.SB.getUser();
        if (!user) return;
        const p = await window.SB.getProfile(user.id);
        if (!p) return;
        const real = {
          id: 'me',
          name: p.name || 'أنت',
          handle: p.handle ? '@' + p.handle : '@me',
          avatar: p.avatar_url || DB.me.avatar,
          bio: p.bio || '',
          followers: p.followers_count || 0,
          following: p.following_count || 0,
          likes: p.likes_count || 0,
          verified: p.verified,
        };
        Object.assign(DB.me, real);
        // Re-render in place
        const fresh = _renderProfile(DB.me, true);
        // Load my real videos in the grid
        if (window.API) {
          const videos = await window.API.fetchUserVideos(user.id).catch(() => []);
          if (videos.length) {
            const grid = fresh.querySelector('.video-grid');
            if (grid) {
              grid.innerHTML = '';
              videos.forEach((v, i) => grid.appendChild(createVideoCard(v, i, () => go('/home'))));
            }
          }
        }
        root.replaceWith(fresh);
      } catch (e) { console.warn('profile load:', e); }
    })();
    return root;
  };
  V.userProfile = (params) => {
    hideNav();
    const placeholder = DB.users.find(x => x.id === params.id) || DB.users[0];
    const root = _renderProfile(placeholder, false);
    (async () => {
      try {
        if (!window.API) return;
        const p = await window.API.fetchProfile(params.id);
        if (!p) return;
        const u = { id: p.id, name: p.name, handle: '@' + (p.handle || ''), avatar: p.avatar_url || '', bio: p.bio || '',
                    followers: p.followers_count, following: p.following_count, likes: p.likes_count, verified: p.verified };
        const fresh = _renderProfile(u, false);
        // Async: load real videos + follow state
        const [videos, isFollowing] = await Promise.all([
          window.API.fetchUserVideos(p.id).catch(() => []),
          window.API.isFollowing(p.id).catch(() => false),
        ]);
        const followBtn = fresh.querySelector('.profile-actions button:first-child');
        if (followBtn) {
          followBtn.textContent = isFollowing ? 'تتم المتابعة' : 'متابعة';
          followBtn.onclick = async () => {
            const wasFollowing = followBtn.textContent === 'تتم المتابعة';
            followBtn.textContent = wasFollowing ? 'متابعة' : 'تتم المتابعة';
            try { wasFollowing ? await window.API.unfollow(p.id) : await window.API.follow(p.id); }
            catch (e) { followBtn.textContent = wasFollowing ? 'تتم المتابعة' : 'متابعة'; }
          };
        }
        const messageBtn = fresh.querySelectorAll('.profile-actions button')[1];
        if (messageBtn) messageBtn.onclick = async () => {
          try { const id = await window.API.openOrCreateDm(p.id); go('/chat/' + id); } catch (e) { toast('تعذر فتح المحادثة'); }
        };
        // Add "Request to track location" button (3rd action)
        const actionsRow = fresh.querySelector('.profile-actions');
        if (actionsRow && p.id) {
          const trackBtn = el('button', { class: 'btn btn-secondary', style: { marginTop: '8px', width: '100%' } });
          const showOnMapBtn = el('button', { class: 'btn', style: { marginTop: '6px', width: '100%', display: 'none' }, onclick: () => go('/map?user=' + p.id) }, '🗺️ تتبع على الخريطة الآن');
          let permitStatus = await window.API.fetchPermitStatus(p.id);
          function setLabel() {
            if (!permitStatus) trackBtn.textContent = '📍 طلب تتبع الموقع';
            else if (permitStatus.status === 'pending') trackBtn.textContent = '⏳ في انتظار الموافقة';
            else if (permitStatus.status === 'approved') trackBtn.textContent = '✅ يتم التتبع — اضغط للإلغاء';
            else if (permitStatus.status === 'denied') trackBtn.textContent = '❌ تم الرفض — أعد الطلب';
            else trackBtn.textContent = '📍 طلب تتبع الموقع';
            // Show map shortcut only when tracking is approved
            showOnMapBtn.style.display = (permitStatus && permitStatus.status === 'approved') ? 'block' : 'none';
          }
          setLabel();
          trackBtn.onclick = async () => {
            try {
              if (permitStatus && permitStatus.status === 'approved') {
                await window.API.revokeLocationPermit(p.id);
                toast('تم إلغاء التتبع');
              } else {
                await window.API.requestLocationPermit(p.id);
                toast('تم إرسال طلب التتبع — بانتظار الموافقة');
              }
              permitStatus = await window.API.fetchPermitStatus(p.id);
              setLabel();
            } catch (e) { toast(e.message || 'خطأ'); }
          };
          // wrap actionsRow + buttons in a flex column
          const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '320px', width: '100%', alignItems: 'center' } });
          actionsRow.parentNode.insertBefore(wrap, actionsRow);
          wrap.appendChild(actionsRow);
          wrap.appendChild(trackBtn);
          wrap.appendChild(showOnMapBtn);
        }
        const grid = fresh.querySelector('.video-grid');
        if (videos.length && grid) {
          grid.innerHTML = '';
          videos.forEach((v, i) => grid.appendChild(createVideoCard(v, i, () => go('/home'))));
        }
        root.replaceWith(fresh);
      } catch (e) { console.warn('userProfile load:', e); }
    })();
    return root;
  };
  function _renderProfile(u, isMe) {
    const root = el('section', { class: 'profile-screen' });
    root.appendChild(el('div', { class: 'profile-header' }, [
      isMe ? el('button', { class: 'icon-btn', html: icons.menu, onclick: () => go('/settings') }) : el('button', { class: 'icon-btn', html: icons.chevR, onclick: () => back() }),
      el('h1', {}, [u.handle, svg('chevD', { style: { width: '14px', height: '14px' } })]),
      el('button', { class: 'icon-btn', html: icons.moreV }),
    ]));
    root.appendChild(el('div', { class: 'profile-top' }, [
      el('div', { class: 'profile-avatar' }, [avatar(u.avatar, u.name, 96)]),
      el('p', { class: 'profile-name' }, u.name + (u.verified ? ' ✓' : '')),
      el('p', { class: 'profile-handle' }, u.handle),
      el('div', { class: 'profile-stats' }, [
        el('div', { class: 'profile-stat', onclick: () => go('/list/following') }, [el('div', { class: 'n' }, fmt(u.following || 0)), el('div', { class: 'l' }, 'متابَعين')]),
        el('div', { class: 'profile-stat', onclick: () => go('/list/followers') }, [el('div', { class: 'n' }, fmt(u.followers || 0)), el('div', { class: 'l' }, 'متابعون')]),
        el('div', { class: 'profile-stat', onclick: () => toast('إجمالي الإعجابات: ' + fmt(u.likes || 0)) }, [el('div', { class: 'n' }, fmt(u.likes || 0)), el('div', { class: 'l' }, 'إعجابات')]),
      ]),
      el('p', { class: 'profile-bio' }, u.bio),
      isMe
        ? el('div', { class: 'profile-actions' }, [
            el('button', { class: 'btn btn-secondary', onclick: () => go('/profile/edit') }, 'تعديل البروفايل'),
            el('button', { class: 'btn btn-secondary', onclick: () => go('/wallet') }, 'المحفظة'),
          ])
        : (() => {
            if (!window._followedUsers) window._followedUsers = {};
            const alreadyFollowed = !!window._followedUsers[u.id];
            const followBtn = el('button', {
              class: 'btn' + (alreadyFollowed ? ' btn-following' : ''),
            }, alreadyFollowed ? 'Following' : 'Follow');
            followBtn.addEventListener('click', () => {
              if (!window._followedUsers) window._followedUsers = {};
              const isNowFollowing = !window._followedUsers[u.id];
              window._followedUsers[u.id] = isNowFollowing;
              followBtn.textContent = isNowFollowing ? 'Following' : 'Follow';
              followBtn.classList.toggle('btn-following', isNowFollowing);
              if (window.API && u.id && u.id.length > 4) {
                try { isNowFollowing ? window.API.follow(u.id) : window.API.unfollow(u.id); } catch(_) {}
              }
            });
            return el('div', { class: 'profile-actions' }, [
              followBtn,
              el('button', { class: 'btn btn-secondary' }, 'مراسلة'),
            ]);
          })(),
    ]));
    const grid = el('div', { class: 'video-grid', style: { padding: '4px' } });

    function renderGrid(type) {
      grid.innerHTML = '';
      let list = [];
      if (type === 'videos') {
        list = isMe ? (DB.myVideos && DB.myVideos.length ? DB.myVideos : DB.videos.slice(0, 6)) : DB.videos.slice(0, 6);
      } else if (type === 'liked') {
        list = DB.videos.slice(2, 8);
      } else if (type === 'saved') {
        list = DB.videos.slice(4, 10);
      }
      list.forEach((v, i) => grid.appendChild(createVideoCard(v, i, () => go('/home'))));
    }

    const tabs = el('div', { class: 'profile-tabs' });
    const tabConfigs = [
      { id: 'videos', label: 'فيديوهات' },
      { id: 'liked', label: 'معجَب بها' },
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
    const root = el('section');
    root.appendChild(topBar({ title: 'تعديل البروفايل' }));
    const wrap = el('div', { style: { padding: '16px' } });
    const avImg = Object.assign(document.createElement('img'), { src: u.avatar, style: 'width:100%;height:100%;object-fit:cover' });
    const fileInput = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    let avatarFile = null;
    fileInput.addEventListener('change', (e) => {
      avatarFile = e.target.files[0];
      if (avatarFile) avImg.src = URL.createObjectURL(avatarFile);
    });
    wrap.appendChild(el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '10px 0 18px' } }, [
      el('div', { class: 'profile-avatar' }, [avImg]),
      el('button', { class: 'btn-ghost btn-sm', onclick: () => fileInput.click() }, 'تغيير الصورة'),
      fileInput,
    ]));
    const inputs = {};
    [
      { k: 'name', l: 'الاسم', v: u.name },
      { k: 'handle', l: 'اسم المستخدم', v: u.handle.replace('@', '') },
      { k: 'bio', l: 'النبذة', v: u.bio, type: 'textarea' },
    ].forEach(f => {
      const wrap2 = el('div', { class: 'input-wrap' });
      wrap2.appendChild(el('label', { class: 'input-label' }, f.l));
      const input = f.type === 'textarea' ? el('textarea', { class: 'input', value: f.v, rows: 3, style: { resize: 'none' } }) : el('input', { class: 'input', value: f.v });
      wrap2.appendChild(input);
      wrap.appendChild(wrap2);
      inputs[f.k] = input;
    });
    const errBox = el('div', { class: 'error-box', hidden: true });
    wrap.appendChild(errBox);
    const saveBtn = el('button', { class: 'btn btn-pill', style: { marginTop: '14px' }, onclick: async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'جاري الحفظ...';
      try {
        const user = await window.SB.getUser();
        if (!user) { go('/login'); return; }
        const fields = {
          name: inputs.name.value.trim().slice(0, 50),
          handle: inputs.handle.value.trim().replace(/^@/, '').slice(0, 30),
          bio: inputs.bio.value.trim().slice(0, 150),
        };
        if (avatarFile) {
          fields.avatar_url = await window.SB.uploadAvatar(user.id, avatarFile);
        }
        await window.SB.updateProfile(user.id, fields);
        toast('تم الحفظ');
        go('/profile');
      } catch (e) {
        errBox.textContent = (e.message && /duplicate|unique/i.test(e.message)) ? 'اسم المستخدم محجوز' : (e.message || 'تعذر الحفظ');
        errBox.hidden = false;
        saveBtn.disabled = false;
        saveBtn.textContent = 'حفظ التعديلات';
      }
    } }, 'حفظ التعديلات');
    wrap.appendChild(saveBtn);
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
        el('div', { class: 'avatar' }, [Object.assign(document.createElement('img'), { src: u.avatar_url || u.avatar || '' })]),
        el('div', { style: { flex: 1, minWidth: 0 }, onclick: () => go('/profile/' + u.id) }, [
          el('div', { class: 'name' }, u.name + (u.verified ? ' ✓' : '')),
          el('div', { class: 'handle' }, '@' + (u.handle || u.handle === '' ? u.handle : '').replace('@', '')),
        ]),
        el('button', { class: 'btn btn-secondary', onclick: async (e) => {
          const btn = e.currentTarget;
          if (!window.API) return;
          const isFollowing = btn.textContent === 'تتم المتابعة' || btn.textContent === 'متابَع';
          btn.textContent = isFollowing ? 'متابعة' : 'تتم المتابعة';
          try { isFollowing ? await window.API.unfollow(u.id) : await window.API.follow(u.id); }
          catch (e) { btn.textContent = isFollowing ? 'تتم المتابعة' : 'متابعة'; }
        } }, which === 'followers' ? 'متابعة' : 'تتم المتابعة'),
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
    const wrap = el('div'); root.appendChild(wrap);

    function ago(iso) { if (!iso) return ''; const t = Date.now() - new Date(iso).getTime(); const m = Math.floor(t / 60000); if (m < 1) return 'الآن'; if (m < 60) return 'منذ ' + m + ' د'; const h = Math.floor(m / 60); if (h < 24) return 'منذ ' + h + ' س'; const d = Math.floor(h / 24); return 'منذ ' + d + ' يوم'; }
    function textFor(n) {
      if (n.type === 'like') return 'أعجبه الفيديو الخاص بك';
      if (n.type === 'follow') return 'بدأ بمتابعتك';
      if (n.type === 'comment') return 'علّق: "' + ((n.payload && n.payload.text) || '') + '"';
      if (n.type === 'mention') return 'ذكرك في تعليق';
      if (n.type === 'message') return 'أرسل رسالة';
      if (n.type === 'system' && n.payload && n.payload.kind === 'location_request') return 'طلب تتبع موقعك';
      if (n.type === 'system' && n.payload && n.payload.kind === 'location_approved') return 'وافق على طلب تتبع موقعه';
      if (n.type === 'system' && n.payload && n.payload.kind === 'location_denied') return 'رفض طلب تتبع موقعه';
      return (n.payload && n.payload.text) || '';
    }
    function render(items) {
      wrap.innerHTML = '';
      if (!items.length) { wrap.appendChild(el('div', { class: 'empty-state', style: { padding: '40px', textAlign: 'center', color: 'var(--muted)' } }, 'لا توجد إشعارات بعد')); return; }
      items.forEach(n => {
        const av = (n.actor && n.actor.avatar_url)
          ? el('div', { class: 'avatar' }, [Object.assign(document.createElement('img'), { src: n.actor.avatar_url })])
          : el('div', { class: 'avatar', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--primary-soft)', color: 'var(--primary)' } }, [svg('bell')]);
        wrap.appendChild(el('div', { class: 'notif-row' }, [
          av,
          el('div', { class: 'notif-text' }, [
            el('b', {}, ((n.actor && n.actor.name) || 'النظام') + ' '),
            document.createTextNode(textFor(n) + ' '),
            el('span', { class: 'notif-time' }, '· ' + ago(n.created_at)),
          ]),
          n.type === 'follow' ? el('button', { class: 'btn btn-secondary btn-sm', style: { width: 'auto' }, onclick: async () => {
            if (!window.API || !n.actor) return;
            try { await window.API.follow(n.actor.id); toast('تتم المتابعة'); } catch (e) {}
          } }, 'متابعة') : null,
          // For location_request — show approve/deny buttons inline
          (n.type === 'system' && n.payload && n.payload.kind === 'location_request' && n.payload.permit_id) ?
            el('div', { style: { display: 'flex', gap: '4px', flexShrink: 0 } }, [
              el('button', { class: 'btn btn-sm', style: { width: 'auto', background: 'var(--success)' }, onclick: async (e) => {
                try { await window.API.respondToLocationPermit(n.payload.permit_id, 'approved'); toast('وافقت على المشاركة'); e.currentTarget.parentElement.remove(); } catch (err) { toast('خطأ'); }
              } }, '✓ موافقة'),
              el('button', { class: 'btn btn-sm', style: { width: 'auto', background: 'var(--bg-2)', color: 'var(--text)' }, onclick: async (e) => {
                try { await window.API.respondToLocationPermit(n.payload.permit_id, 'denied'); toast('تم الرفض'); e.currentTarget.parentElement.remove(); } catch (err) { toast('خطأ'); }
              } }, '✗ رفض'),
            ]) : null,
        ].filter(Boolean)));
      });
    }
    // Fallback to mock + load real
    render(DB.notifications.map(n => ({ id: n.id, type: n.type, actor: { id: '_', name: n.user.name, avatar_url: n.user.avatar }, payload: { text: n.text }, created_at: new Date().toISOString() })));
    (async () => { 
      try { 
        if (window.API) {
          const apiNotifs = await window.API.fetchNotifications();
          if (apiNotifs && apiNotifs.length > 0) render(apiNotifs);
        }
      } catch (e) {} 
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
        el('div', { class: 'comment-avatar' }, [Object.assign(document.createElement('img'), { src: (c.user && c.user.avatar_url) || (c.user && c.user.avatar) || '' })]),
        el('div', { class: 'comment-body' }, [
          el('div', { class: 'comment-name' }, (c.user && c.user.name) || ''),
          el('div', { class: 'comment-text' }, c.text),
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
    const search = el('div', { class: 'search' }, [
      el('button', { class: 'icon-btn search-clear', html: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' }),
      el('input', { class: 'search-input-share', value: 'احمد', placeholder: 'بحث' }),
      el('span', { class: 'search-icon', html: icons.search }),
    ]);
    root.appendChild(search);
    const contacts = el('section', { class: 'contacts' });
    const selected = new Set(['c-3']);
    function renderContacts() {
      const q = search.querySelector('input').value.trim();
      const list = DB.users.map((u, i) => ({ id: 'c-' + i, name: 'أحمد', avatar: u.avatar }))
        .concat(DB.users.map((u, i) => ({ id: 'c2-' + i, name: 'أحمد', avatar: u.avatar })));
      const filtered = q ? list.filter(c => c.name.includes(q)) : list;
      contacts.innerHTML = '';
      filtered.forEach(c => {
        const item = el('div', { class: 'contact' + (selected.has(c.id) ? ' selected' : ''), onclick: () => {
          if (selected.has(c.id)) selected.delete(c.id); else selected.add(c.id);
          renderContacts();
          updateSend();
        } }, [
          el('div', { class: 'avatar-share' }, [Object.assign(document.createElement('img'), { src: c.avatar, alt: c.name, loading: 'lazy' })]),
          el('span', { class: 'contact-name' }, c.name),
        ]);
        contacts.appendChild(item);
      });
    }
    search.querySelector('input').addEventListener('input', renderContacts);
    search.querySelector('.search-clear').onclick = () => { search.querySelector('input').value = ''; renderContacts(); };
    root.appendChild(contacts);
    root.appendChild(el('div', { class: 'divider' }));
    const socials = [
      { k: 'snapchat', l: 'Snapchat' }, { k: 'facebook', l: 'Facebook' }, { k: 'whatsapp', l: 'WhatsApp' },
      { k: 'copy', l: 'نسخ الرابط' }, { k: 'download', l: 'تحميل' },
    ];
    const socialRow = el('section', { class: 'social-row' });
    socials.forEach(s => socialRow.appendChild(el('button', { class: 'social-item', onclick: () => {
      if (s.k === 'copy') { navigator.clipboard?.writeText(location.href).catch(() => {}); toast('تم النسخ'); }
      else toast('مشاركة عبر ' + s.l);
    } }, [
      el('span', { class: 'social-icon ' + (['snapchat', 'facebook', 'whatsapp'].includes(s.k) ? s.k : 'neutral'), html: s.k === 'copy' ? icons.link : s.k === 'download' ? icons.download : icons[s.k] || icons.share }),
      el('span', { class: 'social-label' }, s.l),
    ])));
    root.appendChild(socialRow);
    const sendBtn = el('button', { class: 'send-btn', onclick: () => {
      if (!selected.size) return;
      sendBtn.textContent = 'تم الإرسال ✓'; sendBtn.disabled = true;
      setTimeout(() => back(), 800);
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

    const ov = el('div', { class: 'live-overlay' });
    ov.appendChild(el('div', { class: 'live-top', style: { justifyContent: 'space-between' } }, [
      el('button', { class: 'icon-btn', html: icons.x, style: { color: '#fff' }, onclick: () => go('/create') }),
      el('span'),
    ]));
    const titleInput = el('input', { class: 'input', placeholder: 'عنوان البث (اختياري)', style: { background: 'rgba(0,0,0,0.4)', color: '#fff', maxWidth: '320px', textAlign: 'center' } });

    // Mode selector — Camera vs Background-only
    const modeRow = el('div', { style: { display: 'flex', gap: '6px', justifyContent: 'center' } });
    function buildModeBtn(key, label) {
      const b = el('button', { class: 'btn btn-sm', style: { background: mode === key ? '#fff' : 'rgba(255,255,255,0.15)', color: mode === key ? '#000' : '#fff', borderRadius: '999px', padding: '6px 14px', fontSize: '12.5px' }, onclick: () => { mode = key; refreshUI(); } }, label);
      return b;
    }
    function refreshModeRow() {
      modeRow.innerHTML = '';
      modeRow.appendChild(buildModeBtn('camera', '📷 كاميرا'));
      modeRow.appendChild(buildModeBtn('background', '🖼️ خلفية فقط'));
    }
    refreshModeRow();

    // Background picker (only visible in 'background' mode)
    const bgPicker = el('div', { style: { display: 'flex', gap: '8px', overflowX: 'auto', padding: '8px 14px', maxWidth: '100%' } });
    BG_PRESETS.forEach(b => {
      const tile = el('div', { onclick: () => { selectedBg = b; refreshUI(); }, style: { width: '60px', height: '60px', borderRadius: '12px', backgroundImage: `url(${b.url})`, backgroundSize: 'cover', flexShrink: 0, border: selectedBg.id === b.id ? '3px solid #fff' : '3px solid transparent', cursor: 'pointer' } });
      bgPicker.appendChild(tile);
    });

    // Privacy chooser
    const privacyRow = el('div', { style: { display: 'flex', gap: '6px', justifyContent: 'center' } });
    function buildPrivacyBtn(key, label, icon) {
      return el('button', { class: 'btn btn-sm', style: { background: privacy === key ? '#fff' : 'rgba(255,255,255,0.15)', color: privacy === key ? '#000' : '#fff', borderRadius: '999px', padding: '6px 12px', fontSize: '12px' }, onclick: () => { privacy = key; refreshPrivacyRow(); } }, icon + ' ' + label);
    }
    function refreshPrivacyRow() {
      privacyRow.innerHTML = '';
      privacyRow.appendChild(buildPrivacyBtn('public', 'عام', '🌐'));
      privacyRow.appendChild(buildPrivacyBtn('friends', 'الأصدقاء', '👥'));
      privacyRow.appendChild(buildPrivacyBtn('private', 'خاص', '🔒'));
    }
    refreshPrivacyRow();

    // Help message
    const helpMsg = el('p', { style: { color: 'rgba(255,255,255,0.5)', textAlign: 'center', margin: 0, fontSize: '11.5px', maxWidth: '320px' } });
    function refreshHelp() {
      if (mode === 'background') {
        helpMsg.textContent = 'بث صوتي مع خلفية — لا يحتاج كاميرا';
      } else if (window.Agora && window.Agora.isConfigured()) {
        helpMsg.textContent = 'بث فيديو فعلي عبر الكاميرا والميكروفون';
      } else {
        helpMsg.innerHTML = '⚠️ Agora App ID غير مضبوط — البث بدون فيديو فعلي';
      }
    }

    function refreshUI() {
      // background preview if in background mode
      if (mode === 'background') {
        previewVideo.style.background = `#000 url(${selectedBg.url}) center/cover no-repeat`;
        bgPicker.style.display = 'flex';
      } else {
        previewVideo.style.background = '#000';
        bgPicker.style.display = 'none';
      }
      refreshModeRow();
      refreshHelp();
    }
    refreshUI();

    ov.appendChild(el('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '0 16px' } }, [
      el('h2', { style: { color: '#fff', margin: 0, textAlign: 'center' } }, 'ابدأ بثًا مباشرًا'),
      modeRow,
      bgPicker,
      titleInput,
      privacyRow,
      helpMsg,
    ]));
    const startBtn = el('button', { class: 'btn btn-pill', style: { background: '#ef4444' } }, 'بدء البث');
    let agoraSession = null;
    startBtn.onclick = async () => {
      startBtn.disabled = true; startBtn.textContent = 'جاري البدء...';
      try {
        if (!window.API) throw new Error('SDK not loaded');
        const live = await window.API.startLive({
          title: titleInput.value || null,
          thumbnail: mode === 'background' ? selectedBg.url : DB.videos[0].bg,
        });
        // Persist privacy + mode in payload (we'll hook this to RLS-based filtering in the live list)
        // For now stored in app state; full RLS filter is a 1-line policy update.
        window._ttLiveMeta = { id: live.id, mode, bg: selectedBg.url, privacy };
        if (mode === 'camera' && window.Agora && window.Agora.isConfigured()) {
          agoraSession = await window.Agora.startHost({
            channel: live.id,
            videoEl: previewVideo,
            onError: (e) => toast(e.message),
          });
          window._ttAgoraHostSession = agoraSession;
          window._ttAgoraHostLiveId = live.id;
        }
        go('/live/' + live.id);
      } catch (e) {
        toast(e.message || 'تعذر بدء البث');
        startBtn.disabled = false;
        startBtn.textContent = 'بدء البث';
        if (agoraSession) try { await agoraSession.stop(); } catch (_) {}
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
            el('span', { style: { background: 'linear-gradient(135deg, #ef4444, #ff0050)', color: '#fff', padding: '3px 8px', borderRadius: '999px', fontSize: '10.5px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '4px', boxShadow: '0 2px 8px rgba(239,68,68,0.5)' } }, [
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

    render(DB.lives);
    (async () => { try { if (window.API) { const real = await window.API.fetchLiveStreams(); if (real && real.length) render(real); } } catch (e) {} })();
    return root;
  };

  V.live = (params) => {
    hideNav();
    const liveId = params.id;
    let live = DB.lives.find(l => l.id === liveId) || DB.lives[0];
    const root = el('section', { class: 'live-viewer' });

    // Real Agora video container — covers full screen behind everything else
    const videoContainer = el('div', { id: 'agora-viewer-video', style: { position: 'absolute', inset: 0, background: '#000', zIndex: 0 } });
    root.appendChild(videoContainer);

    // Fallback background image (shown until Agora video subscribes)
    root.appendChild(el('div', { class: 'live-bg', style: { backgroundImage: `url(${live.bg})`, zIndex: 1 } }));
    const ov = el('div', { class: 'live-overlay' });
    ov.appendChild(el('div', { class: 'live-top' }, [
      el('div', { class: 'live-host-info' }, [
        el('div', { class: 'avatar' }, [Object.assign(document.createElement('img'), { src: live.host.avatar })]),
        el('div', {}, [
          el('div', { style: { fontSize: '12px', fontWeight: 700 } }, live.host.name),
          el('div', { style: { fontSize: '10px', opacity: 0.8 } }, '@' + live.host.handle.replace('@', '')),
        ]),
        el('button', { class: 'btn btn-sm', style: { width: 'auto', padding: '4px 10px', background: 'var(--danger)' } }, 'متابعة'),
      ]),
      el('span', { class: 'live-pill' }, 'مباشر'),
      el('span', { class: 'live-pill viewers' }, fmt(live.viewers) + ' 👁'),
      el('button', { class: 'icon-btn', html: icons.x, style: { color: '#fff' }, onclick: () => go('/home') }),
    ]));

    const cmts = el('div', { class: 'live-comments' });
    [
      { u: DB.users[0].name, t: 'جميل جدًا 🔥' },
      { u: DB.users[1].name, t: 'تابعتك من زمان' },
      { u: DB.users[2].name, t: '👏👏👏' },
      { u: DB.users[3].name, t: 'أرسلت لك هدية 🌹' },
      { u: DB.users[4].name, t: 'مرحبا الجميع' },
    ].forEach(c => cmts.appendChild(el('div', { class: 'live-cmt' }, [el('span', { class: 'u' }, c.u + ':'), document.createTextNode(' ' + c.t)])));
    ov.appendChild(cmts);

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

    function floatGift(emoji, name, fromName) {
      // Big animated banner that flies in from the bottom-end of the screen
      const banner = el('div', { style: {
        position: 'absolute', bottom: '100px', insetInlineEnd: '14px',
        background: 'linear-gradient(90deg, rgba(255,215,0,0.95), rgba(255,140,0,0.95))',
        color: '#000', padding: '8px 14px', borderRadius: '999px', fontSize: '13px', fontWeight: 700,
        boxShadow: '0 6px 20px rgba(0,0,0,0.4)', display: 'flex', gap: '8px', alignItems: 'center',
        transform: 'translateX(120%)', transition: 'transform 360ms ease-out, opacity 320ms ease-in',
        zIndex: 6,
      } }, [
        el('span', { style: { fontSize: '24px' } }, emoji),
        el('div', { style: { display: 'flex', flexDirection: 'column', gap: '0' } }, [
          el('div', {}, fromName || 'مستخدم'),
          el('div', { style: { fontSize: '11px', fontWeight: 500, opacity: 0.85 } }, 'أرسل ' + name),
        ]),
      ]);
      floatLayer.appendChild(banner);
      requestAnimationFrame(() => { banner.style.transform = 'translateX(0)'; });
      setTimeout(() => { banner.style.opacity = '0'; }, 3500);
      setTimeout(() => banner.remove(), 4000);

      // Big emoji flying up the center
      const big = el('div', { textContent: emoji, style: {
        position: 'absolute', bottom: '40%', insetInlineStart: '50%', transform: 'translateX(-50%) scale(0.3)',
        fontSize: '120px', opacity: '0', transition: 'all 1.6s cubic-bezier(0.34, 1.56, 0.64, 1)', zIndex: 5,
        filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.5))',
      } });
      floatLayer.appendChild(big);
      requestAnimationFrame(() => {
        big.style.opacity = '1'; big.style.transform = 'translateX(-50%) scale(1.2)';
      });
      setTimeout(() => { big.style.opacity = '0'; big.style.transform = 'translateX(-50%) scale(1.6) translateY(-100px)'; }, 1100);
      setTimeout(() => big.remove(), 1700);
    }

    ov.appendChild(el('div', { class: 'live-bottom' }, [
      el('input', { placeholder: 'أرسل تعليقًا...' }),
      el('button', { class: 'icon-btn', html: icons.gift, onclick: () => openGiftSheet() }),
      el('button', { class: 'icon-btn', html: icons.heart, onclick: () => {
        // Emit a few hearts (TikTok rapid-tap feel)
        for (let i = 0; i < 4; i++) setTimeout(floatHeart, i * 80, ['❤️', '💖', '💕', '💗', '✨'][Math.floor(Math.random() * 5)]);
      } }),
      el('button', { class: 'icon-btn', html: icons.share, onclick: () => go('/share/' + live.id) }),
    ]));
    root.appendChild(ov);

    async function openGiftSheet() {
      const sheet = el('div', { class: 'gift-sheet' });
      const close = () => { sheet.remove(); bd.remove(); };
      const bd = el('div', { class: 'backdrop', onclick: close });
      // Live balance
      let balance = DB.wallet.balance;
      try { if (window.API) { const w = await window.API.fetchWallet(); balance = w.balance || 0; } } catch (e) {}
      const balLabel = el('span', { class: 'b' }, '🪙 ' + balance);
      sheet.appendChild(el('div', { class: 'wallet-balance' }, [
        el('strong', {}, 'الهدايا'),
        balLabel,
      ]));
      // Live gifts catalog
      let catalog = DB.gifts;
      try { if (window.API) { const c = await window.API.fetchGiftCatalog(); if (c.length) catalog = c.map(g => ({ id: g.id, name: g.name, emoji: g.emoji, price: g.price })); } } catch (e) {}
      const grid = el('div', { class: 'gift-grid' });
      catalog.forEach(g => grid.appendChild(el('button', { class: 'gift-card', onclick: async () => {
        if (balance < g.price) { toast('رصيد غير كافٍ — اشحن المحفظة'); return; }
        try {
          if (window.API && live.host && live.host.id) {
            await window.API.sendGift({ toUserId: live.host.id, giftId: g.id, liveStreamId: typeof live.id === 'string' && live.id.length > 30 ? live.id : null });
          }
          balance -= g.price; balLabel.textContent = '🪙 ' + balance;
          // Big TikTok-style gift animation
          const me = (window.SB && (await window.SB.getUser())) || null;
          floatGift(g.emoji, g.name, (me && me.user_metadata && me.user_metadata.name) || 'أنت');
          close();
        } catch (e) { toast(e.message || 'تعذر إرسال الهدية'); }
      } }, [
        el('div', { class: 'emoji' }, g.emoji),
        el('div', { style: { fontSize: '11px' } }, g.name),
        el('div', { class: 'price' }, '🪙 ' + g.price),
      ])));
      sheet.appendChild(grid);
      document.body.appendChild(bd);
      document.body.appendChild(sheet);
    }

    // ─── Agora viewer subscription ───
    let viewerSession = null;
    let hostSession = window._ttAgoraHostSession;
    let isHost = window._ttAgoraHostLiveId === liveId;

    (async () => {
      try {
        if (!window.Agora || !window.Agora.isConfigured()) return;
        if (isHost) {
          // We're the host — preview already running, just keep it alive
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

    // Stop on navigate away
    window.addEventListener('hashchange', async () => {
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
      el('button', { class: 'icon-btn', style: { background: '#fff' }, html: icons.chevR, onclick: () => back() }),
      ghostBtn,
      el('button', { class: 'icon-btn', style: { background: '#fff' }, html: icons.settings, onclick: () => go('/settings') }),
    ]));

    // ── Snap-style bottom sheet listing all friends on the map ──
    const sheetExpanded = { val: false };
    const sheetHandle = el('div', { style: { width: '44px', height: '5px', borderRadius: '999px', background: '#d1d5db', margin: '8px auto 6px' } });
    const sheetTitle = el('div', { style: { textAlign: 'center', fontSize: '14px', fontWeight: 700 } }, 'لا يوجد أصدقاء قريبين');
    const sheetSub = el('div', { class: 'muted', style: { textAlign: 'center', fontSize: '11.5px', marginBottom: '8px' } }, 'اسحب للأعلى لعرض القائمة');
    const sheetList = el('div', { style: { display: 'none', maxHeight: '40vh', overflowY: 'auto', paddingBottom: '12px' } });
    const sheet = el('div', { style: {
      position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 1000,
      background: '#fff', borderTopLeftRadius: '20px', borderTopRightRadius: '20px',
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
        avatarChild = el('div', { style: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#6c2bd9', color: '#fff', fontWeight: '700', fontSize: '22px' } }, initial);
      }

      return el('div', { style: { minWidth: '200px', textAlign: 'center', fontFamily: 'Cairo, sans-serif' }, dir: 'rtl' }, [
        el('div', { style: { width: '64px', height: '64px', borderRadius: '50%', overflow: 'hidden', margin: '0 auto 8px', border: '3px solid #6c2bd9' } }, [avatarChild]),
        el('div', { style: { fontWeight: '700', fontSize: '14px' } }, profile.name || ''),
        el('div', { style: { color: '#888', fontSize: '11.5px', marginBottom: '8px' } }, ago(l.updated_at)),
        el('div', { style: { display: 'flex', gap: '6px', justifyContent: 'center' } }, [
          el('a', { href: safeId ? '#/chat-new/dm?to=' + safeId : '#', style: { flex: '1', background: '#6c2bd9', color: '#fff', padding: '6px 8px', borderRadius: '6px', textDecoration: 'none', fontSize: '12px' } }, '💬 رسالة'),
          el('a', { href: safeId ? '#/profile/' + safeId : '#', style: { flex: '1', background: '#f3f4f6', color: '#111', padding: '6px 8px', borderRadius: '6px', textDecoration: 'none', fontSize: '12px' } }, '👤 البروفايل'),
        ]),
      ]);
    }

    async function initMap() {
      if (!ensureLeaflet()) { setTimeout(initMap, 200); return; }
      // Default center: Riyadh
      map = window.L.map(mapEl, { zoomControl: false, attributionControl: true }).setView([24.7136, 46.6753], 11);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(map);
      window.L.control.zoom({ position: 'bottomleft' }).addTo(map);

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
            icon: makeAvatarIcon(myProfile || { avatar_url: '', name: 'أنت' }, '#6c2bd9', true),
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

        const chatBtn = el('button', { class: 'btn-sm', style: { background: '#6c2bd9', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: '6px', fontSize: '12px' } }, '💬');
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

        // Fallback to rich mock friends if no real data
        if (friends.length === 0 && tracked.length === 0 && DB && DB.users) {
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
            }, idx % 2 === 0 ? '#6c2bd9' : '#4ade80');
          });
        } else {
          // Tracked-via-permit get purple border, friends get green
          tracked.forEach(l => placePin(l, '#6c2bd9'));
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
    (async () => {
      await initMap();
      if (window.API) unsub = window.API.subscribeToFriendLocations(() => refresh());
    })();

    // Re-render the sheet every 30s so timestamps ("now", "منذ N د") stay fresh
    const tickerId = setInterval(() => { if (map) refresh(); }, 30000);
    window.addEventListener('hashchange', () => { clearInterval(tickerId); }, { once: true });

    window.addEventListener('hashchange', () => {
      if (map) try { map.remove(); } catch (e) {}
      if (unsub) try { unsub(); } catch (e) {}
    }, { once: true });

    return root;
  };

  // ===== Wallet =====
  V.wallet = () => {
    hideNav();
    const root = el('section', { class: 'wallet-screen' });
    root.appendChild(topBar({ title: 'المحفظة' }));
    const balanceEl = el('div', { class: 'amount' }, ['🪙 ', String(DB.wallet.balance)]);
    root.appendChild(el('div', { class: 'wallet-card' }, [
      el('div', { class: 'label' }, 'الرصيد المتاح'),
      balanceEl,
      el('div', { class: 'wallet-actions' }, [
        el('button', { class: 'btn btn-pill', onclick: () => openTopupSheet() }, 'شحن'),
        el('button', { class: 'btn btn-pill', onclick: () => openWithdrawSheet() }, 'سحب'),
      ]),
    ]));

    // ── Top-up sheet: pick a package or enter custom amount ──
    function openTopupSheet() {
      const sheet = el('div', { class: 'sheet', style: { padding: '20px', maxWidth: '420px', margin: '0 auto' } });
      sheet.appendChild(el('h3', { style: { margin: '0 0 12px', textAlign: 'center' } }, 'شحن المحفظة'));
      const packages = [
        { coins: 100,  price: '4.99 ر.س' },
        { coins: 500,  price: '19.99 ر.س' },
        { coins: 1000, price: '39.99 ر.س', popular: true },
        { coins: 5000, price: '149.99 ر.س' },
      ];
      const grid = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' } });
      packages.forEach(p => {
        const card = el('button', { class: 'btn btn-secondary', style: { padding: '14px', display: 'flex', flexDirection: 'column', gap: '4px', position: 'relative', border: p.popular ? '2px solid var(--primary)' : '' } }, [
          p.popular ? el('div', { style: { position: 'absolute', top: '-8px', insetInlineEnd: '8px', background: 'var(--primary)', color: '#fff', fontSize: '10px', padding: '2px 8px', borderRadius: '999px' } }, 'الأكثر شعبية') : null,
          el('div', { style: { fontSize: '18px', fontWeight: 800 } }, '🪙 ' + fmt(p.coins)),
          el('div', { class: 'muted', style: { fontSize: '12px' } }, p.price),
        ].filter(Boolean));
        card.onclick = () => doTopup(p.coins, p.coins + ' عملة');
        grid.appendChild(card);
      });
      sheet.appendChild(grid);
      const customAmt = el('input', { class: 'input', type: 'number', placeholder: 'أو أدخل عددًا مخصصًا', min: 1, max: 100000 });
      const customBtn = el('button', { class: 'btn btn-pill', style: { width: '100%' }, onclick: () => {
        const n = parseInt(customAmt.value, 10);
        if (!n || n <= 0) return toast('أدخل عددًا صحيحًا');
        doTopup(n, 'مخصص');
      } }, 'شحن مبلغ مخصص');
      sheet.appendChild(el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, [customAmt, customBtn]));
      sheet.appendChild(el('div', { class: 'muted', style: { fontSize: '11.5px', marginTop: '12px', textAlign: 'center' } }, 'الدفع الفعلي عبر Stripe / Apple Pay سيتم تفعيله قبل الإطلاق الرسمي'));
      const close = modal(sheet);
      sheet.appendChild(el('button', { class: 'btn-ghost', style: { width: '100%', marginTop: '8px' }, onclick: close }, 'إلغاء'));

      async function doTopup(coins, label) {
        customBtn.disabled = true;
        try {
          const newBal = await window.API.selfTopup(coins, label);
          balanceEl.textContent = '🪙 ' + (newBal || 0);
          toast('تم شحن ' + coins + ' عملة');
          close();
          // Reload transactions
          const tx = await window.API.fetchWalletTx('all');
          DB.wallet.transactions = tx.map(t => ({ id: t.id, type: t.type, title: t.description || t.type, sub: '', amount: t.amount, time: new Date(t.created_at).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' }) }));
          rebuild();
        } catch (e) { toast(e.message || 'فشل الشحن'); customBtn.disabled = false; }
      }
    }

    // ── Withdraw sheet: amount + method ──
    function openWithdrawSheet() {
      const sheet = el('div', { class: 'sheet', style: { padding: '20px', maxWidth: '420px', margin: '0 auto' } });
      sheet.appendChild(el('h3', { style: { margin: '0 0 4px', textAlign: 'center' } }, 'سحب الأرباح'));
      sheet.appendChild(el('div', { class: 'muted', style: { fontSize: '12px', textAlign: 'center', marginBottom: '14px' } }, 'الحد الأدنى: 100 عملة'));
      const amt = el('input', { class: 'input', type: 'number', placeholder: 'العدد', min: 100, max: 100000 });
      const methodSel = el('select', { class: 'input' }, [
        el('option', { value: 'bank' }, 'تحويل بنكي'),
        el('option', { value: 'paypal' }, 'PayPal'),
        el('option', { value: 'stc_pay' }, 'STC Pay'),
      ]);
      const submit = el('button', { class: 'btn btn-pill', style: { width: '100%' } }, 'تأكيد السحب');
      const close = modal(sheet);
      sheet.appendChild(el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, [
        el('label', { class: 'muted', style: { fontSize: '12px' } }, 'العدد'), amt,
        el('label', { class: 'muted', style: { fontSize: '12px' } }, 'طريقة الاستلام'), methodSel,
        submit,
        el('button', { class: 'btn-ghost', style: { width: '100%' }, onclick: close }, 'إلغاء'),
      ]));
      submit.onclick = async () => {
        const n = parseInt(amt.value, 10);
        if (!n || n < 100) return toast('الحد الأدنى للسحب 100 عملة');
        submit.disabled = true; submit.textContent = 'جاري التحويل...';
        try {
          const newBal = await window.API.selfWithdraw(n, methodSel.value);
          balanceEl.textContent = '🪙 ' + (newBal || 0);
          toast('تم تسجيل طلب السحب — سيصلك المبلغ خلال 3-5 أيام عمل');
          close();
          const tx = await window.API.fetchWalletTx('all');
          DB.wallet.transactions = tx.map(t => ({ id: t.id, type: t.type, title: t.description || t.type, sub: '', amount: t.amount, time: new Date(t.created_at).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' }) }));
          rebuild();
        } catch (e) { toast(e.message || 'فشل السحب'); submit.disabled = false; submit.textContent = 'تأكيد السحب'; }
      };
    }
    let active = 'all';
    const tabs = el('div', { class: 'wallet-tabs' });
    [['all', 'الكل'], ['in', 'إيرادات'], ['out', 'صادر']].forEach(([k, l]) => tabs.appendChild(el('button', { class: 'wallet-tab' + (k === active ? ' active' : ''), onclick: e => { active = k; tabs.querySelectorAll('.wallet-tab').forEach(x => x.classList.remove('active')); e.currentTarget.classList.add('active'); rebuild(); } }, l)));
    root.appendChild(tabs);
    const list = el('div', { class: 'tx-list' });

    function rebuild() {
      list.innerHTML = '';
      const items = DB.wallet.transactions.filter(t => active === 'all' || t.type === active);
      if (!items.length) { list.appendChild(el('div', { class: 'empty-state', style: { padding: '40px', textAlign: 'center', color: 'var(--muted)' } }, 'لا توجد عمليات')); return; }
      items.forEach(t => list.appendChild(el('div', { class: 'tx-row' }, [
        el('div', { class: 'tx-icon ' + (['in', 'gift_received', 'topup'].includes(t.type) ? 'in' : 'out'), html: ['in', 'gift_received', 'topup'].includes(t.type) ? icons.download : icons.upload }),
        el('div', { class: 'tx-body' }, [el('div', { class: 'tx-title' }, t.title || t.description), el('div', { class: 'tx-sub' }, (t.sub || '') + ' · ' + (t.time || ''))]),
        el('div', { class: 'tx-amt ' + (['in', 'gift_received', 'topup'].includes(t.type) ? 'in' : 'out') }, (['in', 'gift_received', 'topup'].includes(t.type) ? '+' : '-') + t.amount + ' 🪙'),
      ])));
    }
    rebuild();
    root.appendChild(list);

    // Async: real wallet
    (async () => {
      try {
        if (!window.API) return;
        const w = await window.API.fetchWallet();
        balanceEl.textContent = '🪙 ' + (w.balance || 0);
        const tx = await window.API.fetchWalletTx('all');
        DB.wallet.transactions = tx.map(t => ({
          id: t.id,
          type: t.type, // topup | gift_sent | gift_received | withdrawal
          title: t.description || t.type,
          sub: '',
          amount: t.amount,
          time: new Date(t.created_at).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' }),
        }));
        rebuild();
      } catch (e) { console.warn('wallet:', e); }
    })();
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
        rows.forEach(r => {
          const p = r.profiles || { id: r.blocked_id };
          const row = el('div', { class: 'inbox-item', style: { padding: '12px 14px', borderBottom: '1px solid var(--border)' } });

          // Avatar: safe DOM-built <img> with URL whitelist
          const avImg = document.createElement('img');
          const safeAv = safeUrl(p.avatar_url);
          if (safeAv) avImg.src = safeAv;
          avImg.onerror = () => { avImg.style.background = '#eee'; avImg.removeAttribute('src'); };
          row.appendChild(el('div', { class: 'inbox-avatar', style: { width: '44px', height: '44px' } }, [avImg]));

          row.appendChild(el('div', { style: { flex: '1', minWidth: '0' } }, [
            el('div', { style: { fontWeight: '600' } }, p.name || ''),
            el('div', { class: 'muted', style: { fontSize: '12px' } }, '@' + (p.handle || '')),
          ]));

          const unblockBtn = el('button', { class: 'btn btn-secondary', style: { padding: '6px 14px' } }, 'إلغاء الحظر');
          unblockBtn.onclick = async () => {
            if (!confirm('إلغاء حظر ' + (p.name || 'هذا المستخدم') + '؟')) return;
            unblockBtn.disabled = true;
            try { await window.API.unblockUser(p.id); toast('تم إلغاء الحظر'); load(); }
            catch (e) { toast(e.message || 'فشل'); unblockBtn.disabled = false; }
          };
          row.appendChild(unblockBtn);
          list.appendChild(row);
        });
      } catch (e) { list.innerHTML = '<div class="muted" style="padding:30px;text-align:center;color:var(--danger)">' + e.message + '</div>'; }
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
      items.forEach(it => s.appendChild(el('div', { class: 'settings-item', onclick: it.onclick || (() => toast('قريبًا')) }, [
        el('span', { class: 'si-icon', html: icons[it.icon] || icons.settings }),
        el('span', { class: 'si-text' }, it.label),
        it.right || el('span', { class: 'chev', html: icons.chevL }),
      ])));
      root.appendChild(s);
    }
    function makeToggle(initialOn, onChange) {
      const t = el('div', { class: 'toggle' + (initialOn ? ' on' : ''), onclick: async e => {
        e.stopPropagation();
        t.classList.toggle('on');
        const on = t.classList.contains('on');
        try { await onChange(on); }
        catch (err) { t.classList.toggle('on'); toast(err.message || 'تعذر التحديث'); }
      } });
      return t;
    }

    // ── Account ──
    section('الحساب', [
      { icon: 'user', label: 'تعديل البروفايل', onclick: () => go('/profile/edit') },
      { icon: 'lock', label: 'تغيير كلمة المرور', onclick: async () => {
        const np = prompt('كلمة المرور الجديدة (8 أحرف على الأقل):');
        if (!np) return;
        if (np.length < 8) return toast('كلمة المرور قصيرة جدًا');
        try { await window.SB.updatePassword(np); toast('تم التحديث'); }
        catch (e) { toast(e.message); }
      } },
      { icon: 'mail', label: 'تغيير البريد الإلكتروني', onclick: async () => {
        const e = prompt('البريد الإلكتروني الجديد:');
        if (!e) return;
        try { const c = await window.SB.client(); await c.auth.updateUser({ email: e.trim() }); toast('تحقق من بريدك الجديد للتأكيد'); }
        catch (err) { toast(err.message); }
      } },
      { icon: 'wallet', label: 'المحفظة', onclick: () => go('/wallet') },
    ]);

    // ── Privacy ──
    const privateToggle = makeToggle(false, async (on) => {
      if (!window.API) throw new Error('غير متصل');
      await window.API.setPrivate(on);
      toast(on ? 'حسابك أصبح خاصًا' : 'حسابك أصبح عامًا');
    });
    // Reflect current state from DB
    (async () => {
      try {
        if (!window.API) return;
        const s = await window.API.fetchMySettings();
        if (s.is_private) privateToggle.classList.add('on');
      } catch (e) {}
    })();
    section('الخصوصية والأمان', [
      { icon: 'eye', label: 'الحساب خاص', right: privateToggle },
      { icon: 'user', label: 'من يمكنه مراسلتي', right: el('span', { class: 'muted' }, 'الجميع') },
      { icon: 'comment', label: 'من يمكنه التعليق', right: el('span', { class: 'muted' }, 'الجميع') },
      { icon: 'lock', label: 'المستخدمون المحظورون', onclick: () => go('/blocked') },
      { icon: 'flag', label: 'مراجعة طلبات تتبع موقعي', onclick: async () => {
        try {
          const incoming = await window.API.fetchIncomingPermits();
          if (!incoming.length) return toast('لا توجد طلبات جديدة');
          toast(incoming.length + ' طلب — راجعها من شاشة الإشعارات');
        } catch (e) { toast(e.message); }
      } },
    ]);

    // ── Notifications ──
    section('الإشعارات', [
      { icon: 'heart', label: 'الإعجابات', right: makeToggle(true, async () => {}) },
      { icon: 'comment', label: 'التعليقات', right: makeToggle(true, async () => {}) },
      { icon: 'user', label: 'المتابعون الجدد', right: makeToggle(true, async () => {}) },
      { icon: 'mail', label: 'الرسائل', right: makeToggle(true, async () => {}) },
      { icon: 'video', label: 'البثوث المباشرة', right: makeToggle(true, async () => {}) },
      { icon: 'gift', label: 'الهدايا', right: makeToggle(true, async () => {}) },
    ]);

    // ── Content & Display ──
    section('المحتوى والعرض', [
      { icon: 'globe', label: 'اللغة', right: langSwitch() },
      { icon: 'sparkle', label: 'الوضع الداكن', right: makeToggle(localStorage.getItem('tt-theme') === 'dark', async (on) => {
        document.body.classList.toggle('dark', on);
        localStorage.setItem('tt-theme', on ? 'dark' : 'light');
      }) },
      { icon: 'video', label: 'تشغيل تلقائي للفيديو', right: makeToggle(true, async () => {}) },
      { icon: 'eye', label: 'حفظ بيانات الإنترنت', right: makeToggle(false, async () => {}) },
    ]);

    // ── Location ──
    section('الموقع الجغرافي', [
      { icon: 'map', label: 'خريطة الأصدقاء', onclick: () => go('/map') },
      { icon: 'map', label: 'مشاركة موقعي مع', right: el('span', { class: 'muted' }, 'الأصدقاء') },
      { icon: 'map', label: 'تفعيل مشاركة الموقع', right: makeToggle(false, async (on) => {
        if (!window.API) return;
        await window.API.setLocationVisibility(on ? 'friends' : 'none');
        toast(on ? 'تمت مشاركة موقعك' : 'تم إيقاف المشاركة');
      }) },
    ]);

    // ── Support & Legal ──
    section('الدعم والقانوني', [
      { icon: 'flag', label: 'الإبلاغ عن مشكلة' },
      { icon: 'mail', label: 'تواصل معنا', onclick: () => window.location.href = 'mailto:support@tenthtone.app' },
      { icon: 'globe', label: 'الشروط وسياسة الخصوصية', onclick: () => window.open('https://github.com/meeranpmo-svg/Tiktok/blob/main/PRIVACY.md', '_blank') },
      { icon: 'sparkle', label: 'حول التطبيق', right: el('span', { class: 'muted' }, 'الإصدار 1.0.0') },
    ]);

    // ── Danger ──
    section('منطقة الخطر', [
      { icon: 'x', label: 'حذف الحساب نهائيًا', onclick: async () => {
        if (!confirm('هل أنت متأكد من حذف حسابك؟\n\nسيتم حذف جميع الفيديوهات والمحفظة والمحادثات. لا يمكن التراجع عن هذا الإجراء.')) return;
        const word = prompt('للتأكيد، اكتب: حذف');
        if ((word || '').trim() !== 'حذف') return toast('تم الإلغاء');
        try {
          await window.API.selfDeleteAccount();
          toast('تم حذف حسابك');
          location.hash = '#/login';
        } catch (e) { toast(e.message || 'فشل الحذف'); }
      } },
    ]);

    // Admin section — only renders if the signed-in user has is_admin = true
    (async () => {
      try {
        if (!window.API) return;
        const isAdmin = await window.API.adminCheckIsAdmin();
        if (!isAdmin) return;
        const adminSec = el('div', { class: 'settings-section', style: { background: 'var(--primary-soft)' } });
        adminSec.appendChild(el('h3', { style: { color: 'var(--primary)' } }, 'الإدارة'));
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
    logout.appendChild(el('div', { class: 'settings-item', onclick: async () => { try { await window.SB.signOut(); } catch (e) {} go('/login'); toast('تم تسجيل الخروج'); } }, [
      el('span', { class: 'si-text', style: { color: 'var(--danger)', textAlign: 'center', fontWeight: 700 } }, 'تسجيل الخروج'),
    ]));
    root.appendChild(logout);
    return root;
  };

  // Map view ID alias
  V.locationMap = V.map;
})();
