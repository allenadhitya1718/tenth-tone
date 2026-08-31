# -*- coding: utf-8 -*-
"""Safety centre, help centre, contact, about."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_site import page, t

F = u'<span class="fill">%s</span>'
M_SUP = 'support@flyp-sa.com'
M_PRESS = 'press@flyp-sa.com'
M_LEGAL = 'legal@flyp-sa.com'
M_PRIV = 'privacy@flyp-sa.com'
M_BIZ = 'business@flyp-sa.com'


def head(title_ar, title_en, lede_ar, lede_en):
    return u'''
<section class="doc-head">
  <div class="wrap">
    <h1 %s>%s</h1>
    <p class="lede" %s>%s</p>
  </div>
</section>
''' % (t(title_ar, title_en), title_ar, t(lede_ar, lede_en), lede_ar)


def scard(ar_h, en_h, ar_p, en_p, ar_w=None, en_w=None):
    where = u''
    if ar_w:
        where = u'\n        <span class="where" %s>%s</span>' % (t(ar_w, en_w), ar_w)
    return u'''<div class="scard">
        <h3 %s>%s</h3>
        <p %s>%s</p>%s
      </div>''' % (t(ar_h, en_h), ar_h, t(ar_p, en_p), ar_p, where)


def qa(ar_q, en_q, ar_a, en_a):
    return u'''<div>
        <dt %s>%s</dt>
        <dd %s>%s</dd>
      </div>''' % (t(ar_q, en_q), ar_q, t(ar_a, en_a), ar_a)


def qa_more(ar_q, en_q, ar_a, en_a, href, ar_l, en_l):
    """Same as qa(), plus a link on its own line.

    site.js swaps languages by overwriting textContent, so an anchor cannot
    live inside a data-ar element - it would be wiped on the first toggle.
    The answer and the link are therefore separate translatable children of
    the <dd>, which is left untranslated itself.
    """
    return u'''<div>
        <dt %s>%s</dt>
        <dd>
          <span %s>%s</span>
          <a href="%s" style="display:block;margin-top:8px;text-decoration:underline" %s>%s</a>
        </dd>
      </div>''' % (t(ar_q, en_q), ar_q, t(ar_a, en_a), ar_a,
                   href, t(ar_l, en_l), ar_l)


def hcard(ar_h, en_h, ar_p, en_p, mail):
    return u'''<div class="hcard">
        <h3 %s>%s</h3>
        <p %s>%s</p>
        <p style="margin-top:12px;font-size:15px">%s</p>
      </div>''' % (t(ar_h, en_h), ar_h, t(ar_p, en_p), ar_p, mail)


# ==================================================================== SAFETY
TOOLS = u'\n      '.join([
    scard(u'حساب خاص', 'Private account',
          u'لا يرى منشوراتك إلا من توافق عليه. طلبات المتابعة تنتظر مراجعتك.',
          'Only people you approve see your posts. Follow requests wait for your review.',
          u'الإعدادات ← الخصوصية ← حساب خاص', 'Settings, Privacy, Private account'),
    scard(u'التحكم بالتعليقات', 'Comment controls',
          u'حدّد من يستطيع التعليق: الجميع، من تتابعهم، أو لا أحد.',
          'Choose who can comment: everyone, people you follow, or nobody.',
          u'الإعدادات ← الخصوصية ← التعليقات', 'Settings, Privacy, Comments'),
    scard(u'الكلمات المخفية', 'Hidden words',
          u'اكتب الكلمات التي لا تريد رؤيتها، وسيُخفى أي تعليق يحتويها قبل أن يصلك.',
          'Write the words you would rather not see. Any comment containing them is hidden before it reaches you.',
          u'الإعدادات ← الخصوصية ← الكلمات المخفية', 'Settings, Privacy, Hidden words'),
    scard(u'التقييد', 'Restrict',
          u'تعليقات من قيّدته لا تظهر لغيرك، ورسائله تذهب إلى طلبات منفصلة. لا يعرف أنه مقيَّد.',
          'Comments from someone you restrict are visible only to them, and their messages go to a separate requests folder. They are not told.',
          u'ملف الشخص ← الخيارات ← تقييد', 'Their profile, options, Restrict'),
    scard(u'الكتم والحظر', 'Mute and block',
          u'الكتم يخفي محتوى شخص عنك. الحظر يقطع كل شيء بينكما ويمنعه من رؤية حسابك.',
          'Muting hides someone from you. Blocking cuts everything between you and stops them seeing your account.',
          u'ملف الشخص ← الخيارات', 'Their profile, options'),
    scard(u'الأصدقاء المقربون', 'Close friends',
          u'قائمة خاصة يمكنك قصر بعض المنشورات عليها. لا يعرف أحد أنه ضمنها أو خارجها.',
          'A private list you can limit certain posts to. Nobody is told whether they are on it.',
          u'الإعدادات ← الأصدقاء المقربون', 'Settings, Close friends'),
    scard(u'من يمكنه مراسلتك', 'Who can message you',
          u'اقصر الرسائل على من تتابعهم، أو أغلقها تمامًا.',
          'Limit messages to people you follow, or turn them off entirely.',
          u'الإعدادات ← الخصوصية ← الرسائل', 'Settings, Privacy, Messages'),
    scard(u'التحكم بالموقع', 'Location controls',
          u'مغلق افتراضيًا، ولمن أتمّ الثامنة عشرة فقط، وينتهي وحده بعد ثماني ساعات.',
          'Off by default, for people over eighteen only, and it expires on its own after eight hours.',
          u'الإعدادات ← أذونات الجهاز', 'Settings, Device permissions'),
    scard(u'أجهزة الدخول', 'Sign in devices',
          u'راجع كل جهاز دخل إلى حسابك، وأنهِ أي جلسة لا تعرفها.',
          'Review every device that has signed into your account, and end any session you do not recognise.',
          u'الإعدادات ← الأجهزة والدخول', 'Settings, Devices and sign ins'),
    scard(u'الأرشفة بدل الحذف', 'Archive instead of delete',
          u'أخفِ مقطعًا عن الجميع دون أن تفقده. يمكنك إعادته في أي وقت.',
          'Hide a clip from everyone without losing it. You can bring it back at any time.',
          u'المقطع ← الخيارات ← أرشفة', 'On the clip, options, Archive'),
    scard(u'الإبلاغ', 'Reporting',
          u'أبلغ عن مقطع أو تعليق أو حساب. البلاغ سرّي ولا يعرف الطرف الآخر من أبلغ.',
          'Report a clip, a comment, or an account. Reports are confidential and the other person is not told who reported them.',
          u'الخيارات ← إبلاغ', 'Options, Report'),
    scard(u'حالة الحساب', 'Account status',
          u'راجع أي إجراء اتُخذ ضد حسابك، واعترض عليه إن رأيته خطأ.',
          'See any action taken against your account, and appeal it if you think it was wrong.',
          u'الإعدادات ← حالة الحساب', 'Settings, Account status'),
])

SAFETY = head(u'مركز الأمان', 'Safety Centre',
              u'كل أداة في هذه الصفحة موجودة داخل التطبيق وتعمل فعليًا. هنا مكانها وماذا تفعل بالضبط.',
              'Every tool on this page exists inside the app and genuinely works. Here is where it is and exactly what it does.') + u'''
<section class="band band-warm">
  <div class="wrap">
    <h2 class="h2" %(t1)s>أدوات التحكم</h2>
    <div class="s-grid">
      %(tools)s
    </div>
  </div>
</section>

<section class="band">
  <div class="wrap">
    <div class="row">
      <div class="row-copy">
        <h2 %(t2)s>لأولياء الأمور</h2>
        <p %(p2)s>الحد الأدنى لعمر الحساب ثلاثة عشر عامًا. إن كان ابنك أو ابنتك يستخدم التطبيق، هذه أهم أربعة إعدادات نوصي بمراجعتها معًا في خمس دقائق.</p>
      </div>
      <div class="row-copy">
        <ul class="ticks">
          <li %(g1)s>اجعل الحساب خاصًا، فلا يرى المنشورات إلا من يوافق عليه</li>
          <li %(g2)s>اقصر الرسائل على المتابَعين فقط</li>
          <li %(g3)s>تأكد أن مشاركة الموقع مغلقة، وهي ممنوعة أصلًا دون الثامنة عشرة</li>
          <li %(g4)s>أضف كلمات مخفية لمنع التعليقات المسيئة قبل وصولها</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<section class="band">
  <div class="wrap">
    <h2 class="h2" %(t3)s>إذا كان أحد في خطر</h2>
    <div class="prose" style="max-width:64ch">
      <div class="note" %(n1)s>إن كان هناك خطر مباشر على حياة شخص، اتصل بخدمات الطوارئ في بلدك أولًا. نحن لسنا خدمة طوارئ ولا يمكننا التدخل الفوري.</div>
      <p %(p3)s>بعد ذلك، أبلغ عن المحتوى من داخل التطبيق حتى نتمكن من مراجعته وحفظه. البلاغات المتعلقة بسلامة الأشخاص لها أولوية على غيرها.</p>
      <p %(p4)s>المحتوى الذي يشجع على إيذاء النفس ممنوع. إن نشر شخص ما يوحي بأنه يمر بأزمة، أبلغ عن المقطع وتواصل معه إن استطعت.</p>
    </div>
  </div>
</section>

<section class="band band-brand">
  <div class="wrap">
    <h2 class="h2" %(t4)s>ماذا يحدث بعد البلاغ</h2>
    <div class="s-grid">
      <div class="scard"><h3 %(s1)s>يصل البلاغ</h3><p %(v1)s>يدخل البلاغ قائمة المراجعة فورًا، ولا يعرف الطرف الآخر من أرسله.</p></div>
      <div class="scard"><h3 %(s2)s>تتم المراجعة</h3><p %(v2)s>يراجع البلاغ شخص من الفريق مقابل إرشادات المجتمع. البلاغات الخطرة تُقدَّم على غيرها.</p></div>
      <div class="scard"><h3 %(s3)s>يُتخذ إجراء</h3><p %(v3)s>حذف المحتوى، أو تقييد الحساب، أو إغلاقه، بحسب خطورة المخالفة وتكرارها.</p></div>
      <div class="scard"><h3 %(s4)s>يمكن الاعتراض</h3><p %(v4)s>يصل إشعار بالإجراء وسببه، ويمكن الاعتراض عليه من حالة الحساب.</p></div>
    </div>
  </div>
</section>
''' % dict(
    t1=t(u'أدوات التحكم', 'The controls'), tools=TOOLS,
    t2=t(u'لأولياء الأمور', 'For parents and guardians'),
    p2=t(u'الحد الأدنى لعمر الحساب ثلاثة عشر عامًا. إن كان ابنك أو ابنتك يستخدم التطبيق، هذه أهم أربعة إعدادات نوصي بمراجعتها معًا في خمس دقائق.',
         'The minimum account age is thirteen. If your child uses the app, these are the four settings we suggest going through together in five minutes.'),
    g1=t(u'اجعل الحساب خاصًا، فلا يرى المنشورات إلا من يوافق عليه',
         'Make the account private, so only approved people see the posts'),
    g2=t(u'اقصر الرسائل على المتابَعين فقط', 'Limit messages to people they follow'),
    g3=t(u'تأكد أن مشاركة الموقع مغلقة، وهي ممنوعة أصلًا دون الثامنة عشرة',
         'Check that location sharing is off, and note it is blocked under eighteen anyway'),
    g4=t(u'أضف كلمات مخفية لمنع التعليقات المسيئة قبل وصولها',
         'Add hidden words so abusive comments never arrive'),
    t3=t(u'إذا كان أحد في خطر', 'If someone is in danger'),
    n1=t(u'إن كان هناك خطر مباشر على حياة شخص، اتصل بخدمات الطوارئ في بلدك أولًا. نحن لسنا خدمة طوارئ ولا يمكننا التدخل الفوري.',
         'If there is an immediate risk to someone\'s life, contact the emergency services where you are first. We are not an emergency service and cannot intervene in real time.'),
    p3=t(u'بعد ذلك، أبلغ عن المحتوى من داخل التطبيق حتى نتمكن من مراجعته وحفظه. البلاغات المتعلقة بسلامة الأشخاص لها أولوية على غيرها.',
         'After that, report the content inside the app so we can review and preserve it. Reports involving someone\'s safety are prioritised over everything else.'),
    p4=t(u'المحتوى الذي يشجع على إيذاء النفس ممنوع. إن نشر شخص ما يوحي بأنه يمر بأزمة، أبلغ عن المقطع وتواصل معه إن استطعت.',
         'Content encouraging self harm is not allowed. If someone posts something suggesting they are in crisis, report the clip and reach out to them if you can.'),
    t4=t(u'ماذا يحدث بعد البلاغ', 'What happens after a report'),
    s1=t(u'يصل البلاغ', 'The report arrives'),
    v1=t(u'يدخل البلاغ قائمة المراجعة فورًا، ولا يعرف الطرف الآخر من أرسله.',
         'It enters the review queue immediately, and the other person is never told who sent it.'),
    s2=t(u'تتم المراجعة', 'It is reviewed'),
    v2=t(u'يراجع البلاغ شخص من الفريق مقابل إرشادات المجتمع. البلاغات الخطرة تُقدَّم على غيرها.',
         'A person on the team reviews it against the community guidelines. Serious reports jump the queue.'),
    s3=t(u'يُتخذ إجراء', 'Action is taken'),
    v3=t(u'حذف المحتوى، أو تقييد الحساب، أو إغلاقه، بحسب خطورة المخالفة وتكرارها.',
         'The content is removed, or the account is limited or closed, according to how serious and how repeated the violation is.'),
    s4=t(u'يمكن الاعتراض', 'It can be appealed'),
    v4=t(u'يصل إشعار بالإجراء وسببه، ويمكن الاعتراض عليه من حالة الحساب.',
         'A notice explains the action and why, and it can be appealed from Account status.'),
)

page('safety.html', u'مركز الأمان', 'Safety Centre',
     u'أدوات الأمان في Tenth Tone، ولأولياء الأمور، وماذا يحدث بعد البلاغ.',
     'Safety tools in Tenth Tone, guidance for parents, and what happens after a report.',
     SAFETY, here='safety.html')


# ====================================================================== HELP
def qa_group(title_ar, title_en, items, band=''):
    return u'''
<section class="band %(band)s">
  <div class="wrap">
    <h2 class="h2" %(t)s>%(tar)s</h2>
    <dl class="qa">
      %(items)s
    </dl>
  </div>
</section>
''' % dict(band=band, t=t(title_ar, title_en), tar=title_ar,
           items=u'\n      '.join(items))


HELP = head(u'مركز المساعدة', 'Help Centre',
            u'أجوبة مباشرة لأكثر ما يُسأل عنه. إن لم تجد ما تبحث عنه، تواصل معنا.',
            'Direct answers to the most common questions. If you cannot find yours, get in touch.')

HELP += qa_group(u'البداية', 'Getting started', [
    qa(u'كيف أنشئ حسابًا؟', 'How do I create an account?',
       u'افتح التطبيق واختر إنشاء حساب. أدخل بريدك وكلمة مرور، ثم أدخل الرمز المكوّن من ست خانات الذي يصلك بالبريد.',
       'Open the app and choose Create account. Enter your email and a password, then enter the six digit code sent to that address.'),
    qa(u'لم يصلني رمز التحقق.', 'The verification code did not arrive.',
       u'راجع مجلد البريد غير المرغوب فيه أولًا. الرمز صالح لفترة قصيرة، فإن انتهت اطلب رمزًا جديدًا من الشاشة نفسها.',
       'Check your spam folder first. The code is valid for a short period, so if it expired, request a new one from the same screen.'),
    qa(u'كيف أختار معرّف الحساب؟', 'How do I choose my handle?',
       u'المعرّف يبدأ بعلامة @ ويجب أن يكون فريدًا. يمكنك تغييره لاحقًا من تعديل الملف الشخصي.',
       'A handle starts with @ and must be unique. You can change it later from Edit profile.'),
    qa(u'هل يمكنني استخدام التطبيق دون تحميل؟', 'Can I use the app without installing it?',
       u'نعم. تطبيق الويب يعمل من المتصفح مباشرة، ويمكن تثبيته على الشاشة الرئيسية.',
       'Yes. The web app runs straight from the browser, and it can be installed to your home screen.'),
], band='band-warm')

HELP += qa_group(u'الحساب', 'Your account', [
    qa(u'نسيت كلمة المرور.', 'I forgot my password.',
       u'من شاشة الدخول اختر نسيت كلمة المرور. يصلك رمز من ست خانات، ثم تُدخل كلمة مرور جديدة.',
       'On the sign in screen choose Forgot password. A six digit code arrives, then you set a new password.'),
    qa(u'كيف أغيّر بريدي الإلكتروني؟', 'How do I change my email address?',
       u'الإعدادات ← الحساب ← تغيير البريد. نطلب كلمة مرورك أولًا، ثم نرسل رمز تأكيد إلى العنوان الجديد.',
       'Settings, Account, Change email. We ask for your password first, then send a confirmation code to the new address.'),
    qa(u'كيف أوقف حسابي مؤقتًا؟', 'How do I deactivate my account?',
       u'الإعدادات والخصوصية ← منطقة الخطر ← حالة الحساب ← إيقاف الحساب مؤقتًا. يختفي ملفك ومحتواك، ويعود كل شيء بمجرد تسجيل الدخول مرة أخرى.',
       'Settings &amp; Privacy, Danger zone, Account status, Deactivate account. Your profile and content disappear, and everything returns the moment you sign in again.'),
    qa_more(u'كيف أحذف حسابي نهائيًا؟', 'How do I delete my account permanently?',
            u'الإعدادات والخصوصية ← منطقة الخطر ← حالة الحساب ← حذف الحساب نهائيًا. أمامك ثلاثون يومًا للتراجع، وبعدها يُحذف كل شيء ولا يمكن استرجاعه.',
            'Settings &amp; Privacy, Danger zone, Account status, Delete account permanently. You have thirty days to change your mind, after which everything is removed and cannot be recovered.',
            'delete-account.html',
            u'وإن لم يكن التطبيق مثبّتًا لديك: كيف تحذف حسابك',
            'If you do not have the app installed: how to delete your account'),
    qa(u'كيف أحصل على نسخة من بياناتي؟', 'How do I get a copy of my data?',
       u'الإعدادات ← الأرشفة والتنزيل ← طلب نسخة. نجهّز الملف ونرسل إليك إشعارًا عندما يصبح جاهزًا.',
       'Settings, Archiving and downloading, Request a copy. We prepare the file and notify you when it is ready.'),
    qa(u'رأيت جهازًا لا أعرفه في سجل الدخول.', 'I saw a device I do not recognise.',
       u'أنهِ الجلسة من الإعدادات ← الأجهزة والدخول، ثم غيّر كلمة المرور فورًا.',
       'End that session in Settings, Devices and sign ins, then change your password immediately.'),
])

HELP += qa_group(u'المحتوى', 'Content', [
    qa(u'ما أقصى مدة للمقطع؟', 'How long can a clip be?',
       u'المقاطع القصيرة تصل إلى ثلاث دقائق. يُضغط الملف تلقائيًا قبل الرفع للحفاظ على سرعة التشغيل.',
       'Clips run up to three minutes. The file is compressed automatically before upload to keep playback fast.'),
    qa(u'رفعي يتوقف عند حد معيّن.', 'My upload stops at a limit.',
       u'هناك حد يومي لعدد المقاطع وحجمها للحفاظ على استقرار الخدمة. ينتهي الحد تلقائيًا بعد أربع وعشرين ساعة.',
       'There is a daily limit on the number and size of clips, to keep the service stable. It resets automatically after twenty four hours.'),
    qa(u'كيف أخفي مقطعًا دون حذفه؟', 'How do I hide a clip without deleting it?',
       u'من خيارات المقطع اختر أرشفة. يختفي عن الجميع ويبقى محفوظًا لك، ويمكنك إعادته متى شئت.',
       'From the clip options choose Archive. It disappears for everyone and stays saved for you, and you can bring it back whenever you like.'),
    qa(u'كيف أشير إلى شخص؟', 'How do I mention someone?',
       u'اكتب علامة @ متبوعة بمعرّفه داخل الوصف أو التعليق. يصله إشعار، ويصبح اسمه رابطًا لملفه.',
       'Type @ followed by their handle in a caption or comment. They get a notification, and their name becomes a link to their profile.'),
], band='band-warm')

HELP += qa_group(u'الخصوصية والأمان', 'Privacy and safety', [
    qa(u'كيف أجعل حسابي خاصًا؟', 'How do I make my account private?',
       u'الإعدادات ← الخصوصية ← حساب خاص. من يتابعك حاليًا يبقى، والطلبات الجديدة تنتظر موافقتك.',
       'Settings, Privacy, Private account. Current followers stay, and new requests wait for your approval.'),
    qa(u'ما الفرق بين الحظر والكتم والتقييد؟', 'What is the difference between block, mute and restrict?',
       u'الحظر يقطع كل شيء ويمنعه من رؤية حسابك. الكتم يخفي محتواه عنك فقط. التقييد يحدّ من ظهور تعليقاته دون أن يعرف.',
       'Blocking cuts everything and stops them seeing your account. Muting hides their content from you only. Restricting limits their comments without them knowing.'),
    qa(u'كيف أوقف مشاركة الموقع؟', 'How do I stop sharing my location?',
       u'الإعدادات ← أذونات الجهاز ← الموقع. وتنتهي المشاركة تلقائيًا بعد ثماني ساعات على أي حال.',
       'Settings, Device permissions, Location. It also expires by itself after eight hours in any case.'),
    qa(u'أبلغت عن محتوى ولم يُحذف.', 'I reported something and it was not removed.',
       u'ليس كل ما يزعجنا مخالفًا للإرشادات. إن كنت ترى أن المراجعة كانت خاطئة، أرسل بلاغًا من الإعدادات ← الإبلاغ عن مشكلة مع رابط المحتوى.',
       'Not everything that bothers us breaks the guidelines. If you think the review was wrong, send a report from Settings, Report a problem, with a link to the content.'),
])

HELP += u'''
<section class="band band-brand">
  <div class="wrap">
    <div class="dl-head">
      <h2 class="h2" %(t)s>لم تجد إجابتك؟</h2>
      <p class="lede" %(l)s>أسرع طريقة هي الإبلاغ من داخل التطبيق، فيصل البلاغ إلى الفريق مع تفاصيل جهازك.</p>
    </div>
    <div class="row-cta" style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
      <a class="btn" href="contact.html" %(b1)s>تواصل معنا</a>
      <a class="btn btn-ghost" href="safety.html" %(b2)s>مركز الأمان</a>
    </div>
  </div>
</section>
''' % dict(
    t=t(u'لم تجد إجابتك؟', 'Still stuck?'),
    l=t(u'أسرع طريقة هي الإبلاغ من داخل التطبيق، فيصل البلاغ إلى الفريق مع تفاصيل جهازك.',
        'The fastest route is Report a problem inside the app, which reaches the team with your device details attached.'),
    b1=t(u'تواصل معنا', 'Contact us'), b2=t(u'مركز الأمان', 'Safety centre'))

page('help.html', u'مركز المساعدة', 'Help Centre',
     u'أجوبة عن أكثر الأسئلة تكرارًا حول Tenth Tone.',
     'Answers to the most common questions about Tenth Tone.',
     HELP, here='help.html')


# =================================================================== CONTACT
CONTACT = head(u'تواصل معنا', 'Contact us',
               u'اختر القناة المناسبة حتى يصل طلبك إلى الشخص الصحيح من أول مرة.',
               'Pick the right channel so your message reaches the right person first time.') + u'''
<section class="band">
  <div class="wrap">
    <div class="hcards">
      %(cards)s
    </div>
    <div class="prose" style="max-width:64ch;margin-top:34px">
      <div class="note" %(n)s>أسرع طريق للدعم هو الإعدادات ← الإبلاغ عن مشكلة داخل التطبيق. يصل البلاغ مرتبطًا بحسابك وبنوع جهازك، فلا نحتاج إلى سؤالك عنهما.</div>
      <p %(p)s>نرد عادة خلال يومي عمل. البلاغات المتعلقة بسلامة شخص أو بسلامة طفل تُراجع أولًا وبأسرع ما يمكن.</p>
    </div>
  </div>
</section>
''' % dict(
    cards=u'\n      '.join([
        hcard(u'الدعم', 'Support',
              u'مشاكل الحساب، الرفع، الإشعارات، وأي عطل في التطبيق.',
              'Account problems, uploads, notifications, and anything broken in the app.', M_SUP),
        hcard(u'الخصوصية والبيانات', 'Privacy and data',
              u'طلب نسخة من بياناتك، أو حذفها، أو أي سؤال عن سياسة الخصوصية.',
              'Requesting a copy of your data, deleting it, or any question about the privacy policy.', M_PRIV),
        hcard(u'الشؤون القانونية', 'Legal',
              u'الشروط، حقوق النشر، والعلامات التجارية. لطلبات الجهات الرسمية راجع صفحتها المخصصة.',
              'Terms, copyright, and trademarks. For authority requests see the dedicated page.', M_LEGAL),
        hcard(u'الصحافة', 'Press',
              u'طلبات المقابلات والمواد الصحفية وشعار التطبيق.',
              'Interview requests, press materials, and the app logo.', M_PRESS),
        hcard(u'الأعمال والشراكات', 'Business and partnerships',
              u'الحملات داخل التطبيق والتعاون مع صنّاع المحتوى.',
              'In-app campaigns and creator collaborations.', M_BIZ),
        hcard(u'الإبلاغ عن محتوى', 'Reporting content',
              u'الأسرع دائمًا هو زر الإبلاغ داخل التطبيق، فهو يرفق المحتوى المبلّغ عنه تلقائيًا.',
              'The report button inside the app is always fastest, because it attaches the reported content automatically.',
              u'<a href="guidelines.html" style="text-decoration:underline" %s>%s</a>'
              % (t(u'اقرأ إرشادات المجتمع', 'Read the community guidelines'), u'اقرأ إرشادات المجتمع')),
    ]),
    n=t(u'أسرع طريق للدعم هو الإعدادات ← الإبلاغ عن مشكلة داخل التطبيق. يصل البلاغ مرتبطًا بحسابك وبنوع جهازك، فلا نحتاج إلى سؤالك عنهما.',
        'The fastest route to support is Settings, Report a problem, inside the app. It arrives linked to your account and device type, so we do not have to ask.'),
    p=t(u'نرد عادة خلال يومي عمل. البلاغات المتعلقة بسلامة شخص أو بسلامة طفل تُراجع أولًا وبأسرع ما يمكن.',
        'We usually reply within two working days. Reports involving someone\'s safety, or a child\'s safety, are reviewed first and as fast as we can.'))

page('contact.html', u'تواصل معنا', 'Contact us',
     u'قنوات التواصل مع فريق Tenth Tone.', 'How to reach the Tenth Tone team.',
     CONTACT, here='contact.html')


# ===================================================================== ABOUT
ABOUT = head(u'من نحن', 'About us',
             u'تطبيق فيديوهات قصيرة بُني للعربية من أول سطر، لا كترجمة لتطبيق آخر.',
             'A short video app built for Arabic from the first line, not translated from something else.') + u'''
<section class="band">
  <div class="wrap">
    <div class="row">
      <div class="row-copy">
        <h2 %(t1)s>لماذا بدأنا</h2>
        <p %(p1)s>معظم تطبيقات الفيديو القصير تُبنى بالإنجليزية أولًا ثم تُترجم. النتيجة واجهة لم تُصمَّم للعربية أصلًا، ونصوص تبدو غريبة، وميزات لا تناسب طريقة استخدام الناس هنا.</p>
        <p %(p2)s style="margin-top:14px">Tenth Tone بُني للعربية من البداية: بخط عربي مقروء، وبكلمات كُتبت بالعربية لا مترجمة إليها. والإنجليزية موجودة بالكامل أيضًا لمن يفضّلها.</p>
      </div>
      <div class="row-art">
        <figure class="shot" style="margin:0">
          <img src="assets/clip-5.jpg" alt="" loading="lazy" width="1200" height="960">
        </figure>
      </div>
    </div>
  </div>
</section>

<section class="band band-warm">
  <div class="wrap">
    <div class="dl-head">
      <h2 class="h2" %(t2)s>ما نؤمن به</h2>
    </div>
    <div class="s-grid">
      <div class="scard"><h3 %(b1)s>الإعداد يجب أن يعمل</h3><p %(v1)s>لا نضع زرًا لا يفعل شيئًا. كل مفتاح في الإعدادات له أثر حقيقي في التطبيق.</p></div>
      <div class="scard"><h3 %(b2)s>الانتشار للمحتوى لا للحساب</h3><p %(v2)s>الموجز يعرض المقطع الجيد سواء أتى من حساب عمره يوم أو ثلاث سنوات.</p></div>
      <div class="scard"><h3 %(b3)s>أقل بيانات ممكنة</h3><p %(v3)s>لا نجمع ما لا نحتاجه. الموقع ينتهي وحده، ولا نحتفظ بسجل تحركاتك.</p></div>
      <div class="scard"><h3 %(b4)s>القرار قابل للتراجع</h3><p %(v4)s>الأرشفة بدل الحذف، وثلاثون يومًا قبل حذف الحساب، واعتراض على كل إجراء.</p></div>
    </div>
  </div>
</section>

<section class="band">
  <div class="wrap">
    <div class="prose" style="max-width:66ch">
      <h2 %(t3)s>كيف نكسب</h2>
      <p %(p3)s>التطبيق مجاني ولا يوجد اشتراك مدفوع. قد نعرض حملات مموّلة داخل الموجز، وتظهر دائمًا بعلامة واضحة تميّزها عن المحتوى العادي.</p>
      <p %(p4)s>لا نبيع بياناتك الشخصية ولا نشاركها مع وسطاء بيانات. التفاصيل في <a href="privacy.html">سياسة الخصوصية</a>.</p>

      <h2 %(t4)s>أين نحن الآن</h2>
      <p %(p5)s>التطبيق في مرحلة الإطلاق. الميزات الأساسية جاهزة: الموجز، التصوير والنشر، الرسائل، الملفات الشخصية، وأدوات الأمان. البث المباشر والخريطة يخرجان تباعًا.</p>
      <p %(p6)s>إن وجدت عطلًا أو نقصًا، أخبرنا من <a href="contact.html">صفحة التواصل</a> أو من داخل التطبيق. نقرأ كل بلاغ.</p>
    </div>
  </div>
</section>
''' % dict(
    t1=t(u'لماذا بدأنا', 'Why we started'),
    p1=t(u'معظم تطبيقات الفيديو القصير تُبنى بالإنجليزية أولًا ثم تُترجم. النتيجة واجهة لم تُصمَّم للعربية أصلًا، ونصوص تبدو غريبة، وميزات لا تناسب طريقة استخدام الناس هنا.',
         'Most short video apps are built in English first and translated afterwards. The result is a layout that was never meant for Arabic, text that reads oddly, and features that do not match how people here actually use them.'),
    p2=t(u'Tenth Tone بُني للعربية من البداية: بخط عربي مقروء، وبكلمات كُتبت بالعربية لا مترجمة إليها. والإنجليزية موجودة بالكامل أيضًا لمن يفضّلها.',
         'Tenth Tone was built for Arabic from the start: a readable Arabic typeface, and words written in Arabic rather than translated into it. English is fully present too, for anyone who prefers it.'),
    t2=t(u'ما نؤمن به', 'What we believe'),
    b1=t(u'الإعداد يجب أن يعمل', 'A setting has to do something'),
    v1=t(u'لا نضع زرًا لا يفعل شيئًا. كل مفتاح في الإعدادات له أثر حقيقي في التطبيق.',
         'We do not ship a switch that does nothing. Every toggle in Settings has a real effect in the app.'),
    b2=t(u'الانتشار للمحتوى لا للحساب', 'Reach belongs to the clip, not the account'),
    v2=t(u'الموجز يعرض المقطع الجيد سواء أتى من حساب عمره يوم أو ثلاث سنوات.',
         'The feed shows a good clip whether it came from an account one day old or three years old.'),
    b3=t(u'أقل بيانات ممكنة', 'As little data as possible'),
    v3=t(u'لا نجمع ما لا نحتاجه. الموقع ينتهي وحده، ولا نحتفظ بسجل تحركاتك.',
         'We do not collect what we do not need. Location expires by itself, and we keep no movement history.'),
    b4=t(u'القرار قابل للتراجع', 'Decisions should be reversible'),
    v4=t(u'الأرشفة بدل الحذف، وثلاثون يومًا قبل حذف الحساب، واعتراض على كل إجراء.',
         'Archive instead of delete, thirty days before an account is removed, and an appeal on every action.'),
    t3=t(u'كيف نكسب', 'How we make money'),
    p3=t(u'التطبيق مجاني ولا يوجد اشتراك مدفوع. قد نعرض حملات مموّلة داخل الموجز، وتظهر دائمًا بعلامة واضحة تميّزها عن المحتوى العادي.',
         'The app is free and there is no paid subscription. We may show sponsored campaigns in the feed, and they always carry a clear label that separates them from ordinary content.'),
    p4=t(u'لا نبيع بياناتك الشخصية ولا نشاركها مع وسطاء بيانات. التفاصيل في سياسة الخصوصية.',
         'We do not sell your personal data and we do not share it with data brokers. The details are in the privacy policy.'),
    t4=t(u'أين نحن الآن', 'Where we are now'),
    p5=t(u'التطبيق في مرحلة الإطلاق. الميزات الأساسية جاهزة: الموجز، التصوير والنشر، الرسائل، الملفات الشخصية، وأدوات الأمان. البث المباشر والخريطة يخرجان تباعًا.',
         'The app is at launch stage. The core is ready: the feed, recording and posting, messages, profiles, and the safety tools. Live streaming and the map are rolling out next.'),
    p6=t(u'إن وجدت عطلًا أو نقصًا، أخبرنا من صفحة التواصل أو من داخل التطبيق. نقرأ كل بلاغ.',
         'If you find something broken or missing, tell us from the contact page or inside the app. We read every report.'))

page('about.html', u'من نحن', 'About us',
     u'لماذا بُني Tenth Tone، وما نؤمن به، وأين نحن الآن.',
     'Why Tenth Tone was built, what we believe, and where we are now.',
     ABOUT, here='about.html')

print('support pages done')
