// Constants and small pure helpers for the live screens.

// The same App ID the web app ships (web/index.html sets window.AGORA_APP_ID,
// read by web/js/agora.js). An App ID is public: the App Certificate that
// signs tokens stays in the agora-token Edge Function. A build may point at
// another Agora project with EXPO_PUBLIC_AGORA_APP_ID.
export const AGORA_APP_ID = process.env.EXPO_PUBLIC_AGORA_APP_ID ?? '8d15ed4d11f84365aea8f1d78ee2c713';

// Canonical share link, as web/js/deeplink.js liveLink() builds it. The https
// form is what other apps can open; the app routes /live/<id> itself.
const LINK_ORIGIN = 'https://flyp-sa.com';
export const liveLink = (id: string) => `${LINK_ORIGIN}/live/${encodeURIComponent(id)}`;

// The reaction tray, the same six as the web app (V.live REACTIONS).
export const REACTIONS = ['❤️', '🔥', '👏', '😂', '😮', '💯'] as const;

export const MAX_TITLE = 60; // the web go-live input's maxlength
export const MAX_COMMENT = 500; // live_comments column limit
export const MAX_GUESTS = 4; // 0103: at most 4 accepted guests plus the host
export const MAX_COMMENTS_SHOWN = 100;

// The Agora uid a signed-in person joins a live channel with.
//
// Derived from the user id instead of drawn at random so that every client
// can tell WHO is speaking: Agora only reports uids, and the stage shows
// people. A 32-bit FNV-1a hash folded into 1..2147483646 (the range agora.js
// uses) makes a collision between the handful of people on one stage
// vanishingly unlikely. The cost is that one account open on two devices in
// the same live ejects the earlier one (Agora reports SameUidLogin), which
// the room shows as "opened on another device".
//
// Streams started from the web app use a random host uid; the stage falls
// back to crediting an unknown speaker to the host tile.
// supabase/functions/agora-token's uidFor() is the same function and the
// server signs every token for it, so the two must stay identical.
export function agoraUidFor(userId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 2147483646) + 1;
}

export function formatDuration(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}
