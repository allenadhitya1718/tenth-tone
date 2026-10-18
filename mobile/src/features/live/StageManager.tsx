import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';

import type { LiveGuest } from '@/api/live';
import type { UserSummary } from '@/api/types';
import { Button } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';

import { MAX_GUESTS } from './config';
import { Avatar, Sheet } from './Sheet';
import { fetchLiveViewers, liveViewersKey } from './viewers';

// The host's stage manager (client note 6): requests to approve or turn
// down, the guests on stage to remove, open invites to withdraw, and the
// people watching, each of whom can be invited up. Tapping a person (rather
// than a button) opens their report / block options.

type Row =
  | { kind: 'request' | 'guest' | 'invited'; guest: LiveGuest; user: UserSummary }
  | { kind: 'viewer'; user: UserSummary };

export function StageManager({
  visible,
  onClose,
  liveId,
  guests,
  guestsError,
  myId,
  busyId,
  onApprove,
  onRemove,
  onInvite,
  onPerson,
}: {
  visible: boolean;
  onClose: () => void;
  liveId: string;
  guests: LiveGuest[];
  guestsError: string | null;
  myId: string | null;
  busyId: string | null;
  onApprove: (userId: string) => void;
  onRemove: (userId: string) => void;
  onInvite: (userId: string) => void;
  onPerson: (user: UserSummary, onStage: boolean) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const viewers = useQuery({
    queryKey: liveViewersKey(liveId),
    queryFn: () => fetchLiveViewers(liveId),
    enabled: visible,
    refetchInterval: visible ? 15_000 : false,
  });

  const withUser = (g: LiveGuest): UserSummary => g.user ?? { id: g.user_id, name: null, handle: null, avatar_url: null };
  const requests = guests.filter((g) => g.status === 'requested');
  const onStage = guests.filter((g) => g.status === 'accepted');
  const invited = guests.filter((g) => g.status === 'invited');
  const busyIds = new Set(guests.filter((g) => g.status !== 'left' && g.status !== 'removed').map((g) => g.user_id));
  const watching = (viewers.data ?? []).filter((v) => v.id !== myId && !busyIds.has(v.id));
  const full = onStage.length >= MAX_GUESTS;

  const sections: { key: string; title: string; data: Row[] }[] = [
    { key: 'requests', title: t('live.stage.requests', { count: requests.length }), data: requests.map((g) => ({ kind: 'request' as const, guest: g, user: withUser(g) })) },
    { key: 'guests', title: t('live.stage.onStage', { count: onStage.length, max: MAX_GUESTS }), data: onStage.map((g) => ({ kind: 'guest' as const, guest: g, user: withUser(g) })) },
    { key: 'invited', title: t('live.stage.invited', { count: invited.length }), data: invited.map((g) => ({ kind: 'invited' as const, guest: g, user: withUser(g) })) },
    { key: 'viewers', title: t('live.stage.viewers'), data: watching.map((u) => ({ kind: 'viewer' as const, user: u })) },
  ].filter((s) => s.data.length || s.key === 'viewers');

  return (
    <Sheet visible={visible} onClose={onClose} title={t('live.stage.manage')} maxHeight={0.8}>
      {guestsError ? <Text style={[styles.note, { color: colors.danger }]}>{t(guestsError)}</Text> : null}
      <SectionList
        sections={sections}
        keyExtractor={(r) => `${r.kind}-${r.user.id}`}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: 12 }}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.section, { color: colors.muted }]} accessibilityRole="header">
            {section.title}
          </Text>
        )}
        renderSectionFooter={({ section }) =>
          section.key === 'viewers' && !section.data.length ? (
            viewers.isLoading ? (
              <ActivityIndicator style={{ marginVertical: 16 }} color={colors.primary} />
            ) : viewers.isError ? (
              <View style={styles.inline}>
                <Text style={[styles.note, { color: colors.muted }]}>{t('live.stage.viewersFailed')}</Text>
                <Button title={t('live.retry')} variant="ghost" onPress={() => void viewers.refetch()} />
              </View>
            ) : (
              <Text style={[styles.note, { color: colors.muted }]}>{t('live.stage.noViewers')}</Text>
            )
          ) : null
        }
        renderItem={({ item }) => {
          const name = item.user.name || item.user.handle || t('live.someone');
          const busy = busyId === item.user.id;
          return (
            <View style={styles.row}>
              <Pressable
                style={styles.person}
                onPress={() => onPerson(item.user, item.kind === 'guest')}
                accessibilityRole="button"
                accessibilityLabel={name}
                accessibilityHint={t('live.stage.personHint')}
              >
                <Avatar uri={item.user.avatar_url} name={name} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                    {name}
                  </Text>
                  {item.user.handle ? (
                    <Text style={[styles.handle, { color: colors.muted }]} numberOfLines={1}>
                      @{item.user.handle.replace(/^@/, '')}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
              {item.kind === 'request' ? (
                <>
                  <SmallButton label={t('live.stage.decline')} onPress={() => onRemove(item.user.id)} disabled={busy} />
                  <SmallButton label={t('live.stage.approve')} primary onPress={() => onApprove(item.user.id)} disabled={busy || full} />
                </>
              ) : item.kind === 'guest' ? (
                <SmallButton label={t('live.stage.remove')} danger onPress={() => onRemove(item.user.id)} disabled={busy} />
              ) : item.kind === 'invited' ? (
                <SmallButton label={t('live.stage.withdraw')} onPress={() => onRemove(item.user.id)} disabled={busy} />
              ) : (
                <SmallButton label={t('live.stage.invite')} primary onPress={() => onInvite(item.user.id)} disabled={busy || full} />
              )}
            </View>
          );
        }}
      />
    </Sheet>
  );
}

function SmallButton({ label, onPress, disabled, primary, danger }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean; danger?: boolean }) {
  const { colors, isDark } = useTheme();
  const bg = primary ? colors.primary : danger ? colors.dangerSoft : colors.bg2;
  const fg = primary ? colors.onPrimary : danger ? colors.danger : isDark ? colors.primary2 : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={[styles.small, { backgroundColor: bg }, disabled && { opacity: 0.5 }]}
    >
      <Text style={[styles.smallText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 13, fontWeight: '700', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4 },
  note: { fontSize: 13, paddingHorizontal: 20, paddingVertical: 10 },
  inline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingEnd: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 6 },
  person: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  name: { fontSize: 15, fontWeight: '700' },
  handle: { fontSize: 12.5 },
  small: { minHeight: 36, minWidth: 44, paddingHorizontal: 14, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  smallText: { fontSize: 13, fontWeight: '700' },
});
