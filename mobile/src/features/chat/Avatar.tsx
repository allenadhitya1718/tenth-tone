import { Image } from 'expo-image';
import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/providers/ThemeProvider';

import { initial } from './format';

// A round photo, or the name's first letter on brand blue when there is none
// (a bare <img src=""> showed a broken-image icon on the web app). Decorative
// to screen readers: the row it sits in already says the name.
export const Avatar = memo(function Avatar({
  uri,
  name,
  size = 48,
}: {
  uri: string | null | undefined;
  name: string | null | undefined;
  size?: number;
}) {
  const { colors } = useTheme();
  const shape = useMemo(() => ({ width: size, height: size, borderRadius: size / 2 }), [size]);
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[shape, { backgroundColor: colors.bg3 }]}
        contentFit="cover"
        transition={120}
        recyclingKey={uri}
        accessibilityIgnoresInvertColors
        accessible={false}
      />
    );
  }
  return (
    <View
      style={[shape, styles.fallback, { backgroundColor: colors.primary }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[styles.letter, { color: colors.onPrimary, fontSize: size * 0.4 }]}>{initial(name)}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
  letter: { fontWeight: '800' },
});
