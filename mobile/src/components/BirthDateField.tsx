import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/providers/ThemeProvider';

import { AppText, TextField } from './ui';

const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Value is an ISO date (YYYY-MM-DD) or ''.
export function BirthDateField({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const { t, i18n } = useTranslation();
  const { colors, isDark } = useTheme();
  const [iosOpen, setIosOpen] = useState(false);

  const today = new Date();
  const current = value ? new Date(value + 'T00:00:00') : new Date(today.getFullYear() - 18, 0, 1);

  // The native pickers do not exist on web.
  if (Platform.OS === 'web') {
    return <TextField value={value} onChangeText={onChange} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />;
  }

  function open() {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: current,
        mode: 'date',
        maximumDate: today,
        onChange: (event, d) => event.type === 'set' && d && onChange(toIso(d)),
      });
    } else {
      setIosOpen((o) => !o);
      if (!value) onChange(toIso(current));
    }
  }

  const label = value
    ? new Date(value + 'T00:00:00').toLocaleDateString(i18n.language, { year: 'numeric', month: 'long', day: 'numeric' })
    : t('register.birthPick');

  return (
    <View>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        style={[styles.field, { backgroundColor: colors.bg2, borderColor: iosOpen ? colors.primary : colors.border }]}
      >
        <AppText muted={!value}>{label}</AppText>
      </Pressable>
      {iosOpen ? (
        <DateTimePicker
          value={current}
          mode="date"
          display="spinner"
          maximumDate={today}
          locale={i18n.language}
          themeVariant={isDark ? 'dark' : 'light'}
          onChange={(_, d) => d && onChange(toIso(d))}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, height: 52, justifyContent: 'center', marginBottom: 12 },
});
