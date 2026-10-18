import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LEGAL_DOCS } from '@/lib/legal';
import { useTheme } from '@/providers/ThemeProvider';

// The terms and privacy policy over whatever screen you are on. Opening them
// must never unmount the signup form (Apple wants the agreement readable
// before an account exists, and losing the form there loses the reviewer).
export function LegalSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const [active, setActive] = useState<'terms' | 'privacy'>('terms');
  // The documents exist in Arabic and English only.
  const L = i18n.language === 'ar' ? 'ar' : 'en';
  const doc = LEGAL_DOCS[active];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        <View style={[styles.bar, { borderBottomColor: colors.border }]}>
          <View style={styles.tabs}>
            {(['terms', 'privacy'] as const).map((k) => (
              <Pressable
                key={k}
                onPress={() => setActive(k)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active === k }}
                style={[styles.tab, active === k && { backgroundColor: colors.primarySoft }]}
              >
                <Text style={{ color: active === k ? colors.primary2 : colors.muted, fontWeight: '700' }}>
                  {t(k === 'terms' ? 'legal.terms' : 'legal.privacy')}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
            <Text style={{ color: colors.primary2, fontWeight: '700' }}>{t('legal.close')}</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20 }} key={active}>
          <Text style={[styles.title, { color: colors.text, writingDirection: L === 'ar' ? 'rtl' : 'ltr' }]}>
            {doc.title[L]}
          </Text>
          {doc.sections.map((sec, i) => (
            <View key={i} style={{ marginBottom: 16 }}>
              <Text style={[styles.h, { color: colors.text, writingDirection: L === 'ar' ? 'rtl' : 'ltr' }]}>
                {i + 1}. {sec.h[L]}
              </Text>
              <Text style={[styles.p, { color: colors.muted, writingDirection: L === 'ar' ? 'rtl' : 'ltr' }]}>
                {sec.p[L]}
              </Text>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  tabs: { flexDirection: 'row', gap: 6 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16 },
  title: { fontSize: 22, fontWeight: '800', marginBottom: 14 },
  h: { fontSize: 15.5, fontWeight: '700', marginBottom: 6 },
  p: { fontSize: 14.5, lineHeight: 23 },
});
