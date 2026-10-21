import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, Tabs, usePathname } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { chatKeys, countUnreadChats } from '@/api/chat';
import { useTheme } from '@/providers/ThemeProvider';

type IconName = keyof typeof Ionicons.glyphMap;

// Same five items as bottomNav() in web/js/helpers.js.
export default function TabsLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const unread = useQuery({ queryKey: chatKeys.unreadCount(), queryFn: countUnreadChats });
  // On Home (the video feed) the bar is black in both themes, as on
  // Instagram's Reels, so it does not cut a white strip under the video.
  const onFeed = usePathname() === '/';
  const bar = onFeed
    ? { bg: '#000000', border: 'rgba(255,255,255,0.08)', active: '#FFFFFF', inactive: 'rgba(255,255,255,0.6)' }
    : { bg: colors.tabBar, border: colors.border, active: colors.text, inactive: colors.muted };

  const icon = (on: IconName, off: IconName) =>
    function TabIcon({ focused, size }: { focused: boolean; size: number }) {
      // The glyph is decoration: without this a screen reader speaks the
      // raw icon character before the tab name.
      return (
        <Ionicons
          name={focused ? on : off}
          size={size}
          color={focused ? bar.active : bar.inactive}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      );
    };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: bar.active,
        tabBarInactiveTintColor: bar.inactive,
        tabBarStyle: { backgroundColor: bar.bg, borderTopColor: bar.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home'), tabBarAccessibilityLabel: t('tabs.home'), tabBarIcon: icon('home', 'home-outline') }} />
      <Tabs.Screen name="discover" options={{ title: t('tabs.discover'), tabBarAccessibilityLabel: t('tabs.discover'), tabBarIcon: icon('search', 'search-outline') }} />
      <Tabs.Screen
        name="create"
        // The + opens the camera full screen instead of switching tabs.
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            router.push('/camera');
          },
        }}
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
      <Tabs.Screen
        name="inbox"
        options={{
          title: t('tabs.inbox'), tabBarAccessibilityLabel: t('tabs.inbox'),
          tabBarIcon: icon('chatbubbles', 'chatbubbles-outline'),
          tabBarBadge: unread.data ? (unread.data > 99 ? '99+' : unread.data) : undefined,
        }}
      />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile'), tabBarAccessibilityLabel: t('tabs.profile'), tabBarIcon: icon('person', 'person-outline') }} />
    </Tabs>
  );
}
