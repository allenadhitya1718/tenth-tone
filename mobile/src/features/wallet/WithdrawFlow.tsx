import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { LocalMedia } from '@/api/upload';
import {
  creatorKeys,
  isValidSaudiIban,
  isValidSaudiId,
  normalizeIban,
  payoutErrorCode,
  requestWithdrawal,
  submitKyc,
  type CreatorEarnings,
} from '@/api/wallet';
import { AppText, Button, ErrorBox, TextField, type ErrorMsg } from '@/components/ui';
import { useSar } from '@/features/wallet/format';
import { pickIdPhoto } from '@/features/wallet/kycImage';
import { useTheme } from '@/providers/ThemeProvider';

// The withdraw flow (0130), full screen over the wallet:
//   kyc      first time (or after a rejection, or to change bank details):
//            legal name, national ID / Iqama number, photo of the ID's front,
//            IBAN, bank, "this IBAN is in my name" - with a privacy note.
//   amount   SAR amount between the minimum and what is available.
//   confirm  amount, diamonds used, destination; then the request.
//   done     what happens next.
// Every limit is checked again on the server (creator_submit_kyc,
// creator_request_withdrawal); errors come back as stable codes.

export type WithdrawStart = 'kyc' | 'amount';
type Step = 'kyc' | 'kycDone' | 'amount' | 'confirm' | 'done';

// Arabic-Indic and Persian digits, and a comma decimal separator, to a number.
function parseAmount(s: string): number {
  const ascii = s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, '.')
    .replace(/[^\d.]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(ascii)) return NaN;
  return Number(ascii);
}

// "SA03 8000 0000 ..." while typing; stored without spaces.
const groupIban = (s: string) => normalizeIban(s).replace(/(.{4})/g, '$1 ').trim();

export function WithdrawFlow({
  start,
  summary,
  onClose,
}: {
  start: WithdrawStart;
  summary: CreatorEarnings;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  // Mounted fresh (keyed by start) every time the flow opens.
  const [step, setStep] = useState<Step>(start);

  const title =
    step === 'kyc' || step === 'kycDone'
      ? t('live.wallet.creator.kyc.title')
      : step === 'confirm'
        ? t('live.wallet.creator.confirm.title')
        : t('live.wallet.creator.amount.title');

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('live.wallet.creator.close')}>
            <Ionicons name="close" size={26} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]} accessibilityRole="header" numberOfLines={1}>
            {title}
          </Text>
          <View style={{ width: 26 }} />
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {step === 'kyc' ? (
            <KycForm summary={summary} onDone={() => setStep('kycDone')} />
          ) : step === 'kycDone' ? (
            <Done icon="shield-checkmark" title={t('live.wallet.creator.kyc.submitted')} body={t('live.wallet.creator.kyc.submittedBody')} onClose={onClose} />
          ) : step === 'done' ? (
            <Done icon="checkmark-circle" title={t('live.wallet.creator.confirm.doneTitle')} body={t('live.wallet.creator.confirm.doneBody')} onClose={onClose} />
          ) : (
            <AmountAndConfirm summary={summary} step={step} setStep={setStep} />
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function Done({ icon, title, body, onClose }: { icon: 'shield-checkmark' | 'checkmark-circle'; title: string; body: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={styles.done} accessibilityLiveRegion="polite">
      <Ionicons name={icon} size={56} color={colors.success} />
      <AppText variant="subtitle" center>
        {title}
      </AppText>
      <AppText center muted>
        {body}
      </AppText>
      <Button title={t('live.wallet.ok')} onPress={onClose} style={{ alignSelf: 'stretch' }} />
    </View>
  );
}

function Label({ children }: { children: string }) {
  return (
    <AppText variant="label" style={{ marginTop: 6 }}>
      {children}
    </AppText>
  );
}

function KycForm({ summary, onDone }: { summary: CreatorEarnings; onDone: () => void }) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [photo, setPhoto] = useState<LocalMedia | null>(null);
  const [iban, setIban] = useState('');
  const [bank, setBank] = useState('');
  const [owner, setOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorMsg>(null);
  const tint = isDark ? colors.primary2 : colors.primary;

  const nameOk = name.trim().length >= 5 && /\s/.test(name.trim());
  const idOk = isValidSaudiId(idNumber);
  const ibanOk = isValidSaudiIban(iban);
  const bankOk = bank.trim().length >= 2;
  const ready = nameOk && idOk && ibanOk && bankOk && !!photo && owner;

  async function pick(source: 'camera' | 'library') {
    setError(null);
    try {
      const r = await pickIdPhoto(source);
      if (!r) return;
      if ('denied' in r) setError({ key: 'live.wallet.creator.kyc.cameraDenied' });
      else setPhoto(r.media);
    } catch {
      setError({ key: 'live.wallet.creator.errors.upload_failed' });
    }
  }

  async function submit() {
    if (!ready || !photo) return;
    setBusy(true);
    setError(null);
    try {
      await submitKyc({ legalName: name, idNumber, idPhoto: photo, iban, bankName: bank, ownerAttested: owner });
      void queryClient.invalidateQueries({ queryKey: creatorKeys.all() });
      onDone();
    } catch (e) {
      setError({ key: `live.wallet.creator.errors.${payoutErrorCode(e)}`, params: { age: summary.config.min_age } });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <View style={[styles.privacy, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name="lock-closed" size={18} color={tint} />
        <AppText variant="small" style={{ flex: 1 }}>
          {t('live.wallet.creator.kyc.privacy')}
        </AppText>
      </View>

      <Label>{t('live.wallet.creator.kyc.legalName')}</Label>
      <TextField
        value={name}
        onChangeText={setName}
        placeholder={t('live.wallet.creator.kyc.legalNameHint')}
        autoComplete="name"
        textContentType="name"
        autoCapitalize="words"
        maxLength={120}
        accessibilityLabel={t('live.wallet.creator.kyc.legalName')}
      />

      <Label>{t('live.wallet.creator.kyc.idNumber')}</Label>
      <TextField
        value={idNumber}
        onChangeText={(v) => setIdNumber(v.replace(/[^\d]/g, '').slice(0, 10))}
        placeholder="1XXXXXXXXX"
        keyboardType="number-pad"
        maxLength={10}
        accessibilityLabel={t('live.wallet.creator.kyc.idNumber')}
      />
      {idNumber.length === 10 && !idOk ? (
        <AppText variant="small" style={{ color: colors.danger }}>
          {t('live.wallet.creator.errors.invalid_id_number')}
        </AppText>
      ) : null}

      <Label>{t('live.wallet.creator.kyc.idPhoto')}</Label>
      {photo ? (
        <Image source={{ uri: photo.uri }} style={[styles.photo, { backgroundColor: colors.bg2 }]} contentFit="contain" accessibilityLabel={t('live.wallet.creator.kyc.idPhoto')} />
      ) : null}
      <View style={styles.photoButtons}>
        <Button
          title={photo ? t('live.wallet.creator.kyc.retake') : t('live.wallet.creator.kyc.takePhoto')}
          variant="secondary"
          onPress={() => void pick('camera')}
          style={{ flex: 1 }}
        />
        <Button title={t('live.wallet.creator.kyc.choosePhoto')} variant="ghost" onPress={() => void pick('library')} style={{ flex: 1 }} />
      </View>

      <Label>{t('live.wallet.creator.kyc.iban')}</Label>
      <TextField
        value={groupIban(iban)}
        onChangeText={(v) => setIban(normalizeIban(v).slice(0, 24))}
        placeholder="SA00 0000 0000 0000 0000 0000"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={29}
        accessibilityLabel={t('live.wallet.creator.kyc.iban')}
      />
      <AppText variant="small" style={{ color: iban.length >= 24 && !ibanOk ? colors.danger : colors.muted }}>
        {iban.length >= 24 && !ibanOk ? t('live.wallet.creator.errors.invalid_iban') : t('live.wallet.creator.kyc.ibanHint')}
      </AppText>

      <Label>{t('live.wallet.creator.kyc.bank')}</Label>
      <TextField
        value={bank}
        onChangeText={setBank}
        placeholder={t('live.wallet.creator.kyc.bankHint')}
        maxLength={80}
        accessibilityLabel={t('live.wallet.creator.kyc.bank')}
      />

      <Pressable
        onPress={() => setOwner((o) => !o)}
        style={styles.check}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: owner }}
      >
        <Ionicons name={owner ? 'checkbox' : 'square-outline'} size={24} color={owner ? tint : colors.muted} />
        <View style={{ flex: 1 }}>
          <AppText>{t('live.wallet.creator.kyc.owner')}</AppText>
          <AppText variant="small" muted>
            {t('live.wallet.creator.kyc.ownerHint')}
          </AppText>
        </View>
      </Pressable>

      <ErrorBox error={error} />
      <Button title={t('live.wallet.creator.kyc.submit')} onPress={() => void submit()} disabled={!ready} loading={busy} />
      <AppText variant="small" muted center>
        {t('live.wallet.creator.kyc.reviewNote')}
      </AppText>
    </ScrollView>
  );
}

function AmountAndConfirm({
  summary,
  step,
  setStep,
}: {
  summary: CreatorEarnings;
  step: 'amount' | 'confirm';
  setStep: (s: Step) => void;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const sar = useSar();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorMsg>(null);

  const min = summary.config.min_withdraw_sar;
  const max = summary.max_withdraw_sar;
  const amount = parseAmount(text);
  const valid = Number.isFinite(amount) && amount >= min && amount <= max;
  const diamonds = valid ? Math.ceil(amount / summary.config.sar_per_diamond) : 0;
  const tooLow = Number.isFinite(amount) && amount > 0 && amount < min;
  const tooHigh = Number.isFinite(amount) && amount > max;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await requestWithdrawal(amount);
      void queryClient.invalidateQueries({ queryKey: creatorKeys.all() });
      setStep('done');
    } catch (e) {
      setError({ key: `live.wallet.creator.errors.${payoutErrorCode(e)}`, params: { min: sar(min), age: summary.config.min_age } });
    } finally {
      setBusy(false);
    }
  }

  if (step === 'confirm') {
    return (
      <ScrollView contentContainerStyle={styles.body}>
        <View style={[styles.summary, { backgroundColor: colors.bg2 }]}>
          <Row label={t('live.wallet.creator.confirm.amount')} value={t('live.wallet.creator.sar', { amount: sar(amount) })} strong />
          <Row
            label={t('live.wallet.creator.confirm.diamonds')}
            value={t('live.wallet.creator.diamonds', { count: diamonds, n: diamonds.toLocaleString(i18n.language) })}
          />
          <Row label={t('live.wallet.creator.confirm.to')} value={`${summary.kyc?.iban_masked ?? ''}\n${summary.kyc?.bank_name ?? ''}`} />
          <Row label={t('live.wallet.creator.confirm.name')} value={summary.kyc?.legal_name ?? ''} />
        </View>
        <AppText variant="small" muted>
          {t('live.wallet.creator.amount.feeNote')}
        </AppText>
        <AppText variant="small" muted>
          {t('live.wallet.creator.amount.manualNote')}
        </AppText>
        <ErrorBox error={error} />
        <Button title={t('live.wallet.creator.confirm.submit')} onPress={() => void confirm()} loading={busy} />
        <Button title={t('live.wallet.creator.back')} variant="ghost" onPress={() => setStep('amount')} disabled={busy} />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <AppText variant="subtitle">{t('live.wallet.creator.amount.available', { amount: sar(max) })}</AppText>
      <AppText variant="small" muted>
        {t('live.wallet.creator.amount.limits', { min: sar(min), max: sar(max) })}
      </AppText>

      <Label>{t('live.wallet.creator.amount.label')}</Label>
      <View style={styles.amountRow}>
        <View style={{ flex: 1 }}>
          <TextField
            value={text}
            onChangeText={(v) => {
              setText(v);
              setError(null);
            }}
            keyboardType="decimal-pad"
            placeholder={sar(min)}
            accessibilityLabel={t('live.wallet.creator.amount.label')}
          />
        </View>
        <Button title={t('live.wallet.creator.amount.max')} variant="secondary" onPress={() => setText(max.toFixed(2))} style={styles.maxBtn} />
      </View>
      {tooLow ? (
        <AppText variant="small" style={{ color: colors.danger }}>
          {t('live.wallet.creator.errors.below_minimum', { min: sar(min) })}
        </AppText>
      ) : tooHigh ? (
        <AppText variant="small" style={{ color: colors.danger }}>
          {t('live.wallet.creator.errors.above_available')}
        </AppText>
      ) : null}

      <AppText variant="small" muted>
        {t('live.wallet.creator.amount.to', { iban: summary.kyc?.iban_masked ?? '', bank: summary.kyc?.bank_name ?? '' })}
      </AppText>
      <AppText variant="small" muted>
        {t('live.wallet.creator.amount.feeNote')}
      </AppText>
      <AppText variant="small" muted>
        {t('live.wallet.creator.amount.manualNote')}
      </AppText>
      <ErrorBox error={error} />
      <Button title={t('live.wallet.creator.amount.continue')} onPress={() => setStep('confirm')} disabled={!valid} />
    </ScrollView>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row} accessible>
      <AppText variant="small" muted style={{ flex: 1 }}>
        {label}
      </AppText>
      <Text style={[strong ? styles.rowStrong : styles.rowValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: '800', flex: 1, textAlign: 'center' },
  body: { padding: 16, gap: 10, paddingBottom: 40 },
  privacy: { flexDirection: 'row', gap: 10, borderRadius: 12, padding: 12, alignItems: 'flex-start' },
  photo: { width: '100%', aspectRatio: 1.6, borderRadius: 12 },
  photoButtons: { flexDirection: 'row', gap: 8 },
  check: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 8 },
  amountRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  maxBtn: { height: 48, paddingHorizontal: 16, marginVertical: 0 },
  summary: { borderRadius: 14, padding: 14, gap: 10 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  rowValue: { fontSize: 14, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  rowStrong: { fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  done: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
});
