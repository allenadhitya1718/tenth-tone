import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText, Button, TopBar } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';

// The wallet before launch: no balance, packages or history (nothing that could
// look like real money), just what is coming. The full screen stays in
// ./Wallet.tsx; point app/(app)/wallet.tsx back at it to launch.

const FEATURES: { key: 'coins' | 'gifts' | 'earnings'; icon: ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'coins', icon: 'wallet-outline' },
  { key: 'gifts', icon: 'gift-outline' },
  { key: 'earnings', icon: 'trending-up-outline' },
];

export function WalletComingSoon() {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const accent = isDark ? colors.primary2 : colors.primary;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <TopBar title={t('live.wallet.title')} />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={[styles.hero, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="wallet" size={44} color={accent} />
        </View>
        <View style={[styles.badge, { borderColor: accent }]}>
          <Text style={[styles.badgeText, { color: accent }]}>{t('live.wallet.soon.badge')}</Text>
        </View>
        <AppText variant="title" center accessibilityRole="header">
          {t('live.wallet.soon.title')}
        </AppText>
        <AppText muted center style={styles.lead}>
          {t('live.wallet.soon.body')}
        </AppText>

        <View style={[styles.card, { backgroundColor: colors.bg2 }]}>
          {FEATURES.map((f) => (
            <View key={f.key} style={styles.row} accessible>
              <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
                <Ionicons name={f.icon} size={22} color={accent} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="label">{t(`live.wallet.soon.${f.key}Title`)}</AppText>
                <AppText variant="small" muted>
                  {t(`live.wallet.soon.${f.key}Body`)}
                </AppText>
              </View>
            </View>
          ))}
        </View>

        <Button title={t('live.wallet.soon.back')} variant="secondary" onPress={back} style={styles.button} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 24, paddingTop: 36, alignItems: 'center', gap: 12 },
  hero: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },
  lead: { maxWidth: 340, marginBottom: 8 },
  card: { alignSelf: 'stretch', borderRadius: 18, padding: 16, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  button: { alignSelf: 'stretch', marginTop: 12 },
});
