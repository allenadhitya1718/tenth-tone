# Play Store listing — copy/paste

Everything here describes what the app **actually does today**. Do not add a
feature to the description that is not in the build: Google checks the listing
against the app, and a claim the reviewer cannot find is a rejection.

Current build (React Native app, `mobile/`, version 2.0.0). Checked against the
code on 19 Oct 2026: the record screen **does** have colour filters again (12
looks plus a "beauty" soft-tone toggle, `mobile/src/features/camera/filters.ts`).
Still do NOT mention: AR effects / face masks, or creator payouts and withdrawals
(not shipped yet). If the build you submit was made without the native filter
module, drop the filters line.

The Arabic-first title, iOS subtitle and keywords (for Arabic store search) are
in `STORE_LISTING_AR.md` next to this file. Use that for the `ar` locale.

---

## App name (30 char max)

Arabic (`ar`, default locale):
```
FLYP فلاي - فيديو وبث مباشر
```
(27 characters)

English (`en-US`):
```
FLYP: Short Video & Live
```
(24 characters)

## Short description (80 char max)

Arabic (default locale, `ar`):
```
فيديوهات قصيرة وبث مباشر ودردشة وقصص مع أصدقائك. شارك لحظتك على FLYP
```
(68 characters)

English (`en-US`):
```
Short videos, live streams, stories and chat with friends, Arabic-first
```
(71 characters)

---

## Full description (4000 char max)

### Arabic (`ar`)

```
FLYP هو تطبيق الفيديوهات القصيرة والبث المباشر للمجتمع العربي.

■ فيديوهات قصيرة
تصفّح الفيديوهات بتمرير واحد. صوّر من داخل التطبيق حتى ٦٠ ثانية مع فلاتر ألوان
ولمسة تجميل، أو ارفع مقطعًا من معرض الصور وقصّه قبل النشر. أضف وصفًا ووسومًا
وموقعًا.

■ بث مباشر
ابدأ بثًا مباشرًا وتفاعل مع مشاهديك لحظة بلحظة: تعليقات فورية، تفاعلات متحركة،
وعدد المشاهدين. ادعُ حتى ٤ ضيوف إلى المنصة، واستقبل الهدايا من جمهورك.

■ القصص
شارك صورًا ومقاطع تختفي بعد ٢٤ ساعة، مع صوت من مكتبة الأصوات، واعرف من شاهدها.

■ محادثات ومكالمات
راسل أصدقاءك مباشرة أو في مجموعات، وأرسل الصور والرسائل الصوتية، وشارك الفيديوهات داخل المحادثة.
اتصل بمكالمة صوتية أو فيديو، أو استخدم الضغط للتحدث (Walkie-talkie).

■ اكتشف
الوسوم الرائجة، والبحث عن الحسابات والفيديوهات والأصوات، وخريطة الأصدقاء لمن
يختار مشاركة موقعه.

■ المحفظة والهدايا
اشترِ العملات من المتجر وأرسل الهدايا في البث المباشر.

■ خصوصيتك بين يديك
اجعل حسابك خاصًا، وتحكّم في من يراسلك أو يعلّق أو يشير إليك، واحظر من تريد،
وأبلغ عن أي محتوى مخالف. يمكنك حذف حسابك من داخل التطبيق.

متوفر بالعربية والإنجليزية والأردية والهندية والإندونيسية والتركية والفرنسية
والإسبانية والصينية، مع دعم كامل للكتابة من اليمين إلى اليسار.
```

### English (`en-US`)

```
FLYP is the short-video and live-streaming app built Arabic-first.

■ Short videos
Swipe through videos one at a time. Record up to 60 seconds in the app with
colour filters and a beauty toggle, or upload from your gallery and trim before
posting. Add a caption, hashtags and a place.

■ Go live
Start a live stream and see your audience react in real time: live comments,
animated reactions and a viewer count. Bring up to 4 guests on stage and
receive gifts from your viewers.

■ Stories
Share photos and clips that disappear after 24 hours, add a sound, and see who
watched.

■ Messages and calls
Message friends directly or in groups, send photos and voice notes, and share videos into a chat.
Make voice and video calls, or use push-to-talk.

■ Discover
Trending hashtags, search for accounts, videos and sounds, and a friends map
for people who choose to share their location.

■ Wallet and gifts
Buy coins in the store and send gifts during live streams.

■ Your privacy, your call
Make your account private, control who can message, comment on or mention you,
block anyone, and report anything that breaks the rules. You can delete your
account inside the app.

Available in Arabic, English, Urdu, Hindi, Indonesian, Turkish, French, Spanish
and Chinese, with full right-to-left support.
```

---

## App access — REQUIRED, and a common cause of rejection

FLYP needs a login, so Google's reviewer cannot see anything without an
account. Under **App content → App access**, choose *All or some
functionality is restricted* and give them a working account:

```
Name of instructions: Sign in
Username: <a real test account email>
Password: <its password>
Any other instructions:
  Sign in with the email and password above. The app is Arabic by default;
  language can be changed in Settings. Camera and microphone permissions are
  requested only when recording or going live, and can be declined — the feed,
  discover, chat and profile screens all work without them.
```

Create a dedicated reviewer account for this. Do not use your own.

---

## Data safety — what the app actually collects

Declare honestly; this is cross-checked against the app's behaviour.

| Data type | Collected | Why |
|---|---|---|
| Email address | Yes | account creation and sign-in |
| Name, username, profile photo | Yes | shown on your public profile |
| Photos and videos | Yes | the posts and messages people upload |
| Messages | Yes | direct and group chat |
| Location (approximate and precise) | Yes, optional | only if the user enables the friends map or tags a place on a post |
| Crash logs / diagnostics | Check your Supabase and Agora settings before answering |

All of it is transmitted encrypted (HTTPS). Users can request deletion in-app —
`data_export_requests` and the account-deletion flow already exist, so you can
answer "yes" to *Can users request that their data be deleted?*

---

## Content rating

Answer the questionnaire honestly. A social app with user-generated content
and direct messaging will land at **Teen / PEGI 12** or higher. Declare that
the app contains user-generated content and that users can interact and share
their location — under-declaring is what gets ratings pulled later.

---

## Assets in this folder

| File | Play field | Requirement |
|---|---|---|
| `icon-512.png` | App icon | 512×512, 32-bit PNG |
| `feature-graphic-1024x500.png` | Feature graphic | exactly 1024×500, no alpha |
| `screenshots/01-feed.png` … `05-profile.png` | Phone screenshots | 1080×1920, min 2, max 8 |
