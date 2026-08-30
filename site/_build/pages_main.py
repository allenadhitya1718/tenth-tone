# -*- coding: utf-8 -*-
"""Home, download, about and 404."""
import io, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_site import page, t

APPLE = ('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.4 12.8c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7'
         '-1.4-.1-2.7.8-3.3.8-.7 0-1.7-.8-2.8-.8-1.4 0-2.8.8-3.5 2.1-1.5 2.6-.4 6.5 1.1 8.6.7 1 1.6 2.2 2.7 2.2 1.1 0 '
         '1.5-.7 2.8-.7s1.6.7 2.8.7c1.1 0 1.9-1 2.6-2.1.8-1.2 1.2-2.4 1.2-2.5-.1 0-2.3-.9-2.3-3.2zM14.3 5.9c.6-.7 1-1.7.9-2.7'
         '-.9 0-2 .6-2.6 1.3-.6.6-1.1 1.7-.9 2.6 1 .1 2-.5 2.6-1.2z"/></svg>')

PLAY = ('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.6 2.4c-.3.3-.5.8-.5 1.4v16.4c0 .6.2 1.1.5 1.4l.1.1 9.2-9.2'
        'v-.2L3.6 2.4zM16 15.2l-3.1-3.1v-.2L16 8.8l.1.1 3.6 2.1c1 .6 1 1.6 0 2.2L16 15.2zM15.9 15.3l-3.1-3.1-9.2 9.2c.3.4.9.4 '
        '1.5.1l10.8-6.2M15.9 8.7L5.1 2.5c-.6-.3-1.2-.3-1.5.1l9.2 9.2 3.1-3.1z"/></svg>')

GLOBE = ('<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" '
         'stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3.4 9h17.2M3.4 15h17.2"/>'
         '<path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z"/></svg>')

DOWNLOAD_ICO = ('<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
                'stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v11"/><path d="m7.5 10 4.5 4.5 4.5-4.5"/>'
                '<path d="M4.5 19.5h15"/></svg>')


def store_btn(kind, ar, en, cls='btn'):
    return (u'<a class="%s" href="#" data-store="%s" %s>%s<span %s>%s</span></a>'
            % (cls, kind, '', DOWNLOAD_ICO, t(ar, en), ar))


# ------------------------------------------------------------------ phones
PH_FEED = u'''<div class="ph ph-front" aria-hidden="true">
          <div class="ph-scr">
            <img class="ph-clip" src="assets/clip-1.jpg" alt="" width="768" height="1224">
            <div class="ph-shade"></div>
            <div class="ph-top">
              <span %(tab1)s>متابَعة</span>
              <span class="on" %(tab2)s>لك</span>
            </div>
            <div class="ph-rail">
              <span class="rail-av"><img src="assets/av-1.jpg" alt="" width="40" height="40"><i>+</i></span>
              <span class="rail"><svg viewBox="0 0 24 24" class="ico fill"><path d="M12 20.3 4.2 12.5a4.8 4.8 0 0 1 6.8-6.8l1 1 1-1a4.8 4.8 0 0 1 6.8 6.8Z"/></svg><b>18.4K</b></span>
              <span class="rail"><svg viewBox="0 0 24 24" class="ico"><path d="M20 11.8a7.4 7.4 0 0 1-10.8 6.6L4.2 19.8l1.4-4.6A7.4 7.4 0 1 1 20 11.8Z"/></svg><b>962</b></span>
              <span class="rail"><svg viewBox="0 0 24 24" class="ico"><path d="M6 3.6h12a1 1 0 0 1 1 1v16.1l-7-4-7 4V4.6a1 1 0 0 1 1-1Z"/></svg><b>377</b></span>
            </div>
            <div class="ph-cap">
              <b>@nada.q</b>
              <p %(cap)s>الموج قبل الفجر بثلاث دقائق</p>
              <p class="tags"><span %(tag1)s>#البحر_الأحمر</span> <span %(tag2)s>#تصوير</span></p>
              <span class="ph-sound">
                <svg viewBox="0 0 24 24" class="ico"><path d="M9 18.2V6.4l10-2v11.6"/><circle cx="6.6" cy="18.2" r="2.6"/><circle cx="16.6" cy="16" r="2.6"/></svg>
                <span %(snd)s>صوت أصلي · nada.q</span>
              </span>
            </div>
            <div class="ph-bar">
              <svg viewBox="0 0 24 24" class="ico on"><path d="m3.2 10.2 8.8-6.8 8.8 6.8v9.7a1 1 0 0 1-1 1h-4.6v-5.8H8.8v5.8H4.2a1 1 0 0 1-1-1Z"/></svg>
              <svg viewBox="0 0 24 24" class="ico"><circle cx="11" cy="11" r="6.8"/><path d="m20.4 20.4-4.6-4.6"/></svg>
              <span class="ph-add">+</span>
              <svg viewBox="0 0 24 24" class="ico"><path d="M4 5.6h16v10.2a1 1 0 0 1-1 1H8.6L4 20.4Z"/></svg>
              <svg viewBox="0 0 24 24" class="ico"><circle cx="12" cy="8.4" r="3.6"/><path d="M5.2 20.2a6.8 6.8 0 0 1 13.6 0"/></svg>
            </div>
          </div>
        </div>''' % dict(
    tab1=t(u'متابَعة', 'Following'), tab2=t(u'لك', 'For you'),
    cap=t(u'الموج قبل الفجر بثلاث دقائق', 'Three minutes before sunrise, at the water'),
    tag1=t(u'#البحر_الأحمر', '#RedSea'), tag2=t(u'#تصوير', '#Filming'),
    snd=t(u'صوت أصلي · nada.q', 'Original sound · nada.q'))

PH_LIVE = u'''<div class="ph ph-back" aria-hidden="true">
          <div class="ph-scr">
            <img class="ph-clip" src="assets/clip-4.jpg" alt="" loading="lazy" width="768" height="1224">
            <div class="ph-shade"></div>
            <div class="ph-live">
              <span class="live-tag"><i></i><b %(live)s>مباشر</b></span>
              <span class="live-count"><svg viewBox="0 0 24 24" class="ico"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="3.1"/></svg>1,204</span>
            </div>
            <div class="ph-chat">
              <p><b>@rakan.h</b> <span %(c1)s>الصوت واضح جدًا</span></p>
              <p><b>@lamees</b> <span %(c2)s>من أي مدينة تبث؟</span></p>
              <p><b>@turki_92</b> <span %(c3)s>متابع من الرياض</span></p>
            </div>
          </div>
        </div>''' % dict(
    live=t(u'مباشر', 'LIVE'),
    c1=t(u'الصوت واضح جدًا', 'The audio is really clear'),
    c2=t(u'من أي مدينة تبث؟', 'Which city are you in?'),
    c3=t(u'متابع من الرياض', 'Watching from Riyadh'))

PH_PROFILE = u'''<div class="ph ph-front" aria-hidden="true">
          <div class="ph-scr light">
            <div class="pf-top">
              <img class="pf-av" src="assets/av-2.jpg" alt="" width="72" height="72" loading="lazy">
              <b>@sara.almutairi</b>
              <div class="pf-stats">
                <span><b>1,847</b><small %(s1)s>متابِع</small></span>
                <span><b>214</b><small %(s2)s>متابَع</small></span>
                <span><b>63</b><small %(s3)s>مقطع</small></span>
              </div>
              <span class="pf-btn" %(fol)s>متابعة</span>
            </div>
            <div class="pf-grid">
              <span style="background-image:url('assets/clip-3.jpg')"><i>4.1K</i></span>
              <span style="background-image:url('assets/clip-1.jpg')"><i>12.6K</i></span>
              <span style="background-image:url('assets/clip-4.jpg')"><i>908</i></span>
              <span style="background-image:url('assets/clip-2.jpg')"><i>2.3K</i></span>
              <span style="background-image:url('assets/clip-1.jpg')"><i>571</i></span>
              <span style="background-image:url('assets/clip-3.jpg')"><i>7.8K</i></span>
              <span style="background-image:url('assets/clip-5.jpg')"><i>1.9K</i></span>
              <span style="background-image:url('assets/clip-4.jpg')"><i>334</i></span>
              <span style="background-image:url('assets/clip-2.jpg')"><i>5.2K</i></span>
              <span style="background-image:url('assets/clip-5.jpg')"><i>742</i></span>
              <span style="background-image:url('assets/clip-3.jpg')"><i>3.6K</i></span>
              <span style="background-image:url('assets/clip-1.jpg')"><i>288</i></span>
            </div>
          </div>
        </div>''' % dict(
    s1=t(u'متابِع', 'Followers'), s2=t(u'متابَع', 'Following'),
    s3=t(u'مقطع', 'Clips'), fol=t(u'متابعة', 'Follow'))


def dl_cards(detail=False):
    ios_req = t(u'يتطلب iOS 15 أو أحدث', 'Requires iOS 15 or newer')
    and_req = t(u'يتطلب Android 8 أو أحدث', 'Requires Android 8 or newer')
    web_req = t(u'يعمل على Chrome و Safari و Edge', 'Works in Chrome, Safari and Edge')
    return u'''<div class="dl-grid">

      <div class="dl">
        <span class="dl-ico">%(apple)s</span>
        <span class="kicker" %(k1)s>الهاتف</span>
        <h3>iPhone</h3>
        <p %(p1)s>حمّل التطبيق من App Store وابدأ بالمشاهدة خلال دقيقة.</p>
        <p class="req" %(r1)s>يتطلب iOS 15 أو أحدث</p>
        <span class="spacer"></span>
        <a class="btn" href="#" data-store="ios"><span %(b1)s>حمّل من App Store</span></a>
      </div>

      <div class="dl">
        <span class="dl-ico">%(play)s</span>
        <span class="kicker" %(k2)s>الهاتف</span>
        <h3>Android</h3>
        <p %(p2)s>حمّل التطبيق من Google Play، ويعمل على الشبكات البطيئة أيضًا.</p>
        <p class="req" %(r2)s>يتطلب Android 8 أو أحدث</p>
        <span class="spacer"></span>
        <a class="btn" href="#" data-store="android"><span %(b2)s>حمّل من Google Play</span></a>
      </div>

      <div class="dl">
        <span class="dl-ico">%(globe)s</span>
        <span class="kicker" %(k3)s>المتصفح</span>
        <h3 %(h3)s>تطبيق الويب</h3>
        <p %(p3)s>افتح FLYP من المتصفح مباشرة دون تحميل، على الهاتف أو الحاسب.</p>
        <p class="req" %(r3)s>يعمل على Chrome و Safari و Edge</p>
        <span class="spacer"></span>
        <a class="btn btn-ghost" href="#" data-store="web"><span %(b3)s>افتح تطبيق الويب</span></a>
      </div>

    </div>''' % dict(
        apple=APPLE, play=PLAY, globe=GLOBE,
        k1=t(u'الهاتف', 'Mobile'), k2=t(u'الهاتف', 'Mobile'), k3=t(u'المتصفح', 'Browser'),
        h3=t(u'تطبيق الويب', 'Web app'),
        p1=t(u'حمّل التطبيق من App Store وابدأ بالمشاهدة خلال دقيقة.',
             'Get the app from the App Store and start watching within a minute.'),
        p2=t(u'حمّل التطبيق من Google Play، ويعمل على الشبكات البطيئة أيضًا.',
             'Get the app from Google Play. It works on slow connections too.'),
        p3=t(u'افتح FLYP من المتصفح مباشرة دون تحميل، على الهاتف أو الحاسب.',
             'Open FLYP straight from your browser, on a phone or a computer.'),
        r1=ios_req, r2=and_req, r3=web_req,
        b1=t(u'حمّل من App Store', 'Get it on the App Store'),
        b2=t(u'حمّل من Google Play', 'Get it on Google Play'),
        b3=t(u'افتح تطبيق الويب', 'Open the web app'))


# ================================================================== HOME
HOME = u'''
<section class="hero">
  <div class="wrap">
    <div class="hero-card">
      <img src="assets/clip-2.jpg" alt="" width="1376" height="645" fetchpriority="high">
      <div class="hero-copy">
        <h1 %(h1)s>صوّر لحظتك</h1>
        <p class="lede" %(sub)s>صوّرها، انشرها، وشاهدها تصل إلى جمهورها. مجاني، وبدون اشتراك.</p>
        <a class="btn" href="download.html" %(cta)s>حمّل التطبيق</a>
      </div>
    </div>
    <p class="hero-note" %(note)s>بتحميل التطبيق فإنك توافق على شروط الاستخدام وسياسة الخصوصية.</p>
  </div>
</section>

<section class="band band-brand" id="get">
  <div class="wrap">
    <div class="dl-head">
      <h2 class="h2" %(dlh)s>ابدأ في أقل من دقيقة</h2>
      <p class="lede" %(dls)s>اختر جهازك. التسجيل بالبريد الإلكتروني فقط، ولا حاجة لبطاقة.</p>
    </div>
    %(cards)s
  </div>
</section>

<section class="band" id="features">
  <div class="wrap">

    <div class="row">
      <div class="row-copy">
        <h2><span %(f1a)s>موجز</span><br><span %(f1b)s>يعرف ذوقك</span></h2>
        <p %(f1p)s>كل مشاهدة وكل تخطٍّ يقرّبان التوصيات من اهتمامك. الحساب الجديد يظهر مثل القديم تمامًا، وما يقرر الانتشار هو المقطع نفسه.</p>
        <ul class="ticks">
          <li %(f1t1)s>تشغيل فوري دون انتظار</li>
          <li %(f1t2)s>وضع توفير البيانات للشبكات البطيئة</li>
          <li %(f1t3)s>احفظ أي مقطع لمشاهدته لاحقًا</li>
        </ul>
      </div>
      <div class="row-art">
        <div class="duo">
          %(ph_live)s
          %(ph_feed)s
        </div>
      </div>
    </div>

    <div class="row flip">
      <div class="row-copy">
        <h2><span %(f2a)s>صوّر</span><br><span %(f2b)s>وانشر مباشرة</span></h2>
        <p %(f2p)s>كاميرا كاملة داخل التطبيق، وقصّ بالثانية، وأصوات أصلية تُنسب إليك عندما يستخدمها غيرك. لا تحتاج برنامجًا آخر قبل النشر.</p>
        <ul class="ticks">
          <li %(f2t1)s>ضغط تلقائي يحافظ على الجودة</li>
          <li %(f2t2)s>وسوم وإشارات داخل الوصف</li>
          <li %(f2t3)s>أرشفة أي مقطع بدل حذفه</li>
        </ul>
      </div>
      <div class="row-art">
        <figure class="shot" style="margin:0">
          <img src="assets/clip-5.jpg" alt="" loading="lazy" width="1200" height="770">
        </figure>
      </div>
    </div>

    <div class="row">
      <div class="row-copy">
        <h2><span %(f3a)s>ابنِ</span><br><span %(f3b)s>جمهورك</span></h2>
        <p %(f3p)s>ملف شخصي يجمع مقاطعك، ومنشورات مثبّتة أعلى الصفحة، ومتابعون تصلهم إشعارات بكل جديد. وعندما تريد التحدث مباشرة، افتح بثًا في ثانيتين.</p>
        <ul class="ticks">
          <li %(f3t1)s>بث مباشر مع تعليقات لحظية</li>
          <li %(f3t2)s>رسائل خاصة ومجموعات</li>
          <li %(f3t3)s>قائمة أصدقاء مقربين لمنشورات محدودة</li>
        </ul>
      </div>
      <div class="row-art">
        <div class="duo solo">
          %(ph_profile)s
        </div>
      </div>
    </div>

  </div>
</section>

<section class="band band-warm" id="safety">
  <div class="wrap">
    <div class="dl-head">
      <h2 class="h2" %(sh)s>التحكم يبقى لك</h2>
      <p class="lede" %(ss)s>ليست إعدادات مدفونة في آخر قائمة. كل أداة هنا تعمل فعليًا ويمكن التراجع عنها في أي وقت.</p>
    </div>
    <div class="s-grid">
      %(scards)s
    </div>
  </div>
</section>

<section class="band" id="faq">
  <div class="wrap">
    <h2 class="h2" %(qh)s>أسئلة قبل التحميل</h2>
    <dl class="qa">
      %(qa)s
    </dl>
  </div>
</section>

<section class="band band-brand last">
  <div class="wrap">
    <h2 %(lh)s>أول مقطع لك على بُعد دقيقة</h2>
    <p class="lede" %(ls)s>سجّل ببريدك الإلكتروني وابدأ المشاهدة. لا بطاقة، ولا اشتراك، ولا إعلانات تقطع الفيديو.</p>
    <div class="row-cta">
      <a class="btn" href="download.html" %(lb)s>حمّل التطبيق</a>
    </div>
    <ul class="assure">
      <li %(a1)s>مجاني بالكامل</li>
      <li %(a2)s>لا حاجة لبطاقة</li>
      <li %(a3)s>احذف حسابك متى شئت</li>
    </ul>
  </div>
</section>
'''


def scard(ico, ar_h, en_h, ar_p, en_p):
    return u'''<div class="scard">
        <span class="s-ico">%s</span>
        <h3 %s>%s</h3>
        <p %s>%s</p>
      </div>''' % (ico, t(ar_h, en_h), ar_h, t(ar_p, en_p), ar_p)


I_LOCK = ('<svg class="ico" viewBox="0 0 24 24"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2.2"/>'
          '<path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"/></svg>')
I_FILTER = ('<svg class="ico" viewBox="0 0 24 24"><path d="M4 6.5h16"/><path d="M7 12h10"/><path d="M10 17.5h4"/></svg>')
I_MUTE = ('<svg class="ico" viewBox="0 0 24 24"><path d="M11 5.5 6.8 9H4v6h2.8L11 18.5Z"/><path d="m16 10 4 4M20 10l-4 4"/></svg>')
I_PIN = ('<svg class="ico" viewBox="0 0 24 24"><path d="M12 21s6.5-6.1 6.5-10.5a6.5 6.5 0 0 0-13 0C5.5 14.9 12 21 12 21Z"/>'
         '<circle cx="12" cy="10.4" r="2.4"/></svg>')

SCARDS = u'\n      '.join([
    scard(I_LOCK, u'حساب خاص', 'Private account',
          u'لا يرى منشوراتك إلا من توافق عليه، وتصلك طلبات المتابعة للمراجعة.',
          'Only people you approve see your posts, and follow requests wait for your review.'),
    scard(I_FILTER, u'الكلمات المخفية', 'Hidden words',
          u'اكتب الكلمات التي لا تريد رؤيتها، ولن يصلك تعليق يحتويها.',
          'Write the words you would rather not see, and no comment containing them reaches you.'),
    scard(I_MUTE, u'التقييد والكتم', 'Restrict and mute',
          u'حدّ من شخص بهدوء دون أن يعرف، ودون أن تضطر لمواجهته.',
          'Quietly limit someone without them knowing, and without a confrontation.'),
    scard(I_PIN, u'موقعك ينتهي وحده', 'Location expires by itself',
          u'مشاركة الموقع تتوقف تلقائيًا بعد ثماني ساعات، ولا نحتفظ بسجل تحركاتك.',
          'Location sharing stops on its own after eight hours, and we keep no history of where you went.'),
])


def qa(ar_q, en_q, ar_a, en_a):
    return u'''<div>
        <dt %s>%s</dt>
        <dd %s>%s</dd>
      </div>''' % (t(ar_q, en_q), ar_q, t(ar_a, en_a), ar_a)


QA = u'\n      '.join([
    qa(u'هل التطبيق مجاني؟', 'Is the app free?',
       u'نعم. التحميل والاستخدام مجانيان بالكامل، ولا يوجد اشتراك مدفوع.',
       'Yes. Downloading and using it are completely free, and there is no paid subscription.'),
    qa(u'ما الحد الأدنى للعمر؟', 'What is the minimum age?',
       u'ثلاثة عشر عامًا. بعض الميزات مثل مشاركة الموقع متاحة لمن أتم الثامنة عشرة فقط.',
       'Thirteen. Some features, such as location sharing, are limited to people over eighteen.'),
    qa(u'هل يعمل بالإنجليزية أيضًا؟', 'Does it work in English too?',
       u'نعم. التطبيق يعمل بالعربية والإنجليزية، وتبدّل اللغة من الإعدادات في أي وقت.',
       'Yes. The app works in Arabic and English, and you can switch language in Settings whenever you like.'),
    qa(u'هل يمكنني حذف حسابي؟', 'Can I delete my account?',
       u'نعم، من داخل الإعدادات. لديك ثلاثون يومًا للتراجع قبل أن يُحذف كل شيء نهائيًا.',
       'Yes, from inside Settings. You have thirty days to change your mind before everything is permanently removed.'),
])

home = HOME % dict(
    h1=t(u'صوّر لحظتك', 'Record your moment'),
    sub=t(u'صوّرها، انشرها، وشاهدها تصل إلى جمهورها. مجاني، وبدون اشتراك.',
          'Film it, post it, and watch it find its audience. Free, with no subscription.'),
    cta=t(u'حمّل التطبيق', 'Download'),
    note=t(u'بتحميل التطبيق فإنك توافق على شروط الاستخدام وسياسة الخصوصية.',
           'By downloading the app you agree to our Terms of Use and Privacy Policy.'),
    dlh=t(u'ابدأ في أقل من دقيقة', 'Start in under a minute'),
    dls=t(u'اختر جهازك. التسجيل بالبريد الإلكتروني فقط، ولا حاجة لبطاقة.',
          'Pick your device. Sign up with an email address, no card needed.'),
    cards=dl_cards(),
    f1a=t(u'موجز', 'A feed'), f1b=t(u'يعرف ذوقك', 'that knows your taste'),
    f1p=t(u'كل مشاهدة وكل تخطٍّ يقرّبان التوصيات من اهتمامك. الحساب الجديد يظهر مثل القديم تمامًا، وما يقرر الانتشار هو المقطع نفسه.',
          'Every watch and every skip pulls the recommendations closer to you. A new account appears exactly like an old one, and what decides reach is the clip itself.'),
    f1t1=t(u'تشغيل فوري دون انتظار', 'Instant playback, no waiting'),
    f1t2=t(u'وضع توفير البيانات للشبكات البطيئة', 'A data saver mode for slow networks'),
    f1t3=t(u'احفظ أي مقطع لمشاهدته لاحقًا', 'Save any clip to watch later'),
    f2a=t(u'صوّر', 'Record'), f2b=t(u'وانشر مباشرة', 'and post straight away'),
    f2p=t(u'كاميرا كاملة داخل التطبيق، وقصّ بالثانية، وأصوات أصلية تُنسب إليك عندما يستخدمها غيرك. لا تحتاج برنامجًا آخر قبل النشر.',
          'A full camera inside the app, second by second trimming, and original sounds credited to you when other people use them. Nothing else needed before you post.'),
    f2t1=t(u'ضغط تلقائي يحافظ على الجودة', 'Automatic compression that keeps the quality'),
    f2t2=t(u'وسوم وإشارات داخل الوصف', 'Hashtags and mentions inside the caption'),
    f2t3=t(u'أرشفة أي مقطع بدل حذفه', 'Archive a clip instead of deleting it'),
    f3a=t(u'ابنِ', 'Build'), f3b=t(u'جمهورك', 'your audience'),
    f3p=t(u'ملف شخصي يجمع مقاطعك، ومنشورات مثبّتة أعلى الصفحة، ومتابعون تصلهم إشعارات بكل جديد. وعندما تريد التحدث مباشرة، افتح بثًا في ثانيتين.',
          'A profile that gathers your clips, pinned posts at the top, and followers who get a notification for anything new. When you want to talk live, open a stream in two taps.'),
    f3t1=t(u'بث مباشر مع تعليقات لحظية', 'Live streaming with real time comments'),
    f3t2=t(u'رسائل خاصة ومجموعات', 'Private messages and groups'),
    f3t3=t(u'قائمة أصدقاء مقربين لمنشورات محدودة', 'A close friends list for limited posts'),
    ph_feed=PH_FEED, ph_live=PH_LIVE, ph_profile=PH_PROFILE,
    sh=t(u'التحكم يبقى لك', 'You stay in control'),
    ss=t(u'ليست إعدادات مدفونة في آخر قائمة. كل أداة هنا تعمل فعليًا ويمكن التراجع عنها في أي وقت.',
         'Not settings buried at the bottom of a menu. Every tool here genuinely works and every one is reversible.'),
    scards=SCARDS,
    qh=t(u'أسئلة قبل التحميل', 'Before you download'),
    qa=QA,
    lh=t(u'أول مقطع لك على بُعد دقيقة', 'Your first clip is a minute away'),
    ls=t(u'سجّل ببريدك الإلكتروني وابدأ المشاهدة. لا بطاقة، ولا اشتراك، ولا إعلانات تقطع الفيديو.',
         'Sign up with an email and start watching. No card, no subscription, and no ads cutting into a video.'),
    lb=t(u'حمّل التطبيق', 'Download'),
    a1=t(u'مجاني بالكامل', 'Completely free'),
    a2=t(u'لا حاجة لبطاقة', 'No card needed'),
    a3=t(u'احذف حسابك متى شئت', 'Delete your account anytime'),
)

page('index.html', u'FLYP', u'FLYP',
     u'تطبيق فيديوهات قصيرة عربي. شاهد، صوّر، وابدأ بثًا مباشرًا. مجاني على iPhone و Android.',
     u'An Arabic short video app. Watch, record and go live. Free on iPhone and Android.',
     home, here='index.html')


# ================================================================== DOWNLOAD
DOWNLOAD = u'''
<section class="doc-head">
  <div class="wrap">
    <h1 %(h1)s>حمّل FLYP</h1>
    <p class="lede" %(sub)s>التطبيق مجاني على الهاتف والمتصفح. اختر جهازك وابدأ خلال دقيقة.</p>
    <p class="updated" %(note)s>بتحميل التطبيق فإنك توافق على شروط الاستخدام وسياسة الخصوصية.</p>
  </div>
</section>

<section class="band">
  <div class="wrap">
    %(cards)s
  </div>
</section>

<section class="band band-warm">
  <div class="wrap">
    <div class="dl-head">
      <h2 class="h2" %(nh)s>ماذا يحدث بعد التحميل</h2>
      <p class="lede" %(ns)s>ثلاث خطوات فقط قبل أول مقطع تشاهده.</p>
    </div>
    <div class="s-grid">
      <div class="scard"><span class="s-ico"><b style="font-weight:700">1</b></span><h3 %(k1)s>أنشئ حسابًا</h3><p %(v1)s>بريد إلكتروني وكلمة مرور، ثم رمز تحقق من ست خانات يصلك بالبريد.</p></div>
      <div class="scard"><span class="s-ico"><b style="font-weight:700">2</b></span><h3 %(k2)s>اختر اسم مستخدم</h3><p %(v2)s>اسم يظهر للناس ومعرّف يبدأ بعلامة @ يمكن للآخرين الإشارة إليك به.</p></div>
      <div class="scard"><span class="s-ico"><b style="font-weight:700">3</b></span><h3 %(k3)s>ابدأ بالمشاهدة</h3><p %(v3)s>الموجز يبدأ عامًا ثم يقترب من ذوقك مع كل مقطع تشاهده.</p></div>
      <div class="scard"><span class="s-ico"><b style="font-weight:700">4</b></span><h3 %(k4)s>انشر أول مقطع</h3><p %(v4)s>صوّر من داخل التطبيق أو اختر مقطعًا من جهازك، ثم أضف وصفًا ووسومًا.</p></div>
    </div>
  </div>
</section>

<section class="band">
  <div class="wrap">
    <h2 class="h2" %(rh)s>المتطلبات</h2>
    <div class="table-wrap">
      <table class="prose" style="max-width:none">
        <thead><tr><th %(c1)s>الجهاز</th><th %(c2)s>الحد الأدنى</th><th %(c3)s>ملاحظات</th></tr></thead>
        <tbody>
          <tr><td>iPhone</td><td>iOS 15</td><td %(m1)s>يعمل على iPad أيضًا بحجم شاشة الهاتف</td></tr>
          <tr><td>Android</td><td>Android 8</td><td %(m2)s>يحتاج نحو 120 ميجابايت من المساحة</td></tr>
          <tr><td %(m3)s>المتصفح</td><td>Chrome · Safari · Edge</td><td %(m4)s>يمكن تثبيته على الشاشة الرئيسية كتطبيق</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</section>
'''

download = DOWNLOAD % dict(
    h1=t(u'حمّل FLYP', 'Download FLYP'),
    sub=t(u'التطبيق مجاني على الهاتف والمتصفح. اختر جهازك وابدأ خلال دقيقة.',
          'The app is free on mobile and in the browser. Pick your device and start within a minute.'),
    note=t(u'بتحميل التطبيق فإنك توافق على شروط الاستخدام وسياسة الخصوصية.',
           'By downloading the app you agree to our Terms of Use and Privacy Policy.'),
    cards=dl_cards(True),
    nh=t(u'ماذا يحدث بعد التحميل', 'What happens after you install'),
    ns=t(u'ثلاث خطوات فقط قبل أول مقطع تشاهده.', 'Only a few steps before your first clip.'),
    k1=t(u'أنشئ حسابًا', 'Create an account'),
    v1=t(u'بريد إلكتروني وكلمة مرور، ثم رمز تحقق من ست خانات يصلك بالبريد.',
         'An email address and a password, then a six digit code sent to that address.'),
    k2=t(u'اختر اسم مستخدم', 'Pick a username'),
    v2=t(u'اسم يظهر للناس ومعرّف يبدأ بعلامة @ يمكن للآخرين الإشارة إليك به.',
         'A display name, and a handle starting with @ that other people can mention you by.'),
    k3=t(u'ابدأ بالمشاهدة', 'Start watching'),
    v3=t(u'الموجز يبدأ عامًا ثم يقترب من ذوقك مع كل مقطع تشاهده.',
         'The feed starts general, then moves closer to your taste with every clip you watch.'),
    k4=t(u'انشر أول مقطع', 'Post your first clip'),
    v4=t(u'صوّر من داخل التطبيق أو اختر مقطعًا من جهازك، ثم أضف وصفًا ووسومًا.',
         'Record inside the app or pick a clip from your device, then add a caption and hashtags.'),
    rh=t(u'المتطلبات', 'Requirements'),
    c1=t(u'الجهاز', 'Device'), c2=t(u'الحد الأدنى', 'Minimum'), c3=t(u'ملاحظات', 'Notes'),
    m1=t(u'يعمل على iPad أيضًا بحجم شاشة الهاتف', 'Runs on iPad too, at phone screen size'),
    m2=t(u'يحتاج نحو 120 ميجابايت من المساحة', 'Needs around 120 MB of space'),
    m3=t(u'المتصفح', 'Browser'),
    m4=t(u'يمكن تثبيته على الشاشة الرئيسية كتطبيق', 'Can be installed to the home screen as an app'),
)

page('download.html', u'تحميل FLYP', 'Download FLYP',
     u'حمّل تطبيق FLYP على iPhone أو Android أو افتحه من المتصفح.',
     'Get FLYP on iPhone, Android, or open it in your browser.',
     download, here='download.html')


# ================================================================== 404
NOTFOUND = u'''
<section class="oops">
  <div class="wrap">
    <h1 %(h)s>هذه الصفحة غير موجودة</h1>
    <p class="lede" %(s)s>الرابط قد يكون قديمًا أو مكتوبًا بشكل خاطئ.</p>
    <div class="row-cta">
      <a class="btn" href="index.html" %(b1)s>العودة للصفحة الرئيسية</a>
      <a class="btn btn-ghost" href="help.html" %(b2)s>مركز المساعدة</a>
    </div>
  </div>
</section>
''' % dict(
    h=t(u'هذه الصفحة غير موجودة', 'This page does not exist'),
    s=t(u'الرابط قد يكون قديمًا أو مكتوبًا بشكل خاطئ.', 'The link may be old or mistyped.'),
    b1=t(u'العودة للصفحة الرئيسية', 'Back to the home page'),
    b2=t(u'مركز المساعدة', 'Help centre'),
)

page('404.html', u'الصفحة غير موجودة', 'Page not found',
     u'الصفحة المطلوبة غير موجودة.', 'The page you asked for does not exist.',
     NOTFOUND)

print('done')
