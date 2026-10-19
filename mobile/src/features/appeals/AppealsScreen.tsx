import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  APPEAL_MAX_OPEN,
  appealKeys,
  fetchAppealableItems,
  fetchMyAppeals,
  isPermanentBan,
  type Appeal,
  type AppealableItem,
} from '@/api/appeals';
import { AppText, Button, TopBar } from '@/components/ui';
import { EmptyView, ErrorView, go, LoadingView } from '@/features/settings/components';
import { useTheme } from '@/providers/ThemeProvider';

import { canAppeal, formatDate, itemIcon, itemLabel, moderatorReason, statusLabel } from './shared';

const P = 'settings2.appeals';

// Settings > Account status > Appeal a decision. Reachable from the banned
// screen too, so it must not depend on anything a ban takes away.
export function AppealsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const items = useQuery({ queryKey: appealKeys.items(), queryFn: fetchAppealableItems });
  const mine = useQuery({ queryKey: appealKeys.mine(), queryFn: fetchMyAppeals });
  const openCount = (mine.data ?? []).filter((a) => a.status === 'open').length;
  const atLimit = openCount >= APPEAL_MAX_OPEN;

  let body;
  if (items.isLoading || mine.isLoading) {
    body = <LoadingView />;
  } else if (items.isError || mine.isError) {
    body = (
      <ErrorView
        onRetry={() => {
          void items.refetch();
          void mine.refetch();
        }}
      />
    );
  } else {
    const list = items.data ?? [];
    const history = mine.data ?? [];
    body = (
      <>
        <AppText variant="small" muted style={styles.heading} accessibilityRole="header">
          {t(`${P}.itemsTitle`)}
        </AppText>
        {list.length === 0 ? (
          <EmptyView icon="shield-checkmark-outline" title={t(`${P}.none`)} sub={t(`${P}.noneSub`)} />
        ) : (
          list.map((it) => <ItemCard key={`${it.target_type}:${it.target_id}`} item={it} atLimit={atLimit} />)
        )}
        {atLimit ? (
          <AppText variant="small" muted style={styles.note}>
            {t(`${P}.limitReached`, { n: APPEAL_MAX_OPEN })}
          </AppText>
        ) : null}
        {history.length > 0 ? (
          <>
            <AppText variant="small" muted style={styles.heading} accessibilityRole="header">
              {t(`${P}.historyTitle`)}
            </AppText>
            {history.map((a) => (
              <HistoryRow
                key={a.id}
                appeal={a}
                deleted={!!list.find((it) => it.target_id === a.target_id && it.target_type === a.target_type)?.preview?.deleted}
              />
            ))}
          </>
        ) : null}
      </>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <TopBar title={t(`${P}.title`)} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={items.isRefetching || mine.isRefetching}
            onRefresh={() => {
              void items.refetch();
              void mine.refetch();
            }}
            tintColor={colors.muted}
          />
        }
      >
        <AppText muted style={styles.intro}>
          {t(`${P}.intro`)}
        </AppText>
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}

function ItemCard({ item, atLimit }: { item: AppealableItem; atLimit: boolean }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const deleted = !!item.preview?.deleted;
  const reason = moderatorReason(t, item.reason);
  const allowed = canAppeal(item);
  const a = item.appeal;
  const label = itemLabel(t, item.target_type, deleted);
  return (
    <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
      <View style={styles.cardHead}>
        <View style={[styles.icon, { backgroundColor: colors.dangerSoft }]}>
          <Ionicons name={itemIcon(item.target_type)} size={18} color={colors.danger} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="label">{label}</AppText>
          <AppText variant="small" muted>
            {item.target_type === 'user'
              ? isPermanentBan(item.preview?.until)
                ? t(`${P}.banned.permanent`)
                : t(`${P}.banned.until`, { date: formatDate(item.preview?.until, i18n.language) })
              : t(`${P}.actionedOn`, { date: formatDate(item.actioned_at, i18n.language) })}
          </AppText>
        </View>
        {item.preview?.thumbnail ? (
          <Image source={{ uri: item.preview.thumbnail }} style={styles.thumb} contentFit="cover" accessibilityIgnoresInvertColors />
        ) : null}
      </View>
      {item.preview?.text ? (
        <AppText variant="small" numberOfLines={3} style={styles.preview}>
          {item.preview.text}
        </AppText>
      ) : null}
      {reason ? (
        <AppText variant="small" muted style={styles.line}>
          {t(`${P}.moderatorReason`, { reason })}
        </AppText>
      ) : null}
      {a ? <StatusLine status={a.status} note={a.admin_note} /> : null}
      {allowed ? (
        <Button
          title={t(`${P}.appealCta`)}
          variant="secondary"
          disabled={atLimit}
          onPress={() => go(`/appeals/new?type=${item.target_type}&id=${item.target_id}`)}
          style={styles.btn}
        />
      ) : a && a.status !== 'open' ? (
        <AppText variant="small" muted style={styles.line}>
          {t(`${P}.final`)}
        </AppText>
      ) : null}
    </View>
  );
}

function StatusLine({ status, note }: { status: Appeal['status']; note: string | null }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const tone = status === 'accepted' ? colors.success : status === 'rejected' ? colors.danger : colors.warn;
  const icon = status === 'accepted' ? 'checkmark-circle' : status === 'rejected' ? 'close-circle' : 'time-outline';
  return (
    <View style={styles.line}>
      <View style={styles.statusRow}>
        <Ionicons name={icon} size={16} color={tone} />
        <AppText variant="small" style={{ color: tone, fontWeight: '700' }}>
          {statusLabel(t, status)}
        </AppText>
      </View>
      {note ? (
        <AppText variant="small" muted style={{ marginTop: 4 }}>
          {t(`${P}.adminNote`, { note })}
        </AppText>
      ) : null}
    </View>
  );
}

function HistoryRow({ appeal, deleted }: { appeal: Appeal; deleted: boolean }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
      <AppText variant="label">{itemLabel(t, appeal.target_type, deleted)}</AppText>
      <AppText variant="small" muted>
        {t(`${P}.sentOn`, { date: formatDate(appeal.created_at, i18n.language) })}
      </AppText>
      <AppText variant="small" numberOfLines={4} style={styles.preview}>
        {appeal.reason}
      </AppText>
      <StatusLine status={appeal.status} note={appeal.admin_note} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  intro: { marginTop: 12 },
  heading: { fontWeight: '700', marginTop: 22, marginBottom: 4, marginHorizontal: 4, textAlign: 'left' },
  note: { marginTop: 10, marginHorizontal: 4 },
  card: { borderRadius: 16, borderWidth: 1, padding: 14, marginTop: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 44, height: 58, borderRadius: 8 },
  preview: { marginTop: 10 },
  line: { marginTop: 8 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btn: { marginTop: 12 },
});
