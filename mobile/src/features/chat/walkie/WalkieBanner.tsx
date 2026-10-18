import { Ionicons } from '@expo/vector-icons';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/providers/ThemeProvider';

import type { WalkieControls } from './useWalkie';
import { talkingLine } from './WalkieBar';

// "X is talking" over the top of the thread, like the web app's red banner.
// With walkie off it doubles as the way in: "Listen" joins the channel.
export const WalkieBanner = memo(function WalkieBanner({ walkie }: { walkie: WalkieControls }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { speakers, on, setOn } = walkie;
  const line = speakers.length ? talkingLine(speakers, t) : '';

  // Announce when someone starts, not on every level-meter tick.
  const firstId = speakers[0]?.id ?? null;
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (firstId && firstId !== announced.current) {
      AccessibilityInfo.announceForAccessibility(on ? line : `${line}. ${t('walkie.listenHint')}`);
    }
    announced.current = firstId;
    // Only a change of speaker should speak up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstId]);

  if (!speakers.length) return null;
  return (
    <View style={[styles.banner, { backgroundColor: colors.danger }]} pointerEvents="box-none">
      <Ionicons name="radio" size={16} color={colors.onPrimary} />
      <Text style={[styles.text, { color: colors.onPrimary }]} numberOfLines={1}>
        {line}
      </Text>
      {!on ? (
        <Pressable
          onPress={() => setOn(true)}
          hitSlop={8}
          style={[styles.listen, { borderColor: colors.onPrimary }]}
          accessibilityRole="button"
          accessibilityLabel={t('walkie.listen')}
          accessibilityHint={t('walkie.listenHint')}
        >
          <Text style={[styles.listenText, { color: colors.onPrimary }]}>{t('walkie.listen')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 8,
    start: 12,
    end: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingStart: 12,
    paddingEnd: 6,
    minHeight: 40,
    borderRadius: 20,
  },
  text: { flex: 1, fontSize: 13.5, fontWeight: '700', textAlign: 'left' },
  listen: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5 },
  listenText: { fontSize: 13, fontWeight: '700' },
});
