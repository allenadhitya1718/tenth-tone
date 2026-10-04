# -*- coding: utf-8 -*-
"""Child safety standards (CSAE). Public, static, linked from the footer and the safety centre."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from docs import doc

M_SAFE = 'support@flyp-sa.com'
M_LAW = 'legal@flyp-sa.com'

S_AR = [
('stance', u'موقفنا', u'''
      <p>لدى Tenth Tone <strong>سياسة عدم تسامح مطلقة</strong> مع الاعتداء الجنسي على الأطفال واستغلالهم (CSAE)، بما في ذلك المواد التي تتضمن اعتداءً جنسيًا على الأطفال (CSAM). لا يوجد تدرّج في العقوبة ولا إنذار أول: أي مخالفة تؤدي إلى إزالة المحتوى وإغلاق الحساب نهائيًا وإبلاغ الجهات المختصة.</p>
      <p>هذه المعايير منشورة للعموم، وهي جزء من <a href="guidelines.html">إرشادات المجتمع</a> و<a href="terms.html">شروط الاستخدام</a> اللتين يوافق عليهما كل مستخدم عند إنشاء حساب.</p>
'''),
('prohibited', u'ما هو ممنوع', u'''
      <p>يُمنع تمامًا على Tenth Tone، في المقاطع والصور والأوصاف والتعليقات والرسائل والبث المباشر وأسماء المستخدمين والصور الشخصية:</p>
      <ul>
        <li>أي محتوى يصوّر قاصرًا في سياق جنسي أو يستغله جنسيًا، سواء كان حقيقيًا أو مصنّعًا أو مولَّدًا بالذكاء الاصطناعي أو مرسومًا.</li>
        <li>استدراج الأطفال (grooming)، أو محاولة بناء علاقة مع قاصر بغرض الاستغلال الجنسي.</li>
        <li>طلب صور أو مقاطع أو بيانات شخصية من قاصر، أو طلب لقائه، أو محاولة نقل الحديث إلى منصة أخرى لهذا الغرض.</li>
        <li>الابتزاز الجنسي للقُصّر (sextortion) والتهديد بنشر صور حميمة.</li>
        <li>الاتجار بالأطفال أو الترويج له أو تسهيله.</li>
        <li>التعليقات الجنسية على أطفال أو على مقاطعهم، ونشر مقاطع لأطفال في مواقف تعرّضهم للخطر أو للتعليقات المسيئة.</li>
        <li>الإعلان عن مواد استغلال الأطفال أو طلبها أو تبادلها أو الإشارة إلى أماكن وجودها.</li>
      </ul>
'''),
('report', u'كيف تُبلّغ', u'''
      <p>البلاغ داخل التطبيق هو أسرع طريق، لأنه يرفق المحتوى المبلَّغ عنه تلقائيًا:</p>
      <ul>
        <li><strong>عن مقطع أو تعليق أو حساب:</strong> الخيارات ← إبلاغ، ثم اختر «محتوى غير لائق».</li>
        <li><strong>عن مشكلة عامة:</strong> الإعدادات ← الإبلاغ عن مشكلة.</li>
        <li><strong>خارج التطبيق:</strong> راسلنا على <a href="mailto:%(m)s">%(m)s</a> مع رابط المحتوى أو اسم الحساب.</li>
      </ul>
      <p>البلاغات سرّية، ولا يعرف الطرف الآخر من أبلغ. إن كان طفل في خطر مباشر فاتصل أولًا بخدمات الطوارئ في بلدك.</p>
''' % dict(m=M_SAFE)),
('response', u'كيف نتعامل مع البلاغات', u'''
      <ul>
        <li><strong>الأولوية:</strong> بلاغات سلامة الأطفال تُراجع قبل غيرها، ويراجعها شخص من الفريق لا نظام آلي وحده.</li>
        <li><strong>الإزالة:</strong> يُزال المحتوى المخالف فور التأكد منه.</li>
        <li><strong>إغلاق الحساب:</strong> يُغلق الحساب نهائيًا ويُمنع صاحبه من العودة.</li>
        <li><strong>الحفظ:</strong> نحتفظ بالمحتوى المخالف وبيانات الحساب ذات الصلة ولا نحذفها نهائيًا، حتى تتمكن الجهات المختصة من استخدامها.</li>
        <li><strong>الإبلاغ للسلطات:</strong> نبلّغ عن مواد الاعتداء الجنسي على الأطفال إلى الجهات المختصة، ومنها المركز الوطني الأمريكي للأطفال المفقودين والمستغَلين (NCMEC) عبر CyberTipline حيثما ينطبق، وإلى الجهات الرسمية في البلد المعني.</li>
        <li><strong>التعاون:</strong> نتعاون مع طلبات الجهات الرسمية الصحيحة قانونيًا، وتفاصيلها في <a href="law-enforcement.html">صفحة طلبات الجهات الرسمية</a>.</li>
      </ul>
'''),
('prevention', u'الوقاية داخل التطبيق', u'''
      <ul>
        <li>الحد الأدنى لعمر الحساب ثلاثة عشر عامًا.</li>
        <li>مشاركة الموقع مغلقة افتراضيًا، وغير متاحة لمن هم دون الثامنة عشرة.</li>
        <li>يمكن جعل الحساب خاصًا، وقصر الرسائل على من تتابعهم أو إغلاقها، وتحديد من يستطيع التعليق.</li>
        <li>أدوات الحظر والتقييد والكتم والكلمات المخفية متاحة لكل حساب.</li>
      </ul>
      <p>الإرشادات الكاملة لأولياء الأمور في <a href="safety.html">مركز الأمان</a>.</p>
'''),
('law', u'الالتزام بالقانون', u'''
      <p>نلتزم بالأنظمة والقوانين المعمول بها لحماية الأطفال ومنع استغلالهم في الدول التي نعمل فيها، ونراجع سياساتنا وإجراءاتنا بما يتوافق معها.</p>
'''),
('contact', u'جهة الاتصال المعنية', u'''
      <p>لأي استفسار أو بلاغ يتعلق بسلامة الأطفال، أو من الجهات الرسمية وجهات إنفاذ القانون:</p>
      <ul>
        <li>سلامة الأطفال والبلاغات: <a href="mailto:%(m)s">%(m)s</a></li>
        <li>الجهات الرسمية والطلبات القانونية: <a href="mailto:%(l)s">%(l)s</a></li>
      </ul>
      <p>نرد على بلاغات سلامة الأطفال أولًا وبأسرع ما يمكن.</p>
''' % dict(m=M_SAFE, l=M_LAW)),
]

S_EN = [
('stance', 'Our position', '''
      <p>Tenth Tone has a <strong>zero tolerance policy</strong> toward child sexual abuse and exploitation (CSAE), including child sexual abuse material (CSAM). There is no graduated penalty and no first warning: any violation leads to removal of the content, permanent closure of the account, and a report to the relevant authorities.</p>
      <p>These standards are public and form part of our <a href="guidelines.html">Community Guidelines</a> and <a href="terms.html">Terms of Use</a>, which every user accepts when creating an account.</p>
'''),
('prohibited', 'What is prohibited', '''
      <p>The following are strictly prohibited on Tenth Tone, in clips, photos, captions, comments, messages, live streams, usernames and profile pictures:</p>
      <ul>
        <li>Any content that depicts a minor in a sexual context or sexually exploits a minor, whether real, fabricated, AI-generated or drawn.</li>
        <li>Grooming, or any attempt to build a relationship with a minor for the purpose of sexual exploitation.</li>
        <li>Asking a minor for images, videos or personal details, asking to meet them, or trying to move the conversation to another platform for this purpose.</li>
        <li>Sexual extortion of minors (sextortion) and threats to share intimate images.</li>
        <li>Trafficking of children, or promoting or facilitating it.</li>
        <li>Sexual comments about children or their clips, and posting clips of children in situations that expose them to danger or abusive comments.</li>
        <li>Advertising, requesting, trading or pointing to child exploitation material.</li>
      </ul>
'''),
('report', 'How to report', '''
      <p>Reporting inside the app is fastest, because it attaches the reported content automatically:</p>
      <ul>
        <li><strong>A clip, comment or account:</strong> Options, Report, then choose &ldquo;Inappropriate content&rdquo;.</li>
        <li><strong>A general problem:</strong> Settings, Report a problem.</li>
        <li><strong>Outside the app:</strong> email <a href="mailto:%(m)s">%(m)s</a> with a link to the content or the account name.</li>
      </ul>
      <p>Reports are confidential and the other person is never told who reported them. If a child is in immediate danger, contact the emergency services where you are first.</p>
''' % dict(m=M_SAFE)),
('response', 'How we respond to reports', '''
      <ul>
        <li><strong>Priority:</strong> child safety reports are reviewed before all others, by a person on the team and not by an automated system alone.</li>
        <li><strong>Removal:</strong> violating content is removed as soon as it is confirmed.</li>
        <li><strong>Account closure:</strong> the account is closed permanently and the person is barred from returning.</li>
        <li><strong>Preservation:</strong> we preserve the violating content and related account data, and do not permanently delete it, so that the authorities can use it.</li>
        <li><strong>Reporting to authorities:</strong> we report child sexual abuse material to the relevant authorities, including the US National Center for Missing &amp; Exploited Children (NCMEC) through its CyberTipline where applicable, and to the official authorities in the country concerned.</li>
        <li><strong>Cooperation:</strong> we cooperate with legally valid requests from authorities, described on the <a href="law-enforcement.html">law enforcement page</a>.</li>
      </ul>
'''),
('prevention', 'Prevention inside the app', '''
      <ul>
        <li>The minimum account age is thirteen.</li>
        <li>Location sharing is off by default and unavailable to anyone under eighteen.</li>
        <li>An account can be made private, messages can be limited to people you follow or turned off, and you choose who can comment.</li>
        <li>Block, restrict, mute and hidden words are available on every account.</li>
      </ul>
      <p>The full guidance for parents is in the <a href="safety.html">Safety Centre</a>.</p>
'''),
('law', 'Compliance with the law', '''
      <p>We comply with the laws and regulations on child protection and the prevention of child exploitation that apply in the countries where we operate, and we review our policies and procedures to stay in line with them.</p>
'''),
('contact', 'Designated point of contact', '''
      <p>For any question or report about child safety, and for authorities and law enforcement:</p>
      <ul>
        <li>Child safety and reports: <a href="mailto:%(m)s">%(m)s</a></li>
        <li>Authorities and legal requests: <a href="mailto:%(l)s">%(l)s</a></li>
      </ul>
      <p>We answer child safety reports first, and as fast as we can.</p>
''' % dict(m=M_SAFE, l=M_LAW)),
]

doc('child-safety.html',
    u'معايير سلامة الأطفال', 'Child Safety Standards',
    u'موقفنا من الاعتداء الجنسي على الأطفال واستغلالهم، وكيف تُبلّغ، وماذا نفعل بعد البلاغ.',
    'Our standards against child sexual abuse and exploitation, how to report, and what we do after a report.',
    u'معايير Tenth Tone المنشورة ضد الاعتداء الجنسي على الأطفال واستغلالهم (CSAE).',
    'Tenth Tone\'s published standards against child sexual abuse and exploitation (CSAE).',
    S_AR, S_EN, here='child-safety.html')

print('child safety page done')
