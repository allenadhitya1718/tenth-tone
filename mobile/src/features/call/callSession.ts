// The one call this phone can be in, kept OUTSIDE any screen.
//
// Port of ActiveCall / V.call / initIncomingCalls in web/js/views.js. The
// session lives in this module rather than in the call screen so that
// leaving the screen (Android back, the minimise chevron) does not hang up:
// the call carries on, CallPill offers the way back, and opening
// /call/<id> again picks the same session up.
//
// Signalling is src/api/calls.ts (a calls row: ringing -> accepted ->
// ended/declined/missed). Media is react-native-agora on the shared engine
// singleton, claimed through the guard in api/walkie.ts and always left and
// released when the call ends.
//
// Rows: `row` is the calls row this phone was rung with (or placed); `call`
// is the ROOT call whose status is the session's. They are the same row for a
// direct call; someone added to a group call (0092) is rung with an invite
// row whose root_id points at the root. Both carry the same Agora channel.
import { Vibration } from 'react-native';
import {
  AudioRoute,
  AudioScenarioType,
  ChannelProfileType,
  ClientRoleType,
  ConnectionChangedReasonType,
  ConnectionStateType,
  createAgoraRtcEngine,
  ErrorCodeType,
  RemoteAudioStateReason,
  RemoteVideoState,
  UserOfflineReasonType,
  type IRtcEngine,
  type IRtcEngineEventHandler,
} from 'react-native-agora';
import { useSyncExternalStore } from 'react';

import { fetchAgoraToken, type AgoraToken } from '@/api/agora';
import {
  acceptCall,
  declineCall,
  endCall,
  fetchCall,
  fetchCallGroup,
  inviteToCall,
  isGroupRoot,
  leaveCall,
  missCallIfRinging,
  setCallKind,
  setMyAgoraUid,
  startCall,
  startGroupCall,
  subscribeToCall,
  type Call,
  type CallKind,
  type CallStatus,
} from '@/api/calls';
import { ApiError, uid as currentUid } from '@/api/client';
import type { Unsubscribe, UserSummary, Uuid } from '@/api/types';
import { claimAgora } from '@/api/walkie';
import type { ErrorMsg } from '@/components/ui';
import { AGORA_APP_ID, agoraUidFor } from '@/features/live/config';
import { startAudioForeground, stopAudioForeground } from '@/lib/audioForeground';

import { otherAgoraSessionActive } from './agoraGuard';
import { dismissIncomingCall, markCallOver } from './callNotification';
import { keepAwake } from './keepAwake';
import { openCallScreen } from './nav';
import { ensureCamera, ensureMic, prepareForCall } from './permissions';

// ---------- Timing ----------

// The caller gives up after this long without an answer (the web app used
// 35 s; the brief asks for ~45 s).
export const RING_TIMEOUT_MS = 45_000;
// The callee's screen stops ringing a little later, so the caller's "no
// answer" is the one that writes the row.
const INCOMING_TIMEOUT_MS = RING_TIMEOUT_MS + 5_000;
// Agora reconnects on its own for a long time; a call that has had no
// connection, or no other person, for this long is over.
const NETWORK_GIVE_UP_MS = 40_000;
// The other side's Agora "quit" usually lands before its calls row update;
// if the row update never comes, the call is ended from here.
const PEER_QUIT_GRACE_MS = 4_000;

// ---------- State ----------

export type CallPhase =
  | 'idle'
  | 'dialing' // creating the calls row
  | 'loading' // reading a call opened by id
  | 'outgoing' // ringing on the other phone
  | 'incoming' // ringing on this phone
  | 'connecting' // answered, media joining / waiting for the other person
  | 'connected'
  | 'ended';

export type EndReason =
  | 'declined' // the other person declined
  | 'declined_by_me'
  | 'no_answer' // I called, nobody answered
  | 'missed' // I was called and did not answer
  | 'cancelled' // the caller hung up before I answered
  | 'cancelled_by_me'
  | 'ended'
  | 'ended_by_me'
  | 'answered_elsewhere'
  | 'network'
  | 'failed'
  | 'not_found';

export type MediaStatus = 'idle' | 'joining' | 'joined' | 'reconnecting';
export type PeerStatus = 'absent' | 'present' | 'dropped' | 'left';

// One other person in the Agora channel. A 1:1 call has one; a group call
// (0092) one per person who is in. Keyed by Agora uid, which the server
// derives from the account (agoraUidFor), so a call_members row maps to its
// tile without waiting for agora_uid to be written.
export type RemotePeer = { video: boolean; muted: boolean; dropped: boolean };

export type CallState = {
  phase: CallPhase;
  callId: Uuid | null;
  // Set by dial(): which dial screen owns this session before it has an id.
  dialNonce: string | null;
  row: Call | null;
  call: Call | null;
  me: Uuid | null;
  peer: UserSummary | null;
  isCaller: boolean;
  // A call started from a group chat (0145): which group, and its name for
  // the screens. Null for a call between people.
  groupChatId: Uuid | null;
  groupName: string | null;
  kind: CallKind;
  channel: string | null;
  localUid: number | null;
  media: MediaStatus;
  // The engine is initialized and its views may be drawn.
  engineReady: boolean;
  peerStatus: PeerStatus;
  remoteUid: number | null;
  remoteVideo: boolean;
  // Everyone else in the channel (remoteUid is the first of them).
  remotes: Record<number, RemotePeer>;
  // Agora uids heard speaking just now; 0 is this phone.
  speaking: number[];
  muted: boolean;
  speaker: boolean;
  cameraOn: boolean;
  frontCamera: boolean;
  // When the other person's audio first reached this phone (ms epoch).
  startedAt: number | null;
  endedAt: number | null;
  endReason: EndReason | null;
  // A message that does not end the call (camera not allowed...).
  notice: ErrorMsg;
  // Why the call could not start or connect.
  error: ErrorMsg;
};

const INITIAL: CallState = {
  phase: 'idle',
  callId: null,
  dialNonce: null,
  row: null,
  call: null,
  me: null,
  peer: null,
  isCaller: false,
  groupChatId: null,
  groupName: null,
  kind: 'audio',
  channel: null,
  localUid: null,
  media: 'idle',
  engineReady: false,
  peerStatus: 'absent',
  remoteUid: null,
  remoteVideo: false,
  remotes: {},
  speaking: [],
  muted: false,
  speaker: false,
  cameraOn: false,
  frontCamera: true,
  startedAt: null,
  endedAt: null,
  endReason: null,
  notice: null,
  error: null,
};

let state: CallState = INITIAL;
const listeners = new Set<() => void>();

function set(patch: Partial<CallState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => {
    try {
      l();
    } catch {}
  });
}

export const getCallState = () => state;

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useCallState(): CallState {
  return useSyncExternalStore(subscribe, getCallState, getCallState);
}

const LIVE_PHASES: ReadonlySet<CallPhase> = new Set(['dialing', 'loading', 'outgoing', 'incoming', 'connecting', 'connected']);

/** A call is under way on this phone (ringing either way, or connected). */
export const isCallActive = (s: CallState = state) => LIVE_PHASES.has(s.phase);

const TERMINAL: ReadonlySet<CallStatus> = new Set(['declined', 'missed', 'ended']);

// ---------- Session resources (not rendered) ----------

// Bumped whenever a session starts or ends; async work started for an older
// generation drops its result.
let gen = 0;
let engine: IRtcEngine | null = null;
let handler: IRtcEngineEventHandler | null = null;
let releaseLock: (() => void) | null = null;
let unsubs: Unsubscribe[] = [];
let tokenFor: { uid: number; channel: string; p: Promise<AgoraToken | null> } | null = null;
let acceptedHere = false;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function setTimer(name: string, ms: number, fn: () => void) {
  clearTimer(name);
  timers.set(
    name,
    setTimeout(() => {
      timers.delete(name);
      fn();
    }, ms),
  );
}

function clearTimer(name: string) {
  const t = timers.get(name);
  if (t) clearTimeout(t);
  timers.delete(name);
}

// A uid is bound into the token. agora-token derives it from the account
// (agoraUidFor, the same hash the server uses) and ignores any other value,
// so the call asks with that one and joins with whatever uid the token was
// signed for. Random only before we know who we are, which the server then
// corrects.
const randomUid = () => Math.floor(Math.random() * 2147483645) + 1;
const myUid = () => (state.me ? agoraUidFor(state.me) : randomUid());

function prewarmToken(channel: string, uid: number) {
  if (tokenFor && tokenFor.channel === channel && tokenFor.uid === uid) return;
  tokenFor = {
    uid,
    channel,
    p: fetchAgoraToken(channel, uid, 'host').catch(() => null),
  };
}

async function takeToken(channel: string, uid: number): Promise<AgoraToken> {
  const warm = tokenFor && tokenFor.channel === channel && tokenFor.uid === uid ? await tokenFor.p : null;
  tokenFor = null;
  return warm ?? fetchAgoraToken(channel, uid, 'host');
}

function startRinging() {
  // Off, on, off, on... repeated until cancelled. VIBRATE is in app.json.
  try {
    Vibration.vibrate([0, 900, 700], true);
  } catch {}
}

function stopRinging() {
  try {
    Vibration.cancel();
  } catch {}
}

// ---------- Errors ----------

const errorText = (e: unknown) => {
  if (e instanceof ApiError) return `${e.code} ${e.message}`;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message?: unknown }).message ?? '');
  return String(e ?? '');
};

export function callError(e: unknown): NonNullable<ErrorMsg> {
  const code = e instanceof ApiError ? e.code : '';
  const text = errorText(e);
  if (code === 'cannot_call_yourself') return { key: 'call.errors.self' };
  if (code === 'not_signed_in') return { key: 'call.errors.not_signed_in' };
  if (code === 'agora_forbidden') return { key: 'call.errors.forbidden' };
  if (code === 'group_calls_unavailable') return { key: 'call.group.errors.unavailable' };
  if (/no one in this group/i.test(text)) return { key: 'call.group.errors.nobody' };
  if (/not in this group|no such group/i.test(text)) return { key: 'call.group.errors.not_in_group' };
  if (code.startsWith('agora_')) return { key: 'call.errors.media_unavailable' };
  if (/blocked/i.test(text)) return { key: 'call.errors.blocked' };
  if (/too many/i.test(text)) return { key: 'call.errors.rate_limited' };
  if (/network|fetch|timeout/i.test(text)) return { key: 'call.errors.offline' };
  return { key: 'call.errors.generic' };
}

// ---------- Before a call: can it start at all ----------

export type Readiness =
  | { ok: true; cameraOn: boolean; notice: ErrorMsg }
  | { ok: false; error: NonNullable<ErrorMsg>; openSettings?: boolean };

/**
 * Busy checks and permissions for placing or answering a call. Asks for the
 * microphone (and the camera for video) when they have not been decided.
 * A video call without the camera still goes ahead, camera off, with a note.
 */
export async function checkReady(kind: CallKind): Promise<Readiness> {
  if (isCallActive()) return { ok: false, error: { key: 'call.errors.already_in_call' } };
  if (otherAgoraSessionActive()) return { ok: false, error: { key: 'call.errors.agora_busy' } };
  const mic = await ensureMic();
  if (mic !== 'granted') return { ok: false, error: { key: 'call.errors.mic_denied' }, openSettings: mic === 'blocked' };
  if (kind !== 'video') return { ok: true, cameraOn: false, notice: null };
  const cam = await ensureCamera();
  if (cam === 'granted') return { ok: true, cameraOn: true, notice: null };
  return { ok: true, cameraOn: false, notice: { key: 'call.errors.camera_denied' } };
}

// ---------- Placing a call ----------

export type DialRequest = {
  nonce: string;
  calleeId: Uuid;
  kind: CallKind;
  chatId?: Uuid | null;
  peer?: UserSummary | null;
};

/**
 * Places a call. The screen is already showing "Calling…" from `peer`; the
 * row is written, the other phone rings, and this phone joins the channel
 * while it waits (so the first words are not lost to a slow join).
 * Resolves with an error when the call could not even start; in that case
 * any other call already running is left untouched.
 */
export async function dial(req: DialRequest): Promise<Readiness> {
  if (state.dialNonce === req.nonce) return { ok: true, cameraOn: state.cameraOn, notice: state.notice };
  const ready = await checkReady(req.kind);
  if (!ready.ok) return ready;

  const g = ++gen;
  resetResources();
  state = INITIAL;
  set({
    phase: 'dialing',
    dialNonce: req.nonce,
    isCaller: true,
    kind: req.kind,
    peer: req.peer ?? { id: req.calleeId, name: null, handle: null, avatar_url: null },
    cameraOn: ready.cameraOn,
    notice: ready.notice,
    speaker: req.kind === 'video',
  });
  keepAwake(true);

  let row: Call;
  try {
    const me = await currentUid();
    row = await startCall({ calleeId: req.calleeId, kind: req.kind, chatId: req.chatId ?? null });
    if (g !== gen) {
      // Cancelled while the row was being written: take the ring back.
      void endCall(row.id).catch(() => {});
      return ready;
    }
    set({ me, row, call: row, callId: row.id, channel: row.channel, phase: 'outgoing' });
  } catch (e) {
    if (g !== gen) return ready;
    console.warn('call: start failed:', errorText(e));
    finish('failed', callError(e));
    return { ok: false, error: callError(e) };
  }

  watchRows(row, row);
  setTimer('ring', RING_TIMEOUT_MS, () => void ringTimedOut(g));
  void joinMedia(g);
  // Fill in the callee's profile if the dial screen had none.
  if (!state.peer?.name && !state.peer?.handle) {
    fetchCall(row.id)
      .then((full) => {
        if (g === gen && full?.callee) set({ peer: full.callee });
      })
      .catch(() => {});
  }
  return ready;
}

// ---------- Calling a group chat (0145) ----------

export type GroupDialRequest = {
  nonce: string;
  chatId: Uuid;
  kind: CallKind;
  name?: string | null;
  photo?: string | null;
};

export type GroupDialResult = Readiness & { skipped?: number };

/**
 * Calls a group chat: every member who may be rung rings at once (the server
 * skips, and counts, those who may not). Shown as "Calling…" under the
 * group's name until the first person answers; ends by itself when nobody
 * has answered after the ring time.
 */
export async function dialGroup(req: GroupDialRequest): Promise<GroupDialResult> {
  if (state.dialNonce === req.nonce) return { ok: true, cameraOn: state.cameraOn, notice: state.notice };
  const ready = await checkReady(req.kind);
  if (!ready.ok) return ready;

  const g = ++gen;
  resetResources();
  state = INITIAL;
  set({
    phase: 'dialing',
    dialNonce: req.nonce,
    isCaller: true,
    kind: req.kind,
    groupChatId: req.chatId,
    groupName: req.name ?? null,
    peer: { id: req.chatId, name: req.name ?? null, handle: null, avatar_url: req.photo ?? null },
    cameraOn: ready.cameraOn,
    notice: ready.notice,
    speaker: req.kind === 'video',
  });
  keepAwake(true);

  let row: Call;
  let skipped = 0;
  try {
    const me = await currentUid();
    const r = await startGroupCall({ chatId: req.chatId, kind: req.kind });
    row = r.call;
    skipped = r.skipped;
    if (g !== gen) {
      void endCall(row.id).catch(() => {});
      return ready;
    }
    set({ me, row, call: row, callId: row.id, channel: row.channel, phase: 'outgoing' });
  } catch (e) {
    if (g !== gen) return ready;
    console.warn('call: group start failed:', errorText(e));
    finish('failed', callError(e));
    return { ok: false, error: callError(e) };
  }

  watchRows(row, row);
  setTimer('ring', RING_TIMEOUT_MS, () => void ringTimedOut(g));
  void joinMedia(g);
  return { ...ready, skipped };
}

async function ringTimedOut(g: number) {
  if (g !== gen || state.phase !== 'outgoing' || !state.call) return;
  // A group call's root never rings anybody; nobody has answered any of its
  // invites, so it is over (ending the root marks every invite missed).
  if (isGroupRoot(state.call)) {
    hangUp('no_answer');
    return;
  }
  const id = state.call.id;
  try {
    // Only while still ringing: an answer racing the timer wins.
    await missCallIfRinging(id);
    const now = await fetchCall(id);
    if (g !== gen) return;
    if (now && now.status === 'accepted') {
      onRow(now, g);
      return;
    }
  } catch {}
  if (g === gen) finish('no_answer');
}

// ---------- Opening a call by id (incoming, push tap, reopened) ----------

/**
 * Loads call `callId` into the session, unless it already is the session.
 * Does nothing while ANOTHER call is under way: the screen shows "already in
 * a call" for that case.
 */
export async function openCall(callId: Uuid): Promise<void> {
  if (state.callId === callId && state.phase !== 'idle') return;
  if (isCallActive()) return;

  const g = ++gen;
  resetResources();
  state = INITIAL;
  set({ phase: 'loading', callId });

  try {
    const [me, row] = await Promise.all([currentUid(), fetchCall(callId)]);
    if (g !== gen) return;
    if (!row || !me) {
      finish('not_found');
      return;
    }
    const root = row.root_id ? ((await fetchCall(row.root_id)) ?? row) : row;
    if (g !== gen) return;
    const isCaller = row.caller_id === me;
    const groupChatId = root.group_chat_id ?? null;
    const group = groupChatId ? await fetchCallGroup(groupChatId) : null;
    if (g !== gen) return;
    // My own group call: the "other side" is the group, not a person.
    const peer =
      isGroupRoot(row) && isCaller
        ? { id: groupChatId!, name: group?.name ?? null, handle: null, avatar_url: group?.photo_url ?? null }
        : ((isCaller ? row.callee : row.caller) ?? null);
    set({
      me,
      row,
      call: root,
      peer,
      isCaller,
      groupChatId,
      groupName: group?.name ?? null,
      kind: root.kind,
      channel: root.channel,
      speaker: root.kind === 'video',
      cameraOn: false,
    });

    if (TERMINAL.has(root.status) || TERMINAL.has(row.status)) {
      const status = TERMINAL.has(row.status) ? row.status : root.status;
      finish(reasonFor(status, isCaller, false));
      return;
    }

    watchRows(row, root);

    if (row.status === 'ringing' && !isCaller) {
      set({ phase: 'incoming', localUid: myUid() });
      // The screen rings now; the ringing notification (if the app was
      // opened from it) would only ring on top of it.
      void dismissIncomingCall(row.id);
      // Sign the token while it rings: most of the wait after Accept was the
      // token round trip (measured on the web app). No microphone yet.
      prewarmToken(root.channel, state.localUid!);
      void prepareForCall(root.kind).catch(() => {});
      startRinging();
      keepAwake(true);
      const left = INCOMING_TIMEOUT_MS - (Date.now() - Date.parse(row.created_at));
      setTimer('ring', Math.max(3_000, left), () => {
        if (g !== gen || state.phase !== 'incoming') return;
        void missCallIfRinging(row.id).catch(() => {});
        finish('missed');
      });
      // Accept was pressed on the notification before this screen existed.
      if (takeAutoAnswer(row.id)) void accept();
      return;
    }

    // My own call, ringing or connected (the app was closed and reopened):
    // rejoin. The microphone was allowed when the call was placed, but the
    // permission can have been withdrawn since.
    const ready = await checkPermissionsOnly(root.kind);
    if (g !== gen) return;
    if (!ready.ok) {
      finish('failed', ready.error);
      return;
    }
    set({ cameraOn: ready.cameraOn, notice: ready.notice });
    keepAwake(true);
    // A group call I started that is still inside its ring time counts as
    // ringing: its root is 'accepted' from the start.
    const groupRinging =
      isGroupRoot(root) && isCaller && Date.now() - Date.parse(root.created_at) < RING_TIMEOUT_MS;
    if (root.status === 'ringing' || groupRinging) {
      set({ phase: 'outgoing' });
      const left = RING_TIMEOUT_MS - (Date.now() - Date.parse(root.created_at));
      setTimer('ring', Math.max(3_000, left), () => void ringTimedOut(g));
    } else {
      acceptedHere = true;
      set({ phase: 'connecting' });
    }
    void joinMedia(g);
  } catch (e) {
    if (g !== gen) return;
    console.warn('call: open failed:', errorText(e));
    finish('failed', callError(e));
  }
}

async function checkPermissionsOnly(kind: CallKind): Promise<Readiness> {
  if (otherAgoraSessionActive()) return { ok: false, error: { key: 'call.errors.agora_busy' } };
  const mic = await ensureMic();
  if (mic !== 'granted') return { ok: false, error: { key: 'call.errors.mic_denied' }, openSettings: mic === 'blocked' };
  if (kind !== 'video') return { ok: true, cameraOn: false, notice: null };
  const cam = await ensureCamera();
  return cam === 'granted'
    ? { ok: true, cameraOn: true, notice: null }
    : { ok: true, cameraOn: false, notice: { key: 'call.errors.camera_denied' } };
}

// ---------- Answering ----------

// Accept pressed on the incoming-call notification (background.ts): the app
// opens on the call screen, and the call is answered as soon as it has
// loaded - or at once, when it is already ringing on screen.
const AUTO_ANSWER_MS = 60_000;
let autoAnswer: { callId: Uuid; at: number } | null = null;

function takeAutoAnswer(callId: Uuid): boolean {
  const a = autoAnswer;
  if (!a || a.callId !== callId) return false;
  autoAnswer = null;
  return Date.now() - a.at < AUTO_ANSWER_MS;
}

/** Answer call `callId` once it is ringing on this phone. */
export function answerWhenReady(callId: Uuid) {
  if (state.callId === callId && state.phase === 'incoming') {
    void accept();
    return;
  }
  autoAnswer = { callId, at: Date.now() };
}

/** Accept the ringing call. Resolves with an error when it cannot be answered (yet). */
export async function accept(): Promise<Readiness> {
  if (state.phase !== 'incoming' || !state.row || !state.call) {
    return { ok: false, error: { key: 'call.errors.generic' } };
  }
  const g = gen;
  const ready = await checkPermissionsOnly(state.kind);
  if (g !== gen || state.phase !== 'incoming') return { ok: false, error: { key: 'call.errors.call_gone' } };
  if (!ready.ok) return ready;

  const row = state.row;
  markCallOver(row.id);
  stopRinging();
  clearTimer('ring');
  acceptedHere = true;
  set({ phase: 'connecting', cameraOn: ready.cameraOn, notice: ready.notice, error: null });
  // Fired, not awaited: the caller hears about it through realtime, and the
  // media join below should not sit behind a round trip.
  acceptCall(row.id)
    .then((r) => {
      // Already over (the caller hung up as Accept was pressed).
      if (r && g === gen && TERMINAL.has(r.status)) onRow(r, g);
    })
    .catch((e) => {
      if (g !== gen) return;
      console.warn('call: accept failed:', errorText(e));
      finish('failed', callError(e));
    });
  void joinMedia(g);
  return ready;
}

export function decline() {
  if (state.phase !== 'incoming' || !state.row) return;
  const id = state.row.id;
  markCallOver(id);
  void dismissIncomingCall(id);
  void declineCall(id).catch(() => {});
  finish('declined_by_me');
}

// ---------- Hanging up ----------

/**
 * Ends this phone's part in the call. On a connected call this is "I left"
 * (leave_call, 0092: the call ends itself when fewer than two remain); a call
 * still ringing, or one older than 0092, is ended on its row.
 */
export function hangUp(reason: EndReason = 'ended_by_me') {
  if (state.phase === 'incoming') {
    decline();
    return;
  }
  if (!isCallActive()) return;
  const { row, call, phase } = state;
  const wasRinging = phase === 'dialing' || phase === 'outgoing';
  finish(wasRinging && reason === 'ended_by_me' ? 'cancelled_by_me' : reason);
  if (!row || !call) return; // still dialing: dial() takes the ring back
  void (async () => {
    try {
      if (!wasRinging && (await leaveCall(call.channel))) return;
    } catch (e) {
      console.warn('call: leave failed:', errorText(e));
    }
    // Someone ADDED to a call ends only their own invite row, never the
    // root everyone else is still in.
    const mine = row.root_id ? row.id : call.id;
    try {
      await endCall(mine);
    } catch (e) {
      console.warn('call: end failed:', errorText(e));
    }
  })();
}

/** Clears an ended call so the next one starts clean. */
export function dismissEnded() {
  if (state.phase === 'ended') {
    resetResources();
    state = INITIAL;
    set({});
  }
}

// ---------- In-call controls ----------

export function toggleMute() {
  const next = !state.muted;
  try {
    engine?.muteLocalAudioStream(next);
  } catch {}
  set({ muted: next });
}

export function toggleSpeaker() {
  const next = !state.speaker;
  try {
    // Only effective once joined; before that it is applied at the join.
    if (engine && state.media !== 'idle' && state.media !== 'joining') engine.setEnableSpeakerphone(next);
  } catch {}
  set({ speaker: next });
}

export function flipCamera() {
  if (!state.cameraOn) return;
  try {
    engine?.switchCamera();
  } catch {}
  set({ frontCamera: !state.frontCamera });
}

/**
 * Camera on/off. On a voice call, turning the camera on makes it a video call
 * for both sides (setCallKind, as the web app does).
 */
export async function toggleCamera(): Promise<ErrorMsg> {
  const g = gen;
  if (state.cameraOn) {
    try {
      engine?.muteLocalVideoStream(true);
      engine?.enableLocalVideo(false);
      engine?.stopPreview();
    } catch {}
    set({ cameraOn: false });
    return null;
  }
  const cam = await ensureCamera();
  if (g !== gen || !isCallActive()) return null;
  if (cam !== 'granted') {
    const notice = { key: 'call.errors.camera_denied' };
    set({ notice });
    return notice;
  }
  const upgrading = state.kind !== 'video';
  if (upgrading && state.call) {
    void setCallKind(state.call.id, 'video').catch((e) => console.warn('call: kind:', errorText(e)));
  }
  try {
    if (engine) {
      engine.enableVideo();
      engine.enableLocalVideo(true);
      engine.muteLocalVideoStream(false);
      engine.startPreview();
      if (state.media === 'joined' || state.media === 'reconnecting') {
        engine.updateChannelMediaOptions({ publishCameraTrack: true, autoSubscribeVideo: true });
        // A video call is held away from the ear.
        if (upgrading && !state.speaker) engine.setEnableSpeakerphone(true);
      }
    }
  } catch (e) {
    console.warn('call: camera:', errorText(e));
  }
  set({ cameraOn: true, kind: 'video', notice: null, speaker: upgrading ? true : state.speaker });
  return null;
}

// ---------- Adding people (group calls, 0092) ----------

// The most people in one call, this phone included. The server has no cap
// (0092 / 0114 only require the inviter to be in the call), so this is the
// app's: every extra person is one more Agora stream to pay for and, on
// video, one more picture for a phone to decode.
export const GROUP_LIMIT: Record<CallKind, number> = { audio: 8, video: 4 };

// Invites this phone sent in the current call: who, which row, when.
const invites = new Map<Uuid, { rowId: Uuid; at: number }>();

/** When this phone rang `userId` into the current call (ms epoch), if it did. */
export const inviteSentAt = (userId: Uuid): number | null => invites.get(userId)?.at ?? null;

export type InviteResult = { ok: true } | { ok: false; error: NonNullable<ErrorMsg> };

export function inviteError(e: unknown): NonNullable<ErrorMsg> {
  const text = errorText(e);
  if (/blocked/i.test(text)) return { key: 'call.group.errors.blocked' };
  if (/too many/i.test(text)) return { key: 'call.group.errors.rate_limited' };
  if (/already ended/i.test(text)) return { key: 'call.errors.call_gone' };
  if (/not in this call/i.test(text)) return { key: 'call.group.errors.not_in_call' };
  if (/network|fetch|timeout/i.test(text)) return { key: 'call.errors.offline' };
  return { key: 'call.group.errors.generic' };
}

/**
 * Rings `userId` into the call this phone is in. `inCall` is how many people
 * are in it or being rung right now, this phone included. The invite is a
 * calls row pointing at the root (inviteToCall); the server refuses it across
 * a block, past someone's "who can contact me", or over the rate limit. An
 * invite nobody answers is marked missed after the usual ring time, so a
 * phone that never saw the ring does not stay "Ringing…" on every screen.
 */
export async function invitePerson(userId: Uuid, inCall: number): Promise<InviteResult> {
  const g = gen;
  const root = state.call;
  if (state.phase !== 'connected' || !root) return { ok: false, error: { key: 'call.group.errors.not_connected' } };
  const max = GROUP_LIMIT[state.kind];
  if (inCall >= max) return { ok: false, error: { key: 'call.group.errors.full', params: { max } } };
  try {
    const row = await inviteToCall({ root: { id: root.id, channel: root.channel, kind: state.kind }, userId });
    if (g !== gen) {
      // The call ended while the invite was being written: take it back.
      void missCallIfRinging(row.id).catch(() => {});
      return { ok: false, error: { key: 'call.errors.call_gone' } };
    }
    invites.set(userId, { rowId: row.id, at: Date.now() });
    setTimer('invite:' + userId, RING_TIMEOUT_MS, () => {
      if (g === gen) void missCallIfRinging(row.id).catch(() => {});
    });
    return { ok: true };
  } catch (e) {
    console.warn('call: invite failed:', errorText(e));
    return { ok: false, error: inviteError(e) };
  }
}

// ---------- Rows ----------

function reasonFor(status: CallStatus, isCaller: boolean, wasRingingHere: boolean): EndReason {
  if (status === 'declined') return isCaller ? 'declined' : 'declined_by_me';
  if (status === 'missed') return isCaller ? 'no_answer' : 'missed';
  // 'ended' while my phone was still ringing: the caller gave up.
  if (wasRingingHere) return 'cancelled';
  return 'ended';
}

function watchRows(row: Call, root: Call) {
  const g = gen;
  unsubs.push(subscribeToCall(root.id, (r) => onRow(r, g)));
  if (row.id !== root.id) unsubs.push(subscribeToCall(row.id, (r) => onRow(r, g)));
}

function onRow(r: Call, g: number) {
  if (g !== gen || !isCallActive()) return;
  const { row, call } = state;
  if (!row || !call) return;
  const isRoot = r.id === call.id;
  const isMine = r.id === row.id;
  if (!isRoot && !isMine) return;
  set(isRoot && isMine ? { row: r, call: r } : isRoot ? { call: r } : { row: r });

  if (TERMINAL.has(r.status)) {
    // My invite row ending does not end the root for anyone else, but it does
    // end it for me; the root ending ends it for everyone.
    finish(reasonFor(r.status, state.isCaller, state.phase === 'incoming'));
    return;
  }

  if (r.status === 'accepted') {
    if (state.phase === 'incoming' && isMine && !acceptedHere) {
      // Answered on another device signed in to the same account.
      finish('answered_elsewhere');
      return;
    }
    // A group call's root is 'accepted' from the start; it is answered when
    // someone joins (onUserJoined), not by this row.
    if (state.phase === 'outgoing' && !isGroupRoot(state.call)) {
      clearTimer('ring');
      set({ phase: state.peerStatus === 'present' ? 'connected' : 'connecting' });
      if (state.peerStatus === 'present' && !state.startedAt) set({ startedAt: Date.now() });
    }
  }

  // The other side turned a voice call into a video call. Their picture is
  // shown; this phone's camera stays off until its owner turns it on.
  if (isRoot && r.kind === 'video' && state.kind !== 'video') {
    set({ kind: 'video' });
    try {
      engine?.enableVideo();
      if (state.media === 'joined' || state.media === 'reconnecting') {
        engine?.updateChannelMediaOptions({ autoSubscribeVideo: true });
      }
    } catch {}
  }
}

// ---------- Media ----------

async function joinMedia(g: number) {
  if (engine || g !== gen) return;
  const channel = state.channel ?? state.call?.channel;
  if (!channel) return;
  let localUid = state.localUid ?? myUid();
  set({ localUid, media: 'joining' });
  prewarmToken(channel, localUid);

  releaseLock = claimAgora('call');
  let e: IRtcEngine;
  try {
    e = createAgoraRtcEngine();
    const rc = e.initialize({
      appId: AGORA_APP_ID,
      channelProfile: ChannelProfileType.ChannelProfileCommunication,
      audioScenario: AudioScenarioType.AudioScenarioDefault,
    });
    if (rc < 0) throw new ApiError('agora_not_installed', `initialize ${rc}`);
  } catch (err) {
    console.warn('call: agora init:', errorText(err));
    releaseLock?.();
    releaseLock = null;
    hangUp('failed');
    set({ error: { key: 'call.errors.media_unavailable' } });
    return;
  }
  engine = e;
  // The call keeps its microphone when the app is minimised (Android 14+
  // foreground service). Started here, with the screen in front.
  const fgsCallId = state.callId;
  startAudioForeground('call', {
    onEnd: () => hangUp(),
    onOpen: () => {
      if (fgsCallId && state.callId === fgsCallId && isCallActive()) openCallScreen(fgsCallId);
    },
    body: state.peer?.name || state.peer?.handle || null,
  });

  const renew = () => {
    fetchAgoraToken(channel, localUid, 'host')
      .then((t) => {
        if (g === gen && engine === e) e.renewToken(t.token);
      })
      .catch((err) => console.warn('call: token renew:', errorText(err)));
  };

  const h: IRtcEngineEventHandler = {
    onJoinChannelSuccess: () => {
      if (g !== gen) return;
      set({ media: 'joined' });
      try {
        e.setEnableSpeakerphone(state.speaker);
        if (state.muted) e.muteLocalAudioStream(true);
      } catch {}
      void setMyAgoraUid(channel, localUid);
    },
    onConnectionStateChanged: (_c, st, reason) => {
      if (g !== gen) return;
      if (st === ConnectionStateType.ConnectionStateReconnecting) {
        set({ media: 'reconnecting' });
        setTimer('net', NETWORK_GIVE_UP_MS, () => {
          if (g === gen && state.media === 'reconnecting') hangUp('network');
        });
      } else if (st === ConnectionStateType.ConnectionStateConnected) {
        clearTimer('net');
        set({ media: 'joined' });
      } else if (st === ConnectionStateType.ConnectionStateFailed) {
        console.warn('call: connection failed, reason', reason);
        const tokenProblem =
          reason === ConnectionChangedReasonType.ConnectionChangedInvalidToken ||
          reason === ConnectionChangedReasonType.ConnectionChangedTokenExpired;
        if (tokenProblem) set({ error: { key: 'call.errors.media_unavailable' } });
        hangUp('failed');
      }
    },
    onUserJoined: (_c, remoteUid) => {
      if (g !== gen) return;
      clearTimer('peer');
      clearTimer('peerQuit');
      const answered = state.call?.status === 'accepted' || state.phase === 'connecting';
      const prev = state.remotes[remoteUid];
      const remotes = { ...state.remotes, [remoteUid]: { video: prev?.video ?? false, muted: prev?.muted ?? false, dropped: false } };
      // The first person in stays the "primary" remote (the 1:1 picture);
      // someone added later only takes over once the primary is gone.
      const primary = state.remoteUid != null && remotes[state.remoteUid] ? state.remoteUid : remoteUid;
      set({
        remotes,
        remoteUid: primary,
        remoteVideo: remotes[primary]?.video ?? false,
        peerStatus: 'present',
        ...(answered || state.phase === 'outgoing'
          ? { phase: 'connected' as const, startedAt: state.startedAt ?? Date.now() }
          : {}),
      });
      // In the channel means answered, even if the row update is late.
      clearTimer('ring');
    },
    onUserOffline: (_c, remoteUid, reason) => {
      if (g !== gen || !state.remotes[remoteUid]) return;
      const remotes = { ...state.remotes };
      if (reason === UserOfflineReasonType.UserOfflineDropped) {
        remotes[remoteUid] = { ...remotes[remoteUid], video: false, dropped: true };
      } else {
        delete remotes[remoteUid];
      }
      const uids = Object.keys(remotes).map(Number);
      const reachable = uids.filter((u) => !remotes[u].dropped);
      // The primary moves to someone still here, so a group call does not
      // lose its picture when the first person goes.
      const primary =
        state.remoteUid != null && remotes[state.remoteUid] && !remotes[state.remoteUid].dropped
          ? state.remoteUid
          : (reachable[0] ?? uids[0] ?? state.remoteUid);
      const patch: Partial<CallState> = {
        remotes,
        remoteUid: primary,
        remoteVideo: primary != null ? (remotes[primary]?.video ?? false) : false,
        speaking: state.speaking.filter((u) => u !== remoteUid),
      };
      if (reachable.length) {
        // Others are still here: the call goes on for this phone.
        set({ ...patch, peerStatus: 'present' });
        return;
      }
      if (uids.length) {
        // Everyone left in the channel has a bad connection.
        set({ ...patch, peerStatus: 'dropped' });
        setTimer('peer', NETWORK_GIVE_UP_MS, () => {
          if (g === gen && state.peerStatus === 'dropped') hangUp('network');
        });
        return;
      }
      // The last other person hung up. Their row update normally lands within
      // a moment and says how; if it does not, the call ends here anyway.
      set({ ...patch, peerStatus: 'left' });
      setTimer('peerQuit', PEER_QUIT_GRACE_MS, () => {
        if (g === gen && state.peerStatus === 'left') hangUp('ended');
      });
    },
    onRemoteVideoStateChanged: (_c, remoteUid, st) => {
      if (g !== gen) return;
      const r = state.remotes[remoteUid];
      if (!r) return;
      let video = r.video;
      if (st === RemoteVideoState.RemoteVideoStateStarting || st === RemoteVideoState.RemoteVideoStateDecoding) video = true;
      else if (st === RemoteVideoState.RemoteVideoStateStopped || st === RemoteVideoState.RemoteVideoStateFailed) video = false;
      if (video === r.video) return;
      set({
        remotes: { ...state.remotes, [remoteUid]: { ...r, video } },
        ...(remoteUid === state.remoteUid ? { remoteVideo: video } : {}),
      });
    },
    onUserMuteAudio: (_c, remoteUid, muted) => {
      if (g !== gen) return;
      setRemoteMuted(remoteUid, muted);
    },
    onRemoteAudioStateChanged: (_c, remoteUid, _st, reason) => {
      if (g !== gen) return;
      if (reason === RemoteAudioStateReason.RemoteAudioReasonRemoteMuted) setRemoteMuted(remoteUid, true);
      else if (reason === RemoteAudioStateReason.RemoteAudioReasonRemoteUnmuted) setRemoteMuted(remoteUid, false);
    },
    // Who is talking, for the ring around a tile. Only stored when the set
    // changes, so a quiet call does not re-render twice a second.
    onAudioVolumeIndication: (_c, speakers) => {
      if (g !== gen) return;
      const now = (speakers ?? [])
        .filter((v) => (v.volume ?? 0) >= SPEAKING_VOLUME && !(v.uid === 0 && state.muted))
        .map((v) => v.uid ?? 0)
        .sort((a, b) => a - b);
      const before = state.speaking;
      if (now.length === before.length && now.every((u, i) => u === before[i])) return;
      set({ speaking: now });
    },
    onAudioRoutingChanged: (routing) => {
      if (g !== gen) return;
      const speaker = routing === AudioRoute.RouteSpeakerphone || routing === AudioRoute.RouteLoudspeaker;
      if (speaker !== state.speaker) set({ speaker });
    },
    onTokenPrivilegeWillExpire: renew,
    onRequestToken: renew,
    onError: (err) => {
      if (err === ErrorCodeType.ErrTokenExpired || err === ErrorCodeType.ErrInvalidToken) renew();
    },
  };
  handler = h;
  e.registerEventHandler(h);

  try {
    e.enableAudio();
    // Speaking indicators for group calls: every 400 ms, smoothed.
    e.enableAudioVolumeIndication(400, 3, false);
    e.setDefaultAudioRouteToSpeakerphone(state.kind === 'video');
    if (state.kind === 'video') {
      e.enableVideo();
      if (state.cameraOn) {
        e.enableLocalVideo(true);
        e.startPreview();
      } else {
        e.enableLocalVideo(false);
      }
    }
  } catch (err) {
    console.warn('call: agora setup:', errorText(err));
  }
  set({ engineReady: true });

  try {
    const tok = await takeToken(channel, localUid);
    if (g !== gen || engine !== e) return;
    // The token is signed for the server's uid; join with exactly that one.
    if (tok.uid && tok.uid !== localUid) {
      localUid = tok.uid;
      set({ localUid });
    }
    const rc = e.joinChannel(tok.token, channel, localUid, {
      channelProfile: ChannelProfileType.ChannelProfileCommunication,
      clientRoleType: ClientRoleType.ClientRoleBroadcaster,
      publishMicrophoneTrack: true,
      publishCameraTrack: state.kind === 'video' && state.cameraOn,
      autoSubscribeAudio: true,
      autoSubscribeVideo: true,
    });
    if (rc < 0) throw new ApiError('agora_join_failed', `joinChannel ${rc}`);
  } catch (err) {
    if (g !== gen) return;
    console.warn('call: join failed:', errorText(err));
    const msg = callError(err);
    hangUp('failed');
    set({ error: msg });
  }
}

// Agora volume runs 0-255; below this is breathing and room noise.
const SPEAKING_VOLUME = 28;

function setRemoteMuted(remoteUid: number, muted: boolean) {
  const r = state.remotes[remoteUid];
  if (!r || r.muted === muted) return;
  set({ remotes: { ...state.remotes, [remoteUid]: { ...r, muted } } });
}

function releaseEngine() {
  const e = engine;
  engine = null;
  const h = handler;
  const unlock = releaseLock;
  handler = null;
  releaseLock = null;
  if (!e) {
    unlock?.();
    return;
  }
  try {
    if (h) e.unregisterEventHandler(h);
  } catch {}
  // Off the current stack: a call can end from inside one of the engine's own
  // callbacks, and Agora must not be released from within its callback.
  setTimeout(() => {
    try {
      e.stopPreview();
    } catch {}
    try {
      e.leaveChannel();
    } catch {}
    try {
      e.release();
    } catch {}
    unlock?.();
  }, 0);
}

function resetResources() {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  unsubs.forEach((u) => {
    try {
      u();
    } catch {}
  });
  unsubs = [];
  tokenFor = null;
  acceptedHere = false;
  invites.clear();
  releaseEngine();
  stopRinging();
  keepAwake(false);
  stopAudioForeground('call');
}

function finish(reason: EndReason, error: ErrorMsg = null) {
  if (!isCallActive()) return;
  // Whatever ended it, a ringing notification for this call is stale now.
  const ringing = state.phase === 'incoming' ? state.row?.id : null;
  if (ringing) {
    markCallOver(ringing);
    void dismissIncomingCall(ringing);
  }
  gen++;
  resetResources();
  set({
    phase: 'ended',
    endReason: reason,
    endedAt: Date.now(),
    media: 'idle',
    engineReady: false,
    remoteVideo: false,
    remotes: {},
    speaking: [],
    ...(error ? { error } : {}),
  });
}
