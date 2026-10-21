import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler, ScrollView, StyleSheet, Text, View } from 'react-native';

import { fetchBirthDateStrict, settingsKeys } from '@/api/settings';
import { BirthDateField } from '@/components/BirthDateField';
import { showAlert } from '@/components/Dialog';
import { showToast } from '@/components/Toast';
import { AppText, Button, Screen, TopBar } from '@/components/ui';
import { saveBirthDate, signOut } from '@/lib/auth';
import { useTheme } from '@/providers/ThemeProvider';

// Confirming your birthday (owner request). Asked once after signing in when
// the account has none (Apple / phone sign-in and accounts from the earlier
// app never asked), and reachable from Edit Profile. It lives in user_private:
// only you can read it, it is never on your profile, and the database lets it
// be set once and never changed (0036), because it is what the 18+ location
// check reads. Minimum age 13, also enforced there.
//
// gate: no way back, only "Sign out"; edit: an ordinary screen.
export function ConfirmBirthday({ mode }: { mode: 'gate' | 'edit' }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [birth, setBirth] = useState('');

  // A birthday that arrives meanwhile (saved by sign-up a moment after the
  // session started) ends the gate.
  const saved = useQuery({ queryKey: settingsKeys.birthDate(), queryFn: fetchBirthDateStrict, enabled: mode === 'gate' });
  useEffect(() => {
    if (mode === 'gate' && saved.data) router.replace('/');
  }, [mode, saved.data]);

  // As a gate, the Android back button does not skip it.
  useEffect(() => {
    if (mode !== 'gate') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [mode]);

  const save = useMutation({
    mutationFn: () => saveBirthDate(birth),
    onSuccess: () => {
      qc.setQueryData(settingsKeys.birthDate(), birth);
      void qc.invalidateQueries({ queryKey: settingsKeys.privateDetails() });
      void qc.invalidateQueries({ queryKey: settingsKeys.isAdult() });
      showToast(t('birthday.saved'));
      if (mode === 'gate') router.replace('/');
      else router.back();
    },
    onError: (e) => {
      const msg = String((e as Error)?.message ?? '');
      if (/minimum age/i.test(msg)) showAlert(t('birthday.tooYoungTitle'), t('birthday.tooYoung'));
      else if (/cannot be changed/i.test(msg)) {
        void qc.invalidateQueries({ queryKey: settingsKeys.birthDate() });
        showAlert(t('birthday.alreadySet'));
      } else if (/invalid birth date/i.test(msg)) showAlert(t('birthday.invalid'));
      else {
        console.warn('birthday save failed:', msg);
        showAlert(t('birthday.failed'));
      }
    },
  });

  // No corrections (owner): one last look before it is saved for good.
  const confirmSave = () =>
    showAlert(
      t('birthday.confirmTitle'),
      t('birthday.confirmBody', {
        date: new Date(`${birth}T00:00:00`).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' }),
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('birthday.confirmYes'), onPress: () => save.mutate() },
      ],
    );

  return (
    <Screen header={mode === 'edit' ? <TopBar title={t('birthday.title')} /> : undefined} contentStyle={styles.content}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="gift-outline" size={34} color={colors.primary} />
        </View>
        <AppText variant="title" style={styles.center}>
          {t('birthday.title')}
        </AppText>
        <AppText muted style={styles.center}>
          {t('birthday.body')}
        </AppText>
        <View style={styles.field}>
          <BirthDateField value={birth} onChange={setBirth} />
        </View>
        <View style={[styles.note, { backgroundColor: colors.bg2 }]}>
          <Ionicons name="lock-closed" size={16} color={colors.muted} />
          <Text style={[styles.noteText, { color: colors.muted }]}>{t('birthday.privateNote')}</Text>
        </View>
        <Button title={t('birthday.save')} onPress={confirmSave} disabled={!birth} loading={save.isPending} />
        {mode === 'gate' ? (
          <Text onPress={() => void signOut()} style={[styles.signOut, { color: colors.muted }]} accessibilityRole="button">
            {t('birthday.signOut')}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20 },
  body: { paddingTop: 40, paddingBottom: 40, gap: 14 },
  icon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  center: { textAlign: 'center' },
  field: { marginTop: 8 },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', borderRadius: 12, padding: 12 },
  noteText: { flex: 1, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  signOut: { textAlign: 'center', fontSize: 14, fontWeight: '600', paddingVertical: 12 },
});
