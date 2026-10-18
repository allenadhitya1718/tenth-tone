import { Ionicons } from '@expo/vector-icons';
import type { TFunction } from 'i18next';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/providers/ThemeProvider';

import type { WalkieControls } from './useWalkie';

// The strip above the composer while walkie is on: what state the channel is
// in, who else is listening or talking, and the way out.
export const WalkieBar = memo(function WalkieBar({ walkie }: { walkie: WalkieControls }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { status, error, talking, speakers, listeners } = walkie;

  let line: string;
  if (error) line = t(`walkie.errors.${error}`);
  else if (status === 'connecting') line = t('walkie.connecting');
  else if (status === 'reconnecting') line = t('walkie.reconnecting');
  else if (talking) line = t('walkie.youAreLive');
  else if (speakers.length) line = talkingLine(speakers, t);
  else line = listeners ? t('walkie.listening', { count: listeners }) : t('walkie.nobodyListening');

  const busy = !error && (status === 'connecting' || status === 'reconnecting');
  const dot = error ? colors.danger : talking ? colors.danger : status === 'connected' ? colors.success : colors.warn;

  return (
    <View style={[styles.bar, { borderTopColor: colors.border, backgroundColor: colors.bg2 }]}>
      {busy ? (
        <ActivityIndicator size="small" color={colors.muted} />
      ) : (
        <View style={[styles.dot, { backgroundColor: dot }]} />
      )}
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {t('walkie.title')}
        </Text>
        <Text
          style={[styles.line, { color: error ? colors.danger : colors.muted }]}
          numberOfLines={2}
          accessibilityLiveRegion="polite"
          accessibilityRole={error ? 'alert' : 'text'}
        >
          {line}
        </Text>
      </View>
      {error === 'mic_denied' ? (
        <Pressable
          onPress={() => void Linking.openSettings()}
          hitSlop={6}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel={t('walkie.openSettings')}
        >
          <Text style={[styles.actionText, { color: colors.primary2 }]}>{t('walkie.openSettings')}</Text>
        </Pressable>
      ) : error && error !== 'forbidden' && error !== 'not_installed' ? (
        <Pressable
          onPress={walkie.retry}
          hitSlop={6}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel={t('walkie.retry')}
        >
          <Text style={[styles.actionText, { color: colors.primary2 }]}>{t('walkie.retry')}</Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => walkie.setOn(false)}
        hitSlop={8}
        style={styles.close}
        accessibilityRole="button"
        accessibilityLabel={t('walkie.turnOff')}
      >
        <Ionicons name="close" size={22} color={colors.muted} />
      </Pressable>
    </View>
  );
});

export function talkingLine(speakers: { name: string | null }[], t: TFunction) {
  const first = speakers[0]?.name || t('walkie.someone');
  return speakers.length > 1
    ? t('walkie.manyTalking', { name: first, count: speakers.length - 1 })
    : t('walkie.isTalking', { name: first });
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingStart: 14,
    paddingEnd: 4,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 13, fontWeight: '700', textAlign: 'left' },
  line: { fontSize: 13, textAlign: 'left' },
  action: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
  actionText: { fontSize: 14, fontWeight: '700' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
