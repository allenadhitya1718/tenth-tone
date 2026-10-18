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
  const uid = Number(body.uid ?? 0);
  const wantsHost = body.role === 'host';

  if (!channel || channel.length > 64) return json({ error: 'bad channel' }, 400);
  if (!Number.isInteger(uid) || uid < 0) return json({ error: 'bad uid' }, 400);

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
  if (wantsHost) {
    // RLS on `calls` returns the rows of this channel the requester may see:
    // their own call, or - since 0092 - any call of a channel they are a
    // member of. A channel can now carry several rows (the call, plus an
    // invite row per person added), so ALL of them are read: taking one at
    // random picked the root row for an added person, who is neither its
    // caller nor its callee, and refused them with 403 - joined to the call
    // on paper, silent in the channel.
    const { data: rows, error: callErr } = await supabase
      .from('calls')
      .select('id, caller_id, callee_id')
      .eq('channel', channel);
    if (callErr) return json({ error: 'could not check the call' }, 500);

    if (rows && rows.length) {
      const party = rows.some((c) => c.caller_id === userId || c.callee_id === userId);
      if (!party) {
        // Visible only through membership: confirm it explicitly rather than
        // trust the read policy alone.
        const { data: member } = await supabase
          .from('call_members')
          .select('user_id')
          .eq('channel', channel)
          .eq('user_id', userId)
          .maybeSingle();
        if (!member) return json({ error: 'you are not a party to this call' }, 403);
      }
      role = RtcRole.PUBLISHER;
    } else {
      // Not a call, so it must be a live stream. Guard the SHAPE before asking,
      // or a non-uuid channel raises 22P02 instead of answering "no".
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(channel);
      if (!isUuid) return json({ error: 'unknown channel' }, 403);

      const { data: stream } = await supabase
        .from('live_streams')
        .select('id, host_id, status')
        .eq('id', channel)
        .maybeSingle();

      if (!stream) return json({ error: 'you are not the host of this stream' }, 403);

      if (stream.host_id !== userId) {
        // Client note 6 (migration 0103): a guest the host brought on stage
        // speaks in the same channel, so they need a publisher token too.
        // Only status 'accepted' qualifies, and only while the stream is live;
        // RPCs are the only writers of live_guests, so a viewer cannot promote
        // themselves. Any error (for example 0103 not applied yet) counts as
        // "not a guest" and keeps the old 403.
        let isGuest = false;
        if (stream.status === 'live') {
          const { data: guest, error: guestErr } = await supabase
            .from('live_guests')
            .select('status')
            .eq('live_id', channel)
            .eq('user_id', userId)
            .maybeSingle();
          isGuest = !guestErr && guest?.status === 'accepted';
        }
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
