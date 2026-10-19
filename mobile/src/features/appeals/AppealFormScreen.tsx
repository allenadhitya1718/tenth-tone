import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  APPEAL_REASON_MAX,
  APPEAL_REASON_MIN,
  appealKeys,
  fetchAppealableItems,
  submitAppeal,
  type AppealTargetType,
} from '@/api/appeals';
import { settingsKeys } from '@/api/settings';
import { showToast } from '@/components/Toast';
import { AppText, Button, Screen, TopBar } from '@/components/ui';
import { ErrorView, InlineError, LoadingView } from '@/features/settings/components';
import { useTheme } from '@/providers/ThemeProvider';

import { appealErrorText, canAppeal, formatDate, itemLabel, moderatorReason } from './shared';

const P = 'settings2.appeals';

// /appeals/new?type=<target_type>&id=<target_id>
export function AppealFormScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ type?: string; id?: string }>();
  const items = useQuery({ queryKey: appealKeys.items(), queryFn: fetchAppealableItems });
  const item = items.data?.find((it) => it.target_type === params.type && it.target_id === params.id);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const len = reason.trim().length;

  async function send() {
    if (!item) return;
    if (len < APPEAL_REASON_MIN) {
      setError(t(`${P}.form.tooShort`, { n: APPEAL_REASON_MIN }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitAppeal({ targetType: item.target_type as AppealTargetType, targetId: item.target_id, reason });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['appeals'] }),
        qc.invalidateQueries({ queryKey: settingsKeys.accountStatus() }),
      ]);
      showToast(t(`${P}.form.sent`));
      router.back();
    } catch (e) {
      setError(appealErrorText(e, t));
      setBusy(false);
    }
  }

  let body;
  if (items.isLoading) {
    body = <LoadingView />;
  } else if (items.isError) {
    body = <ErrorView onRetry={() => items.refetch()} />;
  } else if (!item || !canAppeal(item)) {
    body = (
      <AppText muted style={styles.para}>
        {t(`${P}.form.missing`)}
      </AppText>
    );
  } else {
    const why = moderatorReason(t, item.reason);
    body = (
      <>
        <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
          <AppText variant="label">{itemLabel(t, item.target_type, !!item.preview?.deleted)}</AppText>
          {item.target_type !== 'user' ? (
            <AppText variant="small" muted>
              {t(`${P}.actionedOn`, { date: formatDate(item.actioned_at, i18n.language) })}
            </AppText>
          ) : null}
          {item.preview?.text ? (
            <AppText variant="small" numberOfLines={3} style={{ marginTop: 8 }}>
              {item.preview.text}
            </AppText>
          ) : null}
          {why ? (
            <AppText variant="small" muted style={{ marginTop: 8 }}>
              {t(`${P}.moderatorReason`, { reason: why })}
            </AppText>
          ) : null}
        </View>

        <View style={styles.labelRow}>
          <AppText variant="small" style={{ fontWeight: '700' }} nativeID="appealReasonLabel">
            {t(`${P}.form.label`)}
          </AppText>
          <Text style={{ color: colors.muted, fontSize: 12 }} accessibilityLabel={`${reason.length} / ${APPEAL_REASON_MAX}`}>
            {reason.length}/{APPEAL_REASON_MAX}
          </Text>
        </View>
        <View style={[styles.inputBox, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
          <TextInput
            value={reason}
            onChangeText={(v) => {
              setReason(v);
              if (error) setError(null);
            }}
            multiline
            maxLength={APPEAL_REASON_MAX}
            placeholder={t(`${P}.form.placeholder`)}
            placeholderTextColor={colors.muted}
            accessibilityLabel={t(`${P}.form.label`)}
            accessibilityLabelledBy="appealReasonLabel"
            style={[
              styles.input,
              { color: colors.text, textAlign: I18nManager.isRTL ? 'right' : 'left' },
            ]}
          />
        </View>
        <AppText variant="small" muted style={{ marginTop: 6 }}>
          {t(`${P}.form.hint`)}
        </AppText>
        <InlineError text={error} />
        <Button
          title={t(`${P}.form.send`)}
          onPress={send}
          loading={busy}
          disabled={busy || len < APPEAL_REASON_MIN}
          style={{ marginTop: 16 }}
        />
      </>
    );
  }

  return (
    <Screen header={<TopBar title={t(`${P}.form.title`)} />} contentStyle={styles.content}>
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  para: { marginVertical: 16 },
  card: { borderRadius: 16, borderWidth: 1, padding: 14, marginTop: 14 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 8 },
  inputBox: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  input: { fontSize: 15.5, minHeight: 140, textAlignVertical: 'top' },
});
