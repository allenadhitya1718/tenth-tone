# Store questionnaires — answer sheet

Every answer below was checked against the actual code, not assumed. Where a
form asks something only you can know, it says so.

**Verified about the app as built:**

| | |
|---|---|
| Ad network | **None.** The `ads` table is admin-managed promo content, no AdMob |
| In-app purchases / payments | **None.** Only an i18n string saying payments come later |
| Third-party analytics or tracking SDK | **None.** "Analytics" is your own admin dashboard |
| Tracking pixels | **None.** Facebook/WhatsApp are share links only |
| Date of birth | **Collected at sign-up** (`type="date"`, autocomplete `bday`) |
| Location | Approximate, **opt-in only**, for the friends map |

---

# GOOGLE PLAY

## Content rating questionnaire (IARC)

Category: **Social Networking**

| Question | Answer |
|---|---|
| Violence | No |
| Sexuality | No |
| Profanity | No |
| Controlled substances | No |
| Gambling / simulated gambling | No |
| Crude humour | No |
| Horror / fear | No |
| **Users can interact with each other** | **YES** |
| **Users can share their location with others** | **YES** |
| **Users can exchange user-generated content** | **YES** |
| Digital purchases | No |
| Shares personal info with third parties | No |

Those three YES answers are what matter — under-declaring them is what gets a
rating pulled after launch. Expect **Teen / PEGI 12** or similar.

## Data safety

**Collected, linked to the user, and required:**

| Data | Purpose |
|---|---|
| Name | account, public profile |
| Email address | account creation, sign-in |
| User IDs | account |
| Photos and videos | the posts and chat media people upload |
| Messages (in-app) | direct and group chat |
| Date of birth | age verification at sign-up |

**Collected, optional:**

| Data | Purpose |
|---|---|
| Approximate location | friends map, only if the user turns it on |

**Answer NO to:** precise location, contacts, calendar, financial info, health,
SMS/call log, installed apps, device IDs for advertising.

| Question | Answer |
|---|---|
| Is data encrypted in transit? | **Yes** (HTTPS throughout) |
| Can users request data deletion? | **Yes** — in-app account deletion exists |
| Is data shared with third parties? | **No** — processors (Supabase, Cloudflare, Agora) are service providers, not "sharing" |
| Is any data used for tracking/advertising? | **No** |

## Other Play declarations

| | |
|---|---|
| Target audience | 13+ (do NOT tick "designed for children" — it triggers Families Policy) |
| Ads | **No ads** |
| App access | **Restricted** — supply reviewer credentials, see below |
| News app | No |
| COVID-19 app | No |
| Government app | No |
| Financial features | None |
| Data deletion URL | your privacy page, once hosted |

---

# APP STORE

## Age rating

| Question | Answer |
|---|---|
| Cartoon/fantasy violence, realistic violence | None |
| Profanity, crude humour | None |
| Sexual content, nudity | None |
| Alcohol, tobacco, drugs | None |
| Gambling, contests | No |
| Horror/fear themes | None |
| Unrestricted web access | **No** — the app has no open browser |
| **User-generated content** | **YES** |

⚠️ The UGC answer commonly pushes an app to **17+** on Apple unless moderation
is convincing. That is expected for this app category — do not be tempted to
answer No to make the rating lower. A wrong answer here is grounds for removal
later, which is far worse than a higher rating.

## App Privacy ("nutrition labels")

**Data linked to the user:**
- Contact Info → Email Address, Name
- User Content → Photos or Videos, Other User Content (messages)
- Identifiers → User ID
- Location → Coarse Location (optional feature)
- Sensitive Info → Date of Birth

**Used for tracking:** **NO.** There is no third-party tracking SDK, no ad
network, no pixel. This is a genuinely clean answer and worth getting right —
it avoids the App Tracking Transparency prompt entirely.

**Purposes:** App Functionality for everything. Not Analytics, not Advertising.

## Export compliance

> Does your app use encryption?

**Yes** — but only HTTPS/TLS, which is exempt. Answer the follow-up
"Does your app qualify for any of the exemptions?" with **Yes**, choosing the
standard-encryption exemption. No CCATS or year-end report needed.

## App Review notes — paste this in

```
FLYP is an Arabic-first short-video and live-streaming app for Saudi Arabia.
The interface is Arabic and right-to-left by default.

SIGN IN
Email: <reviewer account email>
Password: <reviewer account password>

The app requires an account; nothing is visible when signed out.

PERMISSIONS
Camera and microphone are requested only when recording a video or starting a
live stream, and can be declined — the feed, discover, chat and profile all
work without them. Location is requested only if the user opens the friends
map, and is entirely optional.

MODERATION (Guideline 1.2)
- Every video and comment can be reported from a menu on the item itself.
- Users can block any account; blocked users cannot message, comment or view.
- Reports go to a moderation queue reviewed by our team.
- Contact: support@flyp-sa.com
```

---

# The reviewer test account — do this first

**Both stores reject apps their reviewer cannot get into.** This is one of the
most common rejection reasons for a login-gated app.

1. Create a normal account in the app — email you control, memorable password
2. Give it a recognisable handle, e.g. `flyp_reviewer`
3. **Post at least one video and follow a couple of accounts**, so the reviewer
   sees a working app rather than an empty feed. An empty app looks broken and
   invites questions.
4. Do **not** use your own account, and do not change its password afterwards —
   a reviewer coming back to a dead login means starting the queue again

Use the same account for both stores.

---

# Still needed from you

- [ ] Reviewer account created, with content on it
- [ ] `support@flyp-sa.com` mailbox created (cPanel → Email Accounts)
- [ ] Privacy policy live at a public URL
- [ ] The three company details → D-U-N-S
