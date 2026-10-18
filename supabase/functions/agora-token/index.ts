// =============================================================
// agora-token
//
// Signs a short-lived Agora RTC token so the App Certificate never
// reaches the browser. Without this the client joins with token: null
// and Agora rejects it with "dynamic use static key".
//
// Secrets required (Supabase -> Edge Functions -> Secrets):
//   AGORA_APP_ID           the same 32 character id used in the client
//   AGORA_APP_CERTIFICATE  the primary certificate. Never ships to a browser.
//
// The caller must be a signed-in user. A host token (publisher) is only
// issued to the account that actually owns the live stream, or to a guest
// the host accepted on stage (live_guests, 0103), so nobody can take over
// someone else's channel.
//
// Walkie-talkie channels ('walkie_<chat id>', client note 26) are private to
// the chat: any token, listener or talker, needs walkie_allowed (0106).
//
// Security review 2026-10 (F07). An AUDIENCE token used to be handed out for
// any channel string at all, so anyone signed in could listen in on a 1:1 or
// group call ('call_*'), or on a private / friends-only / blocked live. Now
// every token, either role, is checked:
//   call_*  : the caller must be a member of the channel who is in it or being
//             rung (call_members 'joined' / 'ringing'), or, for a call from
//             before 0092, the caller or callee of a call still ringing or
//             accepted. Channels are generated server-side since 0114.
//   live    : the stream is read AS THE USER, so RLS ("live read": privacy,
//             blocks) decides whether they may see it, and it must be 'live'.
//   walkie  : unchanged (walkie_allowed).
// uid: ALWAYS derived by the server from the account (uidFor, the same
// FNV-1a hash as the app's agoraUidFor) and returned in the answer. Whatever
// uid the client sends is ignored, so nobody can take another person's uid in
// a channel (Agora ejects the earlier holder of a uid) or ask for uid 0, the
// wildcard that is valid for every uid. The app joins with the returned uid.
// Rate limit: edge_rate_take (0120), per account, 600 an hour / 3000 a day.
// Fails CLOSED: if the limit cannot be checked (0120 missing, database
// error), no token is signed (503).
// =============================================================
import { RtcTokenBuilder, RtcRole } from 'npm:agora-token@2.0.5';
import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_ID = Deno.env.get('AGORA_APP_ID') ?? '';
const APP_CERT = Deno.env.get('AGORA_APP_CERTIFICATE') ?? '';

// One hour. Long enough for a stream, short enough that a leaked token
// stops working quickly.
const TTL_SECONDS = 3600;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Same as agoraUidFor() in mobile/src/features/live/config.ts: FNV-1a over the
// account id, folded into 1..2147483646. Keep the two in step.
function uidFor(userId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 2147483646) + 1;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  if (!APP_ID || !APP_CERT) {
    return json({ error: 'AGORA_APP_ID or AGORA_APP_CERTIFICATE is not set' }, 500);
  }

  // ---- who is asking ----
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'not signed in' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'not signed in' }, 401);
  const userId = userData.user.id;

  // ---- what they are asking for ----
  let body: { channel?: string; uid?: number; role?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }

  const channel = String(body.channel ?? '').trim();
  // The account's own uid, never the client's (see the header).
  const uid = uidFor(userId);
  const wantsHost = body.role === 'host';

  if (!channel || channel.length > 64) return json({ error: 'bad channel' }, 400);

  // ---- per-account rate limit (0120) ----
  {
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!SERVICE_KEY) return json({ error: 'rate limit unavailable' }, 503);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY, { auth: { persistSession: false } });
    const { error: rateErr } = await admin.rpc('edge_rate_take', {
      p_user_id: userId, p_bucket: 'agora_token', p_per_hour: 600, p_per_day: 3000,
    });
    if (rateErr) {
      // 23514: rate_limit_exceeded() (0050). Anything else (0120 not applied,
      // database trouble) refuses rather than signing unmetered.
      if (rateErr.code === '23514') return json({ error: 'too many token requests' }, 429);
      console.error('[agora-token] rate limit unavailable:', rateErr.code, rateErr.message);
      return json({ error: 'rate limit unavailable' }, 503);
    }
  }

  // ---- may they host it ----
  // The channel name is the live_streams row id, so ownership is checkable.
  // An audience token is safe for any signed-in user; a publisher token is
  // not, because it would let someone broadcast into another person's stream.
  // Two kinds of channel arrive here and they are not interchangeable:
  //
  //   live stream : channel IS the live_streams row id (a uuid); only the
  //                 host may publish.
  //   1:1 call    : channel is calls.channel, a 'call_<random>' string that is
  //                 not a uuid and has no live_streams row. BOTH parties
  //                 publish, so both need a publisher token.
  //
  // Checking live_streams first broke every call ever placed. Filtering a uuid
  // column by 'call_x' does not return nothing - it raises Postgres 22P02 - and
  // this code destructured only { data }, discarding the error, so `stream` came
  // back null and both sides were refused with "you are not the host of this
  // stream" before a microphone or camera was ever opened. The call screen,
  // its timer and answered_at all worked, because signalling is pure Supabase
  // and never needed the token - which is exactly why this survived testing.
  // Walkie-talkie (client note 26): 'walkie_<chat id>', one audio channel per
  // chat. Listening in on a chat is as private as reading it, so BOTH roles
  // need membership here, not only the publisher. walkie_allowed (0106) also
  // refuses an unanswered message request and a blocked DM. Before 0106 is
  // applied the RPC does not exist; fall back to plain membership
  // (is_chat_member, 0018) rather than refusing everybody. Any other error is
  // a refusal. Members get a publisher token when they ask for 'host': the
  // app joins as audience and only switches role while the button is held.
  if (channel.startsWith('walkie_')) {
    const chatId = channel.slice('walkie_'.length);
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatId);
    if (!isUuid) return json({ error: 'unknown channel' }, 403);

    let { data: allowed, error: allowErr } = await supabase.rpc('walkie_allowed', { p_chat_id: chatId });
    if (allowErr && (allowErr.code === 'PGRST202' || allowErr.code === '42883')) {
      ({ data: allowed, error: allowErr } = await supabase.rpc('is_chat_member', { p_chat_id: chatId }));
    }
    if (allowErr) return json({ error: 'could not check the chat' }, 500);
    if (allowed !== true) return json({ error: 'you are not a member of this chat' }, 403);

    const expireAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;
    const token = RtcTokenBuilder.buildTokenWithUid(
      APP_ID, APP_CERT, channel, uid, wantsHost ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER, expireAt, expireAt,
    );
    return json({ token, uid, channel, expiresAt: expireAt, role: wantsHost ? 'host' : 'audience' });
  }

  let role = RtcRole.SUBSCRIBER;

  if (!UUID_RE.test(channel)) {
    // ---- a call ----
    // RLS on `calls` returns the rows of this channel the requester may see:
    // their own call, or - since 0092 - any call of a channel they are a
    // member of. A channel can carry several rows (the call, plus an invite
    // row per person added), so ALL of them are read.
    //
    // Any token for a call, listener or speaker, needs the requester to be IN
    // it: a call_members row that is 'joined' (or 'ringing', so the callee can
    // sign while the phone rings), or - for a call from before 0092, which has
    // no membership rows - the caller or callee of a call still ringing or
    // accepted. Ended, declined, missed and left all count as out.
    const { data: rows, error: callErr } = await supabase
      .from('calls')
      .select('id, caller_id, callee_id, status')
      .eq('channel', channel);
    if (callErr) return json({ error: 'could not check the call' }, 500);
    if (!rows || !rows.length) return json({ error: 'unknown channel' }, 403);

    const { data: members, error: memberErr } = await supabase
      .from('call_members')
      .select('user_id, status')
      .eq('channel', channel);
    if (memberErr) return json({ error: 'could not check the call' }, 500);

    let inCall: boolean;
    if (members && members.length) {
      inCall = members.some((m) => m.user_id === userId && (m.status === 'joined' || m.status === 'ringing'));
    } else {
      inCall = rows.some(
        (c) => (c.caller_id === userId || c.callee_id === userId) && (c.status === 'ringing' || c.status === 'accepted'),
      );
    }
    if (!inCall) return json({ error: 'you are not a party to this call' }, 403);
    // Both sides of a call speak.
    role = wantsHost ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
  } else {
    // ---- a live stream ----
    // Read as the user: "live read" (0004, 0119) decides whether they may see
    // it at all (privacy, blocks). A stream they cannot see answers 403 for
    // either role, and so does one that is not live any more.
    const { data: stream, error: streamErr } = await supabase
      .from('live_streams')
      .select('id, host_id, status')
      .eq('id', channel)
      .maybeSingle();
    if (streamErr) return json({ error: 'could not check the stream' }, 500);
    if (!stream || stream.status !== 'live') return json({ error: 'this stream is not available' }, 403);

    if (wantsHost) {
      if (stream.host_id !== userId) {
        // Client note 6 (migration 0103): a guest the host brought on stage
        // speaks in the same channel, so they need a publisher token too.
        // Only status 'accepted' qualifies; RPCs are the only writers of
        // live_guests, so a viewer cannot promote themselves. Any error (for
        // example 0103 not applied yet) counts as "not a guest".
        const { data: guest, error: guestErr } = await supabase
          .from('live_guests')
          .select('status')
          .eq('live_id', channel)
          .eq('user_id', userId)
          .maybeSingle();
        const isGuest = !guestErr && guest?.status === 'accepted';
        if (!isGuest) return json({ error: 'you are not the host of this stream' }, 403);
      }
      role = RtcRole.PUBLISHER;
    }
  }

  const expireAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const token = RtcTokenBuilder.buildTokenWithUid(
    APP_ID, APP_CERT, channel, uid, role, expireAt, expireAt,
  );

  return json({ token, uid, channel, expiresAt: expireAt, role: wantsHost ? 'host' : 'audience' });
});
