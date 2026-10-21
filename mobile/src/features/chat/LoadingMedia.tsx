import { Ionicons } from '@expo/vector-icons';
import { Image, type ImageStyle } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, type StyleProp, StyleSheet, View } from 'react-native';

import { useTheme } from '@/providers/ThemeProvider';

// A chat photo or GIF that shows a grey box with a spinner while it loads,
// as WhatsApp does, instead of a blank white box; a failed load offers a
// retry. Sits inside the bubble's clipping view.
export function LoadingMedia({
  uri,
  style,
  recyclingKey,
  autoplay,
}: {
  uri: string | null | undefined;
  style: StyleProp<ImageStyle>;
  recyclingKey?: string;
  autoplay?: boolean;
}) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [state, setState] = useState<'loading' | 'done' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  // A new picture (a sent message swapping its local file for the uploaded
  // one) starts loading again.
  const [shown, setShown] = useState(uri);
  if (uri !== shown) {
    setShown(uri);
    setState('loading');
  }

  return (
    <View>
      <Image
        key={attempt}
        source={{ uri: uri ?? undefined }}
        style={[style, { backgroundColor: isDark ? '#2C2C31' : '#D5D7DD' }]}
        contentFit="cover"
        autoplay={autoplay}
        transition={150}
        recyclingKey={recyclingKey}
        accessible={false}
        onLoad={() => setState('done')}
        onError={() => setState('failed')}
      />
      {state !== 'done' ? (
        <View style={styles.overlay} pointerEvents="box-none">
          {state === 'loading' ? (
            <View style={styles.circle} pointerEvents="none">
              <ActivityIndicator color="#FFFFFF" />
            </View>
          ) : (
            <Pressable
              onPress={() => {
                setState('loading');
                setAttempt((n) => n + 1);
              }}
              style={styles.circle}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('gif.retry')}
            >
              <Ionicons name="refresh" size={22} color="#FFFFFF" />
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, start: 0, end: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  circle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
