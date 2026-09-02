# Supabase auth emails — FLYP

The HTML lives in `supabase/email_templates/`. **These files are only a copy.**
Supabase does not read them. Nothing you change here reaches a single person
until you paste it into the dashboard by hand — which is exactly why the rename
from Tenth Tone was missed: the repo was updated, the dashboard never was.

There are six templates and every one of them has to be pasted separately.

---

## Before you start — two things that are not templates

These live in different screens, and both still carry the old name. Changing
only the templates leaves "Tenth Tone" in people's inboxes.

**1. The sender name.** This is what shows in the From line, and most people
read that before they read anything else.

> Project Settings → Authentication → SMTP Settings → **Sender name**

Set it to `FLYP`. Check **Sender email** too — if it is on a `tenthtone`
domain, every email is arriving from the old brand no matter what the body
says. (If SMTP is not configured at all you are on Supabase's built-in sender,
which is capped at a few emails per hour and is not good enough for launch —
see the note at the bottom.)

**2. The Site URL.** Used to build links inside emails.

> Authentication → URL Configuration → **Site URL**

It should be your real domain. If it still points at a `tenthtone` host or a
stale Netlify preview, links in emails go somewhere wrong.

---

## The templates

> Authentication → **Emails** (older projects call it Email Templates)

For each one: pick the tab, clear the **Subject heading** box and paste the new
subject, then clear the **Message body** box entirely and paste the whole file.
Save before moving to the next tab — switching tabs does not save.

| Tab in the dashboard | File to paste |
|---|---|
| Confirm signup | `email_templates/confirm_signup.html` |
| Invite user | `email_templates/invite.html` |
| Magic Link | `email_templates/magic_link.html` |
| Change Email Address | `email_templates/change_email.html` |
| Reset Password | `email_templates/reset_password.html` |
| Reauthentication | `email_templates/reauthentication.html` |

Subject lines are in `email_templates/SUBJECTS.md`.

---

## Why the body must be replaced, not edited

**The app cannot accept a magic link.** Supabase's stock templates send
`{{ .ConfirmationURL }}`. FLYP's auth screens ask for a six digit code, so
every template here uses `{{ .Token }}` instead. If any tab is left on the
Supabase default, that flow breaks completely — people get a link, the app
asks for a code, and there is no way through.

The one exception is **Invite user**, which is genuinely a link, and is the
only template here that still uses `{{ .ConfirmationURL }}`.

**Styles are inline and there are no images or web fonts.** Email clients strip
`<style>` blocks and block remote assets by default. A template that looks
right in a browser preview can arrive as unstyled text.

**Arabic first, English underneath.** Supabase has no idea which language
someone picked in the app, so both are always sent.

---

## The colour was wrong too

The two templates that existed used `#6c2bd9` — Tenth Tone's purple. The app's
primary colour is `#1e56d6`, blue. So even after the word "Tenth Tone" was
removed from the body, the emails were still arriving in the old brand's
colour. Every template now takes its palette from `web/css/app.css`.

If you ever change the app's primary colour, update
`scratchpad/gen_emails.py` and regenerate, rather than editing six files by
hand — that drift is how this happened the first time.

---

## Testing without locking anyone out

Send yourself one of each, in a **normal browser or on a phone** — not in any
automated or embedded browser. The signup and reset forms load a Cloudflare
Turnstile challenge, and that has crashed tooling on this machine before.

Check, in an actual inbox:

- the From name reads **FLYP**, not Tenth Tone
- the subject is the bilingual one, not Supabase's English default
- the six digit code renders large and spaced, and is **not** a link
- Arabic reads right to left and is not reversed or mojibake
- it does not land in spam (check this on Gmail specifically)
- it looks right in Gmail on a phone, which is where most people will read it

Do **not** test by signing up with an address you intend to use for real. A
half-completed signup leaves a user row behind and that address cannot be
reused cleanly.

---

## One more thing before launch

Supabase's built-in email sender is rate limited to a handful of messages per
hour and is not intended for production. If you launch on it, a burst of
signups means most people simply never receive their code and cannot get in —
and it looks like the app is broken, not the email.

Configure real SMTP (Resend, SendGrid, Amazon SES or similar) under
Project Settings → Authentication → SMTP Settings, and set SPF, DKIM and DMARC
records on the sending domain or the mail goes to spam.
