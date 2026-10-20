// Group chats: the Group Info screen's reads and every admin action.
//
// The actions are SECURITY DEFINER RPCs from 0147_group_admin.sql, which
// check the caller's membership and role and write a 'system' line into the
// chat ("Allen renamed the group"). Until 0147 is applied, rename / photo /
// add / remove / leave fall back to the direct table writes the 0018 policies
// allow (the creator only, no system line); making admins and deleting the
// group have no fallback and throw ApiError('needs_update').
//
// ApiError codes thrown here (the screen maps them with groupErrorKey):
//   needs_update        the RPC is not in the database yet (0147)
//   not_admin           you are not an admin (or the fallback write matched nothing)
//   not_member          you are not in this group (any more)
//   group_not_found     the group no longer exists
//   owner_protected     the owner cannot be removed or demoted
//   owner_only          only the owner can do that (remove an admin, delete)
//   name_required / name_too_long / bad_photo_url / too_many / target_not_member
import type { PostgrestError } from '@supabase/supabase-js';

import { addGroupMembers, chatKeys } from './chat';
import { ApiError, requireUid, supabase, uid } from './client';
import type { Iso, UserSummary, Uuid } from './types';
import { type LocalMedia, uploadToStorage } from './upload';

export const groupKeys = {
  detail: (chatId: Uuid) => ['chats', 'group', chatId] as const,
};

// Everything that shows a group's name, photo or members: the thread header
// (chatKeys.info), the inbox (chatKeys.chats) and this screen. All three
// start with 'chats', but the thread's messages do not need refetching.
export const groupQueryKeys = (chatId: Uuid) => [groupKeys.detail(chatId), chatKeys.info(chatId), chatKeys.chats()];

export type GroupRole = 'owner' | 'admin' | 'member';

export type GroupMember = UserSummary & {
  role: GroupRole;
  joined_at: Iso | null;
  isMe: boolean;
};

export type GroupDetail = {
  id: Uuid;
  name: string | null;
  photo_url: string | null;
  created_by: Uuid | null;
  created_at: Iso | null;
  members: GroupMember[];
  myRole: GroupRole | null;
  // The chat does not exist, is not yours to read, or you were removed.
  missing?: boolean;
  // A 1:1 chat reached this screen by a stale link.
  notGroup?: boolean;
};

export const MAX_GROUP_NAME = 60;

const MEMBER_PROFILE = 'profiles:profiles!chat_members_user_id_fkey(id, name, handle, avatar_url, verified)';

const RANK: Record<GroupRole, number> = { owner: 0, admin: 1, member: 2 };

function asRole(r: unknown): GroupRole {
  return r === 'owner' || r === 'admin' ? r : 'member';
}

export function isAdminRole(role: GroupRole | null | undefined) {
  return role === 'owner' || role === 'admin';
}

export async function fetchGroup(chatId: Uuid): Promise<GroupDetail> {
  const me = await uid();
  const [chatRes, membersRes] = await Promise.all([
    supabase.from('chats').select('id, type, name, photo_url, created_by, created_at').eq('id', chatId).maybeSingle(),
    supabase.from('chat_members').select(`user_id, role, joined_at, ${MEMBER_PROFILE}`).eq('chat_id', chatId),
  ]);
  if (chatRes.error) throw chatRes.error;
  if (membersRes.error) throw membersRes.error;
  const chat = chatRes.data as {
    id: Uuid;
    type: string;
    name: string | null;
    photo_url: string | null;
    created_by: Uuid | null;
    created_at: Iso | null;
  } | null;
  const rows = (membersRes.data ?? []) as unknown as {
    user_id: Uuid;
    role: string | null;
    joined_at: Iso | null;
    profiles: UserSummary | null;
  }[];

  const base = {
    id: chatId,
    name: chat?.name ?? null,
    photo_url: chat?.photo_url ?? null,
    created_by: chat?.created_by ?? null,
    created_at: chat?.created_at ?? null,
  };
  // Not a member any more: the chat row is still readable by its creator,
  // but the screen has nothing to manage.
  const mine = rows.find((r) => r.user_id === me);
  if (!chat || !mine) return { ...base, members: [], myRole: null, missing: true };
  if (chat.type !== 'group') return { ...base, members: [], myRole: null, notGroup: true };

  const members: GroupMember[] = rows.map((r) => ({
    id: r.user_id,
    name: r.profiles?.name ?? null,
    handle: r.profiles?.handle ?? null,
    avatar_url: r.profiles?.avatar_url ?? null,
    verified: r.profiles?.verified ?? null,
    // Before 0147 a creator added by the old web app may be a plain member.
    role: r.user_id === chat.created_by && r.role !== 'owner' && !rows.some((o) => o.role === 'owner') ? 'owner' : asRole(r.role),
    joined_at: r.joined_at,
    isMe: r.user_id === me,
  }));
  // You first, then the owner, admins, and everyone else by name.
  members.sort((a, b) => {
    if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
    if (RANK[a.role] !== RANK[b.role]) return RANK[a.role] - RANK[b.role];
    return (a.name || a.handle || '').localeCompare(b.name || b.handle || '');
  });
  return { ...base, members, myRole: members.find((m) => m.isMe)?.role ?? null };
}

// ---------- Errors ----------

function isMissingFunction(error: PostgrestError | null, status?: number) {
  if (!error) return false;
  return error.code === 'PGRST202' || error.code === '42883' || status === 404;
}

const KNOWN = [
  'not_admin',
  'not_member',
  'group_not_found',
  'owner_protected',
  'owner_only',
  'name_required',
  'name_too_long',
  'bad_photo_url',
  'too_many',
  'target_not_member',
  'use_leave',
] as const;

// The RPCs raise a bare code as the message (0147). Anything else stays the
// raw error, and the screen shows a generic line.
function toApiError(error: PostgrestError): Error {
  const code = KNOWN.find((k) => error.message === k);
  return code ? new ApiError(code, code) : error;
}

async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<{ data: T; missing: false } | { missing: true }> {
  const { data, error, status } = await supabase.rpc(fn, args);
  if (error) {
    if (isMissingFunction(error, status)) return { missing: true };
    throw toApiError(error);
  }
  return { data: data as T, missing: false };
}

// The i18n key for an error from any function here.
export function groupErrorKey(e: unknown): string {
  const code = e instanceof ApiError ? e.code : '';
  switch (code) {
    case 'needs_update':
      return 'groupInfo.err.needsUpdate';
    case 'not_admin':
      return 'groupInfo.err.notAdmin';
    case 'not_member':
    case 'group_not_found':
      return 'groupInfo.err.gone';
    case 'owner_protected':
      return 'groupInfo.err.ownerProtected';
    case 'owner_only':
      return 'groupInfo.err.ownerOnly';
    case 'name_required':
      return 'groupInfo.err.nameRequired';
    case 'name_too_long':
      return 'groupInfo.err.nameTooLong';
    case 'too_many':
      return 'groupInfo.err.tooMany';
    case 'target_not_member':
      return 'groupInfo.err.targetGone';
    default:
      return 'groupInfo.err.generic';
  }
}

// ---------- Actions ----------

export async function renameGroup(chatId: Uuid, name: string): Promise<void> {
  const clean = name.trim().slice(0, MAX_GROUP_NAME);
  if (!clean) throw new ApiError('name_required');
  const r = await callRpc<null>('rename_group', { p_chat_id: chatId, p_name: clean });
  if (!r.missing) return;
  const { data, error } = await supabase.from('chats').update({ name: clean }).eq('id', chatId).select('id');
  if (error) throw error;
  if (!data?.length) throw new ApiError('not_admin');
}

// Uploads to the public group-photos bucket (as createGroup does), then
// saves the URL. Group photos are private content and are not screened by
// moderation, for the same reason as createGroup.
export async function setGroupPhoto(chatId: Uuid, photo: LocalMedia | null): Promise<void> {
  await requireUid();
  const url = photo ? await uploadToStorage('group-photos', photo, { prefix: 'group', upsert: true }) : null;
  const r = await callRpc<null>('set_group_photo', { p_chat_id: chatId, p_photo_url: url });
  if (!r.missing) return;
  const { data, error } = await supabase.from('chats').update({ photo_url: url }).eq('id', chatId).select('id');
  if (error) throw error;
  if (!data?.length) throw new ApiError('not_admin');
}

export type AddStatus = 'added' | 'already_member' | 'blocked' | 'not_allowed' | 'not_found' | 'group_full';
export type AddResult = { user_id: Uuid; status: AddStatus };

export async function addMembers(chatId: Uuid, userIds: Uuid[]): Promise<AddResult[]> {
  const ids = Array.from(new Set(userIds));
  if (!ids.length) return [];
  const r = await callRpc<AddResult[]>('add_group_members', { p_chat_id: chatId, p_user_ids: ids });
  if (!r.missing) return r.data ?? [];
  // Before 0147: the creator-only insert policy; a refusal cannot say why.
  const skipped = new Set(await addGroupMembers(chatId, ids));
  return ids.map((id) => ({ user_id: id, status: skipped.has(id) ? 'not_allowed' : 'added' }));
}

export async function removeMember(chatId: Uuid, userId: Uuid): Promise<void> {
  const r = await callRpc<null>('remove_group_member', { p_chat_id: chatId, p_user_id: userId });
  if (!r.missing) return;
  const { data, error } = await supabase
    .from('chat_members')
    .delete()
    .eq('chat_id', chatId)
    .eq('user_id', userId)
    .select('user_id');
  if (error) throw error;
  if (!data?.length) throw new ApiError('not_admin');
}

export async function setAdmin(chatId: Uuid, userId: Uuid, admin: boolean): Promise<void> {
  const r = await callRpc<null>('set_group_admin', { p_chat_id: chatId, p_user_id: userId, p_admin: admin });
  if (r.missing) throw new ApiError('needs_update');
}

export type LeaveResult = { deleted: boolean; new_owner: Uuid | null };

export async function leaveGroup(chatId: Uuid): Promise<LeaveResult> {
  const r = await callRpc<LeaveResult>('leave_group', { p_chat_id: chatId });
  if (!r.missing) return r.data ?? { deleted: false, new_owner: null };
  const me = await requireUid();
  const { error } = await supabase.from('chat_members').delete().eq('chat_id', chatId).eq('user_id', me);
  if (error) throw error;
  return { deleted: false, new_owner: null };
}

export async function deleteGroup(chatId: Uuid): Promise<void> {
  const r = await callRpc<null>('delete_group', { p_chat_id: chatId });
  if (r.missing) throw new ApiError('needs_update');
}
