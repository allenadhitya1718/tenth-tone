import { memo, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '@/providers/ThemeProvider';

// The compact button used inline on rows (Approve / Decline, Allow / Deny).
export const PillButton = memo(function PillButton({
  title,
  onPress,
  primary,
  loading,
  disabled,
  label,
}: {
  title: string;
  onPress: () => void;
  primary?: boolean;
  loading?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const { colors } = useTheme();
  const tone = useMemo(
    () => ({
      on: [styles.btn, { backgroundColor: colors.primary }],
      off: [styles.btn, { backgroundColor: colors.bg3 }],
      onText: [styles.text, { color: colors.onPrimary }],
      offText: [styles.text, { color: colors.text }],
    }),
    [colors],
  );
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={[primary ? tone.on : tone.off, off && styles.dim]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={primary ? colors.onPrimary : colors.muted} />
      ) : (
        <Text style={primary ? tone.onText : tone.offText} numberOfLines={1}>
          {title}
        </Text>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  btn: {
    minWidth: 76,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontSize: 13.5, fontWeight: '700' },
  dim: { opacity: 0.6 },
});
