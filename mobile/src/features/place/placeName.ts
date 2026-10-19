import type * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';

import type { VideoPlace } from '@/api/videos';

// Privacy rule (PHASE4 notes): a post stores the chosen place's area, never
// the poster's raw GPS fix. Three decimals is roughly 100 m.
export const roundCoord = (n: number) => Math.round(n * 1000) / 1000;

// 0101 allows 1-120 characters.
export const MAX_PLACE_NAME = 120;

// Android often puts the house number, a Plus Code ("8Q7X+2F") or the whole
// street line in `name`; none of those reads as a place.
function usefulName(a: Location.LocationGeocodedAddress): string | null {
  const n = (a.name ?? '').trim();
  if (!n) return null;
  if (/^[\d\s\-/]+$/.test(n)) return null;
  if (/^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}\b/i.test(n)) return null;
  if (a.streetNumber && n === a.streetNumber) return null;
  return n;
}

// "Boulevard Riyadh City, Riyadh": the most specific readable name, then the
// city (or the region / country when there is no city). Never repeats a part.
export function describeAddress(a: Location.LocationGeocodedAddress): { title: string; subtitle: string } | null {
  const primary = usefulName(a) || a.district?.trim() || a.street?.trim() || null;
  const area = a.city?.trim() || a.subregion?.trim() || a.region?.trim() || a.country?.trim() || null;
  if (!primary && !area) return null;
  const title = primary || area!;
  const subtitle = [area !== title ? area : null, a.country?.trim() !== area ? a.country?.trim() : null]
    .filter((s): s is string => !!s && s !== title)
    .join(', ');
  return { title, subtitle };
}

// The single line saved on the post.
export function placeLabel(title: string, area?: string | null): string {
  const t = title.trim();
  const a = (area ?? '').trim();
  const label = a && !t.toLowerCase().includes(a.toLowerCase()) ? `${t}, ${a}` : t;
  return label.slice(0, MAX_PLACE_NAME);
}

export function toVideoPlace(name: string, lat: number, lng: number): VideoPlace {
  return { name: name.trim().slice(0, MAX_PLACE_NAME), lat: roundCoord(lat), lng: roundCoord(lng) };
}

// Opens the platform maps app on the place (a pin, not directions). Without
// coordinates the name is searched instead.
export function openPlaceInMaps(place: { name: string; lat: number | null; lng: number | null }) {
  const q = encodeURIComponent(place.name);
  const has = place.lat != null && place.lng != null;
  const ll = has ? `${place.lat},${place.lng}` : '';
  const url =
    Platform.OS === 'ios'
      ? has
        ? `https://maps.apple.com/?ll=${ll}&q=${q}`
        : `https://maps.apple.com/?q=${q}`
      : `https://www.google.com/maps/search/?api=1&query=${has ? ll : q}`;
  Linking.openURL(url).catch(() => {
    if (Platform.OS === 'android' && has) Linking.openURL(`geo:${ll}?q=${ll}(${q})`).catch(() => {});
  });
}
