import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, I18nManager, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Alert } from '@/components/Dialog';
import { report, type ReportTarget } from '@/api/moderation';
import { useTheme } from '@/providers/ThemeProvider';

import { BottomSheet } from './BottomSheet';

// The reasons the web app offers. `stored` is what lands in reports.reason
// (read by the admin panel, which is Arabic): kept identical to the web
// build so one report queue reads one vocabulary.
const REASONS = [
  { key: 'reasonInappropriate', stored: 'محتوى غير لائق' },
  { key: 'reasonHate', stored: 'خطاب كراهية أو تنمر' },
  { key: 'reasonViolence', stored: 'عنف أو محتوى صادم' },
  { key: 'reasonImpersonation', stored: 'انتحال شخصية' },
  { key: 'reasonMisleading', stored: 'محتوى مضلل' },
  { key: 'reasonSpam', stored: 'بريد عشوائي' },
  { key: 'reasonOther', stored: 'أخرى' },
] as const;

type Props = {
  visible: boolean;
  onClose: () => void;
  targetType: ReportTarget;
  targetId: string;
};

export function ReportSheet({ visible, onClose, targetType, targetId }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [picked, setPicked] = useState<number | null>(null);
  const [details, setDetails] = useState('');

  function close() {
    setPicked(null);
    setDetails('');
    onClose();
  }

  const send = useMutation({
    mutationFn: () => {
      const extra = details.trim().slice(0, 200);
      return report({
        targetType,
        targetId,
        reason: REASONS[picked ?? 0].stored + (extra ? `: ${extra}` : ''),
      });
    },
    onSuccess: () => {
      close();
      Alert.alert(t('ugc.reportSent'));
    },
    onError: () => Alert.alert(t('ugc.reportFailed')),
  });

  return (
    <BottomSheet visible={visible} onClose={close}>
      <Text style={[styles.title, { color: colors.text }]}>{t('ugc.reportTitle')}</Text>
      <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }}>
        {REASONS.map((r, i) => {
          const on = picked === i;
          return (
            <Pressable
              key={r.key}
              onPress={() => setPicked(i)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={[styles.row, { borderBottomColor: colors.border }]}
            >
              <Text style={[styles.reason, { color: colors.text }]}>{t(`ugc.${r.key}`)}</Text>
              <View style={[styles.radio, { borderColor: on ? colors.primary : colors.muted2 }]}>
                {on ? <View style={[styles.dot, { backgroundColor: colors.primary }]} /> : null}
              </View>
            </Pressable>
          );
        })}
        {picked !== null ? (
          <TextInput
            value={details}
            onChangeText={(v) => setDetails(v.slice(0, 200))}
            placeholder={t('ugc.detailsPlaceholder')}
            placeholderTextColor={colors.muted}
            multiline
            style={[
              styles.details,
              { color: colors.text, backgroundColor: colors.bg2, textAlign: I18nManager.isRTL ? 'right' : 'left' },
            ]}
          />
        ) : null}
      </ScrollView>
      <Pressable
        onPress={() => send.mutate()}
        disabled={picked === null || send.isPending}
        accessibilityRole="button"
        style={[styles.submit, { backgroundColor: picked === null ? colors.bg3 : colors.primary }]}
      >
        {send.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={[styles.submitText, { color: picked === null ? colors.muted : '#fff' }]}>{t('ugc.submit')}</Text>
        )}
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '800', textAlign: 'center', marginVertical: 8, paddingHorizontal: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  reason: { fontSize: 15, flex: 1 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  details: { marginHorizontal: 16, marginTop: 12, minHeight: 70, borderRadius: 12, padding: 12, fontSize: 15, textAlignVertical: 'top' },
  submit: { marginHorizontal: 16, marginTop: 14, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  submitText: { fontSize: 15, fontWeight: '800' },
});
