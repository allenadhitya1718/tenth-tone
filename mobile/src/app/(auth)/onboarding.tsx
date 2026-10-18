import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, I18nManager, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { LanguageSwitch } from '@/components/LanguageSwitch';
import { PhoneArt, type ArtKind } from '@/components/PhoneArt';
import { PRE, PreLoginSurface } from '@/components/PreLoginSurface';
import { Button } from '@/components/ui';
import { markOnboarded } from '@/lib/onboarding';
import { useTheme } from '@/providers/ThemeProvider';

const SLIDES: { art: ArtKind; key: string }[] = [
  { art: 'watch', key: 'watch' },
  { art: 'create', key: 'create' },
  { art: 'live', key: 'live' },
  { art: 'chat', key: 'chat' },
];

export default function Onboarding() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const [idx, setIdx] = useState(0);
  const [fade] = useState(() => new Animated.Value(1));
  const touchX = useRef<number | null>(null);

  // Short screens shrink the mock-up so the dots and button stay visible,
  // like the max-height media queries on the web.
  const scale = height <= 640 ? 0.66 : height <= 740 ? 0.84 : 1;
  const last = idx === SLIDES.length - 1;

  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, [idx, fade]);

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
    <PreLoginSurface>
      <View style={styles.top}>
        <LanguageSwitch onLight />
        <Pressable onPress={finish} hitSlop={10} style={{ opacity: last ? 0 : 1 }} disabled={last} accessibilityRole="button">
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
          const forward = I18nManager.isRTL ? dx > 0 : dx < 0;
          step(forward ? 1 : -1);
        }}
      >
        <Animated.View
          style={{
            alignItems: 'center',
            maxWidth: 300,
            opacity: fade,
            transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
          }}
        >
          <PhoneArt kind={s.art} scale={scale} style={{ marginBottom: 26 * scale }} />
          <Text style={styles.title}>{t(`onboarding.${s.key}Title`)}</Text>
          <Text style={styles.sub}>{t(`onboarding.${s.key}Sub`)}</Text>
        </Animated.View>
      </View>

      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i === idx && { width: 22, backgroundColor: colors.primary }]}
          />
        ))}
      </View>
      <Button title={last ? t('onboarding.start') : t('common.next')} onPress={() => step(1)} />
    </PreLoginSurface>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  skip: { color: '#6b6b7b', fontSize: 14, fontWeight: '600', padding: 8 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: PRE.ink, fontSize: 23, fontWeight: '800', textAlign: 'center', marginBottom: 10, letterSpacing: -0.4 },
  sub: { color: PRE.sub, fontSize: 14.5, lineHeight: 24, textAlign: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 7, marginTop: 18, marginBottom: 20 },
  dot: { width: 7, height: 7, borderRadius: 99, backgroundColor: 'rgba(20,20,26,0.16)' },
});
