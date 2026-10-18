// Gifts (client note 17): the gift tray, sending a gift, and the feed of gifts
// arriving in a live stream. No web counterpart: no client ever called
// send_gift before, which is how its notification bug went unnoticed (0104).
//
// Money moves only inside send_gift (0017, amended by 0104): it locks the
// sender's wallet, checks the balance, debits, credits the recipient and
// writes both ledger rows in one transaction. Nothing here touches wallets.
//
// Until 0104 is applied:
//   - gifts has no name_en / asset_url / sort_order and lacks the agreed gifts
//     (horse, camel, ...); fetchGifts falls back to the 0001 columns;
//   - send_gift fails for every recipient with gift notifications on (the
//     default), because notify_on_gift writes a type the notifications check
//     constraint refuses; that surfaces as 'gift_unavailable';
//   - gift_transactions is not in realtime, so subscribeToLiveGifts is silent.
//
// ApiError codes introduced in this file (mapped from send_gift's messages):
//   insufficient_balance        'insufficient balance': send the user to top up
//   gift_not_found              'gift not found' (unknown or retired gift)
//   gift_invalid_price          'invalid gift price' (a catalogue mistake)
//   gift_no_recipient           'recipient required'
//   gift_to_self                'cannot send a gift to yourself'
//   gift_recipient_not_in_live  'recipient is not in this live stream' (not the
//                               host or an accepted guest)
//   gift_unavailable            send_gift missing, or the 0030 notification bug
//                               before 0104 (check constraint 23514)
// Shared codes also thrown here, the same as live.ts:
//   not_signed_in   'must be signed in'
//   blocked         'cannot send a gift to this account' (a block either way)
//   live_not_found  'live stream not found'
//   live_not_live   'live stream has ended'
import type { PostgrestError, RealtimePostgresInsertPayload } from '@supabase/supabase-js';

import { ApiError, listenerTopic, supabase } from './client';
import type { Iso, Unsubscribe, Uuid } from './types';

export const giftKeys = {
  all: () => ['gifts'] as const,
  catalogue: () => ['gifts', 'catalogue'] as const,
  live: (liveStreamId: string) => ['gifts', 'live', liveStreamId] as const,
};

// public.gifts. The id is a readable text key ('rose', 'horse'). name has
// always been the Arabic name; name_en, asset_url and sort_order arrive with
// 0104 and are null / 0 before it.
export type Gift = {
  id: string;
  name: string;
  name_en: string | null;
  emoji: string | null;
  price: number;
  active: boolean;
  /** Lottie JSON or image; null means show the emoji. */
  asset_url: string | null;
  sort_order: number;
};

// public.gift_transactions as stored (what the realtime INSERT carries).
export type GiftTransactionRow = {
  id: Uuid;
  from_user_id: Uuid;
  to_user_id: Uuid;
  gift_id: string;
  live_stream_id: Uuid | null;
  amount: number;
  created_at: Iso;
};

type GiftRowLoose = Partial<Gift> & Pick<Gift, 'id' | 'name' | 'price'>;

function shapeGift(r: GiftRowLoose): Gift {
  return {
    id: r.id,
    name: r.name,
    name_en: r.name_en ?? null,
    emoji: r.emoji ?? null,
    price: r.price,
    active: r.active ?? true,
    asset_url: r.asset_url ?? null,
    sort_order: r.sort_order ?? 0,
  };
}

// The tray, in its intended order. The read policy already hides inactive
// gifts; the filter is kept so the intent is visible here.
export async function fetchGifts(): Promise<Gift[]> {
  const first = await supabase
    .from('gifts')
    .select('id, name, name_en, emoji, price, active, asset_url, sort_order')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('price', { ascending: true });
  if (!first.error) return ((first.data ?? []) as GiftRowLoose[]).map(shapeGift);

  // Before 0104 the new columns do not exist (42703). Take whatever is there
  // and order by price, which matches the 0001 seed order.
  const fallback = await supabase
    .from('gifts')
    .select('*')
    .eq('active', true)
    .order('price', { ascending: true });
  if (fallback.error) throw fallback.error;
  return ((fallback.data ?? []) as GiftRowLoose[]).map(shapeGift);
}

const SEND_GIFT_ERRORS: Record<string, string> = {
  'must be signed in': 'not_signed_in',
  'recipient required': 'gift_no_recipient',
  'cannot send a gift to yourself': 'gift_to_self',
  'gift not found': 'gift_not_found',
  'invalid gift price': 'gift_invalid_price',
  'cannot send a gift to this account': 'blocked',
  'live stream not found': 'live_not_found',
  'live stream has ended': 'live_not_live',
  'recipient is not in this live stream': 'gift_recipient_not_in_live',
  'insufficient balance': 'insufficient_balance',
};

function sendGiftError(error: PostgrestError): Error {
  const msg = (error.message || '').trim();
  const code = SEND_GIFT_ERRORS[msg];
  if (code) return new ApiError(code, msg, error);
  if (error.code === 'PGRST202' || error.code === '42883' || error.code === '23514') {
    return new ApiError('gift_unavailable', 'gifts are not available yet', error);
  }
  return error as unknown as Error;
}

export type SendGiftInput = {
  toUserId: Uuid;
  giftId: string;
  /** The stream the gift is sent in; the recipient must be its host or an accepted guest. */
  liveStreamId?: Uuid | null;
};

// Returns the gift_transactions id. The sender's balance changed on the
// server: invalidate walletKeys after a success.
export async function sendGift({ toUserId, giftId, liveStreamId = null }: SendGiftInput): Promise<Uuid> {
  const { data, error } = await supabase.rpc('send_gift', {
    p_to_user_id: toUserId,
    p_gift_id: giftId,
    p_live_stream_id: liveStreamId,
  });
  if (error) throw sendGiftError(error);
  return data as Uuid;
}

// Gifts sent in a stream, as raw rows: the screen resolves gift_id against
// the catalogue and from_user_id to a profile. Includes the viewer's own
// gifts, so a screen that animates on send should skip rows it already shows.
export function subscribeToLiveGifts(
  liveStreamId: Uuid,
  cb: (row: GiftTransactionRow) => void,
): Unsubscribe {
  const ch = supabase
    .channel(listenerTopic('live-gifts-' + liveStreamId))
    .on<GiftTransactionRow>(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'gift_transactions',
        filter: `live_stream_id=eq.${liveStreamId}`,
      },
      (payload: RealtimePostgresInsertPayload<GiftTransactionRow>) => cb(payload.new),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}
