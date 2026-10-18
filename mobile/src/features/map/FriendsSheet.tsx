import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  LayoutAnimation,
  PanResponder,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { AppText } from '@/components/ui';
import { timeAgo } from '@/lib/timeAgo';
import { useTheme } from '@/providers/ThemeProvider';

import { RING } from './AvatarMarker';
import { distanceMeters, formatDistance, type LatLng } from './geo';
import { PersonAvatar } from './PersonAvatar';
import { isStale, type Pin } from './usePins';

type Props = {
  pins: Pin[];
  me: LatLng | null;
  now: number;
  loading: boolean;
  error: boolean;
  expanded: boolean;
  bottomInset: number;
  onToggle: (open: boolean) => void;
  onSelect: (id: string) => void;
  onRetry: () => void;
};

// The bottom sheet listing everyone on the map, nearest first when your own
// position is known. Tap or drag the handle to open and close it.
export function FriendsSheet({ pins, me, now, loading, error, expanded, bottomInset, onToggle, onSelect, onRetry }: Props) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const { height } = useWindowDimensions();

  const toggle = useCallback(
    (open: boolean) => {
      LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'opacity'));
      onToggle(open);
    },
    [onToggle],
  );

  // Recreated when the state it reads changes; a drag never spans a change.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderRelease: (_, g) => {
          if (g.dy < -30 && !expanded) toggle(true);
          else if (g.dy > 30 && expanded) toggle(false);
        },
      }),
    [expanded, toggle],
  );

  const rows = useMemo(() => {
    const list = pins.map((p) => ({ pin: p, dist: me ? distanceMeters(me, p) : null }));
    if (me) list.sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0));
    return list;
  }, [pins, me]);

  const title = loading
    ? t('map.loadingFriends')
    : pins.length
      ? t('map.friendsOnMap', { count: pins.length })
      : t('map.noFriends');

  const renderItem = useCallback(
    ({ item }: { item: { pin: Pin; dist: number | null } }) => (
      <FriendRow
        pin={item.pin}
        distance={item.dist != null ? formatDistance(item.dist, t, i18n.language) : null}
        ago={timeAgo(item.pin.updatedAt, t, i18n.language)}
        stale={isStale(item.pin, now)}
        onSelect={onSelect}
      />
    ),
    [t, i18n.language, now, onSelect],
  );

  return (
    <View
      style={[
        styles.sheet,
        { backgroundColor: colors.bg, paddingBottom: bottomInset + 8, shadowColor: '#000' },
      ]}
    >
      <Pressable
        {...pan.panHandlers}
        onPress={() => toggle(!expanded)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={title}
        accessibilityHint={t(expanded ? 'map.sheetCollapseHint' : 'map.sheetExpandHint')}
        style={styles.header}
      >
        <View style={[styles.handle, { backgroundColor: colors.muted2 }]} />
        <View style={styles.headerRow}>
          <AppText variant="label" style={{ flex: 1 }} accessibilityRole="header">
            {title}
          </AppText>
          {loading ? <ActivityIndicator color={colors.muted} /> : null}
          <Ionicons name={expanded ? 'chevron-down' : 'chevron-up'} size={20} color={colors.muted} />
        </View>
        {!expanded && !loading && pins.length ? (
          <AppText variant="small" muted>
            {t('map.sheetHint')}
          </AppText>
        ) : null}
      </Pressable>

      {error && !pins.length ? (
        <Pressable onPress={onRetry} style={styles.retry} accessibilityRole="button">
          <Ionicons name="refresh" size={18} color={colors.danger} />
          <AppText variant="small" style={{ color: colors.danger }}>
            {t('map.loadFailedRetry')}
          </AppText>
        </Pressable>
      ) : null}

      {expanded ? (
        pins.length ? (
          <FlatList
            data={rows}
            keyExtractor={(r) => r.pin.id}
            renderItem={renderItem}
            style={{ maxHeight: height * 0.45 }}
            initialNumToRender={12}
            windowSize={5}
          />
        ) : !loading ? (
          <AppText variant="small" muted center style={{ paddingVertical: 16, paddingHorizontal: 20 }}>
            {t('map.noFriendsBody')}
          </AppText>
        ) : null
      ) : null}
    </View>
  );
}

const FriendRow = memo(function FriendRow({
  pin,
  distance,
  ago,
  stale,
  onSelect,
}: {
  pin: Pin;
  distance: string | null;
  ago: string;
  stale: boolean;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const ring = stale ? RING.stale : pin.tracked ? RING.tracked : RING.friend;
  const meta = [distance, t('map.updatedAgo', { ago })].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={() => onSelect(pin.id)}
      style={({ pressed }) => [styles.row, { borderTopColor: colors.border }, pressed && { backgroundColor: colors.bg2 }]}
      accessibilityRole="button"
      accessibilityLabel={`${pin.name}, ${meta}`}
      accessibilityHint={t('map.rowHint')}
    >
      <PersonAvatar uri={pin.avatar} name={pin.name} size={44} ring={ring} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText numberOfLines={1} style={{ fontWeight: '700' }}>
          {pin.name}
        </AppText>
        <AppText variant="small" muted numberOfLines={1}>
          {meta}
        </AppText>
      </View>
      {pin.tracked ? <Ionicons name="navigate-circle-outline" size={20} color={RING.tracked} /> : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -6 },
    elevation: 16,
  },
  header: { paddingHorizontal: 18, paddingBottom: 10 },
  handle: { width: 44, height: 5, borderRadius: 3, alignSelf: 'center', marginTop: 8, marginBottom: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 },
  retry: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, paddingBottom: 10, minHeight: 44 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    minHeight: 64,
  },
});
