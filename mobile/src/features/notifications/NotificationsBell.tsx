import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { countUnreadNotifications, notificationKeys } from '@/api/notifications';
import { go } from '@/features/discover/nav';
import { useTheme } from '@/providers/ThemeProvider';

// The bell and its unread badge. Counted with the same filter as the list,
// so opening the list always clears it.
export function NotificationsBell({ size = 26 }: { size?: number }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const unread = useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: countUnreadNotifications,
    // A cheap head-only count; a minute keeps the badge honest without push.
    refetchInterval: 60_000,
  });

  // Coming back from the list (or any screen) should show the new count.
  const { refetch } = unread;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const n = unread.data ?? 0;
  const label = n > 0 ? t('discover.notif.bellUnread', { n }) : t('discover.notif.title');

  return (
    <Pressable
      onPress={() => go('/notifications')}
      hitSlop={10}
      style={styles.btn}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={n > 0 ? 'notifications' : 'notifications-outline'} size={size} color={colors.text} />
      {n > 0 ? (
        <View style={[styles.badge, { backgroundColor: colors.danger, borderColor: colors.bg }]} importantForAccessibility="no-hide-descendants">
          <Text style={styles.badgeText}>{n > 99 ? '99+' : String(n)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 4,
    end: 2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
