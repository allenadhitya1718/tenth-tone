/* === FLYP — bilingual (Arabic ⇄ English) layer ===
 *
 * The app is authored in Arabic. This module retrofits English on top
 * WITHOUT touching every view: after each render it walks the DOM and
 * swaps any text/placeholder/title whose EXACT value is a known UI
 * label. Exact-match only → user content (names, messages, video
 * captions) never matches a label key, so it is always left untouched.
 *
 * Language is persisted in localStorage('tt-lang'). Switching also flips
 * <html dir> between rtl/ltr and re-renders the current screen.
 */
(function () {
  'use strict';

  // ── AR → EN dictionary for every static UI string ──
  const DICT = {
    // Splash / auth
    'شارك لحظتك مع العالم': 'Share your moment with the world',
    'تسجيل الدخول': 'Log in',
    'إنشاء حساب جديد': 'Create new account',
    'إنشاء حساب': 'Sign up',
    'مرحبًا بعودتك': 'Welcome back',
    'سجّل دخولك للمتابعة': 'Sign in to continue',
    'البريد الإلكتروني أو رقم الهاتف': 'Email or phone number',
    'كلمة المرور': 'Password',
    'نسيت كلمة المرور؟': 'Forgot password?',
    'ليس لديك حساب؟': "Don't have an account?",
    'جاري تسجيل الدخول...': 'Signing in...',
    'بيانات الدخول غير صحيحة': 'Invalid login details',
    'البريد لم يُفعَّل بعد — تحقق من بريدك': 'Email not verified yet — check your inbox',
    'الرجاء إدخال جميع الحقول': 'Please fill in all fields',
    'البريد الإلكتروني': 'Email',
    'رقم الهاتف': 'Phone number',
    'تأكيد كلمة المرور': 'Confirm password',
    'كلمة المرور 8 أحرف على الأقل': 'Password must be at least 8 characters',
    'كلمتا المرور غير متطابقتين': 'Passwords do not match',
    'اسم المستخدم محجوز': 'Username is taken',
    'البريد مسجَّل مسبقًا': 'Email is already registered',
    'بإنشاء حساب أنت توافق على الشروط وسياسة الخصوصية.': 'By creating an account you agree to the Terms and Privacy Policy.',
    'جاري إنشاء الحساب...': 'Creating account...',
    'أدخل رمز التحقق': 'Enter verification code',
    'أرسلنا لك رمزًا مكونًا من 6 أرقام': 'We sent you a 6-digit code',
    'تم إرسال رمز التحقق': 'Verification code sent',
    'تم إرسال الرمز مرة أخرى': 'Code sent again',
    'لم يصلك الرمز؟': "Didn't get the code?",
    'إعادة الإرسال': 'Resend',
    'التحقق': 'Verify',
    'تحقق ومتابعة': 'Verify & continue',
    'جاري التحقق...': 'Verifying...',
    'استعادة كلمة المرور': 'Reset password',
    'سنرسل لك رابط/رمز إعادة تعيين': "We'll send you a reset link/code",
    'تم إرسال رابط إعادة التعيين إلى بريدك': 'A reset link was sent to your email',
    'أدخل بريدًا أو رقم هاتف صحيح': 'Enter a valid email or phone number',
    'كلمة مرور جديدة': 'New password',
    'أدخل كلمة مرور جديدة': 'Enter a new password',
    'كلمة المرور الجديدة': 'New password',
    '8 أحرف على الأقل، تشمل رقمًا ورمزًا.': 'At least 8 characters, including a number and a symbol.',
    'تم تحديث كلمة المرور': 'Password updated',
    'حفظ كلمة المرور': 'Save password',
    'محاولات كثيرة — حاول لاحقًا': 'Too many attempts — try again later',
    'حدث خطأ، حاول مجددًا': 'Something went wrong, try again',
    'تعذر الاتصال — تحقق من الإنترنت': 'Connection failed — check your internet',
    'انتهت الجلسة — أعد التسجيل': 'Session expired — sign in again',
    'التالي': 'Next',

    // Bottom nav / common
    'الرئيسية': 'Home',
    'الدعم': 'Support',
    'المزيد': 'More',
    'القائمة': 'Menu',
    'استكشف': 'Discover',
    'إنشاء': 'Create',
    'صندوق الوارد': 'Inbox',
    'البروفايل': 'Profile',
    'بحث': 'Search',
    'إلغاء': 'Cancel',
    'حذف': 'Delete',
    'حفظ': 'Save',
    'إرسال': 'Send',
    'رد': 'Reply',
    'مشاركة': 'Share',
    'متابعة': 'Follow',
    'تتم المتابعة': 'Following',
    'مراسلة': 'Message',
    'تحميل': 'Loading',
    'جاري التحميل...': 'Loading...',
    'خطأ': 'Error',
    'خطأ في التحميل:': 'Load error:',
    'تم': 'Done',
    'تم الحفظ': 'Saved',
    'تم التحديث': 'Updated',
    'تم الإرسال': 'Sent',
    'تم الإلغاء': 'Cancelled',
    'تم النسخ': 'Copied',
    'تم الرفض': 'Rejected',
    'فشل': 'Failed',
    'قريبًا': 'Coming soon',
    'قيد التطوير': 'Under development',
    'غير متصل': 'Offline',

    // Home / feed
    'متصل الآن': 'Online now',
    'آخر ظهور قريبًا': 'Last seen recently',
    'إعجاب': 'Like',
    'إعجابات': 'Likes',
    'تعليق': 'Comment',
    'تعليقات': 'Comments',
    'صوت': 'Sound',
    'أصوات': 'Sounds',
    'الأصلي': 'Original',

    // Discover / search
    'استكشف حسابات': 'Discover accounts',
    'ابحث عن مستخدمين، فيديوهات، أو هاشتاجات': 'Search users, videos, or hashtags',
    'ابحث عن مستخدم بالاسم': 'Search for a user by name',
    'هاشتاجات': 'Hashtags',
    'هاشتاجات رائجة': 'Trending hashtags',
    'فيديوهات شائعة': 'Popular videos',
    'حسابات': 'Accounts',
    'فلترة بحسب': 'Filter by',
    'الكل': 'All',
    'لا يوجد مستخدمون': 'No users',

    // Create / camera / upload
    'استخدم الكاميرا لتصوير فيديو قصير': 'Use the camera to record a short video',
    'اختر فيديو أو صورة من المعرض': 'Pick a video or photo from the gallery',
    'تسجيل فيديو': 'Record video',
    'كاميرا': 'Camera',
    'رفع من المعرض بدلًا من ذلك': 'Upload from gallery instead',
    'رفع من الجهاز': 'Upload from device',
    'رفع من المعرض': 'Upload from gallery',
    'اختر ملف فيديو أو صورة أولاً': 'Pick a video or image file first',
    'المتصفح لا يدعم التسجيل': 'Browser does not support recording',
    'الرجاء السماح بالوصول إلى الكاميرا والميكروفون.': 'Please allow access to the camera and microphone.',
    'تعذر فتح الكاميرا': 'Could not open the camera',
    // Camera permission states — each failure is named separately so the
    // screen can say which one happened rather than one catch-all message.
    'الكاميرا محظورة': 'Camera blocked',
    'تم رفض إذن الكاميرا سابقًا. لا يمكن للتطبيق طلبه مرة أخرى — فعّله من إعدادات جهازك.':
      'Camera permission was denied earlier. The app cannot ask again — enable it in your device settings.',
    'تم رفض إذن الكاميرا. فعّله من إعدادات جهازك ثم عد.':
      'Camera permission was denied. Enable it in your device settings, then come back.',
    'يحتاج التطبيق إلى إذن الكاميرا والميكروفون للتصوير.':
      'The app needs camera and microphone permission to record.',
    'لا توجد كاميرا': 'No camera found',
    'لم يعثر التطبيق على كاميرا متاحة على هذا الجهاز.': 'The app could not find an available camera on this device.',
    'الكاميرا قيد الاستخدام': 'Camera in use',
    'تطبيق آخر يستخدم الكاميرا. أغلقه ثم أعد المحاولة.': 'Another app is using the camera. Close it and try again.',
    'الميكروفون محظور — سيتم التسجيل بدون صوت': 'Microphone blocked — recording without sound',
    'إعادة المحاولة': 'Try again',
    'إدارة الأذونات': 'Manage permissions',
    'معاينة الفيديو': 'Video preview',
    'تعديل الفيديو': 'Edit video',
    'صف فيديوك، أضف وسومًا (#) أو ذكر مستخدمين (@)': 'Describe your video, add hashtags (#) or mention users (@)',
    'إضافة موقع': 'Add location',
    'الإشارة إلى أشخاص': 'Tag people',
    'من يستطيع المشاهدة': 'Who can watch',
    'السماح بالتعليقات': 'Allow comments',
    'السماح بالحفظ': 'Allow saving',
    'نشر': 'Post',
    'جاري النشر...': 'Posting...',
    'تم النشر بنجاح': 'Posted successfully',
    'حفظ كمسودة': 'Save as draft',
    'تم الحفظ كمسودة': 'Saved as draft',
    'تعذر النشر': 'Could not post',
    'تعذر الرفع': 'Upload failed',
    'تعذر الحفظ': 'Could not save',
    'غلاف': 'Cover',
    'مؤثرات': 'Effects',
    'فلاتر': 'Filters',
    'سرعة': 'Speed',
    'مؤقت': 'Timer',
    'موسيقى': 'Music',
    'نص': 'Text',
    'ملصقات': 'Stickers',
    'قوالب جاهزة': 'Ready templates',
    'ابدأ من قالب وعدّله': 'Start from a template and edit it',

    // Inbox / chat
    'لا توجد محادثات بعد': 'No conversations yet',
    'ابدأ محادثة': 'Start a conversation',
    'محادثة جديدة': 'New chat',
    'مجموعة جديدة': 'New group',
    'إنشاء جديد': 'Create new',
    'اسم المجموعة': 'Group name',
    'أدخل اسم المجموعة': 'Enter a group name',
    'صورة المجموعة (اختياري)': 'Group photo (optional)',
    'إنشاء المجموعة': 'Create group',
    'اختر عضوًا واحدًا على الأقل': 'Pick at least one member',
    'اكتب رسالة...': 'Type a message...',
    'رسالة': 'Message',
    'أرسل رسالة': 'Send a message',
    'رسالة صوتية': 'Voice message',
    'إرفاق ملف': 'Attach file',
    'إرسال مقطع فيديو': 'Send a video clip',
    'إرسال الرابط': 'Send link',
    'اضغط مطولًا للتحدث': 'Hold to talk',
    'يتحدث الآن...': 'is talking now...',
    'تعذر إرسال المقطع': 'Could not send the clip',
    'تعذر فتح المحادثة': 'Could not open the conversation',
    'لا يمكنك مراسلة نفسك': "You can't message yourself",
    'تعذر الإرسال': 'Send failed',
    'مجموعة': 'Group',
    'محادثة': 'Chat',

    // Notifications
    'الإشعارات': 'Notifications',
    'إشعارات': 'Notifications',
    'لا توجد إشعارات بعد': 'No notifications yet',
    'أعجبه الفيديو الخاص بك': 'liked your video',
    'بدأ بمتابعتك': 'started following you',
    'ذكرك في تعليق': 'mentioned you in a comment',
    'أرسلت لك هدية': 'sent you a gift',
    'علّق:': 'commented:',
    'طلب تتبع موقعك': 'requested to track your location',
    'وافق على طلب تتبع موقعه': 'Approve their location-tracking request',
    'رفض طلب تتبع موقعه': 'Deny their location-tracking request',
    'وافقت على المشاركة': 'You approved sharing',
    'موافقة': 'Approve',
    'رفض': 'Deny',

    // Comments
    'أضف تعليقًا...': 'Add a comment...',
    'أرسل تعليقًا...': 'Send a comment...',
    'أرسل': 'Send',

    // Share
    'مشاركة عبر': 'Share via',
    'نسخ الرابط': 'Copy link',
    'إرسال الرابط': 'Send link',

    // Live
    'بث مباشر': 'Live',
    'مباشر': 'Live',
    'بثوث مباشرة': 'Live streams',
    'البثوث المباشرة': 'Live streams',
    'ابدأ بثًا مباشرًا': 'Start a live stream',
    'بدء البث': 'Start streaming',
    'بدء': 'Start',
    'جاري البدء...': 'Starting...',
    'عنوان البث (اختياري)': 'Stream title (optional)',
    'تواصل مع جمهورك مباشرة': 'Connect with your audience live',
    'تواصل مع جمهورك مباشرة': 'Connect with your audience live',
    'بث صوتي مع خلفية — لا يحتاج كاميرا': 'Audio stream with a background — no camera needed',
    'بث فيديو فعلي عبر الكاميرا والميكروفون': 'Real video stream via camera and microphone',
    'خلفية فقط': 'Background only',
    'غير مضبوط — البث بدون فيديو فعلي': 'Not configured — streaming without real video',
    'تعذر بدء البث': 'Could not start the stream',
    'لا توجد بثوث الآن': 'No live streams right now',

    // Map / location
    'خريطة الأصدقاء': 'Friends map',
    'الأصدقاء': 'Friends',
    'أنت هنا': 'You are here',
    'جاري تحميل الخريطة...': 'Loading map...',
    'اسحب للأعلى لعرض القائمة': 'Swipe up to view the list',
    'لا يوجد أصدقاء قريبين': 'No friends nearby',
    'الوضع الخفي': 'Ghost mode',
    'الوضع الخفي مُعطَّل': 'Ghost mode off',
    'الوضع الخفي مُفعَّل — موقعك مخفي': 'Ghost mode on — your location is hidden',
    'على الخريطة': 'on the map',
    'تتبع على الخريطة الآن': 'Track on the map now',
    'لم نعثر على هذا الصديق على الخريطة': "Couldn't find this friend on the map",
    'طلب تتبع الموقع': 'Request location tracking',
    'في انتظار الموافقة': 'Awaiting approval',
    'يتم التتبع — اضغط للإلغاء': 'Tracking — tap to cancel',
    'تم الرفض — أعد الطلب': 'Denied — request again',
    'تم إرسال طلب التتبع — بانتظار الموافقة': 'Tracking request sent — awaiting approval',
    'تم إلغاء التتبع': 'Tracking cancelled',
    'صديق': 'friend',
    'صديقان': 'friends',
    'أصدقاء': 'friends',

    // Wallet
    'المحفظة': 'Wallet',
    'الرصيد المتاح': 'Available balance',
    'شحن': 'Top up',
    'سحب': 'Withdraw',
    'شحن المحفظة': 'Top up wallet',
    'سحب الأرباح': 'Withdraw earnings',
    'الأكثر شعبية': 'Most popular',
    'أو أدخل عددًا مخصصًا': 'Or enter a custom amount',
    'شحن مبلغ مخصص': 'Top up a custom amount',
    'الدفع الفعلي عبر Stripe / Apple Pay سيتم تفعيله قبل الإطلاق الرسمي': 'Real payment via Stripe / Apple Pay will be enabled before the official launch',
    'الحد الأدنى: 100 عملة': 'Minimum: 100 coins',
    'الحد الأدنى للسحب 100 عملة': 'Minimum withdrawal is 100 coins',
    'العدد': 'Amount',
    'طريقة الاستلام': 'Payout method',
    'تحويل بنكي': 'Bank transfer',
    'تأكيد السحب': 'Confirm withdrawal',
    'جاري التحويل...': 'Processing...',
    'أدخل عددًا صحيحًا': 'Enter a valid number',
    'تم شحن': 'Topped up',
    'عملة': 'coins',
    'فشل الشحن': 'Top-up failed',
    'فشل السحب': 'Withdrawal failed',
    'تم تسجيل طلب السحب — سيصلك المبلغ خلال 3-5 أيام عمل': 'Withdrawal request submitted — funds arrive in 3-5 business days',
    'رصيد غير كافٍ — اشحن المحفظة': 'Insufficient balance — top up your wallet',
    'إيرادات': 'Income',
    'صادر': 'Outgoing',
    'لا توجد عمليات': 'No transactions',
    'تعذر إرسال الهدية': 'Could not send the gift',
    'الهدايا': 'Gifts',
    'ر.س': 'SAR',

    // Settings
    'الإعدادات والخصوصية': 'Settings & Privacy',
    'الحساب': 'Account',
    'تعديل البروفايل': 'Edit profile',
    'تغيير كلمة المرور': 'Change password',
    'كلمة المرور الجديدة (8 أحرف على الأقل):': 'New password (at least 8 characters):',
    'كلمة المرور قصيرة جدًا': 'Password is too short',
    'تغيير البريد الإلكتروني': 'Change email',
    'البريد الإلكتروني الجديد:': 'New email:',
    'تحقق من بريدك الجديد للتأكيد': 'Check your new inbox to confirm',
    'الخصوصية والأمان': 'Privacy & Security',
    'الحساب خاص': 'Private account',
    // Shown in place of the video grid on a private account you do not follow.
    'هذا الحساب خاص': 'This account is private',
    'تابع هذا الحساب لرؤية فيديوهاته': 'Follow this account to see its videos',
    // Chat: replies, reactions, emoji picker
    'ردًا على نفسك': 'Replying to yourself',
    'إلغاء الرد': 'Cancel reply',
    'رسالة محذوفة': 'Deleted message',
    // Call records in the thread, and the call screens
    'مكالمة صادرة': 'Outgoing call',
    'مكالمة واردة': 'Incoming call',
    'مكالمة فائتة': 'Missed call',
    'مكالمة مرفوضة': 'Declined call',
    'مكالمة لم تكتمل': 'Call not completed',
    'مكبر الصوت': 'Speaker',
    // Live setup screen
    'الوضع': 'Mode',
    'من يمكنه المشاهدة': 'Who can watch',
    'سيراك المشاهدون ويسمعونك مباشرة': 'Viewers will see and hear you live',
    'إذن الكاميرا مرفوض — فعّله من إعدادات جهازك أو ابدأ بثًا بخلفية':
      'Camera permission denied — enable it in your device settings, or stream with a background',
    'تعذر فتح الكاميرا — يمكنك البث بخلفية بدلًا من ذلك':
      'Could not open the camera — you can stream with a background instead',
    'بدأ بثًا مباشرًا الآن': 'started a live broadcast',
    // Live viewer
    'سينتهي البث لجميع المشاهدين ولا يمكن استئنافه.': 'The broadcast will end for all viewers and cannot be resumed.',
    'بدأ بثك المباشر': 'Your live has started',
    'انتهى بثك': 'Your live has ended',
    'انتهى البث': 'The broadcast has ended',
    'شكرًا لمشاهدتك': 'Thanks for watching',
    'بثوث أخرى': 'Other broadcasts',
    // Inbox: message requests
    'الطلبات': 'Requests',
    'قبل طلب المتابعة': 'accepted your follow request',
    'يريد متابعتك': 'wants to follow you',
    // Chat: date dividers and the read receipt
    'تمت المشاهدة': 'Seen',
    // Signup: username step
    'أحرف إنجليزية وأرقام و _ و . فقط': 'Letters, numbers, _ and . only',
    'ثلاثة أحرف على الأقل': 'At least three characters',
    'جارٍ التحقق...': 'Checking...',
    'متاح': 'Available',
    'اسم المستخدم محجوز': 'Username taken',
    'اسم المستخدم محجوز، اختر غيره': 'That username is taken, pick another',
    'أدخل اسم مستخدم من ثلاثة أحرف على الأقل': 'Enter a username of at least three characters',
    'اسمك كما سيظهر للآخرين، واسم المستخدم، وتاريخ ميلادك': 'Your name as others will see it, your username, and your date of birth',
    'تسجيل دخول جديد إلى حسابك': 'New sign-in to your account',
    'تحديث جديد': 'New update',
    // Share sheet — "contacts" was misleading, this list is followers
    'إرسال إلى متابعيك': 'Send to your followers',
    'لا يوجد أشخاص بعد': 'No one here yet',
    'تابع أشخاصًا لمشاركة الفيديوهات معهم مباشرة': 'Follow people to share videos with them directly',
    'هذا الشخص لا تتابعه. هل تريد قبول رسالته؟': 'You do not follow this person. Accept their message?',
    'تم قبول الطلب': 'Request accepted',
    'تم حذف الطلب': 'Request deleted',
    'تعذر القبول': 'Could not accept',
    'تعذر الحذف': 'Could not delete',
    '📎 ملف': '📎 File',
    '📍 موقع': '📍 Location',
    // Profile / lists
    'تابع أشخاصًا لبدء محادثة معهم': 'Follow people to start a conversation',
    'صورة أو فيديو': 'Photo or video',
    'مشاركة الملف الشخصي': 'Share profile',
    'حسابك أصبح خاصًا': 'Your account is now private',
    'حسابك أصبح عامًا': 'Your account is now public',
    'من يمكنه مراسلتي': 'Who can message me',
    'من يمكنه التعليق': 'Who can comment',
    'الجميع': 'Everyone',
    'المستخدمون المحظورون': 'Blocked users',
    'مراجعة طلبات تتبع موقعي': 'Review location-tracking requests',
    'لا توجد طلبات جديدة': 'No new requests',
    'طلب — راجعها من شاشة الإشعارات': 'request(s) — review them in Notifications',
    'المتابعون الجدد': 'New followers',
    'الرسائل': 'Messages',
    'المحتوى والعرض': 'Content & Display',
    'اللغة': 'Language',
    'العربية': 'Arabic',
    'الوضع الداكن': 'Dark mode',
    'تشغيل تلقائي للفيديو': 'Autoplay videos',
    'حفظ بيانات الإنترنت': 'Data saver',
    'الموقع الجغرافي': 'Location',
    'مشاركة موقعي مع': 'Share my location with',
    'تفعيل مشاركة الموقع': 'Enable location sharing',
    'تمت مشاركة موقعك': 'Your location is now shared',
    'تم إيقاف المشاركة': 'Sharing stopped',
    'الدعم والقانوني': 'Support & Legal',
    'الإبلاغ عن مشكلة': 'Report a problem',
    'تواصل معنا': 'Contact us',
    'تأكيد': 'Confirm',
    'استخدم 8 أحرف على الأقل.': 'Use at least 8 characters.',
    'تحديث': 'Update',
    'سنرسل رابط تأكيد إلى العنوان الجديد.': 'We will send a confirmation link to the new address.',
    'البريد الإلكتروني الجديد': 'New email address',
    'بريد إلكتروني غير صالح': 'Enter a valid email address',
    'سيتم حذف جميع الفيديوهات والمحفظة والمحادثات. لا يمكن التراجع عن هذا الإجراء.': 'All your videos, wallet, and conversations will be deleted. This cannot be undone.',
    'تأكيد الحذف': 'Confirm deletion',
    'حذف الحساب': 'Delete account',
    'اكتب الكلمة بالضبط': 'Type the word exactly',
    'متابعة الحذف': 'Continue',
    'اكتب هنا': 'Type here',
    'تأكيد هويتك': 'Confirm your identity',
    'كلمة المرور الحالية': 'Current password',
    'نسيت كلمة المرور الحالية؟': 'Forgot your current password?',
    'أرسلنا رابط إعادة التعيين إلى بريدك': 'We sent a reset link to your email',
    'لا يوجد بريد إلكتروني على هذا الحساب': 'This account has no email address',
    'تأكيد كلمة المرور الجديدة': 'Confirm new password',
    'أعد كتابة كلمة المرور': 'Re-enter the password',
    '8 أحرف على الأقل': 'At least 8 characters',
    'رقم واحد على الأقل': 'At least one number',
    'حرف واحد على الأقل': 'At least one letter',
    'ضعيفة': 'Weak',
    'متوسطة': 'Medium',
    'قوية': 'Strong',
    'بعد التغيير سيتم تسجيل الخروج من جميع أجهزتك الأخرى.': 'You will be signed out on all your other devices.',
    'جارٍ الحفظ...': 'Saving...',
    'جارٍ الإرسال...': 'Sending...',
    'كلمة المرور الحالية غير صحيحة': 'Current password is incorrect',
    'كلمة المرور غير صحيحة': 'Password is incorrect',
    'اختر كلمة مرور مختلفة عن الحالية': 'Choose a password different from your current one',
    'تم تغيير كلمة المرور': 'Password changed',
    'تعذر التغيير': 'Could not change it',
    'البريد الحالي': 'Current email',
    'البريد الجديد': 'New email',
    'هذا هو بريدك الحالي': 'That is already your current email',
    'سنرسل رابط تأكيد إلى العنوان الجديد. لن يتغير بريدك حتى تفتح ذلك الرابط.': 'We will send a confirmation link to the new address. Your email will not change until you open that link.',
    'تحقق من بريدك الجديد': 'Check your new inbox',
    'إعدادات الإشعارات': 'Notification settings',
    'اختر ما تريد أن نخبرك به. تنبيهات الأمان تصلك دائمًا.': 'Choose what we tell you about. Security alerts always come through.',
    'أجهزة تسجيل الدخول': 'Login devices',
    'هذه الأجهزة سجّلت الدخول إلى حسابك. إذا لم تتعرف على أحدها، أزله ثم غيّر كلمة المرور.': 'These devices have signed in to your account. If you do not recognise one, remove it and change your password.',
    'هذا الجهاز': 'This device',
    'جهاز غير معروف': 'Unknown device',
    'لا توجد أجهزة مسجّلة': 'No devices recorded',
    'سيظهر جهازك هنا بعد إعادة فتح التطبيق': 'Your device appears here after you reopen the app',
    'أذونات الجهاز': 'Device permissions',
    'يمنح جهازك هذه الأذونات، لا التطبيق. إذا رُفض إذن، غيّره من إعدادات جهازك.': 'Your device grants these, not the app. If one is denied, change it in your device settings.',
    'لتصوير الفيديوهات والبث المباشر': 'To record videos and go live',
    'الميكروفون': 'Microphone',
    'لتسجيل الصوت والمكالمات': 'To record audio and take calls',
    'لمشاركة موقعك مع أصدقائك': 'To share your location with friends',
    'لتنبيهك بالرسائل والتفاعلات': 'To alert you about messages and activity',
    'مسموح': 'Allowed',
    'مرفوض': 'Denied',
    'السماح': 'Allow',
    'الأرشفة والتنزيل': 'Archiving and downloading',
    'المنشورات المؤرشفة': 'Archived posts',
    'المنشور المؤرشف يختفي من ملفك الشخصي ومن الموجز، ويبقى محفوظًا لك وحدك.': 'An archived post disappears from your profile and the feed, and stays saved for you alone.',
    'تنزيل بياناتك': 'Download your data',
    'نجهّز ملفًا يحتوي على منشوراتك وتعليقاتك وبيانات حسابك. يستغرق ذلك بعض الوقت.': 'We prepare a file with your posts, comments, and account details. This takes a while.',
    'طلب نسخة من بياناتي': 'Request a copy of my data',
    'تم استلام طلبك': 'Request received',
    'طلبك قيد التجهيز. سنخبرك عند اكتماله.': 'Your request is being prepared. We will tell you when it is ready.',
    'ملفك جاهز للتنزيل': 'Your file is ready to download',
    'لا توجد منشورات مؤرشفة': 'No archived posts',
    'أرشف منشورًا لإخفائه عن ملفك دون حذفه': 'Archive a post to hide it from your profile without deleting it',
    'استعادة': 'Restore',
    'تمت الاستعادة': 'Restored',
    'الأصدقاء المقربون': 'Close friends',
    'لن يعرف أحد أنه في هذه القائمة. يمكنك تغييرها في أي وقت.': 'No one is told they are on this list. You can change it any time.',
    'ابحث عن شخص': 'Search for someone',
    'لا يوجد من تتابعه بعد': 'You are not following anyone yet',
    'تابع أشخاصًا لتتمكن من إضافتهم': 'Follow people so you can add them',
    'متابعة ودعوة الأصدقاء': 'Follow and invite friends',
    'ادعُ أصدقاءك': 'Invite your friends',
    'مشاركة رابط الدعوة': 'Share invite link',
    'دعوة عبر رسالة نصية': 'Invite by text message',
    'دعوة عبر البريد': 'Invite by email',
    'حسابات قد تعجبك': 'Accounts you might like',
    'لا توجد اقتراحات الآن': 'No suggestions right now',
    'تعذر تحميل الاقتراحات': 'Could not load suggestions',
    'تعذر المتابعة': 'Could not follow',
    'نشاط الحساب': 'Account activity',
    'منشورات': 'Posts',
    'لم تعجب بأي شيء بعد': 'You have not liked anything yet',
    'لم تكتب أي تعليق بعد': 'You have not written any comments yet',
    'تعذر الإزالة': 'Could not remove',
    'آخر نشاط': 'Last active',
    'طلبات المتابعة': 'Follow requests',
    'لا توجد طلبات': 'No requests',
    'ستظهر هنا طلبات متابعة حسابك الخاص': 'Requests to follow your private account appear here',
    'تم الطلب': 'Requested',
    'تم إرسال طلب المتابعة': 'Follow request sent',
    'إعادة تعيين كلمة المرور': 'Reset password',
    'انتهت الجلسة': 'Session expired',
    'ابدأ من جديد لإرسال رمز جديد': 'Start again to send a new code',
    'رجوع': 'Back',
    'اختر كلمة مرور لم تستخدمها من قبل': 'Choose a password you have not used before',
    'تحقق': 'Verify',
    'سنرسل رمزًا مكونًا من 6 أرقام إلى بريدك': 'We will send a 6-digit code to your email',
    'إرسال الرمز': 'Send code',
    'أرسلنا رمزًا مكونًا من 6 أرقام إلى': 'We sent a 6-digit code to',
    'التخزين ممتلئ مؤقتًا. حاول لاحقًا.': 'Storage is temporarily full. Try again later.',
    'وصلت إلى حد الحجم اليومي. حاول غدًا.': 'You have reached your daily size limit. Try tomorrow.',
    'تعذر الرفع الآن': 'Upload is unavailable right now',
    'سنرسل رابط تأكيد. قد تحتاج إلى التأكيد من بريدك الحالي والجديد معًا.': 'We will send a confirmation link. You may need to confirm from both your current and new address.',
    'أرسلنا لك رمز التحقق': 'We sent you a verification code',
    'سنرسل رمز التحقق إلى بريدك': 'We will send a verification code to your email',
    'أرسلنا رمز التحقق إلى': 'We sent a verification code to',
    '10 أحرف على الأقل': 'At least 10 characters',
    'رمز واحد على الأقل (!@#$...)': 'At least one symbol (!@#$...)',
    'هذه كلمة مرور شائعة جدًا، اختر غيرها': 'That password is too common, choose another',
    'لا أحد يشارك موقعه الآن': 'No one is sharing right now',
    'شروط الخدمة': 'Terms of Service',
    'سياسة الخصوصية': 'Privacy Policy',
    'الشروط': 'Terms',
    'الخصوصية': 'Privacy',
    'صف ما حدث بأكبر قدر من التفصيل. نرفق نوع جهازك وإصدار التطبيق تلقائيًا.': 'Describe what happened in as much detail as you can. We attach your device type and app version automatically.',
    'نوع المشكلة': 'Type of problem',
    'عطل في التطبيق': 'App bug',
    'مشكلة في الحساب': 'Account problem',
    'مشكلة في الدفع أو العملات': 'Payment or coins problem',
    'مشكلة تتعلق بالأمان': 'Safety concern',
    'شيء آخر': 'Something else',
    'ما الذي حدث؟': 'What happened?',
    'تم استلام بلاغك': 'We got your report',
    'سنراجعه ونرد عليك داخل التطبيق.': 'We will review it and reply to you in the app.',
    'أرسلت بلاغات كثيرة، حاول لاحقًا': 'You have sent too many reports, try again later',
    'اختر الطريقة الأنسب لك. البلاغ داخل التطبيق أسرع، لأنه يصلنا مع تفاصيل جهازك.': 'Pick whichever suits you. An in-app report is faster, because it reaches us with your device details.',
    'مراسلتنا بالبريد': 'Email us',
    'بلاغاتك السابقة': 'Your past reports',
    'لا توجد بلاغات سابقة': 'No past reports',
    'قيد الانتظار': 'Pending',
    'قيد المعالجة': 'In progress',
    'تم الحل': 'Resolved',
    'مغلق': 'Closed',
    'حالة الحساب': 'Account status',
    'يمكنك إخفاء حسابك مؤقتًا أو حذفه نهائيًا. اختر ما يناسبك.': 'You can hide your account temporarily or delete it permanently. Choose what suits you.',
    'إيقاف الحساب مؤقتًا': 'Deactivate account',
    'يختفي ملفك الشخصي وفيديوهاتك وتعليقاتك عن الجميع.': 'Your profile, videos, and comments disappear from everyone.',
    'لا يُحذف أي شيء، ويعود كل شيء كما كان.': 'Nothing is deleted, and everything comes back exactly as it was.',
    'يكفي تسجيل الدخول مرة أخرى لتفعيله.': 'Just sign in again to restore it.',
    'إيقاف مؤقت': 'Deactivate',
    'تُحذف فيديوهاتك وتعليقاتك ورسائلك ومتابعوك.': 'Your videos, comments, messages, and followers are deleted.',
    'يُفقد رصيد المحفظة ولا يمكن استرداده.': 'Your wallet balance is lost and cannot be recovered.',
    'لديك 30 يومًا لتغيير رأيك قبل الحذف الفعلي.': 'You have 30 days to change your mind before anything is erased.',
    'سيختفي حسابك عن الجميع حتى تسجّل الدخول مرة أخرى.': 'Your account disappears from everyone until you sign in again.',
    'تم إيقاف حسابك مؤقتًا': 'Your account is deactivated',
    'هذا الإجراء لا يمكن التراجع عنه': 'This cannot be undone',
    'جميع فيديوهاتك وتعليقاتك ستُحذف.': 'All your videos and comments will be deleted.',
    'محادثاتك ورسائلك ستُحذف.': 'Your chats and messages will be deleted.',
    'متابعوك ومن تتابعهم سيُفقدون.': 'Your followers and the people you follow will be lost.',
    'رصيد محفظتك سيُفقد ولا يمكن استرداده.': 'Your wallet balance will be lost and cannot be recovered.',
    'اسم المستخدم الخاص بك قد يأخذه شخص آخر.': 'Your username may be taken by someone else.',
    'سيُحذف حسابك بعد 30 يومًا. إذا سجّلت الدخول خلال هذه المدة، يُلغى الحذف تلقائيًا.': 'Your account is deleted after 30 days. If you sign in during that time, the deletion is cancelled automatically.',
    'حذف حسابي': 'Delete my account',
    'جارٍ التنفيذ...': 'Working...',
    'تم جدولة حذف حسابك': 'Your account is scheduled for deletion',
    'حسابك مجدول للحذف': 'Your account is scheduled for deletion',
    'إلغاء الحذف والاحتفاظ بحسابي': 'Cancel deletion and keep my account',
    'تم إلغاء الحذف': 'Deletion cancelled',
    'تعذر التنفيذ': 'Could not complete that',
    'من يمكنه الإشارة إلي': 'Who can tag me',
    'لا يوجد حساب بهذا الاسم': 'No account with that name',
    'تخطي': 'Skip',
    'ابدأ الآن': 'Get started',
    'شاهد فيديوهات قصيرة': 'Watch short videos',
    'موجز لا ينتهي يتعلّم ما تحبه مع كل مشاهدة': 'An endless feed that learns what you love with every watch',
    'أنشئ وشارك': 'Create and share',
    'صوّر، قصّ، وأضف أصواتًا أصلية من داخل التطبيق': 'Record, trim, and add original sounds right in the app',
    'بث مباشر وهدايا': 'Go live and get gifts',
    'شارك لحظاتك مباشرة واستقبل الهدايا من متابعيك': 'Share your moments live and receive gifts from your followers',
    'تواصل مع أصدقائك': 'Stay close to your friends',
    'رسائل ومجموعات وخريطة تجمعك بمن تحب': 'Messages, groups, and a map that keeps you together',
    'أنا جديد هنا': "I'm new here",
    'لدي حساب بالفعل': 'I already have an account',
    'بالمتابعة أنت توافق على': 'By continuing you agree to the',
    'عرّفنا بنفسك': 'Tell us about yourself',
    'اسمك كما سيظهر للآخرين، وتاريخ ميلادك': 'Your name as others will see it, and your birthday',
    'تاريخ الميلاد': 'Date of birth',
    'لن يظهر تاريخ ميلادك لأي شخص، ولا يمكن تغييره لاحقًا.': 'Your birthday is never shown to anyone, and cannot be changed later.',
    'أدخل اسمك': 'Enter your name',
    'أدخل تاريخ ميلادك': 'Enter your date of birth',
    'تاريخ الميلاد غير صحيح': 'That date of birth is not valid',
    'يجب أن يكون عمرك 13 عامًا على الأقل': 'You must be at least 13 years old',
    'ما بريدك الإلكتروني؟': 'What is your email?',
    'سنرسل رمز تحقق من ست خانات للتأكد أنه أنت': 'We will send a six digit code to make sure it is you',
    'اختر كلمة مرور': 'Choose a password',
    'قوية وسهلة التذكر لك وحدك': 'Strong, and easy for only you to remember',
    'إنشاء الحساب': 'Create account',
    'لا يمكن تغيير تاريخ الميلاد': 'Your date of birth cannot be changed',
    'مشاركة الموقع متاحة لمن هم 18 عامًا فما فوق. أدخل تاريخ ميلادك للمتابعة — لا يمكن تغييره لاحقًا.': 'Location sharing is for people 18 and over. Enter your date of birth to continue — it cannot be changed later.',
    'مشاركة الموقع متاحة لمن هم 18 عامًا فما فوق': 'Location sharing is for people 18 and over',
    'لم يتم التفعيل': 'Not enabled',
    'غروب اليوم 🌅 #تصوير': 'Todays sunset 🌅 #photography',
    'رائع 🔥': 'Amazing 🔥',
    'أرسلت وردة 🌹': 'sent a rose 🌹',
    'وين اليوم؟ 😄': 'Where are you today? 😄',
    'شوف الخريطة 📍': 'Check the map 📍',
    'شارك لحظاتك مباشرة وتفاعل مع متابعيك لحظة بلحظة': 'Share your moments live and talk with your followers as it happens',
    'متابعة من الرياض 👋': 'watching from Riyadh 👋',
    'الإشراف': 'Moderation',
    'الدعم الفني': 'Support',
    'طلبات الحذف': 'Deletion requests',
    'طلبات البيانات': 'Data requests',
    'إرسال إشعار': 'Send notification',
    'التخزين والحدود': 'Storage & limits',
    'يحتاج إلى إجراء': 'Needs attention',
    'إجمالي الحسابات': 'Total accounts',
    'بث مباشر الآن': 'Live now',
    'عمل مفتوح': 'Open work',
    'العمل المفتوح': 'Open work',
    'النشاط خلال 14 يومًا': 'Activity over 14 days',
    'أحدث الحسابات': 'Newest accounts',
    'السجل': 'Log',
    'البلاغات التي أرسلها المستخدمون من داخل التطبيق': 'Problems people reported from inside the app',
    'مفتوحة': 'Open',
    'محلولة': 'Resolved',
    'الرسالة': 'Message',
    'الجهاز': 'Device',
    'عطل': 'Bug',
    'دفع': 'Payment',
    'محتوى': 'Content',
    'أمان': 'Safety',
    'مفتوح': 'Open',
    'محلول': 'Resolved',
    'الرد على البلاغ': 'Reply to report',
    'سيصل الرد إلى المستخدم كإشعار داخل التطبيق.': 'The reply reaches the person as an in-app notification.',
    'تم إرسال الرد': 'Reply sent',
    'حسابات مجدولة للحذف خلال 30 يومًا — يمكن إلغاء الحذف قبل انتهاء المهلة': 'Accounts scheduled for deletion within 30 days — deletion can be cancelled before the deadline',
    'أُوقف في': 'Deactivated',
    'يُحذف في': 'Deletes on',
    'المتبقي': 'Remaining',
    'لا توجد طلبات حذف': 'No deletion requests',
    'إلغاء الحذف': 'Cancel deletion',
    'طلبات نسخة من البيانات — مطلوبة قانونيًا في بعض الدول': 'Requests for a copy of personal data — legally required in some countries',
    'الملف': 'File',
    'جاهز': 'Ready',
    'إرفاق الملف': 'Attach file',
    'تعذّر': 'Failed',
    'إرفاق ملف البيانات': 'Attach the data file',
    'ألصق رابط الملف بعد رفعه. سيصل المستخدم إليه من داخل التطبيق.': 'Paste the file link after uploading it. The person reaches it from inside the app.',
    'تم وضع علامة فشل': 'Marked as failed',
    'الحد الأقصى للتخزين هو ما يمنع تجاوز الفاتورة — الرفع يتوقف عند بلوغه': 'The storage ceiling is what keeps the bill down — uploads stop when it is reached',
    'الاستهلاك': 'Usage',
    'حدود الرفع': 'Upload limits',
    'المشرفون معفون من هذه الحدود. سقف التخزين الكلي يجب أن يبقى أقل من حصة مزوّد التخزين.': 'Admins are exempt from these limits. The global ceiling must stay below your storage provider quota.',
    'أقصى حجم للملف (MB)': 'Max file size (MB)',
    'حد الرفع اليومي للمستخدم (مقطع)': 'Daily uploads per person (clips)',
    'حد الحجم اليومي للمستخدم (MB)': 'Daily size per person (MB)',
    'سقف التخزين الكلي (MB)': 'Global storage ceiling (MB)',
    'حفظ الحدود': 'Save limits',
    'تم حفظ الحدود': 'Limits saved',
    'المجلد': 'Bucket',
    'الملفات': 'Files',
    'الحجم': 'Size',
    'السقف': 'Ceiling',
    'النسبة': 'Percent',
    'عدد الملفات': 'File count',
    'أرقام حقيقية من قاعدة البيانات': 'Real numbers from the database',
    'تصدير CSV': 'Export CSV',
    'حسابات جديدة': 'New accounts',
    'فيديوهات جديدة': 'New videos',
    'تعليقات جديدة': 'New comments',
    'النمو اليومي': 'Daily growth',
    'لا توجد بيانات في هذه الفترة': 'No data in this period',
    'لا توجد بيانات بعد': 'No data yet',
    'الحسابات التي تشارك موقعها حاليًا — تنتهي المشاركة تلقائيًا بعد 8 ساعات': 'Accounts currently sharing their location — sharing expires automatically after 8 hours',
    'الظهور': 'Visible to',
    'آخر تحديث': 'Last updated',
    'الإحداثيات': 'Coordinates',
    'لا أحد يشارك موقعه حاليًا': 'Nobody is sharing their location',
    'يصل الإشعار داخل التطبيق لجميع الحسابات': 'The notification reaches every account inside the app',
    'النص': 'Body',
    'إرسال للجميع': 'Send to everyone',
    'معاينة': 'Preview',
    'نص الإشعار سيظهر هنا': 'The notification body appears here',
    'عنوان قصير': 'Short title',
    'سيصل هذا الإشعار إلى كل حساب في التطبيق. لا يمكن التراجع.': 'This reaches every account in the app. It cannot be undone.',
    'حملات تظهر داخل الموجز': 'Campaigns shown inside the feed',
    'تعديل الحملة': 'Edit campaign',
    'أُنشئت': 'Created',
    'لا توجد حملات': 'No campaigns',
    'تشغيل': 'Resume',
    'رابط الصورة': 'Image URL',
    'رابط الوجهة': 'Destination URL',
    'الصورة': 'Image',
    'الوجهة': 'Destination',
    'حذف الحملة': 'Delete campaign',
    'سيُحذف الإعلان نهائيًا.': 'The ad will be permanently deleted.',
    'أدخل عنوانًا': 'Enter a title',
    'لا توجد بيانات': 'No data',
    'لا توجد حسابات بعد': 'No accounts yet',
    'المستهلك': 'Used',
    'الشروط وسياسة الخصوصية': 'Terms & Privacy Policy',
    'حول التطبيق': 'About',
    'الإصدار 1.0.0': 'Version 1.0.0',
    'منطقة الخطر': 'Danger zone',
    'حذف الحساب نهائيًا': 'Delete account permanently',
    'هل أنت متأكد من حذف حسابك؟\n\nسيتم حذف جميع الفيديوهات والمحفظة والمحادثات. لا يمكن التراجع عن هذا الإجراء.': 'Are you sure you want to delete your account?\n\nAll videos, wallet, and chats will be deleted. This action cannot be undone.',
    'للتأكيد، اكتب: حذف': 'To confirm, type: delete',
    'تم حذف حسابك': 'Your account was deleted',
    'فشل الحذف': 'Deletion failed',
    'الإدارة': 'Administration',
    'فتح لوحة التحكم الإدارية': 'Open admin dashboard',

    // Blocked users
    'لا يوجد مستخدمون محظورون': 'No blocked users',
    'يمكنك حظر أي شخص من بروفايله': 'You can block anyone from their profile',
    'إلغاء الحظر': 'Unblock',
    'إلغاء حظر': 'Unblock',
    'تم إلغاء الحظر': 'Unblocked',
    'هذا المستخدم': 'this user',

    // Profile
    'تعديل البروفايل': 'Edit profile',
    'الاسم': 'Name',
    'اسم المستخدم': 'Username',
    'النبذة': 'Bio',
    'تغيير الصورة': 'Change photo',
    'حفظ التعديلات': 'Save changes',
    'تم الحفظ': 'Saved',
    'المتابعون': 'Followers',
    'المتابَعون': 'Following',
    'متابعون': 'Followers',
    'متابَعين': 'Following',
    'متابَع': 'Following',
    'متابعون جدد': 'New followers',
    'فيديوهات': 'Videos',
    'معجَب بها': 'Liked',
    'محفوظ': 'Saved',
    'لا تتابع أي حساب بعد': "You're not following anyone yet",
    'لا يوجد مستخدمون آخرون بعد. ادعُ صديقاً للانضمام.': 'No other users yet. Invite a friend to join.',
    'تسجيل الخروج': 'Log out',
    'تم تسجيل الخروج': 'Logged out',
    'مستخدم': 'User',
    'خاص': 'Private',
    'عام': 'Public',
    // Both uses of this are the For You feed tab, not the word "you".
    'لك': 'For You',
    // The Following FEED tab. Deliberately a different Arabic word from
    // the profile's followers stat ('متابعون'), which means the opposite —
    // sharing one string made this tab read as "Followers" in English.
    'متابَعة': 'Following',
    'أنت': 'You',

    // Misc / toasts
    'جاري الإرسال...': 'Sending...',
    'جاري الإنشاء...': 'Creating...',
    'جاري الحفظ...': 'Saving...',
    'تعذر التحديث': 'Could not update',
    'الآن': 'Now',
    'منذ': 'ago',
    'يوم': 'day',
    'النظام': 'System',
    'تدرج': 'Gradient',
    'انضم إلى': 'Join',
    'سيتم تفعيله قبل الإطلاق الرسمي': 'Will be enabled before the official launch',
    'السحب يتطلب التحقق من الهوية — سيتم تفعيله قبل الإطلاق.': 'Withdrawal requires identity verification — coming before launch.',
    'سيتم تفعيل الدفع عبر Apple Pay / Stripe قبل الإطلاق الرسمي. للاختبار اطلب من المشرف شحن رصيدك.': 'Payment via Apple Pay / Stripe will be enabled before launch. For testing, ask an admin to top up your balance.',
    'السماح بالميكروفون مطلوب': 'Microphone permission is required',

    // Demo seed names (sample content – safe to localize)
    'مرحبا الجميع': 'Hello everyone',
    'جميل جدًا': 'Very nice',
    'شاطئ': 'Beach',
    'صحراء': 'Desert',
    'مدينة': 'City',
    'مسجد': 'Mosque',
    'قلب': 'Heart',

    // Video options sheet (not interested / interested / report)
    'غير مهتم': 'Not interested',
    'مهتم — أظهر لي المزيد مثل هذا': 'Interested — show me more like this',
    'الإبلاغ': 'Report',
    'لن نعرض لك محتوى مشابهًا كثيرًا': "We'll show you less content like this",
    'سنعرض لك محتوى مشابهًا أكثر': "We'll show you more content like this",

    // Report reasons sheet
    'لماذا تبلغ عن هذا؟': 'Why are you reporting this?',
    'محتوى غير لائق': 'Inappropriate content',
    'خطاب كراهية أو تنمر': 'Hate speech or bullying',
    'عنف أو محتوى صادم': 'Violence or graphic content',
    'انتحال شخصية': 'Impersonation',
    'محتوى مضلل': 'Misleading content',
    'بريد عشوائي': 'Spam',
    'أخرى': 'Other',
    'تم استلام بلاغك، شكرًا لك': 'Your report has been received, thank you',
    'تعذر إرسال البلاغ': 'Could not submit report',

    // Profile block / report options
    'الإبلاغ عن المستخدم': 'Report user',
    'تم حظر المستخدم': 'User blocked',
    'تعذر الحظر': 'Could not block user',

    // Upload validation / compression
    'لم يتم اختيار ملف': 'No file selected',
    'تعذر قراءة الفيديو': 'Could not read video',
    'جاري ضغط الفيديو...': 'Compressing video...',
    'جاري الرفع...': 'Uploading...',
    'تم!': 'Done!',

    // On-device nudity check
    'جاري فحص المحتوى...': 'Checking content...',
    'يبدو أن هذا المحتوى يحتوي على مواد غير لائقة ولا يمكن نشره': 'This content appears to contain inappropriate material and cannot be posted',
    'تعذر تحميل مكتبة الفحص': 'Could not load the content checker',
    'تعذر قراءة الفيديو للفحص': 'Could not read video for checking',
    'تعذر قراءة الصورة للفحص': 'Could not read image for checking',

    // Community guidelines gate
    'إرشادات المجتمع': 'Community Guidelines',
    'قبل النشر، يرجى الموافقة على عدم نشر أي محتوى يتضمن: عري أو محتوى جنسي، عنف صريح، خطاب كراهية أو تنمر، انتحال شخصية، معلومات مضللة، انتهاك حقوق النشر، أو أي نشاط غير قانوني. نحن نزيل المحتوى المخالف ونحظر الحسابات المخالفة فور الإبلاغ عنها.':
      'Before posting, please agree not to publish any content containing: nudity or sexual content, graphic violence, hate speech or bullying, impersonation, misleading information, copyright infringement, or any illegal activity. We remove violating content and ban violating accounts as soon as they are reported.',
    'أوافق وأتابع': 'I agree, continue',

    // Empty / error states
    'تعذر التحميل': "Couldn't load",
    'تحقق من اتصالك وحاول مرة أخرى': 'Check your connection and try again',
    'إعادة المحاولة': 'Retry',

    // Empty states — feed, profile tabs, saved, contacts
    'لا توجد فيديوهات بعد': 'No videos yet',
    'كن أول من ينشر فيديو على تِنث تون': 'Be the first to post a video on FLYP',
    'إنشاء فيديو': 'Create video',
    'لم تنشر أي فيديو بعد': "You haven't posted any videos yet",
    'أنشئ أول فيديو لك وشاركه مع العالم': 'Create your first video and share it with the world',
    'لم ينشر هذا المستخدم أي فيديو بعد': "This user hasn't posted any videos yet",
    'لا توجد إعجابات بعد': 'No likes yet',
    'الفيديوهات التي تعجبك ستظهر هنا': 'Videos you like will appear here',
    'لا توجد عناصر محفوظة': 'Nothing saved yet',
    'احفظ الفيديوهات لمشاهدتها لاحقًا — ستظهر هنا': 'Save videos to watch later — they’ll show up here',
    'تصفح الفيديوهات': 'Browse videos',
    'المحفوظات': 'Saved',
    'تابع صُنّاع المحتوى لترى فيديوهاتهم هنا': 'Follow creators to see their videos here',
    'لا توجد جهات اتصال': 'No contacts',
    'تابع أشخاصًا لتتمكن من مشاركة الفيديوهات معهم': 'Follow people so you can share videos with them',
    'جرّب اسمًا آخر': 'Try a different name',

    // Live stream
    'هذا البث غير متاح': 'This stream is unavailable',
    'ربما انتهى البث أو تم حذفه': 'It may have ended or been removed',
    'تصفح البثوث المباشرة': 'Browse live streams',
    'جاري تحميل البث — حاول بعد لحظة': 'Loading the stream — try again in a moment',
    'تعذر إرسال التعليق': 'Could not send comment',
    'لا توجد هدايا متاحة': 'No gifts available',
    'حاول مرة أخرى لاحقًا': 'Try again later',
    'تمت المتابعة': 'Following',

    // Loading / async placeholders
    'جاري التحميل...': 'Loading...',
    'جاري البحث...': 'Searching...',
    'تعذر تحميل الأصوات': 'Could not load sounds',
    'جاري الضغط...': 'Compressing...',
    'أنت هنا': 'You are here',
    'المستخدم': 'User',
    'مستخدم': 'User',
    '🔥 رائج': '🔥 HOT',

    // ── Seeded demo content (from supabase/demo_seed.sql) ──
    // These rows are sample data shipped with the project, not things real
    // users wrote, so they get translated like any other app string.
    // Content genuinely authored by users is deliberately NOT listed here —
    // a caption or display name stays in whatever language its author used.
    'خالد': 'Khaled',
    'حساب تجريبي': 'Demo account',
    'وصفتي المفضلة 🍰 جربوها وأخبروني!': 'My favourite recipe 🍰 try it and tell me!',
    'تدريب اليوم 💪 #كرة_قدم': "Today's workout 💪 #football",
    'القهوة قبل أي شيء ☕': 'Coffee before anything else ☕',
    'مغامرة لا تُنسى ⛰️': 'An unforgettable adventure ⛰️',
    'تصوير ليلي ✨': 'Night photography ✨',
    'رحلة العمر 🌍 #سفر': 'Trip of a lifetime 🌍 #travel',
    'لحن جديد 🎶': 'A new melody 🎶',
    '#كرة_قدم': '#football',
    '#سفر': '#travel',
    'كرة_قدم': 'football',
    'سفر': 'travel',
    // Seeded "music" strings on demo videos
    'هزّة - سارة': 'Hazza - Sara',
    'صوت من ذكرى - علي': 'Sound of a memory - Ali',
    'خفقات - فاطمة': 'Heartbeats - Fatima',
    'الأصلي - أحمد': 'Original sound - Ahmed',
    'هزّة': 'Hazza',
    'صوت من ذكرى': 'Sound of a memory',
    'خفقات': 'Heartbeats',
    'سارة': 'Sara',
    'علي': 'Ali',
    'فاطمة': 'Fatima',
    'أحمد': 'Ahmed',

    // Seeded sounds catalog (app-provided content, not user-generated)
    'صوت أصلي رائج': 'Trending original sound',
    'نغمة حماسية 🎶': 'Upbeat tune 🎶',
    'لحظات هادئة ☕': 'Quiet moments ☕',
    'تحدي الرياض اليوم 🇸🇦': "Today's Riyadh challenge 🇸🇦",
    'أحمد السعيد': 'Ahmed Alsaeed',
    'دي جي ناصر': 'DJ Nasser',
    'سارة العلي': 'Sara Alali',
    'فريق التحديات': 'Challenge Team',
    'الأصلي': 'Original sound',

    // System-generated wallet transaction descriptions (written by DB triggers)
    'هدية الترحيب': 'Welcome bonus',
    'شحن رصيد': 'Top-up',
    'سحب رصيد': 'Withdrawal',
    'هدية مرسلة': 'Gift sent',
    'هدية مستلمة': 'Gift received',
    'لا توجد عمليات': 'No transactions',
  };

  // ── Admin dashboard strings (shares DICT; merged here to keep the literal small) ──
  Object.assign(DICT, {
    // Admin — remaining UI labels, table headers, statuses and confirmations
    '(بلا وصف)': '(no description)',
    '(مشرف)': '(admin)',
    '30 يوم': '30 days',
    '7 أيام': '7 days',
    'أدخل قيمة صحيحة ≠ 0': 'Enter a valid non-zero value',
    'إيقاف': 'Suspend',
    'الإجراء': 'Action',
    'الإجراء المتخذ (مثال: تم حذف المحتوى / تم تحذير المستخدم):': 'Action taken (e.g. content removed / user warned):',
    'الإعلانات': 'Ads',
    'الإعلانات والإشعارات': 'Ads & notifications',
    'البث المباشر': 'Live streams',
    'الحد الأدنى للسحب (🪙)': 'Minimum withdrawal (🪙)',
    'الحد الأقصى للحجم (MB)': 'Max size (MB)',
    'الحسابات، البلاغات': 'Accounts, reports',
    'الرابط (URL)': 'Link (URL)',
    'باقة Premium': 'Premium plan',
    'بث': 'Stream',
    'بحث بالاسم أو البريد': 'Search by name or email',
    'تحديات الأسبوع 🎉': 'Challenges of the week 🎉',
    'تعديل الرصيد (+ إيداع / − خصم)': 'Adjust balance (+ credit / − debit)',
    'تعديل المستخدمين': 'Edit users',
    'تم حذف التعليق': 'Comment deleted',
    'تم حذف المحتوى': 'Content deleted',
    'حدث خطأ': 'An error occurred',
    'حذف حساب': 'Delete account',
    'حذف هذا التعليق نهائيًا؟': 'Permanently delete this comment?',
    'حفظ التغييرات': 'Save changes',
    'ساعة': 'hour',
    'عدد أيام الحظر (فارغ = دائم):': 'Ban duration in days (empty = permanent):',
    'عرض الإحصائيات والتقارير': 'View stats and reports',
    'علامة موثَّق ✓': 'Verified badge ✓',
    'فشل الحفظ': 'Save failed',
    'لا توجد تعليقات': 'No comments',
    'مرسلة': 'Sent',
    'مستلمة': 'Received',
    'معدل البقاء (DAY30)': 'Retention (DAY30)',
    'موظف': 'Staff',
    'نظام': 'System',
    'نقرات': 'Clicks',
    'يوم متبقي': 'days left',
    '← العودة إلى التطبيق': '← Back to app',
    '● مباشر': '● Live',
    '🗑️ حذف الحساب نهائيًا': '🗑️ Permanently delete account',
    'عرض المستخدمين': 'View users',
    'حظر المستخدمين': 'Ban users',
    'عرض المحتوى': 'View content',
    'حذف المحتوى': 'Delete content',

    // Login / shell
    'لوحة التحكم': 'Dashboard',
    'سجّل دخولك للوصول إلى لوحة الإدارة': 'Sign in to access the admin panel',
    'جاري الدخول...': 'Signing in...',
    'تعذر الدخول': 'Sign-in failed',
    'هذا الحساب ليس لديه صلاحيات إدارية': 'This account has no admin permissions',
    'هذا الحساب ليس لديه صلاحيات إدارية.': 'This account has no admin permissions.',
    'وصول غير مسموح': 'Access denied',
    'تسجيل الخروج والدخول كمشرف': 'Sign out and log in as admin',
    'المشرف الرئيسي': 'Super Admin',
    'العودة إلى التطبيق': 'Back to app',
    'بحث سريع...': 'Quick search...',
    // Nav sections
    'المحتوى': 'Content',
    'النقدية': 'Monetization',
    'النظام': 'System',
    // Nav items
    'الإحصائيات': 'Analytics',
    'إدارة الحسابات': 'User management',
    'الفيديوهات': 'Videos',
    'البلاغات': 'Reports',
    'الهدايا والمحفظة': 'Gifts & Wallet',
    'الموظفون': 'Staff',
    'الأدوار والصلاحيات': 'Roles & Permissions',
    'سجل الأنشطة': 'Activity log',
    'الإعدادات': 'Settings',
    // Dashboard
    'نظرة عامة على المنصة': 'Platform overview',
    'إجمالي المستخدمين': 'Total users',
    'إجمالي الفيديوهات': 'Total videos',
    'بثوث مباشرة الآن': 'Live streams now',
    'بلاغات قيد المراجعة': 'Reports pending review',
    'أعلى المستخدمين متابعةً': 'Most-followed users',
    'أعلى الفيديوهات أداءً': 'Top-performing videos',
    'آخر النشاطات': 'Recent activity',
    'النشاط خلال الأسبوع': 'Activity this week',
    'النمو خلال 30 يومًا': 'Growth over 30 days',
    'التوزيع الجغرافي': 'Geographic distribution',
    'توزيع المحتوى': 'Content distribution',
    'مستخدمون نشطون يوميًا': 'Daily active users',
    'مستخدمون نشطون شهريًا': 'Monthly active users',
    'مستخدمون نشطون': 'Active users',
    'مستخدمون جدد': 'New users',
    'مستخدمون يدفعون': 'Paying users',
    'متوسط الجلسة': 'Avg. session',
    'معدل البقاء (': 'Retention rate (',
    'إيرادات اليوم': "Today's revenue",
    'مشاهدات اليوم': "Today's views",
    'التفاعل': 'Engagement',
    // Analytics page
    'الإحصائيات والتقارير': 'Analytics & Reports',
    'تتبع التفاعل واستخراج التقارير': 'Track engagement and export reports',
    // Users page
    'بحث، تعديل البروفايل، المحفظة، التحقق، الحظر، الحذف': 'Search, edit profile, wallet, verify, ban, delete',
    'بحث بالاسم أو اسم المستخدم': 'Search by name or username',
    'كل الحالات': 'All statuses',
    'نشط': 'Active',
    'محظور': 'Banned',
    'مشرف': 'Admin',
    'المتابعون': 'Followers',
    'الحالة': 'Status',
    'تاريخ الانضمام': 'Join date',
    'إدارة': 'Manage',
    'حظر': 'Ban',
    'إلغاء الحظر': 'Unban',
    'تعيين مشرف': 'Make admin',
    'إزالة الإشراف': 'Remove admin',
    'عدد أيام الحظر (فارغ': 'Ban days (empty',
    'إدارة المستخدم': 'Manage user',
    'علامة موثَّق': 'Verified badge',
    'البروفايل': 'Profile',
    'إجراءات سريعة': 'Quick actions',
    'الرصيد الحالي': 'Current balance',
    'تعديل الرصيد (+ إيداع /': 'Adjust balance (+ deposit /',
    'العدد (سالب للخصم)': 'Amount (negative to deduct)',
    'السبب (اختياري)': 'Reason (optional)',
    'تطبيق': 'Apply',
    'تم تعديل الرصيد': 'Balance adjusted',
    'أدخل قيمة صحيحة': 'Enter a valid value',
    'أحدث الفيديوهات': 'Latest videos',
    'سجل الإجراءات الإدارية': 'Admin action log',
    'حفظ تعديلات البروفايل': 'Save profile changes',
    'تم حفظ البروفايل': 'Profile saved',
    'حظر مؤقت': 'Temporary ban',
    'حذف الحساب نهائيًا': 'Delete account permanently',
    'سيتم حذف جميع الفيديوهات والمحفظة والتعليقات.': 'All videos, wallet, and comments will be deleted.',
    'نهائيًا؟ هذا الإجراء غير قابل للتراجع.': 'permanently? This action cannot be undone.',
    'تم حذف الحساب': 'Account deleted',
    'دور المشرف لـ': 'admin role for',
    'تعيين': 'Assign',
    'إزالة': 'Remove',
    // Videos page
    'مراجعة المحتوى المنشور': 'Review published content',
    'بحث بالوصف': 'Search by description',
    'الناشر': 'Publisher',
    'المشاهدات': 'Views',
    'الإعجابات': 'Likes',
    'عرض': 'View',
    'بلا وصف)': 'No description)',
    'حذف هذا الفيديو نهائيًا؟': 'Delete this video permanently?',
    'تم الحذف': 'Deleted',
    'لا توجد فيديوهات': 'No videos',
    'منشور': 'Published',
    'مسودة': 'Draft',
    // Comments page
    'مراجعة وحذف التعليقات المخالفة': 'Review and delete violating comments',
    'بحث في التعليقات': 'Search comments',
    'مبلَّغ عنها': 'Reported',
    'محذوفة': 'Deleted',
    'التعليق': 'Comment',
    'الفيديو': 'Video',
    'البلاغات': 'Reports',
    'تجاهل': 'Dismiss',
    // Reports page
    'مراجعة البلاغات': 'Review reports',
    'مراجعة البلاغات المقدمة من المستخدمين': 'Review user-submitted reports',
    'كل الأنواع': 'All types',
    'النوع': 'Type',
    'الكيان': 'Entity',
    'المُبلِّغ': 'Reporter',
    'السبب': 'Reason',
    'التاريخ': 'Date',
    'قيد المراجعة': 'Under review',
    'مرفوضة': 'Dismissed',
    'لا توجد بلاغات': 'No reports',
    'حسم بإجراء': 'Resolve with action',
    'تم الحسم': 'Resolved',
    'حذف المحتوى': 'Delete content',
    'تحذير': 'Warn',
    'مراجعة، حذف، تحذير': 'Review, delete, warn',
    ' تم حذف المحتوى / تم تحذير المستخدم):': ' content deleted / user warned):',
    'تم تحديث الحالة': 'Status updated',
    // Live page
    'مراقبة الجلسات النشطة وإنهاء البثوث المخالفة': 'Monitor active sessions and end violating streams',
    'بثوث مباشرة الآن': 'Live streams now',
    'لا توجد بثوث نشطة الآن': 'No active streams right now',
    'إنهاء البث': 'End stream',
    'إنهاء هذا البث الآن؟': 'End this stream now?',
    'تم الإنهاء': 'Ended',
    'إنهاء': 'End',
    // Wallet/gifts page
    'المحفظة والسحب': 'Wallet & Withdrawals',
    'تتبع الهدايا الافتراضية وتقارير الدخل': 'Track virtual gifts and revenue reports',
    'إدارة الكتالوج': 'Manage catalog',
    'إدارة المحفظة': 'Manage wallet',
    'المرسل': 'Sender',
    'المستلم': 'Recipient',
    'القيمة': 'Value',
    'القناة': 'Channel',
    'الهدية': 'Gift',
    'كل الهدايا': 'All gifts',
    'هدايا مرسلة (اليوم)': 'Gifts sent (today)',
    'متوسط قيمة الهدية': 'Avg. gift value',
    'إيرادات اليوم': "Today's revenue",
    'مستخدمون يدفعون': 'Paying users',
    // Ads page
    'إدارة الإعلانات': 'Manage ads',
    'إدارة الحملات الإعلانية وتتبع الأداء': 'Manage ad campaigns and track performance',
    'إنشاء حملة إعلانية': 'Create ad campaign',
    'إنشاء حملة': 'Create campaign',
    'حملة جديدة': 'New campaign',
    'الحملة': 'Campaign',
    'حملات نشطة': 'Active campaigns',
    'الفئة المستهدفة': 'Target audience',
    'الفئة المستهدفة (اختياري)': 'Target audience (optional)',
    'المدة': 'Duration',
    'النقرات': 'Clicks',
    'عنوان الإعلان': 'Ad title',
    'عنوان الحملة': 'Campaign title',
    'نص الإعلان': 'Ad text',
    'نص قصير وجذاب': 'Short, catchy text',
    'الرابط (': 'Link (',
    'تاريخ البداية': 'Start date',
    'تاريخ النهاية': 'End date',
    'حفظ ونشر': 'Save & publish',
    'تم إنشاء الحملة': 'Campaign created',
    'نشطة': 'Active',
    'متوقفة': 'Paused',
    'منتهية': 'Ended',
    // Notifications page
    'إرسال إشعارات': 'Send notifications',
    'إرسال إشعارات عامة أو موجهة لفئات محددة': 'Send broadcast or targeted notifications',
    'إشعار جديد': 'New notification',
    'نوع الإشعار': 'Notification type',
    'عام (لجميع المستخدمين)': 'Broadcast (all users)',
    'موجه (فئة محددة)': 'Targeted (specific segment)',
    'مستخدمون نشطون اليوم': 'Users active today',
    'عنوان الإشعار': 'Notification title',
    'نص الإشعار': 'Notification text',
    'الجدولة': 'Scheduling',
    'إرسال فوري': 'Send now',
    'جدولة لوقت لاحق': 'Schedule for later',
    'الإشعارات السابقة': 'Past notifications',
    'تم إرسال الإشعار': 'Notification sent',
    'لجميع المستخدمين': 'To all users',
    'وصل لـ': 'Reached',
    // Employees / roles
    'إدارة الموظفين': 'Manage staff',
    'إدارة موظفي لوحة التحكم وأدوارهم': 'Manage dashboard staff and their roles',
    'إضافة موظف جديد': 'Add new employee',
    'موظف جديد': 'New employee',
    'تعديل بيانات الموظف': 'Edit employee details',
    'الموظف': 'Employee',
    'الدور': 'Role',
    'آخر دخول': 'Last login',
    'الاسم الكامل': 'Full name',
    'كلمة المرور المؤقتة': 'Temporary password',
    'سيُطلب من الموظف تغييرها عند أول دخول': 'The employee will be asked to change it on first login',
    'حذف هذا الموظف؟': 'Delete this employee?',
    'إدارة الأدوار': 'Manage roles',
    'إدارة الأدوار وتحديد الصلاحيات لكل دور': 'Manage roles and set permissions for each',
    'إنشاء دور جديد': 'Create new role',
    'دور جديد': 'New role',
    'تعديل دور': 'Edit role',
    'اسم الدور': 'Role name',
    'الصلاحيات': 'Permissions',
    'كل الصلاحيات': 'All permissions',
    'كل الأدوار': 'All roles',
    'تاريخ الإنشاء': 'Created on',
    'موقوف': 'Suspended',
    'مشرف محتوى': 'Content moderator',
    'محلل بيانات': 'Data analyst',
    'دعم فني': 'Support',
    'مسوّق': 'Marketer',
    // Logs page
    'مراجعة جميع الإجراءات الإدارية': 'Review all admin actions',
    'لم يتم تسجيل أي نشاط بعد': 'No activity logged yet',
    'سجل كامل': 'Full log',
    // Location page
    'إدارة ميزة مشاركة الموقع ومتابعة المحتوى الشائع': 'Manage location sharing and trending content',
    'المحتوى الشائع حسب المنطقة': 'Trending content by region',
    'المحتوى الشائع حسب الموقع': 'Trending content by location',
    'إظهار خريطة الأصدقاء داخل التطبيق': 'Show the friends map inside the app',
    'السماح للمستخدمين بمشاركة موقعهم على الخريطة': 'Allow users to share their location on the map',
    'عرض الخريطة العامة': 'Show public map',
    'عرض الفيديوهات الرائجة حسب المنطقة': 'Show trending videos by region',
    'تفعيل ميزة مشاركة الموقع': 'Enable location sharing',
    'مشاركة الموقع تلقائيًا': 'Share location automatically',
    'إعدادات المشاركة': 'Sharing settings',
    'كل المملكة': 'Whole kingdom',
    // Settings page
    'إعدادات المنصة العامة': 'General platform settings',
    'اسم المنصة': 'Platform name',
    'منصة فيديو اجتماعي بالعربية': 'An Arabic social video platform',
    'اللغة الافتراضية': 'Default language',
    'المنطقة الزمنية': 'Time zone',
    'الحد الأدنى للعمر': 'Minimum age',
    'الحد الأدنى من المتابعين للبث': 'Minimum followers to go live',
    'حدود الفيديو': 'Video limits',
    'الحد الأقصى للمدة (ث)': 'Max duration (s)',
    'الحد الأقصى للحجم (': 'Max size (',
    'صيغ الفيديو المدعومة': 'Supported video formats',
    'صيغ الصور': 'Image formats',
    'نسبة العمولة (%)': 'Commission rate (%)',
    'الحد الأدنى للسحب (': 'Minimum withdrawal (',
    'حفظ الإعدادات': 'Save settings',
    'تم حفظ الإعدادات': 'Settings saved',
    'افتراضيًا للمستخدمين الجدد': 'Default for new users',
    // Common table/page words
    'الكيان': 'Entity',
    'الوصف': 'Description',
    'العنوان': 'Title',
    'الوقت': 'Time',
    'العدد': 'Count',
    'تحرير': 'Edit',
    'تعديل': 'Edit',
    'عرض الكل': 'View all',
    'عرض السجل': 'View log',
    'عرض الإحصائيات': 'View analytics',
    'عرض المستخدمين': 'View users',
    'عرض المحتوى': 'View content',
    'لا توجد نتائج': 'No results',
    'لا توجد نشاطات بعد': 'No activity yet',
    'إناث': 'Female',
    'ذكور': 'Male',
    'أخرى': 'Other',
    'حساب': 'Account',
    'باقة': 'Package',
    'الهاتف': 'Phone',
    'المدينة': 'City',
    'من': 'From',
    // Cities (mock/demo)
    'الرياض': 'Riyadh',
    'جدة': 'Jeddah',
    'الدمام': 'Dammam',
    'مكة': 'Makkah',
    // Days (mock/demo charts)
    'الأحد': 'Sun',
    'الإثنين': 'Mon',
    'الثلاثاء': 'Tue',
    'الأربعاء': 'Wed',
    'الخميس': 'Thu',
    'الجمعة': 'Fri',
    'السبت': 'Sat',
    'أمس': 'Yesterday',
    'منذ ساعة': '1 hour ago',
    'منذ أسبوع': '1 week ago',
    'منذ 3 أيام': '3 days ago',
    'آخر 7 أيام': 'Last 7 days',
    'آخر 30 يوم': 'Last 30 days',
    'آخر 90 يوم': 'Last 90 days',
    // Categories (mock)
    'ترفيه': 'Entertainment',
    'رياضة': 'Sports',
    'طبخ': 'Cooking',
    // Sample campaign names (mock demo data)
    'عرض رمضان الكبير': 'Big Ramadan Offer',
    'إطلاق الجيل الجديد': 'Next-Gen Launch',
    'تخفيضات الموسم': 'Seasonal Sale',
    'مهرجان الطعام': 'Food Festival',
    'دروس الطبخ المباشرة': 'Live Cooking Classes',
    'بطاقات الهدايا': 'Gift Cards',
    'استبيان المنتج': 'Product Survey',
    // Sample comments / notifications (mock demo data)
    'شيء جميل!': 'Beautiful!',
    'سلوك مخالف': 'Violating behavior',
    'تعليق إعلاني خارجي': 'External ad comment',
    'كلام محرج': 'Embarrassing remark',
    'محتوى مكرر': 'Duplicate content',
    'محتوى مخالف للقانون': 'Unlawful content',
    'محبة لك يا صديقي': 'Love you, friend',
    'أعجبني!': 'I liked it!',
    'أين هذا المكان؟': 'Where is this place?',
    'شكراً': 'Thanks',
    'تحديث جديد متاح': 'A new update is available',
    'تحديات الأسبوع': "This week's challenges",
    'هدية ترحيبية': 'Welcome gift',
    'صيانة مجدولة الليلة': 'Scheduled maintenance tonight',
  });

  // ── User-generated dummy data strings (Names, Bios, Comments, etc.) ──
  Object.assign(DICT, {
    'أحمد الدوسري': 'Ahmed Aldosari',
    'سارة الشمري': 'Sarah Alshammari',
    'محمد القحطاني': 'Mohammed Alqahtani',
    'فاطمة العتيبي': 'Fatima Alotaibi',
    'علي السالم': 'Ali Alsalem',
    'نورة الغامدي': 'Noura Alghamdi',
    'يوسف الحربي': 'Youssef Alharbi',
    'ريم الخالدي': 'Reem Alkhaldi',
    'خالد الشهري': 'Khaled Alshehri',
    'مريم الزهراني': 'Maryam Alzahrani',
    'عبدالله المالكي': 'Abdullah Almalki',
    'ليلى المنصور': 'Laila Almansour',
    'سلمان القرني': 'Salman Alqarni',
    'هند السبيعي': 'Hind Alsubaie',
    'زياد المطيري': 'Ziad Almutairi',
    'منى التميمي': 'Mona Altamimi',
    'عبدالرحمن الشهري': 'Abdulrahman Alshehri',

    'صانع محتوى وفيديو 🎬 | الرياض ✨ شغف الإبداع': 'Video Content Creator 🎬 | Riyadh ✨ Passion for creativity',
    'رحالة ومحبة للطبيعة 🌍✈️ | كل يوم مغامرة جديدة': 'Traveler & Nature Lover 🌍✈️ | Everyday is a new adventure',
    'عشاق التقنية والمستقبل 💻⚡ | مراجعات وشروحات يومية': 'Tech & Future Enthusiast 💻⚡ | Daily reviews & tutorials',
    'مدونة طبخ وحلويات 🍰🍳 | أسهل وأشهى الوصفات المنزلية': 'Cooking & Pastry Blogger 🍰🍳 | Easiest & most delicious homemade recipes',
    'كرة قدم وتحديات رياضية ⚽🔥 | نحو القمة دائمًا': 'Football & Sports Challenges ⚽🔥 | Always towards the top',
    'مصممة ومصورة فوتوغرافية 🎨📸 | الجمال في التفاصيل': 'Designer & Photographer 🎨📸 | Beauty is in the details',
    'عازف موسيقى وصانع ألحان 🎵🎸 | أنغام تلامس الروح': 'Musician & Composer 🎵🎸 | Melodies that touch the soul',
    'يوميات وتحديات ترفيهية 🌟😂 | ابتسم للحياة': 'Vlogs & Fun Challenges 🌟😂 | Smile at life',
    'صانع محتوى إبداعي ومحب للموسيقى والتصوير ✨ الرياض 📍': 'Creative Content Creator & Lover of Music and Photography ✨ Riyadh 📍',

    'يستمع إلى الموسيقى 🎧': 'Listening to music 🎧',
    'في الكافيه ☕': 'At the cafe ☕',
    'يتدرب في النادي 💪': 'Training at the gym 💪',
    'يصور فيديو جديد 🎬': 'Shooting a new video 🎬',
    'في جولة تسوق 🛍️': 'On a shopping tour 🛍️',

    'أجواء خيالية في بوليفارد الرياض الليلة 🌃✨ #الرياض #موسم_الرياض #fyp': 'Magical vibes at Riyadh Boulevard tonight 🌃✨ #Riyadh #RiyadhSeason #fyp',
    'طريقة تحضير السوفليه في ٥ دقائق بس! جربوها وأعطوني رأيكم 🍰😋 #طبخ #حلويات': 'How to make soufflé in just 5 mins! Try it and let me know your thoughts 🍰😋 #cooking #sweets',
    'تمرين اليوم كان قاسي بس النتيجة تستاهل 💪🔥 #رياضة #تمارين #تحفيز': 'Today’s workout was tough but the result is worth it 💪🔥 #sports #workout #motivation',
    'غروب ساحل البحر الأحمر اليوم.. سبحان الخالق 🌊🌅 #سياحة #طبيعة #هدوء': 'Red Sea coast sunset today.. Glory to the Creator 🌊🌅 #tourism #nature #calm',
    'عزف سريع لمقطوعة موسيقية جديدة 🎶🎻 شاركوني رأيكم في الكومنتات! #موسيقى': 'Quick cover of a new musical piece 🎶🎻 Share your thoughts in the comments! #music',
    'مراجعة سريعة لأحدث هاتف ذكي في السوق 📱⚡ يستاهل تشتريه؟ #تقنية #تكنولوجيا': 'Quick review of the newest smartphone on the market 📱⚡ Worth buying? #tech #technology',
    'لحظات عفوية من وراء الكواليس للتصوير الأخير 🎬🍿 #فلوق #يوميات': 'Candid behind-the-scenes moments from the latest shoot 🎬🍿 #vlog #daily',
    'تنسيق ملابس كاجوال للموسم الجديد 👔👟 أنيق وبسيط #موضة #أزياء': 'Casual outfit styling for the new season 👔👟 Elegant and simple #fashion #style',
    'أفضل 3 كتب غيرت طريقة تفكيري في الحياة 📚💡 #قراءة #تطوير_الذات': 'Top 3 books that changed my way of thinking in life 📚💡 #reading #self_development',
    'تحدي رمي الكرة المستحيل! تتوقعون زبطت من أول محاولة؟ 🎯😂 #تحديات': 'Impossible ball throw challenge! Think I got it on the first try? 🎯😂 #challenges',
    'قهوة الصباح وجلسة هادئة تروّق البال ☕🌤️ صباحكم سعادة #صباح_الخير': 'Morning coffee and a quiet relaxing session ☕🌤️ Good morning and happiness #goodmorning',
    'مغامرة التسلق بين جبال طويق الساحرة ⛰️🧗‍♂️ #مغامرات #السعودية': 'Rock climbing adventure among the magical Tuwaiq mountains ⛰️🧗‍♂️ #adventures #SaudiArabia',

    'أول فيديو لي على FLYP! مرحبًا بالجميع 🥳✨ #welcome': 'My first video on FLYP! Hello everyone 🥳✨ #welcome',
    'لقطات من جولتي في وادي حنيفة اليوم 🌿🌤️ #طبيعة': 'Clips from my tour in Wadi Hanifa today 🌿🌤️ #nature',
    'جلسة تصوير احترافية في الرياض القديمة 📸🏛️ #تصوير': 'Professional photoshoot in old Riyadh 📸🏛️ #photography',
    'أجمل إطلالة لغروب الشمس في جبال طويق 🌄✨ #السعودية': 'The most beautiful sunset view at Tuwaiq mountains 🌄✨ #SaudiArabia',
    'عزف حي لأغنية الموسم في البوليفارد 🎵🔥 #موسيقى': 'Live performance of the season’s song at the Boulevard 🎵🔥 #music',
    'تحدي الطبخ السريع: تحضير طبق شرقي في دقيقة واحدة! 🍳😋 #طبخ': 'Fast cooking challenge: Making an oriental dish in one minute! 🍳😋 #cooking',

    'الأصلي - FLYP Sound 🎵': 'Original - FLYP Sound 🎵',
    'لحن الغروب - سارة الشمري 🎻': 'Sunset Melody - Sarah Alshammari 🎻',
    'نبضات الحماس - أحمد الدوسري ⚡': 'Enthusiastic Beats - Ahmed Aldosari ⚡',
    'أجواء ليلية - محمد القحطاني 🌙': 'Night Vibes - Mohammed Alqahtani 🌙',
    'إيقاع شرقي كلاسيكي - فرقة النغم 🎶': 'Classic Oriental Rhythm - Al-Nagham Band 🎶',
    'همسات الشتاء - ريم الخالدي ❄️': 'Winter Whispers - Reem Alkhaldi ❄️',

    'إبداع لا يوصف ما شاء الله! استمر 🔥👏': 'Indescribable creativity, Mashallah! Keep it up 🔥👏',
    'المكان هذا أين بالضبط؟ لازم أزوره 😍📍': 'Where exactly is this place? I must visit 😍📍',
    'التصوير والمونتاج احترافي بدرجة خيالية 🎬✨': 'The photography and editing are incredibly professional 🎬✨',
    'أفضل صانع محتوى في الساحة بلا منازع 💪❤️': 'The best content creator on the scene without a doubt 💪❤️',
    'يا سلام عليك، عطيتنا طاقة إيجابية لليوم كله ☀️🙌': 'Oh wow, you gave us positive energy for the whole day ☀️🙌',
    'متحمسين للفيديو القادم بكل تأكيد 🚀🔥': 'Definitely excited for the next video 🚀🔥',
    'الموسيقى مع اللقطات متناسقة جداً 🎶👌': 'The music and the shots are very synchronized 🎶👌',
    'أجمل محتوى شفته اليوم على الإطلاق! شكراً لك ❤️🌹': 'The most beautiful content I saw today, absolutely! Thank you ❤️🌹',
    'ممكن تسوي شرح عن الإعدادات اللي تستخدمها؟ 🎥🤔': 'Can you do a tutorial on the settings you use? 🎥🤔',
    'تسلم يدك، جربت الوصفة وطلعت مية مية 🍰😋': 'Bless your hands, I tried the recipe and it came out 100% 🍰😋',
    'التحدي أسطوري! كفو والله 🎯🎉': 'Legendary challenge! Well done 🎯🎉',

    'منذ دقيقة': '1m ago',
    'منذ 5 دقائق': '5m ago',
    'منذ 15 دقيقة': '15m ago',
    'منذ 3 ساعات': '3h ago',
    'منذ يومين': '2 days ago',
    'منذ دقيقتين': '2m ago',
    'منذ 10 دقائق': '10m ago',
    'منذ 25 دقيقة': '25m ago',
    'منذ 40 دقيقة': '40m ago',
    'منذ 4 أيام': '4 days ago',

    'أعجب بفيديو "أجواء خيالية في بوليفارد الرياض"': 'liked video "Magical vibes at Riyadh Boulevard tonight"',
    'بدأ بمتابعة حسابك': 'started following your account',
    'أرسل لك هدية "تاج الملوك 👑" في البث المباشر': 'sent you a "King\'s Crown 👑" gift in live stream',
    'علّق: "إبداع لا يوصف، استمر يا أسطورة!"': 'commented: "Indescribable creativity, keep it up legend!"',
    'و 42 آخرون أعجبوا بتعليقك الأخير': 'and 42 others liked your latest comment',
    'أشار إليك في فيديو: "شوفوا الإبداع هنا @abdulrahman"': 'mentioned you in a video: "Look at the creativity here @abdulrahman"',
    
    'فريق FLYP': 'FLYP Team',
    'مركز الأمان': 'Security Center',
    'تهانينا! وصل حسابك إلى 50,000 مشاهدة هذا الأسبوع 🎉': 'Congratulations! Your account reached 50,000 views this week 🎉',
    'تم توثيق وتأمين حسابك بنجاح ✅': 'Your account has been successfully verified and secured ✅',

    'أرباح بث مباشر': 'Live stream earnings',
    'جلسة الأحد المسائية 🎙️': 'Sunday evening session 🎙️',
    'صاروخ فضائي 🚀': 'Space Rocket 🚀',
    'شحن رصيد المحفظة': 'Top up wallet balance',
    'بطاقة مدى البنكية 💳': 'Mada Bank Card 💳',
    'الإثنين الماضي': 'Last Monday',
    'مكافأة برنامج المبدعين': 'Creator Program Reward',
    'مكافآت المشاهدات المليونية ⭐': 'Million views rewards ⭐',
    'سحب أرباح إلى الحساب البنكي': 'Withdraw earnings to bank account',
    'مصرف الراجحي ****4821': 'Al Rajhi Bank ****4821',

    'اليوم 11:24 ص': 'Today 11:24 AM',
    'اليوم 09:12 ص': 'Today 09:12 AM',
    'أمس 10:40 م': 'Yesterday 10:40 PM',
    '10:45 ص': '10:45 AM',
    '09:20 ص': '09:20 AM',
    '5/3': 'Mar 5',
    '4/3': 'Mar 4',
    '1/3': 'Mar 1',
    '5/4/2026': 'Apr 5, 2026',
    '1/4/2026': 'Apr 1, 2026',

    'وردة': 'Rose',
    'قلب ناري': 'Fiery Heart',
    'نجمة ذهبية': 'Golden Star',
    'كأس البطولة': 'Championship Cup',
    'يخت فاخر': 'Luxury Yacht',
    'سيارة رياضية': 'Sports Car',
    'طائرة خاصة': 'Private Jet',
    'قلعة الأحلام': 'Dream Castle',
    'تاج الملوك 👑': 'King\'s Crown 👑',

    '#موسم_الرياض': '#RiyadhSeason',
    '#يوم_التأسيس': '#FoundingDay',
    '#طبخات_سريعة': '#QuickRecipes',
    '#تحديات_تيك': '#TikTokChallenges',
    '#السعودية_العظمى': '#GreatSaudiArabia',
    '#موسيقى_عربية': '#ArabicMusic',
    '#تطوير_الذات': '#SelfDevelopment',
    '#عالم_السيارات': '#CarWorld',

    '48.6M مشاهدة': '48.6M views',
    '32.1M مشاهدة': '32.1M views',
    '19.4M مشاهدة': '19.4M views',
    '14.8M مشاهدة': '14.8M views',
    '11.2M مشاهدة': '11.2M views',
    '8.7M مشاهدة': '8.7M views',
    '6.5M مشاهدة': '6.5M views',
    '4.9M مشاهدة': '4.9M views',

    'الأصلي - FLYP Wave': 'Original - FLYP Wave',
    'FLYP Studio': 'FLYP Studio',
    'إيقاع شرقي حماسي': 'Enthusiastic Oriental Rhythm',
    'أوتار هادئة للاسترخاء': 'Calm Strings for Relaxation',
    'نبض الصحراء 2026': 'Desert Pulse 2026',
    'طاقة إيجابية ونشاط': 'Positive Energy and Activity',
    'جلسة عود كلاسيكية': 'Classic Oud Session',
    'فرقة الرياض الموسيقية': 'Riyadh Musical Band',
    'أنغام ليلية حالمة': 'Dreamy Night Melodies',
    'علي المنصور': 'Ali Almansour',
    'إلكترونك بيت عربي': 'Arabic Electronic Beat',
    'DJ Rayan': 'DJ Rayan',
    'لحن التأسيس الفاخر': 'Luxurious Founding Melody',
    'أجواء البحر والمطر': 'Sea and Rain Vibes',
    'خالد العنزي': 'Khaled Alenezi',
    'بوب شرقي حديث': 'Modern Oriental Pop',
    'ياسمين الحربي': 'Yasmin Alharbi',
    'تأمل وسكينة في الصباح': 'Morning Meditation and Serenity',
    'نورة الزهراني': 'Noura Alzahrani',

    'جلسة سوالف وقهوة مع المتابعين ☕✨': 'Chitchat & coffee session with followers ☕✨',
    'عزف مباشر وأغاني على الطلب 🎶🎸': 'Live music & songs on demand 🎶🎸',
    'تحدي ألعاب وأسئلة تفاعلية مع الجوائز 🎮🏆': 'Interactive games & trivia challenge with prizes 🎮🏆',
    'طبخ وجبة عشاء مباشرة معكم خطوة بخطوة 🍳🔥': 'Cooking dinner live step-by-step 🍳🔥',
    'جولة ليلية في شوارع ومطاعم الرياض 🚗🌃': 'Night tour in Riyadh streets & restaurants 🚗🌃',
    'تمرين لياقة مسائي وحرق دهون 💪⚡': 'Evening fitness workout & fat burning 💪⚡',
    'حوار مفتوح عن ريادة الأعمال وصناعة المحتوى 💼💡': 'Open discussion on entrepreneurship & content creation 💼💡',
    'تحدي الرسم السريع المباشر 🎨⚡': 'Live speed drawing challenge 🎨⚡',
    'جلسة سينما وتحليل أحدث الأفلام 🍿🎬': 'Cinema session & analyzing latest movies 🍿🎬',
    'حفل موسيقي لايف من الاستوديو 🎤🎉': 'Live concert from the studio 🎤🎉',
    'توقعات مباريات اليوم وتحليل فني ⚽🗣️': 'Today\'s match predictions & technical analysis ⚽🗣️',
    'تصميم جرافيك وبرمجة على الهواء مباشرة 💻🚀': 'Graphic design & coding live stream 💻🚀',

    'سوالف': 'Chitchat',
    'موسيقى': 'Music',
    'ألعاب': 'Games',
    'طبخ': 'Cooking',
    'جولات': 'Tours',
    'رياضة': 'Sports',
    'بزنس': 'Business',
    'فن': 'Art',
    'سينما': 'Cinema',
    'طرب': 'Melody',
    'كورة': 'Football',
    'تقنية': 'Tech',

    'تسلم يا بطل، تمام نلتقي بكرة في الكافيه ☕': 'Thanks champion, perfect we meet tomorrow at the cafe ☕',
    'شف المقطع اللي أرسلته لك، إبداع صراحة! 🔥': 'Look at the clip I sent you, truly creative! 🔥',
    'شكراً على الهدية الرائعة في البث المباشر 👑❤️': 'Thanks for the wonderful gift in the live stream 👑❤️',
    'تمام، اتفقنا على تفاصيل التعاون المشترك 🤝': 'Perfect, we agreed on the details of our collaboration 🤝',
    'ههههههههه مت من الضحك على الفيديو الأخير 😂👏': 'Hahaha I died laughing at the last video 😂👏',
    'تم تحويل الرصيد بنجاح، بالتوفيق!': 'Balance transferred successfully, good luck!',
    'إن شاء الله بكره ننزل الفيديو المشترك 🎬': 'God willing, tomorrow we drop the collab video 🎬',
    'ألف مبروك على التوثيق، تستاهل كل خير 🌟': 'Congratulations on the verification, you deserve the best 🌟',
    'مساء النور، كيف الحال والأمور؟': 'Good evening, how are things going?',
    'بث مباشر رائع، بانتظار الجلسة القادمة 🎶': 'Great live stream, waiting for the next session 🎶',

    'هلا والله يا غالي، كيف حالك؟': 'Welcome dear, how are you?',
    'أهلاً وسهلاً! الحمدلله بخير وأنت كيفك؟': 'Hello and welcome! Praise be to God, I am well and you?',
    'بألف صحة وعافية. شفت الفيديو الأخير اللي نزلته؟': 'In great health and wellness. Did you see the last video I posted?',
    'والله تمام، بس مشغول شوي هاليومين': 'Honestly fine, just a bit busy these days',
    'بخير الحمدلله، متى بتفتح بث؟': 'Fine thanks to God, when are you going live?',
    'أخبار الشغل معك تمام؟': 'How is work going with you?',
    'أجل، شفت المقطع ومرة ضحكني': 'Yes, I saw the clip and it really cracked me up',
    'حول لي الرصيد إذا قدرت': 'Transfer the balance to me if you can',
    'وش الأخبار؟ متى ننزل فيديو مشترك؟': 'What\'s new? When are we dropping a collab video?',
    'سمعت أنك توثقت، صدق؟': 'I heard you got verified, true?',
    'كيف الأمور معاك؟': 'How are things with you?',
    'البث كان نار البارح!': 'The stream was fire yesterday!',
    'الحمدلله الأمور طيبة! إن شاء الله كل شيء تمام.': 'Praise be to God, things are good! God willing, everything is perfect.',

    'تسجيل': 'Record',
    'صوت الموسيقى': 'Music sound',
    'تم إلغاء الحفظ': 'Unsaved',
    'ابحث عن مستخدمين، فيديوهات، أو أصوات': 'Search users, videos, or sounds',
    'متابع': 'Follower',
    'استخدام هذا الصوت': 'Use this sound',
    'استخدام': 'Use',
    'الحسابات': 'Accounts',
    'الأصوات والموسيقى': 'Sounds & Music',
    'فيديو': 'Video',
    'لا توجد نتائج للبحث': 'No search results',
    'أضف صوتًا': 'Add sound',
    'اختيار': 'Select',
    'تجميل': 'Beautify',
    'مؤقت التسجيل': 'Recording timer',
    'الفلاتر': 'Filters',
    'فلاش': 'Flash',
    'رفع': 'Upload',
    'الإشعارات': 'Notifications',
    'البريد': 'Chat',
    'رسائل': 'Messages',
    'لا يوجد مستخدمون آخرون': 'No other users',
    'صورة': 'Photo',
    'احمد': 'Ahmed',
    'أحمد': 'Ahmed',
    'استوديو': 'Studio',
    'لا توجد بثوث في هذا القسم الآن': 'No streams in this section right now',
    'مضيف': 'Host',
    'تابعتك من زمان': 'Followed you a long time ago',
    'سارة أحمد': 'Sarah Ahmed',
    'عمر خالد': 'Omar Khaled',
    'نورة الدوسري': 'Noura Aldosari',
    'فيصل القحطاني': 'Faisal Alqahtani',
    'ريم العتيبي': 'Reem Alotaibi',
    'خالد المطيري': 'Khaled Almutairi',
    'مخصص': 'Custom',
    'التعليقات': 'Comments',
    
    // Additional Discover / Profile / Feed missing translations
    'ليس لديك حساب؟ ': "Don't have an account? ",
    'انضم إلى FLYP': 'Join FLYP',
    'لم يصلك الرمز؟ ': "Didn't get the code? ",
    'صُنّاع محتوى مميزون': 'Featured creators',
    'جميع الحسابات المقترحة': 'All suggested accounts',
    'أصوات وموسيقى رائجة': 'Trending sounds & music',
    'لا يوجد محتوى للاستكشاف بعد': 'No content to explore yet',
    'عندما ينشر المستخدمون فيديوهات، ستظهر الاتجاهات وصُنّاع المحتوى هنا': 'When people post videos, trends and creators will show up here',
    'صوت: ': 'Sound: ',
    ' فيديو · ': ' Video · ',
    'جميع الفيديوهات الشائعة': 'All popular videos',
    'جاري البحث...': 'Searching...',
    '⚠️ تعذر فتح الكاميرا': '⚠️ Could not open camera',
    'اختر صوتًا للفيديو 🎵': 'Choose a sound for the video 🎵',
    'تم اختيار: ': 'Selected: ',
    'تعذر تحميل الأصوات': 'Could not load sounds',
    '🎬 معاينة الفيديو': '🎬 Video Preview',
    ' الإشارة إلى أشخاص': ' Tag people',
    ' إضافة موقع': ' Add location',
    ' من يستطيع المشاهدة': ' Who can watch',
    '🎤 رسالة صوتية': '🎤 Voice message',
    '📷 صورة': '📷 Photo',
    '🎥 فيديو': '🎥 Video',
    // Inbox previews for call rows and shared links. The dictionary matches a
    // whole string, emoji included, so every icon+label pair needs its own key
    // — the icon comes from the call kind and the label from its status, hence
    // both phone and camera variants of each.
    '📞 مكالمة صوتية': '📞 Voice call',
    '📹 مكالمة فيديو': '📹 Video call',
    '📞 مكالمة فائتة': '📞 Missed call',
    '📹 مكالمة فائتة': '📹 Missed call',
    '📞 مكالمة مرفوضة': '📞 Declined call',
    '📹 مكالمة مرفوضة': '📹 Declined call',
    '🔴 بث مباشر': '🔴 Live',
    '👤 حساب': '👤 Account',
    ' يتحدث الآن...': ' is talking now...',
    'تمام يا غالي! اتفقنا 👍': 'Alright dear! Agreed 👍',
    'يعطيك العافية، فكرة رائعة جداً 🔥': 'God bless you, very great idea 🔥',
    'إن شاء الله، نلتقي قريب وننسق البث القادم 🚀': 'God willing, we will meet soon and coordinate the next stream 🚀',
    'تسلم من ذوقك يا كابتن ❤️': 'Thanks for your taste captain ❤️',
    'أكيد، الحين أراجع المقطع وأرد عليك 🎬': 'Sure, I will review the clip now and reply to you 🎬',
    'ألف شكر على رسالتك وتفاعلك الجميل 🌹': 'A thousand thanks for your beautiful message and interaction 🌹',
    '🗺️ تتبع على الخريطة الآن': '🗺️ Track on map now',
    '📍 طلب تتبع الموقع': '📍 Location tracking request',
    '⏳ في انتظار الموافقة': '⏳ Awaiting approval',
    '✅ يتم التتبع — اضغط للإلغاء': '✅ Tracking — click to cancel',
    '❌ تم الرفض — أعد الطلب': '❌ Denied — request again',
    'إجمالي الإعجابات: ': 'Total likes: ',
    '✓ موافقة': '✓ Approve',
    '✗ رفض': '✗ Deny',
    '0 تعليق': '0 comments',
    ' إعجاب': ' Like',
    'مشاركة عبر ': 'Share via ',
    'تم الإرسال ✓': 'Sent ✓',
    'إرسال ': 'Send ',
    '📷 كاميرا': '📷 Camera',
    '🖼️ خلفية فقط': '🖼️ Background only',
    '⚠️ Agora App ID غير مضبوط — البث بدون فيديو فعلي': '⚠️ Agora App ID not set — stream without actual video',
    'البثوث المباشرة 🔴': 'Live Streams 🔴',
    'جميل جدًا 🔥': 'Very beautiful 🔥',
    'أرسلت لك هدية 🌹': 'Sent you a gift 🌹',
    'جاري تحميل الخريطة...': 'Loading map...',
    '💬 رسالة': '💬 Message',
    '👤 البروفايل': '👤 Profile',
    'أنت هنا': 'You are here',
    'منذ N د': 'N mins ago',
    '4.99 ر.س': '4.99 SAR',
    '19.99 ر.س': '19.99 SAR',
    '39.99 ر.س': '39.99 SAR',
    '149.99 ر.س': '149.99 SAR',
    'جاري التحميل...': 'Loading...',
    'إلغاء حظر ': 'Unblock ',
    ' طلب — راجعها من شاشة الإشعارات': ' request — review it from notifications screen',
    'متابعون': 'Followers',
    'متابَعين': 'Following',
    'إعجابات': 'Likes',
    'استكشف': 'Discover',
    'تعديل': 'Edit',
    'عرض': 'Show',
    'عرض المزيد': 'see more',
    'مشاهدة المزيد': 'See more',
    'الكلمات المخفية': 'Hidden words',
    'الحسابات المقيّدة': 'Restricted accounts',
    'الحسابات المكتومة': 'Muted accounts',
    'لا توجد حسابات مقيّدة': 'No restricted accounts',
    'لا توجد حسابات مكتومة': 'No muted accounts',
    'تعليقات الحسابات المقيّدة تظهر لهم فقط': 'Comments from restricted accounts are only visible to them',
    'فيديوهات الحسابات المكتومة لا تظهر في موجزك': 'Videos from muted accounts do not appear in your feed',
    'الشخص المقيّد لا يعرف أنه مقيّد. تعليقاته على فيديوهاتك تظهر له وحده، ولا يمكنه مراسلتك.': 'A restricted person is not told. Their comments on your videos are visible only to them, and they cannot message you.',
    'الكتم يخفي فيديوهات الشخص من موجزك دون إلغاء متابعته، ولا يعرف بذلك.': 'Muting hides someone from your feed without unfollowing them. They are not told.',
    'التعليقات التي تحتوي على هذه الكلمات لن تظهر لك. لا يعرف صاحب التعليق بذلك.': 'Comments containing these words will not be shown to you. The commenter is not told.',
    'أضف كلمة أو عبارة': 'Add a word or phrase',
    'إضافة': 'Add',
    'لا توجد كلمات مخفية': 'No hidden words',
    'إلغاء التقييد': 'Unrestrict',
    'إلغاء الكتم': 'Unmute',
    'تم التقييد': 'Restricted',
    'تم إلغاء التقييد': 'Unrestricted',
    'تم الكتم': 'Muted',
    'تم إلغاء الكتم': 'Unmuted',
    'تعذر الإضافة': 'Could not add',
    'تعذر الحذف': 'Could not remove',
    'الأشخاص الذين أتابعهم': 'People I follow',
    'لا أحد': 'No one',
    'لا يمكنك مراسلة هذا المستخدم': 'You cannot message this user',
    'اليوم': 'Today',
    'هذا الأسبوع': 'This week',
    'أقدم': 'Earlier',
    'عندما يتفاعل أحد مع محتواك، سيظهر هنا': 'When someone interacts with your content, it will show up here',
    'مقاطع': 'videos',
    'مشاهدة': 'views',
    'أنشئ فيديو بهذا الوسم': 'Create a video with this tag',
    'لا توجد فيديوهات بهذا الوسم بعد': 'No videos with this tag yet',
    'تعذر تحميل الوسم': 'Could not load the tag',
    '# هاشتاج': '# Hashtag',
    '@ إشارة': '@ Mention',
    'أنا فقط': 'Only me',
    'مراجعة': 'Review',
    'اقتصاص': 'Trim',
    'إعادة التصوير': 'Retake',
    'جاري المعالجة...': 'Processing...',
    'تعذر اقتصاص الفيديو': 'Could not trim the video',
    'لا يوجد صوت مرتبط بهذا الفيديو': 'No sound linked to this video',
    'تبديل الكاميرا': 'Flip',
    'التجميل غير متاح بعد': 'Beautify is not available yet',
    'المؤقت غير متاح بعد': 'Timer is not available yet',
    'الفلاتر غير متاحة بعد': 'Filters are not available yet',
    'الفلاش غير متاح بعد': 'Flash is not available yet',
    'المؤثرات غير متاحة بعد': 'Effects are not available yet',
    'سرعة التسجيل غير متاحة بعد': 'Recording speed is not available yet',
    'صوت أصلي': 'Original sound',
    'إضافة إلى المفضلة': 'Add to favorites',
    'في المفضلة': 'In favorites',
    'الصوت غير موجود': 'Sound not found',
    'تعذر تحميل الصوت': 'Could not load the sound',
    'لا توجد فيديوهات بهذا الصوت بعد': 'No videos with this sound yet',
    'كن أول من يستخدمه': 'Be the first to use it',
    'معلومات شخصية': 'Personal details',
    'الجنس': 'Gender',
    'الدولة': 'Country',
    'اختر': 'Select',
    'ذكر': 'Male',
    'أنثى': 'Female',
    'آخر': 'Other',
    'أفضّل عدم الإفصاح': 'Prefer not to say',
    'هذه المعلومات خاصة ولا تظهر في ملفك الشخصي': 'These details are private and are not shown on your profile',
    'الملف الشخصي': 'Profile',
    'الروابط': 'Links',
    'صورة الملف الشخصي': 'Profile photo',
    'اسم المستخدم مطلوب': 'Username is required',
    'الرابط': 'Link',
    'حساب خاص': 'Private account',
    'مشاركة الملف الشخصي': 'Share profile',
    'تثبيت': 'Pin',
    'إلغاء التثبيت': 'Unpin',
    'تم التثبيت': 'Pinned',
    'تم إلغاء التثبيت': 'Unpinned',
    'تعذر التثبيت': 'Could not pin',
    'يمكنك تثبيت 3 فيديوهات كحد أقصى': 'You can pin up to 3 videos',
    'إرفاق': 'Attach',
    'الصور': 'Photos',
    'مستند': 'Document',
    'الموقع': 'Location',
    'الموقع الحالي': 'Current location',
    'ملف': 'File',
    'تعذر إرسال المرفق': 'Could not send the attachment',
    // Upload restrictions. The first was added with the video-only rule and
    // never given a translation, so English users saw Arabic on a rejection.
    'يمكنك نشر مقاطع الفيديو فقط': 'You can only post videos',
    'يمكنك إرسال الصور ومقاطع الفيديو فقط': 'You can only send photos and videos',
    'الموقع غير مدعوم على هذا الجهاز': 'Location is not supported on this device',
    'جاري تحديد الموقع...': 'Getting your location...',
    'تعذر إرسال الموقع': 'Could not send the location',
    'تعذر الوصول إلى الموقع': 'Could not access your location',
    'تعذر فتح التطبيق': 'Could not open the app',
    'لا يوجد فيديو للتنزيل': 'No video to download',
    'تعذر التنزيل': 'Download failed',
    'تعذر النسخ': 'Could not copy',
    'تنزيل': 'Download',
    'إرسال إلى': 'Send to',
    'مسح': 'Clear',
    'مكالمة صوتية': 'Voice call',
    'مكالمة فيديو': 'Video call',
    'جاري الاتصال...': 'Calling...',
    'تم رفض المكالمة': 'Call declined',
    'انتهت المكالمة': 'Call ended',
    'لم يتم الرد': 'No answer',
    'كتم': 'Mute',
    'الكاميرا': 'Camera',
    'قبول': 'Accept',
    'الصوت والفيديو غير مفعلين — أضف Agora App ID': 'Audio and video are not enabled - add your Agora App ID',
    'لا يمكن بدء المكالمة': 'Cannot start the call',
    'المكالمات الجماعية غير متاحة بعد': 'Group calls are not available yet',
    'تعذر بدء المكالمة': 'Could not start the call',
    'لا توجد رسائل بعد': 'No messages yet',
    'هذه بداية محادثتكما — قل مرحبًا': 'This is the start of your conversation — say hello',
    'عرض أقل': 'see less'
  });

  // Auto-split descriptions with hashtags so they can be translated separately
  // when views.js splits them into different span elements.
  Object.keys(DICT).forEach(key => {
    const hashtagMatch = key.match(/(#\S+(\s+#\S+)*\s*)$/);
    if (hashtagMatch) {
      const plainKey = key.slice(0, hashtagMatch.index).trimEnd();
      const hashtagKey = hashtagMatch[0].trim();
      
      const val = DICT[key];
      const valMatch = val.match(/(#\S+(\s+#\S+)*\s*)$/);
      if (valMatch) {
        const plainVal = val.slice(0, valMatch.index).trimEnd();
        const hashtagVal = valMatch[0].trim();
        
        if (!DICT[plainKey]) DICT[plainKey] = plainVal;
        if (!DICT[hashtagKey]) DICT[hashtagKey] = hashtagVal;
      }
    }
  });

  // Auto-split music descriptions (e.g., "Song - Artist")
  Object.keys(DICT).forEach(key => {
    if (key.includes(' - ')) {
      const parts = key.split(' - ');
      const valParts = DICT[key].split(' - ');
      if (parts.length === 2 && valParts.length === 2) {
        if (!DICT[parts[0]]) DICT[parts[0]] = valParts[0];
        if (!DICT[parts[1]]) DICT[parts[1]] = valParts[1];
      }
    }
  });

  // ── Parametric rules: whole-text-node patterns with a number/word slot ──
  // Each entry: [regex on the FULL trimmed text, replacement function].
  const RULES = [
    // Storage usage is built by concatenation, so no fixed dictionary
    // entry can ever match it.
    [/^([\d.,]+\s*[KMGT]?B) من ([\d.,]+\s*[KMGT]?B)$/, (m) => `${m[1]} of ${m[2]}`],
    [/^(\d+) يوم$/, (m) => `${m[1]} days`],
    // The device name is appended, so this can never be a fixed entry.
    [/^تسجيل دخول جديد من (.+)$/, (m) => `New sign-in from ${m[1]}`],
    [/^سيصل إلى (.+) حساب$/, (m) => `Reaches ${m[1]} accounts`],
    [/^حساب مجدول للحذف: (\d+)$/, (m) => `Accounts scheduled for deletion: ${m[1]}`],
    [/^طلب بيانات بانتظار المعالجة: (\d+)$/, (m) => `Data requests pending: ${m[1]}`],
    [/^بلاغ بانتظار المراجعة: (\d+)$/, (m) => `Reports awaiting review: ${m[1]}`],
    [/^بلاغ دعم مفتوح: (\d+)$/, (m) => `Open support tickets: ${m[1]}`],
    [/^كتم (.+)$/, (m) => `Mute ${DICT[m[1]] || m[1]}`],
    [/^تقييد (.+)$/, (m) => `Restrict ${DICT[m[1]] || m[1]}`],
    [/^تبقّى (\d+) يومًا\. يمكنك إلغاء الحذف الآن والاحتفاظ بكل شيء\.$/, (m) => `${m[1]} days left. You can cancel the deletion now and keep everything.`],
    [/^آخر تحديث: (.+)$/, (m) => `Last updated: ${m[1]}`],
    [/^(\d+) من أصدقائك يشاركون موقعهم$/, (m) => `${m[1]} of your friends are sharing`],
    [/^كلمة المرور ضعيفة: (.+)$/, (m) => `Password too weak: ${m[1]}`],
    [/^أرسلنا رابط تأكيد إلى (.+)\. إذا وصلتك رسالة على بريدك الحالي أيضًا، فأكّد من كليهما\.$/, (m) => `We sent a confirmation link to ${m[1]}. If your current address also received one, confirm from both.`],
    [/^أرسلنا لك رمزًا مكونًا من (\d+) أرقام$/, (m) => `We sent you a ${m[1]}-digit code`],
    [/^سنرسل رمزًا مكونًا من (\d+) أرقام إلى بريدك$/, (m) => `We will send a ${m[1]}-digit code to your email`],
    [/^أرسلنا رمزًا مكونًا من (\d+) أرقام إلى$/, (m) => `We sent a ${m[1]}-digit code to`],
    [/^وصلت إلى حد الرفع اليومي \((\d+)\)\. حاول غدًا\.$/, (m) => `You have reached your daily upload limit (${m[1]}). Try tomorrow.`],
    [/^إعادة الإرسال \((\d+)\)$/, (m) => `Resend (${m[1]})`],
    [/^انتظر (\d+) ثانية قبل طلب رمز جديد$/, (m) => `Wait ${m[1]} seconds before asking for a new code`],
    [/^(\d+) من أصدقائك المقربين$/, (m) => `${m[1]} close friends`],
    [/^منذ (\d+) د$/, (m) => `${m[1]}m ago`],
    [/^منذ (\d+) س$/, (m) => `${m[1]}h ago`],
    [/^منذ (\d+) يوم$/, (m) => `${m[1]}d ago`],
    [/^(\d+)د$/, (m) => `${m[1]}m`],
    [/^(\d+)س$/, (m) => `${m[1]}h`],
    [/^(\d+)ي$/, (m) => `${m[1]}d`],
    [/^(\d+) تعليق$/, (m) => `${m[1]} comment${m[1] === '1' ? '' : 's'}`],
    [/^(\d+) إعجاب$/, (m) => `${m[1]} like${m[1] === '1' ? '' : 's'}`],
    [/^إجمالي الإعجابات: (.+)$/, (m) => `Total likes: ${m[1]}`],
    [/^إلغاء حظر (.+)$/, (m) => `Unblock ${DICT[m[1]] || m[1]}`],
    [/^مشاركة عبر (.+)$/, (m) => `Share via ${m[1]}`],

    [/^إرسال \((\d+)\)$/, (m) => `Send (${m[1]})`],
    [/^(\d+) (?:صديق|صديقان|أصدقاء) على الخريطة$/, (m) => `${m[1]} friend${m[1] === '1' ? '' : 's'} on the map`],
    [/^تم شحن (\d+) عملة$/, (m) => `Topped up ${m[1]} coins`],
    [/^🎙️ (.+) يتحدث الآن\.\.\.$/, (m) => `🎙️ ${DICT[m[1]] || m[1]} is talking now...`],
    [/^هدية من (.+)$/, (m) => `Gift from ${DICT[m[1]] || m[1]}`],
    [/^إرسال هدية لـ (.+)$/, (m) => `Send gift to ${DICT[m[1]] || m[1]}`],
    [/^حظر (.+)$/, (m) => `Block ${DICT[m[1]] || m[1]}`],
    [/^حجم الملف كبير جدًا \(الحد الأقصى (\d+) ميجابايت\)$/, (m) => `File is too large (max ${m[1]} MB)`],
    [/^مدة الفيديو طويلة جدًا \(الحد الأقصى (\d+) ثانية\)$/, (m) => `Video is too long (max ${m[1]} seconds)`],
    [/^جاري ضغط الفيديو\.\.\. (\d+)%$/, (m) => `Compressing video... ${m[1]}%`],
    [/^اكتمل الضغط \((\d+)٪ توفير\) · جاري الرفع\.\.\.$/, (m) => `Compressed (${m[1]}% saved) · Uploading...`],
    [/^تم اختيار: (.+)$/, (m) => `Selected: ${m[1]}`],
    [/^صوت: (.+)$/, (m) => `Sound: ${m[1]}`],
    [/^فيديو · (.+)$/, (m) => `Video · ${m[1]}`],
    [/^علّق: "(.*)"$/, (m) => `commented: "${m[1]}"`],
    [/^رد على تعليقك: "(.*)"$/, (m) => `replied to your comment: "${m[1]}"`],
    [/^المدة (.*) · أعلى عدد مشاهدين (.*)$/, (m) => `Duration ${m[1]} · Peak viewers ${m[2]}`],
    [/^خطأ في التحميل: (.+)$/, (m) => `Load error: ${m[1]}`],
    [/^([\d.,KM]+) متابع$/, (m) => `${m[1]} follower${m[1] === '1' ? '' : 's'}`],
    [/^([\d.,KM]+) فيديو$/, (m) => `${m[1]} video${m[1] === '1' ? '' : 's'}`],
    [/^([\d.,KM]+) مشاهدة$/, (m) => `${m[1]} view${m[1] === '1' ? '' : 's'}`],
    // The leading name is looked up in DICT so seeded catalog names (sound
    // authors etc.) translate too; real user names pass through unchanged.
    [/^(.+) · ([\d.,KM]+) متابع$/, (m) => `${DICT[m[1]] || m[1]} · ${m[2]} follower${m[2] === '1' ? '' : 's'}`],
    [/^(.+) · ([\d.,KM]+) فيديو · (\d+)ث$/, (m) => `${DICT[m[1]] || m[1]} · ${m[2]} videos · ${m[3]}s`],
    // Admin parametric strings
    [/^تعذر التحميل: (.+)$/, (m) => `Couldn't load: ${m[1]}`],
    [/^تعذر الحذف: (.+)$/, (m) => `Couldn't delete: ${m[1]}`],
    [/^خطأ: (.+)$/, (m) => `Error: ${m[1]}`],
    [/^انضم: (.+)$/, (m) => `Joined: ${m[1]}`],
    [/^فيديو #(.+)$/, (m) => `Video #${m[1]}`],
    [/^· وصل لـ (.+)$/, (m) => `· reached ${m[1]}`],
    [/^عرض 1-(.+)$/, (m) => `Showing 1-${m[1]}`],
    [/^(\d+) يوم متبقي$/, (m) => `${m[1]} day${m[1] === '1' ? '' : 's'} left`],
    [/^حذف (.+) نهائيًا؟ هذا الإجراء غير قابل للتراجع\.\s*سيتم حذف جميع الفيديوهات والمحفظة والتعليقات\.$/,
      (m) => `Permanently delete ${m[1]}? This cannot be undone. All videos, wallet and comments will be deleted.`],
  ];

  function translate(str) {
    if (str == null) return str;
    const key = String(str).trim();
    if (!key) return str;
    if (Object.prototype.hasOwnProperty.call(DICT, key)) {
      // Preserve any surrounding whitespace the original text node had
      return String(str).replace(key, DICT[key]);
    }
    for (let i = 0; i < RULES.length; i++) {
      const m = key.match(RULES[i][0]);
      if (m) return String(str).replace(key, RULES[i][1](m));
    }
    return str;
  }

  // ── DOM walking ──
  const TRANSLATABLE_ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

  function translateElement(elm) {
    if (!elm || elm.nodeType !== 1) return;
    // attributes
    for (let i = 0; i < TRANSLATABLE_ATTRS.length; i++) {
      const a = TRANSLATABLE_ATTRS[i];
      if (elm.hasAttribute && elm.hasAttribute(a)) {
        const v = elm.getAttribute(a);
        const tv = translate(v);
        if (tv !== v) elm.setAttribute(a, tv);
      }
    }
    // <input type=button/submit> value
    if (elm.tagName === 'INPUT' && (elm.type === 'button' || elm.type === 'submit') && elm.value) {
      const tv = translate(elm.value);
      if (tv !== elm.value) elm.value = tv;
    }
  }

  function walk(node) {
    if (!node) return;
    if (node.nodeType === 3) { // text node
      const tv = translate(node.nodeValue);
      if (tv !== node.nodeValue) node.nodeValue = tv;
      return;
    }
    if (node.nodeType !== 1) return;
    // Skip elements we never want to touch
    if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return;
    translateElement(node);
    let child = node.firstChild;
    while (child) { walk(child); child = child.nextSibling; }
  }

  function apply(root) {
    if (getLang() !== 'en') return;
    walk(root || document.body);
  }

  // ── Translate content that arrives after the view has rendered ──
  //
  // The router calls apply(document.body) once, synchronously, the moment a
  // view function returns. Anything that appears later never saw it: a screen
  // that waits on the camera, a list that waits on the API, a sheet or dialog
  // opened by a tap. Those stayed in Arabic with the app set to English —
  // the "go live" window was one of several.
  //
  // Watching for inserted nodes covers all of them at once, instead of every
  // async render having to remember to call apply() on itself.
  let observer = null;
  let translating = false;

  function observeAdditions() {
    if (observer || typeof MutationObserver === 'undefined' || !document.body) return;
    observer = new MutationObserver((records) => {
      // Our own rewriting mutates text nodes, which would re-enter this
      // callback forever without the guard.
      if (translating || getLang() !== 'en') return;
      translating = true;
      try {
        for (const rec of records) {
          const added = rec.addedNodes;
          for (let i = 0; i < added.length; i++) {
            const n = added[i];
            if (n.nodeType === 1 || n.nodeType === 3) walk(n);
          }
        }
      } catch (e) {
        console.warn('i18n observer:', e);
      } finally {
        translating = false;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeAdditions, { once: true });
  } else {
    observeAdditions();
  }

  // ── Language state ──
  function getLang() {
    try { return localStorage.getItem('tt-lang') === 'en' ? 'en' : 'ar'; }
    catch (e) { return 'ar'; }
  }

  function applyDir(lang) {
    const html = document.documentElement;
    html.setAttribute('lang', lang === 'en' ? 'en' : 'ar');
    html.setAttribute('dir', lang === 'en' ? 'ltr' : 'rtl');
    document.body.classList.toggle('lang-en', lang === 'en');
  }

  function setLang(lang) {
    lang = lang === 'en' ? 'en' : 'ar';
    try { localStorage.setItem('tt-lang', lang); } catch (e) {}
    applyDir(lang);
    // Re-render the current view from its Arabic source; the observer +
    // apply() pass then translates to English when needed.
    window.dispatchEvent(new Event('tt-rerender'));
  }

  function toggleLang() { setLang(getLang() === 'en' ? 'ar' : 'en'); }

  // ── MutationObserver: catch async DOM (feeds, modals, toasts) ──
  function startObserver() {
    const obs = new MutationObserver((mutations) => {
      if (getLang() !== 'en') return;
      for (let i = 0; i < mutations.length; i++) {
        const mut = mutations[i];
        if (mut.type === 'childList') {
          mut.addedNodes.forEach((n) => walk(n));
        } else if (mut.type === 'attributes' && mut.target) {
          translateElement(mut.target);
        } else if (mut.type === 'characterData' && mut.target) {
          const t = mut.target;
          const tv = translate(t.nodeValue);
          if (tv !== t.nodeValue) t.nodeValue = tv;
        }
      }
    });
    obs.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: TRANSLATABLE_ATTRS,
    });
  }

  // ── Patch native dialogs so confirm/prompt/alert show English too ──
  function patchDialogs() {
    ['alert', 'confirm', 'prompt'].forEach((fn) => {
      const orig = window[fn];
      if (typeof orig !== 'function' || orig.__ttPatched) return;
      const wrapped = function (msg) {
        if (getLang() === 'en' && typeof msg === 'string') {
          msg = translate(msg);
        }
        return orig.apply(window, [msg].concat([].slice.call(arguments, 1)));
      };
      wrapped.__ttPatched = true;
      try { window[fn] = wrapped; } catch (e) {}
    });
  }

  // ── Public API ──
  // Dev tool: in English mode, find anything still rendering Arabic.
  // Project rule: English selected => every UI string must be English.
  // Genuine user content (captions, display names) is exempt by design, so
  // pass {includeUserContent:true} to see those too.
  function audit(opts) {
    const o = opts || {};
    const AR = /[؀-ۿ]/;
    const SKIP = /^(SCRIPT|STYLE|NOSCRIPT)$/;
    const USER_CONTENT = ['.desc', '.vc-desc', '.video-desc', '.caption', '.msg-text',
                          '.comment-text', '.name', '.handle', '.creator-name',
                          '.bio', '.sound-title', '.feed-info .user'];
    const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'value', 'data-label'];
    const hits = [];
    const pathOf = (el) => {
      const path = [];
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        path.unshift(e.tagName.toLowerCase() + (e.className && typeof e.className === 'string'
          ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''));
      }
      return path.slice(-3).join(' > ');
    };
    const exempt = (el) => !o.includeUserContent && USER_CONTENT.some(sel => el.closest(sel));

    // 1. visible text nodes
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) {
      const txt = (n.nodeValue || '').trim();
      if (!txt || !AR.test(txt)) continue;
      const el = n.parentElement;
      if (!el || SKIP.test(el.tagName) || exempt(el)) continue;
      hits.push({ kind: 'text', text: txt, where: pathOf(el),
                  inDict: Object.prototype.hasOwnProperty.call(DICT, txt) });
    }

    // 2. live form values (input.value is a PROPERTY - not the value attribute)
    document.body.querySelectorAll('input, textarea, select').forEach((el) => {
      if (exempt(el)) return;
      const v = el.value;
      if (v && AR.test(v)) {
        hits.push({ kind: '.value', text: String(v).trim(), where: pathOf(el),
                    inDict: Object.prototype.hasOwnProperty.call(DICT, String(v).trim()) });
      }
    });

    // 3. translatable attributes (placeholder, title, aria-label, alt, ...)
    document.body.querySelectorAll('*').forEach((el) => {
      if (SKIP.test(el.tagName) || exempt(el)) return;
      ATTRS.forEach((a) => {
        const v = el.getAttribute && el.getAttribute(a);
        if (v && AR.test(v)) {
          hits.push({ kind: '@' + a, text: v.trim(), where: pathOf(el),
                      inDict: Object.prototype.hasOwnProperty.call(DICT, v.trim()) });
        }
      });
    });
    if (getLang() !== 'en') {
      console.warn('[i18n audit] language is not English - switch to English first.');
    }
    console.log('[i18n audit] ' + hits.length + ' Arabic string(s) still rendered:');
    if (hits.length) console.table(hits);
    return hits;
  }

  // Public API
  window.I18N = {
    t: translate,
    apply,
    getLang,
    setLang,
    toggleLang,
    audit,
    DICT,
  };

  // Boot
  applyDir(getLang());
  patchDialogs();
  if (document.body) startObserver();
  else document.addEventListener('DOMContentLoaded', startObserver);
})();
