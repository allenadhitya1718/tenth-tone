/* === Service worker registration & cache reset === */
(function () {
  if (!('serviceWorker' in navigator)) return;

  // Unregister existing service worker in dev so changes always reflect immediately
  navigator.serviceWorker.getRegistrations().then(regs => {
    for (let reg of regs) { reg.update(); }
  });
})();

  // Optional Android install prompt — show a small toast (Chrome only)
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallToast();
  });

  function showInstallToast() {
    if (sessionStorage.getItem('tt-install-dismissed')) return;
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#6c2bd9;color:#fff;padding:10px 14px;border-radius:12px;font-family:Cairo,system-ui,sans-serif;font-size:13.5px;z-index:9999;display:flex;gap:10px;align-items:center;box-shadow:0 12px 30px rgba(108,43,217,0.4);max-width:90%';
    t.innerHTML = '<span>ثبّت Tenth Tone على شاشتك الرئيسية</span><button style="background:#fff;color:#6c2bd9;border:0;padding:6px 12px;border-radius:8px;font-weight:700;font-family:inherit" id="tt-install">تثبيت</button><button style="background:transparent;color:#fff;border:0;font-size:18px;line-height:1" id="tt-dismiss">×</button>';
    document.body.appendChild(t);
    t.querySelector('#tt-install').onclick = async () => {
      if (!deferredPrompt) return t.remove();
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      t.remove();
    };
    t.querySelector('#tt-dismiss').onclick = () => {
      sessionStorage.setItem('tt-install-dismissed', '1');
      t.remove();
    };
  }

  // iOS install hint — once per session, only when not already standalone
  window.addEventListener('load', () => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (!isIOS || isStandalone) return;
    if (sessionStorage.getItem('tt-ios-hint-shown')) return;
    sessionStorage.setItem('tt-ios-hint-shown', '1');
    setTimeout(() => {
      const t = document.createElement('div');
      t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1a1a1a;color:#fff;padding:12px 16px;border-radius:12px;font-family:Cairo,system-ui,sans-serif;font-size:13px;z-index:9999;display:flex;gap:10px;align-items:center;box-shadow:0 12px 30px rgba(0,0,0,0.4);max-width:92%;line-height:1.5';
      t.innerHTML = '<span>ثبّت التطبيق: اضغط <b>المشاركة</b> ⎙ ثم <b>إضافة إلى الشاشة الرئيسية</b></span><button style="background:transparent;color:#fff;border:0;font-size:20px" id="tt-dismiss-ios">×</button>';
      document.body.appendChild(t);
      t.querySelector('#tt-dismiss-ios').onclick = () => t.remove();
      setTimeout(() => t.remove(), 8000);
    }, 1500);
  });
})();
