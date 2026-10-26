// The JavaScript half of the iPhone CallKit screen (modules/flyp-callkit).
//
// The native module reports a ringing FLYP call to CallKit the moment its
// VoIP push arrives and keeps what the person did with it. This file:
//   - hands the PushKit token to push.ts, which stores it as
//     push_tokens.voip_token (0160) so send-push rings this phone that way;
//   - loads a ringing call into the call session as soon as CallKit shows it,
//     so the app follows the call (the caller giving up ends the CallKit call);
//   - turns Answer / Decline / End / Mute on the CallKit screen into the
//     normal call actions;
//   - ends the CallKit call whenever the FLYP call ends some other way, and
//     tells CallKit when the call was answered on the app's own screen.
// No-op on Android and on builds without the native module.
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { declineCallIfRinging } from '@/api/calls';

import { answerWhenReady, getCallState, hangUp, onCallStateChange, openCall, toggleMute, type EndReason } from './callSession';
import { openCallScreen } from './nav';

type Sub = { remove: () => void };
type CallKitEvent = { event?: string; action?: string; callId?: string; muted?: boolean; token?: string };
type FlypCallKitModule = {
  getVoipToken(): string | null;
  takePending(): CallKitEvent[];
  endCall(callId: string, reason: string): void;
  callConnected(callId: string): void;
  addListener(name: 'token' | 'action' | 'incoming', cb: (e: CallKitEvent) => void): Sub;
};

const native = Platform.OS === 'ios' ? requireOptionalNativeModule<FlypCallKitModule>('FlypCallKit') : null;

export const hasCallKit = () => !!native;

/** The PushKit token of this phone, now and whenever it changes. */
export function watchVoipToken(cb: (token: string | null) => void): () => void {
  if (!native) return () => {};
  cb(native.getVoipToken() || null);
  const sub = native.addListener('token', (e) => cb(e.token || null));
  return () => sub.remove();
}

// CallKit's own reasons for a call that ended without its buttons.
function endedWhy(r: EndReason | null): string {
  switch (r) {
    case 'missed':
      return 'missed';
    case 'answered_elsewhere':
      return 'elsewhere';
    case 'failed':
    case 'network':
    case 'not_found':
      return 'failed';
    default:
      return 'remote';
  }
}

function onAction(e: CallKitEvent) {
  const callId = e.callId;
  if (!callId) return;
  const s = getCallState();
  const here = s.row?.id === callId;
  if (e.action === 'answer') {
    answerWhenReady(callId);
    openCallScreen(callId);
  } else if (e.action === 'end') {
    if (here) hangUp();
    else void declineCallIfRinging(callId).catch(() => {});
  } else if (e.action === 'mute') {
    if (here && s.muted !== !!e.muted) toggleMute();
  }
}

function onIncoming(e: CallKitEvent) {
  // Follow the call while CallKit rings, even with no screen open.
  if (e.callId) void openCall(e.callId);
}

let started = false;

/** Mount once while signed in (useCallNotifications). Returns the stop. */
export function startCallKitBridge(): () => void {
  if (!native || started) return () => {};
  started = true;
  const subs = [native.addListener('action', onAction), native.addListener('incoming', onIncoming)];
  // What happened before JavaScript was listening (a VoIP push launched the app).
  for (const e of native.takePending()) {
    if (e.event === 'incoming') onIncoming(e);
    else if (e.event === 'action') onAction(e);
  }

  let lastId: string | null = null;
  let lastPhase = getCallState().phase;
  const off = onCallStateChange(() => {
    const s = getCallState();
    const id = s.row?.id ?? null;
    if (id) lastId = id;
    if (s.phase === lastPhase) return;
    const was = lastPhase;
    lastPhase = s.phase;
    if (!lastId) return;
    // Answered on the app's screen: CallKit stops ringing too.
    if (was === 'incoming' && (s.phase === 'connecting' || s.phase === 'connected')) native.callConnected(lastId);
    // Over, however it ended: take the CallKit call away (a no-op when
    // CallKit itself ended it).
    if (s.phase === 'ended') native.endCall(lastId, endedWhy(s.endReason));
  });

  return () => {
    started = false;
    subs.forEach((x) => x.remove());
    off();
  };
}
