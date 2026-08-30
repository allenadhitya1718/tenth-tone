/* =========================================================
   FLYP - marketing site behaviour
   Language switching, store links, sticky nav, scroll reveal.
   No dependencies.
   ========================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------
     STORE LINKS
     Fill these in once the app is published. While a value is
     empty its button says "coming soon" and does not navigate,
     which is honest and avoids a dead link.
     --------------------------------------------------------- */
  var STORE = {
    ios: '',      // paste the App Store URL here
    android: '',  // paste the Google Play URL here
    web: ''       // paste the web app address here, for example https://app.flyp.com
  };

  var SOON = { ar: 'قريبًا', en: 'Coming soon' };

  var html = document.documentElement;
  var nodes = document.querySelectorAll('[data-ar][data-en]');
  var blocks = document.querySelectorAll('[data-block]');
  var storeLinks = document.querySelectorAll('[data-store]');

  function meta(name) {
    var m = document.querySelector('meta[name="' + name + '"]');
    return m ? m.getAttribute('content') : null;
  }

  var TITLE = { ar: meta('tt-title-ar') || document.title, en: meta('tt-title-en') || document.title };
  var DESC = { ar: meta('description') || '', en: meta('tt-desc-en') || '' };

  function apply(lang) {
    var ar = lang === 'ar';
    html.lang = ar ? 'ar' : 'en';
    html.dir = ar ? 'rtl' : 'ltr';

    var i;
    for (i = 0; i < nodes.length; i++) {
      nodes[i].textContent = nodes[i].getAttribute(ar ? 'data-ar' : 'data-en');
    }

    // Long prose keeps one full block per language instead of an
    // attribute on every sentence.
    for (i = 0; i < blocks.length; i++) {
      blocks[i].hidden = blocks[i].getAttribute('data-block') !== lang;
    }

    var btns = document.querySelectorAll('.lang button');
    for (i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('on', btns[i].getAttribute('data-lang') === lang);
    }

    document.title = TITLE[lang] || TITLE.ar;
    var d = document.querySelector('meta[name="description"]');
    if (d && DESC[lang]) d.setAttribute('content', DESC[lang]);

    storeLabels(lang);
    try { localStorage.setItem('tt_site_lang', lang); } catch (e) {}
  }

  function storeLabels(lang) {
    for (var i = 0; i < storeLinks.length; i++) {
      var a = storeLinks[i];
      var url = STORE[a.getAttribute('data-store')];
      if (url) continue;
      var label = a.querySelector('span') || a;
      label.textContent = SOON[lang] || SOON.ar;
    }
  }

  // Wire the store buttons once. An unset link is marked disabled
  // rather than left pointing at "#".
  for (var s = 0; s < storeLinks.length; s++) {
    (function (a) {
      var url = STORE[a.getAttribute('data-store')];
      if (url) {
        a.href = url;
        if (/^https?:/.test(url)) { a.target = '_blank'; a.rel = 'noopener'; }
      } else {
        a.removeAttribute('href');
        a.setAttribute('aria-disabled', 'true');
        a.classList.add('is-soon');
        a.classList.remove('btn-ghost');
      }
    })(storeLinks[s]);
  }

  var saved = null;
  try { saved = localStorage.getItem('tt_site_lang'); } catch (e) {}
  if (!saved) {
    // A visitor whose browser is not Arabic almost certainly wants English.
    saved = /^ar\b/i.test(navigator.language || '') ? 'ar' : 'en';
  }
  apply(saved);

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.lang button') : null;
    if (b) apply(b.getAttribute('data-lang'));
  });

  /* ---------- Sticky nav takes its hairline once the page moves ---------- */
  var nav = document.getElementById('nav');
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      nav.classList.toggle('stuck', window.scrollY > 8);
      ticking = false;
    });
  }
  if (nav) {
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Scroll reveal ----------
     Marked from JS so the page still reads correctly with scripting off. */
  if (!('IntersectionObserver' in window) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  var targets = document.querySelectorAll(
    '.dl-head, .dl, .row-copy, .row-art, .scard, .qa > div, .last > .wrap, .hcard'
  );
  for (var k = 0; k < targets.length; k++) targets[k].classList.add('reveal');

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var group = entry.target.parentElement;
      var sibs = group ? [].slice.call(group.children).filter(function (n) {
        return n.classList.contains('reveal');
      }) : [];
      var idx = Math.max(0, sibs.indexOf(entry.target));
      entry.target.style.transitionDelay = Math.min(idx, 4) * 65 + 'ms';
      entry.target.classList.add('in');
      io.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.06 });

  for (var m = 0; m < targets.length; m++) io.observe(targets[m]);

  // Failsafe. If the observer never fires for some reason, content must
  // still be visible rather than stuck at opacity zero.
  setTimeout(function () {
    for (var n = 0; n < targets.length; n++) targets[n].classList.add('in');
  }, 3000);
})();
