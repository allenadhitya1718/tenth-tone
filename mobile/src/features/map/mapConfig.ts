import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { PROVIDER_DEFAULT, PROVIDER_GOOGLE, type MapStyleElement } from 'react-native-maps';

// Google Maps on Android needs an API key baked into the manifest. Without
// one the native SDK throws when the map is created, which no JS boundary can
// catch, so the screen checks for the key first and shows a placeholder
// instead of mounting the map. The key can come from either place Expo reads
// it: android.config.googleMaps.apiKey, or the react-native-maps config
// plugin's androidGoogleMapsApiKey.
function androidKeyConfigured(): boolean {
  const cfg = Constants.expoConfig;
  // android.config and plugins are stripped from the runtime config, so
  // app.config.js also sets this flag in `extra` when the key is present.
  if ((cfg?.extra as { mapsKeyConfigured?: boolean } | undefined)?.mapsKeyConfigured) return true;
  if (cfg?.android?.config?.googleMaps?.apiKey) return true;
  return (cfg?.plugins ?? []).some(
    (p) =>
      Array.isArray(p) &&
      p[0] === 'react-native-maps' &&
      !!(p[1] as { androidGoogleMapsApiKey?: string } | undefined)?.androidGoogleMapsApiKey,
  );
}

export const MAPS_AVAILABLE = Platform.OS === 'ios' || (Platform.OS === 'android' && androidKeyConfigured());

// iOS uses Apple Maps (no key, follows the dark appearance through
// userInterfaceStyle); Android uses Google Maps, styled with the JSON below.
export const MAP_PROVIDER = Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT;

// Navy night style built from the app's dark palette (#000421 ground), so the
// map reads as part of FLYP instead of a stock Google night map.
export const DARK_MAP_STYLE: MapStyleElement[] = [
  { elementType: 'geometry', stylers: [{ color: '#0a1236' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#98a3c7' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#000421' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#1a2658' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#0f1a45' }] },
  { featureType: 'poi', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#0b2233' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#4f7a73' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#16205a' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#0a1236' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#7f8ab3' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#1e2c78' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#0f1c4d' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#c3cbe8' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#121c4a' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#98a3c7' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#000421' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#3d4a7a' }] },
];
