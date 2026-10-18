import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';

type IconName = keyof typeof Ionicons.glyphMap;

// A photo, or the coloured initial used everywhere else in the app.
export const Avatar = memo(function Avatar({
  uri,
  name,
  size = 44,
}: {
  uri: string | null | undefined;
  name: string | null | undefined;
  size?: number;
}) {
  const { colors } = useTheme();
  const box = useMemo(
    () => ({ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primary }),
    [size, colors.primary],
  );
  const letter = useMemo(() => ({ fontSize: Math.round(size * 0.4) }), [size]);
  if (uri) {
    return <Image source={{ uri }} style={box} contentFit="cover" recyclingKey={uri} accessibilityIgnoresInvertColors />;
  }
  return (
    <View style={[styles.avatarFallback, box]}>
      <Text style={[styles.avatarLetter, letter]}>{(name ?? '').trim().slice(0, 1).toUpperCase() || '?'}</Text>
    </View>
  );
});

export function LoadingState() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <ActivityIndicator
      style={styles.spinner}
      color={colors.primary2}
      accessibilityLabel={t('discover.common.loading')}
    />
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={styles.state} accessibilityLiveRegion="polite">
      <Ionicons name="cloud-offline-outline" size={40} color={colors.muted2} />
      <Text style={[styles.stateTitle, { color: colors.text }]}>{t('discover.common.errorTitle')}</Text>
      <Text style={[styles.stateSub, { color: colors.muted }]}>{t('discover.common.errorSub')}</Text>
      <Button title={t('discover.common.retry')} variant="secondary" onPress={onRetry} style={styles.stateBtn} />
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  sub,
  action,
}: {
  icon: IconName;
  title: string;
  sub?: string;
  action?: { title: string; onPress: () => void };
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.state}>
      <Ionicons name={icon} size={44} color={colors.muted2} />
      <Text style={[styles.stateTitle, { color: colors.text }]}>{title}</Text>
      {sub ? <Text style={[styles.stateSub, { color: colors.muted }]}>{sub}</Text> : null}
      {action ? <Button title={action.title} onPress={action.onPress} style={styles.stateBtn} /> : null}
    </View>
  );
}

// A section heading with an optional "See all" on the trailing edge; row
// direction already follows the layout direction, so RTL needs nothing.
export function SectionHead({ title, onMore }: { title: string; onMore?: () => void }) {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={styles.sectionHead}>
      <Text style={[styles.sectionTitle, { color: colors.text }]} accessibilityRole="header">
        {title}
      </Text>
      {onMore ? (
        <Pressable onPress={onMore} hitSlop={10} accessibilityRole="button" style={styles.more}>
          <Text style={[styles.moreText, { color: isDark ? colors.primary2 : colors.primary }]}>
            {t('discover.common.seeAll')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { color: '#fff', fontWeight: '800' },
  spinner: { marginVertical: 40 },
  state: { alignItems: 'center', gap: 10, paddingHorizontal: 36, paddingVertical: 48 },
  stateTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  stateSub: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  stateBtn: { alignSelf: 'stretch', marginTop: 8, height: 46 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 18,
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 17, fontWeight: '800' },
  more: { minHeight: 32, justifyContent: 'center' },
  moreText: { fontSize: 14, fontWeight: '700' },
});
