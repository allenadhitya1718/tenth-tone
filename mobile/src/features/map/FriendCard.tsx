import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { Alert } from '@/components/Dialog';
import { openOrCreateDm } from '@/api/chat';
import {
  fetchPermitStatus,
  locationKeys,
  requestLocationPermit,
  revokeLocationPermit,
} from '@/api/location';
import { AppText } from '@/components/ui';
import { timeAgo } from '@/lib/timeAgo';
import { useTheme } from '@/providers/ThemeProvider';

import { RING } from './AvatarMarker';
import { locationErrorKey } from './errors';
import { distanceMeters, formatDistance, openDirections, type LatLng } from './geo';
import { PersonAvatar } from './PersonAvatar';
import { isStale, type Pin } from './usePins';
import { atHandle } from '@/lib/handle';

type Props = {
  pin: Pin;
  me: LatLng | null;
  now: number;
  following: boolean;
  bottomInset: number;
  onFollow: (on: boolean) => void;
  onClose: () => void;
};

// The card for the friend you tapped. Client note 27: Follow keeps the
// camera on them as they move; Directions hands off to the maps app.
export function FriendCard({ pin, me, now, following, bottomInset, onFollow, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const { colors, isDark } = useTheme();
  const qc = useQueryClient();
  const tint = isDark ? colors.primary2 : colors.primary;

  const permit = useQuery({ queryKey: locationKeys.permit(pin.id), queryFn: () => fetchPermitStatus(pin.id) });
  const refreshPermit = () => {
    void qc.invalidateQueries({ queryKey: locationKeys.permit(pin.id) });
    void qc.invalidateQueries({ queryKey: locationKeys.tracked() });
  };
  const ask = useMutation({
    mutationFn: () => requestLocationPermit(pin.id),
    onSuccess: () => {
      refreshPermit();
      Alert.alert(t('map.permitSent'), t('map.permitSentBody', { name: pin.name }));
    },
    onError: (e) => Alert.alert(t('map.errTitle'), t(locationErrorKey(e))),
  });
  const revoke = useMutation({
    mutationFn: () => revokeLocationPermit(pin.id),
    onSuccess: refreshPermit,
    onError: (e) => Alert.alert(t('map.errTitle'), t(locationErrorKey(e))),
  });
  const dm = useMutation({
    mutationFn: () => openOrCreateDm(pin.id),
    onSuccess: (chatId) => router.push(`/chat/${chatId}`),
    onError: () => Alert.alert(t('map.errTitle'), t('map.dmFailed')),
  });

  const status = permit.data?.status;
  const distance = me ? formatDistance(distanceMeters(me, pin), t, i18n.language) : null;
  const meta = [distance, t('map.updatedAgo', { ago: timeAgo(pin.updatedAt, t, i18n.language) })]
    .filter(Boolean)
    .join(' · ');
  const ring = isStale(pin, now) ? RING.stale : pin.tracked ? RING.tracked : RING.friend;

  function permitAction() {
    if (status === 'approved' || status === 'pending') {
      Alert.alert(t(status === 'approved' ? 'map.stopTrackingQ' : 'map.withdrawQ', { name: pin.name }), undefined, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('map.confirm'), style: 'destructive', onPress: () => revoke.mutate() },
      ]);
      return;
    }
    Alert.alert(t('map.askTrackQ', { name: pin.name }), t('map.askTrackBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('map.send'), onPress: () => ask.mutate() },
    ]);
  }

  const permitLabel =
    status === 'approved' ? t('map.stopTracking') : status === 'pending' ? t('map.requested') : t('map.askTrack');

  return (
    <View
      style={[styles.card, { backgroundColor: colors.bg, paddingBottom: bottomInset + 12, shadowColor: '#000' }]}
    >
      <View style={styles.top}>
        <Pressable
          onPress={() => router.push(`/user/${pin.id}`)}
          style={styles.who}
          accessibilityRole="button"
          accessibilityLabel={t('map.openProfileOf', { name: pin.name })}
        >
          <PersonAvatar uri={pin.avatar} name={pin.name} size={54} ring={ring} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="label" numberOfLines={1}>
              {pin.name}
            </AppText>
            {pin.handle ? (
              <AppText variant="small" muted numberOfLines={1}>
                {atHandle(pin.handle)}
              </AppText>
            ) : null}
            <AppText variant="small" muted numberOfLines={1}>
              {meta}
            </AppText>
          </View>
        </Pressable>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('map.close')} style={styles.close}>
          <Ionicons name="close" size={22} color={colors.muted} />
        </Pressable>
      </View>

      <View style={styles.actions}>
        <Action
          icon={following ? 'locate' : 'locate-outline'}
          label={following ? t('map.following') : t('map.follow')}
          active={following}
          onPress={() => onFollow(!following)}
          hint={t('map.followHint')}
        />
        <Action icon="navigate-outline" label={t('map.directions')} onPress={() => openDirections(pin, t)} />
        <Action
          icon="chatbubble-outline"
          label={t('map.message')}
          onPress={() => dm.mutate()}
          busy={dm.isPending}
        />
        <Action
          icon={status === 'approved' ? 'eye-off-outline' : 'hand-left-outline'}
          label={permitLabel}
          onPress={permitAction}
          busy={ask.isPending || revoke.isPending || permit.isLoading}
        />
      </View>
      {following ? (
        <AppText variant="small" center style={{ color: tint, marginTop: 6 }} accessibilityLiveRegion="polite">
          {t('map.followingHint', { name: pin.name })}
        </AppText>
      ) : null}
    </View>
  );
}

function Action({
  icon,
  label,
  onPress,
  active,
  busy,
  hint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  active?: boolean;
  busy?: boolean;
  hint?: string;
}) {
  const { colors, isDark } = useTheme();
  const tint = isDark ? colors.primary2 : colors.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }, busy && { opacity: 0.5 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ selected: !!active, busy: !!busy }}
    >
      <View style={[styles.actionIcon, { backgroundColor: active ? colors.primary : colors.primarySoft }]}>
        <Ionicons name={icon} size={22} color={active ? colors.onPrimary : tint} />
      </View>
      <AppText variant="small" numberOfLines={1} center style={{ fontWeight: '600' }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 16,
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -6 },
    elevation: 16,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, gap: 6 },
  action: { flex: 1, alignItems: 'center', gap: 6, minHeight: 72 },
  actionIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
