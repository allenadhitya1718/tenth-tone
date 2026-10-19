import { Ionicons } from '@expo/vector-icons';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/providers/ThemeProvider';

// A plain bottom sheet: dimmed backdrop, rounded panel, tap outside or back
// to close. The panel rides above the keyboard so a text field inside stays
// visible.
export function BottomSheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" />
        <View
          style={[
            styles.panel,
            { backgroundColor: colors.bg, paddingBottom: Math.max(insets.bottom, 12) + 4 },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: colors.muted2 }]} />
          <Pressable
            onPress={onClose}
            hitSlop={10}
            style={styles.close}
            accessibilityRole="button"
            accessibilityLabel={t('legal.close')}
          >
            <Ionicons name="close" size={22} color={colors.text} accessibilityElementsHidden importantForAccessibility="no" />
          </Pressable>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill as object, backgroundColor: 'rgba(0,0,0,0.4)' },
  panel: { borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 8, maxHeight: '85%' },
  close: { position: 'absolute', top: 8, end: 12, zIndex: 2, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 6 },
});
