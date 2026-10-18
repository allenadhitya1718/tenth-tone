import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Placeholder } from '@/components/Placeholder';
import { useTheme } from '@/providers/ThemeProvider';

export default function Profile() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Placeholder title={t('tabs.profile')}>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', padding: 14 }}>
        <Pressable
          onPress={() => router.push('/settings')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('settings.title')}
        >
          <Ionicons name="settings-outline" size={24} color={colors.text} />
        </Pressable>
      </View>
    </Placeholder>
  );
}
