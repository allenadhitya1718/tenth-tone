import type { ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Backdrop } from './Backdrop';

// The tour and welcome screens keep a light surface whatever the theme, as
// on the web app: a first impression reads warmer on light, and the dark
// phone mock-ups sit on it like product shots. Everything after sign-in
// follows the user's theme.
export const PRE = { ink: '#14141a', sub: '#5b5b6b', faint: '#7a7a89' };

export function PreLoginSurface({ children }: { children: ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: '#f7f6fb' }}>
      <Backdrop
        base="#f7f6fb"
        washes={[
          { cx: 0.5, cy: 0.08, rx: 0.95, ry: 0.55, color: '#1e56d6', opacity: 0.13, stop: 0.6 },
          { cx: 0.88, cy: 0.92, rx: 0.75, ry: 0.5, color: '#ec4899', opacity: 0.1, stop: 0.65 },
        ]}
      />
      <SafeAreaView style={{ flex: 1, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 22 }} edges={['top', 'bottom']}>
        {children}
      </SafeAreaView>
    </View>
  );
}
