import { useRef, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useTheme } from '@/providers/ThemeProvider';

// One hidden input behind a row of boxes, rather than one input per digit:
// paste, SMS/email autofill and backspace all just work, which the web app
// had to wire up by hand box by box.
export function OtpInput({
  length,
  value,
  onChange,
  error,
}: {
  length: number;
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
}) {
  const { colors } = useTheme();
  const ref = useRef<ComponentRef<typeof TextInput>>(null);
  const digits = value.split('');
  return (
    <Pressable onPress={() => ref.current?.focus()} accessibilityRole="none">
      {/* Codes read left to right in every language. */}
      <View style={[styles.row, { direction: 'ltr' }]}>
        {Array.from({ length }, (_, i) => {
          const active = i === Math.min(value.length, length - 1);
          return (
            <View
              key={i}
              style={[
                styles.box,
                {
                  backgroundColor: colors.bg2,
                  borderColor: error ? colors.danger : active ? colors.primary : colors.border,
                },
              ]}
            >
              <Text style={[styles.digit, { color: colors.text }]}>{digits[i] ?? ''}</Text>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(t) => onChange(t.replace(/[^0-9]/g, '').slice(0, length))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={length}
        autoFocus
        style={styles.hidden}
        accessibilityLabel="code"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginVertical: 18 },
  box: { width: 46, height: 56, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  digit: { fontSize: 22, fontWeight: '700' },
  hidden: { position: 'absolute', opacity: 0, width: 1, height: 1 },
});
