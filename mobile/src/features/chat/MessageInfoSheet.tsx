import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { fetchReceiptTimes, memberTick, type Receipt, type Tick } from '@/api/chat';
import type { UserSummary } from '@/api/types';
import { BottomSheet } from '@/features/safety/BottomSheet';
import { light } from '@/theme/colors';
import { useTheme } from '@/providers/ThemeProvider';

import { Avatar } from './Avatar';
import { clockTime, previewText } from './format';
import type { ThreadMessage } from './useThread';

// "Message info" for one of your own messages (owner request, as WhatsApp):
// who has read it, who it has reached, who it has not reached yet, worked
// out from each member's read / delivered stamps (the same ones the ticks
// use), each with the time they read / received it (0153). A message read
// before 0153 has no recorded time and is listed without one.
export function MessageInfoSheet({
  message,
  receipts,
  members,
  onClose,
}: {
  message: ThreadMessage | null;
  receipts: Receipt[];
  members: UserSummary[];
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();

  const times = useQuery({
    queryKey: ['messageInfo', message?.id ?? ''],
    queryFn: () => fetchReceiptTimes(message!.id),
    enabled: !!message,
    staleTime: 0,
  });
  // Today: the time; otherwise the day and the time.
  const when = (iso: string | null | undefined) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const time = clockTime(iso, i18n.language);
    return new Date().toDateString() === d.toDateString()
      ? time
      : `${d.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' })}, ${time}`;
  };
  const byId = new Map(members.map((m) => [m.id, m]));
  const groups: Record<Tick, UserSummary[]> = { read: [], delivered: [], sent: [] };
  if (message) {
    for (const r of receipts) {
      const who = byId.get(r.user_id);
      if (who) groups[memberTick(message, r)].push(who);
    }
  }

  const section = (tick: Tick, title: string, icon: keyof typeof Ionicons.glyphMap, iconColor: string) =>
    groups[tick].length ? (
      <View key={tick} style={styles.section}>
        <View style={styles.sectionHead}>
          <Ionicons name={icon} size={18} color={iconColor} />
          <Text style={[styles.sectionTitle, { color: colors.muted }]} accessibilityRole="header">
            {title} · {groups[tick].length}
          </Text>
        </View>
        {groups[tick].map((p) => {
          const t0 = times.data?.get(p.id);
          const at = when(tick === 'read' ? t0?.read_at : tick === 'delivered' ? t0?.delivered_at : null);
          return (
            <View key={p.id} style={styles.row} accessible accessibilityLabel={[p.name || p.handle || '', title, at].filter(Boolean).join(', ')}>
              <Avatar uri={p.avatar_url} name={p.name || p.handle || ''} size={38} />
              <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                {p.name || p.handle || ''}
              </Text>
              {at ? <Text style={[styles.at, { color: colors.muted }]}>{at}</Text> : null}
            </View>
          );
        })}
      </View>
    ) : null;

  return (
    <BottomSheet visible={!!message} onClose={onClose}>
      <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
        {t('msgInfo.title')}
      </Text>
      {message ? (
        <View style={[styles.preview, { backgroundColor: colors.bg2 }]}>
          <Text style={[styles.previewText, { color: colors.text }]} numberOfLines={3}>
            {previewText(message, t)}
          </Text>
          <Text style={[styles.previewTime, { color: colors.muted }]}>
            {t('msgInfo.sentAt', { time: clockTime(message.created_at, i18n.language) })}
          </Text>
        </View>
      ) : null}
      <ScrollView style={styles.list}>
        {section('read', t('msgInfo.readBy'), 'checkmark-done', light.tickRead)}
        {section('delivered', t('msgInfo.deliveredTo'), 'checkmark-done', colors.muted)}
        {section('sent', t('msgInfo.notYet'), 'checkmark', colors.muted)}
        {!receipts.length ? <Text style={[styles.empty, { color: colors.muted }]}>{t('msgInfo.unknown')}</Text> : null}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '700', textAlign: 'center', paddingVertical: 10 },
  preview: { marginHorizontal: 16, borderRadius: 14, padding: 12, gap: 4 },
  previewText: { fontSize: 15, textAlign: 'left' },
  previewTime: { fontSize: 12, textAlign: 'right' },
  list: { maxHeight: 380, marginTop: 8 },
  section: { paddingHorizontal: 16, paddingTop: 12 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50 },
  name: { fontSize: 15.5, fontWeight: '600', flex: 1, textAlign: 'left' },
  at: { fontSize: 13 },
  empty: { textAlign: 'center', padding: 20 },
});
