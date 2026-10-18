import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useTheme } from '@/providers/ThemeProvider';

type IconName = keyof typeof Ionicons.glyphMap;

// Same five items as bottomNav() in web/js/helpers.js.
export default function TabsLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const icon = (on: IconName, off: IconName) =>
    function TabIcon({ focused, size }: { focused: boolean; size: number }) {
      return <Ionicons name={focused ? on : off} size={size} color={focused ? colors.text : colors.muted} />;
    };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.tabBar, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home'), tabBarIcon: icon('home', 'home-outline') }} />
      <Tabs.Screen name="discover" options={{ title: t('tabs.discover'), tabBarIcon: icon('search', 'search-outline') }} />
      <Tabs.Screen
        name="create"
        options={{
          title: t('tabs.create'),
          tabBarShowLabel: false,
          tabBarAccessibilityLabel: t('tabs.create'),
          tabBarIcon: () => (
            <View
              style={{
                width: 46,
                height: 32,
                borderRadius: 10,
                backgroundColor: colors.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="add" size={24} color={colors.onPrimary} />
            </View>
          ),
        }}
      />
      <Tabs.Screen name="inbox" options={{ title: t('tabs.inbox'), tabBarIcon: icon('chatbubbles', 'chatbubbles-outline') }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile'), tabBarIcon: icon('person', 'person-outline') }} />
    </Tabs>
  );
}
