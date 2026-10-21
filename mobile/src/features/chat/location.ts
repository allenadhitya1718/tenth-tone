import { Linking, Platform } from 'react-native';

// A location message (type 'location') carries a Google Maps link in `text`,
// the same wire format the earlier app wrote (web/js/views.js locationLink /
// parseLocation): https://www.google.com/maps?q=<lat>,<lng>(<label>). The
// "(label)" is Google Maps' own labelled-point syntax, so the plain link
// still works anywhere, and messages from either app read in both.
const LOC_RE = /[?&]q=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*\(([^)]*)\))?/;

export type SharedLocation = { lat: number; lng: number; label: string };

export function locationLink(lat: number, lng: number, label?: string | null): string {
  const base = `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
  const l = (label ?? '').trim().slice(0, 120);
  // The parentheses are the syntax, so only the label itself is encoded.
  return l ? `${base}(${encodeURIComponent(l)})` : base;
}

export function parseLocation(text: string | null | undefined): SharedLocation | null {
  if (typeof text !== 'string') return null;
  const m = LOC_RE.exec(text);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  let label = '';
  if (m[3]) {
    try {
      label = decodeURIComponent(m[3]);
    } catch {
      label = m[3];
    }
  }
  return { lat, lng, label };
}

// The phone's maps app on the point (Apple Maps on iPhone).
export function openLocation(loc: SharedLocation) {
  const ll = `${loc.lat},${loc.lng}`;
  const q = encodeURIComponent(loc.label || ll);
  const url =
    Platform.OS === 'ios'
      ? `https://maps.apple.com/?ll=${ll}&q=${q}`
      : `https://www.google.com/maps/search/?api=1&query=${ll}`;
  void Linking.openURL(url).catch(() => {});
}
