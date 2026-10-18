// Live walkie-talkie voice in a chat (client note 26).
//
// Replaces the deprecated openWalkieChannel() in live.ts, which pushed WebM
// recorder chunks over realtime and could only ever play the first one. The
// audio now goes through Agora; Supabase realtime only carries who is there
// and who is talking.
//
//   audio   : one Agora channel per chat, 'walkie_<chatId>'. The agora-token
//             Edge Function signs it only for members of the chat (migration
//             0106, walkie_allowed); anyone else gets 403 'agora_forbidden'.
//             Members join as AUDIENCE (microphone closed) while the thread is
//             open with walkie on, and become broadcaster only while holding.
//             The token is always asked for as 'host', so that switch needs
//             no second round trip: a publisher token is also good for an
//             audience client.
//   signal  : realtime topic 'walkie:<chatId>', the topic the web app already
//             listens on. Presence says who has walkie on; the broadcast
//             event 'talking' ({ from, isTalking, name, t }) is the one
//             web/js/views.js turns into its "X is talking" banner, so a web
//             user sees the banner even though it cannot play Agora audio.
//
// Agora session guard: createAgoraRtcEngine() returns ONE native engine for
// the whole app, shared by live rooms (features/live/useAgoraAudio.ts), 1:1
// calls and walkie. Walkie is the least important of the three, so:
//   - walkie refuses to start while a live room or call holds the engine;
//   - a live room or call that claims the engine first stops walkie
//     synchronously (it leaves and releases before the caller initializes).
// Live rooms and calls should call claimAgora('live' | 'call') before
// createAgoraRtcEngine() and the returned release() in their cleanup.
import type { RealtimeChannel } from '@supabase/supabase-js';

import { fetchAgoraToken, type AgoraToken } from './agora';
import { supabase } from './client';
import type { Uuid } from './types';

// ---------- Agora session guard ----------

export type AgoraOwner = 'live' | 'call' | 'walkie';

let others = 0; // live rooms and calls holding the engine
let walkieHolder: { stop: () => void } | null = null;

/**
 * Claims the shared Agora engine. Returns a release function (safe to call
 * twice), or null when walkie asks while a live room or call holds it.
 * A 'live' or 'call' claim always succeeds and first stops a running walkie
 * through the `onPreempt` it registered.
 */
export function claimAgora(owner: AgoraOwner, onPreempt?: () => void): (() => void) | null {
  if (owner === 'walkie') {
    if (others > 0) return null;
    const entry = { stop: onPreempt ?? (() => {}) };
    walkieHolder = entry;
    return () => {
      if (walkieHolder === entry) walkieHolder = null;
    };
  }
  const w = walkieHolder;
  walkieHolder = null;
  if (w) {
    try {
      w.stop();
    } catch {}
  }
  others++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    others = Math.max(0, others - 1);
  };
}

/** True while a live room or call holds the Agora engine. */
export function agoraBusy() {
  return others > 0;
}

// ---------- Audio channel ----------

export const walkieChannelName = (chatId: Uuid) => `walkie_${chatId}`;

/** A publisher token for the chat's walkie channel; members only (403 otherwise). */
export function fetchWalkieToken(chatId: Uuid, agoraUid: number): Promise<AgoraToken> {
  return fetchAgoraToken(walkieChannelName(chatId), agoraUid, 'host');
}

// ---------- Presence and "is talking" ----------

export type WalkiePresence = { user_id: Uuid; on: boolean; talking: boolean };
export type WalkieTalking = { from: Uuid | null; isTalking: boolean; name?: string | null; t: number };

export type WalkieSignal = {
  /** Updates this device's presence and, when talking changes, broadcasts it. */
  update: (state: { on: boolean; talking: boolean }) => void;
  close: () => void;
};

export function openWalkieSignal(
  chatId: Uuid,
  me: Uuid,
  myName: string | null,
  handlers: {
    onPresence: (people: WalkiePresence[]) => void;
    onTalking: (p: WalkieTalking) => void;
  },
): WalkieSignal {
  const channel: RealtimeChannel = supabase.channel(`walkie:${chatId}`, {
    config: { broadcast: { ack: false, self: false }, presence: { key: me } },
  });
  let state = { on: false, talking: false };
  let subscribed = false;
  let closed = false;

  const track = () => {
    if (!subscribed || closed) return;
    void channel.track({ user_id: me, on: state.on, talking: state.talking }).catch(() => {});
  };

  channel
    .on('presence', { event: 'sync' }, () => {
      if (closed) return;
      const raw = channel.presenceState<WalkiePresence>();
      const people = new Map<string, WalkiePresence>();
      for (const metas of Object.values(raw)) {
        for (const m of metas) {
          if (!m?.user_id || m.user_id === me) continue;
          const prev = people.get(m.user_id);
          // One person on two devices: on/talking if either is.
          people.set(m.user_id, {
            user_id: m.user_id,
            on: !!m.on || !!prev?.on,
            talking: !!m.talking || !!prev?.talking,
          });
        }
      }
      handlers.onPresence([...people.values()]);
    })
    .on('broadcast', { event: 'talking' }, (msg) => {
      const p = msg.payload as WalkieTalking | undefined;
      if (closed || !p || !p.from || p.from === me) return;
      handlers.onTalking(p);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        subscribed = true;
        track();
      }
    });

  return {
    update: (next) => {
      const talkingChanged = next.talking !== state.talking;
      state = next;
      track();
      if (talkingChanged && subscribed && !closed) {
        void channel
          .send({
            type: 'broadcast',
            event: 'talking',
            payload: { from: me, isTalking: next.talking, name: myName, t: Date.now() } satisfies WalkieTalking,
          })
          .catch(() => {});
      }
    },
    close: () => {
      if (closed) return;
      // Tell the others we stopped before going, if we were mid-sentence.
      if (state.talking && subscribed) {
        void channel
          .send({
            type: 'broadcast',
            event: 'talking',
            payload: { from: me, isTalking: false, name: myName, t: Date.now() } satisfies WalkieTalking,
          })
          .catch(() => {});
      }
      closed = true;
      void channel.untrack().catch(() => {});
      void supabase.removeChannel(channel);
    },
  };
}
