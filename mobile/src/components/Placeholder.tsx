import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/providers/ThemeProvider';

import { AppText } from './ui';

// Stand-in for screens that later phases build.
export function Placeholder({ title, children }: { title: string; children?: React.ReactNode }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {children}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 }}>
        <AppText variant="title" center>
          {title}
        </AppText>
        <AppText muted center>
          {t('placeholder.later')}
        </AppText>
      </View>
    </SafeAreaView>
  );
}
