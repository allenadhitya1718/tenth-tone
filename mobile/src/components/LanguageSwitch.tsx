import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LANGUAGES, setLanguage } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';

// Compact pill on the tour, welcome and login screens. `onLight` is for the
// pre-login screens, which stay light whatever the theme (as on the web app).
export function LanguageSwitch({ onLight }: { onLight?: boolean }) {
  const { i18n } = useTranslation();
  const { colors } = useTheme();
  const wrapBg = onLight ? 'rgba(20,20,26,0.06)' : colors.bg2;
  const wrapBorder = onLight ? 'rgba(20,20,26,0.08)' : colors.border;
  const idle = onLight ? '#5b5b6b' : colors.text;
  return (
    <View style={[styles.wrap, { backgroundColor: wrapBg, borderColor: wrapBorder }]}>
      {LANGUAGES.map((l) => {
        const on = i18n.language === l.code;
        return (
          <Pressable
            key={l.code}
            onPress={() => !on && setLanguage(l.code)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.item, on && { backgroundColor: colors.primary }]}
          >
            <Text style={{ color: on ? colors.onPrimary : idle, fontWeight: '700', fontSize: 13 }}>{l.native}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', borderRadius: 20, borderWidth: 1, padding: 3 },
  item: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
});
