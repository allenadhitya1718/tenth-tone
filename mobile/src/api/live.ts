// Live streams: the stream rows, viewer count, comments, reactions, the cover
// image, and the (deprecated) walkie channel. Port of the live section and
// openWalkieChannel in web/js/db.js.
//
// Channel names and broadcast events match db.js exactly, so the web app and
// this app see each other's reactions and walkie traffic.
//
// TODO(client note 4): live streams become audio-only. 0103 already assumes
// it (a guest is another voice in the channel); the cover image and any
// camera-only fields may go when the screens drop video.
// Client note 6: guests on stage. 0103 adds live_guests and six RPCs (the
// "Guests" section below); agora-token gives an accepted guest a publisher
// ('host') token. Not applied to any database yet: until it is, every guest
// call fails with 'live_guests_unavailable'.
// Client note 17: live gifts live in ./gifts (send_gift as amended by 0104,
// and the realtime feed of gifts sent in a stream).
// Screening (./moderation) covers the title, the cover and each comment. The
// video itself cannot be screened; a running stream is covered by reports and
// the admin kill switch.
//
// ApiError codes introduced in this file:
//   empty_comment      postLiveComment with nothing but whitespace
//   comment_too_long   postLiveComment over 500 characters (the column limit)
//   live_guests_unavailable  a guest RPC or live_guests is missing (0103 not
//                      applied)
//   The guest RPCs pass the server's own short codes through unchanged:
//   not_signed_in, live_not_found, live_not_live, not_host, host_is_you,
//   blocked, not_watching, stage_full, removed_by_host, too_soon,
//   no_invitation, no_request, not_on_stage (see LiveGuestErrorCode).
// Shared codes also thrown here: 'not_signed_in' (requireUid) and
// 'content_blocked' (a refused title or cover; the message is the server's
// Arabic text), the same code videos.ts uses.
import type {
  PostgrestError,
  RealtimePostgresChangesPayload,
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
} from '@supabase/supabase-js';

import { ApiError, must, requireUid, supabase, uid, listenerTopic } from './client';
import { attach, checkImage, checkText, type Verdict } from './moderation';
import { asCommentError } from './comments';
import type { Iso, Unsubscribe, UserSummary, Uuid } from './types';
import { type LocalMedia, uploadToR2, uploadToStorage } from './upload';

export const liveKeys = {
  list: () => ['live'] as const,
  stream: (id: string) => ['live', id] as const,
  comments: (id: string) => ['live', id, 'comments'] as const,
  guests: (id: string) => ['live', id, 'guests'] as const,
  topGifters: (id: string) => ['live', id, 'topGifters'] as const,
};

export type LiveStatus = 'live' | 'ended' | 'banned';
// Live streams say 'friends' where videos say 'followers'.
export type LivePrivacy = 'public' | 'friends' | 'private';

// public.live_streams as stored.
export type LiveStreamRow = {
  id: Uuid;
  host_id: Uuid;
  title: string | null;
  thumbnail: string | null;
  viewer_count: number;
  viewer_count_max: number;
  status: LiveStatus;
  privacy: LivePrivacy;
  started_at: Iso;
  ended_at: Iso | null;
};

// The list card reads host.avatar while the stream screen reads
// host.avatar_url, so both names are returned.
export type LiveHost = {
  id: Uuid;
  name: string | null;
  handle: string | null;
  avatar_url: string | null;
  avatar: string | null;
};

export type LiveStreamSummary = {
  id: Uuid;
  title: string | null;
  thumbnail: string | null;
  viewer_count: number;
  status: LiveStatus;
  started_at: Iso;
  host: LiveHost | null;
};

export type LiveStream = LiveStreamSummary & { ended_at: Iso | null };

type HostRow = Pick<UserSummary, 'id' | 'name' | 'handle' | 'avatar_url'>;

export type LiveComment = {
  id: Uuid;
  text: string;
  created_at: Iso;
  user: HostRow | null;
};

// public.live_comments as stored (what the realtime INSERT carries).
export type LiveCommentRow = {
  id: Uuid;
  live_stream_id: Uuid;
  user_id: Uuid;
  text: string;
  created_at: Iso;
};

function shapeHost(p: HostRow | null | undefined): LiveHost | null {
  if (!p) return null;
  return { id: p.id, name: p.name, handle: p.handle, avatar_url: p.avatar_url, avatar: p.avatar_url };
}

// ---------- Viewer count and stream status ----------
// All three fail soft: without 0046 the stream still plays, the count just
// stays where it started.

// Returns the new viewer count.
export async function joinLiveStream(liveId: Uuid): Promise<number> {
  try {
    const { data } = await supabase.rpc('join_live_stream', { p_live_id: liveId });
    return (data as number | null) || 0;
  } catch (e) {
    console.warn('joinLiveStream (is 0046 applied?):', e);
    return 0;
  }
}

export async function leaveLiveStream(liveId: Uuid): Promise<number> {
  try {
    const { data } = await supabase.rpc('leave_live_stream', { p_live_id: liveId });
    return (data as number | null) || 0;
  } catch {
    return 0;
  }
}

// The host's "still here" signal (0126). Sent every 30 s while live and when
// the app returns to the foreground; a live with no beat for 90 s is ended by
// the server (end_stale_lives), with the same triggers as tapping End. The
// server ignores a beat < 15 s after the last one. Returns the stream's status
// ('ended' if it was swept while the app was away), or null when the call
// failed (offline, 0126 not applied) - fail soft, the next beat retries.
export async function liveHeartbeat(liveId: Uuid): Promise<LiveStatus | null> {
  try {
    const { data, error } = await supabase.rpc('live_heartbeat', { p_live_id: liveId });
    if (error) return null;
    return (data as LiveStatus | null) ?? null;
  } catch {
    return null;
  }
}

// Watches the stream row itself, so the viewer count moves and viewers are
// told when the host ends the broadcast instead of staring at a frozen frame.
export function subscribeToLiveStream(liveId: Uuid, cb: (row: LiveStreamRow) => void): Unsubscribe {
  const channel = supabase
    .channel(listenerTopic('live:one:' + liveId))
    .on<LiveStreamRow>(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'live_streams', filter: `id=eq.${liveId}` },
      (payload: RealtimePostgresUpdatePayload<LiveStreamRow>) => cb(payload.new),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

// ---------- Live reactions ----------
// Deliberately NOT stored: a heart is worth something for the two seconds it
// floats up and nothing afterwards, and a table would mean a write per tap.
// Sent over a realtime broadcast channel instead: ephemeral, no migration or
// RLS. `self: false` because the tap already floats a heart locally; echoing
// it back would double every one.

const DEFAULT_REACTION = '❤️'; // red heart, the same default as the web app

export type LiveReactions = {
  send: (emoji?: string) => Promise<void>;
  unsubscribe: Unsubscribe;
};

export async function joinLiveReactions(
  liveId: Uuid,
  onReaction: (emoji: string) => void,
): Promise<LiveReactions> {
  const ch = supabase.channel('live:react:' + liveId, { config: { broadcast: { self: false } } });
  ch.on('broadcast', { event: 'react' }, (msg: { payload?: { emoji?: unknown } }) => {
    const p = msg?.payload ?? {};
    // Capped: it arrives from another client and is shown as text.
    const emoji = typeof p.emoji === 'string' ? p.emoji.slice(0, 8) : DEFAULT_REACTION;
    try {
      onReaction(emoji);
    } catch {}
  });
  await new Promise<void>((resolve) => {
    let settled = false;
    ch.subscribe((status) => {
      if (settled) return;
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        settled = true;
        resolve();
      }
    });
    // Never leave the caller waiting on a channel that will not come up.
    setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve();
      }
    }, 6000);
  });
  return {
    send: async (emoji) => {
      try {
        await ch.send({
          type: 'broadcast',
          event: 'react',
          payload: { emoji: String(emoji || DEFAULT_REACTION).slice(0, 8) },
        });
      } catch {}
    },
    unsubscribe: () => {
      void supabase.removeChannel(ch);
    },
  };
}

// ---------- Live comments ----------

// New comments as raw rows (no joined user); the screen looks the author up.
export function subscribeToLiveComments(
  liveStreamId: Uuid,
  cb: (row: LiveCommentRow) => void,
): Unsubscribe {
  const ch = supabase
    .channel(listenerTopic('live-comments-' + liveStreamId))
    .on<LiveCommentRow>(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'live_comments',
        filter: `live_stream_id=eq.${liveStreamId}`,
      },
      (payload: RealtimePostgresInsertPayload<LiveCommentRow>) => cb(payload.new),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}

// Oldest first, so the chat reads top to bottom the way it is rendered.
// Only the tail matters on a busy stream.
export async function fetchLiveComments(liveStreamId: Uuid, limit = 40): Promise<LiveComment[]> {
  const data = must(
    await supabase
      .from('live_comments')
      .select('id, text, created_at, user:profiles!live_comments_user_id_fkey (id, name, handle, avatar_url)')
      .eq('live_stream_id', liveStreamId)
      .order('created_at', { ascending: false })
      .limit(limit),
  ) as unknown as LiveComment[] | null;
  return (data ?? []).reverse();
}

// onWithdrawn replaces the web toast: it runs if screening later blocks the
// comment and the row is deleted, so the screen can drop the line and tell
// the author (message is the server's Arabic text, or null).
export async function postLiveComment(
  liveStreamId: Uuid,
  text: string,
  onWithdrawn?: (id: Uuid, message: string | null) => void,
): Promise<Pick<LiveCommentRow, 'id' | 'text' | 'created_at'>> {
  const me = await requireUid();
  const body = String(text || '').trim();
  if (!body) throw new ApiError('empty_comment');
  // Matches the column constraint, so an over-long comment fails here with a
  // readable message instead of a database error.
  if (body.length > 500) throw new ApiError('comment_too_long');

  // Screened ALONGSIDE the insert, never in front of it: a two-second pause
  // between send and seeing your line is unusable in a scrolling live chat.
  // Blockable but never queued for review: live chat arrives in bursts and
  // would bury the reports that matter.
  const screening = checkText('live_comment', body).catch(() => null);

  const res = await supabase
    .from('live_comments')
    .insert({ live_stream_id: liveStreamId, user_id: me, text: body })
    .select('id, text, created_at')
    .single<Pick<LiveCommentRow, 'id' | 'text' | 'created_at'>>();
  // The server's word filter (0135) refuses with 'comment_blocked'.
  if (res.error) throw asCommentError(res.error);
  const data = res.data as Pick<LiveCommentRow, 'id' | 'text' | 'created_at'>;

  void screening.then(async (verdict) => {
    if (!verdict?.blocked || !data?.id) return;
    try {
      await supabase.from('live_comments').delete().eq('id', data.id);
    } catch (e) {
      console.warn('[Moderation] could not withdraw live_comments', data.id, (e as Error)?.message);
    }
    try {
      onWithdrawn?.(data.id, verdict.message);
    } catch {}
  });
  return data;
}

// ---------- Cover image ----------
// Without a cover a stream showed as a blank tile in the live grid. The screen
// grabs a frame from the host's own preview the moment they go live and
// passes it here as a local JPEG.
//
// Filed under the videos bucket because its policy is exactly what is needed:
// public read, writes only under the uploader's own id. Any failure returns
// null rather than throwing: a missing cover must never stop somebody going
// live.
export async function uploadLiveThumbnail(media: LocalMedia | null | undefined): Promise<string | null> {
  if (!media) return null;
  // Screened before upload, and a refusal THROWS rather than returning null:
  // "the server said no" is not "the service is broken". The caller catches
  // it and goes live without a cover, so the image is never stored and nobody
  // is stopped from broadcasting.
  const verdict = await checkImage('live_cover', media);
  if (verdict.blocked) throw new ApiError('content_blocked', verdict.message ?? undefined);

  try {
    const me = await uid();
    if (!me) return null;
    const jpeg: LocalMedia = { ...media, mimeType: 'image/jpeg' };
    try {
      return await uploadToR2(jpeg);
    } catch (e) {
      // Only an unreachable upload service falls back to Storage, as in db.js
      // where uploadMedia() returned null. A refusal or a failed PUT does not.
      if (!(e instanceof ApiError) || e.code !== 'upload_unavailable') throw e;
    }
    return await uploadToStorage('videos', jpeg, { prefix: 'live' });
  } catch (e) {
    console.warn('live thumbnail:', (e as Error)?.message);
    return null;
  }
}

// ---------- Streams ----------

export type StartLiveInput = {
  title?: string | null;
  thumbnail?: string | null;
  privacy?: LivePrivacy | string;
};

// privacy MUST be sent. It once was not (the chooser's answer never reached
// the database), so every stream was public, including ones the host had set
// to Private, and visible even to signed-out visitors.
export async function startLive({
  title,
  thumbnail,
  privacy = 'public',
}: StartLiveInput): Promise<LiveStreamRow> {
  const me = await requireUid();
  // Guard the value: an unknown string would fail the check constraint and
  // lose the broadcast, and defaulting a typo to 'public' is the wrong way to
  // fail for a privacy setting.
  const p = ['public', 'friends', 'private'].includes(privacy) ? privacy : 'private';

  // The title is the one part of a stream screened up front (the cover was
  // screened in uploadLiveThumbnail).
  let verdict: Verdict | null = null;
  if (title) {
    verdict = await checkText('live_title', title);
    if (verdict.blocked) throw new ApiError('content_blocked', verdict.message ?? undefined);
  }

  const data = must(
    await supabase
      .from('live_streams')
      .insert({ host_id: me, title, thumbnail, status: 'live', privacy: p })
      .select()
      .single<LiveStreamRow>(),
  ) as LiveStreamRow;
  if (verdict && data?.id) void attach(verdict, 'live_stream', data.id);
  return data;
}

export async function endLive(id: Uuid): Promise<void> {
  must(
    await supabase
      .from('live_streams')
      .update({ status: 'ended', ended_at: new Date().toISOString() })
      .eq('id', id),
  );
}

type LiveStreamQueryRow = Omit<LiveStream, 'host'> & { host: HostRow | null };

// Live now, busiest first.
export async function fetchLiveStreams(): Promise<LiveStreamSummary[]> {
  const data = must(
    await supabase
      .from('live_streams')
      .select(
        'id, title, thumbnail, viewer_count, status, started_at, host:profiles!live_streams_host_id_fkey (id, name, handle, avatar_url)',
      )
      .eq('status', 'live')
      .order('viewer_count', { ascending: false })
      .limit(60),
  ) as unknown as Omit<LiveStreamQueryRow, 'ended_at'>[] | null;
  return (data ?? []).map((r) => ({ ...r, host: shapeHost(r.host) }));
}

export async function fetchLiveStream(id: Uuid): Promise<LiveStream | null> {
  const data = must(
    await supabase
      .from('live_streams')
      .select(
        'id, title, thumbnail, viewer_count, status, started_at, ended_at, host:profiles!live_streams_host_id_fkey (id, name, handle, avatar_url)',
      )
      .eq('id', id)
      .maybeSingle(),
  ) as unknown as LiveStreamQueryRow | null;
  if (!data) return null;
  return { ...data, host: shapeHost(data.host) };
}

// ---------- Guests on stage (client note 6, migration 0103) ----------
// A client never writes live_guests; six SECURITY DEFINER RPCs move a row
// between states and each returns the new status. Who may do what:
//   viewer : requestToJoinLive, respondLiveInvite, leaveLiveStage
//   host   : inviteToLive, approveLiveGuest, removeLiveGuest
// At most 4 guests are 'accepted' at once. inviteToLive only works on someone
// who is WATCHING (a live_viewers row), so viewers must keep calling
// joinLiveStream when they open a stream.
//
// When a viewer's own row becomes 'accepted' the screen asks fetchAgoraToken
// for role 'host' and republishes audio; when it leaves 'accepted' (removed,
// left, or the stream ended) it must drop back to the audience role at once:
// the publisher token it holds stays valid until it expires.

export type LiveGuestStatus = 'requested' | 'invited' | 'accepted' | 'removed' | 'left';

// The short messages the RPCs raise. Screens translate them by code.
export type LiveGuestErrorCode =
  | 'not_signed_in'
  | 'live_not_found'
  | 'live_not_live'
  | 'not_host'
  | 'host_is_you'
  | 'blocked'
  | 'not_watching'
  | 'stage_full'
  | 'removed_by_host'
  | 'too_soon'
  | 'no_invitation'
  | 'no_request'
  | 'not_on_stage'
  | 'not_connected'
  | 'cannot_see_live'
  | 'invite_limit';

const LIVE_GUEST_ERRORS: readonly string[] = [
  'not_signed_in',
  'live_not_found',
  'live_not_live',
  'not_host',
  'host_is_you',
  'blocked',
  'not_watching',
  'stage_full',
  'removed_by_host',
  'too_soon',
  'no_invitation',
  'no_request',
  'not_on_stage',
  'not_connected',
  'cannot_see_live',
  'invite_limit',
] satisfies readonly LiveGuestErrorCode[];

// public.live_guests as stored (what realtime carries).
export type LiveGuestRow = {
  live_id: Uuid;
  user_id: Uuid;
  status: LiveGuestStatus;
  created_at: Iso;
  updated_at: Iso;
  /** 0159: the host muted this guest; their app keeps the mic off. */
  host_muted?: boolean;
};

export type LiveGuest = LiveGuestRow & { user: UserSummary | null };

// 'raise exception' arrives as Postgres P0001 with the text as the message,
// so the message IS the code. A missing function or table means 0103 is not
// applied. Anything else is passed through as the raw error.
function liveGuestError(error: PostgrestError): Error {
  const msg = (error.message || '').trim();
  if (LIVE_GUEST_ERRORS.includes(msg)) return new ApiError(msg, msg, error);
  if (
    error.code === 'PGRST202' ||
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    error.code === '42883'
  ) {
    return new ApiError('live_guests_unavailable', 'live guests are not available yet', error);
  }
  return error as unknown as Error;
}

async function guestRpc(fn: string, args: Record<string, unknown>): Promise<LiveGuestStatus> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw liveGuestError(error);
  return data as LiveGuestStatus;
}

// Viewer asks to speak. Returns 'requested', or 'accepted' if the host had
// already invited them (asking while invited is accepting).
export function requestToJoinLive(liveId: Uuid): Promise<LiveGuestStatus> {
  return guestRpc('request_to_join_live', { p_live_id: liveId });
}

// Host invites a viewer. Returns 'invited', or 'accepted' if that viewer had
// already asked.
export function inviteToLive(liveId: Uuid, userId: Uuid): Promise<LiveGuestStatus> {
  return guestRpc('invite_to_live', { p_live_id: liveId, p_user_id: userId });
}

// Invitee accepts ('accepted') or declines ('left').
export function respondLiveInvite(liveId: Uuid, accept: boolean): Promise<LiveGuestStatus> {
  return guestRpc('respond_live_invite', { p_live_id: liveId, p_accept: accept });
}

// Host approves a request. Returns 'accepted'.
export function approveLiveGuest(liveId: Uuid, userId: Uuid): Promise<LiveGuestStatus> {
  return guestRpc('approve_live_guest', { p_live_id: liveId, p_user_id: userId });
}

// Host takes a guest off stage, withdraws an invite or turns a request down.
// Works after the stream ended too. Returns 'removed' (or the row's existing
// 'removed' / 'left').
export function removeLiveGuest(liveId: Uuid, userId: Uuid): Promise<LiveGuestStatus> {
  return guestRpc('remove_live_guest', { p_live_id: liveId, p_user_id: userId });
}

// Host mutes or unmutes a guest on stage (0159). The guest's app follows
// live_guests.host_muted and keeps its microphone off while it is set.
export async function setLiveGuestMuted(liveId: Uuid, userId: Uuid, muted: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_live_guest_muted', { p_live_id: liveId, p_user_id: userId, p_muted: muted });
  if (error) throw liveGuestError(error);
  return data as boolean;
}

export type LiveTopGifter = { user_id: Uuid; name: string | null; handle: string | null; avatar_url: string | null; coins: number };

// Who has sent the most coins in gifts during this live (0159), for the
// TikTok-style ranking. The gift read policy decides what is counted.
export async function fetchLiveTopGifters(liveId: Uuid, limit = 20): Promise<LiveTopGifter[]> {
  const { data, error } = await supabase.rpc('live_top_gifters', { p_live_id: liveId, p_limit: limit });
  if (error) throw liveGuestError(error);
  return ((data ?? []) as LiveTopGifter[]).map((r) => ({ ...r, coins: Number(r.coins) }));
}

// The guest leaves the stage, withdraws a request or declines an invite.
// Returns 'left' (or the row's existing 'removed' / 'left').
export function leaveLiveStage(liveId: Uuid): Promise<LiveGuestStatus> {
  return guestRpc('leave_live_stage', { p_live_id: liveId });
}

// Every row of the stream, oldest first, closed ones included so the host can
// tell a fresh request from one turned down a moment ago. Filter by status
// for the stage ('accepted') and the host's queue ('requested').
export async function fetchLiveGuests(liveId: Uuid): Promise<LiveGuest[]> {
  const { data, error } = await supabase
    .from('live_guests')
    .select(
      'live_id, user_id, status, created_at, updated_at, host_muted, user:profiles!live_guests_user_id_fkey (id, name, handle, avatar_url, verified)',
    )
    .eq('live_id', liveId)
    .order('created_at', { ascending: true });
  if (error) throw liveGuestError(error);
  return (data ?? []) as unknown as LiveGuest[];
}

// Inserts and updates on the stream's stage, as raw rows (no joined user):
// the screen looks a newcomer up, or refetches fetchLiveGuests. The table has
// replica identity full, so an UPDATE carries every column. live_guests is
// never deleted from by clients; a DELETE (the stream row deleted) is skipped.
export function subscribeToLiveGuests(liveId: Uuid, cb: (row: LiveGuestRow) => void): Unsubscribe {
  const ch = supabase
    .channel(listenerTopic('live-guests-' + liveId))
    .on<LiveGuestRow>(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'live_guests', filter: `live_id=eq.${liveId}` },
      (payload: RealtimePostgresChangesPayload<LiveGuestRow>) => {
        if (payload.eventType === 'DELETE') return;
        cb(payload.new);
      },
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}

// ---------- Walkie-talkie (DEPRECATED) ----------
// DEPRECATED: do not build new screens on this. It broadcasts recorder chunks
// (WebM on the web) as base64 over a realtime channel, and a receiver can only
// play the first chunk: later chunks have no container header. Client note 26
// replaces it with an Agora audio channel. Ported only so the RN app can
// interoperate with the web app until then; topic and events match db.js.

export type WalkieChunk = { from: Uuid | null; data: string; mime: string; seq: number; t: number };
export type WalkieTalking = { from: Uuid | null; isTalking: boolean; name?: string | null; t: number };

export type WalkieChannel = {
  sendChunk: (chunk: { data: string; mime: string; seq: number }) => Promise<void>;
  sendTalking: (isTalking: boolean, name?: string | null) => Promise<void>;
  unsubscribe: Unsubscribe;
};

/** @deprecated WebM chunks only play the first chunk; client note 26 moves walkie to Agora audio. */
export function openWalkieChannel(
  chatId: Uuid,
  {
    onChunk,
    onSpeakerChange,
  }: { onChunk?: (p: WalkieChunk) => void; onSpeakerChange?: (p: WalkieTalking) => void },
): WalkieChannel {
  let me: string | null = null;
  const ready = uid().then((id) => {
    me = id;
  });
  const channel = supabase.channel(`walkie:${chatId}`, { config: { broadcast: { ack: false } } });
  channel
    .on('broadcast', { event: 'audio' }, (msg) => {
      const payload = msg.payload as WalkieChunk | undefined;
      // Our own chunks are ignored (broadcast self defaults to off anyway).
      if (!payload || (me && payload.from === me)) return;
      onChunk?.(payload);
    })
    .on('broadcast', { event: 'talking' }, (msg) => {
      const payload = msg.payload as WalkieTalking | undefined;
      if (!payload || (me && payload.from === me)) return;
      onSpeakerChange?.(payload);
    })
    .subscribe();
  let closed = false;
  return {
    sendChunk: async ({ data, mime, seq }) => {
      if (closed) return;
      await ready;
      await channel.send({
        type: 'broadcast',
        event: 'audio',
        payload: { from: me, data, mime, seq, t: Date.now() },
      });
    },
    sendTalking: async (isTalking, name) => {
      if (closed) return;
      await ready;
      await channel.send({
        type: 'broadcast',
        event: 'talking',
        payload: { from: me, isTalking, name, t: Date.now() },
      });
    },
    unsubscribe: () => {
      closed = true;
      void supabase.removeChannel(channel);
    },
  };
}
