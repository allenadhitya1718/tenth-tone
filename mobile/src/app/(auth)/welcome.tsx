import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { AppleButton } from '@/components/AppleButton';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { LegalSheet } from '@/components/LegalSheet';
import { PRE, PreLoginSurface } from '@/components/PreLoginSurface';
import { ErrorBox, type ErrorMsg } from '@/components/ui';
import { WelcomeArt } from '@/components/WelcomeArt';
import { toErrorMsg } from '@/hooks/useAuthError';
import { useTheme } from '@/providers/ThemeProvider';

// The fork in the road: new person or returning one. No logo and no heading,
// as on the web: the name is on the icon they tapped, and the sentence that
// says what FLYP is for is the headline.
export default function Welcome() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [error, setError] = useState<ErrorMsg>(null);
  const [legal, setLegal] = useState(false);

  return (
    <PreLoginSurface>
      <View style={{ alignItems: 'center' }}>
        <LanguageSwitch onLight />
      </View>
      <View style={styles.hero}>
        <WelcomeArt width={Math.min(268, width * 0.78)} />
        <Text style={styles.headline}>{t('welcome.tagline')}</Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={() => router.replace('/register')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.btn, styles.primaryBtn, { backgroundColor: pressed ? colors.primaryPressed : colors.primary }]}
        >
          <Text style={[styles.btnText, { color: '#fff' }]}>{t('welcome.new')}</Text>
        </Pressable>
        <Pressable onPress={() => router.replace('/login')} accessibilityRole="button" style={[styles.btn, styles.outlineBtn]}>
          <Text style={[styles.btnText, { color: PRE.ink }]}>{t('welcome.existing')}</Text>
        </Pressable>
        <AppleButton onError={(e) => setError(toErrorMsg(e))} forceLight />
        <ErrorBox error={error} />
        <Text style={styles.legal}>
          {t('welcome.agreePrefix')}{' '}
          <Text style={[styles.legalLink, { color: colors.primary }]} onPress={() => setLegal(true)}>
            {t('legal.termsAndPrivacy')}
          </Text>
        </Text>
      </View>
      <LegalSheet visible={legal} onClose={() => setLegal(false)} />
    </PreLoginSurface>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 34 },
  headline: { fontSize: 22, fontWeight: '700', lineHeight: 30, color: '#1b1b2e', maxWidth: 260, textAlign: 'center', marginTop: 26 },
  actions: { width: '100%', maxWidth: 340, alignSelf: 'center', gap: 12 },
  btn: { height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  primaryBtn: { shadowColor: '#1e56d6', shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
  outlineBtn: { backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(20,20,26,0.14)' },
  btnText: { fontSize: 16, fontWeight: '700' },
  legal: { fontSize: 12, color: PRE.faint, textAlign: 'center', marginTop: 2 },
  legalLink: { textDecorationLine: 'underline' },
});
