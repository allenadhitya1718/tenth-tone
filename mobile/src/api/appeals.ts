// Appeals against a ban or a moderation action (migration 0132). The terms
// promise an appeal in Settings > Account status; everything here works while
// the account is banned (nothing on the server checks the ban for these).
//
// ApiError codes thrown by submitAppeal:
//   appeal_reason_required | appeal_reason_too_long | appeal_not_eligible
//   appeal_already_open | appeal_already_decided | appeal_limit_open
//   appeals_unavailable (0132 not applied)
import { ApiError, requireUid, supabase, uid } from './client';
import type { Iso, Uuid } from './types';

export type AppealTargetType = 'user' | 'video' | 'comment' | 'story' | 'live_comment' | 'live_stream';
export type AppealStatus = 'open' | 'accepted' | 'rejected';

export type Appeal = {
  id: Uuid;
  user_id: Uuid;
  kind: 'ban' | 'content';
  target_type: AppealTargetType;
  target_id: Uuid;
  reason: string;
  status: AppealStatus;
  admin_note: string | null;
  created_at: Iso;
  decided_at: Iso | null;
};

export type AppealableItem = {
  kind: 'ban' | 'content';
  target_type: AppealTargetType;
  target_id: Uuid;
  actioned_at: Iso;
  reason: string | null;
  preview: { text?: string; thumbnail?: string | null; deleted?: boolean; until?: Iso | null };
  appeal: Pick<Appeal, 'id' | 'status' | 'admin_note' | 'created_at' | 'decided_at'> | null;
};

export const APPEAL_REASON_MIN = 10;
export const APPEAL_REASON_MAX = 1000;
export const APPEAL_MAX_OPEN = 3;

export const appealKeys = {
  items: () => ['appeals', 'items'] as const,
  mine: () => ['appeals', 'mine'] as const,
};

const KNOWN = [
  'appeal_reason_required',
  'appeal_reason_too_long',
  'appeal_not_eligible',
  'appeal_already_open',
  'appeal_already_decided',
  'appeal_limit_open',
] as const;

function missingMigration(e: { code?: string; message?: string } | null) {
  const m = e?.message ?? '';
  return e?.code === 'PGRST202' || e?.code === '42P01' || e?.code === 'PGRST205' || /does not exist|schema cache/i.test(m);
}

// What the signed-in person can appeal, newest first, each with its latest
// appeal. Empty before 0132 is applied.
export async function fetchAppealableItems(): Promise<AppealableItem[]> {
  if (!(await uid())) return [];
  const { data, error } = await supabase.rpc('my_appealable_items');
  if (error) {
    if (missingMigration(error)) return [];
    throw error;
  }
  return Array.isArray(data) ? (data as AppealableItem[]) : [];
}

export async function fetchMyAppeals(): Promise<Appeal[]> {
  const me = await uid();
  if (!me) return [];
  const { data, error } = await supabase
    .from('appeals')
    .select('id,user_id,kind,target_type,target_id,reason,status,admin_note,created_at,decided_at')
    .eq('user_id', me)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    if (missingMigration(error)) return [];
    throw error;
  }
  return (data as Appeal[] | null) ?? [];
}

export async function submitAppeal(p: { targetType: AppealTargetType; targetId: Uuid; reason: string }): Promise<void> {
  const me = await requireUid();
  const reason = p.reason.trim();
  if (reason.length < 1) throw new ApiError('appeal_reason_required');
  if (reason.length > APPEAL_REASON_MAX) throw new ApiError('appeal_reason_too_long');
  const { error } = await supabase.from('appeals').insert({
    user_id: me,
    kind: p.targetType === 'user' ? 'ban' : 'content',
    target_type: p.targetType,
    target_id: p.targetId,
    reason,
  });
  if (!error) return;
  const msg = error.message ?? '';
  const hit = KNOWN.find((k) => msg.includes(k));
  if (hit) throw new ApiError(hit, msg, error);
  // The partial unique index (two taps racing past the trigger).
  if (error.code === '23505') throw new ApiError('appeal_already_open', msg, error);
  if (missingMigration(error)) throw new ApiError('appeals_unavailable', msg, error);
  throw error;
}

// A ban that ends this far out is shown as permanent: the admin panel bans
// "forever" with a far-future date.
export function isPermanentBan(until: Iso | null | undefined) {
  if (!until) return true;
  return new Date(until).getTime() - Date.now() > 50 * 365 * 24 * 3600 * 1000;
}
