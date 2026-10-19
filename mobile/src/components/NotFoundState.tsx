import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, TopBar } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';

export function goBackOrHome() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

// "This link goes nowhere": a deleted or never-existing video, user or
// conversation reached from a deep link or an old notification. A clear
// message and a way out, in place of an empty screen with a live composer.
// `embedded` drops the screen chrome for use inside a sheet.
export function NotFoundState({
  title,
  body,
  icon = 'alert-circle-outline',
  embedded = false,
  dark = false,
}: {
  title: string;
  body?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  embedded?: boolean;
  // On a black full-bleed screen such as the feed.
  dark?: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const text = dark ? '#fff' : colors.text;
  const muted = dark ? 'rgba(255,255,255,0.7)' : colors.muted;
  const content = (
    <View style={styles.wrap} accessibilityLiveRegion="polite">
      <Ionicons name={icon} size={48} color={dark ? 'rgba(255,255,255,0.6)' : colors.muted2} />
      <Text style={[styles.title, { color: text }]} accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text style={[styles.body, { color: muted }]}>{body}</Text> : null}
      <Button title={t('fix4.goBack')} variant="secondary" onPress={goBackOrHome} style={styles.btn} />
    </View>
  );
  if (embedded) return content;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: dark ? '#000' : colors.bg }} edges={['top', 'bottom']}>
      {dark ? null : <TopBar />}
      {content}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  title: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  body: { fontSize: 14.5, lineHeight: 21, textAlign: 'center' },
  btn: { paddingHorizontal: 28, marginTop: 8 },
});
