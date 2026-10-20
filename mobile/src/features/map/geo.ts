import type { TFunction } from 'i18next';
import { Linking, Platform } from 'react-native';
import { Alert } from '@/components/Dialog';

export type LatLng = { latitude: number; longitude: number };

const EARTH_RADIUS_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

// Great-circle distance in metres. Good to a few metres at city scale, which
// is all a "1.2 km away" label needs.
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// "350 m", "1.2 km", "48 km", in the reader's own digits.
export function formatDistance(m: number, t: TFunction, locale: string): string {
  if (m < 1000) {
    const n = Math.max(10, Math.round(m / 10) * 10);
    return t('map.distanceM', { n: n.toLocaleString(locale) });
  }
  const km = m / 1000;
  const n = km < 10 ? km.toLocaleString(locale, { maximumFractionDigits: 1 }) : Math.round(km).toLocaleString(locale);
  return t('map.distanceKm', { n });
}

const coord = (p: LatLng) => `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`;

// Hands off to the platform's own maps app for turn-by-turn directions. On
// iOS both Apple Maps and Google Maps are offered (Google opens in the app if
// installed, else the browser). On Android the Google Maps URL opens the
// installed app; a geo: intent is the fallback for devices without it.
export function openDirections(to: LatLng, t: TFunction) {
  const dest = coord(to);
  const google = `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
  const fail = () => Alert.alert(t('map.directionsFailed'));
  if (Platform.OS === 'ios') {
    Alert.alert(t('map.directionsWith'), undefined, [
      {
        text: t('map.appleMaps'),
        onPress: () => Linking.openURL(`https://maps.apple.com/?daddr=${dest}&dirflg=d`).catch(fail),
      },
      { text: t('map.googleMaps'), onPress: () => Linking.openURL(google).catch(fail) },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
    return;
  }
  Linking.openURL(google).catch(() => Linking.openURL(`geo:${dest}?q=${dest}`).catch(fail));
}

// A region that comfortably shows a neighbourhood around a point.
export const regionAround = (p: LatLng, delta = 0.02) => ({ ...p, latitudeDelta: delta, longitudeDelta: delta });

// Riyadh, the old app's starting point, when nothing better is known.
export const DEFAULT_REGION = regionAround({ latitude: 24.7136, longitude: 46.6753 }, 0.2);
