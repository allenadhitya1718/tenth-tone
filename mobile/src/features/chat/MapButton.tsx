import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

// The friends map's way in, at the top of Chats (owner: "eye catching", and
// not in Discover): a gradient pill with a soft pulsing halo, like Snap Map.
// The pulse stops when the phone asks for reduced motion.
export function MapButton() {
  const { t } = useTranslation();
  const [pulse] = useState(() => new Animated.Value(0));
  const [calm, setCalm] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setCalm);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setCalm);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (calm) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.delay(900),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [calm, pulse]);

  const halo = {
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
    transform: [{ scaleX: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }, { scaleY: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }],
  };

  return (
    <Pressable
      onPress={() => router.push('/map')}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={t('map.title')}
      style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}
    >
      <Animated.View style={[styles.halo, halo]} pointerEvents="none" />
      <LinearGradient colors={['#22C55E', '#06B6D4', '#3B82F6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.pill}>
        <View style={styles.iconDot}>
          <Ionicons name="location" size={14} color="#06B6D4" />
        </View>
        <Text style={styles.label} numberOfLines={1}>
          {t('mapEntry.label')}
        </Text>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  halo: { position: 'absolute', top: 6, bottom: 6, start: 0, end: 0, borderRadius: 18, backgroundColor: '#06B6D4' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingStart: 5, paddingEnd: 12, height: 32, borderRadius: 16 },
  iconDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  label: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});
