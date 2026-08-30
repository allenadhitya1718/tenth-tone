/* === Service worker registration & cache reset === */
(function () {
  if (!('serviceWorker' in navigator)) return;

  // Unregister existing service worker in dev so changes always reflect immediately
  navigator.serviceWorker.getRegistrations().then(regs => {
    for (let reg of regs) { reg.update(); }
  });

  // Native Android/Chrome install prompt - trigger on first click (max 2 times total)
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    
    let askCount = parseInt(localStorage.getItem('tt-install-asked') || '0', 10);
    if (askCount >= 2) return;

    const triggerNativePrompt = async () => {
      if (deferredPrompt) {
        try {
          deferredPrompt.prompt();
          await deferredPrompt.userChoice;
        } catch(err) {}
        deferredPrompt = null;
        localStorage.setItem('tt-install-asked', (askCount + 1).toString());
        document.removeEventListener('click', triggerNativePrompt, true);
        document.removeEventListener('touchstart', triggerNativePrompt, true);
      }
    };
    document.addEventListener('click', triggerNativePrompt, true);
    document.addEventListener('touchstart', triggerNativePrompt, true);
  });

  // iOS install hint - styled as a small center box (max 2 times total)
  window.addEventListener('load', () => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (!isIOS || isStandalone) return;
    
    let askCount = parseInt(localStorage.getItem('tt-ios-hint-asked') || '0', 10);
    if (askCount >= 2) return;
    
    if (sessionStorage.getItem('tt-ios-hint-shown-this-session')) return;
    sessionStorage.setItem('tt-ios-hint-shown-this-session', '1');
    localStorage.setItem('tt-ios-hint-asked', (askCount + 1).toString());

    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%, -50%);background:#2c2c2c;color:#fff;padding:20px;border-radius:12px;font-family:system-ui,sans-serif;font-size:15px;z-index:9999;display:flex;flex-direction:column;gap:15px;box-shadow:0 10px 40px rgba(0,0,0,0.5);width:300px;text-align:center';
    t.innerHTML = '<div style="font-size:18px;font-weight:bold;margin-bottom:5px">تثبيت التطبيق</div><div style="color:#aaa;line-height:1.4">لتثبيت التطبيق، اضغط على زر <b>المشاركة</b> في الأسفل ثم اختر<br><b>إضافة إلى الشاشة الرئيسية</b></div><button style="background:#1e56d6;color:#fff;border:0;padding:10px;border-radius:8px;font-weight:bold;font-size:15px;cursor:pointer;margin-top:5px" id="tt-dismiss-ios">حسناً</button>';
    document.body.appendChild(t);
    t.querySelector('#tt-dismiss-ios').onclick = () => t.remove();
  });
})();
