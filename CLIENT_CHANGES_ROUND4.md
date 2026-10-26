# Client changes, round 4 (26 Oct 2026)

Decisions from the owner after the client's latest notes.

**Progress (27 Oct):** steps 1 to 5 are built, and migrations 0158 to 0161 are applied to Mumbai, with send-push deployed. Nothing is on a phone yet: it all goes into the next test build.

## 1. Live: audio-only, redesigned like TikTok LIVE (option A)
Live stays **audio-only** (client note 4 still holds). Only the look and the flow change to match TikTok LIVE.

- Full-screen room: the host's photo (blurred, or a chosen background) fills the screen, like a TikTok host video.
- Top bar: host chip (photo, name, follow button), top-gifter avatars, viewer count, close.
- Comments scroll over the bottom-left with a fade at the top. Join notices ("Sara joined") and gift notices appear in the same list.
- Bottom bar: comment box, guest button, gift box, share, and a tap anywhere for like hearts.
- Gift animations play full screen, and combo counters ("x5") appear for repeated gifts.
- A ranking sheet shows the top gifters in this live.
- Guests appear as a grid of avatar seats with a speaking ring, mute icon and name, laid out like TikTok multi-guest.

**Client requests kept inside the redesign:**
- **Invite a specific person:** the host searches any user (not only people already watching) and sends an invite. The person gets a push and an in-app card "<host> invites you to join their LIVE", with Join and Decline.
- **Up to 30 participants on stage**, up from today's limit of 4 guests plus the host. Agora audio handles 30 speakers. The seat grid scrolls past 9 seats, and the host can mute any guest.

## 2. Gifts and wallet: TikTok's system, Saudi gift designs
These work the same way as TikTok:
- **Coins:** bought only through Apple or Google in-app purchase, in packs. Larger packs get a slightly better price per coin.
- **Gifts:** cost coins. The creator receives **diamonds** worth **50% of the gift's coin value**. This is TikTok's split: the platform keeps the other half, and Apple or Google take their cut from the purchase price.
- **Diamonds:** converted to money and withdrawn. This uses the payout system we already built: minimum amount, ID check, then admin approval.
- **Recharge page:** coin packs, the balance, and a "first recharge" bonus.
- **Gift panel:** a tabbed grid with prices, a combo button for sending the same gift repeatedly, and a balance with a top-up button.

All prices, the diamond value and the split are stored in the database and **editable in the admin panel**, so they can follow TikTok's numbers whenever those change. The final SAR prices need to be checked against Apple's and Google's price tiers.

**Gift designs reflect Saudi identity** and are not copies of TikTok's gifts:

| Tier | Gifts (ideas) |
|---|---|
| Small (1 to 10 coins) | Dates, Arabic coffee cup, Palm leaf, Rose of Taif |
| Medium (30 to 299 coins) | Dallah, Sadu weaving, Palm tree, Bakhoor (incense) |
| Large (500 to 4,999 coins) | Falcon, Camel, Arabian horse, Desert tent |
| Top (10,000+ coins) | Masmak Palace, Riyadh skyline, Camel caravan |

Each gift needs artwork: an icon plus an animation, either Lottie or a short WebP or MP4. We can draw simple versions ourselves, but polished full-screen animations should come from a designer. **Ask the client** whether they have a designer, or whether we should produce them.

## 3. Push and call notifications in WhatsApp style
- **Messages (Android):** a conversation-style notification with the sender's photo and the last few messages, grouped per chat. It has **Reply** (type a reply without opening the app) and **Mark as read** buttons.
- **Messages (iOS):** the sender's photo on the notification (a communication notification), with Reply from the lock screen.
- **Incoming call (Android):** a full-screen incoming-call screen over the lock screen with Accept and Decline, using the system call style (Android 12+).
- **Incoming call (iOS):** **CallKit**, so the native iPhone call screen appears, the same as WhatsApp. This needs VoIP push (PushKit). The existing APNs key works for it, but it is the largest single item here.

## 4. A unique ringtone for the app
- One ringtone for incoming calls, plus a short message tone, both original sounds made for FLYP and used on Android and iOS.
- **Ask the client** whether they have a sound or a brand jingle. If not, we produce 3 short original options for them to pick from.
- Notification sounds can't be changed on an existing Android channel, so new channels are created when the ringtone ships.

## Step 1, built (27 Oct)
- **Gift list:** 15 Saudi gifts on TikTok's price ladder, from 1 to 29,999 coins: Taif rose, coffee cup, palm frond, dates, bakhoor, dallah, Sadu weaving, palm tree, desert tent, falcon, camel, Arabian horse, camel caravan, Masmak Palace and Riyadh skyline. The non-Saudi gifts (heart, star, trophy, crown, rocket, yacht, car) are hidden. Emoji stand in until the artwork arrives.
- **Coin packs:** TikTok's sizes (65, 330, 660, 1,321, 3,303 and 6,607 coins) at about 0.04 SAR a coin (2.99 to 259.99 SAR), with no bonus coins.
- **Creator share:** as on TikTok, 1 coin of gift = 1 diamond, and a diamond is worth half a coin's price (0.0188 SAR, which is TikTok's $0.005). Withdrawals start at 40 SAR, against TikTok's $10.
- **App gift panel:** works like TikTok's. Tap a gift, tap Send; a round combo button then counts down so the same gift can be sent again with one tap, and the panel stays open. A Recharge button sits next to the balance.
- **App recharge page:** the coin packs as a grid of tiles, with one Recharge button showing the store price.
- **Admin:** a new "Gift list & coin packs" page to add, edit, re-price, hide and set artwork for gifts and packs. Every change is logged. The diamond value and minimum stay in Payout settings.
- **Still off until launch:** `WALLET_LAUNCHED` in the app and `app_limits.gifts_enabled` on the server, as before.
- **Before real sales:** create the 6 products `flyp.coins.65` … `flyp.coins.6607` in App Store Connect (consumable) and Google Play (one-time product), with the SAR prices.
- **Margin warning:** with the creator getting half the price, FLYP's share of 1 SAR spent is about 0.11 SAR with Apple or Google's 30% fee and 15% VAT. It is about 0.24 SAR under the stores' 15% small-business rate. TikTok's in-app prices carry the same squeeze, so the client should know.

## Steps 2 to 5, built (27 Oct)
**Live (0159):**
- Audio-only, laid out like TikTok LIVE:
  - host capsule with a follow button;
  - top-gifter avatars and a "Top gifters" ranking;
  - a listener count, with End (host) or close (viewer);
  - comments as bubbles at the bottom left, with gift lines among them;
  - a full-screen moment for gifts of 499 coins and up;
  - tap anywhere to send hearts.
- The stage holds **30** (the host plus 29 guests), in a grid that scrolls.
- **Invite a specific person:** the host searches people (or picks from the people they follow) and taps Invite. The person gets a push and the Join card.
  - Strangers can't be invited; the invitee needs a follow either way.
  - At most 30 invites per 10 minutes.
- The host can mute a guest; their app keeps the mic off until the host unmutes.

**Notifications like WhatsApp (0160, 0161):**
- **Android messages:**
  - one conversation per chat, with the sender's photo and the last 7 lines (group chats name each sender);
  - **Reply** from the notification (sends without opening the app and shows your reply), and **Mark as read**;
  - several chats bundle under "N messages from M chats".
- **iPhone messages:** Reply and Mark as read from the lock screen. The sender's photo needs one switch, described in the next section.
- **Both phones:**
  - **Mute** a chat for 8 hours, 1 week or always, from the chat's ⋮ menu; the inbox shows a bell-off icon and a grey count;
  - reading a chat on one phone clears its notification on the others;
  - missed calls have **Call back** and **Message** buttons.
- **Calls:**
  - Android: full-screen ringing, with the caller's name and "Incoming voice call", and a red Decline and a green Answer;
  - **iPhone: the native CallKit call screen** (like WhatsApp) via VoIP push, with Answer, Decline, Mute and End linked to the FLYP call.

**Ringtone:** `mobile/assets/sounds/flyp_ring.wav` (4 s, loops) and `flyp_message.wav`.
- Both are original, on the Hijaz scale, with a marimba-like sound and a soft frame-drum.
- They are used for Android calls and messages, iPhone CallKit and iPhone message alerts.
- Inside the app, Android plays the ring only when the phone isn't on silent or vibrate.

## Still needs you
1. **iPhone sender photos:** in the Apple developer portal, enable **Communication Notifications** for `com.flyp.social`, then set the GitHub repository variable `FLYP_IOS_COMM_NOTIFS` to `1`. The next iOS build then adds the Notification Service Extension (`com.flyp.social.notification-service`).
2. **Listen to the two tones** and confirm them with the client. If they want different ones, they replace the two files.
3. **Gift artwork:** emoji stand in until designs are uploaded (admin, Gift list & coin packs, Artwork link).
4. **Coin products** in App Store Connect and Google Play (see Step 1).
5. **Test build:** two native modules are new (iOS CallKit, Android ringer). They compile only in the GitHub builds, and need a two-phone test of calls and messages.

## Order of work (suggested)
1. Gifts and wallet economics: database, admin settings, recharge page, gift panel. This is needed by the live redesign.
2. Live redesign: TikTok layout, invite a specific person, 30 seats.
3. WhatsApp-style message notifications (Android, then iOS).
4. Incoming calls: Android full-screen call style, then iOS CallKit and VoIP push.
5. Ringtone, once the client picks one.

## Still needed from the client
- Gift artwork: their designer, or ours?
- A ringtone or brand jingle: theirs, or ours to make?
- The company and bank account that receive store payouts (App Store and Google Play agreements), needed before real coin sales.
