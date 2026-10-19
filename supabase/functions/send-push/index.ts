// send-push — one notifications row in, pushes to that person's phones out.
//
// Called by the tr_push_on_notification trigger (migration 0087) through
// pg_net, with the same shared secret media-reconcile uses, so no new secret
// had to be minted. Android tokens go to Firebase Cloud Messaging (HTTP v1,
// service-account JWT); iPhone tokens go straight to APNs (HTTP/2, ES256
// JWT). Nothing here ever trusts the request body for content: the row is
// re-read with the service role, so a replayed call can at most repeat a
// push that was already legitimate.
//
// Two kinds of request body:
//   { notification_id }  a new notifications row (0087 trigger)
//   { call_id }          a calls row stopped ringing (0109 trigger): take the
//                        incoming-call alert off the callee's phones, and
//                        leave a "missed call" when nobody answered
//
// Language: push_tokens.lang is the code the app runs in (one of the nine in
// strings.ts); anything else reads English.
//
// Android channels (mobile/src/features/notifications/push.ts PUSH_CHANNELS):
// messages, calls, social, live, default. A channel's importance decides
// sound and heads-up, so every push names the right one.
//
// Incoming calls are different on purpose (mobile/src/features/call/
// background.ts): on Android they go out DATA-ONLY at high priority, so the
// app's background task draws a ringing full-screen call notification with
// Accept / Decline; on iPhone they are a time-sensitive alert in the
// 'incoming_call' category, which the app registers with the same buttons.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   RECONCILE_SECRET          already set; must match job_endpoints headers
//   FCM_SERVICE_ACCOUNT_JSON  the whole service-account .json from Firebase
//   APNS_KEY_ID               10 characters, from the .p8 key's page
//   APNS_TEAM_ID              Apple Team ID
//   APNS_KEY_P8               the .p8 file's contents, BEGIN/END lines included
//   APNS_TOPIC                optional; defaults to the iOS bundle id
//
// A push is a courtesy: every failure is logged and swallowed, and a token
// the provider says is dead is deleted so it is never tried again.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { fill, normLang, STRINGS, type Lang, type Strings } from './strings.ts';

const env = (k: string) => (Deno.env.get(k) ?? '').trim();
const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const RECONCILE_SECRET = env('RECONCILE_SECRET');
const FCM_SA = env('FCM_SERVICE_ACCOUNT_JSON');
const APNS_KEY_ID = env('APNS_KEY_ID');
const APNS_TEAM_ID = env('APNS_TEAM_ID');
const APNS_KEY_P8 = env('APNS_KEY_P8');
const APNS_TOPIC = env('APNS_TOPIC') || 'com.flyp.social';
const APNS_HOST = env('APNS_HOST') || 'https://api.push.apple.com';

// How long a call rings (mobile/src/features/call/callSession.ts RING_TIMEOUT_MS).
const RING_MS = 45_000;

const makeDb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
type Db = ReturnType<typeof makeDb>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// ── small crypto helpers ──
const enc = new TextEncoder();
const b64url = (data: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof data === 'string' ? enc.encode(data) : new Uint8Array(data);
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const pemToDer = (pem: string) => {
  const b64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};
async function signJwt(header: object, claims: object, key: CryptoKey, alg: 'RS256' | 'ES256') {
  const input = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claims));
  const params = alg === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' };
  const sig = await crypto.subtle.sign(params, key, enc.encode(input));
  return input + '.' + b64url(sig);
}

// ── FCM (Android) ──
let fcmToken: { value: string; exp: number } | null = null;
let fcmProject = '';
async function fcmAccessToken(): Promise<string> {
  if (fcmToken && fcmToken.exp > Date.now() / 1000 + 60) return fcmToken.value;
  const sa = JSON.parse(FCM_SA);
  fcmProject = sa.project_id;
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signJwt({ alg: 'RS256', typ: 'JWT' }, {
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: sa.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }, key, 'RS256');
  const r = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + encodeURIComponent(jwt),
  });
  const t = await r.json();
  if (!r.ok || !t.access_token) throw new Error('fcm oauth: ' + JSON.stringify(t).slice(0, 200));
  fcmToken = { value: t.access_token, exp: now + (t.expires_in || 3600) };
  return fcmToken.value;
}

type Result = true | 'dead' | string;

// `message` is an FCM v1 message without its token.
// true = delivered or retryable; 'dead' = the token is gone, delete it
async function sendFcm(token: string, message: Record<string, unknown>): Promise<Result> {
  const access = await fcmAccessToken();
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${fcmProject}/messages:send`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + access, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { token, ...message } }),
  });
  if (r.ok) return true;
  const e = await r.json().catch(() => ({}));
  const code = e?.error?.details?.find((d: { errorCode?: string }) => d.errorCode)?.errorCode || e?.error?.status || String(r.status);
  if (r.status === 404 || code === 'UNREGISTERED' || code === 'NOT_FOUND') return 'dead';
  return 'fcm ' + r.status + ' ' + code;
}

// ── APNs (iPhone) ──
let apnsJwt: { value: string; iat: number } | null = null;
async function apnsBearer(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (apnsJwt && now - apnsJwt.iat < 50 * 60) return apnsJwt.value;   // Apple: refresh within the hour
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(APNS_KEY_P8), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const jwt = await signJwt({ alg: 'ES256', kid: APNS_KEY_ID }, { iss: APNS_TEAM_ID, iat: now }, key, 'ES256');
  apnsJwt = { value: jwt, iat: now };
  return jwt;
}
type ApnsOpts = { pushType?: 'alert' | 'background'; priority?: '10' | '5'; collapseId?: string; expiresAt?: number };
async function sendApns(token: string, payload: Record<string, unknown>, o: ApnsOpts = {}): Promise<Result> {
  const headers: Record<string, string> = {
    authorization: 'bearer ' + await apnsBearer(),
    'apns-topic': APNS_TOPIC,
    'apns-push-type': o.pushType ?? 'alert',
    'apns-priority': o.priority ?? '10',
  };
  if (o.collapseId) headers['apns-collapse-id'] = o.collapseId.slice(0, 64);
  if (o.expiresAt) headers['apns-expiration'] = String(Math.floor(o.expiresAt / 1000));
  const r = await fetch(`${APNS_HOST}/3/device/${token}`, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (r.ok) return true;
  const e = await r.json().catch(() => ({}));
  const reason = e?.reason || String(r.status);
  if (r.status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered' || reason === 'DeviceTokenNotForTopic') return 'dead';
  return 'apns ' + r.status + ' ' + reason;
}

const fcmReady = () => !!FCM_SA;
const apnsReady = () => !!(APNS_KEY_P8 && APNS_KEY_ID && APNS_TEAM_ID);

// ── what to say ──
type Row = { id: string; user_id: string; actor_id: string | null; type: string; payload: Record<string, unknown> | null };
type Channel = 'messages' | 'calls' | 'social' | 'live' | 'default';
type Msg = {
  title: string;
  body: string;
  route: string;
  channel: Channel;
  // Pushes with the same key group (iOS thread-id) and replace each other
  // on Android (notification tag), so one chat is one notification.
  group?: string;
  // Also replace on iPhone (apns-collapse-id), not just stack: used for the
  // social groups, whose newest push already says "Sara and 4 more ...".
  replace?: boolean;
  // iOS thread-id when there is no group: stacks a type together in the
  // Notification Centre without replacing anything.
  thread?: string;
};

// ── grouping of social pushes (client note 11) ──
// Repeated likes / comments / follows on the same thing share one key. On
// Android the key is the notification tag (and FCM collapse_key), so the
// newest push REPLACES the previous one in the shade; on iPhone it is the
// apns-collapse-id (replace) and thread-id (stack). The newest push's title
// counts the distinct people with an unread notification of the same key in
// the last hour: "Sara and 4 more liked your video".
//
// Android cannot be told a notification group (setGroup) through an FCM
// notification message, and drawing these locally from a data-only push
// would make them depend on a headless JS task that some phones never start
// for a closed app. Tags keep them system-drawn and reliable; different keys
// (different videos, follows vs likes) still bundle under the app's name
// once there are four or more, which Android does on its own.
const SOCIAL_WINDOW_MS = 3600_000;

type SocialKey = {
  key: string;
  // Narrows the "same key" notifications query.
  type: string;
  match: Record<string, string>;
  // like: a video like and a comment like are both type 'like'.
  commentLike?: boolean;
  topLevel?: boolean;
};

const isCommentLike = (p: Record<string, unknown>) => p.kind === 'comment' || p.kind === 'comment_like';

function socialKey(n: Row): SocialKey | null {
  const p = n.payload || {};
  const video = p.video_id ? String(p.video_id) : '';
  switch (n.type) {
    case 'like':
      if (isCommentLike(p)) {
        const c = p.comment_id ? String(p.comment_id) : '';
        if (c) return { key: `like_c_${c}`, type: 'like', match: { comment_id: c }, commentLike: true };
        return video ? { key: `like_cv_${video}`, type: 'like', match: { video_id: video }, commentLike: true } : null;
      }
      return video ? { key: `like_v_${video}`, type: 'like', match: { video_id: video }, commentLike: false } : null;
    case 'comment':
      if (p.parent_id) return { key: `reply_${p.parent_id}`, type: 'comment', match: { parent_id: String(p.parent_id) } };
      return video ? { key: `cmt_${video}`, type: 'comment', match: { video_id: video }, topLevel: true } : null;
    case 'follow':
      return { key: 'follows', type: 'follow', match: {} };
    case 'follow_request':
      return { key: 'follow_reqs', type: 'follow_request', match: {} };
  }
  return null;
}

// Unread notifications of the same key in the window, newest first: their
// ids (so a tap can mark them all read) and how many OTHER people sent them.
async function socialRecent(db: Db, n: Row, k: SocialKey): Promise<{ ids: string[]; others: number }> {
  let q = db.from('notifications')
    .select('id,actor_id,payload')
    .eq('user_id', n.user_id).eq('type', k.type).is('read_at', null)
    .gte('created_at', new Date(Date.now() - SOCIAL_WINDOW_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(100);
  for (const [f, v] of Object.entries(k.match)) q = q.eq(`payload->>${f}`, v);
  const { data, error } = await q;
  if (error || !data) return { ids: [n.id], others: 0 };
  const rows = (data as { id: string; actor_id: string | null; payload: Record<string, unknown> | null }[])
    .filter((r) => {
      const rp = r.payload || {};
      if (k.commentLike !== undefined && isCommentLike(rp) !== k.commentLike) return false;
      if (k.topLevel && rp.parent_id) return false;
      return r.actor_id !== n.user_id;
    });
  const people = new Set(rows.map((r) => r.actor_id ?? '').filter(Boolean));
  if (n.actor_id) people.delete(n.actor_id);
  const ids = rows.map((r) => r.id);
  if (!ids.includes(n.id)) ids.unshift(n.id);
  return { ids: ids.slice(0, 30), others: people.size };
}

// The person's own switch for each type. Missing row or column means "on".
const SETTING_FOR: Record<string, string> = {
  message: 'notif_messages', follow: 'notif_follows', follow_request: 'notif_follows',
  like: 'notif_likes', comment: 'notif_comments', mention: 'notif_comments', live: 'notif_live',
  gift: 'notif_gifts',
};

const short = (s: unknown) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 120);

// Live-guest notices (0103) reuse type 'system' with a payload kind.
const LIVE_GUEST: Record<string, keyof Strings> = {
  live_join_request: 'liveJoinRequest',
  live_invite: 'liveInvite',
  live_guest_accepted: 'liveGuestAccepted',
  live_guest_approved: 'liveGuestApproved',
  live_guest_removed: 'liveGuestRemoved',
};

// Creator payout notices (0130) reuse type 'system' with a payload kind:
// [title, body]. {n} in the body is payload.amount_sar. All open the wallet.
const PAYOUT: Record<string, [keyof Strings, keyof Strings]> = {
  payout_kyc_approved: ['payoutKycApproved', 'payoutKycApprovedBody'],
  payout_kyc_rejected: ['payoutKycRejected', 'payoutKycRejectedBody'],
  payout_withdrawal_approved: ['payoutApproved', 'payoutApprovedBody'],
  payout_withdrawal_paid: ['payoutPaid', 'payoutPaidBody'],
  payout_withdrawal_rejected: ['payoutRejected', 'payoutRejectedBody'],
};

// A message's kind (0093 payload.kind) shown instead of an empty body.
const KIND_LABEL: Record<string, keyof Strings> = {
  voice: 'voice', image: 'image', video: 'video', location: 'location', file: 'file', sticker: 'sticker',
};

function compose(n: Row, actor: string, lang: Lang, extra: { unread?: number; others?: number } = {}): Msg | null {
  const S = STRINGS[lang];
  const a = { a: actor };
  const p = n.payload || {};
  const video = p.video_id ? String(p.video_id) : '';
  const profile = n.actor_id ? `/profile/${n.actor_id}` : '/notifications';
  // Social grouping: the shared key, and "{a} and {n} more" when others > 0.
  const sk = socialKey(n);
  const others = extra.others ?? 0;
  const many = others > 0;
  const grouped = (m: Msg): Msg => (sk ? { ...m, group: sk.key, replace: true } : m);
  const t = (one: keyof Strings, n2: keyof Strings) => (many ? fill(S[n2], { a: actor, n: others }) : fill(S[one], a));
  switch (n.type) {
    case 'message': {
      // A voice note, a photo or a location has no text; a call record gets
      // no notification at all (0093).
      const k = String(p.kind || 'text');
      const unread = extra.unread ?? 0;
      return {
        title: unread > 1 ? fill(S.messagesN, { a: actor, n: unread }) : fill(S.message, a),
        body: KIND_LABEL[k] ? S[KIND_LABEL[k]] : short(p.text),
        route: p.chat_id ? `/chat/${p.chat_id}` : '/inbox',
        channel: 'messages',
        group: p.chat_id ? `chat_${p.chat_id}` : undefined,
      };
    }
    case 'follow':
      return grouped({ title: t('follow', 'followN'), body: '', route: many ? '/notifications' : profile, channel: 'social' });
    case 'follow_request':
      return grouped({ title: t('followRequest', 'followRequestN'), body: '', route: '/follow-requests', channel: 'social' });
    case 'like': {
      // A comment like reuses 'like' (0072); send-push wrote kind 'comment', the web app 'comment_like'.
      const onComment = isCommentLike(p);
      return grouped({
        title: onComment ? t('likeComment', 'likeCommentN') : t('likeVideo', 'likeVideoN'),
        body: short(p.excerpt),
        route: video ? (onComment ? `/comments/${video}` : `/v/${video}`) : '/notifications',
        channel: 'social',
      });
    }
    case 'comment':
      // A reply is also a 'comment' and carries parent_id.
      return grouped({
        title: p.parent_id ? t('reply', 'replyN') : t('comment', 'commentN'),
        body: short(p.text),
        route: video ? `/comments/${video}` : '/notifications',
        channel: 'social',
      });
    case 'mention':
      // 0101: being tagged in a post is a mention with kind 'tag'.
      return {
        title: fill(p.kind === 'tag' ? S.tag : S.mention, a),
        body: short(p.text),
        route: video ? `/v/${video}` : '/notifications',
        channel: 'social',
        thread: 'mentions',
      };
    case 'live': {
      const live = p.live_id || p.stream_id;
      return { title: fill(S.live, a), body: short(p.title), route: live ? `/live/${live}` : '/home', channel: 'live', thread: 'live' };
    }
    case 'gift':
      // 0030 / 0104: { gift_id, amount }.
      return { title: fill(S.gift, a), body: '', route: profile, channel: 'social', thread: 'gifts' };
    case 'system': {
      const kind = String(p.kind || '');
      if (kind === 'follow_accepted') return { title: fill(S.followAccepted, a), body: '', route: profile, channel: 'social', thread: 'follows' };
      // A deliberate test row, inserted by hand to prove the pipeline reaches a real phone.
      if (kind === 'push_test') return { title: S.pushTestTitle, body: S.pushTestBody, route: '/inbox', channel: 'default' };
      if (LIVE_GUEST[kind]) {
        const live = p.live_id || p.stream_id;
        return { title: fill(S[LIVE_GUEST[kind]], a), body: short(p.title), route: live ? `/live/${live}` : '/home', channel: 'live', thread: 'live' };
      }
      if (PAYOUT[kind]) {
        const [title, body] = PAYOUT[kind];
        const amount = Number(p.amount_sar);
        const n = Number.isFinite(amount) ? amount.toFixed(2) : '';
        return { title: S[title], body: fill(S[body], { n }), route: '/wallet', channel: 'default', thread: 'wallet' };
      }
      if (kind === 'incoming_call') {
        return {
          title: fill(S.calling, a),
          body: p.is_invite ? S.callInvite : (p.call_kind === 'video' ? S.videoCall : S.voiceCall),
          route: p.call_id ? `/call/${p.call_id}` : '/inbox',
          channel: 'calls',
          group: p.call_id ? `call_${p.call_id}` : undefined,
        };
      }
      return null;
    }
  }
  return null;
}

// ── delivery of an ordinary notification ──

function fcmNotification(msg: Msg, data: Record<string, string>) {
  const android: Record<string, unknown> = {
    priority: 'high',
    notification: {
      channel_id: msg.channel,
      // Below Android 8 there are no channels; keep the quiet ones quiet.
      ...(msg.channel === 'social' ? {} : { sound: 'default' }),
      ...(msg.group ? { tag: msg.group } : {}),
    },
  };
  if (msg.group) android.collapse_key = msg.group;
  return { notification: { title: msg.title, body: msg.body }, data, android };
}

function apnsAlert(msg: Msg, data: Record<string, string>) {
  const aps: Record<string, unknown> = { alert: { title: msg.title, body: msg.body } };
  if (msg.channel !== 'social') aps.sound = 'default';
  const thread = msg.group ?? msg.thread;
  if (thread) aps['thread-id'] = thread;
  return { aps, ...data };
}

// ── delivery of an incoming call ──

type CallRow = {
  id: string; caller_id: string; callee_id: string; chat_id: string | null; kind: string;
  status: string; root_id: string | null; created_at: string; answered_at: string | null;
};

function callData(n: Row, call: CallRow, msg: Msg, S: Strings, actor: string, avatar: string): Record<string, string> {
  // NOTE: never use the keys title / message / body / sound / tag / icon /
  // color / vibrate / sticky in data: expo-notifications reads those as a
  // notification to draw (and parses `body` as JSON).
  return {
    kind: 'incoming_call',
    type: n.type,
    notification_id: n.id,
    route: msg.route,
    call_id: call.id,
    call_kind: call.kind === 'video' ? 'video' : 'audio',
    is_invite: call.root_id ? '1' : '0',
    caller_id: call.caller_id,
    caller_name: actor,
    caller_avatar: avatar,
    call_title: msg.title,
    call_text: msg.body,
    accept_label: S.accept,
    decline_label: S.decline,
    created_at: String(Date.parse(call.created_at) || Date.now()),
  };
}

async function sendIncomingCall(t: TokenRow, n: Row, call: CallRow, msg: Msg, lang: Lang, actor: string, avatar: string): Promise<Result> {
  const S = STRINGS[lang];
  const data = callData(n, call, msg, S, actor, avatar);
  const left = Math.max(5_000, RING_MS - (Date.now() - Number(data.created_at)));
  if (t.platform === 'android') {
    if (!fcmReady()) return 'fcm not configured';
    // Data only and high priority: Android hands it to the app's background
    // task even when the app is closed, and the app draws the call itself
    // (full-screen, ringing, Accept / Decline). A ring that cannot arrive in
    // time is not worth delivering later.
    return await sendFcm(t.token, { data, android: { priority: 'high', ttl: `${Math.ceil(left / 1000)}s` } });
  }
  if (t.platform === 'ios') {
    if (!apnsReady()) return 'apns not configured';
    return await sendApns(t.token, {
      aps: {
        alert: { title: msg.title, body: msg.body },
        sound: 'default',
        category: 'incoming_call',
        'thread-id': `call_${call.id}`,
        // Breaks through Focus / scheduled summary (needs the
        // time-sensitive entitlement, set in app.json).
        'interruption-level': 'time-sensitive',
      },
      ...data,
    }, { collapseId: `call_${call.id}`, expiresAt: Date.now() + left });
  }
  return 'web: no channel';
}

// ── the call stopped ringing: take the ring away, maybe leave "missed call" ──

async function sendCallEnded(t: TokenRow, call: CallRow, lang: Lang, actor: string): Promise<Result> {
  const S = STRINGS[lang];
  // Nobody answered: the caller gave up (ended, never answered) or it timed out.
  const missed = !call.answered_at && (call.status === 'missed' || call.status === 'ended');
  const data: Record<string, string> = {
    kind: 'call_cancelled',
    call_id: call.id,
    call_status: call.status,
    missed: missed ? '1' : '0',
    missed_title: fill(S.missedCall, { a: actor }),
    missed_text: call.kind === 'video' ? S.videoCall : S.voiceCall,
    route: call.chat_id ? `/chat/${call.chat_id}` : '/inbox',
  };
  if (t.platform === 'android') {
    if (!fcmReady()) return 'fcm not configured';
    // The app removes the ringing notification and, if missed, shows its own
    // "missed call" in the messages channel. A day is plenty for that.
    return await sendFcm(t.token, { data, android: { priority: 'high', ttl: '86400s' } });
  }
  if (t.platform === 'ios') {
    if (!apnsReady()) return 'apns not configured';
    if (missed) {
      // Same collapse id as the ring: the ringing alert is REPLACED in place.
      return await sendApns(t.token, {
        aps: { alert: { title: data.missed_title, body: data.missed_text }, 'thread-id': `call_${call.id}` },
        ...data,
      }, { collapseId: `call_${call.id}`, priority: '5' });
    }
    // Answered or declined (perhaps on another device): wake the app quietly
    // so it can clear the alert. iOS may skip this for a force-quit app.
    return await sendApns(t.token, { aps: { 'content-available': 1 }, ...data }, { pushType: 'background', priority: '5' });
  }
  return 'web: no channel';
}

// Constant-time secret comparison (F19). Both sides are hashed first so the
// comparison always walks 32 bytes, whatever the lengths, and a plain `===`
// cannot leak how many leading characters matched through its timing.
async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// The caller is the database trigger, sending the headers stored on its own
// job_endpoints row. So the secret that row holds IS the truth: read it back
// with the service role and compare. The RECONCILE_SECRET env is accepted as
// well, but nothing has to be pasted anywhere for the two to agree - the
// first version required exactly that, and the first real call came back 401.
async function callerAllowed(req: Request, db: Db): Promise<boolean> {
  const given = req.headers.get('x-reconcile-secret') ?? '';
  if (!given) return false;
  if (RECONCILE_SECRET && (await safeEqual(given, RECONCILE_SECRET))) return true;
  const { data } = await db.from('job_endpoints').select('headers').eq('name', 'send-push').maybeSingle();
  const want = data && data.headers && (data.headers['x-reconcile-secret'] || data.headers['X-Reconcile-Secret']);
  return !!want && (await safeEqual(given, String(want)));
}

type TokenRow = { token: string; platform: string; lang: string | null };

async function actorOf(db: Db, id: string | null): Promise<{ name: string; avatar: string }> {
  if (!id) return { name: 'FLYP', avatar: '' };
  const { data: a } = await db.from('profiles').select('name,handle,avatar_url').eq('id', id).maybeSingle();
  const name = (a && (a.name || (a.handle && '@' + a.handle))) || 'FLYP';
  return { name: String(name), avatar: String((a && a.avatar_url) || '') };
}

type FanOut = { sent: number; removed: number; errors: string[] };

// Sends to every token; deletes the dead ones; reports.
async function fanOut(db: Db, tokens: TokenRow[], send: (t: TokenRow) => Promise<Result>, tag: string) {
  return json({ ok: true, ...(await fanOutCount(db, tokens, send, tag)) });
}

async function fanOutCount(db: Db, tokens: TokenRow[], send: (t: TokenRow) => Promise<Result>, tag: string): Promise<FanOut> {
  let sent = 0, removed = 0; const errors: string[] = [];
  for (const t of tokens) {
    let r: Result;
    try { r = await send(t); } catch (e) { r = String((e as Error)?.message || e); }
    if (r === true) sent++;
    else if (r === 'dead') { removed++; await db.from('push_tokens').delete().eq('token', t.token); }
    else if (r !== 'skip') errors.push(t.platform + ': ' + r);
  }
  if (errors.length) console.warn('send-push', tag, errors.join(' | '));
  return { sent, removed, errors };
}

async function handleCallEnded(db: Db, callId: string) {
  const { data: call } = await db.from('calls')
    .select('id,caller_id,callee_id,chat_id,kind,status,root_id,created_at,answered_at')
    .eq('id', callId).maybeSingle();
  if (!call) return json({ ok: true, skipped: 'no_such_call' });
  if (call.status === 'ringing') return json({ ok: true, skipped: 'still_ringing' });
  // Old rings are long gone from the phone; do not leave a stale "missed".
  if (Date.now() - Date.parse(call.created_at) > 6 * 3600_000) return json({ ok: true, skipped: 'old_call' });
  const { data: tokens } = await db.from('push_tokens').select('token,platform,lang').eq('user_id', call.callee_id);
  if (!tokens || !tokens.length) return json({ ok: true, skipped: 'no_tokens' });
  const actor = await actorOf(db, call.caller_id);
  return fanOut(db, tokens as TokenRow[], (t) => sendCallEnded(t, call as CallRow, normLang(t.lang), actor.name), 'call ' + callId);
}

async function handleNotification(db: Db, id: string) {
  const { data: n } = await db.from('notifications').select('id,user_id,actor_id,type,payload').eq('id', id).maybeSingle();
  if (!n) return json({ ok: true, skipped: 'no_such_notification' });
  if (n.actor_id && n.actor_id === n.user_id) return json({ ok: true, skipped: 'self' });
  const row = n as Row;
  const p = row.payload || {};

  const key = SETTING_FOR[row.type];
  if (key) {
    const { data: s } = await db.from('user_settings').select(key).eq('user_id', row.user_id).maybeSingle();
    if (s && (s as unknown as Record<string, unknown>)[key] === false) return json({ ok: true, skipped: 'setting_off' });
  }

  // Is the type pushed at all? (English composes the same cases as every language.)
  if (!compose(row, 'x', 'en')) return json({ ok: true, skipped: 'type_not_pushed:' + row.type });

  // A ring that is already over (answered on another phone, cancelled, or a
  // slow queue) must not start ringing now.
  const isCall = row.type === 'system' && p.kind === 'incoming_call';
  let call: CallRow | null = null;
  if (isCall) {
    const { data: c } = await db.from('calls')
      .select('id,caller_id,callee_id,chat_id,kind,status,root_id,created_at,answered_at')
      .eq('id', String(p.call_id || '')).maybeSingle();
    if (!c || c.status !== 'ringing') return json({ ok: true, skipped: 'call_not_ringing' });
    if (Date.now() - Date.parse(c.created_at) > RING_MS) return json({ ok: true, skipped: 'call_too_old' });
    call = c as CallRow;
  }

  const { data: tokens } = await db.from('push_tokens').select('token,platform,lang').eq('user_id', row.user_id);
  if (!tokens || !tokens.length) return json({ ok: true, skipped: 'no_tokens' });

  const actor = await actorOf(db, row.actor_id);

  // Several unread messages from one chat collapse into one notification
  // that says how many.
  let unread = 0;
  if (row.type === 'message' && p.chat_id) {
    const { count } = await db.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', row.user_id).eq('type', 'message').is('read_at', null)
      .eq('payload->>chat_id', String(p.chat_id))
      .gte('created_at', new Date(Date.now() - 24 * 3600_000).toISOString());
    unread = count ?? 0;
  }

  // Repeated likes / comments / follows: one replacing notification that
  // says how many people (see socialKey).
  const sk = socialKey(row);
  const recent = sk ? await socialRecent(db, row, sk) : { ids: [row.id], others: 0 };

  const cache = new Map<Lang, Msg | null>();
  const msgFor = (lang: Lang) => {
    if (!cache.has(lang)) cache.set(lang, compose(row, actor.name, lang, { unread, others: recent.others }));
    return cache.get(lang)!;
  };

  const out = await fanOutCount(db, tokens as TokenRow[], async (t) => {
    const lang = normLang(t.lang);
    const msg = msgFor(lang);
    if (!msg) return 'skip';
    if (call) return await sendIncomingCall(t, row, call, msg, lang, actor.name, actor.avatar);
    const data: Record<string, string> = { route: msg.route, notification_id: row.id, type: row.type };
    if (p.kind) data.kind = String(p.kind);
    if (p.chat_id) data.chat_id = String(p.chat_id);
    // A grouped push stands for several rows: a tap marks them all read
    // (mobile/src/features/notifications/push.ts), so the next like starts a
    // fresh count.
    if (recent.ids.length > 1) data.notification_ids = recent.ids.join(',');
    if (t.platform === 'android') return fcmReady() ? await sendFcm(t.token, fcmNotification(msg, data)) : 'fcm not configured';
    if (t.platform === 'ios') {
      if (!apnsReady()) return 'apns not configured';
      return await sendApns(t.token, apnsAlert(msg, data), msg.replace && msg.group ? { collapseId: msg.group } : {});
    }
    return 'web: no channel';
  }, row.id);

  // Two grey ticks with the recipient's app closed (client note 10, 0134):
  // a message counts as delivered once FCM / APNs accepted its push for at
  // least one of their devices. Best effort; the app stamps it as well.
  let delivered: boolean | undefined;
  if (row.type === 'message' && out.sent > 0) {
    const { data: d, error } = await db.rpc('mark_delivered_by_push', { p_notification_id: row.id });
    if (error) console.warn('send-push', row.id, 'mark_delivered_by_push:', error.message);
    else delivered = d === true;
  }

  return json({ ok: true, ...out, ...(delivered === undefined ? {} : { delivered }) });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'not_configured' }, 500);
  const db = makeDb();
  if (!(await callerAllowed(req, db))) return json({ error: 'unauthorized' }, 401);

  let body: { notification_id?: string; call_id?: string } = {};
  try { body = await req.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const uuid = /^[0-9a-f-]{36}$/i;
  if (body.call_id) {
    const callId = String(body.call_id);
    if (!uuid.test(callId)) return json({ error: 'bad_request' }, 400);
    return handleCallEnded(db, callId);
  }
  const id = String(body.notification_id || '');
  if (!uuid.test(id)) return json({ error: 'bad_request' }, 400);
  return handleNotification(db, id);
});
