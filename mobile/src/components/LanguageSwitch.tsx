import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LANGUAGES, setLanguage } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';

// Compact pill on the tour, welcome and login screens. `onLight` is for the
// pre-login screens, which stay light whatever the theme (as on the web app).
// With nine languages a row of buttons no longer fits, so the pill shows the
// current one and opens a list.
export function LanguageSwitch({ onLight, onDark }: { onLight?: boolean; onDark?: boolean }) {
  const { i18n } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const current = LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[0];
  // `onDark` is for the dark entry screens, which ignore the theme.
  const wrapBg = onDark ? 'rgba(255,255,255,0.08)' : onLight ? 'rgba(20,20,26,0.06)' : colors.bg2;
  const wrapBorder = onDark ? 'rgba(255,255,255,0.15)' : onLight ? 'rgba(20,20,26,0.08)' : colors.border;
  const fg = onDark ? '#FFFFFF' : onLight ? '#2b2b36' : colors.text;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${current.native}, ${current.english}`}
        hitSlop={6}
        style={[styles.pill, { backgroundColor: wrapBg, borderColor: wrapBorder }]}
      >
        <Ionicons name="globe-outline" size={16} color={fg} />
        <Text style={[styles.pillText, { color: fg }]}>{current.native}</Text>
        <Ionicons name="chevron-down" size={14} color={fg} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} onPress={() => setOpen(false)} accessibilityRole="button" />
        <View style={[styles.sheet, { backgroundColor: colors.bg, paddingBottom: insets.bottom + 12 }]}>
          <View style={[styles.grabber, { backgroundColor: colors.muted2 }]} />
          <ScrollView bounces={false}>
            {LANGUAGES.map((l) => {
              const on = l.code === current.code;
              return (
                <Pressable
                  key={l.code}
                  onPress={() => {
                    setOpen(false);
                    if (!on) void setLanguage(l.code);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bg2 }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowNative, { color: colors.text }]}>{l.native}</Text>
                    {l.english !== l.native ? <Text style={[styles.rowEnglish, { color: colors.muted }]}>{l.english}</Text> : null}
                  </View>
                  {on ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  pillText: { fontWeight: '700', fontSize: 13 },
  sheet: { position: 'absolute', start: 0, end: 0, bottom: 0, maxHeight: '75%', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 8 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 12 },
  rowNative: { fontSize: 16, fontWeight: '600' },
  rowEnglish: { fontSize: 13, marginTop: 2 },
});
