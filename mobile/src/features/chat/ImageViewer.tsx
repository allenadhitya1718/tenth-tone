import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import { Animated, Modal, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isGifUrl } from '@/api/gifs';

// A photo (or a GIF, 0144) from the thread, full screen. The surface is black in both themes
// (a photo viewer), hence the fixed colours.
//
// iOS has no back button, so the way out must be on screen: a close button
// placed from the app's safe-area insets (a SafeAreaView inside a Modal
// measured no inset on iOS, which left the button under the status bar
// where it could not be tapped), and a swipe down, as in Photos/WhatsApp.
export function ImageViewer({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [dragY] = useState(() => new Animated.Value(0));
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dy > 12 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
        onPanResponderMove: (_, g) => dragY.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (g.dy > 120 || g.vy > 1.2) {
            onClose();
            dragY.setValue(0);
          } else {
            Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
          }
        },
        onPanResponderTerminate: () => Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start(),
      }),
    [dragY, onClose],
  );
  const fade = dragY.interpolate({ inputRange: [0, 300], outputRange: [1, 0.4], extrapolate: 'clamp' });
  return (
    <Modal visible={!!uri} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[styles.root, { opacity: fade }]}>
        {uri ? (
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: dragY }] }]} {...pan.panHandlers}>
            <Image
              source={{ uri }}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              accessibilityLabel={isGifUrl(uri) ? t('gif.a11yPlain') : t('chat.photo')}
              accessible
            />
          </Animated.View>
        ) : null}
        <View style={[styles.bar, { top: insets.top + 8 }]} pointerEvents="box-none">
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={styles.close}
            accessibilityRole="button"
            accessibilityLabel={t('chat.close')}
          >
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  bar: { position: 'absolute', start: 0, end: 0, flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 12 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
});
