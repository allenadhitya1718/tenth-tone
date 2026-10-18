import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import { fetchProfilePlaces, tagKeys, type ProfilePlace } from '@/api/tags';
import { AppText } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';

import { MapErrorBoundary, MapUnavailable } from './MapFallback';
import { DARK_MAP_STYLE, MAP_PROVIDER, MAPS_AVAILABLE } from './mapConfig';

const isImage = (u: string | null) => !!u && !/\.(mp4|mov|webm)(\?|$)/i.test(u);

// Client note 28: the places on a person's posts, on the profile's Map tab.
// Each pin is the post's thumbnail; tapping it opens the post.
export function ProfilePlacesMap({
  userId,
  isMe,
  height = 420,
  style,
}: {
  userId: string;
  isMe?: boolean;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const mapRef = useRef<MapView>(null);
  const [failed, setFailed] = useState(!MAPS_AVAILABLE);
  const [ready, setReady] = useState(false);

  const places = useQuery({
    queryKey: tagKeys.profilePlaces(userId),
    queryFn: () => fetchProfilePlaces(userId),
  });
  const data = useMemo(() => places.data ?? [], [places.data]);

  useEffect(() => {
    if (!ready || !data.length) return;
    const coords = data.map((p) => ({ latitude: p.lat, longitude: p.lng }));
    if (coords.length === 1) {
      mapRef.current?.animateCamera({ center: coords[0], zoom: 12 }, { duration: 0 });
      return;
    }
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 60, bottom: 60, left: 50, right: 50 },
      animated: false,
    });
  }, [ready, data]);

  const open = useCallback((videoId: string) => router.push(`/video/${videoId}`), []);

  const box = [styles.box, { height, backgroundColor: colors.bg2 }, style];

  if (places.isLoading) {
    return (
      <View style={[box, styles.center]}>
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }
  if (places.isError) {
    return (
      <Pressable style={[box, styles.center]} onPress={() => void places.refetch()} accessibilityRole="button">
        <Ionicons name="refresh" size={24} color={colors.muted} />
        <AppText variant="small" muted center>
          {t('map.loadFailedRetry')}
        </AppText>
      </Pressable>
    );
  }
  if (!data.length) {
    return (
      <View style={[box, styles.center]}>
        <Ionicons name="map-outline" size={40} color={colors.muted} />
        <AppText muted center>
          {t(isMe ? 'map.placesEmptyMe' : 'map.placesEmpty')}
        </AppText>
      </View>
    );
  }

  return (
    <View style={box}>
      {failed ? (
        <PlacesList places={data} onOpen={open} />
      ) : (
        <MapErrorBoundary fallback={<MapUnavailable compact />} onError={() => setFailed(true)}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            provider={MAP_PROVIDER}
            customMapStyle={isDark ? DARK_MAP_STYLE : undefined}
            userInterfaceStyle={isDark ? 'dark' : 'light'}
            onMapReady={() => setReady(true)}
            toolbarEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            accessibilityLabel={t('map.placesA11y', { count: data.length })}
          >
            {data.map((p) => (
              <PlacePin key={p.video_id} place={p} onOpen={open} />
            ))}
          </MapView>
        </MapErrorBoundary>
      )}
    </View>
  );
}

const PlacePin = memo(function PlacePin({ place, onOpen }: { place: ProfilePlace; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setTracking(false), 1500);
    return () => clearTimeout(id);
  }, []);
  return (
    <Marker
      coordinate={{ latitude: place.lat, longitude: place.lng }}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={tracking}
      onPress={() => onOpen(place.video_id)}
      accessibilityLabel={t('map.placePinA11y', { place: place.place_name || t('map.aPlace') })}
      accessibilityRole="button"
    >
      <View style={styles.pinWrap} collapsable={false}>
        <View style={styles.thumb}>
          {isImage(place.thumbnail) ? (
            <Image source={{ uri: place.thumbnail! }} style={styles.thumbImg} onLoadEnd={() => setTracking(false)} />
          ) : (
            <View style={[styles.thumbImg, styles.center, { backgroundColor: '#1E56D6' }]}>
              <Ionicons name="play" size={18} color="#fff" />
            </View>
          )}
        </View>
        <View style={styles.pointer} />
      </View>
    </Marker>
  );
});

// Used when the map itself cannot load: the places as a list, still tappable.
function PlacesList({ places, onOpen }: { places: ProfilePlace[]; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <MapUnavailable compact style={{ flex: 0, paddingVertical: 14 }} />
      {places.slice(0, 20).map((p) => (
        <Pressable
          key={p.video_id}
          onPress={() => onOpen(p.video_id)}
          style={[styles.listRow, { borderTopColor: colors.border }]}
          accessibilityRole="button"
        >
          <Ionicons name="location-outline" size={18} color={colors.muted} />
          <AppText numberOfLines={1} style={{ flex: 1 }}>
            {p.place_name || t('map.aPlace')}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 16, overflow: 'hidden', margin: 2 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 },
  pinWrap: { alignItems: 'center' },
  thumb: {
    width: 48,
    height: 60,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: '#fff',
    overflow: 'hidden',
    backgroundColor: '#ddd',
  },
  thumbImg: { width: '100%', height: '100%' },
  pointer: {
    width: 0,
    height: 0,
    marginTop: -1,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#fff',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    minHeight: 48,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
