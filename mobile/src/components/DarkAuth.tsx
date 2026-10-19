import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, I18nManager, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

// Shared pieces of the dark entry screens (welcome, login). They ignore the
// theme on purpose: the FLYP logo sits on its own navy ground, so a dark page
// lets it blend in instead of looking like a sticker.

export const DARK = {
  bg: '#07080D',
  surface: '#111420',
  surfaceFocus: '#15192B',
  border: 'rgba(255,255,255,0.10)',
  text: '#FFFFFF',
  sub: '#94A3B8',
  faint: '#64748B',
  link: '#60A5FA',
  blue: '#3B82F6',
};
export const CTA: [string, string, string] = ['#3B82F6', '#6366F1', '#8B5CF6'];

/** Soft blue glow at the top of the page. */
export function TopGlow() {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={['rgba(59,130,246,0.25)', 'rgba(99,102,241,0.08)', 'transparent']}
      style={{ position: 'absolute', top: 0, start: 0, end: 0, height: 380 }}
    />
  );
}

export function GradientButton({ title, onPress, loading }: { title: string; onPress?: () => void; loading?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!loading, busy: !!loading }}
      style={({ pressed }) => [styles.ctaWrap, pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] }]}
    >
      <LinearGradient colors={CTA} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.cta}>
        {loading ? <ActivityIndicator color="#fff" /> : null}
        <Text style={styles.ctaText}>{title}</Text>
      </LinearGradient>
    </Pressable>
  );
}

export function GlassButton({ title, onPress }: { title: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.glass, pressed && { opacity: 0.8 }]}>
      <Text style={[styles.ctaText, { fontWeight: '600' }]}>{title}</Text>
    </Pressable>
  );
}

export function CircleBack({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.back')} style={styles.circle}>
      {/* The chevron points the way "back" goes, which flips in RTL. */}
      <Ionicons name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'} size={22} color="#fff" />
    </Pressable>
  );
}

export function GlassField({
  icon,
  secure,
  right,
  ...rest
}: TextInputProps & { icon: React.ComponentProps<typeof Ionicons>['name']; secure?: boolean; right?: ReactNode }) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  return (
    <View
      style={[
        styles.field,
        { backgroundColor: focused ? DARK.surfaceFocus : DARK.surface, borderColor: focused ? DARK.blue : DARK.border },
      ]}
    >
      <Ionicons name={icon} size={20} color={focused ? DARK.blue : DARK.faint} />
      <TextInput
        placeholderTextColor={DARK.faint}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        secureTextEntry={secure ? hidden : false}
        style={[styles.input, { textAlign: I18nManager.isRTL ? 'right' : 'left' }]}
      />
      {secure ? (
        <Pressable
          onPress={() => setHidden((h) => !h)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={hidden ? t('password.show') : t('password.hide')}
        >
          <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={20} color={DARK.sub} />
        </Pressable>
      ) : null}
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  ctaWrap: { borderRadius: 28, shadowColor: '#4F46E5', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  cta: { height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  glass: { height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  circle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  field: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 58, borderRadius: 16, paddingHorizontal: 16, borderWidth: 1.5 },
  input: { flex: 1, color: '#fff', fontSize: 16, height: '100%' },
});
