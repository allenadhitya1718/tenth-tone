import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isGifUrl } from '@/api/gifs';

// A photo (or a GIF, 0144) from the thread, full screen. The surface is black in both themes
// (a photo viewer), hence the fixed colours.
export function ImageViewer({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal visible={!!uri} transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        {uri ? (
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            accessibilityLabel={isGifUrl(uri) ? t('gif.a11yPlain') : t('chat.photo')}
            accessible
          />
        ) : null}
        <SafeAreaView edges={['top']} style={styles.bar}>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={styles.close}
            accessibilityRole="button"
            accessibilityLabel={t('chat.close')}
          >
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  bar: { position: 'absolute', top: 0, start: 0, end: 0, flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 12 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
});
