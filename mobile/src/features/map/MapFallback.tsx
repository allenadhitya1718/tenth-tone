import { Ionicons } from '@expo/vector-icons';
import { Component, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';

// What shows where the map would be when it cannot load: no Google Maps key
// in this Android build, the native map threw, or it never reported ready.
// The rest of the screen (friend list, distances, directions) keeps working.
export function MapUnavailable({ compact, style }: { compact?: boolean; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={[styles.box, { backgroundColor: colors.bg2 }, style]} accessibilityRole="summary">
      <Ionicons name="map-outline" size={compact ? 28 : 44} color={colors.muted} />
      <AppText variant={compact ? 'small' : 'label'} center>
        {t('map.unavailableTitle')}
      </AppText>
      {!compact ? (
        <AppText variant="small" muted center>
          {t('map.unavailableBody')}
        </AppText>
      ) : null}
    </View>
  );
}

type BoundaryProps = { children: ReactNode; fallback: ReactNode; onError?: (e: Error) => void };

export class MapErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(e: Error) {
    console.warn('map failed:', e?.message);
    this.props.onError?.(e);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const styles = StyleSheet.create({
  box: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
});
