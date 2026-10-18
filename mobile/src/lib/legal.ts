// Terms of Service and Privacy Policy, copied verbatim from LEGAL_DOCS in
// web/js/views.js. Both languages live here; the documents are never run
// through the translation layer.
export type Lang2 = { ar: string; en: string };
export type LegalDoc = { title: Lang2; sections: { h: Lang2; p: Lang2 }[] };

export const LEGAL_DOCS: Record<"terms" | "privacy", LegalDoc> = {
  "terms": {
    "title": {
      "ar": "شروط الخدمة",
      "en": "Terms of Service"
    },
    "sections": [
      {
        "h": {
          "ar": "قبول الشروط",
          "en": "Accepting these terms"
        },
        "p": {
          "ar": "باستخدامك تطبيق FLYP فإنك توافق على هذه الشروط. إذا لم توافق عليها، فلا تستخدم التطبيق. قد نحدّث هذه الشروط، وسنخطرك داخل التطبيق قبل سريان أي تغيير جوهري.",
          "en": "By using FLYP you agree to these terms. If you do not agree, please do not use the app. We may update these terms, and we will tell you in the app before any significant change takes effect."
        }
      },
      {
        "h": {
          "ar": "من يمكنه استخدام التطبيق",
          "en": "Who can use the app"
        },
        "p": {
          "ar": "يجب أن يكون عمرك 13 عامًا على الأقل لإنشاء حساب. بعض الميزات، مثل مشاركة الموقع والمزايا المالية، متاحة لمن هم في سن 18 فما فوق. أنت مسؤول عن دقة معلوماتك وعن الحفاظ على سرية كلمة المرور.",
          "en": "You must be at least 13 to create an account. Some features, such as location sharing and anything involving money, are limited to people aged 18 and over. You are responsible for the accuracy of your information and for keeping your password private."
        }
      },
      {
        "h": {
          "ar": "المحتوى الذي تنشره",
          "en": "Content you post"
        },
        "p": {
          "ar": "تحتفظ بملكية المحتوى الذي تنشره. بنشره تمنحنا ترخيصًا غير حصري لعرضه وتوزيعه داخل التطبيق لتشغيل الخدمة. يمكنك حذف محتواك في أي وقت، وقد تبقى نسخ في النسخ الاحتياطية لفترة محدودة.",
          "en": "You keep ownership of what you post. By posting it you give us a non-exclusive licence to display and distribute it within the app so the service can run. You can delete your content at any time; copies may remain in backups for a limited period."
        }
      },
      {
        "h": {
          "ar": "ما هو ممنوع",
          "en": "What is not allowed"
        },
        "p": {
          "ar": "يُمنع نشر محتوى ينتهك القانون أو حقوق الآخرين، أو يتضمن تحرشًا أو كراهية أو عنفًا أو محتوى جنسيًا أو معلومات مضللة ضارة. يُمنع أيضًا انتحال شخصية غيرك، أو التلاعب بالأرقام، أو محاولة اختراق الخدمة.",
          "en": "Do not post content that breaks the law or infringes other people’s rights, or that involves harassment, hate, violence, sexual content, or harmful misinformation. Do not impersonate anyone, manipulate engagement numbers, or attempt to attack the service."
        }
      },
      {
        "h": {
          "ar": "عدم التسامح مطلقًا مع المحتوى المسيء",
          "en": "Zero tolerance for objectionable content"
        },
        "p": {
          "ar": "لدينا سياسة عدم تسامح مطلقًا مع المحتوى المسيء ومع المستخدمين المسيئين. نراجع كل بلاغ خلال 24 ساعة كحد أقصى، ونزيل المحتوى المخالف ونغلق حساب من نشره. باستخدامك التطبيق فأنت توافق على هذه الشروط وعلى عدم نشر أي محتوى مسيء أو الإساءة إلى أي مستخدم.",
          "en": "We have a zero-tolerance policy for objectionable content and for abusive users. We review every report within 24 hours, remove content that breaks these rules, and terminate the account that posted it. By using FLYP you agree to these terms and agree not to post objectionable content or to abuse any user."
        }
      },
      {
        "h": {
          "ar": "إنهاء الحساب",
          "en": "Ending your account"
        },
        "p": {
          "ar": "يمكنك حذف حسابك في أي وقت من الإعدادات. يجوز لنا تعليق أو إنهاء حساب يخالف هذه الشروط، وسنوضح السبب متى أمكن ذلك.",
          "en": "You can delete your account at any time from Settings. We may suspend or end an account that breaks these terms, and we will explain why where we can."
        }
      },
      {
        "h": {
          "ar": "حدود المسؤولية",
          "en": "Limits of our responsibility"
        },
        "p": {
          "ar": "يُقدَّم التطبيق كما هو. لا نضمن أن يكون متاحًا دون انقطاع أو خاليًا من الأخطاء. لا نتحمل مسؤولية المحتوى الذي ينشره المستخدمون الآخرون.",
          "en": "The app is provided as it is. We do not guarantee it will be available without interruption or free of faults, and we are not responsible for content other people post."
        }
      }
    ]
  },
  "privacy": {
    "title": {
      "ar": "سياسة الخصوصية",
      "en": "Privacy Policy"
    },
    "sections": [
      {
        "h": {
          "ar": "ما الذي نجمعه",
          "en": "What we collect"
        },
        "p": {
          "ar": "بيانات الحساب: الاسم، اسم المستخدم، البريد الإلكتروني، وصورة الملف الشخصي إن أضفتها. المحتوى: الفيديوهات والتعليقات والرسائل التي ترسلها. بيانات الاستخدام: ما تشاهده ومدة المشاهدة، لترتيب الموجز. بيانات الجهاز: نوع الجهاز والمتصفح، لتشخيص الأعطال.",
          "en": "Account details: your name, username, email address, and profile photo if you add one. Content: the videos, comments, and messages you send. Usage: what you watch and for how long, which is how the feed is ordered. Device: your device and browser type, used to diagnose faults."
        }
      },
      {
        "h": {
          "ar": "الموقع الجغرافي",
          "en": "Location"
        },
        "p": {
          "ar": "لا نقرأ موقعك إطلاقًا ما لم تفعّل مشاركة الموقع بنفسك. عند تفعيلها نحتفظ بموقعك الحالي فقط، لا بسجل تحركاتك، ويُحذف بعد سبعة أيام من آخر تحديث. إيقاف المشاركة يمحو الإحداثيات فورًا.",
          "en": "We do not read your location at all unless you switch location sharing on yourself. When it is on we keep only your current position, never a history of your movements, and it is deleted seven days after the last update. Turning sharing off erases the coordinates immediately."
        }
      },
      {
        "h": {
          "ar": "من يرى بياناتك",
          "en": "Who can see your data"
        },
        "p": {
          "ar": "ملفك الشخصي ومنشوراتك العامة مرئية لمن تسمح لهم بذلك حسب إعداداتك. رسائلك الخاصة لا تظهر إلا لك ولمن تراسله. لا نبيع بياناتك الشخصية لأي طرف ثالث.",
          "en": "Your profile and public posts are visible to whoever your settings allow. Your private messages are visible only to you and the people you are messaging. We do not sell your personal data to anyone."
        }
      },
      {
        "h": {
          "ar": "الفحص التلقائي للمحتوى",
          "en": "Automated content screening"
        },
        "p": {
          "ar": "يُفحص المحتوى الذي تنشره للعامة تلقائيًا للكشف عن المواد غير الآمنة: الفيديوهات وأوصافها، والتعليقات، وعناوين البث المباشر وصوره ودردشته. يُرسَل هذا المحتوى إلى خدمة فحص تابعة لطرف ثالث لهذا الغرض وحده. لا تُرسَل رسائلك الخاصة إلى هذه الخدمة. يجري جزء من الفحص على جهازك قبل الرفع ولا يغادره. الفحص التلقائي ليس قرارًا نهائيًا: يمكنك الإبلاغ عن المحتوى المخالف، ويراجع البلاغات أشخاص.",
          "en": "Content you post publicly is screened automatically for unsafe material: videos and their captions, comments, and live stream titles, cover images and live chat. That content is sent to a third-party screening service for that purpose only. Your private messages are not sent to that service. Part of the check runs on your own device before upload and never leaves it. Automated screening is not the last word: you can report content, and reports are reviewed by people."
        }
      },
      {
        "h": {
          "ar": "من نستعين بهم",
          "en": "Who we work with"
        },
        "p": {
          "ar": "نستخدم مزوّدي خدمة لتشغيل التطبيق: استضافة قواعد البيانات والملفات، وإرسال البريد، والبث المباشر، وفحص المحتوى المنشور للعامة. يصل هؤلاء إلى البيانات اللازمة لأداء عملهم فقط.",
          "en": "We use service providers to run the app: database and file hosting, email delivery, live streaming, and screening publicly posted content. They can access only the data needed to do that job."
        }
      },
      {
        "h": {
          "ar": "كم نحتفظ بها",
          "en": "How long we keep it"
        },
        "p": {
          "ar": "نحتفظ ببيانات حسابك ما دام حسابك قائمًا. عند حذف الحساب تُحذف بياناتك خلال 30 يومًا، باستثناء ما يلزمنا قانونًا الاحتفاظ به. سجلات الموقع تُحذف خلال سبعة أيام.",
          "en": "We keep your account data for as long as your account exists. When you delete your account, your data is removed within 30 days, apart from anything we are legally required to keep. Location records are deleted within seven days."
        }
      },
      {
        "h": {
          "ar": "حقوقك",
          "en": "Your rights"
        },
        "p": {
          "ar": "يمكنك طلب نسخة من بياناتك من الإعدادات، وتصحيح معلوماتك في أي وقت، وحذف حسابك نهائيًا. إذا كنت في نطاق يمنحك حقوقًا إضافية، مثل النظام الأوروبي، فيمكنك مراسلتنا لممارستها.",
          "en": "You can request a copy of your data from Settings, correct your information at any time, and delete your account permanently. If you live somewhere that gives you further rights, such as under GDPR, contact us to exercise them."
        }
      },
      {
        "h": {
          "ar": "الأطفال",
          "en": "Children"
        },
        "p": {
          "ar": "التطبيق غير موجّه لمن هم دون 13 عامًا. إذا علمنا بوجود حساب لطفل دون هذه السن، فسنحذفه.",
          "en": "This app is not intended for anyone under 13. If we learn that an account belongs to a child under that age, we will delete it."
        }
      },
      {
        "h": {
          "ar": "كيف تتواصل معنا",
          "en": "How to reach us"
        },
        "p": {
          "ar": "لأي سؤال عن الخصوصية، استخدم \"تواصل معنا\" في الإعدادات أو راسلنا على support@flyp-sa.com.",
          "en": "For any privacy question, use Contact us in Settings or email support@flyp-sa.com."
        }
      }
    ]
  }
};
