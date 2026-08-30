# -*- coding: utf-8 -*-
"""Community guidelines, copyright, law enforcement."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from docs import doc

F = u'<span class="fill">%s</span>'
CO_AR = F % u'[الاسم القانوني للشركة]'
CO_EN = F % '[COMPANY LEGAL NAME]'
ADDR_AR = F % u'[العنوان المسجل]'
ADDR_EN = F % '[REGISTERED ADDRESS]'
M_COPY = 'copyright@flyp-sa.com'
M_LAW = 'legal@flyp-sa.com'
M_SUP = 'support@flyp-sa.com'

# =============================================================== GUIDELINES
G_AR = [
('idea', u'الفكرة باختصار', u'''
      <p>FLYP مكان للتصوير والمشاركة. القاعدة الأساسية بسيطة: <strong>انشر ما لا يؤذي غيرك.</strong></p>
      <p>هذه الإرشادات تنطبق على كل شيء في التطبيق: المقاطع، الأوصاف، التعليقات، الأصوات، أسماء المستخدمين، الصور الشخصية، الرسائل، والبث المباشر.</p>
      <p>وهي جزء من <a href="terms.html">شروط الاستخدام</a>.</p>
'''),
('violence', u'العنف والتهديد', u'''
      <p>ممنوع:</p>
      <ul>
        <li>التهديد بإيذاء شخص أو مجموعة.</li>
        <li>الدعوة إلى العنف أو الاحتفاء به.</li>
        <li>مشاهد عنف صادمة أو دموية تُنشر بلا سياق إخباري أو تعليمي.</li>
        <li>تمجيد جماعات تمارس العنف أو الترويج لها.</li>
      </ul>
'''),
('hate', u'الكراهية والتحرش', u'''
      <p>ممنوع:</p>
      <ul>
        <li>مهاجمة شخص بسبب دينه أو عرقه أو جنسيته أو جنسه أو إعاقته أو قبيلته.</li>
        <li>التنمّر، أو التعليقات المتكررة المزعجة، أو حملات الهجوم الجماعي.</li>
        <li>السخرية من مظهر شخص أو صوته أو ظروفه.</li>
        <li>إنشاء حسابات لغرض مضايقة شخص بعينه.</li>
      </ul>
      <p>النقد لفكرة أو لعمل عام ليس تحرشًا. الهجوم على الشخص نفسه هو التحرش.</p>
'''),
('sexual', u'المحتوى الجنسي والعري', u'''
      <ul>
        <li>ممنوع العري والمحتوى الجنسي الصريح.</li>
        <li>ممنوع الترويج لخدمات جنسية.</li>
        <li>الملابس المناسبة للسياق العام مطلوبة في المقاطع والبث.</li>
      </ul>
'''),
('minors', u'سلامة القُصّر', u'''
      <p>هذا أخطر بند في هذه الصفحة، ولا يوجد فيه تدرّج في العقوبة.</p>
      <ul>
        <li>أي محتوى يستغل أو يعرّض طفلًا للخطر يؤدي إلى إغلاق الحساب فورًا وإبلاغ الجهات المختصة.</li>
        <li>ممنوع طلب بيانات شخصية من قاصر أو محاولة التواصل معه بغرض مشبوه.</li>
        <li>ممنوع نشر مقاطع لأطفال في مواقف تعرّضهم للخطر أو للتعليقات المسيئة.</li>
        <li>الحد الأدنى لعمر الحساب ثلاثة عشر عامًا.</li>
      </ul>
'''),
('selfharm', u'إيذاء النفس', u'''
      <ul>
        <li>ممنوع تشجيع الانتحار أو إيذاء النفس أو اضطرابات الأكل، أو شرح طرقها.</li>
        <li>الحديث عن تجربة شخصية بغرض التعافي مسموح، وقد نضيف تنبيهًا أو مصادر مساعدة إلى جانبه.</li>
        <li>إن رأيت شخصًا في خطر فورّي، أبلغ خدمات الطوارئ في بلدك، ثم أبلغنا عن المحتوى.</li>
      </ul>
'''),
('dangerous', u'الأفعال الخطرة والمواد الممنوعة', u'''
      <ul>
        <li>ممنوع التحديات الخطرة التي قد تسبب إصابة إن قلّدها أحد.</li>
        <li>ممنوع بيع أو ترويج المخدرات والأسلحة والأدوية الموصوفة والمنتجات المقلّدة.</li>
        <li>ممنوع الترويج للقمار أو للاحتيال المالي.</li>
      </ul>
'''),
('spam', u'الرسائل المزعجة والحسابات المزيفة', u'''
      <ul>
        <li>ممنوع شراء أو بيع المتابعين والإعجابات والتعليقات.</li>
        <li>ممنوع نشر الرابط نفسه بشكل متكرر أو إرسال رسائل جماعية غير مرغوبة.</li>
        <li>ممنوع انتحال شخصية شخص أو جهة. حساب المعجبين أو السخرية مسموح إن كان موضحًا في الاسم والنبذة.</li>
        <li>ممنوع استخدام برامج آلية للتفاعل أو لسحب بيانات التطبيق.</li>
      </ul>
'''),
('privacy', u'خصوصية الآخرين', u'''
      <ul>
        <li>ممنوع نشر رقم شخص أو عنوانه أو مستنداته أو بيانات حسابه.</li>
        <li>ممنوع تصوير أشخاص في أماكن خاصة دون علمهم.</li>
        <li>ممنوع نشر محادثة خاصة بغرض الإحراج.</li>
      </ul>
'''),
('ip', u'حقوق الآخرين', u'''
      <p>لا تنشر عملًا لا تملك الحق فيه. تفاصيل الإبلاغ عن انتهاك حقوق النشر في <a href="copyright.html">صفحة حقوق النشر</a>.</p>
'''),
('livestream', u'قواعد إضافية للبث', u'''
      <ul>
        <li>ما يُبث لحظيًا يصعب سحبه، لذا نتعامل مع مخالفات البث بحزم أكبر.</li>
        <li>قد يُوقف البث فورًا دون تنبيه إن كانت المخالفة واضحة.</li>
        <li>أنت مسؤول عمّا يظهر في بثك، بما في ذلك ما يفعله ضيوفك.</li>
      </ul>
'''),
('what', u'ماذا يحدث عند المخالفة', u'''
      <ol>
        <li>حذف المحتوى مع إشعار يوضّح السبب.</li>
        <li>تقييد مؤقت للنشر أو التعليق أو البث.</li>
        <li>إيقاف مؤقت للحساب.</li>
        <li>إغلاق نهائي.</li>
      </ol>
      <p>المخالفات الجسيمة تؤدي إلى الإغلاق مباشرة. يمكنك الاعتراض على أي إجراء من <strong>الإعدادات ← حالة الحساب</strong>، ويراجع الاعتراض شخص لا برنامج.</p>
'''),
('report', u'كيف تبلّغ', u'''
      <ul>
        <li><strong>مقطع:</strong> اضغط على زر الخيارات في المقطع، ثم إبلاغ.</li>
        <li><strong>تعليق:</strong> اضغط مطوّلًا على التعليق، ثم إبلاغ.</li>
        <li><strong>حساب:</strong> افتح الملف الشخصي، ثم الخيارات، ثم إبلاغ.</li>
        <li><strong>مشكلة عامة:</strong> الإعدادات ← الإبلاغ عن مشكلة.</li>
      </ul>
      <p>البلاغات سرّية. لا يعرف الطرف الآخر من أبلغ عنه.</p>
'''),
]

G_EN = [
('idea', 'The idea in short', '''
      <p>FLYP is a place to film and share. The basic rule is simple: <strong>post what does not harm other people.</strong></p>
      <p>These guidelines apply to everything in the app: clips, captions, comments, sounds, usernames, profile photos, messages, and live streams.</p>
      <p>They form part of the <a href="terms.html">Terms of Use</a>.</p>
'''),
('violence', 'Violence and threats', '''
      <p>Not allowed:</p>
      <ul>
        <li>Threatening to harm a person or a group.</li>
        <li>Calling for violence or celebrating it.</li>
        <li>Graphic or bloody violence posted with no news or educational context.</li>
        <li>Glorifying or promoting violent groups.</li>
      </ul>
'''),
('hate', 'Hate and harassment', '''
      <p>Not allowed:</p>
      <ul>
        <li>Attacking someone for their religion, race, nationality, gender, disability, or tribe.</li>
        <li>Bullying, repeated unwanted comments, or coordinated pile ons.</li>
        <li>Mocking someone's appearance, voice, or circumstances.</li>
        <li>Creating accounts for the purpose of harassing one particular person.</li>
      </ul>
      <p>Criticising an idea or a piece of public work is not harassment. Attacking the person is.</p>
'''),
('sexual', 'Sexual content and nudity', '''
      <ul>
        <li>Nudity and explicit sexual content are not allowed.</li>
        <li>Promoting sexual services is not allowed.</li>
        <li>Clothing appropriate to a general audience is expected in clips and streams.</li>
      </ul>
'''),
('minors', 'Minor safety', '''
      <p>This is the most serious section on this page, and there are no intermediate steps.</p>
      <ul>
        <li>Any content that exploits or endangers a child leads to immediate account closure and a report to the authorities.</li>
        <li>Asking a minor for personal details, or contacting one for a suspicious purpose, is not allowed.</li>
        <li>Posting clips of children in situations that expose them to danger or to abusive comments is not allowed.</li>
        <li>The minimum account age is thirteen.</li>
      </ul>
'''),
('selfharm', 'Self harm', '''
      <ul>
        <li>Encouraging suicide, self harm, or eating disorders, or describing methods, is not allowed.</li>
        <li>Talking about your own experience in the context of recovery is allowed, and we may add a notice or support resources alongside it.</li>
        <li>If you see someone in immediate danger, contact the emergency services where you are, then report the content to us.</li>
      </ul>
'''),
('dangerous', 'Dangerous acts and prohibited goods', '''
      <ul>
        <li>Dangerous challenges that could injure someone who copies them are not allowed.</li>
        <li>Selling or promoting drugs, weapons, prescription medicines, and counterfeit goods is not allowed.</li>
        <li>Promoting gambling or financial scams is not allowed.</li>
      </ul>
'''),
('spam', 'Spam and fake accounts', '''
      <ul>
        <li>Buying or selling followers, likes, and comments is not allowed.</li>
        <li>Posting the same link repeatedly, or sending unsolicited bulk messages, is not allowed.</li>
        <li>Impersonating a person or an organisation is not allowed. Fan and parody accounts are fine if the name and bio make that clear.</li>
        <li>Using automated software to interact or to scrape the app is not allowed.</li>
      </ul>
'''),
('privacy', 'Other people\'s privacy', '''
      <ul>
        <li>Do not publish someone's phone number, address, documents, or account details.</li>
        <li>Do not film people in private places without their knowledge.</li>
        <li>Do not publish a private conversation in order to embarrass someone.</li>
      </ul>
'''),
('ip', 'Other people\'s rights', '''
      <p>Do not post work you have no right to. How to report a copyright infringement is on the <a href="copyright.html">copyright page</a>.</p>
'''),
('livestream', 'Extra rules for live', '''
      <ul>
        <li>What goes out live is hard to take back, so violations during a stream are treated more firmly.</li>
        <li>A stream may be ended immediately, with no warning, if the violation is clear.</li>
        <li>You are responsible for what appears in your stream, including what your guests do.</li>
      </ul>
'''),
('what', 'What happens if you break them', '''
      <ol>
        <li>The content is removed, with a notice explaining why.</li>
        <li>Posting, commenting, or going live is temporarily limited.</li>
        <li>The account is suspended.</li>
        <li>The account is permanently closed.</li>
      </ol>
      <p>Severe violations lead straight to closure. You can appeal any action in <strong>Settings, then Account status</strong>, and a person reviews the appeal, not a program.</p>
'''),
('report', 'How to report', '''
      <ul>
        <li><strong>A clip:</strong> tap the options button on the clip, then Report.</li>
        <li><strong>A comment:</strong> press and hold the comment, then Report.</li>
        <li><strong>An account:</strong> open the profile, then options, then Report.</li>
        <li><strong>A general problem:</strong> Settings, then Report a problem.</li>
      </ul>
      <p>Reports are confidential. The other person is not told who reported them.</p>
'''),
]

doc('guidelines.html',
    u'إرشادات المجتمع', 'Community Guidelines',
    u'ما هو مسموح وما هو ممنوع على FLYP، وماذا يحدث عند المخالفة.',
    'What is allowed and what is not on FLYP, and what happens when the rules are broken.',
    u'إرشادات المجتمع في FLYP.', 'The FLYP community guidelines.',
    G_AR, G_EN)


# =============================================================== COPYRIGHT
C_AR = [
('basics', u'الأساس', u'''
      <p>انشر ما تملك حق نشره. إن استخدمت عمل غيرك دون إذن فقد يُحذف المقطع، وقد يُقيَّد حسابك.</p>
      <p>وضع اسم صاحب العمل في الوصف لا يعني الحصول على إذن.</p>
'''),
('report', u'الإبلاغ عن انتهاك', u'''
      <p>إن كنت صاحب الحق أو من يمثله قانونًا، أرسل إشعارًا إلى %(mc)s يتضمن:</p>
      <ol>
        <li>وصف العمل المحمي وما يثبت ملكيتك له.</li>
        <li>رابط المقطع أو التعليق المخالف داخل التطبيق، أو معرّف الحساب واسم الملف.</li>
        <li>بيانات التواصل بك: الاسم الكامل، البريد، والعنوان.</li>
        <li>إقرار بأنك تعتقد بحسن نية أن الاستخدام غير مصرّح به.</li>
        <li>إقرار بأن المعلومات صحيحة، وأنك صاحب الحق أو مخوّل بالتصرف نيابة عنه.</li>
        <li>توقيعك، إلكترونيًا أو خطيًا.</li>
      </ol>
      <div class="note">الإشعار الناقص يؤخّر المعالجة. الإشعار الكاذب قد يعرّضك للمساءلة القانونية.</div>
''' % dict(mc=M_COPY)),
('after', u'ماذا يحدث بعد الإشعار', u'''
      <ul>
        <li>نراجع الإشعار، وإن كان مكتملًا نحذف المحتوى أو نمنع الوصول إليه.</li>
        <li>نبلغ صاحب الحساب بسبب الحذف ونرسل له نسخة من الإشعار دون بيانات تواصلك الحساسة.</li>
        <li>نسجّل مخالفة على الحساب.</li>
      </ul>
'''),
('counter', u'الاعتراض على الحذف', u'''
      <p>إن حُذف محتواك وتعتقد أن الحذف كان خطأ، أرسل اعتراضًا إلى %(mc)s يتضمن:</p>
      <ol>
        <li>وصف المحتوى المحذوف وموضعه قبل الحذف.</li>
        <li>سبب اعتقادك أن الحذف كان خطأ، مثل امتلاكك ترخيصًا أو كون الاستخدام مشروعًا.</li>
        <li>اسمك الكامل وبريدك وعنوانك.</li>
        <li>موافقتك على اختصاص المحاكم المذكورة في <a href="terms.html">شروط الاستخدام</a>.</li>
        <li>توقيعك.</li>
      </ol>
      <p>إن لم يتخذ المُبلِّغ إجراءً قضائيًا خلال المدة التي يحددها القانون، فقد نعيد المحتوى.</p>
''' % dict(mc=M_COPY)),
('repeat', u'المخالف المتكرر', u'''
      <p>الحساب الذي تتكرر عليه إشعارات صحيحة يُغلق. نأخذ في الاعتبار عدد الإشعارات وخطورتها والفترة الزمنية بينها.</p>
'''),
('trademark', u'العلامات التجارية', u'''
      <p>لاستخدام غير مصرّح به لعلامة تجارية، أرسل إلى %(mc)s: العلامة، ورقم تسجيلها إن وجد، والدولة، ورابط الحساب أو المحتوى، وسبب اعتقادك بوجود لبس لدى الجمهور.</p>
''' % dict(mc=M_COPY)),
('sounds', u'الأصوات داخل التطبيق', u'''
      <p>الصوت الذي تنشئه ويُستخدم داخل التطبيق يبقى منسوبًا إليك، ويمكنك حذفه من مكتبتك. حذف الصوت يوقف استخدامه في مقاطع جديدة.</p>
'''),
]

C_EN = [
('basics', 'The basics', '''
      <p>Post what you have the right to post. If you use someone else's work without permission, the clip may be removed and your account may be limited.</p>
      <p>Naming the original creator in the caption is not the same as having permission.</p>
'''),
('report', 'Reporting an infringement', '''
      <p>If you are the rights holder or their legal representative, send a notice to %(mc)s containing:</p>
      <ol>
        <li>A description of the protected work and what establishes your ownership.</li>
        <li>A link to the infringing clip or comment inside the app, or the account handle and the file name.</li>
        <li>Your contact details: full name, email, and address.</li>
        <li>A statement that you believe in good faith the use is not authorised.</li>
        <li>A statement that the information is accurate, and that you are the rights holder or authorised to act for them.</li>
        <li>Your signature, electronic or physical.</li>
      </ol>
      <div class="note">An incomplete notice delays processing. A false notice may expose you to legal liability.</div>
''' % dict(mc=M_COPY)),
('after', 'What happens after a notice', '''
      <ul>
        <li>We review the notice, and if it is complete we remove the content or block access to it.</li>
        <li>We tell the account holder why it was removed and send them a copy of the notice, without your sensitive contact details.</li>
        <li>A strike is recorded against the account.</li>
      </ul>
'''),
('counter', 'Disputing a removal', '''
      <p>If your content was removed and you believe that was a mistake, send a counter notice to %(mc)s containing:</p>
      <ol>
        <li>A description of the removed content and where it was before removal.</li>
        <li>Why you believe the removal was a mistake, for example that you hold a licence or the use was lawful.</li>
        <li>Your full name, email, and address.</li>
        <li>Your consent to the jurisdiction named in the <a href="terms.html">Terms of Use</a>.</li>
        <li>Your signature.</li>
      </ol>
      <p>If the original complainant does not begin legal action within the period the law allows, we may restore the content.</p>
''' % dict(mc=M_COPY)),
('repeat', 'Repeat infringers', '''
      <p>An account that receives repeated valid notices is closed. We take into account how many notices there were, how serious they were, and the time between them.</p>
'''),
('trademark', 'Trademarks', '''
      <p>For unauthorised use of a trademark, send to %(mc)s: the mark, its registration number if it has one, the country, a link to the account or content, and why you believe the public would be confused.</p>
''' % dict(mc=M_COPY)),
('sounds', 'Sounds inside the app', '''
      <p>A sound you create and that is used inside the app stays credited to you, and you can delete it from your library. Deleting a sound stops it being used in new clips.</p>
'''),
]

doc('copyright.html',
    u'حقوق النشر', 'Copyright',
    u'كيف تبلّغ عن استخدام عملك دون إذن، وكيف تعترض إن حُذف محتواك بالخطأ.',
    'How to report unauthorised use of your work, and how to dispute a removal you believe was wrong.',
    u'سياسة حقوق النشر في FLYP.', 'The FLYP copyright policy.',
    C_AR, C_EN)


# =============================================================== LAW
L_AR = [
('who', u'لمن هذه الصفحة', u'''
      <p>هذه الصفحة موجهة إلى الجهات الرسمية وجهات إنفاذ القانون. إن كنت مستخدمًا عاديًا وتريد الإبلاغ عن محتوى، استخدم زر الإبلاغ داخل التطبيق أو <a href="contact.html">صفحة التواصل</a>.</p>
      <p>الخدمة تديرها %(co)s، ومقرها %(addr)s.</p>
''' % dict(co=CO_AR, addr=ADDR_AR)),
('send', u'كيف تُرسَل الطلبات', u'''
      <p>تُرسل الطلبات إلى %(ml)s من عنوان بريد رسمي تابع للجهة الطالبة. يجب أن يتضمن الطلب:</p>
      <ul>
        <li>اسم الجهة، واسم الضابط أو الموظف المسؤول، ورقم القضية.</li>
        <li>الأساس القانوني للطلب ونسخة من الأمر أو الإذن.</li>
        <li>تحديد الحساب بدقة: المعرّف الذي يبدأ بعلامة @، أو البريد المسجل، أو رابط المحتوى.</li>
        <li>النطاق الزمني المطلوب.</li>
        <li>نوع البيانات المطلوبة تحديدًا.</li>
      </ul>
      <p>الطلبات العامة أو غير المحددة تُرفض أو يُطلب تضييقها.</p>
''' % dict(ml=M_LAW)),
('data', u'ما قد يكون متاحًا', u'''
      <p>لا نحتفظ بأكثر مما نحتاجه لتشغيل الخدمة. قد تشمل البيانات المتاحة:</p>
      <ul>
        <li>بيانات الحساب الأساسية: المعرّف، البريد، تاريخ الإنشاء.</li>
        <li>سجلات الدخول وعناوين IP لفترة محدودة.</li>
        <li>المحتوى المنشور غير المحذوف.</li>
        <li>الرسائل، ضمن حدود ما هو محفوظ وقت تلقّي الطلب.</li>
      </ul>
      <p>لا نحتفظ بسجل تاريخي للمواقع. بيانات الموقع تنتهي بعد ثماني ساعات وتُحذف نهائيًا خلال سبعة أيام.</p>
'''),
('emergency', u'الحالات الطارئة', u'''
      <p>إن كان هناك خطر وشيك على حياة شخص أو خطر إصابة جسيمة، أرسل الطلب إلى %(ml)s مع كلمة <strong>طارئ</strong> في عنوان الرسالة، مع وصف الخطر وسبب الاستعجال.</p>
      <p>نراجع هذه الطلبات بأسرع ما يمكن. قد نفصح عن معلومات دون أمر قضائي إذا كنا نعتقد بحسن نية أن ذلك ضروري لمنع الخطر.</p>
''' % dict(ml=M_LAW)),
('preserve', u'طلبات الحفظ', u'''
      <p>يمكن طلب حفظ بيانات حساب معيّن ريثما يصدر الأمر القضائي. نحتفظ بالبيانات المحفوظة تسعين يومًا، وتُمدد مرة واحدة بطلب مكتوب.</p>
'''),
('notice', u'إبلاغ المستخدم', u'''
      <p>سياستنا هي إبلاغ المستخدم بأن بياناته طُلبت، ما لم يمنعنا القانون أو أمر قضائي، أو ما لم يكن الإبلاغ قد يعرّض شخصًا للخطر أو يعيق تحقيقًا في أذى وشيك.</p>
'''),
('foreign', u'الطلبات من خارج الدولة', u'''
      <p>الطلبات الصادرة من خارج الدولة التي نخضع لقوانينها تُراجع وفق القنوات القانونية المعتمدة، مثل الاتفاقيات الثنائية للمساعدة القضائية، ما لم توجد قاعدة قانونية أخرى تسمح بالاستجابة المباشرة.</p>
'''),
]

L_EN = [
('who', 'Who this page is for', '''
      <p>This page is for authorities and law enforcement. If you are an ordinary user wanting to report content, use the report button inside the app or the <a href="contact.html">contact page</a>.</p>
      <p>The service is operated by %(co)s, based at %(addr)s.</p>
''' % dict(co=CO_EN, addr=ADDR_EN)),
('send', 'How to send requests', '''
      <p>Send requests to %(ml)s from an official address belonging to the requesting body. The request must include:</p>
      <ul>
        <li>The name of the body, the responsible officer, and the case number.</li>
        <li>The legal basis for the request and a copy of the order or warrant.</li>
        <li>A precise identification of the account: the @ handle, the registered email, or a link to the content.</li>
        <li>The time range requested.</li>
        <li>Exactly which categories of data are sought.</li>
      </ul>
      <p>Broad or unspecified requests are refused or sent back to be narrowed.</p>
''' % dict(ml=M_LAW)),
('data', 'What may be available', '''
      <p>We keep no more than the service needs. Available data may include:</p>
      <ul>
        <li>Basic account details: handle, email, creation date.</li>
        <li>Sign in logs and IP addresses, for a limited period.</li>
        <li>Posted content that has not been deleted.</li>
        <li>Messages, within the limits of what is retained at the time the request arrives.</li>
      </ul>
      <p>We keep no location history. Location data expires after eight hours and is permanently deleted within seven days.</p>
'''),
('emergency', 'Emergencies', '''
      <p>If there is an immediate risk to life or of serious injury, send the request to %(ml)s with the word <strong>EMERGENCY</strong> in the subject line, describing the danger and why it is urgent.</p>
      <p>We review these as quickly as we can. We may disclose information without a court order where we believe in good faith that it is necessary to prevent the harm.</p>
''' % dict(ml=M_LAW)),
('preserve', 'Preservation requests', '''
      <p>You may ask us to preserve the data of a specific account while an order is obtained. Preserved data is held for ninety days, extendable once on written request.</p>
'''),
('notice', 'Notice to the user', '''
      <p>Our policy is to tell the user that their data has been requested, unless the law or a court order prevents it, or unless notice would put someone at risk or obstruct an investigation into imminent harm.</p>
'''),
('foreign', 'Requests from other countries', '''
      <p>Requests originating outside the country whose laws govern us are reviewed through recognised legal channels, such as mutual legal assistance treaties, unless another legal basis permits a direct response.</p>
'''),
]

doc('law-enforcement.html',
    u'طلبات الجهات الرسمية', 'Law Enforcement Requests',
    u'كيف تُرسَل الطلبات القانونية، وما الذي قد يكون متاحًا، وكيف نتعامل مع الحالات الطارئة.',
    'How legal requests should be sent, what may be available, and how we handle emergencies.',
    u'إرشادات الجهات الرسمية للحصول على بيانات من FLYP.',
    'Guidelines for authorities requesting data from FLYP.',
    L_AR, L_EN)

print('rules pages done')
