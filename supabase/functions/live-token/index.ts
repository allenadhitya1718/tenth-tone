// =============================================================
// live-token
//
// Lives on FLYP's own LiveKit server (infra/live-server). The LiveKit
// counterpart of agora-token's live-stream branch, with the same rules:
//
//   POST { liveId, role: 'audience' | 'host' }
//     A token to join the live. The stream is read AS THE USER, so RLS
//     ("live read": privacy, blocks) decides whether they may see it, and it
//     must be live. A 'host' (publisher) token only for the stream's host or
//     a guest the host accepted on stage (live_guests status 'accepted').
//     Publishing is limited to the microphone, plus the camera when
//     LIVEKIT_VIDEO is "1". Listeners cannot publish anything, including data.
//
//   POST { liveId, action: 'revoke', userId }
//     The HOST takes a guest off the air: LiveKit itself stops their
//     publishing at once (with Agora this was only enforced by the guest's
//     own app). Called by the host's app after removing or muting a guest.
//
// identity = the account id (never a name: no personal data in LiveKit).
// Tokens last one hour. Rate limit: edge_rate_take (0120), bucket
// 'live_token', 600 an hour / 3000 a day per account; fails CLOSED.
//
// Secrets (Supabase -> Edge Functions -> Secrets), set by the owner:
//   LIVEKIT_URL         wss://live.flyp-sa.com
//   LIVEKIT_API_KEY     from /opt/flyp-live/.env on the live server
//   LIVEKIT_API_SECRET  same
//   LIVEKIT_VIDEO       optional, "1" to allow camera publishing
// =============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { AccessToken, RoomServiceClient, TrackSource } from 'npm:livekit-server-sdk@2.19.2';

const URL_WS = Deno.env.get('LIVEKIT_URL') ?? '';
const KEY = Deno.env.get('LIVEKIT_API_KEY') ?? '';
const SECRET = Deno.env.get('LIVEKIT_API_SECRET') ?? '';
const VIDEO = Deno.env.get('LIVEKIT_VIDEO') === '1';
const TTL_SECONDS = 3600;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The Room API speaks HTTPS to the same server the app reaches over wss.
const httpUrl = () => URL_WS.replace(/^ws(s?):\/\//, 'http$1://');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!URL_WS || !KEY || !SECRET) return json({ error: 'live server not configured' }, 503);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'not signed in' }, 401);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'not signed in' }, 401);
  const userId = userData.user.id;

  let body: { liveId?: string; role?: string; action?: string; userId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  const liveId = String(body.liveId ?? '');
  if (!UUID_RE.test(liveId)) return json({ error: 'bad live id' }, 400);

  // ---- per-account rate limit (0120), fails closed ----
  {
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!SERVICE_KEY) return json({ error: 'rate limit unavailable' }, 503);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY, { auth: { persistSession: false } });
    const { error: rateErr } = await admin.rpc('edge_rate_take', {
      p_user_id: userId,
      p_bucket: 'live_token',
      p_per_hour: 600,
      p_per_day: 3000,
    });
    if (rateErr) {
      if (rateErr.code === '23514') return json({ error: 'too many token requests' }, 429);
      console.error('[live-token] rate limit unavailable:', rateErr.code, rateErr.message);
      return json({ error: 'rate limit unavailable' }, 503);
    }
  }

  // ---- the stream, read as the user (RLS: privacy, blocks) ----
  const { data: stream, error: streamErr } = await supabase
    .from('live_streams')
    .select('id, host_id, status')
    .eq('id', liveId)
    .maybeSingle();
  if (streamErr) return json({ error: 'could not check the stream' }, 500);
  if (!stream || stream.status !== 'live') return json({ error: 'this stream is not available' }, 403);

  // ---- host takes a guest off the air ----
  if (body.action === 'revoke') {
    if (stream.host_id !== userId) return json({ error: 'only the host can do this' }, 403);
    const target = String(body.userId ?? '');
    if (!UUID_RE.test(target) || target === userId) return json({ error: 'bad user' }, 400);
    const rooms = new RoomServiceClient(httpUrl(), KEY, SECRET);
    try {
      await rooms.updateParticipant(liveId, target, undefined, {
        canPublish: false,
        canSubscribe: true,
        canPublishData: false,
      });
    } catch (e) {
      // Not in the room (already left): nothing to take off the air.
      const msg = (e as Error)?.message ?? '';
      if (!/not.?found|does not exist/i.test(msg)) {
        console.error('[live-token] revoke:', msg);
        return json({ error: 'could not reach the live server' }, 502);
      }
    }
    return json({ ok: true });
  }

  // ---- a token ----
  const wantsHost = body.role === 'host';
  if (wantsHost && stream.host_id !== userId) {
    // Only status 'accepted'; RPCs are the only writers of live_guests, so a
    // viewer cannot promote themselves. Any error counts as "not a guest".
    const { data: guest, error: guestErr } = await supabase
      .from('live_guests')
      .select('status, host_muted')
      .eq('live_id', liveId)
      .eq('user_id', userId)
      .maybeSingle();
    if (guestErr || guest?.status !== 'accepted') return json({ error: 'you are not on stage in this live' }, 403);
  }

  const at = new AccessToken(KEY, SECRET, { identity: userId, ttl: TTL_SECONDS });
  at.addGrant({
    room: liveId,
    roomJoin: true,
    canSubscribe: true,
    canPublish: wantsHost,
    canPublishData: false,
    canPublishSources: wantsHost
      ? VIDEO
        ? [TrackSource.MICROPHONE, TrackSource.CAMERA]
        : [TrackSource.MICROPHONE]
      : [],
  });
  const token = await at.toJwt();
  return json({
    token,
    url: URL_WS,
    identity: userId,
    role: wantsHost ? 'host' : 'audience',
    video: VIDEO,
    expiresAt: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  });
});
