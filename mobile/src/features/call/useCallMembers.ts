import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import {
  callKeys,
  fetchCallMembers,
  subscribeToCallMembers,
  type CallMemberStatus,
  type CallMemberWithProfile,
} from '@/api/calls';
import type { UserSummary, Uuid } from '@/api/types';
import { showToast } from '@/components/Toast';
import { agoraUidFor } from '@/features/live/config';

import { inviteSentAt } from './callSession';

// Who is in this call, and who is being rung into it (call_members, 0092).
// Read once, then kept current from realtime: a row the cache already has is
// patched in place (the payload has no profile), a new person refetches.
// A slow poll covers a dropped socket.
const EMPTY: CallMemberWithProfile[] = [];
const POLL_MS = 20_000;
// A decline this soon after the ring was sent was the other phone saying
// "already in a call" (useIncomingCalls declines those at once), not a person.
const BUSY_WITHIN_MS = 3_000;

export const isActiveMember = (m: Pick<CallMemberWithProfile, 'status'>) => m.status === 'joined' || m.status === 'ringing';

/** The Agora uid a member joins with: the server derives it from the account. */
export const memberAgoraUid = (m: Pick<CallMemberWithProfile, 'agora_uid' | 'user_id'>) =>
  m.agora_uid != null ? Number(m.agora_uid) : agoraUidFor(m.user_id);

export function memberName(m: { profile: UserSummary | null } | null | undefined, fallback: string) {
  return m?.profile?.name || m?.profile?.handle || fallback;
}

export function useCallMembers(channel: string | null, enabled: boolean): CallMemberWithProfile[] {
  const qc = useQueryClient();
  const on = !!channel && enabled;
  const q = useQuery({
    queryKey: callKeys.members(channel ?? ''),
    queryFn: () => fetchCallMembers(channel!),
    enabled: on,
    staleTime: 0,
    refetchInterval: on ? POLL_MS : false,
  });

  useEffect(() => {
    if (!channel || !enabled) return;
    const key = callKeys.members(channel);
    return subscribeToCallMembers(channel, (row) => {
      if (!row || !row.user_id) return;
      let known = false;
      qc.setQueryData<CallMemberWithProfile[]>(key, (old) => {
        if (!old) return old;
        const i = old.findIndex((m) => m.user_id === row.user_id);
        if (i < 0) return old;
        known = true;
        const next = old.slice();
        next[i] = { ...old[i], ...row, profile: old[i].profile };
        return next;
      });
      if (!known) void qc.invalidateQueries({ queryKey: key });
    });
  }, [channel, enabled, qc]);

  return q.data ?? EMPTY;
}

/** Shows the person this phone just rang as "Ringing…" before the server says so. */
export function useMarkRinging(channel: string | null) {
  const qc = useQueryClient();
  return (user: UserSummary, me: Uuid | null) => {
    if (!channel) return;
    qc.setQueryData<CallMemberWithProfile[]>(callKeys.members(channel), (old) => {
      const list = old ?? [];
      const i = list.findIndex((m) => m.user_id === user.id);
      const now = new Date().toISOString();
      const row: CallMemberWithProfile = {
        channel,
        user_id: user.id,
        root_id: i >= 0 ? list[i].root_id : null,
        invited_by: me,
        status: 'ringing',
        agora_uid: i >= 0 ? list[i].agora_uid : null,
        created_at: i >= 0 ? list[i].created_at : now,
        joined_at: i >= 0 ? list[i].joined_at : null,
        left_at: null,
        profile: i >= 0 ? (list[i].profile ?? user) : user,
      };
      if (i < 0) return [...list, row];
      const next = list.slice();
      next[i] = row;
      return next;
    });
  };
}

/**
 * Short notes as people come and go: joined and left for everyone; declined,
 * busy and no answer only to the person who rang them. Silent for the first
 * read, and for whoever's leaving ends the call (the end screen says that).
 */
export function useMemberToasts(members: CallMemberWithProfile[], me: Uuid | null, active: boolean) {
  const { t } = useTranslation();
  const prev = useRef<Map<Uuid, CallMemberStatus> | null>(null);

  useEffect(() => {
    if (!active || !me) return;
    const before = prev.current;
    const now = new Map(members.map((m) => [m.user_id, m.status] as const));
    prev.current = now;
    if (!before) return;
    const othersJoined = members.filter((m) => m.user_id !== me && m.status === 'joined').length;
    for (const m of members) {
      if (m.user_id === me) continue;
      const was = before.get(m.user_id);
      if (!was || was === m.status) continue;
      const name = memberName(m, t('call.someone'));
      if (m.status === 'joined' && was === 'ringing') {
        showToast(t('call.group.toastJoined', { name }), 'person-add');
      } else if (m.status === 'left' && was === 'joined' && othersJoined >= 1) {
        showToast(t('call.peerLeft', { name }), 'exit-outline');
      } else if (m.invited_by === me && was === 'ringing' && m.status === 'declined') {
        const sent = inviteSentAt(m.user_id);
        const busy = sent != null && Date.now() - sent < BUSY_WITHIN_MS;
        showToast(t(busy ? 'call.group.toastBusy' : 'call.group.toastDeclined', { name }), 'close-circle');
      } else if (m.invited_by === me && was === 'ringing' && m.status === 'missed') {
        showToast(t('call.group.toastNoAnswer', { name }), 'call-outline');
      }
    }
  }, [members, me, active, t]);
}
