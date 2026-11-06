import { Ionicons } from '@expo/vector-icons';
import { router, type ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import i18n from '@/i18n';
import { reportError } from '@/lib/errorReport';

// What the person sees instead of the app closing when a screen throws while
// it renders. Exported as `ErrorBoundary` from the root layout and the
// signed-in layout, so Expo Router wraps every screen in it.
//
// It must work when everything else is broken: no theme, query or auth
// providers (the root one sits outside them), plain colours, and text from
// i18next directly with English fallbacks in case translations never loaded.

const T = (key: string, fallback: string) => {
  try {
    return i18n.isInitialized ? i18n.t(key, { defaultValue: fallback }) : fallback;
  } catch {
    return fallback;
  }
};

export function AppErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    // Kept in the device log (adb logcat / Console) for the next bug report.
    console.error('FLYP screen error:', error?.message, error?.stack);
    void reportError('screen', error);
  }, [error]);

  const goHome = () => {
    try {
      router.replace('/');
    } catch {
      void retry();
    }
  };

  return (
    <View style={styles.root} accessibilityRole="alert">
      <View style={styles.icon}>
        <Ionicons name="alert-circle-outline" size={44} color="#9CC2FF" />
      </View>
      <Text style={styles.title}>{T('errors.screenTitle', 'Something went wrong')}</Text>
      <Text style={styles.body}>
        {T('errors.screenBody', "This screen hit a problem. Your data is safe. Try again, or go back to the home screen.")}
      </Text>
      <Pressable onPress={() => void retry()} style={[styles.btn, styles.primary]} accessibilityRole="button">
        <Text style={styles.primaryText}>{T('errors.tryAgain', 'Try again')}</Text>
      </Pressable>
      <Pressable onPress={goHome} style={styles.btn} accessibilityRole="button">
        <Text style={styles.secondaryText}>{T('errors.goHome', 'Go to home')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000421', alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  icon: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#0F1A45', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  title: { color: '#fff', fontSize: 21, fontWeight: '800', textAlign: 'center' },
  body: { color: 'rgba(255,255,255,0.75)', fontSize: 15, lineHeight: 21, textAlign: 'center', maxWidth: 340, marginBottom: 10 },
  btn: { alignSelf: 'stretch', minHeight: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: '#1E56D6' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryText: { color: '#9CC2FF', fontSize: 16, fontWeight: '700' },
});
