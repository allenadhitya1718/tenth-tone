// Every sentence send-push can put on a lock screen, in the nine languages the
// app offers (mobile/src/i18n/index.ts LANGUAGES). The app stores the code it
// is running in on push_tokens.lang; anything unknown reads English.
//
// {a} is the other person's name, {n} a number. Written to be read at a
// glance on a lock screen: short, the name first where the language allows.

export const LANGS = ['ar', 'en', 'zh', 'hi', 'ur', 'fr', 'es', 'tr', 'id'] as const;
export type Lang = (typeof LANGS)[number];

export type Strings = {
  message: string;
  messagesN: string;
  voice: string;
  image: string;
  video: string;
  location: string;
  file: string;
  sticker: string;
  follow: string;
  followRequest: string;
  likeVideo: string;
  likeComment: string;
  comment: string;
  reply: string;
  mention: string;
  tag: string;
  live: string;
  followAccepted: string;
  pushTestTitle: string;
  pushTestBody: string;
  calling: string;
  callInvite: string;
  voiceCall: string;
  videoCall: string;
  accept: string;
  decline: string;
  missedCall: string;
  gift: string;
  liveJoinRequest: string;
  liveInvite: string;
  liveGuestAccepted: string;
  liveGuestApproved: string;
  liveGuestRemoved: string;
};

const en: Strings = {
  message: '{a} sent you a message',
  messagesN: '{n} new messages from {a}',
  voice: '🎤 Voice message',
  image: '📷 Photo',
  video: '🎥 Video',
  location: '📍 Location',
  file: '📎 File',
  sticker: '💟 Sticker',
  follow: '{a} started following you',
  followRequest: '{a} requested to follow you',
  likeVideo: '{a} liked your video',
  likeComment: '{a} liked your comment',
  comment: '{a} commented on your video',
  reply: '{a} replied to your comment',
  mention: '{a} mentioned you',
  tag: '{a} tagged you in a post',
  live: '{a} is live now',
  followAccepted: '{a} accepted your follow request',
  pushTestTitle: 'Push notifications are working ✓',
  pushTestBody: 'FLYP can reach this phone.',
  calling: '{a} is calling you',
  callInvite: 'Added you to a call',
  voiceCall: 'Voice call',
  videoCall: 'Video call',
  accept: 'Accept',
  decline: 'Decline',
  missedCall: 'Missed call from {a}',
  gift: '{a} sent you a gift 🎁',
  liveJoinRequest: '{a} wants to join your live',
  liveInvite: '{a} invited you to join their live',
  liveGuestAccepted: '{a} joined your live',
  liveGuestApproved: '{a} accepted your request to join the live',
  liveGuestRemoved: '{a} removed you from the live',
};

const ar: Strings = {
  message: '{a} أرسل لك رسالة',
  messagesN: 'رسائل جديدة من {a} ({n})',
  voice: '🎤 رسالة صوتية',
  image: '📷 صورة',
  video: '🎥 فيديو',
  location: '📍 موقع',
  file: '📎 ملف',
  sticker: '💟 ملصق',
  follow: '{a} بدأ بمتابعتك',
  followRequest: '{a} طلب متابعتك',
  likeVideo: '{a} أعجب بفيديوك',
  likeComment: '{a} أعجب بتعليقك',
  comment: '{a} علّق على فيديوك',
  reply: '{a} ردّ على تعليقك',
  mention: '{a} أشار إليك',
  tag: '{a} أشار إليك في منشور',
  live: '{a} بدأ بثًا مباشرًا الآن',
  followAccepted: '{a} قبل طلب متابعتك',
  pushTestTitle: 'إشعارات FLYP تعمل ✓',
  pushTestBody: 'يمكن لـ FLYP الوصول إلى هذا الهاتف.',
  calling: '{a} يتصل بك',
  callInvite: 'أضافك إلى مكالمة',
  voiceCall: 'مكالمة صوتية',
  videoCall: 'مكالمة فيديو',
  accept: 'قبول',
  decline: 'رفض',
  missedCall: 'مكالمة فائتة من {a}',
  gift: '{a} أرسل لك هدية 🎁',
  liveJoinRequest: '{a} يريد الانضمام إلى بثك المباشر',
  liveInvite: '{a} دعاك للانضمام إلى بثه المباشر',
  liveGuestAccepted: '{a} انضم إلى بثك المباشر',
  liveGuestApproved: '{a} وافق على طلبك للانضمام إلى البث',
  liveGuestRemoved: '{a} أزالك من البث المباشر',
};

const zh: Strings = {
  message: '{a} 给你发了一条消息',
  messagesN: '{a} 发来 {n} 条新消息',
  voice: '🎤 语音消息',
  image: '📷 照片',
  video: '🎥 视频',
  location: '📍 位置',
  file: '📎 文件',
  sticker: '💟 贴纸',
  follow: '{a} 关注了你',
  followRequest: '{a} 请求关注你',
  likeVideo: '{a} 赞了你的视频',
  likeComment: '{a} 赞了你的评论',
  comment: '{a} 评论了你的视频',
  reply: '{a} 回复了你的评论',
  mention: '{a} 提到了你',
  tag: '{a} 在帖子中标记了你',
  live: '{a} 正在直播',
  followAccepted: '{a} 接受了你的关注请求',
  pushTestTitle: '推送通知已正常工作 ✓',
  pushTestBody: 'FLYP 可以向这部手机发送通知。',
  calling: '{a} 正在呼叫你',
  callInvite: '邀请你加入通话',
  voiceCall: '语音通话',
  videoCall: '视频通话',
  accept: '接听',
  decline: '拒绝',
  missedCall: '{a} 的未接来电',
  gift: '{a} 送了你一份礼物 🎁',
  liveJoinRequest: '{a} 想加入你的直播',
  liveInvite: '{a} 邀请你加入 TA 的直播',
  liveGuestAccepted: '{a} 加入了你的直播',
  liveGuestApproved: '{a} 同意了你加入直播的请求',
  liveGuestRemoved: '{a} 将你移出了直播',
};

const hi: Strings = {
  message: '{a} ने आपको एक मैसेज भेजा',
  messagesN: '{a} के {n} नए मैसेज',
  voice: '🎤 वॉइस मैसेज',
  image: '📷 फ़ोटो',
  video: '🎥 वीडियो',
  location: '📍 लोकेशन',
  file: '📎 फ़ाइल',
  sticker: '💟 स्टिकर',
  follow: '{a} ने आपको फ़ॉलो करना शुरू किया',
  followRequest: '{a} ने आपको फ़ॉलो करने का अनुरोध भेजा',
  likeVideo: '{a} को आपका वीडियो पसंद आया',
  likeComment: '{a} को आपका कमेंट पसंद आया',
  comment: '{a} ने आपके वीडियो पर कमेंट किया',
  reply: '{a} ने आपके कमेंट का जवाब दिया',
  mention: '{a} ने आपको मेंशन किया',
  tag: '{a} ने आपको एक पोस्ट में टैग किया',
  live: '{a} अभी लाइव हैं',
  followAccepted: '{a} ने आपका फ़ॉलो अनुरोध स्वीकार किया',
  pushTestTitle: 'पुश नोटिफ़िकेशन काम कर रहे हैं ✓',
  pushTestBody: 'FLYP इस फ़ोन तक पहुँच सकता है।',
  calling: '{a} आपको कॉल कर रहे हैं',
  callInvite: 'आपको एक कॉल में जोड़ा',
  voiceCall: 'वॉइस कॉल',
  videoCall: 'वीडियो कॉल',
  accept: 'स्वीकार करें',
  decline: 'अस्वीकार करें',
  missedCall: '{a} की मिस्ड कॉल',
  gift: '{a} ने आपको एक गिफ़्ट भेजा 🎁',
  liveJoinRequest: '{a} आपके लाइव में शामिल होना चाहते हैं',
  liveInvite: '{a} ने आपको अपने लाइव में शामिल होने के लिए बुलाया',
  liveGuestAccepted: '{a} आपके लाइव में शामिल हुए',
  liveGuestApproved: '{a} ने लाइव में शामिल होने का आपका अनुरोध स्वीकार किया',
  liveGuestRemoved: '{a} ने आपको लाइव से हटा दिया',
};

const ur: Strings = {
  message: '{a} نے آپ کو ایک پیغام بھیجا',
  messagesN: '{a} کی طرف سے {n} نئے پیغامات',
  voice: '🎤 صوتی پیغام',
  image: '📷 تصویر',
  video: '🎥 ویڈیو',
  location: '📍 مقام',
  file: '📎 فائل',
  sticker: '💟 اسٹیکر',
  follow: '{a} نے آپ کو فالو کرنا شروع کیا',
  followRequest: '{a} نے آپ کو فالو کرنے کی درخواست بھیجی',
  likeVideo: '{a} نے آپ کی ویڈیو پسند کی',
  likeComment: '{a} نے آپ کا تبصرہ پسند کیا',
  comment: '{a} نے آپ کی ویڈیو پر تبصرہ کیا',
  reply: '{a} نے آپ کے تبصرے کا جواب دیا',
  mention: '{a} نے آپ کا ذکر کیا',
  tag: '{a} نے آپ کو ایک پوسٹ میں ٹیگ کیا',
  live: '{a} ابھی لائیو ہیں',
  followAccepted: '{a} نے آپ کی فالو کی درخواست قبول کر لی',
  pushTestTitle: 'پش نوٹیفیکیشنز کام کر رہی ہیں ✓',
  pushTestBody: 'FLYP اس فون تک پہنچ سکتا ہے۔',
  calling: '{a} آپ کو کال کر رہے ہیں',
  callInvite: 'آپ کو ایک کال میں شامل کیا',
  voiceCall: 'وائس کال',
  videoCall: 'ویڈیو کال',
  accept: 'قبول کریں',
  decline: 'مسترد کریں',
  missedCall: '{a} کی مس کال',
  gift: '{a} نے آپ کو ایک تحفہ بھیجا 🎁',
  liveJoinRequest: '{a} آپ کے لائیو میں شامل ہونا چاہتے ہیں',
  liveInvite: '{a} نے آپ کو اپنے لائیو میں شامل ہونے کی دعوت دی',
  liveGuestAccepted: '{a} آپ کے لائیو میں شامل ہو گئے',
  liveGuestApproved: '{a} نے لائیو میں شامل ہونے کی آپ کی درخواست قبول کر لی',
  liveGuestRemoved: '{a} نے آپ کو لائیو سے ہٹا دیا',
};

const fr: Strings = {
  message: '{a} vous a envoyé un message',
  messagesN: '{n} nouveaux messages de {a}',
  voice: '🎤 Message vocal',
  image: '📷 Photo',
  video: '🎥 Vidéo',
  location: '📍 Position',
  file: '📎 Fichier',
  sticker: '💟 Sticker',
  follow: '{a} a commencé à vous suivre',
  followRequest: '{a} souhaite vous suivre',
  likeVideo: '{a} a aimé votre vidéo',
  likeComment: '{a} a aimé votre commentaire',
  comment: '{a} a commenté votre vidéo',
  reply: '{a} a répondu à votre commentaire',
  mention: '{a} vous a mentionné',
  tag: '{a} vous a identifié dans une publication',
  live: '{a} est en direct',
  followAccepted: "{a} a accepté votre demande d'abonnement",
  pushTestTitle: 'Les notifications fonctionnent ✓',
  pushTestBody: 'FLYP peut joindre ce téléphone.',
  calling: '{a} vous appelle',
  callInvite: 'Vous a ajouté à un appel',
  voiceCall: 'Appel vocal',
  videoCall: 'Appel vidéo',
  accept: 'Accepter',
  decline: 'Refuser',
  missedCall: 'Appel manqué de {a}',
  gift: '{a} vous a envoyé un cadeau 🎁',
  liveJoinRequest: '{a} souhaite rejoindre votre live',
  liveInvite: '{a} vous invite à rejoindre son live',
  liveGuestAccepted: '{a} a rejoint votre live',
  liveGuestApproved: '{a} a accepté votre demande pour rejoindre le live',
  liveGuestRemoved: '{a} vous a retiré du live',
};

const es: Strings = {
  message: '{a} te envió un mensaje',
  messagesN: '{n} mensajes nuevos de {a}',
  voice: '🎤 Mensaje de voz',
  image: '📷 Foto',
  video: '🎥 Video',
  location: '📍 Ubicación',
  file: '📎 Archivo',
  sticker: '💟 Sticker',
  follow: '{a} comenzó a seguirte',
  followRequest: '{a} quiere seguirte',
  likeVideo: 'A {a} le gustó tu video',
  likeComment: 'A {a} le gustó tu comentario',
  comment: '{a} comentó tu video',
  reply: '{a} respondió a tu comentario',
  mention: '{a} te mencionó',
  tag: '{a} te etiquetó en una publicación',
  live: '{a} está en vivo',
  followAccepted: '{a} aceptó tu solicitud de seguimiento',
  pushTestTitle: 'Las notificaciones funcionan ✓',
  pushTestBody: 'FLYP puede llegar a este teléfono.',
  calling: '{a} te está llamando',
  callInvite: 'Te agregó a una llamada',
  voiceCall: 'Llamada de voz',
  videoCall: 'Videollamada',
  accept: 'Aceptar',
  decline: 'Rechazar',
  missedCall: 'Llamada perdida de {a}',
  gift: '{a} te envió un regalo 🎁',
  liveJoinRequest: '{a} quiere unirse a tu transmisión en vivo',
  liveInvite: '{a} te invitó a unirte a su transmisión en vivo',
  liveGuestAccepted: '{a} se unió a tu transmisión en vivo',
  liveGuestApproved: '{a} aceptó tu solicitud para unirte a la transmisión',
  liveGuestRemoved: '{a} te quitó de la transmisión en vivo',
};

const tr: Strings = {
  message: '{a} sana bir mesaj gönderdi',
  messagesN: '{a}: {n} yeni mesaj',
  voice: '🎤 Sesli mesaj',
  image: '📷 Fotoğraf',
  video: '🎥 Video',
  location: '📍 Konum',
  file: '📎 Dosya',
  sticker: '💟 Çıkartma',
  follow: '{a} seni takip etmeye başladı',
  followRequest: '{a} seni takip etmek istiyor',
  likeVideo: '{a} videonu beğendi',
  likeComment: '{a} yorumunu beğendi',
  comment: '{a} videona yorum yaptı',
  reply: '{a} yorumuna yanıt verdi',
  mention: '{a} senden bahsetti',
  tag: '{a} seni bir gönderide etiketledi',
  live: '{a} şu an canlı yayında',
  followAccepted: '{a} takip isteğini kabul etti',
  pushTestTitle: 'Bildirimler çalışıyor ✓',
  pushTestBody: 'FLYP bu telefona ulaşabiliyor.',
  calling: '{a} seni arıyor',
  callInvite: 'Seni bir aramaya ekledi',
  voiceCall: 'Sesli arama',
  videoCall: 'Görüntülü arama',
  accept: 'Kabul et',
  decline: 'Reddet',
  missedCall: 'Cevapsız arama: {a}',
  gift: '{a} sana bir hediye gönderdi 🎁',
  liveJoinRequest: '{a} canlı yayınına katılmak istiyor',
  liveInvite: '{a} seni canlı yayınına davet etti',
  liveGuestAccepted: '{a} canlı yayınına katıldı',
  liveGuestApproved: '{a} canlı yayına katılma isteğini kabul etti',
  liveGuestRemoved: '{a} seni canlı yayından çıkardı',
};

const id: Strings = {
  message: '{a} mengirimimu pesan',
  messagesN: '{n} pesan baru dari {a}',
  voice: '🎤 Pesan suara',
  image: '📷 Foto',
  video: '🎥 Video',
  location: '📍 Lokasi',
  file: '📎 File',
  sticker: '💟 Stiker',
  follow: '{a} mulai mengikutimu',
  followRequest: '{a} ingin mengikutimu',
  likeVideo: '{a} menyukai videomu',
  likeComment: '{a} menyukai komentarmu',
  comment: '{a} mengomentari videomu',
  reply: '{a} membalas komentarmu',
  mention: '{a} menyebutmu',
  tag: '{a} menandaimu di sebuah postingan',
  live: '{a} sedang live sekarang',
  followAccepted: '{a} menerima permintaan mengikutimu',
  pushTestTitle: 'Notifikasi push berfungsi ✓',
  pushTestBody: 'FLYP dapat menjangkau ponsel ini.',
  calling: '{a} meneleponmu',
  callInvite: 'Menambahkanmu ke panggilan',
  voiceCall: 'Panggilan suara',
  videoCall: 'Panggilan video',
  accept: 'Terima',
  decline: 'Tolak',
  missedCall: 'Panggilan tak terjawab dari {a}',
  gift: '{a} mengirimimu hadiah 🎁',
  liveJoinRequest: '{a} ingin bergabung ke live-mu',
  liveInvite: '{a} mengundangmu bergabung ke live-nya',
  liveGuestAccepted: '{a} bergabung ke live-mu',
  liveGuestApproved: '{a} menyetujui permintaanmu untuk bergabung ke live',
  liveGuestRemoved: '{a} mengeluarkanmu dari live',
};

export const STRINGS: Record<Lang, Strings> = { ar, en, zh, hi, ur, fr, es, tr, id };

// 'zh-CN', 'PT_br', ' EN ' ... -> one of LANGS, or English.
export function normLang(code: unknown): Lang {
  const base = String(code ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return (LANGS as readonly string[]).includes(base) ? (base as Lang) : 'en';
}

export const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
