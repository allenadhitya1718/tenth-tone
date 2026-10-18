import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Screen, TopBar } from '@/components/ui';
import { LANGUAGES, setLanguage } from '@/i18n';
import { signOut } from '@/lib/auth';
import { useTheme, type ThemePref } from '@/providers/ThemeProvider';

// Phase 1 only needs language and appearance. The full settings list, with
// the privacy options from note 13, comes in Phase 3.
export default function Settings() {
  const { t, i18n } = useTranslation();
  const { colors, pref, setPref } = useTheme();

  const Row = ({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      style={[styles.row, { borderBottomColor: colors.border }]}
    >
      <AppText>{label}</AppText>
      {selected ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
    </Pressable>
  );

  return (
    <Screen header={<TopBar title={t('settings.title')} />}>
      <AppText variant="small" muted style={styles.section}>
        {t('settings.language')}
      </AppText>
      <View style={[styles.card, { backgroundColor: colors.bg2 }]}>
        {LANGUAGES.map((l) => (
          <Row
            key={l.code}
            label={l.native}
            selected={i18n.language === l.code}
            onPress={() => i18n.language !== l.code && setLanguage(l.code)}
          />
        ))}
      </View>
      <AppText variant="small" muted style={{ marginTop: 6 }}>
        {t('settings.restartNote')}
      </AppText>

      <AppText variant="small" muted style={styles.section}>
        {t('settings.appearance')}
      </AppText>
      <View style={[styles.card, { backgroundColor: colors.bg2 }]}>
        {(['system', 'light', 'dark'] as ThemePref[]).map((p) => (
          <Row key={p} label={t(`settings.${p}`)} selected={pref === p} onPress={() => setPref(p)} />
        ))}
      </View>

      <Button title={t('settings.logout')} variant="secondary" style={{ marginTop: 28 }} onPress={() => signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 18, marginBottom: 8, fontWeight: '700' },
  card: { borderRadius: 14, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 50,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
