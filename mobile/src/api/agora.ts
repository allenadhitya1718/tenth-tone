// Agora RTC token request. Port of fetchToken() in web/js/agora.js; the
// session logic (join, publish, mirror, prewarm) is NOT ported, the RN app
// uses react-native-agora for that.
//
// The agora-token Edge Function signs a one-hour token so the App
// Certificate never ships in the app. Two kinds of channel reach it:
//   live stream : channel is the live_streams row id; its host, and a guest
//                 whose live_guests row is 'accepted' while the stream is live
//                 (0103), get a publisher ('host') token; anyone signed in
//                 gets 'audience'
//   1:1 call    : channel is calls.channel ('call_<random>'); every party
//                 and call member gets a publisher token
// A token is bound to one uid and Agora rejects a mismatch. The server signs
// every token for the ACCOUNT's own uid (agoraUidFor in features/live/config,
// the same hash) and ignores the uid sent here, so nobody can borrow someone
// else's uid and eject them. Join with the `uid` in the answer. The uid
// parameter is still sent for older servers.
//
// 429 (too many token requests) and 503 (rate limit could not be checked)
// arrive as agora_unavailable.
//
// Client note 6: an accepted guest asks for role 'host' with the stream id
// as the channel, exactly as the host does; nothing else changes here. Ask
// again after the guest's row becomes 'accepted' (an earlier 'host' request
// gets 403 'agora_forbidden'), and switch back to 'audience' when it leaves.
// TODO(client note 26): walkie moves to an Agora audio channel, which will
// need its own channel kind on the server.
//
// ApiError codes introduced in this file:
//   agora_bad_request   400: empty or over-long channel, bad uid, bad body
//   agora_forbidden     403: not the host of the stream / not a party to the
//                       call / unknown channel
//   agora_unavailable   any other failure (secrets not set, network, 5xx)
//   agora_no_token      the function answered without a token
// (401 maps to 'not_signed_in', the code client.ts uses.)
import { ApiError, supabase } from './client';

export type AgoraRole = 'host' | 'audience';

export type AgoraToken = {
  token: string;
  uid: number;
  channel: string;
  /** Unix seconds. */
  expiresAt: number;
  role: AgoraRole;
};

type FunctionsErrorLike = { message?: string; context?: Response };

export async function fetchAgoraToken(channel: string, uid: number, role: AgoraRole): Promise<AgoraToken> {
  const { data, error } = await supabase.functions.invoke<AgoraToken>('agora-token', {
    body: { channel: String(channel), uid, role },
  });
  if (error) {
    // The function returns a readable reason in the body; the SDK only says
    // "non-2xx status code".
    const ctx = (error as FunctionsErrorLike).context;
    let detail = '';
    try {
      detail = ((await ctx?.json()) as { error?: string } | undefined)?.error ?? '';
    } catch {}
    const status = ctx?.status ?? 0;
    const message = detail || (error as FunctionsErrorLike).message || 'could not get a live token';
    const code =
      status === 401
        ? 'not_signed_in'
        : status === 400
          ? 'agora_bad_request'
          : status === 403
            ? 'agora_forbidden'
            : 'agora_unavailable';
    throw new ApiError(code, message, { status });
  }
  if (!data?.token) throw new ApiError('agora_no_token', 'token service returned nothing');
  return data;
}
