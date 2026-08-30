# Pre-launch findings — screen-by-screen pass

2026-08-30. Every screen walked in a mobile viewport, in English and Arabic,
plus an automated sweep of all 20 routes in both languages.

**Read this before handing the app to test users.** It is not a list of
everything wrong — it is what one pass found. Two real people will find
things neither of us did.

---

## Fixed during this pass

| Problem | Why it mattered |
|---|---|
| Feed tabs read **"Followers"** in English | The opposite of what the tab does. `متابعون` is used for both the Following feed tab and the profile's followers stat, and the translator matches whole strings — so the tab inherited the wrong meaning. `لك` also became "You" instead of "For You". |
| Feed tabs invisible on bright video | White at 65% opacity, no background, no shadow, over whatever is playing. Fine on a dark clip, gone on a rainy window. |
| **Every** back arrow pointed forwards in English | `topBar()` was hardcoded to `chevR`. Five hand-rolled buttons had been fixed earlier; this is the shared helper behind most screens. |
| New-login alerts rendered blank | `textFor()` knew three system notification kinds and fell through to an empty string for `new_login` — the one notification that tells someone another person has signed in to their account. |

Also verified clean:

- **20 routes, English:** no Arabic text left anywhere, no route errors.
- **17 routes, Arabic:** no untranslated English except genuine user content
  (names, captions, handles), the "English" language option, and third-party
  map attribution — all correct.
- Chat shows **no duplicate messages**.
- Follower counts move correctly after `0053`.
- Inbox no longer flashes "no conversations yet".

One flagged item turned out **not** to be a bug: the caption and its "see
more" link read as run together in extracted text, but measurement showed
`margin-inline-start: 4px` applied correctly and the element had simply
wrapped. Checked before changing anything.

---

## Not fixed — decisions for you

### 1. There is no wallet screen at all — HIGH
The database has `wallets`, `wallet_transactions`, a `gifts` catalog,
`gift_transactions` and a `send_gift` function. The app has **none of it** —
no balance, no top-up, no history, and no gift button anywhere. Confirmed
this is pre-existing, not something removed today.

The part that makes it urgent: **deleting your account warns you that "your
wallet balance will be lost and cannot be recovered."** So the app tells
people they hold something of value and never shows it to them. Either build
the screen or remove the warning — the current state is the worst of both.

### 2. Usernames are auto-generated — HIGH
Signup never asks for one. Everyone gets `user_` plus eight hex characters,
e.g. `@user_d6aceb49`. It can be changed later in Edit Profile, but most
people will never look, so your first users will have machine-generated
handles permanently.

On a social app the @handle is someone's identity. It belongs in signup.

### 3. Blocked people can still see your profile — MEDIUM
`profiles` is world-readable. A blocked person cannot see your posts, message
you or comment (fixed in `0049`), but can still open your profile and see
your name, photo, bio and counts. Instagram hides it entirely.

Left deliberately: `profiles` is read wherever a name or avatar appears —
group members, follower lists, comment authors, admin screens. Restricting it
needs each of those checked first.

### 4. A private account's follower list is public — MEDIUM
`follows` is world-readable, so anyone can list who a private account follows
and who follows them, even while seeing none of their posts.

### 5. Chat has no date separators and no read receipts — LOW
A long conversation has no "Today" / "Yesterday" markers. And `last_read_at`
now exists in the database, so "Seen" is possible — the data is there, the UI
does not use it.

---

## Known-good, verified this session

- Security: all `0048` fixes confirmed live; a client still cannot set its own
  `is_admin`.
- Blocking: comment, message and post-visibility gaps closed in `0049`.
- Rate limits: 6 of 6 triggers active.
- Nightly jobs: both registered and active after `0051`.
- Following a private account works and creates a request (`0053`).
- Feed loads ~3 videos instead of 20; cached reads return in ~1ms.

---

## What this pass could NOT check

Being explicit, because the gaps matter more than the findings:

- **Anything needing a second real person.** Realtime delivery, calls
  ringing, live streaming, blocking as experienced by the blocked party.
- **Anything needing a real device.** Camera, microphone, GPS, push
  notifications, the keyboard, actual swipe gestures. The browser pane blocks
  camera access outright.
- **Video upload end to end.** Compression, the nudity check and the storage
  quota have not been exercised with a real file.
- **Payments.** Nothing exists to check.
- **Load.** The database holds single-digit rows. Nothing here says how it
  behaves with ten thousand.

The swipe-to-reply, double-tap-to-like and one-clip-per-swipe gestures were
written and load without error, but have **never been performed by a finger**.

---

## Suggested order before the two test users

1. **Rebuild the APK.** `build_apk.bat` now syncs first, so this will be the
   first local build in months to contain `config.js`, `compress.js`,
   `nsfw-check.js` and `deeplink.js`.
2. **Decide on the wallet** — build the screen or drop the deletion warning.
3. **Add username to signup**, or accept that early users keep generated ones.
4. Then hand it over, and let them find what we could not.

Ask them to try the boring things: sign up, post a video, message someone,
block someone, delete their account. That is where the remaining problems
are, not in the features that were fun to build.
