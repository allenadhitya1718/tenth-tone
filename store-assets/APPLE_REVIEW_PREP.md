# App Review preparation

Built from the review guide the team shared. Its two highest-leverage claims:
**review notes and a demo video may be the difference between the 48-hour pile
and the 14-day pile**, and **anything unfinished is a rejection**.

---

## 1. The guide, mapped to FLYP

| Requirement | FLYP | |
|---|---|---|
| Responsive across devices | Fixed today — the app was letterboxing on phones wider than 430px | ✅ |
| Privacy policy + terms as static HTML | `site/privacy.html`, `site/terms.html` | ✅ built, ⏳ needs hosting |
| Permissions requested properly | Camera/mic only when recording or going live; location only for the map. Arabic usage strings injected by the iOS workflow | ✅ |
| Social: report | Report on videos, comments, users | ✅ |
| Social: blocking | Blocking, and today the Blocked Users screen was fixed — it had been returning undefined ids, so Unblock silently did nothing | ✅ |
| Social: contact support | `support@flyp-sa.com`, on the store listing and the site | ✅ |
| **Social: moderate UGC** | Text and images are screened before they are saved, through a Supabase Edge Function calling OpenAI's free moderation endpoint. Video is SAMPLED (three frames), not watched end to end, and the review notes say so in as many words | ✅ code done, ⏳ needs migration 0066 + the `OPENAI_API_KEY` secret |
| **No unfinished / coming-soon screens** | Swept. Thirteen findings: the two settings builders no longer fall back to a "قريبًا" toast, tagging/place/comment-likes removed for having no table behind them, Message and Reply implemented, group call buttons hidden rather than shown and refused. **Zero coming-soon toasts remain in the app.** | ✅ |
| Everything works | Four team-reported bugs fixed today; three were worse than reported | ✅ |
| No dark patterns | No paywall, no subscriptions, no purchases at all | ✅ |
| Not a 1:1 copy | Arabic-first, RTL, Saudi market, own identity and feature mix | ✅ |
| Native SwiftUI | ❌ Capacitor. Cannot change, and not required — the guide's own point is that native raises the ceiling, not that hybrid is rejected | n/a |
| Scope creep | ⚠️ FLYP is feature-rich: video, live streaming, chat, calls, map. Genuinely more complex than an MVP, so a longer first review is possible. Nothing to do about it now | ⚠️ |

---

## 2. Review notes — paste into App Store Connect

Written for someone who has never seen the app. Short sentences, numbered
flow, no jargon, no AI-sounding prose.

```
Hello App Review team,

FLYP is a free Arabic short-video app for Saudi Arabia. The interface is
Arabic and right-to-left. There are no purchases, subscriptions or ads.

SIGN IN
Email:    <reviewer account email>
Password: <reviewer account password>

An account is required; nothing is visible when signed out. This account
already has videos posted and accounts followed, so the app has content on
first open.

MAIN REVIEW FLOW
1. Sign in with the details above. The feed opens on the Home tab.
2. Swipe up and down to move between videos. One swipe moves one video.
3. Tap the heart, the comment icon, or the share icon on the right of any
   video. Comments open in a sheet.
4. Tap Discover (magnifier) to see trending hashtags and search.
5. Tap the + button to open the create screen. Choosing "Record" opens the
   camera. Camera and microphone permission is requested at that moment and
   can be declined — the rest of the app continues to work.
6. Tap Chat to see conversations. Open one to send a message, a photo, or a
   voice note (hold the microphone button, release to preview, then send).
7. Tap Profile to see the account, its videos, and Settings.

SAFETY AND MODERATION (Guideline 1.2)
- Every video, comment and account can be reported. Tap the "..." menu on a
  video, or press and hold a comment.
- Any account can be blocked from its profile page. Blocked accounts cannot
  message you, comment on your videos, or see your profile, and they no
  longer appear in your search results.
- Blocked accounts are managed at Profile > Settings > Privacy > Blocked
  users, where they can be unblocked.
- Text is screened automatically before it is saved. Video captions,
  comments, live-stream comments and titles, profile names and bios, group
  names and direct messages are all checked by an automated classifier
  first, and anything rated severe is refused at that point and never
  appears in the app.
- Images are screened the same way, before they are uploaded: profile
  photos, group photos and live-stream cover images.
- Uploaded videos are screened in two ways. Three still frames are sampled
  from each video and checked together with its caption, and a nudity model
  runs on the device before the file is uploaded at all.
- What is not screened automatically, stated plainly: we do not check every
  frame of a video, we do not analyse audio, we do not screen live video
  while it is broadcasting, and we do not screen photos sent privately
  inside a direct message. Those rely on reporting, on blocking, and on an
  administrator who can end any live stream immediately.
- Anything the classifier rates borderline rather than severe is published
  and placed in the same moderation queue our team already uses for user
  reports. If the classifier cannot be reached, the post is allowed and
  flagged for human review rather than blocked.
- Reports reach a moderation queue reviewed by our team.
- Support: support@flyp-sa.com

PERMISSIONS, AND WHEN THEY ARE ASKED FOR
- Camera and microphone: only when recording a video or starting a live
  stream. Declining leaves every other screen working.
- Photo library: only when choosing an existing video to upload.
- Location: only if the reviewer opens the friends map. It is optional and
  off by default.

ACCOUNT DELETION
Profile > Settings > Delete account. There is a 30-day grace period during
which signing in again cancels the deletion. Deletion can also be requested
without the app at <delete-account URL>.
```

**Before pasting:** fill in the reviewer credentials and the deletion URL.
The moderation lines are filled in and are true of the shipped build ONLY
once migration 0066 is applied and `moderate-content` is deployed with its
`OPENAI_API_KEY` secret. Submitting these notes before that is a false
claim to a reviewer, which is far worse than the gap they describe closing. Do not leave a placeholder in the box — an
angle bracket left in review notes reads as carelessness on the one document
whose entire job is to look careful.

---

## 3. Demo video script

The guide rates this as very high ROI, and suspects submissions without one
are auto-rejected. Record on a real device, screen-record, 60–90 seconds,
with text overlays. No music, no fast cuts — the goal is boring and legible.

| # | Show | Overlay text |
|---|---|---|
| 1 | Sign-in screen, type the reviewer email, sign in | "Sign in — reviewer account" |
| 2 | Feed loads, swipe twice | "Home feed. One swipe = one video." |
| 3 | Tap heart, tap comment, close | "Like and comment" |
| 4 | Tap "..." on a video, show the Report option | **"Report — Guideline 1.2"** |
| 5 | Open a profile, tap Block, confirm | **"Block a user"** |
| 6 | Settings > Privacy > Blocked users, tap Unblock | **"Manage blocked users"** |
| 7 | Discover tab, tap a hashtag | "Discover and search" |
| 8 | Chat: open a thread, hold mic, release, preview, send | "Chat and voice notes" |
| 9 | Tap +, Record; show the permission prompt appearing | "Camera permission — only when recording" |
| 10 | Settings > Delete account, show the confirm dialog (do **not** confirm) | **"Account deletion, 30-day grace"** |

Steps 4, 5, 6 and 10 are the ones that matter. They are the four things a
reviewer checks on a social app, and showing them removes any need to go
looking. Put them early if the video has to be shortened.

---

## 4. Tactics from the guide worth remembering

- **Ask for ALL rejection reasons at once.** The common failure is fixing one
  thing, resubmitting, and being rejected for a second — repeatedly.
- **You can request a phone call.** The guide reports reviewers say almost
  nobody does, which may mean a shorter queue. Worth using if a rejection
  loop starts.
- **Expedited review** exists and needs no stated reason.
- **Be modest and exact.** Every claim in the notes above is checkable inside
  the app. Nothing is described that FLYP cannot do — the moderation sentence
  in particular must be filled in with what was actually built, not with what
  sounds best.
