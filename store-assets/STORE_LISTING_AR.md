# Arabic store listing (client note 1: "find the app by Arabic search")

Today the store name is just `FLYP`, so someone searching in Arabic (فيديو، بث
مباشر، فلاي...) never finds it. Both stores rank mostly on the **title**, then
the iOS **subtitle** + **keywords** field, and on Play the **short + full
description**. Set the fields below on the `ar` locale (make Arabic the
primary/default language on Play; on App Store Connect add "Arabic" as a
localization). Feature claims match `LISTING.md` (checked against the code).

Character counts were measured; both stores count characters, not bytes.

---

## App Store (iOS) — Arabic localization

| Field | Limit | Value | Count |
|---|---|---|---|
| Name | 30 | `FLYP فلاي - فيديو وبث مباشر` | 27 |
| Subtitle | 30 | `فيديو قصير وبث مباشر ودردشة` | 27 |
| Keywords | 100 | see below | 97 |

Keywords (comma separated, **no spaces** after commas, do not repeat words that
are already in the name or subtitle, Apple indexes those anyway):
```
فلايب,فليب,لايف,قصص,ستوري,شات,هدايا,مكالمة,اكسبلور,ترند,مقاطع,اصدقاء,تصوير,فلاتر,خريطة,عربي,سعودي
```

Notes:
- `فلايب` / `فليب` are the other ways people spell the brand in Arabic; keep them.
- Do not put other apps' names (TikTok, Snapchat, تيك توك, سناب) in the keywords:
  Apple rejects listings that use competitors' trademarks.
- English localization (en-US), for the same reason:
  - Name: `FLYP: Short Video & Live` (24)
  - Subtitle: `Short videos, live and chat` (27)
  - Keywords: `flip,live,stream,stories,chat,gifts,calls,vlog,trend,clips,filters,friends,map,arabic,saudi` (91)
- Optional: the home-screen name under the icon can also be localized (e.g.
  `فلاي`) with an Expo `locales` file (`CFBundleDisplayName`). Not done yet; it
  does not affect store search.

---

## Google Play — Arabic (`ar`) default listing

**App name** (30): `FLYP فلاي - فيديو وبث مباشر` (27)

**Short description** (80):
```
فيديوهات قصيرة وبث مباشر ودردشة وقصص مع أصدقائك. شارك لحظتك على FLYP
```
(68)

**Full description** (4000): use the Arabic block in `LISTING.md`, with this
opening line so the search words appear early:
```
FLYP (فلاي) تطبيق فيديو قصير وبث مباشر ودردشة عربي: شاهد المقاطع، ابدأ لايف،
وتحدث مع أصدقائك.
```

Play has no keyword field. It reads the title and descriptions, so the words
فيديو، بث مباشر، لايف، دردشة، قصص need to appear naturally in the text, not as a
list (keyword stuffing is a policy violation).

## Google Play — English (`en-US`)

**App name**: `FLYP: Short Video & Live` (24)

**Short description**:
```
Short videos, live streams, stories and chat with friends, Arabic-first
```
(71)

**Full description**: the English block in `LISTING.md`.

---

## Arabic full description (ready to paste)

```
FLYP (فلاي) تطبيق فيديو قصير وبث مباشر ودردشة عربي: شاهد المقاطع، ابدأ لايف،
وتحدث مع أصدقائك.

■ فيديوهات قصيرة
تصفّح الفيديوهات بتمرير واحد. صوّر من داخل التطبيق حتى ٦٠ ثانية مع فلاتر ألوان
ولمسة تجميل، أو ارفع مقطعًا من معرض الصور وقصّه قبل النشر.

■ بث مباشر
ابدأ بثًا مباشرًا وتفاعل مع مشاهديك لحظة بلحظة، وادعُ حتى ٤ ضيوف إلى المنصة،
واستقبل الهدايا من جمهورك.

■ القصص
صور ومقاطع تختفي بعد ٢٤ ساعة، مع صوت من مكتبة الأصوات.

■ محادثات ومكالمات
رسائل فردية وجماعية، رسائل صوتية، ومكالمات صوت وفيديو.

■ اكتشف
الوسوم الرائجة، والبحث عن الحسابات والفيديوهات والأصوات، وخريطة الأصدقاء.

■ خصوصيتك بين يديك
حساب خاص، تحكّم في من يراسلك أو يعلّق، حظر وإبلاغ، وحذف الحساب من داخل التطبيق.

متوفر بالعربية و٨ لغات أخرى، مع دعم كامل للكتابة من اليمين إلى اليسار.
```

## English full description (ready to paste)

```
FLYP is a short-video, live-streaming and chat app built Arabic-first.

■ Short videos
Swipe through videos one at a time. Record up to 60 seconds with colour filters
and a beauty toggle, or upload from your gallery and trim before posting.

■ Go live
Stream live, see comments and reactions in real time, bring up to 4 guests on
stage, and receive gifts from your viewers.

■ Stories
Photos and clips that disappear after 24 hours, with a sound from the library.

■ Messages and calls
Direct and group chats, voice notes, and voice and video calls.

■ Discover
Trending hashtags, search for accounts, videos and sounds, and a friends map.

■ Your privacy, your call
Private account, control who can message or comment, block and report, and
delete your account inside the app.

Available in Arabic and 8 more languages, with full right-to-left support.
```
