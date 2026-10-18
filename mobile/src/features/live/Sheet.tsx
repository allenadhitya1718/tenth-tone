import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import type { ComponentProps, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/providers/ThemeProvider';

// A bottom sheet over the live room. A Modal rather than a route, so opening
// it never leaves the room (leaving is what ends a host's broadcast). Tapping
// outside closes it, as does the hardware back button.
export function Sheet({
  visible,
  onClose,
  title,
  children,
  maxHeight = 0.75,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  maxHeight?: number;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('live.close')}
        />
        <SafeAreaView
          edges={['bottom']}
          style={[styles.panel, { backgroundColor: colors.bg, maxHeight: height * maxHeight }]}
          accessibilityViewIsModal
        >
          <View style={[styles.grabber, { backgroundColor: colors.muted2 }]} />
          {title ? (
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header" numberOfLines={1}>
                {title}
              </Text>
              <Pressable
                onPress={onClose}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={t('live.close')}
                style={styles.closeBtn}
              >
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>
          ) : null}
          {children}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

export function OptionRow({
  icon,
  label,
  onPress,
  danger,
  disabled,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const tone = danger ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.bg2 }, disabled && { opacity: 0.5 }]}
    >
      <Ionicons name={icon} size={22} color={tone} />
      <Text style={[styles.optionText, { color: tone }]}>{label}</Text>
    </Pressable>
  );
}

export function Avatar({ uri, name, size = 40 }: { uri?: string | null; name?: string | null; size?: number }) {
  const { colors } = useTheme();
  const r = { width: size, height: size, borderRadius: size / 2 };
  if (uri) return <Image source={{ uri }} style={r} contentFit="cover" accessibilityIgnoresInvertColors />;
  return (
    <View style={[r, styles.initialWrap, { backgroundColor: colors.primary }]}>
      <Text style={[styles.initial, { fontSize: size * 0.4 }]}>{(name || '?').slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  panel: { borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden', paddingBottom: 8 },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 16, fontWeight: '800', flex: 1 },
  closeBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, minHeight: 52 },
  optionText: { fontSize: 16, fontWeight: '600', flexShrink: 1 },
  initialWrap: { alignItems: 'center', justifyContent: 'center' },
  initial: { color: '#fff', fontWeight: '800' },
});
