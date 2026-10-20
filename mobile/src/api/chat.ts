// Chats, message requests, groups, messages, reactions, realtime and unread
// counts. Port of the Chats section of web/js/db.js.
//
// ApiError codes thrown here:
//   not_signed_in          (from requireUid)
//   cannot_dm_yourself     openOrCreateDm with your own id
//   dm_unavailable         open_or_create_dm returned no chat id
//   cannot_delete_message  the delete matched no row (not yours, or already gone)
//   quota_exceeded         upload_quota_status refused the attachment; detail is the
//                          quota row ({ reason, uploads_limit, ... }) so the screen
//                          can say which limit was hit
//   attachment_unsigned    the attachment uploaded but no signed URL came back
//                          (usually a missing SELECT policy on chat-media)
//
// Client note 10: WhatsApp-style ticks per message (sent / delivered / read).
// Read is chat_members.last_read_at (0041, stamped by markChatRead);
// delivered is chat_members.last_delivered_at (0099, stamped by
// markChatDelivered / markAllDelivered when messages reach this device).
// fetchReceipts + subscribeToReceipts give the other members' stamps and
// tickFor turns them into a tick for one of your own messages. Without 0099
// delivered falls back to read, so the ticks go straight from one to blue.
import type { PostgrestError, RealtimeChannel } from '@supabase/supabase-js';

import { ApiError, requireUid, supabase, uid, listenerTopic } from './client';
import type { Iso, Unsubscribe, UserSummary, Uuid } from './types';
import { type LocalMedia, uploadToBucket, uploadToStorage } from './upload';

export const chatKeys = {
  all: ['chats'] as const,
  chats: () => ['chats'] as const,
  info: (chatId: Uuid) => ['chats', 'info', chatId] as const,
  otherLastRead: (chatId: Uuid) => ['chats', 'otherLastRead', chatId] as const,
  receipts: (chatId: Uuid) => ['chats', 'receipts', chatId] as const,
  unreadCount: () => ['chats', 'unreadCount'] as const,
  messages: (chatId: Uuid) => ['messages', chatId] as const,
};

// ---------- Types ----------

export type ChatType = 'dm' | 'group';

export type MessageType =
  | 'text'
  | 'voice'
  | 'image'
  | 'video'
  | 'sticker'
  | 'system'
  | 'file'
  | 'location'
  | 'call';

export type Chat = {
  id: Uuid;
  type: ChatType;
  name: string | null;
  photo_url: string | null;
  created_by: Uuid | null;
  created_at: Iso;
};

export type ChatMember = {
  chat_id: Uuid;
  user_id: Uuid;
  role?: 'owner' | 'member' | string;
  last_read_at?: Iso | null;
  profiles: UserSummary | null;
};

// The latest message of a chat, as the inbox preview reads it.
export type LastMessage = {
  chat_id: Uuid;
  text: string | null;
  type: MessageType;
  from_user_id: Uuid;
  created_at: Iso;
};

export type ChatListItem = Chat & {
  others: (UserSummary | null)[];
  last_message: LastMessage | undefined;
  unread_count: number;
  is_request: boolean;
  title: string;
  avatar: string | null | undefined;
};

export type ChatInfo = {
  id: Uuid;
  type: ChatType;
  others: UserSummary[];
  memberCount: number;
  title: string;
  photo: string;
  // The chat does not exist or you are not in it (a stale link).
  missing?: boolean;
};

export type Reaction = { user_id: Uuid; emoji: string };

type MessageAuthor = { id: Uuid; name: string | null; avatar_url?: string | null };

export type ReplyTarget = {
  id: Uuid;
  type: MessageType;
  text: string | null;
  attachment_url: string | null;
  from_user_id: Uuid;
  from: MessageAuthor | null;
};

// A message as the thread renders it. reply_to_id, reply_to and reactions
// are absent when the basic select was used (0042 not applied).
export type Message = {
  id: Uuid;
  type: MessageType;
  text: string | null;
  attachment_url: string | null;
  from_user_id: Uuid;
  created_at: Iso;
  reply_to_id?: Uuid | null;
  from: MessageAuthor | null;
  reply_to?: ReplyTarget | null;
  reactions?: Reaction[];
};

// A raw messages row: what an insert returns and what realtime delivers.
export type MessageRow = {
  id: Uuid;
  chat_id: Uuid;
  from_user_id: Uuid;
  type: MessageType;
  text: string | null;
  attachment_url: string | null;
  reply_to_id?: Uuid | null;
  created_at: Iso;
};

// Another member's read state in one chat, for the ticks. A null stamp means
// "never stamped" and counts as joined_at. Without 0099, last_delivered_at is
// a copy of last_read_at.
export type Receipt = {
  user_id: Uuid;
  last_delivered_at: Iso | null;
  last_read_at: Iso | null;
  joined_at: Iso | null;
};

export type Tick = 'sent' | 'delivered' | 'read';

// Shown when a chat has no usable name. The web app shows these exact
// strings; screens may translate them instead.
export const GROUP_FALLBACK_TITLE = 'مجموعة';
export const DM_FALLBACK_TITLE = 'محادثة';

const MEMBER_PROFILE = 'profiles:profiles!chat_members_user_id_fkey(id, name, handle, avatar_url)';

// ---------- Chats ----------

// Details for ONE chat (title, photo, members), for the thread header.
export async function fetchChatInfo(chatId: Uuid): Promise<ChatInfo> {
  const me = await uid();
  const [{ data: chat, error: chatError }, { data: members }] = await Promise.all([
    supabase.from('chats').select('id, type, name, photo_url').eq('id', chatId).maybeSingle(),
    supabase.from('chat_members').select(`user_id, ${MEMBER_PROFILE}`).eq('chat_id', chatId),
  ]);
  // A failed read is an error to retry; only a clean "no such chat" (not a
  // member, or never existed) is reported as missing.
  if (chatError) throw chatError;
  const c = chat as Pick<Chat, 'id' | 'type' | 'name' | 'photo_url'> | null;
  const rows = (members ?? []) as unknown as Pick<ChatMember, 'user_id' | 'profiles'>[];
  const others = rows
    .filter((m) => m.user_id !== me)
    .map((m) => m.profiles)
    .filter((p): p is UserSummary => !!p);
  const isGroup = c?.type === 'group';
  return {
    id: chatId,
    type: c?.type || 'dm',
    others,
    memberCount: rows.length,
    title: isGroup ? c?.name || GROUP_FALLBACK_TITLE : others[0]?.name || others[0]?.handle || DM_FALLBACK_TITLE,
    photo: isGroup ? c?.photo_url || '' : others[0]?.avatar_url || '',
    ...(c ? {} : { missing: true }),
  };
}

// The people YOU have blocked. Only that direction is readable (the
// `blocks read own` policy, 0004); the other one is already hidden by 0054.
async function blockedIds(me: Uuid): Promise<Uuid[]> {
  try {
    const { data } = await supabase.from('blocks').select('blocked_id').eq('blocker_id', me);
    return ((data ?? []) as { blocked_id: Uuid }[]).map((r) => r.blocked_id);
  } catch {
    return [];
  }
}

// The inbox. After the membership lookup, every read goes out together:
// this used to be three sequential steps (batch, unread counts, request
// flags) and measured 765 ms against a 158 ms single-query baseline.
//
// The RPCs are wrapped so one missing function cannot take the inbox down:
// without 0041 there are no unread marks, without 0043 nothing is a request,
// and the list still loads either way.
export async function fetchChats(): Promise<ChatListItem[]> {
  const me = await uid();
  if (!me) return [];
  const { data: memberships } = await supabase.from('chat_members').select('chat_id').eq('user_id', me);
  const chatIds = ((memberships ?? []) as { chat_id: Uuid }[]).map((r) => r.chat_id);
  if (!chatIds.length) return [];

  // Loading the inbox means everything up to now has reached this device.
  void markAllDelivered();

  const [{ data: chats }, lastMsgs, { data: members }, unreadRes, flagsRes, blockedList] =
    await Promise.all([
      supabase.from('chats').select('id, type, name, photo_url, created_by, created_at').in('id', chatIds),
      latestMessages(chatIds),
      supabase.from('chat_members').select(`chat_id, user_id, ${MEMBER_PROFILE}`).in('chat_id', chatIds),
      supabase.rpc('chat_unread_counts').then(
        (r) => r,
        (e: unknown) => ({ data: null, error: e }),
      ),
      supabase.rpc('chat_request_flags').then(
        (r) => r,
        (e: unknown) => ({ data: null, error: e }),
      ),
      blockedIds(me),
    ]);

  // Latest message per chat (the list is newest first; the RPC already has
  // one per chat, the fallback has the whole history).
  const lastByChat: Record<Uuid, LastMessage> = {};
  for (const m of lastMsgs) {
    if (!lastByChat[m.chat_id]) lastByChat[m.chat_id] = m;
  }
  const membersByChat: Record<Uuid, ChatMember[]> = {};
  for (const m of (members ?? []) as unknown as ChatMember[]) {
    (membersByChat[m.chat_id] ??= []).push(m);
  }

  const unreadByChat: Record<Uuid, number> = {};
  if (unreadRes.error) console.warn('unread counts unavailable (is 0041 applied?):', unreadRes.error);
  else
    for (const r of (unreadRes.data ?? []) as { chat_id: Uuid; unread_count: number }[]) {
      unreadByChat[r.chat_id] = r.unread_count;
    }

  const requestByChat: Record<Uuid, boolean> = {};
  if (flagsRes.error) console.warn('request flags unavailable (is 0043 applied?):', flagsRes.error);
  else
    for (const r of (flagsRes.data ?? []) as { chat_id: Uuid; is_request: boolean }[]) {
      requestByChat[r.chat_id] = !!r.is_request;
    }

  // DMs with someone you blocked drop out of the inbox. 0049 already stops
  // the messages; this is a display choice about your own inbox. Groups are
  // left alone, as in 0049: blocking one person should not hide a group
  // other people are still in.
  const blocked = new Set(blockedList);

  return ((chats ?? []) as Chat[])
    .filter((c) => {
      if (c.type === 'group' || !blocked.size) return true;
      const others = (membersByChat[c.id] ?? []).filter((m) => m.user_id !== me);
      return !others.some((m) => blocked.has(m.user_id));
    })
    .map((c): ChatListItem => {
      const others = (membersByChat[c.id] ?? []).filter((m) => m.user_id !== me).map((m) => m.profiles);
      const last = lastByChat[c.id];
      return {
        ...c,
        others,
        last_message: last,
        unread_count: unreadByChat[c.id] || 0,
        is_request: !!requestByChat[c.id],
        // An empty display name is falsy: try the handle before giving up.
        title:
          c.type === 'group'
            ? c.name || GROUP_FALLBACK_TITLE
            : others[0]?.name || others[0]?.handle || DM_FALLBACK_TITLE,
        avatar: c.type === 'group' ? c.photo_url : others[0]?.avatar_url,
      };
    })
    .sort(
      (a, b) =>
        new Date(b.last_message?.created_at || b.created_at).getTime() -
        new Date(a.last_message?.created_at || a.created_at).getTime(),
    );
}

// A function that is not in the database yet: PostgREST reports PGRST202
// (not in its schema cache), Postgres 42883, and the HTTP status is 404.
function isMissingFunction(error: PostgrestError | null, status?: number): boolean {
  if (!error) return false;
  return error.code === 'PGRST202' || error.code === '42883' || status === 404;
}

// The newest message of each chat, newest first. chat_latest_messages (0100)
// returns one row per chat; reading every message of every chat (the old way,
// kept as the fallback before 0100) grew with the whole history. Rows are cut
// down to LastMessage so the inbox shape does not change with the source.
async function latestMessages(chatIds: Uuid[]): Promise<LastMessage[]> {
  const pick = (m: LastMessage): LastMessage => ({
    chat_id: m.chat_id,
    text: m.text,
    type: m.type,
    from_user_id: m.from_user_id,
    created_at: m.created_at,
  });
  const res = await supabase.rpc('chat_latest_messages', { p_chat_ids: chatIds });
  if (!res.error) return ((res.data ?? []) as MessageRow[]).map(pick);
  if (isMissingFunction(res.error, res.status)) {
    console.warn('chat_latest_messages unavailable (is 0100 applied?):', res.error.message);
  } else {
    console.warn('chat_latest_messages failed, reading all messages:', res.error.message);
  }
  const { data } = await supabase
    .from('messages')
    .select('chat_id, text, type, from_user_id, created_at')
    .in('chat_id', chatIds)
    .order('created_at', { ascending: false });
  return (data ?? []) as LastMessage[];
}

// When did the OTHER person last open this conversation? Backs the "Seen"
// line under your own last message (0041). Null for a group (no single other
// person) or when the read state cannot be read, so the caller shows nothing.
export async function fetchOtherLastRead(chatId: Uuid): Promise<Iso | null> {
  try {
    const me = await uid();
    if (!me || !chatId) return null;
    const { data, error } = await supabase
      .from('chat_members')
      .select('user_id, last_read_at')
      .eq('chat_id', chatId)
      .neq('user_id', me);
    const rows = data as { user_id: Uuid; last_read_at: Iso | null }[] | null;
    if (error || !rows || rows.length !== 1) return null;
    return rows[0].last_read_at || null;
  } catch {
    return null;
  }
}

// Stamps "you have seen everything up to now" on your own membership row.
// Called when a chat is opened; safe without 0041, never throws. The caller
// invalidates chatKeys.chats() since the unread dot has gone.
export async function markChatRead(chatId: Uuid): Promise<void> {
  try {
    const me = await uid();
    if (!me || !chatId) return;
    await supabase.rpc('mark_chat_read', { p_chat_id: chatId });
  } catch (e) {
    console.warn('mark_chat_read:', e);
  }
}

// ---------- Delivery ticks (0099) ----------

// Calls already running per chat. The inbox and the open thread both see
// each insert, so one message would otherwise fire two identical calls. A
// call asked for while one runs is replayed once after it, so a message that
// landed after the running statement read the clock is still acknowledged.
const deliveringChats = new Map<Uuid, { again: boolean }>();

// Stamps "messages of this chat have reached this device" on your own
// membership row, which turns the sender's one tick into two. The database
// only writes when something newer from someone else exists. Never throws:
// without 0099 the RPC is missing and the ticks fall back to read state.
export async function markChatDelivered(chatId: Uuid): Promise<void> {
  if (!chatId) return;
  const running = deliveringChats.get(chatId);
  if (running) {
    running.again = true;
    return;
  }
  const state = { again: false };
  deliveringChats.set(chatId, state);
  try {
    do {
      state.again = false;
      const { error } = await supabase.rpc('mark_chat_delivered', { p_chat_id: chatId });
      if (error) {
        console.warn('mark_chat_delivered (is 0099 applied?):', error.message);
        break;
      }
    } while (state.again);
  } catch (e) {
    console.warn('mark_chat_delivered:', e);
  } finally {
    deliveringChats.delete(chatId);
  }
}

// The same for every chat you belong to. Called by fetchChats; screens should
// also call it when the app comes to the foreground. Never throws.
export async function markAllDelivered(): Promise<void> {
  try {
    const me = await uid();
    if (!me) return;
    const { error } = await supabase.rpc('mark_all_delivered');
    if (error) console.warn('mark_all_delivered (is 0099 applied?):', error.message);
  } catch (e) {
    console.warn('mark_all_delivered:', e);
  }
}

// A select that named last_delivered_at before 0099: Postgres 42703
// (undefined column), or PostgREST naming the column in its message.
function isMissingDeliveredColumn(error: PostgrestError | null): boolean {
  if (!error) return false;
  return error.code === '42703' || /last_delivered_at/.test(error.message ?? '');
}

type ReceiptRow = Omit<Receipt, 'last_delivered_at'> & { last_delivered_at?: Iso | null };

// Without the column, delivery is only known through reading.
function toReceipt(r: ReceiptRow): Receipt {
  return {
    user_id: r.user_id,
    last_delivered_at: r.last_delivered_at === undefined ? r.last_read_at : r.last_delivered_at,
    last_read_at: r.last_read_at ?? null,
    joined_at: r.joined_at ?? null,
  };
}

// The other members' read state in one chat, for tickFor. Members can read
// each other's rows ("chat_member self read", 0018). Never throws: on failure
// it returns [], and tickFor shows one tick.
export async function fetchReceipts(chatId: Uuid): Promise<Receipt[]> {
  try {
    const me = await uid();
    if (!me || !chatId) return [];
    const q = (cols: string) => supabase.from('chat_members').select(cols).eq('chat_id', chatId).neq('user_id', me);
    let { data, error } = await q('user_id, last_delivered_at, last_read_at, joined_at');
    if (error && isMissingDeliveredColumn(error)) {
      console.warn('last_delivered_at unavailable (is 0099 applied?):', error.message);
      ({ data, error } = await q('user_id, last_read_at, joined_at'));
    }
    if (error) {
      console.warn('fetchReceipts:', error.message);
      return [];
    }
    return ((data ?? []) as unknown as ReceiptRow[]).map(toReceipt);
  } catch (e) {
    console.warn('fetchReceipts:', e);
    return [];
  }
}

// Another member's stamps moved (they received or read something). The
// callback gets that member's new receipt; your own row is skipped. Without
// 0099 chat_members is not in the realtime publication and this never fires,
// so the screen should still refetch receipts when it regains focus.
export function subscribeToReceipts(chatId: Uuid, cb: (receipt: Receipt) => void): Unsubscribe {
  return subscribeWithMe((me) =>
    supabase
      .channel(listenerTopic(`receipts:${chatId}`))
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chat_members', filter: `chat_id=eq.${chatId}` },
        (payload) => {
          const row = payload.new as ReceiptRow;
          if (!row?.user_id || row.user_id === me) return;
          try {
            cb(toReceipt(row));
          } catch {}
        },
      )
      .subscribe(),
  );
}

// Microseconds since the epoch. Postgres keeps microseconds and a stamp can
// land in the same millisecond as a message, so Date.parse alone (whole
// milliseconds) could call an unread message read. Null when unparseable.
function stampMicros(iso: Iso | null | undefined): number | null {
  if (!iso) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(iso);
  if (!m) {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? null : t * 1000;
  }
  let zone = m[4] ?? 'Z';
  if (/^[+-]\d{2}$/.test(zone)) zone += ':00';
  else if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const base = Date.parse(`${m[1]}T${m[2]}${zone}`);
  if (Number.isNaN(base)) return null;
  return base * 1000 + Number((m[3] ?? '').padEnd(6, '0').slice(0, 6));
}

// The tick for one of YOUR messages, given the other members' receipts.
// Every other member must have reached a state for it to show (a group's
// ticks follow its slowest member). A null stamp counts as joined_at; reading
// implies delivery. No receipts (still loading, or the read failed) is 'sent'.
export function tickFor(message: Pick<Message, 'created_at'>, receipts: Receipt[]): Tick {
  const at = stampMicros(message.created_at);
  if (at === null || !receipts.length) return 'sent';
  let read = true;
  let delivered = true;
  for (const r of receipts) {
    const joined = stampMicros(r.joined_at);
    const readAt = stampMicros(r.last_read_at) ?? joined;
    const deliveredStamp = stampMicros(r.last_delivered_at) ?? joined;
    const deliveredAt =
      readAt === null ? deliveredStamp : deliveredStamp === null ? readAt : Math.max(readAt, deliveredStamp);
    if (readAt === null || at > readAt) read = false;
    if (deliveredAt === null || at > deliveredAt) delivered = false;
    if (!delivered) break;
  }
  if (read) return 'read';
  return delivered ? 'delivered' : 'sent';
}

// Accepting moves a request into the inbox proper. Declining removes you
// from the conversation, deliberately silently, so a stranger learns nothing.
export async function acceptChatRequest(chatId: Uuid): Promise<void> {
  const me = await uid();
  if (!me || !chatId) return;
  const { error } = await supabase.rpc('accept_chat_request', { p_chat_id: chatId });
  if (error) throw error;
}

export async function declineChatRequest(chatId: Uuid): Promise<void> {
  const me = await uid();
  if (!me || !chatId) return;
  const { error } = await supabase.rpc('decline_chat_request', { p_chat_id: chatId });
  if (error) throw error;
}

// One conversation per pair, decided by the database in one statement.
// A client-side read-then-insert let two people pressing Message at once
// each create a chat (five such twin pairs existed). 0093 merged them, keyed
// a DM by its two members with a unique index, and put find-or-create in
// open_or_create_dm, which runs as the definer.
export async function openOrCreateDm(otherUserId: Uuid): Promise<Uuid> {
  const me = await requireUid();
  if (otherUserId === me) throw new ApiError('cannot_dm_yourself');
  const { data, error } = await supabase.rpc('open_or_create_dm', { p_other: otherUserId });
  if (error) throw error;
  if (!data) throw new ApiError('dm_unavailable');
  return data as Uuid;
}

// Not screened by moderation, for the same reason as messages (see
// sendMessage): a private group's name and photo are private content.
export async function createGroup({
  name,
  memberIds,
  photo,
}: {
  name: string;
  memberIds: Uuid[];
  photo?: LocalMedia | null;
}): Promise<{ chatId: Uuid; skipped: Uuid[] }> {
  const me = await requireUid();

  let photo_url: string | null = null;
  if (photo) {
    // `<uid>/group-<ts>.<ext>`, the same path the web app writes.
    photo_url = await uploadToStorage('group-photos', photo, { prefix: 'group', upsert: true });
  }

  const { data: chat, error: e1 } = await supabase
    .from('chats')
    .insert({ type: 'group', name, photo_url, created_by: me })
    .select('id')
    .single();
  if (e1) throw e1;
  const chatId = (chat as { id: Uuid }).id;

  const { error: e2 } = await supabase.from('chat_members').insert({ chat_id: chatId, user_id: me, role: 'owner' });
  if (e2) throw e2;
  const skipped = await addGroupMembers(
    chatId,
    memberIds.filter((u) => u !== me),
  );
  return { chatId, skipped };
}

// Since 0116 the database only lets you add someone who would accept a DM
// from you (blocks, restrict list, "who can message me"). One person who
// would not used to fail the whole batch, so: the batch first, and if the
// policy refuses it (42501), one at a time. Returns the ids that could not be
// added, for the screen to mention; someone already in the group (23505)
// counts as added.
export async function addGroupMembers(chatId: Uuid, userIds: Uuid[]): Promise<Uuid[]> {
  const ids = Array.from(new Set(userIds));
  if (!ids.length) return [];
  const rows = ids.map((u) => ({ chat_id: chatId, user_id: u, role: 'member' }));
  const { error } = await supabase.from('chat_members').insert(rows);
  if (!error) return [];
  if (error.code !== '42501' && error.code !== '23505') throw error;
  const skipped: Uuid[] = [];
  for (const row of rows) {
    const { error: e } = await supabase.from('chat_members').insert(row);
    if (e && e.code !== '23505') skipped.push(row.user_id);
  }
  return skipped;
}

export async function removeGroupMember(chatId: Uuid, userId: Uuid): Promise<void> {
  const { error } = await supabase.from('chat_members').delete().eq('chat_id', chatId).eq('user_id', userId);
  if (error) throw error;
}

// ---------- Messages ----------

// The reply target and reactions are embedded, not fetched per message (a
// thread of 100 would otherwise be 200 extra round trips). The reply target
// is addressed by its COLUMN (reply_to_id): an earlier guess at the
// constraint name failed every fetch and silently fell back to the basic
// select, so replies and reactions did nothing.
const MSG_SELECT_FULL = `
    id, type, text, attachment_url, from_user_id, created_at, reply_to_id,
    from:profiles!messages_from_user_id_fkey ( id, name, avatar_url ),
    reply_to:reply_to_id (
      id, type, text, attachment_url, from_user_id,
      from:profiles!messages_from_user_id_fkey ( id, name )
    ),
    reactions:message_reactions ( user_id, emoji )
`;
const MSG_SELECT_BASIC = `
    id, type, text, attachment_url, from_user_id, created_at,
    from:profiles!messages_from_user_id_fkey ( id, name, avatar_url )
`;

// The NEWEST `limit` messages, returned oldest to newest.
//
// This once asked for the oldest hundred (ascending with a limit), so in any
// chat longer than the limit the recent messages were never fetched: a
// 117-message chat hid its last 17, including a voice note that showed in
// the notification and the inbox preview but not in the thread. The chat
// screen's catch-up after a dropped websocket also calls this, and was
// re-reading the same old page and finding nothing new.
export async function fetchMessages(chatId: Uuid, limit = 100): Promise<Message[]> {
  const q = (sel: string) =>
    supabase.from('messages').select(sel).eq('chat_id', chatId).order('created_at', { ascending: false }).limit(limit);

  let { data, error } = await q(MSG_SELECT_FULL);
  if (error) {
    // Without 0042 the reply column and reactions table do not exist. The
    // thread still loads, just without replies or reactions.
    console.warn('messages: replies/reactions unavailable (is 0042 applied?)', error);
    ({ data, error } = await q(MSG_SELECT_BASIC));
    if (error) throw error;
  }
  // Back into reading order: every consumer assumes oldest to newest.
  return refreshAttachmentUrls(((data ?? []) as unknown as Message[]).slice().reverse());
}

// chat-media is private and a message stores a signed URL that lasts 7 days,
// so older photos and voice notes went blank. On every load the path is read
// back out of the stored URL and signed again, in one call per thread. A URL
// that is not a chat-media signed URL is left as it is.
const SIGNED_PATH = /\/storage\/v1\/object\/sign\/chat-media\/([^?]+)/;

async function refreshAttachmentUrls(messages: Message[]): Promise<Message[]> {
  const paths = new Map<string, string>(); // stored url -> object path
  for (const m of messages) {
    const match = m.attachment_url?.match(SIGNED_PATH);
    if (m.attachment_url && match) paths.set(m.attachment_url, decodeURIComponent(match[1]));
  }
  if (!paths.size) return messages;
  const { data, error } = await supabase.storage
    .from('chat-media')
    .createSignedUrls([...new Set(paths.values())], 60 * 60 * 24 * 7);
  if (error || !data) return messages;
  const fresh = new Map<string, string>();
  for (const r of data) if (r.path && r.signedUrl) fresh.set(r.path, r.signedUrl);
  return messages.map((m) => {
    const path = m.attachment_url ? paths.get(m.attachment_url) : undefined;
    const url = path ? fresh.get(path) : undefined;
    return url ? { ...m, attachment_url: url } : m;
  });
}

// Deleting your own message ("messages delete own", 0018).
//
// .select() so the result says WHAT was deleted: a delete the policy hides
// removes nothing and still reports success, and the message would reappear
// on the next load.
//
// The attachment is deliberately left in storage. Rebuilding its key from a
// signed URL risks deleting someone else's file; an orphan only costs space.
// The caller invalidates chatKeys.chats() (preview line and ordering change).
export async function deleteMessage(messageId: Uuid): Promise<true> {
  const { data, error } = await supabase.from('messages').delete().eq('id', messageId).select('id');
  if (error) throw error;
  if (!data || !data.length) throw new ApiError('cannot_delete_message');
  return true;
}

// Returns the emoji now standing, or null when the reaction was cleared.
export async function toggleMessageReaction(messageId: Uuid, emoji: string): Promise<string | null> {
  await requireUid();
  const { data, error } = await supabase.rpc('toggle_message_reaction', {
    p_message_id: messageId,
    p_emoji: emoji,
  });
  if (error) throw error;
  return (data as string | null) || null;
}

type UploadQuota = { allowed: boolean; reason?: string; uploads_limit?: number } & Record<string, unknown>;

// Pre-check so a refusal can say why. The storage policy is what actually
// stops the upload; a missing RPC (migration not applied) never blocks.
async function uploadQuota(): Promise<UploadQuota | null> {
  const { data, error } = await supabase.rpc('upload_quota_status');
  if (error) return null;
  return data as UploadQuota | null;
}

// Uploads a chat attachment and returns a 7-day signed URL (chat-media is a
// PRIVATE bucket, 0001/0067, so its public URL does not serve).
//
// The path must start with the sender's id: the storage policy checks
// (storage.foldername(name))[1] = auth.uid(), and user_uploads_today() reads
// the same segment for the daily quota. With the chat id first, every
// attachment once failed RLS. The chat id stays in the path for tracing.
async function uploadChatAttachment(chatId: Uuid, media: LocalMedia): Promise<string> {
  const q = await uploadQuota();
  if (q && !q.allowed) throw new ApiError('quota_exceeded', q.reason ?? 'quota_exceeded', q);

  // chat-media is private: upload, then hand out a signed URL for the path.
  const path = await uploadToBucket('chat-media', media, { prefix: `${chatId}/msg` });

  // Checked rather than assumed: without a SELECT policy on the bucket this
  // returns null, which looks like a client bug but is a missing policy.
  const { data: signed, error: signErr } = await supabase.storage
    .from('chat-media')
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  if (signErr || !signed?.signedUrl) throw new ApiError('attachment_unsigned', signErr?.message);
  return signed.signedUrl;
}

// A private conversation is NOT screened by moderation, on purpose. The
// moderation provider is Gemini's unpaid tier, whose terms let Google use and
// human-review submitted content. Blocking and reporting already cover DMs,
// and Apple's Guideline 1.2 is about content people encounter, not private
// correspondence. Removed at the call site so it cannot regress silently;
// moderate-content also refuses kind 'message' server-side. It also removed
// ~400 ms from every send. Revisit only on a paid tier.
//
// Optimistic bubbles: register the pending send BEFORE awaiting this. The
// realtime INSERT can arrive before this resolves, and a bubble that only
// learns its id afterwards gets drawn twice.
//
// The caller invalidates chatKeys.chats() (preview line and ordering moved).
export async function sendMessage({
  chatId,
  text,
  type = 'text',
  media = null,
  replyToId = null,
}: {
  chatId: Uuid;
  text: string;
  type?: MessageType;
  media?: LocalMedia | null;
  replyToId?: Uuid | null;
}): Promise<MessageRow> {
  const me = await requireUid();

  const row: {
    chat_id: Uuid;
    from_user_id: Uuid;
    type: MessageType;
    text: string;
    reply_to_id?: Uuid;
    attachment_url?: string;
  } = { chat_id: chatId, from_user_id: me, type, text };
  // Only sent when set, so a database without 0042 still accepts messages.
  if (replyToId) row.reply_to_id = replyToId;
  if (media) row.attachment_url = await uploadChatAttachment(chatId, media);

  const { data, error } = await supabase.from('messages').insert(row).select().single();
  if (error) throw error;
  return data as MessageRow;
}

// ---------- Realtime ----------

// Starts a channel once our id is known (shared with calls.ts). The returned
// function also works when called before the channel exists (the screen
// unmounted first); db.js leaked the channel in that case.
export function subscribeWithMe(make: (me: Uuid) => RealtimeChannel | null): Unsubscribe {
  let channel: RealtimeChannel | null = null;
  let closed = false;
  void (async () => {
    const me = await uid();
    if (!me || closed) return;
    channel = make(me);
  })();
  return () => {
    closed = true;
    if (channel) void supabase.removeChannel(channel);
    channel = null;
  };
}

// A message from someone else reached this device: tell its sender (two
// grey ticks). Fire-and-forget; markChatDelivered never throws.
function acknowledge(row: MessageRow | null | undefined) {
  if (!row?.chat_id) return;
  void (async () => {
    const me = await uid();
    if (me && row.from_user_id !== me) await markChatDelivered(row.chat_id);
  })();
}

// New messages in one chat. RLS filters the stream to member chats. Inserts
// from other people are also marked delivered.
export function subscribeToMessages(chatId: Uuid, cb: (row: MessageRow) => void): Unsubscribe {
  const channel = supabase
    .channel(listenerTopic(`messages:${chatId}`))
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
      (payload) => {
        const row = payload.new as MessageRow;
        acknowledge(row);
        cb(row);
      },
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

// Reactions and "delete for everyone" made by the OTHER side while this
// thread is open. Neither table row carries a usable chat filter on DELETE
// (the old row holds only its key unless REPLICA IDENTITY FULL, 0141), so
// the callbacks get the ids and the screen decides whether they concern it.
// Needs messages and message_reactions in the realtime publication (0003,
// 0042; 0141 re-asserts both).
export function subscribeToMessageChanges(
  onDeleted: (messageId: Uuid) => void,
  onReaction: (messageId: Uuid | null) => void,
): Unsubscribe {
  const channel = supabase
    .channel(listenerTopic('message-changes'))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload) => {
      const id = (payload.old as { id?: Uuid } | null)?.id;
      if (id) onDeleted(id);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, (payload) => {
      const row = (payload.new as { message_id?: Uuid } | null)?.message_id
        ? (payload.new as { message_id: Uuid })
        : (payload.old as { message_id?: Uuid } | null);
      onReaction(row?.message_id ?? null);
    })
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

// Every new message in any chat this person belongs to (RLS filters to
// member chats, so no filter here). The inbox and the tab badge repaint on
// each one without the chat being opened; the callback should invalidate
// chatKeys.chats() and chatKeys.unreadCount().
//
// The topic is unique per subscription: the inbox screen and the badge both
// subscribe, and two channels with one topic made supabase-js reject the
// second, so one of them never fired.
//
// Inserts from other people are also marked delivered, so the sender sees two
// ticks while this app is open even if the chat is not.
export function subscribeToInbox(cb: (row: MessageRow) => void): Unsubscribe {
  return subscribeWithMe((me) =>
    supabase
      .channel('inbox:' + me + ':' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const row = payload.new as MessageRow;
        if (row?.chat_id && row.from_user_id !== me) void markChatDelivered(row.chat_id);
        try {
          cb(row);
        } catch {}
      })
      .subscribe(),
  );
}

// Unread messages across all chats, for the tab badge. Never throws.
export async function countUnreadChats(): Promise<number> {
  try {
    const me = await uid();
    if (!me) return 0;
    const { data, error } = await supabase.rpc('chat_unread_counts');
    if (error || !Array.isArray(data)) return 0;
    return (data as { unread_count: number | string | null }[]).reduce(
      (n, r) => n + (Number(r.unread_count) || 0),
      0,
    );
  } catch {
    return 0;
  }
}
