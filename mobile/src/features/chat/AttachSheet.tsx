import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/features/safety/BottomSheet';
import { useTheme } from '@/providers/ThemeProvider';

export type AttachKind = 'camera' | 'photos' | 'video' | 'location';

const ITEMS: { kind: AttachKind; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [
  { kind: 'camera', icon: 'camera', color: '#F43F5E' },
  { kind: 'photos', icon: 'images', color: '#8B5CF6' },
  { kind: 'video', icon: 'videocam', color: '#F59E0B' },
  { kind: 'location', icon: 'location', color: '#10B981' },
];

// The composer's "+" (as in the earlier app and WhatsApp): camera, photos,
// a video, or a location.
export function AttachSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (k: AttachKind) => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <BottomSheet visible={open} onClose={onClose}>
      <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
        {t('attach.title')}
      </Text>
      <View style={styles.grid}>
        {ITEMS.map((it) => (
          <Pressable
            key={it.kind}
            onPress={() => {
              onClose();
              onPick(it.kind);
            }}
            style={styles.item}
            accessibilityRole="button"
            accessibilityLabel={t(`attach.${it.kind}`)}
          >
            <View style={[styles.icon, { backgroundColor: it.color }]}>
              <Ionicons name={it.icon} size={26} color="#FFFFFF" />
            </View>
            <Text style={[styles.label, { color: colors.text }]} numberOfLines={1}>
              {t(`attach.${it.kind}`)}
            </Text>
          </Pressable>
        ))}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '700', textAlign: 'center', paddingVertical: 10 },
  grid: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 20 },
  item: { alignItems: 'center', gap: 8, width: 76 },
  icon: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 13, fontWeight: '600' },
});
