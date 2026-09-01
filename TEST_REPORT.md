# Two-account test sweep — night of 2026-08-31 → 09-01

Driven through two real signed-in accounts in two browsers, not simulated.

**A** = allenadhitya1718 (`user_d6aceb49`, admin, private account)
**B** = Alim (`alim_77`, private account)

---

## ⚠️ Do these three things first

| | What | Why |
|---|---|---|
| 1 | Run `supabase/migrations/0067_chat_media_read_policy.sql` | **Chat attachments have never worked.** This is half the fix; the other half is already in the code |
| 2 | Run `supabase/migrations/0068_delete_own_video.sql` | Users cannot delete their own posts at all |
| 3 | Run the query at the bottom of this file | One open security question about blocking |

Everything else below is already fixed and pushed.

---

## The headline finding

**Chat attachments have been broken since migration 0031 — every photo, video,
voice note and file. Not caused by anything we did today.**

Two independent faults, both required:

1. **Upload refused.** Files were written to `<chatId>/…` while the storage
   policy demands `(storage.foldername(name))[1] = auth.uid()` — the *user* id.
   Every upload failed with *"new row violates row-level security policy"*, and
   because the message still sent without its attachment, it looked like a UI
   bug rather than a permissions one. Path is now `<userId>/<chatId>/<ts>.<ext>`.
   That also repairs the accounting: `user_uploads_today()` reads the same first
   segment, so chat media had never counted against anyone's quota either.

2. **Read impossible.** `chat-media` is a private bucket and had **no SELECT
   policy anywhere in 0001–0066**. `createSignedUrl()` must read an object to
   sign it, so it returned null and the client threw *"Cannot read properties of
   null"* — which reads like a front-end bug and is a missing database policy.
   `0067` grants read to members of the conversation, always to the uploader,
   and adds delete.

This is almost certainly the bulk of what your testers hit.

---

## Everything tested

### Messaging
| Feature | Result |
|---|---|
| Text A→B | ✅ 420ms send, arrives via realtime |
| Optimistic send (your own bubble appears instantly) | ✅ already correct |
| Reply | ✅ `reply_to_id` set, quoted bubble renders |
| Reactions | ✅ both directions, grouped with counts |
| **Delete own message** | ✅ **built tonight** — DB allowed it since 0018, no API or UI existed |
| Delete someone else's message | ✅ correctly refused, and not offered |
| Photo / video / voice / file attachment | ❌→✅ **fixed, needs `0067`** |
| Call record in chat | ✅ renders as "📞 مكالمة صوتية", not raw JSON |

### Social
| Feature | Result |
|---|---|
| Follow a private account | ✅ returns `requested` |
| Follow request → approve | ✅ both directions |
| Search profiles | ✅ |
| Block → hidden from search | ✅ |
| Block → Blocked Users list shows real names | ✅ (was `undefined` before today) |
| Block → DM leaves the inbox | ✅ |
| Block → blocked user cannot message | ✅ RLS refuses |
| Block → blocked user cannot see videos | ✅ |
| Unblock → everything returns | ✅ |
| **Block → blocked user CAN still read the blocker's profile row** | ❌ **open, see below** |

### Content
| Feature | Result |
|---|---|
| Video upload to R2 | ✅ lands on `pub-….r2.dev` |
| Like / unlike + counter | ✅ increments and decrements |
| Save / unsave + lists | ✅ |
| Comment + counter | ✅ |
| Notifications (like, comment, follow) | ✅ all delivered |
| Private account hides videos from non-followers | ✅ correct |
| **Delete own video** | ✅ **built tonight**, needs `0068` |
| Delete row hidden on other people's videos | ✅ |

### Live
| Feature | Result |
|---|---|
| Start live | ✅ |
| Appears in the live list for others | ✅ |
| Join, viewer count, peak count | ✅ |
| Live comments | ✅ |
| Live reactions | ✅ |
| End live | ✅ |
| Host notified of start AND end | ✅ (migration 0061) |

### Calls
| Feature | Result |
|---|---|
| Start audio call | ✅ ringing |
| Callee sees incoming | ✅ |
| Accept | ✅ `answered_at` set |
| End | ✅ |
| Call record written to the chat | ✅ |

---

## Speed — measured, not guessed

**Chat was slow because of the moderation call**, now removed for private
content. Sending is 420ms and your own message was always instant (the app
renders optimistically); it was the *recipient* who waited.

**Video publish: ~7.0s → 5.2–6.3s** after removing a duplicated quota check.
The remaining time is not Cloudflare:

| Stage | Time (77 KB clip) |
|---|---|
| `sign` (Supabase Edge Function) | 1.3–3.0s |
| **PUT to Cloudflare R2** | **0.45s** |
| `confirm` (Supabase Edge Function) | 1.8s |

**Cloudflare is fast. The two Edge Function round trips are the upload time.**
Getting closer to Instagram means not making the user wait for them — publish
optimistically and finish in the background. That is a real change with a real
risk (the sweeper deletes unconfirmed objects after an hour), so I did not do
it unattended. Worth doing deliberately.

**Nudity model: 12.8s cold.** Almost all model download and initialisation, and
it ran *after* recording finished — the worst possible moment. It now starts
when the camera opens, so it loads while the person is still filming.

---

### Second pass — the areas missed on the first sweep

| Feature | Result |
|---|---|
| **Drafts** | ❌→✅ **fixed.** "Save as draft" wrote the row correctly and nothing could ever read it back — no list, no route, no function. The button accepted your work and made it permanently invisible. Drafts tab added, with a Publish action |
| **Profile editing** | ❌→✅ **fixed.** The write succeeded; the read cache was never told, so the app kept showing the old bio and it looked like saving had failed |
| Sounds — list, detail, favourite/unfavourite | ✅ |
| Hashtags — trending and per-tag videos | ✅ `city` returns 6 |
| Notifications screen | ✅ 9 rows render |
| Share sheet | ✅ 8 targets, copy-link present |
| Deep links (`/v/:id`) | ✅ resolve correctly |
| **Friends map** | ✅ A shares → B sees them → A stops → B stops seeing them. The privacy-critical direction works |
| Location sharing settings | ✅ persist and read back |
| English translations for new strings | ✅ 17 added — the profile had read "Videos / Saved / مسودات" |

**Not tested:** signup and onboarding. Creating an account means entering a
password, which I do not do — that one needs you.

## Still open

**Finding #14 — blocking does not hide the profile row.** `0054`'s policy is
written correctly and the `blocks` row is correct, so something else is
permitting the read. Postgres OR-s permissive policies together, so one extra
policy defeats it — the same failure mode as the admin storage policies found
earlier today. Run this:

```sql
select polname, pg_get_expr(polqual, polrelid) as using_expr
  from pg_policy
 where polrelid = 'public.profiles'::regclass
   and polcmd in ('r', '*')
 order by polname;
```

Expect exactly one (`profiles read public`). If more appear, the extra one is
the cause — paste me the result and I'll write the fix.

Impact is limited: a blocked user cannot search, message, or see videos. They
could read a name and bio by navigating directly.

**Not implemented, not broken:** there is no way to edit a posted video's
caption, and no typing indicator or read receipts. Neither is a bug; both are
absent features.
