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
// issued to the account that actually owns the live stream, so nobody can
// take over someone else's channel.
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
  let role = RtcRole.SUBSCRIBER;
  if (wantsHost) {
    const { data: stream } = await supabase
      .from('live_streams')
      .select('id, host_id, status')
      .eq('id', channel)
      .maybeSingle();

    if (!stream || stream.host_id !== userId) {
      return json({ error: 'you are not the host of this stream' }, 403);
    }
    role = RtcRole.PUBLISHER;
  }

  const expireAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const token = RtcTokenBuilder.buildTokenWithUid(
    APP_ID, APP_CERT, channel, uid, role, expireAt, expireAt,
  );

  return json({ token, uid, channel, expiresAt: expireAt, role: wantsHost ? 'host' : 'audience' });
});
