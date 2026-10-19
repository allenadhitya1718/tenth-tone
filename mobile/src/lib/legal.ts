// Terms of Service and Privacy Policy shown in the app (LegalSheet). Started
// as a copy of LEGAL_DOCS in web/js/views.js; since 19 October 2026 it also
// covers what only this app does (calls, walkie-talkie, the friends map,
// stories, coins, push) and is a short form of site/terms.html and
// site/privacy.html. Both languages live here; the documents are never run
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
          "ar": "آخر تحديث: 19 أكتوبر 2026\n\nباستخدامك تطبيق FLYP فإنك توافق على هذه الشروط. إذا لم توافق عليها، فلا تستخدم التطبيق. قد نحدّث هذه الشروط، وسنخطرك داخل التطبيق قبل سريان أي تغيير جوهري. النص الكامل على flyp-sa.com/terms.html.",
          "en": "Last updated: 19 October 2026\n\nBy using FLYP you agree to these terms. If you do not agree, please do not use the app. We may update these terms, and we will tell you in the app before any significant change takes effect. The full text is at flyp-sa.com/terms.html."
        }
      },
      {
        "h": {
          "ar": "من يمكنه استخدام التطبيق",
          "en": "Who can use the app"
        },
        "p": {
          "ar": "يجب أن يكون عمرك 13 عامًا على الأقل لإنشاء حساب. مشاركة الموقع متاحة فقط لمن هم في سن 18 فما فوق، ومن هم دون 18 لا يشترون العملات إلا بإذن وليّ الأمر. أنت مسؤول عن دقة معلوماتك وعن الحفاظ على سرية كلمة المرور.",
          "en": "You must be at least 13 to create an account. Location sharing is limited to people aged 18 and over, and anyone under 18 needs a parent’s or guardian’s permission to buy coins. You are responsible for the accuracy of your information and for keeping your password private."
        }
      },
      {
        "h": {
          "ar": "المحتوى الذي تنشره",
          "en": "Content you post"
        },
        "p": {
          "ar": "تحتفظ بملكية المحتوى الذي تنشره. بنشره تمنحنا ترخيصًا غير حصري لعرضه وتوزيعه داخل التطبيق لتشغيل الخدمة. يمكنك حذف محتواك في أي وقت، وقد تبقى نسخ في النسخ الاحتياطية لفترة محدودة. تظهر القصة 24 ساعة للجمهور الذي تختاره، ثم تبقى في أرشيفك سبعة أيام لا يراها غيرك، ثم تُحذف.",
          "en": "You keep ownership of what you post. By posting it you give us a non-exclusive licence to display and distribute it within the app so the service can run. You can delete your content at any time; copies may remain in backups for a limited period. A story is visible for 24 hours to the audience you choose, then stays in your archive, visible only to you, for seven days, and is then deleted."
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
          "ar": "المكالمات والتحدث بالضغط",
          "en": "Calls and walkie-talkie"
        },
        "p": {
          "ar": "تسري القواعد نفسها على المكالمات الصوتية والمرئية وعلى التحدث بالضغط داخل المحادثات. لا نسجّلها، ولا يجوز لك تسجيل مكالمة أو نشرها دون إذن من فيها. لا يمكنك الاتصال إلا بمن يقبل رسائلك وبينك وبينه صلة بدأها هو، ويمكنك حظر أي شخص لإيقاف مكالماته.",
          "en": "The same rules apply to voice and video calls and to push-to-talk walkie-talkie in chats. We do not record them, and you may not record or share a call without the permission of the people in it. You can only call someone who accepts messages from you and who has a connection with you that they started, and you can block anyone to stop their calls."
        }
      },
      {
        "h": {
          "ar": "خريطة الأصدقاء",
          "en": "The friends map"
        },
        "p": {
          "ar": "مشاركة الموقع متاحة لمن أتمّ 18 عامًا فقط، ومغلقة حتى تفعّلها بنفسك. استخدم الخريطة فقط لرؤية من اختاروا مشاركة مواقعهم معك. يُمنع استخدامها لملاحقة أحد أو تتبّعه أو مضايقته، أو للضغط على شخص كي يشارك موقعه، ويؤدي ذلك إلى إغلاق الحساب.",
          "en": "Location sharing is only for people aged 18 or over, and stays off until you switch it on yourself. Use the map only to see people who chose to share their location with you. Using it to follow, track or harass anyone, or to pressure someone into sharing, is not allowed and leads to account closure."
        }
      },
      {
        "h": {
          "ar": "العملات والهدايا",
          "en": "Coins and gifts"
        },
        "p": {
          "ar": "تُشترى العملات داخل التطبيق عبر App Store أو Google Play، ويتولى المتجر الدفع وفق شروطه. العملات ترخيص لاستخدام ميزة إرسال الهدايا في البث المباشر: ليست مالًا، ولا قيمة نقدية لها، ولا تُستبدل بمال، ولا تُباع ولا تُنقل إلى حساب آخر. عمليات الشراء نهائية وغير قابلة للاسترداد إلا عبر إجراءات الاسترداد لدى Apple أو Google أو حيث يمنحك القانون ذلك، وإن استُرد مبلغ شراء فقد نزيل العملات التي أضافها. عند إرسال هدية يُخصم سعرها من رصيدك ويُضاف إلى رصيد من استلمها، ولا يمكن استرجاعها. لا يمكن حاليًا صرف العملات أو الهدايا المستلمة نقدًا أو سحبها. وتسقط العملات غير المستخدمة عند حذف الحساب نهائيًا أو إغلاقه بسبب مخالفة.",
          "en": "Coins are bought in the app through the App Store or Google Play, and the store handles payment under its own terms. Coins are a licence to use the gift feature in live streams: they are not money, have no cash value, cannot be exchanged for money, and may not be sold or transferred to another account. Purchases are final and non-refundable, except through Apple’s or Google’s refund process or where the law gives you a refund, and if a purchase is refunded we may remove the coins it added. When you send a gift, its price is taken from your balance and added to the recipient’s, and it cannot be taken back. Coins and gifts you receive cannot currently be cashed out or withdrawn. Unused coins are lost if the account is permanently deleted, or closed for breaking these terms."
        }
      },
      {
        "h": {
          "ar": "إنهاء الحساب",
          "en": "Ending your account"
        },
        "p": {
          "ar": "يمكنك حذف حسابك في أي وقت من الإعدادات ← إيقاف الحساب أو حذفه. يختفي حسابك فورًا، ولديك 30 يومًا للتراجع، ثم يُحذف نهائيًا. يجوز لنا تعليق أو إنهاء حساب يخالف هذه الشروط، وسنوضح السبب متى أمكن ذلك.",
          "en": "You can delete your account at any time from Settings, then Deactivate or delete. Your account is hidden at once, you have 30 days to change your mind, and it is then deleted permanently. We may suspend or end an account that breaks these terms, and we will explain why where we can."
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
          "ar": "آخر تحديث: 19 أكتوبر 2026\n\nبيانات الحساب: الاسم، اسم المستخدم، البريد الإلكتروني، تاريخ الميلاد، وصورة الملف الشخصي إن أضفتها. وإن سجّلت الدخول عبر Apple، تشاركنا Apple بريدك أو عنوانًا وسيطًا خاصًا. المحتوى: الفيديوهات والقصص والتعليقات والرسائل، بما فيها الرسائل الصوتية. بيانات الاستخدام: ما تشاهده ومدة المشاهدة، لترتيب الموجز. بيانات الجهاز: نوع الجهاز ونسخة التطبيق، ورمز الإشعارات إن سمحت بها، وملاحظات تقنية قصيرة عند تعثّر ميزة، لتشخيص الأعطال. النص الكامل على flyp-sa.com/privacy.html.",
          "en": "Last updated: 19 October 2026\n\nAccount details: your name, username, email address, date of birth, and profile photo if you add one. If you sign in with Apple, Apple shares your email address or a private relay address. Content: the videos, stories, comments and messages you send, including voice messages. Usage: what you watch and for how long, which is how the feed is ordered. Device: your device type and app version, your notification token if you allow notifications, and short technical notes when a feature fails, used to diagnose faults. The full policy is at flyp-sa.com/privacy.html."
        }
      },
      {
        "h": {
          "ar": "الموقع الجغرافي",
          "en": "Location"
        },
        "p": {
          "ar": "لا نقرأ موقعك إطلاقًا ما لم تفعّل مشاركة الموقع بنفسك على خريطة الأصدقاء، وهي لمن أتمّ 18 عامًا فقط. يُرسل موقعك فقط أثناء فتح الخريطة، لا في الخلفية أبدًا، وتختار من يراك: الأصدقاء أو الجميع. نحتفظ بموقعك الحالي فقط، لا بسجل تحركاتك. إن مضت 8 ساعات على آخر تحديث لا يراه أحد غيرك، ويُحذف بعد سبعة أيام من آخر تحديث. إيقاف المشاركة يمحو الإحداثيات فورًا.",
          "en": "We do not read your location at all unless you switch location sharing on yourself on the friends map, which is only for people aged 18 or over. Your position is sent only while the map is open, never in the background, and you choose who sees you: friends or everyone. We keep only your current position, never a history of your movements. Once 8 hours pass without an update nobody but you can see it, and it is deleted seven days after the last update. Turning sharing off erases the coordinates immediately."
        }
      },
      {
        "h": {
          "ar": "المكالمات والتحدث بالضغط",
          "en": "Calls and walkie-talkie"
        },
        "p": {
          "ar": "ينتقل صوت المكالمات وصورتها والتحدث بالضغط لحظيًا عبر Agora، ولا نسجّلها ولا تُخزَّن. نحتفظ بسجل لكل مكالمة يظهر في المحادثة: من اتصل بمن، ومتى، ونوعها، وهل رُدّ عليها، ومدتها. التحدث بالضغط لا يترك أي سجل.",
          "en": "The audio and video of calls, and walkie-talkie, travel live through Agora and are not recorded or stored. We keep a record of each call, shown in the conversation: who called whom, when, the type of call, whether it was answered, and how long it lasted. Walkie-talkie leaves no record."
        }
      },
      {
        "h": {
          "ar": "من يرى بياناتك",
          "en": "Who can see your data"
        },
        "p": {
          "ar": "ملفك الشخصي ومنشوراتك العامة مرئية لمن تسمح لهم بذلك حسب إعداداتك. رسائلك الخاصة لا تظهر إلا لك ولمن تراسله. قائمة من شاهد قصتك لا يراها غيرك. لا نبيع بياناتك الشخصية لأي طرف ثالث.",
          "en": "Your profile and public posts are visible to whoever your settings allow. Your private messages are visible only to you and the people you are messaging. Only you can see who viewed your story. We do not sell your personal data to anyone."
        }
      },
      {
        "h": {
          "ar": "الفحص التلقائي للمحتوى",
          "en": "Automated content screening"
        },
        "p": {
          "ar": "يُفحص المحتوى الذي تنشره تلقائيًا للكشف عن المواد غير الآمنة: الفيديوهات وأوصافها، والقصص، والتعليقات، وعناوين البث المباشر وصوره ودردشته، والاسم والنبذة والصورة الشخصية. يُرسَل هذا المحتوى إلى خدمة Gemini من Google، وتُرسل إليها أيضًا صورة الغلاف أو صورة القصة لاقتراح الوسوم عند النشر. تتيح شروط Google لهذه الخدمة استخدام ما يُرسل لتحسين منتجاتها، وقد يطّلع عليه مراجعون لديها، ولذلك لا تُرسَل رسائلك الخاصة إليها أبدًا. الفحص التلقائي ليس قرارًا نهائيًا: يمكنك الإبلاغ عن المحتوى المخالف، ويراجع البلاغات أشخاص.",
          "en": "Content you post is screened automatically for unsafe material: videos and their captions, stories, comments, live stream titles, cover images and live chat, and your name, bio and profile photo. That content is sent to Google’s Gemini service, which also receives the cover image or story photo to suggest hashtags when you post. Google’s terms for that service let it use what is sent to improve its products and let its reviewers read it, which is why your private messages are never sent to it. Automated screening is not the last word: you can report content, and reports are reviewed by people."
        }
      },
      {
        "h": {
          "ar": "من نستعين بهم",
          "en": "Who we work with"
        },
        "p": {
          "ar": "نستخدم مزوّدي خدمة لتشغيل التطبيق: Supabase لقاعدة البيانات وتسجيل الدخول في منطقة مومباي بالهند، وCloudflare R2 لتخزين المقاطع والقصص وإيصالها من media.flyp-sa.com، وAgora للبث المباشر والمكالمات، وGoogle Gemini لفحص المحتوى واقتراح الوسوم، وFirebase Cloud Messaging من Google وخدمة إشعارات Apple لإيصال الإشعارات (يصلهما عنوان الإشعار ومقتطف قصير منه)، وApple Maps أو Google Maps لرسم الخريطة، وApp Store وGoogle Play لشراء العملات. الدفع يتم لدى المتجر، ولا نرى بيانات بطاقتك. قد تقع خوادم هؤلاء خارج بلدك.",
          "en": "We use service providers to run the app: Supabase for the database and sign-in, in its Mumbai region in India; Cloudflare R2 for storing clips and stories and delivering them from media.flyp-sa.com; Agora for live streaming and calls; Google Gemini for content screening and hashtag suggestions; Google Firebase Cloud Messaging and the Apple Push Notification service for notifications (they receive the notification’s title and a short preview); Apple Maps or Google Maps for drawing the map; and the App Store and Google Play for buying coins. Payment happens in the store, and we never see your card details. These providers’ servers may be outside your country."
        }
      },
      {
        "h": {
          "ar": "كم نحتفظ بها",
          "en": "How long we keep it"
        },
        "p": {
          "ar": "نحتفظ ببيانات حسابك، بما فيها سجل المكالمات وسجل شراء العملات والهدايا، ما دام حسابك قائمًا. عند طلب حذف الحساب يُخفى فورًا، ويُحذف نهائيًا مع كل بياناته بعد 30 يومًا، باستثناء ما يلزمنا قانونًا الاحتفاظ به. القصص تُحذف بعد سبعة أيام من انتهائها. سجل الموقع يُحذف بعد سبعة أيام دون تحديث.",
          "en": "We keep your account data, including call records and coin purchase and gift records, for as long as your account exists. When you ask to delete your account it is hidden at once, and it is permanently deleted with all its data after 30 days, apart from anything we are legally required to keep. Stories are deleted seven days after they expire. The location record is deleted after seven days without an update."
        }
      },
      {
        "h": {
          "ar": "حقوقك",
          "en": "Your rights"
        },
        "p": {
          "ar": "يمكنك طلب نسخة من بياناتك من الإعدادات ← تنزيل بياناتك، وتصحيح معلوماتك في أي وقت، وحذف حسابك نهائيًا من الإعدادات ← إيقاف الحساب أو حذفه. ويمكنك سحب إذن الموقع أو الكاميرا أو الميكروفون أو الإشعارات من إعدادات هاتفك. إذا كنت في نطاق يمنحك حقوقًا إضافية، مثل النظام الأوروبي، فيمكنك مراسلتنا لممارستها.",
          "en": "You can request a copy of your data from Settings, then Download your data, correct your information at any time, and delete your account permanently from Settings, then Deactivate or delete. You can withdraw the location, camera, microphone or notification permission in your phone’s settings. If you live somewhere that gives you further rights, such as under GDPR, contact us to exercise them."
        }
      },
      {
        "h": {
          "ar": "الأطفال",
          "en": "Children"
        },
        "p": {
          "ar": "التطبيق غير موجّه لمن هم دون 13 عامًا. إذا علمنا بوجود حساب لطفل دون هذه السن، فسنحذفه. مشاركة الموقع مغلقة لمن هم دون 18 عامًا.",
          "en": "This app is not intended for anyone under 13. If we learn that an account belongs to a child under that age, we will delete it. Location sharing is closed to anyone under 18."
        }
      },
      {
        "h": {
          "ar": "كيف تتواصل معنا",
          "en": "How to reach us"
        },
        "p": {
          "ar": "لأي سؤال عن الخصوصية، استخدم \"تواصل معنا\" في الإعدادات أو راسلنا على privacy@flyp-sa.com أو support@flyp-sa.com.",
          "en": "For any privacy question, use Contact us in Settings or email privacy@flyp-sa.com or support@flyp-sa.com."
        }
      }
    ]
  }
};
