/* === Tenth Tone — bilingual (Arabic ⇄ English) layer ===
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
    'لك': 'You',
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
  };

  // ── Admin dashboard strings (shares DICT; merged here to keep the literal small) ──
  Object.assign(DICT, {
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

    'أول فيديو لي على Tenth Tone! مرحبًا بالجميع 🥳✨ #welcome': 'My first video on Tenth Tone! Hello everyone 🥳✨ #welcome',
    'لقطات من جولتي في وادي حنيفة اليوم 🌿🌤️ #طبيعة': 'Clips from my tour in Wadi Hanifa today 🌿🌤️ #nature',
    'جلسة تصوير احترافية في الرياض القديمة 📸🏛️ #تصوير': 'Professional photoshoot in old Riyadh 📸🏛️ #photography',
    'أجمل إطلالة لغروب الشمس في جبال طويق 🌄✨ #السعودية': 'The most beautiful sunset view at Tuwaiq mountains 🌄✨ #SaudiArabia',
    'عزف حي لأغنية الموسم في البوليفارد 🎵🔥 #موسيقى': 'Live performance of the season’s song at the Boulevard 🎵🔥 #music',
    'تحدي الطبخ السريع: تحضير طبق شرقي في دقيقة واحدة! 🍳😋 #طبخ': 'Fast cooking challenge: Making an oriental dish in one minute! 🍳😋 #cooking',

    'الأصلي - Tenth Tone Sound 🎵': 'Original - Tenth Tone Sound 🎵',
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
    
    'فريق Tenth Tone': 'Tenth Tone Team',
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

    'الأصلي - Tenth Tone Wave': 'Original - Tenth Tone Wave',
    'Tenth Tone Studio': 'Tenth Tone Studio',
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
    'انضم إلى Tenth Tone': 'Join Tenth Tone',
    'لم يصلك الرمز؟ ': "Didn't get the code? ",
    'هاشتاجات رائجة 🔥': 'Trending Hashtags 🔥',
    'صُنّاع محتوى مميزون 🌟': 'Featured Creators 🌟',
    'جميع الحسابات المقترحة 🌟': 'All Suggested Accounts 🌟',
    'أصوات وموسيقى رائجة 🎵': 'Trending Sounds & Music 🎵',
    'صوت: ': 'Sound: ',
    ' فيديو · ': ' Video · ',
    'فيديوهات شائعة 🎬': 'Popular Videos 🎬',
    'جميع الفيديوهات الشائعة 🎬': 'All Popular Videos 🎬',
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
    [/^منذ (\d+) د$/, (m) => `${m[1]}m ago`],
    [/^منذ (\d+) س$/, (m) => `${m[1]}h ago`],
    [/^منذ (\d+) يوم$/, (m) => `${m[1]}d ago`],
    [/^(\d+)د$/, (m) => `${m[1]}m`],
    [/^(\d+)س$/, (m) => `${m[1]}h`],
    [/^(\d+)ي$/, (m) => `${m[1]}d`],
    [/^(\d+) تعليق$/, (m) => `${m[1]} comment${m[1] === '1' ? '' : 's'}`],
    [/^(\d+) إعجاب$/, (m) => `${m[1]} like${m[1] === '1' ? '' : 's'}`],
    [/^إجمالي الإعجابات: (.+)$/, (m) => `Total likes: ${m[1]}`],
    [/^إلغاء حظر (.+)$/, (m) => `Unblock ${m[1]}`],
    [/^مشاركة عبر (.+)$/, (m) => `Share via ${m[1]}`],

    [/^إرسال \((\d+)\)$/, (m) => `Send (${m[1]})`],
    [/^(\d+) (?:صديق|صديقان|أصدقاء) على الخريطة$/, (m) => `${m[1]} friend${m[1] === '1' ? '' : 's'} on the map`],
    [/^تم شحن (\d+) عملة$/, (m) => `Topped up ${m[1]} coins`],
    [/^🎙️ (.+) يتحدث الآن\.\.\.$/, (m) => `🎙️ ${DICT[m[1]] || m[1]} is talking now...`],
    [/^هدية من (.+)$/, (m) => `Gift from ${DICT[m[1]] || m[1]}`],
    [/^إرسال هدية لـ (.+)$/, (m) => `Send gift to ${DICT[m[1]] || m[1]}`],
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
  window.I18N = {
    t: translate,
    apply,
    getLang,
    setLang,
    toggleLang,
    DICT,
  };

  // Boot
  applyDir(getLang());
  patchDialogs();
  if (document.body) startObserver();
  else document.addEventListener('DOMContentLoaded', startObserver);
})();
