import type { Ionicons } from '@expo/vector-icons';

import type { Notification } from '@/api/notifications';

type IconName = keyof typeof Ionicons.glyphMap;

// What a row says: a translation key (under discover.notif.text), its
// params, whether the actor's name leads the sentence, and a small badge
// icon. Port of textFor() in V.notifications (web/js/views.js).
export type Described = {
  key: string;
  params?: Record<string, string | number>;
  withActor: boolean;
  icon: IconName;
};

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const short = (v: unknown, max = 80) => {
  const s = str(v);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

export function payloadOf(n: Pick<Notification, 'payload'>): Record<string, unknown> {
  return n.payload ?? {};
}

// "1:05:09" or "4:07".
function duration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function describe(n: Notification): Described {
  const p = payloadOf(n);
  const kind = str(p.kind);
  // 'gift' is a real type (0030 / 0104) that the shared union does not list.
  const type = String(n.type);

  switch (type) {
    case 'like':
      // A comment like reuses type 'like' (0072); the payload tells them
      // apart. send-push reads kind 'comment', the web app 'comment_like'.
      if (kind === 'comment_like' || kind === 'comment') {
        const text = short(p.excerpt ?? p.text);
        return text
          ? { key: 'likedComment', params: { text }, withActor: true, icon: 'heart' }
          : { key: 'likedCommentPlain', withActor: true, icon: 'heart' };
      }
      return { key: 'likedVideo', withActor: true, icon: 'heart' };
    case 'comment':
      // A reply is also type 'comment' and carries parent_id; checked first
      // or it would read as a comment on your video.
      if (p.parent_id) return { key: 'replied', params: { text: short(p.text) }, withActor: true, icon: 'chatbubble' };
      return { key: 'commented', params: { text: short(p.text) }, withActor: true, icon: 'chatbubble' };
    case 'mention':
      // 0101: being tagged in a post is a mention with kind 'tag'.
      if (kind === 'tag') return { key: 'tagged', withActor: true, icon: 'pricetag' };
      return { key: 'mentioned', withActor: true, icon: 'at' };
    case 'follow':
      return { key: 'followed', withActor: true, icon: 'person-add' };
    case 'follow_request':
      return { key: 'requested', withActor: true, icon: 'person-add' };
    case 'live': {
      const title = short(p.title, 60);
      return title
        ? { key: 'liveTitled', params: { title }, withActor: true, icon: 'radio' }
        : { key: 'live', withActor: true, icon: 'radio' };
    }
    case 'gift': {
      const amount = Number(p.amount) || 0;
      return amount
        ? { key: 'giftAmount', params: { n: amount }, withActor: true, icon: 'gift' }
        : { key: 'gift', withActor: true, icon: 'gift' };
    }
    case 'message':
      return { key: 'message', withActor: true, icon: 'chatbubbles' };
    case 'system':
      return describeSystem(p, kind);
    default:
      return { key: 'update', withActor: false, icon: 'notifications' };
  }
}

// A system notice is about YOU; most read as a complete sentence without the
// actor, who is often you yourself ("<your name> your live ended").
function describeSystem(p: Record<string, unknown>, kind: string): Described {
  switch (kind) {
    case 'follow_accepted':
      return { key: 'followAccepted', withActor: true, icon: 'person-add' };
    case 'live_started':
      return { key: 'liveStarted', withActor: false, icon: 'radio' };
    case 'live_ended':
      return {
        key: 'liveEnded',
        params: { duration: duration(Number(p.seconds) || 0), peak: Number(p.peak) || 0 },
        withActor: false,
        icon: 'radio',
      };
    case 'storage_alert':
      return { key: 'storage', params: { pct: Number(p.pct) || 0 }, withActor: false, icon: 'warning' };
    case 'location_request':
      return { key: 'locationRequest', withActor: true, icon: 'location' };
    case 'location_approved':
      return { key: 'locationApproved', withActor: true, icon: 'location' };
    case 'location_denied':
      return { key: 'locationDenied', withActor: true, icon: 'location' };
    case 'new_login': {
      // How you notice someone else getting into your account, so it must
      // never render as an empty row.
      const device = str(p.device);
      return device
        ? { key: 'newLogin', params: { device }, withActor: false, icon: 'shield-checkmark' }
        : { key: 'newLoginPlain', withActor: false, icon: 'shield-checkmark' };
    }
    case 'live_join_request':
      return { key: 'liveJoinRequest', withActor: true, icon: 'radio' };
    case 'live_invite':
      return { key: 'liveInvite', withActor: true, icon: 'radio' };
    case 'live_guest_accepted':
      return { key: 'liveGuestAccepted', withActor: true, icon: 'radio' };
    case 'live_guest_approved':
      return { key: 'liveGuestApproved', withActor: true, icon: 'radio' };
    case 'live_guest_removed':
      return { key: 'liveGuestRemoved', withActor: true, icon: 'radio' };
  }
  // The admin broadcast composer writes { title, body }, not { text }.
  const title = str(p.title);
  const body = str(p.body);
  if (title || body) {
    return { key: 'raw', params: { text: title && body ? `${title} — ${body}` : title || body }, withActor: false, icon: 'megaphone' };
  }
  const text = str(p.text);
  if (text) return { key: 'raw', params: { text }, withActor: false, icon: 'notifications' };
  return { key: 'update', withActor: false, icon: 'notifications' };
}

const enc = encodeURIComponent;

// Where tapping a row goes, or null when there is nowhere useful (a finished
// live, a location request answered inline). Port of destinationFor().
export function destinationFor(n: Notification): string | null {
  const p = payloadOf(n);
  const kind = str(p.kind);
  const video = str(p.video_id);
  const actor = n.actor?.id;
  const live = str(p.live_id || p.stream_id);

  switch (String(n.type)) {
    case 'like':
      // A comment like belongs in the thread: it is about something you wrote.
      if ((kind === 'comment_like' || kind === 'comment') && video) return `/comments/${enc(video)}`;
      return video ? `/video/${enc(video)}` : null;
    case 'mention':
      return video ? `/video/${enc(video)}` : null;
    case 'comment':
      return video ? `/comments/${enc(video)}` : null;
    case 'message':
      return p.chat_id ? `/chat/${enc(str(p.chat_id))}` : '/inbox';
    case 'follow':
    case 'gift':
      return actor ? `/user/${enc(actor)}` : null;
    // Straight to the decision, not to their profile.
    case 'follow_request':
      return '/follow-requests';
    // A live alert is only worth anything if it opens the broadcast.
    case 'live':
      return live ? `/live/${enc(live)}` : null;
    case 'system':
      if (kind === 'follow_accepted' || kind === 'location_approved' || kind === 'location_denied') {
        return actor ? `/user/${enc(actor)}` : null;
      }
      if (['live_started', 'live_invite', 'live_join_request', 'live_guest_accepted', 'live_guest_approved'].includes(kind)) {
        return live ? `/live/${enc(live)}` : null;
      }
      if (kind === 'new_login') return '/settings';
      return null;
    default:
      return null;
  }
}

// Who the row's avatar opens, if anyone. System notices about yourself have
// no one to open.
export function actorPath(n: Notification, d: Described): string | null {
  if (!d.withActor || !n.actor?.id) return null;
  return `/user/${enc(n.actor.id)}`;
}
