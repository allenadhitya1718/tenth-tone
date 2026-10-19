// Community Guidelines. Started as a copy of GUIDELINES_DOC in
// web/js/views.js; since 19 October 2026 it also covers calls, walkie-talkie,
// the friends map, stories and gifts (short form of site/guidelines.html).
// Like the legal documents (lib/legal.ts), both languages
// live here and the text never goes through the translation layer.
import type { LegalDoc } from '@/lib/legal';

export const SUPPORT_EMAIL = 'support@flyp-sa.com';

export const GUIDELINES_DOC: LegalDoc = {
  title: { ar: 'قواعد المجتمع', en: 'Community Guidelines' },
  sections: [
    {
      h: { ar: 'عدم التسامح مطلقًا', en: 'Zero tolerance' },
      p: {
        ar: 'آخر تحديث: 19 أكتوبر 2026\n\nلدينا سياسة عدم تسامح مطلقًا مع المحتوى المسيء ومع المستخدمين المسيئين. نراجع كل بلاغ خلال 24 ساعة كحد أقصى، ونزيل المحتوى المخالف ونغلق حساب من نشره. تنطبق هذه القواعد على كل شيء في التطبيق: الفيديوهات والقصص والتعليقات والرسائل والمكالمات والتحدث بالضغط وخريطة الأصدقاء والهدايا والبث المباشر.',
        en: 'Last updated: 19 October 2026\n\nWe have a zero-tolerance policy for objectionable content and for abusive users. We review every report within 24 hours at most, remove content that breaks these rules, and terminate the account that posted it. These rules apply to everything in the app: videos, stories, comments, messages, calls and walkie-talkie, the friends map, gifts and live streams.',
      },
    },
    {
      h: { ar: 'ما هو ممنوع', en: 'What is not allowed' },
      p: {
        ar: 'العُري أو المحتوى الجنسي، العنف الصريح أو المحتوى الصادم، خطاب الكراهية أو التنمر أو التحرش، انتحال شخصية غيرك، المعلومات المضللة الضارة، انتهاك حقوق النشر، أي نشاط غير قانوني، وأي محتوى يعرّض الأطفال للخطر.',
        en: 'Nudity or sexual content, graphic violence or shocking material, hate speech, bullying or harassment, impersonating anyone, harmful misinformation, copyright infringement, any illegal activity, and any content that endangers children.',
      },
    },
    {
      h: { ar: 'المكالمات والتحدث بالضغط وخريطة الأصدقاء', en: 'Calls, walkie-talkie and the friends map' },
      p: {
        ar: 'تسري القواعد نفسها على المكالمات الصوتية والمرئية والتحدث بالضغط: لا تحرش ولا تهديد ولا محتوى جنسي، ولا إغراق أحد بمكالمات لا يريدها. لا نسجّلها، ويُمنع تسجيل مكالمة أو نشرها دون إذن من فيها. خريطة الأصدقاء لمن أتمّ 18 عامًا فقط، ويُمنع استخدامها لملاحقة أحد أو تتبّعه أو مضايقته، أو للضغط على شخص كي يشارك موقعه، أو لنشر موقع غيرك. ويؤدي ذلك إلى إغلاق الحساب.',
        en: 'The same rules apply to voice and video calls and walkie-talkie: no harassment, threats or sexual content, and no flooding someone with calls they do not want. We do not record them, and recording or sharing a call without the permission of the people in it is not allowed. The friends map is for people aged 18 or over only, and using it to follow, track or harass anyone, to pressure someone into sharing their location, or to post someone else’s location is not allowed and leads to account closure.',
      },
    },
    {
      h: { ar: 'الهدايا والعملات', en: 'Gifts and coins' },
      p: {
        ar: 'الهدايا وسيلة للتشجيع لا للضغط. يُمنع الإلحاح على المشاهدين أو الضغط عليهم لإرسال هدايا، وبخاصة من يبدو أنه قاصر. ويُمنع بيع العملات أو شراؤها أو مبادلتها خارج التطبيق، والوعد بمقابل خارج التطبيق مقابل الهدايا، والاحتيال بوسائل دفع مسروقة أو باستغلال الاسترداد.',
        en: 'Gifts are for encouragement, not pressure. Pestering or pressuring viewers to send gifts is not allowed, least of all anyone who appears to be a minor. Selling, buying or trading coins outside the app, promising anything outside the app in return for gifts, and fraud with stolen payment methods or abused refunds are not allowed.',
      },
    },
    {
      h: { ar: 'كيف تبلّغ عن محتوى', en: 'How to report content' },
      p: {
        ar: 'اضغط زر الخيارات على أي فيديو أو تعليق أو حساب أو بث مباشر، ثم اختر «الإبلاغ» وحدّد السبب. يصلنا البلاغ فورًا. وإن لم تكن مسجّل الدخول، راسلنا على البريد الموضّح أدناه.',
        en: 'Tap the options button on any video, comment, account or live stream, then choose Report and pick a reason. The report reaches us immediately. If you are not signed in, email us at the address below.',
      },
    },
    {
      h: { ar: 'كيف تحظر مستخدمًا', en: 'How to block someone' },
      p: {
        ar: 'من قائمة الخيارات نفسها اختر «حظر». المحظور لا يستطيع مراسلتك ولا رؤية محتواك، ولن ترى محتواه. تدير قائمة المحظورين من الإعدادات ثم الخصوصية والأمان ثم المستخدمون المحظورون.',
        en: 'From the same options menu choose Block. A blocked person cannot message you or see your content, and you will not see theirs. Manage your blocked list in Settings, then Privacy and security, then Blocked users.',
      },
    },
    {
      h: { ar: 'ماذا يحدث بعد البلاغ', en: 'What happens after a report' },
      p: {
        ar: 'يراجع فريقنا كل بلاغ خلال 24 ساعة. المحتوى المخالف يُزال والحساب المسؤول عنه يُغلق. والمحتوى الذي يتلقى عدة بلاغات يُخفى تلقائيًا ريثما تكتمل المراجعة. وقبل ذلك، يُفحص المحتوى المنشور والقصص آليًا قبل النشر، أمّا الرسائل الخاصة والمكالمات فلا تُفحص آليًا.',
        en: 'Our team reviews every report within 24 hours. Content that breaks these rules is removed and the account responsible is terminated. Content that receives several reports is hidden automatically while the review is completed. Before any of that, posts and stories are screened automatically before they are published; private messages and calls are not screened automatically.',
      },
    },
    {
      h: { ar: 'تواصل معنا', en: 'Contact us' },
      p: {
        ar: 'للأسئلة أو الشكاوى أو البلاغات العاجلة راسلنا على البريد التالي. نرد خلال 24 ساعة.',
        en: 'For questions, complaints or urgent reports, email us. We reply within 24 hours.',
      },
    },
  ],
};
