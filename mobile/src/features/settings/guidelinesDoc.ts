// Community Guidelines, copied verbatim from GUIDELINES_DOC in
// web/js/views.js. Like the legal documents (lib/legal.ts), both languages
// live here and the text never goes through the translation layer.
import type { LegalDoc } from '@/lib/legal';

export const SUPPORT_EMAIL = 'support@flyp-sa.com';

export const GUIDELINES_DOC: LegalDoc = {
  title: { ar: 'قواعد المجتمع', en: 'Community Guidelines' },
  sections: [
    {
      h: { ar: 'عدم التسامح مطلقًا', en: 'Zero tolerance' },
      p: {
        ar: 'لدينا سياسة عدم تسامح مطلقًا مع المحتوى المسيء ومع المستخدمين المسيئين. نراجع كل بلاغ خلال 24 ساعة كحد أقصى، ونزيل المحتوى المخالف ونغلق حساب من نشره.',
        en: 'We have a zero-tolerance policy for objectionable content and for abusive users. We review every report within 24 hours at most, remove content that breaks these rules, and terminate the account that posted it.',
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
        ar: 'يراجع فريقنا كل بلاغ خلال 24 ساعة. المحتوى المخالف يُزال والحساب المسؤول عنه يُغلق. والمحتوى الذي يتلقى عدة بلاغات يُخفى تلقائيًا ريثما تكتمل المراجعة.',
        en: 'Our team reviews every report within 24 hours. Content that breaks these rules is removed and the account responsible is terminated. Content that receives several reports is hidden automatically while the review is completed.',
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
