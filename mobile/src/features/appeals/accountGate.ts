// What happens to the account the moment someone signs in (or the app
// restores their session):
//   * banned      -> nothing is reactivated; the banned screen is shown
//   * deactivated -> reactivated ("Just sign in again to reactivate it")
//   * deletion scheduled -> cancelled ("If you sign in during those 30 days,
//                    the deletion is cancelled and everything is kept")
// reactivate_account() (0034) clears both deactivated_at and
// deletion_scheduled_at in one call.
import { reactivateAccount, fetchAccountStatus, type AccountStatus } from '@/api/settings';
import type { Iso } from '@/api/types';

export type GateResult =
  | { kind: 'ok' }
  | { kind: 'banned'; until: Iso | null; reason: string | null }
  | { kind: 'reactivated'; deletionCancelled: boolean }
  | { kind: 'reactivateFailed' };

export function isBanned(s: AccountStatus | null | undefined): boolean {
  if (!s) return false;
  if (s.banned) return true;
  return !!s.banned_until && new Date(s.banned_until).getTime() > Date.now();
}

export async function runAccountGate(): Promise<GateResult> {
  const status = await fetchAccountStatus();
  if (!status) return { kind: 'ok' };
  if (isBanned(status)) {
    return { kind: 'banned', until: status.banned_until ?? null, reason: status.ban_reason ?? null };
  }
  if (!status.deactivated && !status.deletion_scheduled_at) return { kind: 'ok' };
  try {
    await reactivateAccount();
    return { kind: 'reactivated', deletionCancelled: !!status.deletion_scheduled_at };
  } catch {
    // The Account status screen still offers the button.
    return { kind: 'reactivateFailed' };
  }
}
