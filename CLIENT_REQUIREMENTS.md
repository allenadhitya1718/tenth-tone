# What we need from the client to publish FLYP

Everything here is something only شركة فلايب can supply — legal identity,
payment, or a decision that is theirs to make. The build itself is finished and
needs none of it.

Already have, from the commercial registration certificate:

| | |
|---|---|
| Company | شركة فلايب |
| Unified National Number | 7054999391 |
| Entity type | شركة ذات مسؤولية محدودة (LLC) |
| Status | نشط (active), issued 15/08/2026 |

---

## 1. Legal identity — blocks the D-U-N-S number, which blocks both stores

Both Apple and Google require a **D-U-N-S number** for organization accounts.
It is free, issued by Dun & Bradstreet, and the *same* number works for both —
this is not done twice.

- [ ] **Official English company name**, exactly as registered. This appears
      publicly as the app's developer name on both stores, so it has to be
      right. If the CR carries no English name, confirm the spelling they want.
- [ ] **National Address** (العنوان الوطني) — building number, street, district,
      city, postal code. The certificate does not include it; it is on the CR
      record at business.sa or on the Saudi Post address certificate.
- [ ] **Company phone number**, with country code.
- [ ] **Do they already have a D-U-N-S number?** Many registered companies do
      without knowing. Worth checking before requesting a new one, because two
      records for one company is a slow thing to unpick.

> Roman characters only — both forms reject Arabic script.

## 2. The developer accounts — must be in the company's name

Not in the developer's name. These accounts hold the app, the payment method
and, later, any revenue. Transferring them afterwards is difficult, and with
Apple it is genuinely painful.

- [ ] **Who enrolls?** Apple requires a person with legal authority to bind the
      company to sign the agreement.
- [ ] **Payment card** for: Google Play **$25 one-time**, Apple **$99/year**.
- [ ] **Apple ID** for the company (not a personal one) — and it will need
      two-factor authentication on a phone someone actually holds.

## 3. Store listing — shown publicly, so the client should approve it

- [ ] **Support email** — displayed on the store page. `support@flyp-sa.com`
      would be natural; the domain already has working mail.
- [ ] **Website URL** — `flyp-sa.com`. **Not currently live.** Google accepts a
      listing without one; Apple effectively expects it.
- [ ] **Privacy policy URL** — REQUIRED by both, must be publicly reachable.
      The text is written (`site/privacy.html`) but nothing is hosted yet.
- [ ] **Approval of the privacy policy and terms.** These are the company's
      legal liability, not ours. They should read them, and confirm the data
      controller details: legal name, address, and contact email.
- [ ] **App category** preference — Social is the obvious fit.

## 4. A decision on content moderation

FLYP carries user-generated video, live streaming and direct messages. Both
stores ask how that is policed, and both reject apps that cannot answer.

- [ ] **Who moderates reports, and how quickly?** The admin panel already
      surfaces a report queue — someone at the client has to actually work it.
- [ ] **Minimum age** for the app. This drives the content rating answers.

## 5. Saudi regulatory — to be confirmed by the client, not by us

Saudi Arabia regulates audiovisual media platforms, and a short-video social
app may require a licence from the **General Authority for Media Regulation**
(الهيئة العامة لتنظيم الإعلام) in addition to the commercial registration.

We are not qualified to judge whether FLYP falls inside that, and it is not a
question to answer by guessing. The client should confirm with their legal
advisor before launch — being on the store without a required licence is a far
worse problem than a delayed launch.

---

## What we do NOT need from them

So nobody wastes time gathering it:

- Screenshots, feature graphic, listing copy — done, in `store-assets/`
- The reviewer test account — we create that ourselves
- Signing keystore — we generate it, though the client should hold a backup,
  because losing it means never being able to update the app again
- Anything about the app's behaviour, hosting or infrastructure

## Order to chase them in

1. **English name + national address + phone** → unblocks D-U-N-S, which has
   the longest lead time of anything on this list
2. **Who enrolls, and the payment card** → unblocks both store accounts
3. **Privacy policy approval + support email** → unblocks the store listing
4. **The regulatory question** → does not block submission, but must be settled
   before public launch
