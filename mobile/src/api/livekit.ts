// LiveKit tokens for lives on FLYP's own server (supabase/functions/live-token).
// The counterpart of fetchAgoraToken for lives whose engine is 'livekit'
// (0166). Same rules: anyone who may see the live gets a listener token; the
// host and guests the host accepted on stage get a speaker ('host') token.
//
// ApiError codes:
//   live_bad_request   400
//   live_forbidden     403: cannot see the live, or not on stage
//   live_unavailable   anything else (server not set up, network, 5xx, 429)
//   live_no_token      the function answered without a token
// (401 maps to 'not_signed_in', like the rest of the app.)
import { ApiError, supabase } from './client';

export type LiveKitRole = 'host' | 'audience';

export type LiveKitToken = {
  token: string;
  url: string;
  identity: string;
  role: LiveKitRole;
  /** Camera publishing allowed on this server (LIVEKIT_VIDEO). */
  video: boolean;
  /** Unix seconds. */
  expiresAt: number;
};

type FunctionsErrorLike = { message?: string; context?: Response };

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('live-token', { body });
  if (error) {
    const ctx = (error as FunctionsErrorLike).context;
    let detail = '';
    try {
      detail = ((await ctx?.json()) as { error?: string } | undefined)?.error ?? '';
    } catch {}
    const status = ctx?.status ?? 0;
    const code =
      status === 401
        ? 'not_signed_in'
        : status === 400
          ? 'live_bad_request'
          : status === 403
            ? 'live_forbidden'
            : 'live_unavailable';
    throw new ApiError(code, detail || (error as FunctionsErrorLike).message || 'live server unavailable');
  }
  if (!data) throw new ApiError('live_no_token', 'empty answer');
  return data;
}

export async function fetchLiveKitToken(liveId: string, role: LiveKitRole): Promise<LiveKitToken> {
  const t = await call<LiveKitToken>({ liveId, role });
  if (!t.token || !t.url) throw new ApiError('live_no_token', 'no token in the answer');
  return t;
}

/**
 * The host takes a guest off the air on the server itself: LiveKit stops
 * their publishing at once, whatever their app does. Call after removing or
 * muting a guest. Best effort for the caller: the guest's own app also stops.
 */
export async function revokeLiveSpeaker(liveId: string, userId: string): Promise<void> {
  await call<{ ok: boolean }>({ liveId, action: 'revoke', userId });
}
