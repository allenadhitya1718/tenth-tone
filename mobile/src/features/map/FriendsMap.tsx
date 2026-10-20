import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  AppState,
  I18nManager,
  Linking,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import MapView from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  fetchIncomingPermits,
  fetchMyLocationSettings,
  locationKeys,
  requestLocationPermit,
} from '@/api/location';
import { Alert } from '@/components/Dialog';
import { fetchProfile, profileKeys } from '@/api/profiles';
import { AppText, Button } from '@/components/ui';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/providers/ThemeProvider';

import { AvatarMarker, RING } from './AvatarMarker';
import { locationErrorKey } from './errors';
import { FriendCard } from './FriendCard';
import { FriendsSheet } from './FriendsSheet';
import { DEFAULT_REGION, regionAround, type LatLng } from './geo';
import { LocationConsent } from './LocationConsent';
import { MapErrorBoundary, MapUnavailable } from './MapFallback';
import { DARK_MAP_STYLE, MAP_PROVIDER, MAPS_AVAILABLE } from './mapConfig';
import { MapSettingsSheet } from './MapSettingsSheet';
import { isStale, usePins, type Pin } from './usePins';
import { useLocationWatcher } from './useLocationWatcher';

// A map that never reports ready in this long is treated as failed (for
// example a Google key that is present but refused).
const MAP_READY_TIMEOUT_MS = 15_000;

type Props = {
  // /map?user=<id>: open centred on this friend (from a profile or chat).
  focusUserId?: string | null;
  // /map?request=<id>: offer to ask this person for their location.
  requestUserId?: string | null;
};

export function FriendsMap({ focusUserId = null, requestUserId = null }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { session } = useAuth();
  const me = session?.user.id ?? null;

  const settings = useQuery({ queryKey: locationKeys.settings(), queryFn: fetchMyLocationSettings });
  // "Not now" on the consent screen: browse friends without sharing.
  const [skipped, setSkipped] = useState(false);

  // A deep-linked request is offered once, whichever screen shows first.
  const requestHandled = useRef(false);
  useEffect(() => {
    if (!requestUserId || requestHandled.current || requestUserId === me) return;
    requestHandled.current = true;
    Alert.alert(t('map.askTrackQ', { name: t('map.thisPerson') }), t('map.askTrackBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('map.send'),
        onPress: () =>
          requestLocationPermit(requestUserId)
            .then(() => {
              void qc.invalidateQueries({ queryKey: locationKeys.permit(requestUserId) });
              Alert.alert(t('map.permitSent'));
            })
            .catch((e) => Alert.alert(t('map.errTitle'), t(locationErrorKey(e)))),
      },
    ]);
  }, [requestUserId, me, qc, t]);

  if (settings.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (settings.isError) {
    return (
      <View style={styles.center}>
        <AppText center>{t('map.loadFailed')}</AppText>
        <Button title={t('map.retry')} variant="secondary" onPress={() => void settings.refetch()} />
        <Button title={t('common.back')} variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </View>
    );
  }

  const sharing = !!settings.data?.sharing_enabled;
  if (!sharing && !skipped) return <LocationConsent onSkip={() => setSkipped(true)} />;

  return (
    <MapScreen
      me={me}
      sharing={sharing}
      focusUserId={focusUserId}
      onTurnOn={() => setSkipped(false)}
      settingsData={settings.data}
    />
  );
}

function useAppActive() {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

function MapScreen({
  me,
  sharing,
  focusUserId,
  onTurnOn,
  settingsData,
}: {
  me: string | null;
  sharing: boolean;
  focusUserId: string | null;
  onTurnOn: () => void;
  settingsData: Parameters<typeof MapSettingsSheet>[0]['settings'];
}) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const mapRef = useRef<MapView>(null);

  // The watcher and realtime run only while this screen is focused and the
  // app is in the foreground.
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const appActive = useAppActive();
  const live = focused && appActive;

  const onRejected = useCallback(() => {
    void qc.invalidateQueries({ queryKey: locationKeys.settings() });
  }, [qc]);
  // Without consent the device location is not read at all.
  const { position, permission } = useLocationWatcher({ active: live && sharing, share: sharing, onRejected });

  const { pins, isLoading, isError, refetch } = usePins(live);
  const profile = useQuery({ queryKey: profileKeys.profile(me ?? ''), queryFn: () => fetchProfile(me), enabled: !!me });
  const incoming = useQuery({
    queryKey: locationKeys.incomingPermits(),
    queryFn: fetchIncomingPermits,
    refetchInterval: live ? 120_000 : false,
  });

  // "5m ago" labels stay current.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [live]);

  const [selectedId, setSelectedId] = useState<string | null>(focusUserId);
  const [followId, setFollowId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mapState, setMapState] = useState<'loading' | 'ready' | 'failed'>(MAPS_AVAILABLE ? 'loading' : 'failed');

  const selected = useMemo(() => pins.find((p) => p.id === selectedId) ?? null, [pins, selectedId]);
  const meCoord = useMemo<LatLng | null>(
    () => (position ? { latitude: position.latitude, longitude: position.longitude } : null),
    [position],
  );

  useEffect(() => {
    if (mapState !== 'loading') return;
    const id = setTimeout(() => setMapState((s) => (s === 'loading' ? 'failed' : s)), MAP_READY_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [mapState]);

  const flyTo = useCallback((p: LatLng, zoom?: number) => {
    mapRef.current?.animateCamera({ center: p, ...(zoom ? { zoom } : null) }, { duration: 650 });
  }, []);

  // Where the camera starts: the focused friend, else me, else everyone.
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || mapState !== 'ready') return;
    const focus = focusUserId ? pins.find((p) => p.id === focusUserId) : null;
    if (focus) {
      framed.current = true;
      flyTo(focus, 16);
    } else if (meCoord) {
      framed.current = true;
      flyTo(meCoord, 14);
    } else if (!isLoading && pins.length) {
      framed.current = true;
      mapRef.current?.fitToCoordinates(pins, {
        edgePadding: { top: 140, bottom: 220, left: 60, right: 60 },
        animated: true,
      });
    }
  }, [mapState, focusUserId, pins, meCoord, isLoading, flyTo]);

  // Client note 27, follow mode: the camera stays on the friend as realtime
  // moves their pin, until the map is panned by hand.
  const followed = followId ? pins.find((p) => p.id === followId) : null;
  const followLat = followed?.latitude;
  const followLng = followed?.longitude;
  useEffect(() => {
    if (followLat == null || followLng == null) return;
    flyTo({ latitude: followLat, longitude: followLng });
  }, [followLat, followLng, flyTo]);
  const stopFollowing = useCallback(() => setFollowId((f) => (f ? null : f)), []);

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      setSheetOpen(false);
      const p = pins.find((x) => x.id === id);
      if (p) flyTo(p, 16);
      setFollowId((f) => (f && f !== id ? null : f));
    },
    [pins, flyTo],
  );

  const fitAll = () => {
    const pts: LatLng[] = [...pins, ...(meCoord ? [meCoord] : [])];
    if (!pts.length) return;
    stopFollowing();
    if (pts.length === 1) flyTo(pts[0], 15);
    else
      mapRef.current?.fitToCoordinates(pts, {
        edgePadding: { top: 140, bottom: 220, left: 60, right: 60 },
        animated: true,
      });
  };

  const myName = t('map.you');
  const sheetInset = Math.max(insets.bottom, 8);

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {mapState !== 'failed' ? (
        <MapErrorBoundary fallback={<MapUnavailable />} onError={() => setMapState('failed')}>
          <View style={StyleSheet.absoluteFill} onTouchMove={followId ? stopFollowing : undefined}>
            <MapView
              ref={mapRef}
              style={StyleSheet.absoluteFill}
              provider={MAP_PROVIDER}
              customMapStyle={isDark ? DARK_MAP_STYLE : undefined}
              userInterfaceStyle={isDark ? 'dark' : 'light'}
              initialRegion={focusUserId ? DEFAULT_REGION : meCoord ? regionAround(meCoord) : DEFAULT_REGION}
              onMapReady={() => setMapState('ready')}
              onPanDrag={followId ? stopFollowing : undefined}
              onRegionChangeComplete={(_, d) => {
                if (d?.isGesture && followId) stopFollowing();
              }}
              onPress={() => setSelectedId(null)}
              mapPadding={{ top: insets.top + 60, bottom: 110, left: 0, right: 0 }}
              showsCompass={false}
              showsMyLocationButton={false}
              toolbarEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              moveOnMarkerPress={false}
              accessibilityLabel={t('map.mapA11y', { count: pins.length })}
            >
              {meCoord ? (
                <AvatarMarker
                  coordinate={meCoord}
                  name={myName}
                  avatarUrl={profile.data?.avatar_url}
                  ring={RING.me}
                  isMe
                  accessibilityLabel={t('map.youAreHere')}
                />
              ) : null}
              {pins.map((p) => (
                <FriendPin key={p.id} pin={p} now={now} selected={p.id === selectedId} onSelect={select} />
              ))}
            </MapView>
          </View>
        </MapErrorBoundary>
      ) : (
        <MapUnavailable style={{ paddingBottom: 160 }} />
      )}

      {mapState === 'loading' ? (
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: colors.bg }]} pointerEvents="none">
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : null}

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <RoundButton
          icon={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'}
          label={t('common.back')}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />
        <Pressable
          onPress={() => (sharing ? setSettingsOpen(true) : onTurnOn())}
          style={[styles.status, { backgroundColor: colors.bg }]}
          accessibilityRole="button"
          accessibilityLabel={sharing ? t('map.statusSharingA11y', { who: t(`map.visibility_${settingsData?.visibility === 'public' ? 'public' : 'friends'}`) }) : t('map.statusOffA11y')}
        >
          <View style={[styles.dot, { backgroundColor: sharing ? colors.success : colors.muted }]} />
          <AppText variant="small" style={{ fontWeight: '700' }} numberOfLines={1}>
            {sharing
              ? t('map.sharingWith', { who: t(`map.visibility_${settingsData?.visibility === 'public' ? 'public' : 'friends'}`) })
              : t('map.notSharingTap')}
          </AppText>
        </Pressable>
        <View>
          <RoundButton icon="settings-outline" label={t('map.settingsTitle')} onPress={() => setSettingsOpen(true)} />
          {incoming.data?.length ? (
            <View style={[styles.badge, { backgroundColor: colors.danger }]} pointerEvents="none">
              <AppText style={styles.badgeText}>{incoming.data.length}</AppText>
            </View>
          ) : null}
        </View>
      </View>

      {permission === 'denied' && sharing ? (
        <Pressable
          onPress={() => void Linking.openSettings()}
          style={[styles.banner, { top: insets.top + 64, backgroundColor: colors.dangerSoft }]}
          accessibilityRole="button"
          accessibilityHint={t('map.openSettings')}
        >
          <Ionicons name="warning-outline" size={18} color={colors.danger} />
          <AppText variant="small" style={{ color: colors.danger, flex: 1 }}>
            {t('map.permissionOff')}
          </AppText>
        </Pressable>
      ) : null}

      {/* Floating controls, on the end side */}
      {mapState === 'ready' ? (
        <View style={[styles.fabs, { top: insets.top + 176 }]} pointerEvents="box-none">
          {meCoord ? (
            <RoundButton
              icon="locate"
              label={t('map.centerOnMe')}
              onPress={() => {
                stopFollowing();
                flyTo(meCoord, 15);
              }}
            />
          ) : null}
          {pins.length ? <RoundButton icon="scan-outline" label={t('map.showEveryone')} onPress={fitAll} /> : null}
        </View>
      ) : null}

      {followed ? (
        <Pressable
          onPress={stopFollowing}
          style={[
            styles.followPill,
            { top: insets.top + (permission === 'denied' && sharing ? 124 : 64), backgroundColor: colors.primary },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('map.stopFollowingA11y', { name: followed.name })}
          accessibilityLiveRegion="polite"
        >
          <Ionicons name="locate" size={16} color={colors.onPrimary} />
          <AppText variant="small" style={{ color: colors.onPrimary, fontWeight: '700' }} numberOfLines={1}>
            {t('map.followingName', { name: followed.name })}
          </AppText>
          <Ionicons name="close" size={16} color={colors.onPrimary} />
        </Pressable>
      ) : null}

      {selected ? (
        <FriendCard
          pin={selected}
          me={meCoord}
          now={now}
          following={followId === selected.id}
          bottomInset={sheetInset}
          onFollow={(on) => {
            setFollowId(on ? selected.id : null);
            if (on) flyTo(selected, 16);
          }}
          onClose={() => setSelectedId(null)}
        />
      ) : (
        <FriendsSheet
          pins={pins}
          me={meCoord}
          now={now}
          loading={isLoading}
          error={isError}
          expanded={sheetOpen}
          bottomInset={sheetInset}
          onToggle={setSheetOpen}
          onSelect={select}
          onRetry={refetch}
        />
      )}

      <MapSettingsSheet
        visible={settingsOpen}
        settings={settingsData}
        onClose={() => setSettingsOpen(false)}
        onTurnOn={onTurnOn}
      />
    </View>
  );
}

const FriendPin = memo(function FriendPin({
  pin,
  now,
  selected,
  onSelect,
}: {
  pin: Pin;
  now: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const stale = isStale(pin, now);
  return (
    <AvatarMarker
      coordinate={pin}
      name={pin.name}
      avatarUrl={pin.avatar}
      ring={stale ? RING.stale : pin.tracked ? RING.tracked : RING.friend}
      dimmed={stale}
      selected={selected}
      accessibilityLabel={t('map.pinA11y', { name: pin.name })}
      onPress={() => onSelect(pin.id)}
    />
  );
});

function RoundButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.round, { backgroundColor: colors.bg, shadowColor: '#000' }, pressed && { opacity: 0.75 }]}
    >
      <Ionicons name={icon} size={22} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  topBar: {
    position: 'absolute',
    top: 0,
    start: 0,
    end: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  status: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 14,
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  badge: {
    position: 'absolute',
    top: -4,
    end: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  banner: {
    position: 'absolute',
    start: 14,
    end: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 14,
  },
  fabs: { position: 'absolute', end: 14, gap: 10 },
  followPill: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    minHeight: 36,
    borderRadius: 18,
    maxWidth: '80%',
  },
});
