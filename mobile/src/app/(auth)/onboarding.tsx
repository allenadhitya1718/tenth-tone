import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LanguageSwitch } from '@/components/LanguageSwitch';
import { ART_H, ART_W, OnboardingArt, type ArtKind } from '@/components/OnboardingArt';
import { markOnboarded } from '@/lib/onboarding';

// Dark-first tour. The ambient glow behind the mock-up changes colour per
// slide; the mock-ups themselves live in OnboardingArt.
const SLIDES: { art: ArtKind; key: string; glow: [string, string, string] }[] = [
  { art: 'watch', key: 'watch', glow: ['rgba(59,130,246,0.28)', 'rgba(236,72,153,0.22)', 'transparent'] },
  { art: 'create', key: 'create', glow: ['rgba(6,182,212,0.28)', 'rgba(244,63,94,0.22)', 'transparent'] },
  { art: 'live', key: 'live', glow: ['rgba(244,63,94,0.30)', 'rgba(139,92,246,0.25)', 'transparent'] },
  { art: 'chat', key: 'chat', glow: ['rgba(16,185,129,0.25)', 'rgba(59,130,246,0.25)', 'transparent'] },
];

const BG = '#07080D';
const CTA: [string, string, string] = ['#3B82F6', '#6366F1', '#8B5CF6'];

function Glow({ colors, on }: { colors: [string, string, string]; on: boolean }) {
  const a = useAnimatedStyle(() => ({ opacity: withTiming(on ? 1 : 0, { duration: 450 }) }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, a]} pointerEvents="none">
      <LinearGradient colors={colors} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 0.75 }} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

function Dot({ active }: { active: boolean }) {
  const a = useAnimatedStyle(() => ({
    width: withTiming(active ? 28 : 8, { duration: 250 }),
    backgroundColor: active ? '#6366F1' : 'rgba(255,255,255,0.2)',
  }));
  return <Animated.View style={[styles.dot, a]} />;
}

export default function Onboarding() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [idx, setIdx] = useState(0);
  const touchX = useRef<number | null>(null);

  // The frame is oversized: ~76% of the width and up to 58% of the height. On
  // short screens it shrinks so the title, dots and button always fit below.
  const DOCK = 232 - 28; // title block + dots + button, minus the overlap
  const room = height - insets.top - insets.bottom - 50 - 24 - DOCK;
  const scale = Math.min((width * 0.7) / ART_W, (height * 0.6) / ART_H, room / ART_H, 1.25);
  const last = idx === SLIDES.length - 1;
  const rtl = I18nManager.isRTL;

  async function finish() {
    await markOnboarded();
    // Replace all the way in: nothing under the feed can be a sign-in screen.
    router.replace('/welcome');
  }

  function step(dir: 1 | -1) {
    if (last && dir > 0) return finish();
    setIdx((i) => Math.min(SLIDES.length - 1, Math.max(0, i + dir)));
  }

  const s = SLIDES[idx];

  return (
    <View style={[styles.root, { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 18 }]}>
      <StatusBar style="light" />
      {SLIDES.map((sl, i) => (
        <Glow key={sl.key} colors={sl.glow} on={i === idx} />
      ))}

      <View style={styles.top}>
        <LanguageSwitch onDark />
        <Pressable onPress={finish} hitSlop={12} style={{ opacity: last ? 0 : 1 }} disabled={last} accessibilityRole="button">
          <Text style={styles.skip}>{t('onboarding.skip')}</Text>
        </Pressable>
      </View>

      <View
        style={styles.stage}
        onTouchStart={(e) => (touchX.current = e.nativeEvent.pageX)}
        onTouchEnd={(e) => {
          if (touchX.current == null) return;
          const dx = e.nativeEvent.pageX - touchX.current;
          touchX.current = null;
          if (Math.abs(dx) < 45) return;
          // "Forward" follows reading direction, so the gesture mirrors in Arabic.
          step((rtl ? dx > 0 : dx < 0) ? 1 : -1);
        }}
      >
        <Animated.View key={idx} entering={FadeIn.duration(350)} style={{ alignItems: 'center' }}>
          <OnboardingArt kind={s.art} scale={scale} />
        </Animated.View>
      </View>

      <View style={styles.dock}>
        {/* Fixed height so a two-line title doesn't push the dots and button around between slides. */}
        <Animated.View key={`t${idx}`} entering={FadeInDown.duration(350)} style={{ alignItems: 'center', height: 128 }}>
          <Text style={styles.title}>{t(`onboarding.${s.key}Title`)}</Text>
          <Text style={styles.sub}>{t(`onboarding.${s.key}Sub`)}</Text>
        </Animated.View>
        <View style={styles.dots}>
          {SLIDES.map((sl, i) => (
            <Dot key={sl.key} active={i === idx} />
          ))}
        </View>
        <Pressable onPress={() => step(1)} accessibilityRole="button" style={({ pressed }) => [styles.ctaWrap, pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] }]}>
          <LinearGradient colors={CTA} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.cta}>
            <Text style={styles.ctaTxt}>{last ? t('onboarding.start') : t('common.next')}</Text>
            <Ionicons name="arrow-forward" size={20} color="#fff" style={rtl ? { transform: [{ scaleX: -1 }] } : undefined} />
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, paddingHorizontal: 22 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 50 },
  skip: { color: '#94A3B8', fontSize: 15, fontWeight: '600', padding: 8 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 12 },
  // Pulled up over the faded bottom edge of the frame.
  dock: { alignItems: 'center', marginTop: -28 },
  title: { color: '#fff', fontSize: 28, fontWeight: '800', letterSpacing: -0.5, textAlign: 'center', marginBottom: 8 },
  sub: { color: '#94A3B8', fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: '88%' },
  dots: { flexDirection: 'row', gap: 7, marginTop: 20, marginBottom: 20, alignItems: 'center' },
  dot: { height: 8, borderRadius: 4 },
  ctaWrap: { alignSelf: 'stretch', borderRadius: 28, shadowColor: '#6366F1', shadowOpacity: 0.55, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  cta: { height: 56, borderRadius: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ctaTxt: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
