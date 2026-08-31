# -*- coding: utf-8 -*-
"""The account deletion page.

Google Play requires a URL where somebody can ask for their account to be
deleted *without* installing the app or signing in, and it is a required field
in the Data Safety form. Apple expects deletion to be easy to find too. Prose
scattered across the privacy policy does not satisfy either of them, so this is
a page of its own at /delete-account.html.

Everything factual here was read out of the code rather than assumed:

  * the in-app path            web/js/views.js  V.settings -> V.accountStatus
  * the English button labels  web/js/i18n.js
  * the thirty day grace       supabase/migrations/0034_account_status.sql
                               (schedule_account_deletion: now() + 30 days)
  * the nightly purge at 03:30 supabase/migrations/0051_enable_scheduled_jobs.sql
  * what actually disappears   the on delete cascade / set null foreign keys
                               in 0001_init.sql, 0023, 0033

The retention wording is deliberately the same as the table in p_privacy.py.
If one of them changes, change both, or the two pages start contradicting each
other and that is worse than either one being vague.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from docs import doc

MAIL_P = 'privacy@flyp-sa.com'
MAIL_S = 'support@flyp-sa.com'

# Identified the way p_privacy.py does it. There is deliberately no postal
# address: the commercial registration does not carry one and nobody has
# supplied it, and an invented address in a legal page is worse than none.
CO_AR = u'شركة فلايب، شركة ذات مسؤولية محدودة في المملكة العربية السعودية، الرقم الوطني الموحد 7054999391'
CO_EN = ('FLYP Company, a limited liability company in the Kingdom of Saudi Arabia, '
         'Unified National Number 7054999391')


AR = [

('summary', u'باختصار', u'''
      <p>هناك طريقتان لحذف حسابك، وكلتاهما تنتهيان بالحذف النهائي نفسه:</p>
      <ul>
        <li><strong>من داخل التطبيق:</strong> الإعدادات والخصوصية ← منطقة الخطر ← حالة الحساب ← حذف الحساب نهائيًا.</li>
        <li><strong>من دون التطبيق:</strong> راسلنا على <strong>%(mp)s</strong> من البريد الإلكتروني المسجّل في حسابك.</li>
      </ul>
      <div class="note">لست مضطرًا إلى تثبيت التطبيق أو تسجيل الدخول لطلب حذف حسابك. رسالة بريد واحدة تكفي.</div>
''' % dict(mp=MAIL_P)),

('in-app', u'الحذف من داخل التطبيق', u'''
      <p>إن كان التطبيق مثبّتًا لديك وتستطيع الدخول إلى حسابك، فهذه أسرع طريقة:</p>
      <ol>
        <li>افتح التطبيق وسجّل الدخول.</li>
        <li>افتح ملفك الشخصي، ثم اضغط أيقونة الإعدادات في أعلى الشاشة.</li>
        <li>في شاشة <strong>الإعدادات والخصوصية</strong>، انزل إلى قسم <strong>منطقة الخطر</strong>.</li>
        <li>اختر <strong>حالة الحساب</strong>.</li>
        <li>اختر <strong>حذف الحساب نهائيًا</strong>، ثم اضغط <strong>متابعة الحذف</strong>.</li>
        <li>اقرأ التحذير، ثم اكتب كلمة <strong>حذف</strong> في خانة التأكيد.</li>
        <li>اضغط <strong>حذف حسابي</strong>.</li>
      </ol>
      <p>يختفي حسابك عن الجميع في الحال، وتبدأ مهلة الثلاثين يومًا.</p>
'''),

('by-email', u'الحذف من دون تثبيت التطبيق', u'''
      <p>إن حذفت التطبيق، أو لم تعد تريد تثبيته، أو لم تعد تستطيع الدخول إلى حسابك، فاطلب الحذف بالبريد الإلكتروني.</p>

      <h3>راسلنا على %(mp)s</h3>
      <p>أرسل الرسالة <strong>من العنوان نفسه المسجّل في الحساب</strong>. هذه هي طريقتنا في التأكد أن الطلب صادر منك أنت، ولهذا لا نحتاج إلى كلمة مرورك.</p>

      <h3>ما الذي تكتبه في الرسالة</h3>
      <ul>
        <li>الموضوع: <strong>حذف حساب</strong>.</li>
        <li>معرّف حسابك الذي يبدأ بعلامة @، إن كنت تذكره.</li>
        <li>جملة صريحة بأنك تطلب حذف حسابك نهائيًا.</li>
      </ul>
      <div class="note">لا ترسل كلمة مرورك في البريد. لن نطلبها منك أبدًا، ولا نحتاجها لتنفيذ الطلب.</div>

      <h3>متى نرد ومتى ننفّذ</h3>
      <p>نرد خلال <strong>يومي عمل</strong> لتأكيد استلام الطلب، وننفّذه خلال <strong>ثلاثين يومًا</strong> كحد أقصى. إن لم نستطع مطابقة العنوان الذي راسلتنا منه بأي حساب، فقد نطلب إثباتًا بسيطًا لهويتك، حتى لا يحذف أحد حسابك نيابة عنك.</p>
      <p>عند تنفيذ الطلب تبدأ مهلة الثلاثين يومًا نفسها التي تبدأ عند الحذف من داخل التطبيق.</p>
''' % dict(mp=MAIL_P)),

('grace', u'مهلة الثلاثين يومًا', u'''
      <p>الحذف لا يقع في اللحظة نفسها. بمجرد تقديم الطلب:</p>
      <ul>
        <li>يختفي ملفك الشخصي ومقاطعك وتعليقاتك عن الجميع <strong>فورًا</strong>.</li>
        <li>تتوقف مشاركة الموقع وتُمحى إحداثياتك <strong>فورًا</strong>.</li>
        <li>يُحذف الحساب وكل ما فيه حذفًا نهائيًا بعد <strong>ثلاثين يومًا</strong>.</li>
      </ul>

      <h3>إن غيّرت رأيك</h3>
      <p>سجّل الدخول في أي وقت خلال الثلاثين يومًا، وافتح الإعدادات والخصوصية ← منطقة الخطر ← حالة الحساب. ستجد الأيام المتبقية وزرًا مكتوبًا عليه <strong>إلغاء الحذف والاحتفاظ بحسابي</strong>. اضغطه ويعود كل شيء كما كان.</p>
      <p>وإن كنت قد طلبت الحذف بالبريد، فراسلنا على العنوان نفسه خلال المهلة ونلغي الطلب.</p>

      <div class="note">تعمل عملية الحذف مرة واحدة كل ليلة، فقد يمضي بضع ساعات إضافية بعد انقضاء الثلاثين يومًا. بعد تنفيذها لا يمكن استرجاع الحساب ولا أي شيء كان فيه، ولا نملك نحن أنفسنا وسيلة لاستعادته.</div>
'''),

('deleted', u'ما الذي يُحذف', u'''
      <p>يُحذف كل ما يخصك، لا أن يُخفى فقط:</p>
      <ul>
        <li>الحساب وتسجيل الدخول نفسه، ويعود بريدك متاحًا للتسجيل من جديد إن أردت.</li>
        <li>ملفك الشخصي: الاسم، والمعرّف، والصورة، والنبذة، والروابط.</li>
        <li>كل مقاطعك بأوصافها ووسومها، بما فيها المؤرشفة والمسودات.</li>
        <li>تعليقاتك وإعجاباتك وما حفظته.</li>
        <li>رسائلك ومحادثاتك. وتختفي رسائلك أيضًا من محادثات من راسلتهم.</li>
        <li>متابعوك ومن تتابعهم، وقوائم الحظر والكتم والتقييد.</li>
        <li>إعداداتك، وسجل ما شاهدته الذي يبني عليه الموجز توصياته.</li>
        <li>بيانات موقعك، إن كنت قد فعّلت مشاركة الموقع يومًا.</li>
      </ul>
      <p>ويتحرر معرّفك الذي يبدأ بعلامة @، فقد يسجّله شخص آخر بعد ذلك.</p>
'''),

('kept', u'ما الذي يبقى، ولماذا', u'''
      <p>يبقى القليل، ولكل منه سبب:</p>
      <ul>
        <li><strong>بلاغات الدعم:</strong> ما أرسلته إلى الدعم يبقى حتى سنة بعد إغلاق البلاغ، من دون ارتباط بحسابك.</li>
        <li><strong>بلاغاتك عن آخرين:</strong> إن أبلغت عن محتوى أو شخص، يبقى البلاغ لدى فريق المراجعة من دون اسمك، لأن حذفه قد يعني إفلات مخالفة.</li>
        <li><strong>الأصوات الأصلية:</strong> إن استخدم آخرون صوتًا من أحد مقاطعك، يبقى الصوت في مقاطعهم غير منسوب إليك.</li>
        <li><strong>سجلات الدخول:</strong> حتى تسعين يومًا لأغراض الأمان.</li>
        <li><strong>النسخ الاحتياطية:</strong> تُستبدل دوريًا، وقد يبقى المحتوى المحذوف فيها مدة قصيرة.</li>
        <li><strong>ما يلزمنا القانون بحفظه:</strong> نحتفظ به للمدة المطلوبة فقط، لا أكثر.</li>
      </ul>
      <p>هذه المدد هي نفسها المذكورة في جدول الاحتفاظ بالبيانات في <a href="privacy.html">سياسة الخصوصية</a>.</p>
'''),

('copy', u'احصل على نسخة من بياناتك أولًا', u'''
      <p>بعد حذف الحساب لا يبقى ما يمكن تنزيله. فإن أردت الاحتفاظ بمقاطعك أو ببياناتك، اطلب نسخة <strong>قبل</strong> تقديم طلب الحذف.</p>
      <p>الإعدادات والخصوصية ← الأرشفة والتنزيل ← طلب نسخة من بياناتي. نجهّز ملفًا يحتوي على منشوراتك وتعليقاتك وبيانات حسابك، ونخبرك عندما يصبح جاهزًا.</p>
'''),

('pause', u'إن كنت تريد استراحة لا حذفًا', u'''
      <p>الحذف قرار لا رجعة فيه. وإن كان ما تريده هو الاختفاء مؤقتًا فقط، فهناك خيار أنسب في الشاشة نفسها: <strong>إيقاف الحساب مؤقتًا</strong>.</p>
      <ul>
        <li>يختفي ملفك الشخصي ومقاطعك وتعليقاتك عن الجميع.</li>
        <li>لا يُحذف أي شيء.</li>
        <li>يعود حسابك بتسجيل الدخول مرة أخرى.</li>
      </ul>
      <p>تجده في: الإعدادات والخصوصية ← منطقة الخطر ← حالة الحساب ← إيقاف الحساب مؤقتًا.</p>
'''),

('who', u'إلى من يصل طلبك', u'''
      <p>يصل الطلب إلى %(co)s، وهي الجهة المسؤولة عن بياناتك الشخصية في هذا التطبيق.</p>
      <p>لطلبات الحذف وأسئلة الخصوصية: <strong>%(mp)s</strong><br>ولأي شيء آخر: <strong>%(ms)s</strong> أو <a href="contact.html">صفحة التواصل</a>.</p>
''' % dict(co=CO_AR, mp=MAIL_P, ms=MAIL_S)),

]


EN = [

('summary', 'In short', '''
      <p>There are two ways to delete your account, and both end in the same permanent deletion:</p>
      <ul>
        <li><strong>Inside the app:</strong> Settings &amp; Privacy, then Danger zone, then Account status, then Delete account permanently.</li>
        <li><strong>Without the app:</strong> write to <strong>%(mp)s</strong> from the email address registered on your account.</li>
      </ul>
      <div class="note">You do not have to install the app or sign in to ask for your account to be deleted. One email is enough.</div>
''' % dict(mp=MAIL_P)),

('in-app', 'Deleting from inside the app', '''
      <p>If you have the app and can still sign in, this is the fastest route:</p>
      <ol>
        <li>Open the app and sign in.</li>
        <li>Open your own profile, then tap the settings icon at the top of the screen.</li>
        <li>On the <strong>Settings &amp; Privacy</strong> screen, scroll down to the <strong>Danger zone</strong> section.</li>
        <li>Choose <strong>Account status</strong>.</li>
        <li>Choose <strong>Delete account permanently</strong>, then tap <strong>Continue</strong>.</li>
        <li>Read the warning, then type the word <strong>delete</strong> in the confirmation box.</li>
        <li>Tap <strong>Delete my account</strong>.</li>
      </ol>
      <p>Your account disappears for everyone straight away, and the thirty days begin.</p>
'''),

('by-email', 'Requesting deletion without installing the app', '''
      <p>If you have removed the app, do not want to install it, or can no longer sign in, ask us by email instead.</p>

      <h3>Write to %(mp)s</h3>
      <p>Send the message <strong>from the same address registered on the account</strong>. That is how we know the request is really yours, which is why we never need your password.</p>

      <h3>What to put in the message</h3>
      <ul>
        <li>Subject: <strong>Delete account</strong>.</li>
        <li>Your @handle, if you remember it.</li>
        <li>A plain sentence saying you want the account deleted permanently.</li>
      </ul>
      <div class="note">Never send your password by email. We will never ask for it, and we do not need it to carry out the request.</div>

      <h3>When we reply, and when we act</h3>
      <p>We reply within <strong>two working days</strong> to confirm we have the request, and carry it out within <strong>thirty days</strong> at the latest. If we cannot match the address you wrote from to an account, we may ask for simple proof of identity, so that nobody can delete your account on your behalf.</p>
      <p>Once we act on it, the same thirty day period begins as if you had deleted the account from inside the app.</p>
''' % dict(mp=MAIL_P)),

('grace', 'The thirty day grace period', '''
      <p>Deletion does not happen the same instant. As soon as the request is made:</p>
      <ul>
        <li>Your profile, clips and comments disappear for everyone <strong>immediately</strong>.</li>
        <li>Location sharing stops and your coordinates are erased <strong>immediately</strong>.</li>
        <li>The account and everything in it is permanently deleted after <strong>thirty days</strong>.</li>
      </ul>

      <h3>If you change your mind</h3>
      <p>Sign in at any point during the thirty days and open Settings &amp; Privacy, then Danger zone, then Account status. You will see the days remaining and a button reading <strong>Cancel deletion and keep my account</strong>. Press it and everything comes back.</p>
      <p>If you asked by email, write to the same address within the period and we will cancel it.</p>

      <div class="note">The deletion job runs once a night, so a few extra hours may pass after the thirty days are up. Once it has run, neither you nor we can bring the account or anything in it back.</div>
'''),

('deleted', 'What gets deleted', '''
      <p>Everything of yours is removed, not merely hidden:</p>
      <ul>
        <li>The account and the sign in itself. Your email address becomes free to register again if you ever want to.</li>
        <li>Your profile: name, handle, photo, bio and links.</li>
        <li>All your clips with their captions and tags, including archived ones and drafts.</li>
        <li>Your comments, likes and saved items.</li>
        <li>Your messages and conversations. Your messages also disappear from the chats of the people you sent them to.</li>
        <li>Your followers and the people you follow, and your block, mute and restrict lists.</li>
        <li>Your settings, and the watch history the feed uses to make recommendations.</li>
        <li>Your location data, if you ever turned location sharing on.</li>
      </ul>
      <p>Your @handle is released as well, so somebody else may register it afterwards.</p>
'''),

('kept', 'What is kept, and why', '''
      <p>A little is kept, and each has a reason:</p>
      <ul>
        <li><strong>Support reports:</strong> what you sent to support is kept for up to a year after the report is closed, no longer linked to your account.</li>
        <li><strong>Reports you made about other people:</strong> if you reported content or a person, the report stays with the review team without your name, because removing it could let a breach go unanswered.</li>
        <li><strong>Original sounds:</strong> if other people used a sound from one of your clips, the sound stays in their clips, no longer attributed to you.</li>
        <li><strong>Sign in logs:</strong> up to ninety days, for security.</li>
        <li><strong>Backups:</strong> rotated regularly. Deleted content may persist in them for a short period.</li>
        <li><strong>Anything the law requires us to keep:</strong> held for the required period only, and no longer.</li>
      </ul>
      <p>These are the same periods as the retention table in the <a href="privacy.html">privacy policy</a>.</p>
'''),

('copy', 'Get a copy of your data first', '''
      <p>Once the account is gone there is nothing left to download. So if you want to keep your clips or your data, ask for a copy <strong>before</strong> you make the deletion request.</p>
      <p>Settings &amp; Privacy, then Archiving and downloading, then Request a copy of my data. We prepare a file containing your posts, comments and account details, and tell you when it is ready.</p>
'''),

('pause', 'If you want a break rather than an ending', '''
      <p>Deletion cannot be undone. If what you actually want is to disappear for a while, there is a better option on the same screen: <strong>Deactivate account</strong>.</p>
      <ul>
        <li>Your profile, clips and comments disappear for everyone.</li>
        <li>Nothing is deleted.</li>
        <li>Your account comes back when you sign in again.</li>
      </ul>
      <p>You will find it at: Settings &amp; Privacy, then Danger zone, then Account status, then Deactivate account.</p>
'''),

('who', 'Who your request goes to', '''
      <p>The request reaches %(co)s, which is the controller of your personal data in this app.</p>
      <p>For deletion requests and privacy questions: <strong>%(mp)s</strong><br>For anything else: <strong>%(ms)s</strong> or the <a href="contact.html">contact page</a>.</p>
''' % dict(co=CO_EN, mp=MAIL_P, ms=MAIL_S)),

]


doc('delete-account.html',
    u'حذف حسابك', 'Delete your account',
    u'يمكنك حذف حسابك نهائيًا من داخل التطبيق، أو بمراسلتنا من دون تثبيته. هذه الصفحة تشرح الطريقتين وما الذي يُحذف فعلًا.',
    'You can delete your account permanently from inside the app, or by writing to us without installing it. '
    'This page explains both routes and what actually gets removed.',
    u'كيف تحذف حسابك نهائيًا، من داخل التطبيق أو بطلب بالبريد الإلكتروني من دون تثبيته.',
    'How to delete your account permanently, from inside the app or by email without installing it.',
    AR, EN)

print('delete account page done')
