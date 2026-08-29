# -*- coding: utf-8 -*-
"""Shared builder for the long document pages (privacy, terms, guidelines...)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_site import page, t

UPDATED_AR = u'آخر تحديث: 29 أغسطس 2026'
UPDATED_EN = 'Last updated: 29 August 2026'

TOC_AR = u'في هذه الصفحة'
TOC_EN = 'On this page'


def block(lang, sections, prefix):
    """sections: list of (slug, heading, body html)."""
    toc = u'\n'.join(
        u'        <li><a href="#%s-%s">%s</a></li>' % (prefix, slug, head)
        for slug, head, _ in sections)
    body = u'\n'.join(
        u'      <h2 id="%s-%s">%s</h2>\n%s' % (prefix, slug, head, body)
        for slug, head, body in sections)
    return u'''  <div class="doc-in" data-block="%(lang)s">
    <aside class="toc">
      <h4>%(toch)s</h4>
      <ul>
%(toc)s
      </ul>
    </aside>
    <div class="prose">
%(body)s
    </div>
  </div>''' % dict(lang=lang, toch=(TOC_AR if lang == 'ar' else TOC_EN), toc=toc, body=body)


def doc(filename, title_ar, title_en, lede_ar, lede_en, desc_ar, desc_en,
        sections_ar, sections_en, here=''):
    content = u'''
<section class="doc-head">
  <div class="wrap">
    <h1 %(h)s>%(tar)s</h1>
    <p class="lede" %(l)s>%(lar)s</p>
    <p class="updated" %(u)s>%(uar)s</p>
  </div>
</section>

<section class="doc-body">
  <div class="wrap">
%(ar)s
%(en)s
  </div>
</section>
''' % dict(
        h=t(title_ar, title_en), tar=title_ar,
        l=t(lede_ar, lede_en), lar=lede_ar,
        u=t(UPDATED_AR, UPDATED_EN), uar=UPDATED_AR,
        ar=block('ar', sections_ar, 'ar'),
        en=block('en', sections_en, 'en'))
    page(filename, title_ar, title_en, desc_ar, desc_en, content, here=here)
