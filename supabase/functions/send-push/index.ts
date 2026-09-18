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
// true = delivered or retryable; 'dead' = the token is gone, delete it
async function sendFcm(token: string, title: string, body: string, data: Record<string, string>): Promise<true | 'dead' | string> {
  const access = await fcmAccessToken();
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${fcmProject}/messages:send`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + access, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: {
      token, notification: { title, body }, data,
      android: { priority: 'high', notification: { channel_id: 'default', sound: 'default' } },
    } }),
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
async function sendApns(token: string, title: string, body: string, data: Record<string, string>): Promise<true | 'dead' | string> {
  const r = await fetch(`${APNS_HOST}/3/device/${token}`, {
    method: 'POST',
    headers: {
      authorization: 'bearer ' + await apnsBearer(),
      'apns-topic': APNS_TOPIC, 'apns-push-type': 'alert', 'apns-priority': '10',
    },
    body: JSON.stringify({ aps: { alert: { title, body }, sound: 'default' }, ...data }),
  });
  if (r.ok) return true;
  const e = await r.json().catch(() => ({}));
  const reason = e?.reason || String(r.status);
  if (r.status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered' || reason === 'DeviceTokenNotForTopic') return 'dead';
  return 'apns ' + r.status + ' ' + reason;
}

// ── what to say ──
type Row = { id: string; user_id: string; actor_id: string | null; type: string; payload: Record<string, unknown> | null };
const SETTING_FOR: Record<string, string> = {
  message: 'notif_messages', follow: 'notif_follows', follow_request: 'notif_follows',
  like: 'notif_likes', comment: 'notif_comments', mention: 'notif_comments', live: 'notif_live',
};
function compose(n: Row, actor: string, lang: 'ar' | 'en') {
  const p = n.payload || {};
  const en = lang === 'en';
  const short = (s: unknown) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  let title = '', body = '', route = '';
  switch (n.type) {
    case 'message': {
      // A voice note, a photo or a location has no text, so the body was an
      // empty line; and a CALL RECORD - which 0045 writes into the chat as a
      // message whose text is a JSON blob - went out as
      //   "Alim sent you a message" / {"kind":"video","status":"ended",...}
      // 0093 stops notifying for call records at all and now sends the kind,
      // so each one can be named for what it is.
      const kindLabel: Record<string, [string, string]> = {
        voice:    ['🎤 رسالة صوتية', '🎤 Voice message'],
        image:    ['📷 صورة', '📷 Photo'],
        video:    ['🎥 فيديو', '🎥 Video'],
        location: ['📍 موقع', '📍 Location'],
        file:     ['📎 ملف', '📎 File'],
      };
      const k = String(p.kind || 'text');
      title = en ? `${actor} sent you a message` : `${actor} أرسل لك رسالة`;
      body = kindLabel[k] ? kindLabel[k][en ? 1 : 0] : short(p.text);
      route = p.chat_id ? `/chat/${p.chat_id}` : '/inbox';
      break;
    }
    case 'follow':         title = en ? `${actor} started following you` : `${actor} بدأ بمتابعتك`; route = n.actor_id ? `/profile/${n.actor_id}` : '/notifications'; break;
    case 'follow_request': title = en ? `${actor} requested to follow you` : `${actor} طلب متابعتك`; route = '/notifications'; break;
    case 'like':           title = p.kind === 'comment' ? (en ? `${actor} liked your comment` : `${actor} أعجب بتعليقك`) : (en ? `${actor} liked your video` : `${actor} أعجب بفيديوك`); body = short(p.excerpt); route = p.video_id ? `/v/${p.video_id}` : '/notifications'; break;
    case 'comment':        title = en ? `${actor} commented on your video` : `${actor} علّق على فيديوك`; body = short(p.text); route = p.video_id ? `/v/${p.video_id}` : '/notifications'; break;
    case 'mention':        title = en ? `${actor} mentioned you` : `${actor} أشار إليك`; body = short(p.text); route = p.video_id ? `/v/${p.video_id}` : '/notifications'; break;
    case 'live':           title = en ? `${actor} is live now` : `${actor} بدأ بثًا مباشرًا الآن`; body = short(p.title); route = (p.live_id || p.stream_id) ? `/live/${p.live_id || p.stream_id}` : '/home'; break;
    case 'system':
      if (p.kind === 'follow_accepted') { title = en ? `${actor} accepted your follow request` : `${actor} قبل طلب متابعتك`; route = n.actor_id ? `/profile/${n.actor_id}` : '/notifications'; }
      // A deliberate test row, inserted by hand to prove the pipeline reaches
      // a real phone. Says exactly what it is.
      if (p.kind === 'push_test') { title = en ? 'Push notifications are working ✓' : 'إشعارات FLYP تعمل ✓'; body = en ? 'FLYP can reach this phone.' : 'يمكن لـ FLYP الوصول إلى هذا الهاتف.'; route = '/inbox'; }
      // Somebody is CALLING. Nothing used to push for a call at all: the only
      // way to know was to have the app open with a live subscription, so a
      // phone in a pocket stayed silent and the call was logged as missed.
      // That silence is also why "add to call" looked broken - the invite row
      // was always created, the invited phone simply never rang.
      if (p.kind === 'incoming_call') {
        const video = p.call_kind === 'video';
        title = en ? `${actor} is calling you` : `${actor} يتصل بك`;
        body = p.is_invite
          ? (en ? 'Added you to a call' : 'أضافك إلى مكالمة')
          : (video ? (en ? 'Video call' : 'مكالمة فيديو') : (en ? 'Voice call' : 'مكالمة صوتية'));
        route = p.call_id ? `/call/${p.call_id}` : '/inbox';
      }
      break;
  }
  return title ? { title, body, route } : null;
}

// The caller is the database trigger, sending the headers stored on its own
// job_endpoints row. So the secret that row holds IS the truth: read it back
// with the service role and compare. The RECONCILE_SECRET env is accepted as
// well, but nothing has to be pasted anywhere for the two to agree - the
// first version required exactly that, and the first real call came back 401.
async function callerAllowed(req: Request, db: ReturnType<typeof createClient>): Promise<boolean> {
  const given = req.headers.get('x-reconcile-secret') ?? '';
  if (!given) return false;
  if (RECONCILE_SECRET && given === RECONCILE_SECRET) return true;
  const { data } = await db.from('job_endpoints').select('headers').eq('name', 'send-push').maybeSingle();
  const want = data && data.headers && (data.headers['x-reconcile-secret'] || data.headers['X-Reconcile-Secret']);
  return !!want && given === String(want);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'not_configured' }, 500);
  const gate = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  if (!(await callerAllowed(req, gate))) return json({ error: 'unauthorized' }, 401);

  let body: { notification_id?: string } = {};
  try { body = await req.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const id = String(body.notification_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'bad_request' }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: n } = await db.from('notifications').select('id,user_id,actor_id,type,payload').eq('id', id).maybeSingle();
  if (!n) return json({ ok: true, skipped: 'no_such_notification' });
  if (n.actor_id && n.actor_id === n.user_id) return json({ ok: true, skipped: 'self' });

  // The person's own switch for this kind of notification. Missing row or
  // missing column means "on" - the app treats it the same way.
  const key = SETTING_FOR[n.type];
  if (key) {
    const { data: s } = await db.from('user_settings').select(key).eq('user_id', n.user_id).maybeSingle();
    if (s && s[key] === false) return json({ ok: true, skipped: 'setting_off' });
  }

  const { data: tokens } = await db.from('push_tokens').select('token,platform,lang').eq('user_id', n.user_id);
  if (!tokens || !tokens.length) return json({ ok: true, skipped: 'no_tokens' });

  let actor = '';
  if (n.actor_id) {
    const { data: a } = await db.from('profiles').select('name,handle').eq('id', n.actor_id).maybeSingle();
    actor = (a && (a.name || (a.handle && '@' + a.handle))) || '';
  }
  if (!actor) actor = 'FLYP';

  let sent = 0, removed = 0; const errors: string[] = [];
  for (const t of tokens) {
    const lang = t.lang === 'en' ? 'en' : 'ar';
    const msg = compose(n as Row, actor, lang);
    if (!msg) return json({ ok: true, skipped: 'type_not_pushed:' + n.type });
    const data = { route: msg.route, notification_id: n.id, type: n.type };
    let r: true | 'dead' | string;
    try {
      if (t.platform === 'android') r = FCM_SA ? await sendFcm(t.token, msg.title, msg.body, data) : 'fcm not configured';
      else if (t.platform === 'ios') r = (APNS_KEY_P8 && APNS_KEY_ID && APNS_TEAM_ID) ? await sendApns(t.token, msg.title, msg.body, data) : 'apns not configured';
      else r = 'web: no channel';
    } catch (e) { r = String((e as Error)?.message || e); }
    if (r === true) sent++;
    else if (r === 'dead') { removed++; await db.from('push_tokens').delete().eq('token', t.token); }
    else errors.push(t.platform + ': ' + r);
  }
  if (errors.length) console.warn('send-push', n.id, errors.join(' | '));
  return json({ ok: true, sent, removed, errors });
});
