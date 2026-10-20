import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { locationKeys, respondToLocationPermit } from '@/api/location';
import type { Notification } from '@/api/notifications';
import { showAlert } from '@/components/Dialog';
import { FollowButton } from '@/features/discover/FollowButton';
import { go } from '@/features/discover/nav';
import { Avatar } from '@/features/discover/parts';
import { makeThemed } from '@/features/discover/themed';
import { timeAgo } from '@/lib/timeAgo';
import { useTheme } from '@/providers/ThemeProvider';

import { actorPath, describe, destinationFor } from './describe';
import { PillButton } from './PillButton';
import { type Decision, useFollowRequestDecision } from './useFollowRequestDecision';

export const NotificationRow = memo(function NotificationRow({
  n,
  requestPending,
  permitPending,
}: {
  n: Notification;
  requestPending: boolean;
  permitPending: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const th = useThemed();
  const d = describe(n);
  const target = destinationFor(n);
  const avatarTarget = actorPath(n, d);
  const actorName = n.actor?.name || t('discover.notif.someone');
  const sentence = t(`discover.notif.text.${d.key}`, d.params);
  const when = timeAgo(n.created_at, t, i18n.language);
  const unread = !n.read_at;

  let trailing = null;
  if (n.type === 'follow' && n.actor?.id) trailing = <FollowButton userId={n.actor.id} name={n.actor.name} />;
  else if (n.type === 'follow_request' && n.actor?.id && requestPending) trailing = <RequestActions userId={n.actor.id} name={actorName} />;
  else if (permitPending && typeof n.payload?.permit_id === 'string') trailing = <PermitActions permitId={n.payload.permit_id} name={actorName} />;

  const a11y = [d.withActor ? `${actorName} ${sentence}` : sentence, when, unread ? t('discover.notif.unread') : null]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={unread ? th.rowUnread : styles.row}>
      <Pressable
        onPress={avatarTarget ? () => go(avatarTarget) : undefined}
        disabled={!avatarTarget}
        // Without a target it is decoration: a Pressable is accessible by
        // default and would otherwise announce the icon-font glyph.
        accessible={!!avatarTarget}
        accessibilityRole={avatarTarget ? 'button' : undefined}
        accessibilityLabel={avatarTarget ? t('discover.notif.openProfile', { name: actorName }) : undefined}
        importantForAccessibility={avatarTarget ? 'yes' : 'no-hide-descendants'}
      >
        {d.withActor ? (
          <Avatar uri={n.actor?.avatar_url} name={actorName} size={46} />
        ) : (
          <View style={th.sysIcon}>
            <Ionicons name={d.icon} size={22} color={colors.text} />
          </View>
        )}
        {d.withActor ? (
          <View style={th.kindBadge}>
            <Ionicons name={d.icon} size={10} color="#fff" />
          </View>
        ) : null}
      </Pressable>

      <Pressable
        style={styles.body}
        onPress={target ? () => go(target) : undefined}
        disabled={!target}
        accessibilityRole={target ? 'button' : 'text'}
        accessibilityLabel={a11y}
      >
        <Text style={th.text} numberOfLines={3}>
          {d.withActor ? <Text style={styles.actor}>{actorName} </Text> : null}
          {sentence}
        </Text>
        <Text style={th.time}>{when}</Text>
      </Pressable>

      {trailing}
    </View>
  );
});

function RequestActions({ userId, name }: { userId: string; name: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const decide = useFollowRequestDecision(userId);
  const [done, setDone] = useState<Decision | null>(null);

  if (done) {
    return (
      <Text style={[styles.done, { color: colors.muted }]} accessibilityLiveRegion="polite">
        {t(done === 'approve' ? 'discover.requests.approved' : 'discover.requests.declined')}
      </Text>
    );
  }
  const run = (v: Decision) => decide.mutate(v, { onSuccess: () => setDone(v) });
  return (
    <View style={styles.actions}>
      <PillButton
        title={t('discover.requests.approve')}
        label={t('discover.requests.approveA11y', { name })}
        primary
        loading={decide.isPending && decide.variables === 'approve'}
        disabled={decide.isPending}
        onPress={() => run('approve')}
      />
      <PillButton
        title={t('discover.requests.decline')}
        label={t('discover.requests.declineA11y', { name })}
        loading={decide.isPending && decide.variables === 'decline'}
        disabled={decide.isPending}
        onPress={() => run('decline')}
      />
    </View>
  );
}

// Someone asked to see your location (0004). Answered here; the map owns the
// rest of location sharing.
function PermitActions({ permitId, name }: { permitId: string; name: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const respond = useMutation({
    mutationFn: (decision: 'approved' | 'denied') => respondToLocationPermit(permitId, decision),
    onSuccess: () => void qc.invalidateQueries({ queryKey: locationKeys.all() }),
    onError: () => showAlert(t('discover.notif.permitFailed')),
  });

  if (respond.isSuccess) {
    return (
      <Text style={[styles.done, { color: colors.muted }]} accessibilityLiveRegion="polite">
        {t(respond.variables === 'approved' ? 'discover.notif.permitAllowed' : 'discover.notif.permitDenied')}
      </Text>
    );
  }
  return (
    <View style={styles.actions}>
      <PillButton
        title={t('discover.notif.permitAllow')}
        label={t('discover.notif.permitAllowA11y', { name })}
        primary
        loading={respond.isPending && respond.variables === 'approved'}
        disabled={respond.isPending}
        onPress={() => respond.mutate('approved')}
      />
      <PillButton
        title={t('discover.notif.permitDeny')}
        label={t('discover.notif.permitDenyA11y', { name })}
        loading={respond.isPending && respond.variables === 'denied'}
        disabled={respond.isPending}
        onPress={() => respond.mutate('denied')}
      />
    </View>
  );
}

const useThemed = makeThemed((c) => ({
  rowUnread: [styles.row, { backgroundColor: c.primarySoft }],
  sysIcon: [styles.sysIcon, { backgroundColor: c.bg3 }],
  kindBadge: [styles.kindBadge, { backgroundColor: c.primary, borderColor: c.bg }],
  text: [styles.text, { color: c.text }],
  time: [styles.time, { color: c.muted }],
}));

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  sysIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  kindBadge: {
    position: 'absolute',
    bottom: -2,
    end: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 3, minHeight: 44, justifyContent: 'center' },
  text: { fontSize: 14.5, lineHeight: 20, alignSelf: 'flex-start', maxWidth: '100%' },
  actor: { fontWeight: '800' },
  time: { fontSize: 12.5, alignSelf: 'flex-start' },
  actions: { flexDirection: 'row', gap: 6 },
  done: { fontSize: 13, fontWeight: '600' },
});
