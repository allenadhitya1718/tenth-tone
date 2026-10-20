// Sending a video into chats ("Send to", 0146) and reading a shared video
// back for its chat card.
//
// A 'video_share' message carries the video's canonical share link
// (videoLink, https://flyp-sa.com/v/<id>) in attachment_url, and the same
// link in text so an app without the card shows a plain link. The database
// only accepts that exact link shape (messages_video_share_url_check).
//
// ApiError codes thrown here:
//   video_share_unsupported  the database refused type 'video_share' (0146 not
//                            applied); every send fails the same way
import { ApiError, supabase } from './client';
import { openOrCreateDm, sendMessage } from './chat';
import { countShare, videoLink } from './discover';
import type { UserSummary, Uuid } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHARE_LINK = /^https:\/\/flyp-sa\.com\/v\/([0-9a-fA-F-]{36})(?:[/?#].*)?$/;

// The most chats one send reaches (Instagram's limit too).
export const SEND_TO_MAX = 10;

// The video id inside a stored share link, or null.
export function parseVideoShare(url: string | null | undefined): Uuid | null {
  const m = url ? SHARE_LINK.exec(url.trim()) : null;
  const id = m?.[1]?.toLowerCase();
  return id && UUID.test(id) ? id : null;
}

export const sharedVideoKey = (id: Uuid) => ['sharedVideo', id] as const;

export type SharedVideo = {
  id: Uuid;
  description: string | null;
  thumbnail: string | null;
  user: Pick<UserSummary, 'id' | 'name' | 'handle' | 'avatar_url'> | null;
};

// What the chat card needs. Null when the viewer cannot see the video: the
// row is gone, the videos policy hides it (private account, followers-only,
// a block), or it is hidden by moderation, archived or back in drafts.
// Throws only on a failed read, so the card can offer a retry.
export async function fetchSharedVideo(id: Uuid): Promise<SharedVideo | null> {
  const { data, error } = await supabase
    .from('videos')
    .select(
      `id, description, thumbnail, is_hidden, is_draft, is_archived,
       user:profiles!videos_user_id_fkey ( id, name, handle, avatar_url )`,
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  const row = data as unknown as (SharedVideo & { is_hidden?: boolean; is_draft?: boolean; is_archived?: boolean }) | null;
  if (!row || row.is_hidden || row.is_draft || row.is_archived) return null;
  return { id: row.id, description: row.description, thumbnail: row.thumbnail, user: row.user };
}

// A chat to send to: an existing chat, or a person whose DM is found or
// created first.
export type SendTarget = { chatId: Uuid } | { userId: Uuid };

export type SendResult = {
  sent: number;
  failed: number;
  // Chat ids that received the video, so the caller can refresh them.
  chatIds: Uuid[];
  // Per target, in the order given: whether it received the video.
  ok: boolean[];
  // The first error, for the screen to explain a total failure.
  error: unknown;
};

// A refusal of the type itself (0146 not applied): the check constraint names it.
function isTypeRefusal(e: unknown) {
  return /messages_type_check|messages_video_share_url_check/.test(String((e as Error)?.message ?? ''));
}

// Sends the card (and the note after it, as a normal text message) to every
// target. Chats run in parallel; within one chat the card goes first so the
// note reads as its caption. One failed chat does not stop the rest. A share
// is counted once for the whole send when at least one chat got the card.
export async function sendVideoToChats({
  videoId,
  targets,
  note,
}: {
  videoId: Uuid;
  targets: SendTarget[];
  note: string;
}): Promise<SendResult> {
  const link = videoLink(videoId.toLowerCase());
  const text = note.trim();
  const list = targets.slice(0, SEND_TO_MAX);
  const results = await Promise.allSettled(
    list.map(async (target) => {
      const chatId = 'chatId' in target ? target.chatId : await openOrCreateDm(target.userId);
      await sendMessage({ chatId, text: link, type: 'video_share', attachmentUrl: link });
      // The card has landed; a failed note still counts as a sent share.
      if (text) {
        try {
          await sendMessage({ chatId, text });
        } catch (e) {
          console.warn('send-to: note failed in', chatId, (e as Error)?.message ?? e);
        }
      }
      return chatId;
    }),
  );
  const chatIds: Uuid[] = [];
  const ok = results.map((r) => r.status === 'fulfilled');
  let error: unknown = null;
  for (const r of results) {
    if (r.status === 'fulfilled') chatIds.push(r.value);
    else {
      console.warn('send-to failed:', (r.reason as Error)?.message ?? r.reason);
      error ??= r.reason;
    }
  }
  if (chatIds.length) void countShare(videoId);
  if (!chatIds.length && error && isTypeRefusal(error)) error = new ApiError('video_share_unsupported');
  return { sent: chatIds.length, failed: list.length - chatIds.length, chatIds, ok, error };
}
