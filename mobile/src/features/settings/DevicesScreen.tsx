import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { fetchMySessions, revokeSession, settingsKeys, type UserSession } from '@/api/settings';
import { timeAgo } from '@/lib/timeAgo';
import { useTheme } from '@/providers/ThemeProvider';

import { thisSessionId } from './accountAuth';
import { confirm, showError } from './components';
import { ListScreen } from './PeopleLists';

// Device labels are frozen at sign-in, so old rows may hold a connector word
// in the language of the time ("Chrome على Windows"). Normalised on display.
const cleanDevice = (d: string) => d.replace(/\s+على\s+/g, ' · ').replace(/\s+on\s+/g, ' · ');

export function DevicesScreen() {
  const { t, i18n } = useTranslation();
  const { colors, isDark } = useTheme();
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: settingsKeys.sessions(), queryFn: fetchMySessions });
  const mine = useQuery({ queryKey: ['thisSessionId'], queryFn: thisSessionId, staleTime: Infinity });
  const [busyId, setBusyId] = useState<string | null>(null);

  async function remove(s: UserSession, label: string) {
    const yes = await confirm({
      title: t('settings2.devices.removeTitle'),
      message: t('settings2.devices.removeBody', { device: label }),
      confirmLabel: t('settings2.devices.remove'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!yes) return;
    setBusyId(s.id);
    try {
      await revokeSession(s.id);
      qc.setQueryData<UserSession[]>(settingsKeys.sessions(), (rows) => rows?.filter((r) => r.id !== s.id));
      qc.invalidateQueries({ queryKey: settingsKeys.sessions() });
    } catch (e) {
      showError(t, e, 'settings2.devices.removeFailed');
    } finally {
      setBusyId(null);
    }
  }

  const tone = isDark ? colors.primary2 : colors.primary;

  return (
    <ListScreen
      title={t('settings2.devices.title')}
      note={t('settings2.devices.note')}
      query={sessions}
      keyOf={(s) => s.id}
      empty={{ icon: 'phone-portrait-outline', title: t('settings2.devices.empty'), sub: t('settings2.devices.emptySub') }}
      renderItem={(s) => {
        const isMe = !!mine.data && s.id === mine.data;
        const phone = /mobile|android|ios/i.test(s.platform ?? '');
        const label = cleanDevice(s.device || t('settings2.devices.unknown'));
        const seen = t('settings2.devices.lastActive', { when: timeAgo(s.last_seen, t, i18n.language) });
        return (
          <View style={styles.row}>
            <View style={[styles.icon, { backgroundColor: colors.bg2 }]}>
              <Ionicons name={phone ? 'phone-portrait-outline' : 'desktop-outline'} size={20} color={colors.muted} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }} accessible accessibilityLabel={`${label}, ${seen}`}>
              <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                {label}
              </Text>
              <Text style={[styles.sub, { color: colors.muted }]}>{seen}</Text>
            </View>
            {isMe ? (
              <Text style={[styles.current, { color: colors.success }]}>{t('settings2.devices.thisDevice')}</Text>
            ) : (
              <Pressable
                onPress={() => remove(s, label)}
                disabled={busyId === s.id}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`${t('settings2.devices.remove')}, ${label}`}
                accessibilityState={{ busy: busyId === s.id }}
                style={[styles.pill, { backgroundColor: colors.primarySoft }]}
              >
                {busyId === s.id ? (
                  <ActivityIndicator size="small" color={tone} />
                ) : (
                  <Text style={{ color: tone, fontWeight: '700', fontSize: 13 }}>{t('settings2.devices.remove')}</Text>
                )}
              </Pressable>
            )}
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15, fontWeight: '600', textAlign: 'left' },
  sub: { fontSize: 12.5, marginTop: 2, textAlign: 'left' },
  current: { fontSize: 13, fontWeight: '700' },
  pill: { minWidth: 72, height: 34, paddingHorizontal: 14, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
