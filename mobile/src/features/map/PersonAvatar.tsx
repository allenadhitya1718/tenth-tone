import { Image } from 'expo-image';
import { memo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/providers/ThemeProvider';

// A round avatar with an initial when there is no picture. Decorative: the
// row or button around it carries the accessible name.
export const PersonAvatar = memo(function PersonAvatar({
  uri,
  name,
  size = 44,
  ring,
  style,
}: {
  uri: string | null | undefined;
  name: string | null | undefined;
  size?: number;
  ring?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const box = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View
      style={[box, styles.box, { backgroundColor: colors.bg3 }, ring ? { borderWidth: 2, borderColor: ring } : null, style]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
      ) : (
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: size * 0.4 }}>{initial}</Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  box: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
