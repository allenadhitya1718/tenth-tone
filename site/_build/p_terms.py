# -*- coding: utf-8 -*-
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from docs import doc

F = u'<span class="fill">%s</span>'
CO_AR = F % u'[الاسم القانوني للشركة]'
CO_EN = F % '[COMPANY LEGAL NAME]'
LAW_AR = F % u'[الدولة والمحكمة المختصة]'
LAW_EN = F % '[COUNTRY AND COURTS]'
MAIL_S = 'support@flyp-sa.com'
MAIL_L = 'legal@flyp-sa.com'

AR = [
('accept', u'قبول الشروط', u'''
      <p>باستخدامك تطبيق Tenth Tone فإنك توافق على هذه الشروط. إن لم توافق عليها فلا تستخدم التطبيق.</p>
      <p>الخدمة تقدّمها %(co)s. تشمل الشروط التطبيق على الهاتف وتطبيق الويب وأي خدمة مرتبطة بهما.</p>
''' % dict(co=CO_AR)),

('eligible', u'من يمكنه الاستخدام', u'''
      <ul>
        <li>يجب أن يكون عمرك <strong>ثلاثة عشر عامًا</strong> على الأقل.</li>
        <li>بعض الميزات، مثل مشاركة الموقع، متاحة فقط لمن أتمّ الثامنة عشرة.</li>
        <li>إن سبق أن أُغلق حسابك بسبب مخالفة، فلا يحق لك إنشاء حساب جديد دون إذن منا.</li>
        <li>إن كنت تستخدم التطبيق نيابة عن جهة أو شركة، فأنت تقرّ بأنك مخوّل بذلك.</li>
      </ul>
'''),

('account', u'حسابك', u'''
      <ul>
        <li>قدّم بيانات صحيحة، وحافظ على تحديث بريدك الإلكتروني حتى تصلك رموز التحقق.</li>
        <li>أنت مسؤول عن كلمة مرورك وعن كل ما يحدث في حسابك. لا تشاركها مع أحد.</li>
        <li>إن لاحظت دخولًا لا تعرفه، أنهِ الجلسة من <strong>الإعدادات ← الأجهزة والدخول</strong> وغيّر كلمة المرور.</li>
        <li>تاريخ الميلاد يُسجَّل مرة واحدة ولا يمكن تعديله، لأن عليه تعتمد قيود العمر.</li>
      </ul>
'''),

('content', u'محتواك وحقوقك عليه', u'''
      <p><strong>ما تنشره يبقى ملكك.</strong> لا نطالب بملكية مقاطعك أو صورك أو نصوصك.</p>
      <p>لكي نتمكن من تشغيل الخدمة، تمنحنا ترخيصًا غير حصري وعالميًا وبدون مقابل مالي لاستضافة محتواك وتخزينه وعرضه ونسخه تقنيًا وتوزيعه داخل التطبيق، وتعديل حجمه أو صيغته لأغراض التشغيل فقط.</p>
      <ul>
        <li>ينتهي هذا الترخيص عند حذفك للمحتوى أو حذف حسابك.</li>
        <li>يستثنى من ذلك ما أعاد غيرك نشره أو حفظه قبل الحذف، وما يبقى في النسخ الاحتياطية لفترة قصيرة.</li>
        <li>عند نشرك صوتًا أصليًا، يمكن لمستخدمين آخرين استخدامه في مقاطعهم داخل التطبيق، مع نسبته إليك.</li>
        <li>أنت تؤكد أنك تملك الحق في نشر ما تنشره، وأنه لا ينتهك حقوق أحد.</li>
      </ul>
'''),

('rules', u'قواعد الاستخدام', u'''
      <p>القواعد التفصيلية موجودة في <a href="guidelines.html">إرشادات المجتمع</a>، وهي جزء من هذه الشروط. باختصار، يُمنع:</p>
      <ul>
        <li>المحتوى الذي يهدد أو يحرّض على العنف.</li>
        <li>التحرش والتنمّر وخطاب الكراهية.</li>
        <li>المحتوى الجنسي والعري، وأي محتوى يعرّض القُصّر للخطر.</li>
        <li>بيع أو ترويج ما هو محظور قانونًا.</li>
        <li>انتحال شخصية غيرك أو إنشاء حسابات مضللة.</li>
        <li>الرسائل المزعجة، والتفاعل المزيّف، وشراء المتابعين.</li>
        <li>نشر بيانات شخصية عن آخرين دون إذنهم.</li>
        <li>محاولة اختراق الخدمة أو سحب بياناتها آليًا أو تجاوز حدود الاستخدام.</li>
      </ul>
'''),

('live', u'البث المباشر', u'''
      <p>البث المباشر يخضع لنفس القواعد، مع اعتبارات إضافية:</p>
      <ul>
        <li>ما يُبث لحظيًا يصعب سحبه بعد رؤيته، لذا يُتعامل مع مخالفات البث بحزم أكبر.</li>
        <li>قد نوقف بثًا فورًا دون إشعار مسبق إن خالف القواعد بشكل واضح.</li>
        <li>قد نحتفظ بتسجيل مقاطع من البث المبلّغ عنه لأغراض المراجعة.</li>
      </ul>
'''),

('messages', u'الرسائل', u'''
      <p>الرسائل الخاصة مخصصة للتواصل الشخصي. لا نقرأ رسائلك لأغراض تسويقية، لكن قد نطّلع على محتوى محادثة مبلّغ عنها عند مراجعة بلاغ إساءة.</p>
      <p>يمكنك تحديد من يستطيع مراسلتك من <strong>الإعدادات ← الخصوصية</strong>، ويمكنك حظر أي شخص في أي وقت.</p>
'''),

('enforce', u'ماذا يحدث عند المخالفة', u'''
      <p>نتعامل مع المخالفات على درجات، بحسب خطورتها وتكرارها:</p>
      <ol>
        <li>حذف المحتوى المخالف مع إشعار يوضّح السبب.</li>
        <li>تقييد مؤقت لبعض الميزات، مثل النشر أو التعليق أو البث.</li>
        <li>إيقاف الحساب مؤقتًا.</li>
        <li>إغلاق الحساب نهائيًا.</li>
      </ol>
      <p>المخالفات الجسيمة، مثل ما يمسّ سلامة الأطفال أو التهديد بالعنف، تؤدي إلى الإغلاق مباشرة دون تدرّج.</p>
      <p><strong>الاعتراض:</strong> يصلك إشعار بأي إجراء، ويمكنك الاعتراض من <strong>الإعدادات ← حالة الحساب</strong>. نراجع الاعتراضات يدويًا.</p>
'''),

('ours', u'ما نملكه نحن', u'''
      <p>اسم Tenth Tone وشعاره وتصميم التطبيق وشيفرته البرمجية مملوكة لنا. لا يجوز نسخها أو استخدامها دون إذن كتابي.</p>
      <p>لا يمنحك استخدام التطبيق أي حق في هذه العلامات.</p>
'''),

('thirdparty', u'روابط وخدمات أخرى', u'''
      <p>قد يحتوي التطبيق على روابط لمواقع لا نديرها. لسنا مسؤولين عن محتواها أو سياساتها. راجعها بنفسك قبل مشاركة أي بيانات معها.</p>
'''),

('availability', u'توفّر الخدمة والتغييرات', u'''
      <ul>
        <li>نبذل جهدًا معقولًا لإبقاء الخدمة تعمل، لكننا لا نضمن توفّرها دون انقطاع.</li>
        <li>قد نضيف ميزات أو نعدّلها أو نوقفها. إن أوقفنا ميزة رئيسية فسنخبرك مسبقًا داخل التطبيق.</li>
        <li>هناك حدود على حجم الملف وعدد المقاطع المرفوعة يوميًا، وقد نعدّلها للحفاظ على استقرار الخدمة.</li>
      </ul>
'''),

('end', u'إنهاء الاستخدام', u'''
      <p><strong>من جانبك:</strong> يمكنك إيقاف حسابك مؤقتًا أو حذفه في أي وقت من الإعدادات. الحذف يمنحك مهلة ثلاثين يومًا للتراجع، ثم يصبح نهائيًا.</p>
      <p><strong>من جانبنا:</strong> قد نوقف حسابك أو نغلقه إن خالفت هذه الشروط أو إرشادات المجتمع، أو إن كان بقاؤه يعرّض غيرك للخطر. سنوضّح السبب ما لم يمنعنا القانون.</p>
'''),

('warranty', u'إخلاء المسؤولية', u'''
      <p>تُقدَّم الخدمة كما هي. لا نضمن أن تكون خالية من الأخطاء أو مناسبة لغرض معيّن، ولا نضمن دقة المحتوى الذي ينشره المستخدمون.</p>
      <p>المحتوى في التطبيق يأتي من أشخاص آخرين، ولا يمثل رأينا.</p>
'''),

('liability', u'حدود المسؤولية', u'''
      <p>إلى الحد الذي يسمح به القانون، لا نتحمل مسؤولية الأضرار غير المباشرة أو التبعية، مثل فقدان الأرباح أو البيانات أو الفرص، الناتجة عن استخدامك للخدمة.</p>
      <p>لا شيء في هذه الشروط يستثني مسؤولية لا يجيز القانون استثناءها، مثل المسؤولية عن الوفاة أو الإصابة الناتجة عن إهمال جسيم.</p>
'''),

('law', u'القانون المطبّق', u'''
      <p>تخضع هذه الشروط لقوانين %(law)s، وتُنظر أي نزاعات أمام محاكمها المختصة.</p>
      <p>إن كنت مستهلكًا مقيمًا في دولة تمنحك حقوقًا إضافية لا يمكن التنازل عنها، فتلك الحقوق تبقى قائمة.</p>
''' % dict(law=LAW_AR)),

('changes', u'تغييرات على الشروط', u'''
      <p>قد نحدّث هذه الشروط. عند وجود تغيير جوهري سنخبرك داخل التطبيق قبل سريانه بمدة معقولة. استمرارك في استخدام التطبيق بعد ذلك يعني قبولك للنسخة الجديدة.</p>
'''),

('contact', u'التواصل', u'''
      <ul>
        <li>الدعم: %(ms)s</li>
        <li>الشؤون القانونية: %(ml)s</li>
      </ul>
      <p>أو من داخل التطبيق: <strong>الإعدادات ← الإبلاغ عن مشكلة</strong>.</p>
''' % dict(ms=MAIL_S, ml=MAIL_L)),
]


EN = [
('accept', 'Accepting these terms', '''
      <p>By using Tenth Tone you agree to these terms. If you do not agree with them, do not use the app.</p>
      <p>The service is provided by %(co)s. These terms cover the mobile app, the web app, and any related service.</p>
''' % dict(co=CO_EN)),

('eligible', 'Who can use it', '''
      <ul>
        <li>You must be at least <strong>thirteen</strong> years old.</li>
        <li>Some features, such as location sharing, are only available to people over eighteen.</li>
        <li>If your account was previously closed for a violation, you may not create a new one without our permission.</li>
        <li>If you use the app on behalf of an organisation, you confirm you are authorised to do so.</li>
      </ul>
'''),

('account', 'Your account', '''
      <ul>
        <li>Give accurate details, and keep your email address current so verification codes reach you.</li>
        <li>You are responsible for your password and for everything that happens in your account. Do not share it.</li>
        <li>If you see a sign in you do not recognise, end the session in <strong>Settings, then Devices and sign ins</strong>, and change your password.</li>
        <li>Your date of birth is recorded once and cannot be changed, because the age limits depend on it.</li>
      </ul>
'''),

('content', 'Your content and your rights to it', '''
      <p><strong>What you post stays yours.</strong> We claim no ownership of your clips, images, or text.</p>
      <p>So that we can run the service, you give us a non exclusive, worldwide, royalty free licence to host, store, display, technically copy and distribute your content inside the app, and to resize or re encode it purely for delivery.</p>
      <ul>
        <li>That licence ends when you delete the content or delete your account.</li>
        <li>It does not cover copies other people reposted or saved before deletion, or what remains briefly in backups.</li>
        <li>When you publish an original sound, other people can use it in their own clips inside the app, credited to you.</li>
        <li>You confirm you have the right to post what you post, and that it infringes nobody else's rights.</li>
      </ul>
'''),

('rules', 'Rules of use', '''
      <p>The detailed rules live in the <a href="guidelines.html">Community Guidelines</a>, which form part of these terms. In short, the following are not allowed:</p>
      <ul>
        <li>Content that threatens or incites violence.</li>
        <li>Harassment, bullying, and hate speech.</li>
        <li>Sexual content and nudity, and anything that puts minors at risk.</li>
        <li>Selling or promoting what the law prohibits.</li>
        <li>Impersonating someone else or running misleading accounts.</li>
        <li>Spam, fake engagement, and bought followers.</li>
        <li>Publishing other people's personal details without their permission.</li>
        <li>Attempting to break into the service, scrape it, or work around usage limits.</li>
      </ul>
'''),

('live', 'Live streaming', '''
      <p>Live streaming follows the same rules, with extra considerations:</p>
      <ul>
        <li>What goes out live is hard to take back once it has been seen, so violations during a stream are treated more firmly.</li>
        <li>We may end a stream immediately, without prior notice, if it clearly breaks the rules.</li>
        <li>We may retain recorded segments of a reported stream for review.</li>
      </ul>
'''),

('messages', 'Messages', '''
      <p>Private messages are for personal conversation. We do not read your messages for marketing, but we may look at a reported conversation when reviewing an abuse report.</p>
      <p>You can choose who is allowed to message you in <strong>Settings, then Privacy</strong>, and you can block anyone at any time.</p>
'''),

('enforce', 'What happens if you break the rules', '''
      <p>We respond in steps, according to how serious and how repeated the behaviour is:</p>
      <ol>
        <li>The content is removed, with a notice explaining why.</li>
        <li>Some features are temporarily limited, such as posting, commenting, or going live.</li>
        <li>The account is suspended.</li>
        <li>The account is permanently closed.</li>
      </ol>
      <p>Severe violations, such as anything affecting child safety or a threat of violence, lead straight to closure with no intermediate steps.</p>
      <p><strong>Appeals:</strong> you are notified of any action, and you can appeal in <strong>Settings, then Account status</strong>. Appeals are reviewed by a person.</p>
'''),

('ours', 'What we own', '''
      <p>The Tenth Tone name, logo, app design and source code belong to us. They may not be copied or used without written permission.</p>
      <p>Using the app gives you no rights in those marks.</p>
'''),

('thirdparty', 'Other links and services', '''
      <p>The app may contain links to sites we do not run. We are not responsible for their content or their policies. Check them yourself before sharing any data with them.</p>
'''),

('availability', 'Availability and changes', '''
      <ul>
        <li>We make reasonable efforts to keep the service running, but we do not guarantee uninterrupted availability.</li>
        <li>We may add, change, or withdraw features. If we withdraw a major feature we will tell you in advance inside the app.</li>
        <li>There are limits on file size and on how many clips can be uploaded per day, and we may adjust them to keep the service stable.</li>
      </ul>
'''),

('end', 'Ending your use', '''
      <p><strong>By you:</strong> you can deactivate or delete your account at any time in Settings. Deletion gives you thirty days to change your mind, after which it becomes permanent.</p>
      <p><strong>By us:</strong> we may suspend or close your account if you break these terms or the Community Guidelines, or if keeping it open puts other people at risk. We will explain why unless the law prevents us.</p>
'''),

('warranty', 'Disclaimer', '''
      <p>The service is provided as it is. We do not warrant that it will be free of errors or fit for a particular purpose, and we do not warrant the accuracy of content posted by users.</p>
      <p>Content in the app comes from other people and does not represent our views.</p>
'''),

('liability', 'Limits of liability', '''
      <p>To the extent the law allows, we are not liable for indirect or consequential losses, such as lost profits, lost data, or lost opportunities, arising from your use of the service.</p>
      <p>Nothing in these terms excludes liability that the law does not permit us to exclude, such as liability for death or injury caused by gross negligence.</p>
'''),

('law', 'Governing law', '''
      <p>These terms are governed by the laws of %(law)s, and any dispute will be heard by its competent courts.</p>
      <p>If you are a consumer living in a country that grants you additional rights which cannot be waived, those rights still apply.</p>
''' % dict(law=LAW_EN)),

('changes', 'Changes to these terms', '''
      <p>We may update these terms. Where a change is material we will tell you inside the app a reasonable time before it takes effect. Continuing to use the app after that means you accept the new version.</p>
'''),

('contact', 'Contact', '''
      <ul>
        <li>Support: %(ms)s</li>
        <li>Legal: %(ml)s</li>
      </ul>
      <p>Or from inside the app: <strong>Settings, then Report a problem</strong>.</p>
''' % dict(ms=MAIL_S, ml=MAIL_L)),
]

doc('terms.html',
    u'شروط الاستخدام', 'Terms of Use',
    u'الاتفاق بينك وبيننا: ما يمكنك فعله، وما نتعهد به، وماذا يحدث عند المخالفة.',
    'The agreement between you and us: what you can do, what we commit to, and what happens if the rules are broken.',
    u'شروط استخدام تطبيق Tenth Tone.', 'The Tenth Tone terms of use.',
    AR, EN)
print('terms done')
