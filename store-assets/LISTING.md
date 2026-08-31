# Play Store listing — copy/paste

Everything here describes what the app **actually does today**. Do not add a
feature to the description that is not in the build: Google checks the listing
against the app, and a claim the reviewer cannot find is a rejection.

Removed from the record screen before this build, so do NOT mention them:
beauty filters, video filters, AR effects.

---

## App name (30 char max)

```
FLYP
```

## Short description (80 char max)

Arabic (default locale, `ar`):
```
شارك فيديوهاتك القصيرة، ابدأ بثًا مباشرًا، وتواصل مع أصدقائك
```
(60 characters)

English (`en-US`):
```
Share short videos, go live, and chat with friends
```
(49 characters)

---

## Full description (4000 char max)

### Arabic (`ar`)

```
FLYP هو تطبيق الفيديوهات القصيرة للمجتمع العربي.

■ فيديوهات قصيرة
تصفّح فيديوهات قصيرة بتمرير واحد. سجّل مباشرة من التطبيق حتى ٩٠ ثانية، أو ارفع
مقطعًا من معرض الصور، وقصّه قبل النشر.

■ بث مباشر
ابدأ بثًا مباشرًا وتفاعل مع مشاهديك لحظة بلحظة. تعليقات فورية وتفاعلات متحركة
على الشاشة، مع عدد المشاهدين ومدة البث.

■ محادثات
راسل أصدقاءك مباشرة أو في مجموعات. شارك الفيديوهات داخل المحادثة، وأرسل
الصور والملفات والرسائل الصوتية.

■ اكتشف
تصفّح الوسوم الرائجة، وابحث عن الحسابات والفيديوهات والأصوات، وتابع من يعجبك.

■ الأصوات
كل مقطع عام ينشئ صوتًا أصليًا يمكن لأي شخص إعادة استخدامه، أو اختر صوتًا
جاهزًا قبل التسجيل.

■ خصوصيتك بين يديك
اجعل حسابك خاصًا، وتحكّم في من يعلّق أو يحفظ مقاطعك، واحظر من تريد. يمكنك
الإبلاغ عن أي محتوى مخالف.

التطبيق بالعربية بالكامل مع دعم كامل للكتابة من اليمين إلى اليسار.
```

### English (`en-US`)

```
FLYP is a short-video app built Arabic-first.

■ Short videos
Swipe through short videos one at a time. Record up to 90 seconds in the app
with a countdown timer, or upload from your gallery and trim before posting.

■ Go live
Start a live stream and see your audience react in real time — live comments,
animated reactions, viewer count and stream duration.

■ Messages
Message friends directly or in groups. Share videos straight into a chat, and
send photos, files and voice notes.

■ Discover
Browse trending hashtags, search accounts, videos and sounds, and follow the
creators you like.

■ Sounds
Every public post creates an original sound anyone can reuse, or pick an
existing sound before you record.

■ Your privacy, your call
Make your account private, control who can comment on or save your videos, and
block anyone you choose. Report anything that breaks the rules.

Fully localised in Arabic with complete right-to-left support.
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
| Approximate location | Yes, optional | only if the user enables the friends map |
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
