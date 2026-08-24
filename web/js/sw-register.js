/* === Service worker registration & cache reset === */
(function () {
  if (!('serviceWorker' in navigator)) return;

  // Unregister existing service worker in dev so changes always reflect immediately
  navigator.serviceWorker.getRegistrations().then(regs => {
    for (let reg of regs) { reg.update(); }
  });

  // Optional Android install prompt - show a small toast (Chrome only)
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallToast();
  });

  function showInstallToast() {
    if (sessionStorage.getItem('tt-install-dismissed')) return;
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg, #6c2bd9 0%, #a855f7 100%);color:#fff;padding:16px 20px;border-radius:12px;font-family:Cairo,system-ui,sans-serif;font-size:15px;z-index:9999;display:flex;gap:12px;align-items:center;box-shadow:0 12px 30px rgba(108,43,217,0.6);width:90%;border:2px solid rgba(255,255,255,0.2)';
    t.innerHTML = '<span style="flex-grow:1;font-weight:600;">قم بتثبيت التطبيق الآن! 🚀</span><button style="background:#fff;color:#6c2bd9;border:0;padding:8px 16px;border-radius:8px;font-weight:800;font-family:inherit;font-size:14px;cursor:pointer" id="tt-install">تثبيت</button><button style="background:transparent;color:#fff;border:0;font-size:24px;line-height:1;font-weight:bold;cursor:pointer;margin-right:8px" id="tt-dismiss">×</button>';
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

  // iOS install hint - once per session, only when not already standalone
  window.addEventListener('load', () => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (!isIOS || isStandalone) return;
    if (sessionStorage.getItem('tt-ios-hint-shown')) return;
    sessionStorage.setItem('tt-ios-hint-shown', '1');
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#1a1a1a;color:#fff;padding:16px 20px;border-radius:12px;font-family:Cairo,system-ui,sans-serif;font-size:14px;z-index:9999;display:flex;gap:12px;align-items:center;box-shadow:0 12px 30px rgba(0,0,0,0.6);width:90%;line-height:1.5;border:2px solid #6c2bd9';
    t.innerHTML = '<span>لتثبيت التطبيق: اضغط <b>مشاركة</b> ⍗ ثم <b>إضافة إلى الشاشة الرئيسية</b> ⊞</span><button style="background:transparent;color:#fff;border:0;font-size:24px;font-weight:bold;cursor:pointer" id="tt-dismiss-ios">×</button>';
    document.body.appendChild(t);
    t.querySelector('#tt-dismiss-ios').onclick = () => t.remove();
  });
})();
