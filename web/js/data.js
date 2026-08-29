/* === Mock data store for Tenth Tone === */
window.DB = (function () {
  // Diverse, high quality realistic avatar URLs
  const AVATARS = [
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=200&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=200&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=200&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=200&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=200&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=200&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=200&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1528892952291-009c663ce843?w=200&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=200&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80',
  ];

  const NAMES = [
    'أحمد الدوسري', 'سارة الشمري', 'محمد القحطاني', 'فاطمة العتيبي',
    'علي السالم', 'نورة الغامدي', 'يوسف الحربي', 'ريم الخالدي',
    'خالد الشهري', 'مريم الزهراني', 'عبدالله المالكي', 'ليلى المنصور',
    'سلمان القرني', 'هند السبيعي', 'زياد المطيري', 'منى التميمي'
  ];

  const HANDLES = [
    'ahmed_d', 'sarah.sh', 'mhmd_q', 'fatima.otb',
    'ali_salem', 'nora_gh', 'yusuf_h', 'reem.kh',
    'khaled_sh', 'maryam.z', 'abdullah_m', 'layla_m',
    'salman_q', 'hind.sub', 'ziyad_m', 'mona_t'
  ];

  const BIOS = [
    'صانع محتوى وفيديو 🎬 | الرياض ✨ شغف الإبداع',
    'رحالة ومحبة للطبيعة 🌍✈️ | كل يوم مغامرة جديدة',
    'عشاق التقنية والمستقبل 💻⚡ | مراجعات وشروحات يومية',
    'مدونة طبخ وحلويات 🍰🍳 | أسهل وأشهى الوصفات المنزلية',
    'كرة قدم وتحديات رياضية ⚽🔥 | نحو القمة دائمًا',
    'مصممة ومصورة فوتوغرافية 🎨📸 | الجمال في التفاصيل',
    'عازف موسيقى وصانع ألحان 🎵🎸 | أنغام تلامس الروح',
    'يوميات وتحديات ترفيهية 🌟😂 | ابتسم للحياة',
  ];

  // High quality thumbnails for videos (verified high-reliability vertical imagery)
  const THUMBNAILS = [
    'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=600&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&auto=format&fit=crop&q=80',
  ];

  const users = NAMES.map((n, i) => ({
    id: 'u' + (i + 1),
    name: n,
    handle: '@' + HANDLES[i % HANDLES.length],
    avatar: AVATARS[i % AVATARS.length],
    bio: BIOS[i % BIOS.length],
    followers: 14200 + i * 2840,
    following: 120 + i * 18,
    likes: 85400 + i * 14200,
    verified: i % 3 === 0,
    location: {
      lat: 24.7136 + (Math.sin(i) * 0.05),
      lng: 46.6753 + (Math.cos(i) * 0.05),
      city: ['الرياض', 'جدة', 'الدمام', 'دبي', 'الدوحة', 'الكويت'][i % 6],
      status: ['يستمع إلى الموسيقى 🎧', 'في الكافيه ☕', 'يتدرب في النادي 💪', 'يصور فيديو جديد 🎬', 'في جولة تسوق 🛍️'][i % 5]
    }
  }));

  // Current user
  const me = {
    id: 'me',
    name: 'عبدالرحمن الشهري',
    handle: '@abdulrahman',
    avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80',
    bio: 'صانع محتوى إبداعي ومحب للموسيقى والتصوير ✨ الرياض 📍',
    followers: 3420,
    following: 285,
    likes: 42800,
    verified: true,
  };

  // Video backgrounds (fast playing, guaranteed local & CDN MP4 video clips)
  const VIDEO_BG = [
    'videos/feed-1.mp4',
    'videos/feed-2.mp4',
    'videos/feed-3.mp4',
    'videos/feed-4.mp4',
    'videos/feed-5.mp4',
    'videos/feed-6.mp4',
    'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4',
    'https://vjs.zencdn.net/v/oceans.mp4',
  ];

  const GRAD = [
    'linear-gradient(160deg,#1a1a2e 0%,#16213e 40%,#0f3460 100%)',
    'linear-gradient(160deg,#0d0d0d 0%,#1b0036 50%,#3d0066 100%)',
    'linear-gradient(160deg,#0a0a0a 0%,#1c1c1c 50%,#2d1b00 100%)',
    'linear-gradient(160deg,#001a00 0%,#003300 50%,#004d00 100%)',
    'linear-gradient(160deg,#1a0000 0%,#330000 50%,#4d0000 100%)',
    'linear-gradient(160deg,#00001a 0%,#000033 50%,#00004d 100%)',
  ];

  const DESC = [
    'أجواء خيالية في بوليفارد الرياض الليلة 🌃✨ #الرياض #موسم_الرياض #fyp',
    'طريقة تحضير السوفليه في ٥ دقائق بس! جربوها وأعطوني رأيكم 🍰😋 #طبخ #حلويات',
    'تمرين اليوم كان قاسي بس النتيجة تستاهل 💪🔥 #رياضة #تمارين #تحفيز',
    'غروب ساحل البحر الأحمر اليوم.. سبحان الخالق 🌊🌅 #سياحة #طبيعة #هدوء',
    'عزف سريع لمقطوعة موسيقية جديدة 🎶🎻 شاركوني رأيكم في الكومنتات! #موسيقى',
    'مراجعة سريعة لأحدث هاتف ذكي في السوق 📱⚡ يستاهل تشتريه؟ #تقنية #تكنولوجيا',
    'لحظات عفوية من وراء الكواليس للتصوير الأخير 🎬🍿 #فلوق #يوميات',
    'تنسيق ملابس كاجوال للموسم الجديد 👔👟 أنيق وبسيط #موضة #أزياء',
    'أفضل 3 كتب غيرت طريقة تفكيري في الحياة 📚💡 #قراءة #تطوير_الذات',
    'تحدي رمي الكرة المستحيل! تتوقعون زبطت من أول محاولة؟ 🎯😂 #تحديات',
    'قهوة الصباح وجلسة هادئة تروّق البال ☕🌤️ صباحكم سعادة #صباح_الخير',
    'مغامرة التسلق بين جبال طويق الساحرة ⛰️🧗‍♂️ #مغامرات #السعودية',
  ];

  const MUSIC = [
    'الأصلي - Tenth Tone Sound 🎵',
    'لحن الغروب - سارة الشمري 🎻',
    'نبضات الحماس - أحمد الدوسري ⚡',
    'أجواء ليلية - محمد القحطاني 🌙',
    'إيقاع شرقي كلاسيكي - فرقة النغم 🎶',
    'همسات الشتاء - ريم الخالدي ❄️',
  ];

  const videos = VIDEO_BG.map((bg, i) => ({
    id: 'v' + (i + 1),
    user: users[i % users.length],
    video_url: bg,
    bg,
    thumbnail: THUMBNAILS[i % THUMBNAILS.length],
    grad: GRAD[i % GRAD.length],
    desc: DESC[i % DESC.length],
    music: MUSIC[i % MUSIC.length],
    likes: 12400 + i * 3420,
    comments: 480 + i * 94,
    shares: 190 + i * 45,
    saves: 830 + i * 120,
    liked: i % 2 === 0,
    saved: i % 3 === 0,
  }));

  // My own profile videos (complete 6-item set with verified working thumbnails)
  const myVideos = [
    {
      id: 'my-v1',
      user: me,
      bg: VIDEO_BG[0],
      thumbnail: THUMBNAILS[0],
      desc: 'أول فيديو لي على Tenth Tone! مرحبًا بالجميع 🥳✨ #welcome',
      music: MUSIC[0],
      likes: 14500,
      comments: 630,
      shares: 240,
      saves: 950,
      liked: true,
      saved: true
    },
    {
      id: 'my-v2',
      user: me,
      bg: VIDEO_BG[1],
      thumbnail: THUMBNAILS[2],
      desc: 'لقطات من جولتي في وادي حنيفة اليوم 🌿🌤️ #طبيعة',
      music: MUSIC[1],
      likes: 8900,
      comments: 290,
      shares: 110,
      saves: 420,
      liked: false,
      saved: false
    },
    {
      id: 'my-v3',
      user: me,
      bg: VIDEO_BG[2],
      thumbnail: THUMBNAILS[4],
      desc: 'جلسة تصوير احترافية في الرياض القديمة 📸🏛️ #تصوير',
      music: MUSIC[2],
      likes: 19400,
      comments: 890,
      shares: 410,
      saves: 1820,
      liked: true,
      saved: false
    },
    {
      id: 'my-v4',
      user: me,
      bg: VIDEO_BG[3],
      thumbnail: THUMBNAILS[5],
      desc: 'أجمل إطلالة لغروب الشمس في جبال طويق 🌄✨ #السعودية',
      music: MUSIC[3],
      likes: 25100,
      comments: 940,
      shares: 512,
      saves: 2130,
      liked: true,
      saved: true
    },
    {
      id: 'my-v5',
      user: me,
      bg: VIDEO_BG[4],
      thumbnail: THUMBNAILS[6],
      desc: 'عزف حي لأغنية الموسم في البوليفارد 🎵🔥 #موسيقى',
      music: MUSIC[4],
      likes: 32800,
      comments: 1240,
      shares: 780,
      saves: 3410,
      liked: true,
      saved: true
    },
    {
      id: 'my-v6',
      user: me,
      bg: VIDEO_BG[5],
      thumbnail: THUMBNAILS[7],
      desc: 'تحدي الطبخ السريع: تحضير طبق شرقي في دقيقة واحدة! 🍳😋 #طبخ',
      music: MUSIC[5],
      likes: 11200,
      comments: 310,
      shares: 180,
      saves: 670,
      liked: false,
      saved: true
    }
  ];

  const COMMENTS_SEED = [
    'إبداع لا يوصف ما شاء الله! استمر 🔥👏',
    'المكان هذا أين بالضبط؟ لازم أزوره 😍📍',
    'التصوير والمونتاج احترافي بدرجة خيالية 🎬✨',
    'أفضل صانع محتوى في الساحة بلا منازع 💪❤️',
    'يا سلام عليك، عطيتنا طاقة إيجابية لليوم كله ☀️🙌',
    'متحمسين للفيديو القادم بكل تأكيد 🚀🔥',
    'الموسيقى مع اللقطات متناسقة جداً 🎶👌',
    'أجمل محتوى شفته اليوم على الإطلاق! شكراً لك ❤️🌹',
    'ممكن تسوي شرح عن الإعدادات اللي تستخدمها؟ 🎥🤔',
    'تسلم يدك، جربت الوصفة وطلعت مية مية 🍰😋',
    'التحدي أسطوري! كفو والله 🎯🎉',
  ];

  const comments = (videoId) => {
    const out = [];
    const n = 8 + (parseInt(String(videoId).replace(/\D/g, '')) || 1) % 6;
    for (let i = 0; i < n; i++) {
      out.push({
        id: videoId + '-c' + i,
        user: users[(i * 3) % users.length],
        text: COMMENTS_SEED[i % COMMENTS_SEED.length],
        likes: 12 + (i * 17) % 180,
        time: ['الآن', 'منذ دقيقة', 'منذ 5 دقائق', 'منذ 15 دقيقة', 'منذ ساعة', 'منذ 3 ساعات', 'أمس', 'منذ يومين'][i % 8],
      });
    }
    return out;
  };

  const chats = users.slice(0, 10).map((u, i) => ({
    id: 'chat-' + u.id,
    user: u,
    unread: i < 3 ? (i + 1) : 0,
    online: i % 2 === 0,
    last: [
      'تسلم يا بطل، تمام نلتقي بكرة في الكافيه ☕',
      'شف المقطع اللي أرسلته لك، إبداع صراحة! 🔥',
      'شكراً على الهدية الرائعة في البث المباشر 👑❤️',
      'تمام، اتفقنا على تفاصيل التعاون المشترك 🤝',
      'ههههههههه مت من الضحك على الفيديو الأخير 😂👏',
      'تم تحويل الرصيد بنجاح، بالتوفيق!',
      'إن شاء الله بكره ننزل الفيديو المشترك 🎬',
      'ألف مبروك على التوثيق، تستاهل كل خير 🌟',
      'مساء النور، كيف الحال والأمور؟',
      'بث مباشر رائع، بانتظار الجلسة القادمة 🎶'
    ][i % 10],
    time: ['10:45 ص', '09:20 ص', 'أمس', 'أمس', 'الإثنين', 'الأحد', 'السبت', '5/3', '4/3', '1/3'][i % 10],
    messages: [
      { id: 'm1', from: u.id, text: 'هلا والله يا غالي، كيف حالك؟', time: '10:14' },
      { id: 'm2', from: 'me', text: 'أهلاً وسهلاً! الحمدلله بخير وأنت كيفك؟', time: '10:16' },
      { id: 'm3', from: u.id, text: [
        'بألف صحة وعافية. شفت الفيديو الأخير اللي نزلته؟',
        'والله تمام، بس مشغول شوي هاليومين',
        'بخير الحمدلله، متى بتفتح بث؟',
        'أخبار الشغل معك تمام؟',
        'أجل، شفت المقطع ومرة ضحكني',
        'حول لي الرصيد إذا قدرت',
        'وش الأخبار؟ متى ننزل فيديو مشترك؟',
        'سمعت أنك توثقت، صدق؟',
        'كيف الأمور معاك؟',
        'البث كان نار البارح!'
      ][i % 10], time: '10:18' },
      { id: 'm4', from: 'me', text: 'الحمدلله الأمور طيبة! إن شاء الله كل شيء تمام.', time: '10:21' },
      { id: 'm5', from: u.id, text: [
        'تسلم يا بطل، تمام نلتقي بكرة في الكافيه ☕',
        'شف المقطع اللي أرسلته لك، إبداع صراحة! 🔥',
        'شكراً على الهدية الرائعة في البث المباشر 👑❤️',
        'تمام، اتفقنا على تفاصيل التعاون المشترك 🤝',
        'ههههههههه مت من الضحك على الفيديو الأخير 😂👏',
        'تم تحويل الرصيد بنجاح، بالتوفيق!',
        'إن شاء الله بكره ننزل الفيديو المشترك 🎬',
        'ألف مبروك على التوثيق، تستاهل كل خير 🌟',
        'مساء النور، كيف الحال والأمور؟',
        'بث مباشر رائع، بانتظار الجلسة القادمة 🎶'
      ][i % 10], time: '10:22' },
    ],
  }));

  const notifications = [
    { id: 'n1', type: 'like', user: users[0], text: 'أعجب بفيديو "أجواء خيالية في بوليفارد الرياض"', time: 'منذ دقيقتين' },
    { id: 'n2', type: 'follow', user: users[1], text: 'بدأ بمتابعة حسابك', time: 'منذ 10 دقائق' },
    { id: 'n3', type: 'gift', user: users[2], text: 'أرسل لك هدية "تاج الملوك 👑" في البث المباشر', time: 'منذ 25 دقيقة' },
    { id: 'n4', type: 'comment', user: users[3], text: 'علّق: "إبداع لا يوصف، استمر يا أسطورة!"', time: 'منذ 40 دقيقة' },
    { id: 'n5', type: 'like', user: users[4], text: 'و 42 آخرون أعجبوا بتعليقك الأخير', time: 'منذ ساعة' },
    { id: 'n6', type: 'mention', user: users[5], text: 'أشار إليك في فيديو: "شوفوا الإبداع هنا @abdulrahman"', time: 'منذ 3 ساعات' },
    { id: 'n7', type: 'follow', user: users[6], text: 'بدأ بمتابعة حسابك', time: 'أمس' },
    { id: 'n8', type: 'system', user: { name: 'فريق Tenth Tone', avatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&auto=format&fit=crop&q=80' }, text: 'تهانينا! وصل حسابك إلى 50,000 مشاهدة هذا الأسبوع 🎉', time: 'منذ يومين' },
    { id: 'n9', type: 'system', user: { name: 'مركز الأمان', avatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&auto=format&fit=crop&q=80' }, text: 'تم توثيق وتأمين حسابك بنجاح ✅', time: 'منذ 4 أيام' },
  ];

  const wallet = {
    balance: 4850,
    coins: 12400,
    transactions: [
      { id: 't1', type: 'in', title: 'هدية من ' + users[0].name, sub: 'تاج الملوك 👑', amount: 200, time: 'اليوم 11:24 ص' },
      { id: 't2', type: 'in', title: 'أرباح بث مباشر', sub: 'جلسة الأحد المسائية 🎙️', amount: 850, time: 'اليوم 09:12 ص' },
      { id: 't3', type: 'out', title: 'إرسال هدية لـ ' + users[1].name, sub: 'صاروخ فضائي 🚀', amount: 500, time: 'أمس 10:40 م' },
      { id: 't4', type: 'in', title: 'شحن رصيد المحفظة', sub: 'بطاقة مدى البنكية 💳', amount: 1500, time: 'الإثنين الماضي' },
      { id: 't5', type: 'in', title: 'مكافأة برنامج المبدعين', sub: 'مكافآت المشاهدات المليونية ⭐', amount: 2400, time: '5/4/2026' },
      { id: 't6', type: 'out', title: 'سحب أرباح إلى الحساب البنكي', sub: 'مصرف الراجحي ****4821', amount: 3000, time: '1/4/2026' },
    ],
  };

  const gifts = [
    { id: 'g1', name: 'وردة', emoji: '🌹', price: 1 },
    { id: 'g2', name: 'قلب ناري', emoji: '💖', price: 5 },
    { id: 'g3', name: 'نجمة ذهبية', emoji: '⭐', price: 10 },
    { id: 'g4', name: 'كأس البطولة', emoji: '🏆', price: 50 },
    { id: 'g5', name: 'تاج الملوك', emoji: '👑', price: 200 },
    { id: 'g6', name: 'صاروخ فضائي', emoji: '🚀', price: 500 },
    { id: 'g7', name: 'يخت فاخر', emoji: '🛥️', price: 1000 },
    { id: 'g8', name: 'سيارة رياضية', emoji: '🏎️', price: 2000 },
    { id: 'g9', name: 'طائرة خاصة', emoji: '✈️', price: 5000 },
    { id: 'g10', name: 'قلعة الأحلام', emoji: '🏰', price: 10000 },
  ];

  const trending = [
    { tag: '#موسم_الرياض', meta: '48.6M مشاهدة' },
    { tag: '#يوم_التأسيس', meta: '32.1M مشاهدة' },
    { tag: '#طبخات_سريعة', meta: '19.4M مشاهدة' },
    { tag: '#تحديات_تيك', meta: '14.8M مشاهدة' },
    { tag: '#السعودية_العظمى', meta: '11.2M مشاهدة' },
    { tag: '#موسيقى_عربية', meta: '8.7M مشاهدة' },
    { tag: '#تطوير_الذات', meta: '6.5M مشاهدة' },
    { tag: '#عالم_السيارات', meta: '4.9M مشاهدة' },
  ];

  // Sounds library for creation & discovery
  const sounds = [
    { id: 's1', title: 'الأصلي - Tenth Tone Wave', author_name: 'Tenth Tone Studio', duration: 30, usage_count: 142000 },
    { id: 's2', title: 'إيقاع شرقي حماسي', author_name: 'أحمد الدوسري', duration: 45, usage_count: 98000 },
    { id: 's3', title: 'أوتار هادئة للاسترخاء', author_name: 'سارة الشمري', duration: 60, usage_count: 76000 },
    { id: 's4', title: 'نبض الصحراء 2026', author_name: 'محمد القحطاني', duration: 25, usage_count: 54000 },
    { id: 's5', title: 'طاقة إيجابية ونشاط', author_name: 'ريم الخالدي', duration: 35, usage_count: 42000 },
    { id: 's6', title: 'جلسة عود كلاسيكية', author_name: 'فرقة الرياض الموسيقية', duration: 50, usage_count: 31000 },
    { id: 's7', title: 'أنغام ليلية حالمة', author_name: 'علي المنصور', duration: 40, usage_count: 28500 },
    { id: 's8', title: 'إلكترونك بيت عربي', author_name: 'DJ Rayan', duration: 30, usage_count: 22400 },
    { id: 's9', title: 'لحن التأسيس الفاخر', author_name: 'فاطمة العتيبي', duration: 45, usage_count: 19800 },
    { id: 's10', title: 'أجواء البحر والمطر', author_name: 'خالد العنزي', duration: 60, usage_count: 15300 },
    { id: 's11', title: 'بوب شرقي حديث', author_name: 'ياسمين الحربي', duration: 30, usage_count: 12900 },
    { id: 's12', title: 'تأمل وسكينة في الصباح', author_name: 'نورة الزهراني', duration: 55, usage_count: 9400 },
  ];

  // Live streams
  const LIVE_COVERS = [
    'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1506157786151-b8491531f063?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1511192336575-5a79af67a629?w=800&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=800&auto=format&fit=crop&q=80'
  ];

  const lives = users.slice(0, 12).map((u, i) => ({
    id: 'live-' + u.id,
    host: u,
    viewers: 1450 + i * 530,
    title: [
      'جلسة سوالف وقهوة مع المتابعين ☕✨',
      'عزف مباشر وأغاني على الطلب 🎶🎸',
      'تحدي ألعاب وأسئلة تفاعلية مع الجوائز 🎮🏆',
      'طبخ وجبة عشاء مباشرة معكم خطوة بخطوة 🍳🔥',
      'جولة ليلية في شوارع ومطاعم الرياض 🚗🌃',
      'تمرين لياقة مسائي وحرق دهون 💪⚡',
      'حوار مفتوح عن ريادة الأعمال وصناعة المحتوى 💼💡',
      'تحدي الرسم السريع المباشر 🎨⚡',
      'جلسة سينما وتحليل أحدث الأفلام 🍿🎬',
      'حفل موسيقي لايف من الاستوديو 🎤🎉',
      'توقعات مباريات اليوم وتحليل فني ⚽🗣️',
      'تصميم جرافيك وبرمجة على الهواء مباشرة 💻🚀'
    ][i % 12],
    tag: ['سوالف', 'موسيقى', 'ألعاب', 'طبخ', 'جولات', 'رياضة', 'بزنس', 'فن', 'سينما', 'طرب', 'كورة', 'تقنية'][i % 12],
    bg: LIVE_COVERS[i % LIVE_COVERS.length],
    thumbnail: LIVE_COVERS[i % LIVE_COVERS.length],
  }));

  const full = {
    users,
    me,
    videos,
    myVideos,
    comments,
    chats,
    notifications,
    wallet,
    gifts,
    trending,
    sounds,
    lives,
    AVATARS,
    THUMBNAILS,
    VIDEO_BG
  };

  // ── Demo-mode gate ──
  // Outside demo mode this module exports the SAME SHAPE but with nothing
  // in it, so any screen that reads DB directly renders empty (and falls
  // through to its empty state) instead of showing invented content.
  // Gating here rather than at each call site means a screen can't leak
  // sample data by forgetting to check the flag.
  const demo = !(window.TT_CONFIG && window.TT_CONFIG.demoMode === false);
  if (demo) return full;

  return {
    users: [],
    me: { id: 'me', name: '', handle: '', avatar: '', bio: '', followers: 0, following: 0, likes: 0, verified: false },
    videos: [],
    myVideos: [],
    comments: () => [],
    chats: [],
    notifications: [],
    wallet: { balance: 0, coins: 0, transactions: [] },
    gifts: [],
    trending: [],
    sounds: [],
    lives: [],
    AVATARS: [],
    THUMBNAILS: [],
    VIDEO_BG: [],
  };
})();
