// Call signalling. Port of the Calls section of web/js/db.js.
//
// Agora carries the audio and video, but it cannot make a phone ring. These
// functions are that missing half: they tell the other person a call is
// coming and let either side accept, decline or hang up. None of it needs an
// Agora App ID.
//
// ApiError codes thrown here:
//   not_signed_in         (from requireUid)
//   cannot_call_yourself  startCall with your own id
//
// Live walkie-talkie voice (client note 26) is not part of this module.
import type { RealtimeChannel } from '@supabase/supabase-js';

import { openOrCreateDm, subscribeWithMe } from './chat';
import { ApiError, requireUid, supabase, uid, listenerTopic } from './client';
import type { Iso, Unsubscribe, UserSummary, Uuid } from './types';

export const callKeys = {
  all: ['calls'] as const,
  call: (callId: Uuid) => ['calls', 'one', callId] as const,
  incoming: () => ['calls', 'incoming'] as const,
  members: (channel: string) => ['calls', 'members', channel] as const,
};

// ---------- Types ----------

export type CallKind = 'audio' | 'video';
export type CallStatus = 'ringing' | 'accepted' | 'declined' | 'missed' | 'ended';

// A calls row (0019, root_id from 0092).
export type Call = {
  id: Uuid;
  caller_id: Uuid;
  callee_id: Uuid;
  chat_id: Uuid | null;
  kind: CallKind;
  status: CallStatus;
  // Agora channel name, shared by every row of one (group) call.
  channel: string;
  root_id?: Uuid | null;
  created_at: Iso;
  answered_at: Iso | null;
  ended_at: Iso | null;
};

export type CallWithCaller = Call & { caller: UserSummary | null };
export type CallWithPeople = Call & { caller: UserSummary | null; callee: UserSummary | null };

export type CallMemberStatus = 'ringing' | 'joined' | 'left' | 'declined' | 'missed';

// Who is in a channel (0092). Written by triggers on calls; the client only
// writes its own "I left" (leave_call) and its Agora uid.
export type CallMember = {
  channel: string;
  user_id: Uuid;
  root_id: Uuid | null;
  invited_by: Uuid | null;
  status: CallMemberStatus;
  agora_uid: number | null;
  created_at: Iso;
  joined_at: Iso | null;
  left_at: Iso | null;
};

export type CallMemberWithProfile = CallMember & { profile: UserSummary | null };

const PERSON = '( id, name, handle, avatar_url )';

// ---------- Direct calls ----------

export async function startCall({
  calleeId,
  kind = 'audio',
  chatId = null,
}: {
  calleeId: Uuid;
  kind?: CallKind;
  chatId?: Uuid | null;
}): Promise<Call> {
  const me = await requireUid();
  if (calleeId === me) throw new ApiError('cannot_call_yourself');
  // Since 0114 the server replaces this with a channel of its own (a client
  // could otherwise name someone else's channel and land in their call), and
  // forces status 'ringing'. The row read back below is the truth; this value
  // is only sent so a database without 0114 still gets a channel.
  const channel = 'call_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const { data, error } = await supabase
    .from('calls')
    .insert({ caller_id: me, callee_id: calleeId, kind, chat_id: chatId, channel, status: 'ringing' })
    .select()
    .single();
  if (error) throw error;
  return data as Call;
}

async function setCallStatus(callId: Uuid, status: CallStatus, extra: Partial<Call>): Promise<Call | null> {
  const patch = { status, ...extra };
  const { data, error } = await supabase.from('calls').update(patch).eq('id', callId).select().maybeSingle();
  if (error) throw error;
  return data as Call | null;
}

export const acceptCall = (callId: Uuid) =>
  setCallStatus(callId, 'accepted', { answered_at: new Date().toISOString() });
export const declineCall = (callId: Uuid) =>
  setCallStatus(callId, 'declined', { ended_at: new Date().toISOString() });
export const endCall = (callId: Uuid) => setCallStatus(callId, 'ended', { ended_at: new Date().toISOString() });
export const missCall = (callId: Uuid) => setCallStatus(callId, 'missed', { ended_at: new Date().toISOString() });

// A voice call turned into a video call, by either side. The other screen
// hears about it through subscribeToCall; the call record in the chat reads
// the kind at the end.
export async function setCallKind(callId: Uuid, kind: CallKind): Promise<Call | null> {
  const { data, error } = await supabase.from('calls').update({ kind }).eq('id', callId).select().maybeSingle();
  if (error) throw error;
  return data as Call | null;
}

// ---------- Group calls (0092) ----------

// An invite is a calls row pointing at the ROOT call: the invitee's phone
// rings like a direct call, and accepting joins the root's channel.
//
// The invite carries the DM between inviter and invitee as its chat_id:
// record_call_in_chat (0045) ignores call rows without one, so an invite
// with none left the invitee no trace of the call ("i dont see anything new
// in his chat"). The DM is created if they have never spoken, as a direct
// call to a stranger does too.
export async function inviteToCall({
  root,
  userId,
}: {
  root: Pick<Call, 'id' | 'kind' | 'channel'>;
  userId: Uuid;
}): Promise<Call> {
  const me = await requireUid();
  let chatId: Uuid | null = null;
  try {
    chatId = await openOrCreateDm(userId);
  } catch {
    chatId = null;
  }
  const { data, error } = await supabase
    .from('calls')
    .insert({
      caller_id: me,
      callee_id: userId,
      kind: root.kind,
      channel: root.channel,
      root_id: root.id,
      status: 'ringing',
      chat_id: chatId,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Call;
}

// The inviter giving up on a ring nobody answered. Only while it is STILL
// ringing, or an answered invite would be flagged missed.
export async function missCallIfRinging(callId: Uuid): Promise<void> {
  const { error } = await supabase
    .from('calls')
    .update({ status: 'missed', ended_at: new Date().toISOString() })
    .eq('id', callId)
    .eq('status', 'ringing');
  if (error) throw error;
}

// Decline from the incoming-call notification, possibly with the app closed.
// Only while it is STILL ringing: a call already answered on another phone,
// or one the caller gave up on, is left as it is. True when it was declined.
export async function declineCallIfRinging(callId: Uuid): Promise<boolean> {
  const { data, error } = await supabase
    .from('calls')
    .update({ status: 'declined', ended_at: new Date().toISOString() })
    .eq('id', callId)
    .eq('status', 'ringing')
    .select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function fetchCallMembers(channel: string): Promise<CallMemberWithProfile[]> {
  const { data, error } = await supabase
    .from('call_members')
    .select(`*, profile:profiles!call_members_user_id_fkey ${PERSON}`)
    .eq('channel', channel)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as CallMemberWithProfile[];
}

// Every change to who is in the channel (call_members has replica identity
// full, so updates match the channel filter). Unique topic per subscription:
// two channels with one topic made supabase-js reject the second.
export function subscribeToCallMembers(channel: string, cb: (row: CallMember) => void): Unsubscribe {
  const ch: RealtimeChannel = supabase
    .channel('call_members:' + channel + ':' + Math.random().toString(36).slice(2))
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'call_members', filter: `channel=eq.${channel}` },
      (payload) => {
        // A DELETE delivers `new` as an empty object, which db.js's
        // `payload.new || payload.old` never fell through; fall back to `old`
        // whenever `new` carries no row.
        const next = payload.new as Partial<CallMember>;
        cb((next && 'user_id' in next ? next : payload.old) as CallMember);
      },
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}

// "I left." True when there was a membership row to leave; false for a call
// older than 0092, which the screen then ends the old way (endCall).
export async function leaveCall(channel: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('leave_call', { p_channel: channel });
  if (error) throw error;
  return !!data;
}

// So a tile can one day be labelled with a name. Never worth an error.
export async function setMyAgoraUid(channel: string, agoraUid: number): Promise<void> {
  try {
    const me = await uid();
    if (!me) return;
    await supabase.from('call_members').update({ agora_uid: agoraUid }).eq('channel', channel).eq('user_id', me);
  } catch {}
}

// ---------- Reading calls ----------

// Any call still ringing for me right now (the app was reopened mid-ring,
// or the realtime event was missed). Rings older than a minute are stale.
export async function fetchIncomingCall(): Promise<CallWithCaller | null> {
  const me = await uid();
  if (!me) return null;
  const cutoff = new Date(Date.now() - 60000).toISOString();
  const { data } = await supabase
    .from('calls')
    .select(`*, caller:profiles!calls_caller_id_fkey ${PERSON}`)
    .eq('callee_id', me)
    .eq('status', 'ringing')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1);
  return ((data ?? [])[0] as unknown as CallWithCaller | undefined) ?? null;
}

export async function fetchCall(callId: Uuid): Promise<CallWithPeople | null> {
  const { data } = await supabase
    .from('calls')
    .select(
      `*, caller:profiles!calls_caller_id_fkey ${PERSON}, callee:profiles!calls_callee_id_fkey ${PERSON}`,
    )
    .eq('id', callId)
    .maybeSingle();
  return (data as unknown as CallWithPeople | null) ?? null;
}

// ---------- Realtime ----------

// Fires when somebody calls me.
export function subscribeToIncomingCalls(cb: (call: Call) => void): Unsubscribe {
  return subscribeWithMe((me) =>
    supabase
      .channel(listenerTopic('calls:incoming:' + me))
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'calls', filter: `callee_id=eq.${me}` },
        (payload) => cb(payload.new as Call),
      )
      .subscribe(),
  );
}

// Fires when THIS call changes: answered, declined, hung up, kind changed.
export function subscribeToCall(callId: Uuid, cb: (call: Call) => void): Unsubscribe {
  const channel = supabase
    .channel(listenerTopic('calls:one:' + callId))
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'calls', filter: `id=eq.${callId}` },
      (payload) => cb(payload.new as Call),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
