# -*- coding: utf-8 -*-
"""Writes the FLYP marketing site. Each output file is standalone HTML."""
import io, os, re

# The site/ folder that holds this _build/ directory. Derived from the script's
# own location so the generators work from any checkout, whatever the cwd.
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
CSSV = 8
JSV = 3
IMGV = 2  # bump whenever a photo in assets/ is replaced

NAV_ITEMS = [
    ('index.html#features', 'المميزات', 'Features'),
    ('safety.html', 'الأمان', 'Safety'),
    ('help.html', 'المساعدة', 'Help'),
    ('about.html', 'من نحن', 'About'),
]

FOOT_COLS = [
    ('التطبيق', 'The app', [
        ('index.html#features', 'المميزات', 'Features'),
        ('download.html', 'تحميل التطبيق', 'Download'),
        ('index.html#faq', 'الأسئلة الشائعة', 'Common questions'),
        ('help.html', 'مركز المساعدة', 'Help centre'),
    ]),
    ('المجتمع', 'Community', [
        ('about.html', 'من نحن', 'About us'),
        ('guidelines.html', 'إرشادات المجتمع', 'Community guidelines'),
        ('safety.html', 'مركز الأمان', 'Safety centre'),
        ('contact.html', 'تواصل معنا', 'Contact us'),
    ]),
    ('قانوني', 'Legal', [
        ('privacy.html', 'سياسة الخصوصية', 'Privacy policy'),
        # Google Play requires a deletion URL reachable without the app, and
        # checks that it is actually findable. The footer is on every page, so
        # this is the one link that guarantees that.
        ('delete-account.html', 'حذف الحساب', 'Delete your account'),
        ('terms.html', 'شروط الاستخدام', 'Terms of use'),
        ('copyright.html', 'حقوق النشر', 'Copyright'),
        ('law-enforcement.html', 'طلبات الجهات الرسمية', 'Law enforcement'),
    ]),
]


def t(ar, en):
    """A translatable inline node."""
    return u'data-ar="%s" data-en="%s"' % (ar.replace('"', '&quot;'), en.replace('"', '&quot;'))


def nav(here):
    links = []
    for href, ar, en in NAV_ITEMS:
        cls = ' class="here"' if href.split('#')[0] == here else ''
        links.append(u'      <a href="%s"%s %s>%s</a>' % (href, cls, t(ar, en), ar))
    return u'''<header class="nav" id="nav">
  <div class="wrap nav-in">
    <a class="brand" href="index.html">
      <img src="assets/app-icon.png" alt="" width="34" height="34">
      <span>FLYP</span>
    </a>

    <nav class="nav-links" aria-label="Primary">
%s
    </nav>

    <div class="nav-right">
      <div class="lang" role="group" aria-label="Language">
        <button type="button" data-lang="ar" class="on">AR</button>
        <button type="button" data-lang="en">EN</button>
      </div>
      <a class="btn btn-sm" href="download.html" %s>حمّل التطبيق</a>
    </div>
  </div>
</header>''' % (u'\n'.join(links), t(u'حمّل التطبيق', 'Download'))


def footer():
    cols = []
    for ar_h, en_h, items in FOOT_COLS:
        lis = u'\n'.join(
            u'          <li><a href="%s" %s>%s</a></li>' % (href, t(ar, en), ar)
            for href, ar, en in items
        )
        cols.append(u'''      <div>
        <h4 %s>%s</h4>
        <ul>
%s
        </ul>
      </div>''' % (t(ar_h, en_h), ar_h, lis))

    return u'''<footer class="foot">
  <div class="wrap">
    <div class="foot-cols">
      <div>
        <a class="brand" href="index.html">
          <img src="assets/app-icon.png" alt="" width="28" height="28">
          <span>FLYP</span>
        </a>
        <p class="foot-about" %s>تطبيق فيديوهات قصيرة عربي. شاهد، صوّر، وابدأ بثًا مباشرًا مع من تحب.</p>
      </div>
%s
    </div>

    <div class="foot-bottom">
      <span>&copy; 2026 FLYP</span>
      <span class="spacer"></span>
      <div class="lang" role="group" aria-label="Language">
        <button type="button" data-lang="ar" class="on">AR</button>
        <button type="button" data-lang="en">EN</button>
      </div>
    </div>
  </div>
</footer>''' % (
        t(u'تطبيق فيديوهات قصيرة عربي. شاهد، صوّر، وابدأ بثًا مباشرًا مع من تحب.',
          'An Arabic short video app. Watch, record, and go live with the people you like.'),
        u'\n'.join(cols))


def page(filename, title_ar, title_en, desc_ar, desc_en, content, here=''):
    html = u'''<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>%(tar)s</title>
<meta name="description" content="%(dar)s">
<meta name="theme-color" content="#1e56d6">
<meta name="tt-title-ar" content="%(tar)s">
<meta name="tt-title-en" content="%(ten)s">
<meta name="tt-desc-en" content="%(den)s">

<meta property="og:type" content="website">
<meta property="og:site_name" content="FLYP">
<meta property="og:title" content="%(tar)s">
<meta property="og:description" content="%(dar)s">
<meta property="og:image" content="assets/app-icon.png">
<meta name="twitter:card" content="summary_large_image">

<link rel="icon" type="image/png" sizes="32x32" href="assets/favicon-32.png">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="site.css?v=%(cssv)d">
</head>
<body>

<a class="skip" href="#main" %(skip)s>تخطي إلى المحتوى</a>

%(nav)s

<main id="main">
%(content)s
</main>

%(foot)s

<script src="site.js?v=%(jsv)d"></script>
</body>
</html>
''' % dict(tar=title_ar, ten=title_en, dar=desc_ar, den=desc_en,
           cssv=CSSV, jsv=JSV,
           skip=t(u'تخطي إلى المحتوى', 'Skip to content'),
           nav=nav(here), foot=footer(), content=content)
    # Photos are versioned like the stylesheet, so replacing one does not
    # leave returning visitors looking at the previous image from cache.
    html = re.sub(r'assets/((?:clip|av)-\d+)\.jpg',
                  lambda m: 'assets/%s.jpg?v=%d' % (m.group(1), IMGV), html)

    path = os.path.join(OUT, filename)
    io.open(path, 'w', encoding='utf-8', newline='\n').write(html)
    print('wrote', filename, len(html), 'chars')
