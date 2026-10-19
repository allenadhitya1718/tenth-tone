import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppleButton } from '@/components/AppleButton';
import { DARK, GlassButton, GradientButton, TopGlow } from '@/components/DarkAuth';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { LegalSheet } from '@/components/LegalSheet';
import { Logo } from '@/components/Logo';
import { ErrorBox, type ErrorMsg } from '@/components/ui';
import { toErrorMsg } from '@/hooks/useAuthError';

// Dark welcome: the glowing FLYP logo under a tilted three-screen showcase of
// the real app, melting into the page; headline, then the two actions.
const HERO_H = 300;

function Card({ source, w, h, rot, dx, dy, top }: { source: number; w: number; h: number; rot: number; dx: number; dy: number; top?: boolean }) {
  return (
    <View
      style={[
        styles.card,
        { width: w, height: h, transform: [{ translateX: dx }, { translateY: dy }, { rotate: `${rot}deg` }], opacity: top ? 1 : 0.75, zIndex: top ? 10 : 1 },
        top && { borderWidth: 2, borderColor: 'rgba(255,255,255,0.22)', borderRadius: 24 },
      ]}
    >
      <Image source={source} style={[StyleSheet.absoluteFill, { width: '100%', height: '100%', objectFit: 'cover' }]} accessibilityIgnoresInvertColors />
    </View>
  );
}

export default function Welcome() {
  const { t } = useTranslation();
  const [error, setError] = useState<ErrorMsg>(null);
  const [legal, setLegal] = useState(false);
  const [heroBox, setHeroBox] = useState(0);
  const rtl = I18nManager.isRTL;
  // Short phones shrink the collage instead of squeezing the actions.
  const scale = heroBox > 0 ? Math.min(1.3, (heroBox - 8) / HERO_H) : 1;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <TopGlow />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={[styles.top, { alignItems: rtl ? 'flex-start' : 'flex-end' }]}>
          <LanguageSwitch onDark />
        </View>

        <View style={styles.hero} onLayout={(e) => setHeroBox(e.nativeEvent.layout.height)}>
          <View style={[styles.collage, { transform: [{ scale }] }]}>
            <Card source={require('../../../assets/auth/shot-create.jpg')} w={135} h={230} rot={-12} dx={-55} dy={15} />
            <Card source={require('../../../assets/auth/shot-live.jpg')} w={135} h={230} rot={12} dx={55} dy={15} />
            <Card source={require('../../../assets/auth/shot-watch.jpg')} w={155} h={260} rot={0} dx={0} dy={0} top />
            <LinearGradient pointerEvents="none" colors={['rgba(7,8,13,0)', 'rgba(7,8,13,0.7)', DARK.bg]} style={styles.fade} />
          </View>
        </View>

        <View style={styles.copy}>
          <View style={styles.logoGlow}>
            <Logo width={140} />
          </View>
          <Text style={styles.headline}>{t('welcome.tagline')}</Text>
        </View>

        <View style={styles.actions}>
          <GradientButton title={t('welcome.new')} onPress={() => router.replace('/register')} />
          <GlassButton title={t('welcome.existing')} onPress={() => router.replace('/login')} />
          <AppleButton onError={(e) => setError(toErrorMsg(e))} forceLight />
          <ErrorBox error={error} />
          <Text style={styles.legal}>
            {t('welcome.agreePrefix')}{' '}
            <Text style={styles.legalLink} onPress={() => setLegal(true)} accessibilityRole="link">
              {t('legal.termsAndPrivacy')}
            </Text>
          </Text>
        </View>
        <LegalSheet visible={legal} onClose={() => setLegal(false)} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: DARK.bg },
  safe: { flex: 1, paddingBottom: 14 },
  top: { paddingHorizontal: 20, paddingTop: 12, height: 56 },
  hero: { flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center' },
  collage: { width: 320, height: HERO_H, alignItems: 'center', justifyContent: 'center' },
  card: { position: 'absolute', top: 10, borderRadius: 22, overflow: 'hidden', backgroundColor: '#11131F' },
  fade: { position: 'absolute', start: -20, end: -20, bottom: 0, height: HERO_H * 0.32, zIndex: 20 },
  copy: { alignItems: 'center', marginTop: -26, paddingHorizontal: 24 },
  logoGlow: { borderRadius: 14, shadowColor: DARK.blue, shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 0 }, elevation: 10 },
  headline: { color: DARK.text, fontSize: 28, lineHeight: 34, fontWeight: '800', textAlign: 'center', marginTop: 16, marginBottom: 20, maxWidth: 330 },
  actions: { width: '100%', maxWidth: 420, alignSelf: 'center', paddingHorizontal: 24, gap: 14 },
  legal: { fontSize: 13, lineHeight: 19, color: DARK.faint, textAlign: 'center', marginTop: 4 },
  legalLink: { color: DARK.link, fontWeight: '600' },
});
