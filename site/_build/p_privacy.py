# -*- coding: utf-8 -*-
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from docs import doc

F = u'<span class="fill">%s</span>'
CO_AR = F % u'[الاسم القانوني للشركة]'
CO_EN = F % '[COMPANY LEGAL NAME]'
ADDR_AR = F % u'[العنوان المسجل]'
ADDR_EN = F % '[REGISTERED ADDRESS]'
LAW_AR = F % u'[الدولة]'
LAW_EN = F % '[COUNTRY]'
MAIL_P = 'privacy@flyp-sa.com'
MAIL_S = 'support@flyp-sa.com'

AR = [

('who', u'من نحن', u'''
      <p>تطبيق FLYP تديره %(co)s، ومقرها %(addr)s. عندما تستخدم التطبيق فإن الشركة هي المسؤولة عن بياناتك الشخصية، أي أنها من يقرر لماذا تُجمع وكيف تُستخدم.</p>
      <p>هذه الصفحة تشرح ما نجمعه، ولماذا، وكم نحتفظ به، وما الذي يمكنك فعله حيال ذلك. كُتبت بلغة واضحة عن قصد.</p>
''' % dict(co=CO_AR, addr=ADDR_AR)),

('collect', u'ما الذي نجمعه', u'''
      <h3>بيانات تقدّمها أنت</h3>
      <ul>
        <li><strong>بيانات الحساب:</strong> البريد الإلكتروني، كلمة مرور مشفّرة، اسم العرض، المعرّف الذي يبدأ بعلامة @، وتاريخ الميلاد.</li>
        <li><strong>الملف الشخصي:</strong> الصورة الشخصية، النبذة، والرابط الذي تضيفه إن أضفت واحدًا.</li>
        <li><strong>المحتوى:</strong> المقاطع التي ترفعها، الأوصاف، الوسوم، التعليقات، والرسائل التي ترسلها.</li>
        <li><strong>البث المباشر:</strong> الصوت والصورة أثناء البث، وتعليقات المشاهدين.</li>
        <li><strong>بلاغات الدعم:</strong> ما تكتبه عند الإبلاغ عن مشكلة، ونوع جهازك إن اخترت إرساله.</li>
      </ul>

      <h3>بيانات تُجمع تلقائيًا</h3>
      <ul>
        <li><strong>الاستخدام:</strong> ما تشاهده، ما تتخطاه، ما تعجب به أو تحفظه، ومن تتابعه. هذه هي المادة التي يبني عليها الموجز توصياته.</li>
        <li><strong>الجهاز والجلسة:</strong> نوع الجهاز ونظام التشغيل، ونسخة التطبيق، وعنوان IP، وتواريخ الدخول. تُستخدم لتشغيل الخدمة وكشف الدخول غير المعتاد.</li>
        <li><strong>ملفات تعريف الارتباط والتخزين المحلي:</strong> نستخدم تخزين المتصفح لإبقائك مسجّلًا للدخول ولحفظ تفضيلات مثل اللغة. لا نستخدم ملفات تتبع إعلانية من أطراف أخرى.</li>
      </ul>

      <h3>بيانات تشاركها باختيارك</h3>
      <ul>
        <li><strong>الموقع:</strong> لا يُجمع إلا عند تفعيل مشاركة الموقع يدويًا، ويقتصر على من أتمّ الثامنة عشرة. تنتهي المشاركة تلقائيًا بعد ثماني ساعات.</li>
        <li><strong>جهات الاتصال أو معرض الصور:</strong> يُقرأ فقط عند فتحك للكاميرا أو المعرض لاختيار مقطع، ولا نرفع شيئًا دون اختيارك له.</li>
      </ul>
'''),

('use', u'لماذا نستخدمها', u'''
      <div class="table-wrap">
      <table>
        <thead><tr><th>الغرض</th><th>ما نستخدمه</th></tr></thead>
        <tbody>
          <tr><td>تشغيل حسابك وتسجيل دخولك</td><td>البريد، كلمة المرور المشفّرة، بيانات الجلسة</td></tr>
          <tr><td>عرض المقاطع وترتيب الموجز</td><td>سجل المشاهدة، الإعجابات، المتابعات</td></tr>
          <tr><td>إيصال الإشعارات والرسائل</td><td>بيانات الحساب، محتوى الرسالة</td></tr>
          <tr><td>حماية المنصة ومراجعة البلاغات</td><td>المحتوى المبلّغ عنه، بيانات الجهاز، سجلات الدخول</td></tr>
          <tr><td>الالتزام بالقانون والرد على الطلبات الرسمية</td><td>ما يطلبه القانون تحديدًا لا أكثر</td></tr>
          <tr><td>تحسين التطبيق وإصلاح الأعطال</td><td>تقارير الأعطال وإحصاءات مجمّعة</td></tr>
        </tbody>
      </table>
      </div>
      <p>لا نبيع بياناتك الشخصية، ولا نشاركها مع وسطاء بيانات.</p>
'''),

('basis', u'الأساس القانوني', u'''
      <p>في الدول التي تطبّق قوانين حماية بيانات مثل اللائحة الأوروبية العامة، نعتمد على الأسس التالية:</p>
      <ul>
        <li><strong>تنفيذ العقد:</strong> ما لا يمكن تشغيل الخدمة بدونه، مثل حسابك ومحتواك ورسائلك.</li>
        <li><strong>المصلحة المشروعة:</strong> حماية المنصة من إساءة الاستخدام، ومنع الاحتيال، وتحسين المنتج.</li>
        <li><strong>الموافقة:</strong> مشاركة الموقع، والإشعارات على بعض الأنظمة. يمكنك سحب الموافقة في أي وقت من الإعدادات.</li>
        <li><strong>الالتزام القانوني:</strong> الاحتفاظ ببعض السجلات أو الرد على طلب قضائي صحيح.</li>
      </ul>
'''),

('share', u'مع من نشاركها', u'''
      <p>نشارك أقل قدر ممكن، ومع الجهات التالية فقط:</p>
      <ul>
        <li><strong>مزوّدو الخدمة التقنية:</strong> استضافة قاعدة البيانات والملفات، وإرسال البريد، وخدمة البث المباشر. يعملون بموجب عقود تلزمهم بحماية البيانات واستخدامها لخدمتنا فقط.</li>
        <li><strong>المستخدمون الآخرون:</strong> ما تنشره علنًا يراه الآخرون. إن كان حسابك خاصًا فلا يراه إلا من وافقت على متابعته لك.</li>
        <li><strong>الجهات الرسمية:</strong> عند تلقي طلب قانوني صحيح، أو عند وجود خطر وشيك على حياة شخص. تفاصيل ذلك في <a href="law-enforcement.html">صفحة طلبات الجهات الرسمية</a>.</li>
        <li><strong>في حال بيع الشركة أو اندماجها:</strong> قد تنتقل البيانات إلى المالك الجديد، وسنخبرك قبل حدوث ذلك.</li>
      </ul>
'''),

('location', u'الموقع بالتفصيل', u'''
      <p>مشاركة الموقع ميزة اختيارية بالكامل، ومغلقة افتراضيًا.</p>
      <ul>
        <li>متاحة فقط لمن أتمّ الثامنة عشرة، ويُتحقق من ذلك من تاريخ الميلاد المسجّل عند إنشاء الحساب.</li>
        <li>تنتهي المشاركة تلقائيًا بعد <strong>ثماني ساعات</strong> دون أي إجراء منك.</li>
        <li>عند الانتهاء تُمحى الإحداثيات من السجل، ولا يبقى منها أثر.</li>
        <li>تُحذف السجلات المنتهية نهائيًا خلال <strong>سبعة أيام</strong>.</li>
        <li>لا نحتفظ بسجل تاريخي لتحركاتك، ولا نبني منه ملفًا عنك.</li>
        <li>من حظرته لا يرى موقعك مهما كانت إعداداتك.</li>
      </ul>
'''),

('keep', u'كم نحتفظ بها', u'''
      <div class="table-wrap">
      <table>
        <thead><tr><th>النوع</th><th>المدة</th></tr></thead>
        <tbody>
          <tr><td>الحساب والمحتوى المنشور</td><td>حتى تحذفه أنت أو تحذف حسابك</td></tr>
          <tr><td>الحساب بعد طلب الحذف</td><td>ثلاثون يومًا يمكنك التراجع خلالها، ثم يُحذف نهائيًا</td></tr>
          <tr><td>الموقع</td><td>ثماني ساعات نشطة، ثم حذف نهائي خلال سبعة أيام</td></tr>
          <tr><td>سجلات الدخول</td><td>حتى تسعين يومًا لأغراض الأمان</td></tr>
          <tr><td>بلاغات الدعم</td><td>حتى سنة بعد إغلاق البلاغ</td></tr>
          <tr><td>النسخ الاحتياطية</td><td>تُستبدل دوريًا، وقد يبقى المحتوى المحذوف فيها مدة قصيرة</td></tr>
        </tbody>
      </table>
      </div>
'''),

('rights', u'حقوقك', u'''
      <p>يمكنك ممارسة أغلب هذه الحقوق من داخل التطبيق مباشرة:</p>
      <ul>
        <li><strong>الاطلاع:</strong> ملفك الشخصي ومحتواك ورسائلك ظاهرة لك في التطبيق.</li>
        <li><strong>الحصول على نسخة:</strong> الإعدادات ← الأرشفة والتنزيل ← طلب نسخة من بياناتك.</li>
        <li><strong>التصحيح:</strong> الإعدادات ← تعديل الملف الشخصي.</li>
        <li><strong>الحذف:</strong> الإعدادات ← الحساب ← حذف الحساب. مهلة ثلاثين يومًا للتراجع.</li>
        <li><strong>الإيقاف المؤقت:</strong> الإعدادات ← الحساب ← إيقاف الحساب مؤقتًا، ويعود بمجرد تسجيل الدخول.</li>
        <li><strong>سحب الموافقة:</strong> أطفئ مشاركة الموقع أو الإشعارات من الإعدادات.</li>
        <li><strong>الاعتراض والشكوى:</strong> راسلنا على %(mp)s. ولك أيضًا حق تقديم شكوى إلى الجهة المختصة بحماية البيانات في بلدك.</li>
      </ul>
      <div class="note">نرد على طلبات البيانات خلال ثلاثين يومًا. قد نطلب إثباتًا بسيطًا لهويتك قبل تنفيذ طلب حذف أو تصدير، حتى لا ينفّذه شخص آخر نيابة عنك.</div>
''' % dict(mp=MAIL_P)),

('children', u'الأطفال', u'''
      <p>الحد الأدنى لاستخدام FLYP هو <strong>ثلاثة عشر عامًا</strong>. نطلب تاريخ الميلاد عند إنشاء الحساب، ولا يمكن تعديله لاحقًا.</p>
      <ul>
        <li>مشاركة الموقع مغلقة تمامًا لمن هم دون الثامنة عشرة.</li>
        <li>إن علمنا بحساب لطفل دون الثالثة عشرة فسنغلقه ونحذف بياناته.</li>
        <li>إن كنت وليّ أمر وتعتقد أن طفلك أنشأ حسابًا، راسلنا على %(mp)s وسنتعامل مع الطلب بسرعة.</li>
      </ul>
''' % dict(mp=MAIL_P)),

('security', u'الأمان', u'''
      <ul>
        <li>كلمات المرور تُخزّن مشفّرة بطريقة لا تسمح لنا بقراءتها.</li>
        <li>الاتصال بالتطبيق مشفّر بالكامل أثناء النقل.</li>
        <li>الوصول إلى بيانات المستخدمين محصور بعدد محدود من الموظفين وبقدر ما تتطلبه المهمة.</li>
        <li>يمكنك مراجعة الأجهزة التي دخلت إلى حسابك من الإعدادات، وإنهاء أي جلسة لا تعرفها.</li>
      </ul>
      <p>لا يوجد نظام آمن بشكل مطلق. إن اكتشفنا خرقًا يمسّ بياناتك فسنبلغك وسنبلغ الجهة المختصة ضمن المدة التي يفرضها القانون.</p>
'''),

('transfer', u'نقل البيانات خارج بلدك', u'''
      <p>تُخزَّن بياناتك على خوادم قد تكون خارج بلد إقامتك. عند نقل بيانات من المنطقة الأوروبية أو من دول تفرض قيودًا مماثلة، نعتمد على البنود التعاقدية القياسية أو ما يعادلها من ضمانات معتمدة.</p>
'''),

('changes', u'تغييرات على هذه السياسة', u'''
      <p>قد نحدّث هذه الصفحة. إن كان التغيير جوهريًا، مثل جمع نوع جديد من البيانات، فسنخبرك داخل التطبيق قبل أن يسري التغيير. تاريخ آخر تحديث مكتوب أعلى الصفحة.</p>
'''),

('contact', u'التواصل', u'''
      <ul>
        <li>خصوصية وبيانات: %(mp)s</li>
        <li>دعم عام: %(ms)s</li>
        <li>العنوان: %(addr)s</li>
      </ul>
      <p>ويمكنك أيضًا استخدام <strong>الإعدادات ← الإبلاغ عن مشكلة</strong> داخل التطبيق، ويصل البلاغ إلى الفريق مباشرة.</p>
''' % dict(mp=MAIL_P, ms=MAIL_S, addr=ADDR_AR)),
]


EN = [

('who', 'Who we are', '''
      <p>FLYP is operated by %(co)s, based at %(addr)s. When you use the app, that company is the controller of your personal data, meaning it decides why data is collected and how it is used.</p>
      <p>This page explains what we collect, why, how long we keep it, and what you can do about it. It is deliberately written in plain language.</p>
''' % dict(co=CO_EN, addr=ADDR_EN)),

('collect', 'What we collect', '''
      <h3>Things you give us</h3>
      <ul>
        <li><strong>Account details:</strong> your email address, an encrypted password, your display name, your @ handle, and your date of birth.</li>
        <li><strong>Profile:</strong> your photo, bio, and the link you add if you add one.</li>
        <li><strong>Content:</strong> the clips you upload, captions, hashtags, comments, and the messages you send.</li>
        <li><strong>Live streams:</strong> the audio and video while you are broadcasting, and viewer comments.</li>
        <li><strong>Support reports:</strong> what you write when you report a problem, and your device type if you choose to send it.</li>
      </ul>

      <h3>Things collected automatically</h3>
      <ul>
        <li><strong>Usage:</strong> what you watch, what you skip, what you like or save, and who you follow. This is the material the feed builds its recommendations from.</li>
        <li><strong>Device and session:</strong> device type and operating system, app version, IP address, and sign in times. Used to run the service and to spot unusual sign ins.</li>
        <li><strong>Cookies and local storage:</strong> we use browser storage to keep you signed in and to remember preferences such as language. We do not use third party advertising trackers.</li>
      </ul>

      <h3>Things you share by choice</h3>
      <ul>
        <li><strong>Location:</strong> only collected when you switch location sharing on yourself, and only available to people over eighteen. Sharing expires automatically after eight hours.</li>
        <li><strong>Camera and photo library:</strong> read only when you open the camera or the picker to choose a clip. Nothing is uploaded unless you select it.</li>
      </ul>
'''),

('use', 'Why we use it', '''
      <div class="table-wrap">
      <table>
        <thead><tr><th>Purpose</th><th>What we use</th></tr></thead>
        <tbody>
          <tr><td>Running your account and signing you in</td><td>Email, encrypted password, session data</td></tr>
          <tr><td>Showing clips and ordering the feed</td><td>Watch history, likes, follows</td></tr>
          <tr><td>Delivering notifications and messages</td><td>Account details, message content</td></tr>
          <tr><td>Protecting the platform and reviewing reports</td><td>Reported content, device data, sign in logs</td></tr>
          <tr><td>Meeting legal obligations and answering official requests</td><td>Only what the law specifically requires</td></tr>
          <tr><td>Improving the app and fixing crashes</td><td>Crash reports and aggregate statistics</td></tr>
        </tbody>
      </table>
      </div>
      <p>We do not sell your personal data, and we do not share it with data brokers.</p>
'''),

('basis', 'Legal basis', '''
      <p>In countries with data protection laws such as the European GDPR, we rely on the following grounds:</p>
      <ul>
        <li><strong>Performing our contract with you:</strong> the parts the service cannot run without, such as your account, your content, and your messages.</li>
        <li><strong>Legitimate interests:</strong> protecting the platform from abuse, preventing fraud, and improving the product.</li>
        <li><strong>Consent:</strong> location sharing, and notifications on some systems. You can withdraw consent at any time in Settings.</li>
        <li><strong>Legal obligation:</strong> keeping certain records or answering a valid court order.</li>
      </ul>
'''),

('share', 'Who we share it with', '''
      <p>We share as little as possible, and only with these parties:</p>
      <ul>
        <li><strong>Technical providers:</strong> database and file hosting, email delivery, and the live streaming service. They work under contracts that require them to protect the data and use it only for our service.</li>
        <li><strong>Other people on FLYP:</strong> what you post publicly is visible to others. If your account is private, only the people you approve can see it.</li>
        <li><strong>Authorities:</strong> when we receive a valid legal request, or when there is an immediate risk to someone's life. Details are on the <a href="law-enforcement.html">law enforcement page</a>.</li>
        <li><strong>If the company is sold or merges:</strong> data may pass to the new owner, and we will tell you before that happens.</li>
      </ul>
'''),

('location', 'Location in detail', '''
      <p>Location sharing is entirely optional and switched off by default.</p>
      <ul>
        <li>Available only to people over eighteen, checked against the date of birth given when the account was created.</li>
        <li>Sharing expires automatically after <strong>eight hours</strong> with no action from you.</li>
        <li>When it expires, the coordinates are erased from the record and nothing of them remains.</li>
        <li>Expired records are permanently deleted within <strong>seven days</strong>.</li>
        <li>We keep no movement history and build no profile from it.</li>
        <li>Anyone you have blocked cannot see your location, whatever your settings say.</li>
      </ul>
'''),

('keep', 'How long we keep it', '''
      <div class="table-wrap">
      <table>
        <thead><tr><th>Type</th><th>Period</th></tr></thead>
        <tbody>
          <tr><td>Account and posted content</td><td>Until you delete it, or delete your account</td></tr>
          <tr><td>Account after a deletion request</td><td>Thirty days in which you can change your mind, then permanent deletion</td></tr>
          <tr><td>Location</td><td>Eight hours live, then permanent deletion within seven days</td></tr>
          <tr><td>Sign in logs</td><td>Up to ninety days, for security</td></tr>
          <tr><td>Support reports</td><td>Up to a year after the report is closed</td></tr>
          <tr><td>Backups</td><td>Rotated regularly. Deleted content may persist in them for a short period</td></tr>
        </tbody>
      </table>
      </div>
'''),

('rights', 'Your rights', '''
      <p>Most of these you can exercise from inside the app:</p>
      <ul>
        <li><strong>Access:</strong> your profile, content and messages are visible to you in the app.</li>
        <li><strong>Get a copy:</strong> Settings, then Archiving and downloading, then request a copy of your data.</li>
        <li><strong>Correction:</strong> Settings, then Edit profile.</li>
        <li><strong>Deletion:</strong> Settings, then Account, then Delete account. Thirty days to change your mind.</li>
        <li><strong>Deactivation:</strong> Settings, then Account, then Deactivate. It comes back the moment you sign in.</li>
        <li><strong>Withdraw consent:</strong> turn off location sharing or notifications in Settings.</li>
        <li><strong>Object and complain:</strong> write to %(mp)s. You also have the right to complain to the data protection authority in your country.</li>
      </ul>
      <div class="note">We answer data requests within thirty days. We may ask for simple proof of identity before acting on a deletion or export request, so that nobody else can make it on your behalf.</div>
''' % dict(mp=MAIL_P)),

('children', 'Children', '''
      <p>The minimum age for FLYP is <strong>thirteen</strong>. We ask for a date of birth when the account is created, and it cannot be changed afterwards.</p>
      <ul>
        <li>Location sharing is completely closed to anyone under eighteen.</li>
        <li>If we learn of an account belonging to a child under thirteen, we close it and delete the data.</li>
        <li>If you are a parent or guardian and believe your child created an account, write to %(mp)s and we will act quickly.</li>
      </ul>
''' % dict(mp=MAIL_P)),

('security', 'Security', '''
      <ul>
        <li>Passwords are stored hashed in a way we cannot read.</li>
        <li>Traffic to and from the app is encrypted in transit.</li>
        <li>Access to user data is limited to a small number of staff and to what the task requires.</li>
        <li>You can review the devices that have signed into your account in Settings, and end any session you do not recognise.</li>
      </ul>
      <p>No system is perfectly secure. If we discover a breach affecting your data, we will tell you and notify the relevant authority within the period the law requires.</p>
'''),

('transfer', 'Sending data outside your country', '''
      <p>Your data is stored on servers that may sit outside your country of residence. Where data moves out of the European Economic Area or a country with comparable restrictions, we rely on Standard Contractual Clauses or an equivalent approved safeguard.</p>
'''),

('changes', 'Changes to this policy', '''
      <p>We may update this page. If a change is material, such as collecting a new type of data, we will tell you inside the app before it takes effect. The last updated date is at the top of this page.</p>
'''),

('contact', 'Contact', '''
      <ul>
        <li>Privacy and data: %(mp)s</li>
        <li>General support: %(ms)s</li>
        <li>Address: %(addr)s</li>
      </ul>
      <p>You can also use <strong>Settings, then Report a problem</strong> inside the app, which reaches the team directly.</p>
''' % dict(mp=MAIL_P, ms=MAIL_S, addr=ADDR_EN)),
]

doc('privacy.html',
    u'سياسة الخصوصية', 'Privacy Policy',
    u'ما الذي نجمعه، ولماذا، وكم نحتفظ به، وما الذي يمكنك فعله حياله.',
    'What we collect, why, how long we keep it, and what you can do about it.',
    u'سياسة خصوصية تطبيق FLYP.', 'The FLYP privacy policy.',
    AR, EN)
print('privacy done')
