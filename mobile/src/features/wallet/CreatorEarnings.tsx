import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import {
  cancelWithdrawal,
  creatorKeys,
  fetchCreatorEarnings,
  fetchMyWithdrawals,
  payoutErrorCode,
  type CreatorEarnings as Earnings,
  type CreatorWithdrawal,
  type PayoutBlockReason,
  type WithdrawalStatus,
} from '@/api/wallet';
import { showAlert } from '@/components/Dialog';
import { showToast } from '@/components/Toast';
import { AppText, Button } from '@/components/ui';
import { useSar } from '@/features/wallet/format';
import { WithdrawFlow, type WithdrawStart } from '@/features/wallet/WithdrawFlow';
import { useTheme } from '@/providers/ThemeProvider';

// "Creator earnings" in the wallet (0130): diamonds from gifts received,
// what is withdrawable now, what is still on hold (and when the next part
// clears), what has been withdrawn, the SAR value, why withdrawing is not
// possible yet, and the history of withdrawals.
//
// The section is hidden until the server has payouts (0130 applied) and for
// anyone who has never received a gift and never started verification: there
// is nothing to show them.

const KYC_REASONS: PayoutBlockReason[] = ['kyc_missing', 'kyc_pending', 'kyc_rejected'];

export function CreatorEarnings() {
  const { t, i18n } = useTranslation();
  const { colors, isDark } = useTheme();
  const sar = useSar();
  const queryClient = useQueryClient();
  const summary = useQuery({ queryKey: creatorKeys.summary(), queryFn: fetchCreatorEarnings });
  const withdrawals = useQuery({ queryKey: creatorKeys.withdrawals(), queryFn: () => fetchMyWithdrawals() });
  const [flow, setFlow] = useState<WithdrawStart | null>(null);

  const cancel = useMutation({
    mutationFn: cancelWithdrawal,
    onSuccess: () => showToast(t('live.wallet.creator.cancelled'), 'close-circle'),
    onError: (e) => showToast(t(`live.wallet.creator.errors.${payoutErrorCode(e)}`), 'alert-circle'),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: creatorKeys.all() }),
  });

  const num = (n: number) => n.toLocaleString(i18n.language);
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' });
  const tint = isDark ? colors.primary2 : colors.primary;

  if (summary.isLoading) {
    return (
      <View style={[styles.card, { backgroundColor: colors.bg2 }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (summary.isError) {
    return (
      <View style={[styles.card, { backgroundColor: colors.bg2 }]}>
        <AppText variant="small" muted>
          {t('live.wallet.creator.loadFailed')}
        </AppText>
        <Button title={t('live.retry')} variant="ghost" onPress={() => void summary.refetch()} />
      </View>
    );
  }
  const s = summary.data;
  // Payouts not on the server yet, or nothing to show this person.
  if (!s) return null;
  const history = withdrawals.data ?? [];
  if (s.diamonds.total === 0 && !s.kyc && history.length === 0) return null;

  const reasons = s.eligibility.reasons;
  const blockers = reasons.filter((r) => !KYC_REASONS.includes(r));
  const kycReason = reasons.find((r) => KYC_REASONS.includes(r));
  const canVerify = blockers.length === 0 && (kycReason === 'kyc_missing' || kycReason === 'kyc_rejected');
  const canUpdateBank = blockers.length === 0 && s.kyc?.status === 'approved' && !s.open_withdrawal_id;
  const belowMin = s.eligibility.eligible && !s.open_withdrawal_id && s.max_withdraw_sar < s.config.min_withdraw_sar;

  const notes: string[] = [];
  for (const r of blockers) notes.push(blockText(r, s, t));
  if (blockers.length === 0 && kycReason) notes.push(blockText(kycReason, s, t));
  if (s.open_withdrawal_id) notes.push(t('live.wallet.creator.block.open_withdrawal'));
  if (belowMin) notes.push(t('live.wallet.creator.block.below_minimum', { min: sar(s.config.min_withdraw_sar) }));

  return (
    <View style={[styles.card, { backgroundColor: colors.bg2 }]}>
      <View style={styles.headRow}>
        <Text style={styles.gem}>💎</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
            {t('live.wallet.creator.title')}
          </Text>
          <AppText variant="small" muted>
            {t('live.wallet.creator.intro')}
          </AppText>
        </View>
      </View>

      <View
        style={[styles.availableBox, { backgroundColor: colors.bg }]}
        accessible
        accessibilityLabel={`${t('live.wallet.creator.availableNow')}: ${t('live.wallet.creator.diamonds', { count: s.diamonds.available, n: num(s.diamonds.available) })}, ${t('live.wallet.creator.sar', { amount: sar(s.sar.available) })}`}
      >
        <AppText variant="small" muted>
          {t('live.wallet.creator.availableNow')}
        </AppText>
        <Text style={[styles.bigValue, { color: colors.text }]}>{t('live.wallet.creator.sar', { amount: sar(s.sar.available) })}</Text>
        <AppText variant="small" muted>
          {t('live.wallet.creator.diamonds', { count: s.diamonds.available, n: num(s.diamonds.available) })}
        </AppText>
      </View>

      <View style={styles.grid}>
        <Stat
          label={t('live.wallet.creator.onHold')}
          value={t('live.wallet.creator.diamonds', { count: s.diamonds.pending, n: num(s.diamonds.pending) })}
          sub={
            s.next_release_at && s.next_release_diamonds > 0
              ? t('live.wallet.creator.nextRelease', { n: num(s.next_release_diamonds), date: date(s.next_release_at) })
              : t('live.wallet.creator.approx', { amount: sar(s.sar.pending) })
          }
        />
        <Stat
          label={t('live.wallet.creator.withdrawn')}
          value={t('live.wallet.creator.sar', { amount: sar(s.sar.withdrawn) })}
          sub={t('live.wallet.creator.diamonds', { count: s.diamonds.withdrawn, n: num(s.diamonds.withdrawn) })}
        />
        <Stat
          label={t('live.wallet.creator.total')}
          value={t('live.wallet.creator.diamonds', { count: s.diamonds.total, n: num(s.diamonds.total) })}
        />
        {s.diamonds.reserved > 0 ? (
          <Stat
            label={t('live.wallet.creator.inRequest')}
            value={t('live.wallet.creator.sar', { amount: sar(s.sar.reserved) })}
          />
        ) : null}
        {s.diamonds.withheld > 0 ? (
          <Stat
            label={t('live.wallet.creator.withheld')}
            value={t('live.wallet.creator.diamonds', { count: s.diamonds.withheld, n: num(s.diamonds.withheld) })}
            tone={colors.warn}
          />
        ) : null}
      </View>

      {s.diamonds.withheld > 0 ? (
        <AppText variant="small" muted>
          {t('live.wallet.creator.withheldNote')}
        </AppText>
      ) : null}
      <AppText variant="small" muted>
        {t('live.wallet.creator.holdNote', { days: num(s.config.hold_days) })}{' '}
        {t('live.wallet.creator.rate', { rate: s.config.sar_per_diamond.toLocaleString(i18n.language, { maximumFractionDigits: 4 }), min: sar(s.config.min_withdraw_sar) })}
      </AppText>

      {notes.map((n) => (
        <View key={n} style={[styles.note, { backgroundColor: colors.bg }]} accessibilityLiveRegion="polite">
          <Ionicons name="information-circle-outline" size={18} color={tint} />
          <AppText variant="small" style={{ flex: 1 }}>
            {n}
          </AppText>
        </View>
      ))}

      {s.can_request ? (
        <Button title={t('live.wallet.creator.withdraw')} onPress={() => setFlow('amount')} />
      ) : canVerify ? (
        <Button title={t('live.wallet.creator.verify')} onPress={() => setFlow('kyc')} />
      ) : (
        <Button title={t('live.wallet.creator.withdraw')} disabled />
      )}
      {canUpdateBank ? (
        <Button title={t('live.wallet.creator.updateBank')} variant="ghost" onPress={() => setFlow('kyc')} />
      ) : null}

      {s.kyc ? (
        <AppText variant="small" muted>
          {t('live.wallet.creator.kycLine', {
            status: t(`live.wallet.creator.kycStatus.${s.kyc.status}`),
            iban: s.kyc.iban_masked,
            bank: s.kyc.bank_name,
          })}
        </AppText>
      ) : null}

      <Text style={[styles.subTitle, { color: colors.text }]} accessibilityRole="header">
        {t('live.wallet.creator.history')}
      </Text>
      {withdrawals.isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : withdrawals.isError ? (
        <Button title={t('live.retry')} variant="ghost" onPress={() => void withdrawals.refetch()} />
      ) : history.length === 0 ? (
        <AppText variant="small" muted>
          {t('live.wallet.creator.noHistory')}
        </AppText>
      ) : (
        history.map((w) => (
          <WithdrawalRow
            key={w.id}
            w={w}
            date={date}
            busy={cancel.isPending && cancel.variables === w.id}
            onCancel={() =>
              showAlert(t('live.wallet.creator.cancelTitle'), t('live.wallet.creator.cancelBody'), [
                { text: t('live.wallet.creator.keep'), style: 'cancel' },
                { text: t('live.wallet.creator.cancel'), style: 'destructive', onPress: () => cancel.mutate(w.id) },
              ])
            }
          />
        ))
      )}

      {flow ? <WithdrawFlow key={flow} start={flow} summary={s} onClose={() => setFlow(null)} /> : null}
    </View>
  );
}

function blockText(r: PayoutBlockReason, s: Earnings, t: (k: string, o?: Record<string, unknown>) => string) {
  switch (r) {
    case 'under_age':
    case 'no_birth_date':
      return t(`live.wallet.creator.block.${r}`, { age: s.config.min_age });
    case 'account_too_new':
      return t('live.wallet.creator.block.account_too_new', {
        days: s.config.min_account_age_days,
        left: s.eligibility.account_days_left,
      });
    case 'kyc_rejected':
      return s.kyc?.reject_reason
        ? t('live.wallet.creator.block.kyc_rejected', { reason: s.kyc.reject_reason })
        : t('live.wallet.creator.block.kyc_rejectedPlain');
    default:
      return t(`live.wallet.creator.block.${r}`, { defaultValue: t('live.wallet.creator.block.unavailable') });
  }
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: colors.bg }]} accessible>
      <AppText variant="small" muted>
        {label}
      </AppText>
      <Text style={[styles.statValue, { color: tone ?? colors.text }]}>{value}</Text>
      {sub ? (
        <AppText variant="small" muted>
          {sub}
        </AppText>
      ) : null}
    </View>
  );
}

const STATUS_TONE: Record<WithdrawalStatus, 'success' | 'warn' | 'danger' | 'muted'> = {
  requested: 'warn',
  approved: 'warn',
  paid: 'success',
  rejected: 'danger',
  cancelled: 'muted',
};

function WithdrawalRow({
  w,
  date,
  busy,
  onCancel,
}: {
  w: CreatorWithdrawal;
  date: (iso: string) => string;
  busy: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const sar = useSar();
  const tone = colors[STATUS_TONE[w.status]];
  const when = w.paid_at ?? w.rejected_at ?? w.cancelled_at ?? w.approved_at ?? w.requested_at;
  return (
    <View style={[styles.wRow, { borderBottomColor: colors.border }]} accessible={w.status !== 'requested'}>
      <Ionicons name="arrow-up-circle-outline" size={24} color={colors.muted} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={[styles.wAmount, { color: colors.text }]}>{t('live.wallet.creator.sar', { amount: sar(w.amount_sar) })}</Text>
        <Text style={[styles.wSub, { color: colors.muted }]} numberOfLines={1}>
          {w.iban_masked} · {date(when)}
        </Text>
        {w.status === 'paid' && w.bank_reference ? (
          <Text style={[styles.wSub, { color: colors.muted }]}>{t('live.wallet.creator.reference', { ref: w.bank_reference })}</Text>
        ) : null}
        {w.status === 'rejected' && w.reject_reason ? (
          <Text style={[styles.wSub, { color: colors.danger }]}>{w.reject_reason}</Text>
        ) : null}
        {w.status === 'requested' ? (
          <Button
            title={t('live.wallet.creator.cancel')}
            variant="ghost"
            loading={busy}
            onPress={onCancel}
            style={styles.cancel}
          />
        ) : null}
      </View>
      <Text style={[styles.status, { color: tone, borderColor: tone }]}>{t(`live.wallet.creator.status.${w.status}`)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 14, gap: 10 },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  gem: { fontSize: 26 },
  title: { fontSize: 17, fontWeight: '800' },
  availableBox: { borderRadius: 14, padding: 12, gap: 2 },
  bigValue: { fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { borderRadius: 12, padding: 10, gap: 2, flexGrow: 1, flexBasis: '45%' },
  statValue: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', borderRadius: 12, padding: 10 },
  subTitle: { fontSize: 15, fontWeight: '800', marginTop: 6 },
  wRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  wAmount: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  wSub: { fontSize: 12.5 },
  status: { fontSize: 12, fontWeight: '700', borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  cancel: { alignSelf: 'flex-start', height: 32, paddingHorizontal: 0, marginVertical: 0 },
});
