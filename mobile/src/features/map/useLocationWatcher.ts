import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';

import { upsertLocation } from '@/api/location';

import { distanceMeters, type LatLng } from './geo';

export type PermissionState = 'unknown' | 'granted' | 'denied';

// Sending rules: at most one fix every 20 s, or sooner (but never more than
// every 5 s) once the person has moved 50 m. The position only ever lives in
// the one user_locations row; nothing is buffered on the device.
const SEND_EVERY_MS = 20_000;
const SEND_MIN_GAP_MS = 5_000;
const SEND_MOVED_M = 50;

type Options = {
  // Watch only while this is true: the map is focused, the app is in the
  // foreground, and the person has consented to sharing.
  active: boolean;
  // Push fixes to the server. False shows your own position locally only.
  share: boolean;
  // update_my_location stored nothing: sharing is off on the server.
  onRejected?: () => void;
};

// Foreground location while the friends map is open. The subscription is
// removed whenever `active` turns false and on unmount, so the GPS is never
// left running behind a closed or backgrounded screen.
export function useLocationWatcher({ active, share, onRejected }: Options) {
  const [position, setPosition] = useState<(LatLng & { accuracy: number | null }) | null>(null);
  const [permission, setPermission] = useState<PermissionState>('unknown');
  const lastSent = useRef<{ at: number; p: LatLng } | null>(null);
  const shareRef = useRef(share);
  const rejectedRef = useRef(onRejected);
  useEffect(() => {
    shareRef.current = share;
    rejectedRef.current = onRejected;
  }, [share, onRejected]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let sub: Location.LocationSubscription | null = null;

    const handle = (loc: Location.LocationObject) => {
      if (cancelled) return;
      const p = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setPosition({ ...p, accuracy: loc.coords.accuracy ?? null });
      if (!shareRef.current) return;
      const now = Date.now();
      const prev = lastSent.current;
      if (prev) {
        const gap = now - prev.at;
        const moved = distanceMeters(prev.p, p);
        if (gap < SEND_MIN_GAP_MS) return;
        if (gap < SEND_EVERY_MS && moved < SEND_MOVED_M) return;
      }
      lastSent.current = { at: now, p };
      upsertLocation({ lat: p.latitude, lng: p.longitude, accuracy: loc.coords.accuracy ?? null })
        .then((stored) => {
          if (!stored && !cancelled) rejectedRef.current?.();
        })
        .catch((e: Error) => console.warn('location fix:', e?.message));
    };

    (async () => {
      try {
        let perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (!perm.granted) {
          setPermission('denied');
          return;
        }
        setPermission('granted');
        // A cached fix draws the pin at once; the watch refines it.
        const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 }).catch(() => null);
        if (last) handle(last);
        const s = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: SEND_EVERY_MS, distanceInterval: SEND_MOVED_M },
          handle,
          (reason) => console.warn('location watch:', reason),
        );
        if (cancelled) s.remove();
        else sub = s;
      } catch (e) {
        console.warn('location watch:', (e as Error)?.message);
      }
    })();

    return () => {
      cancelled = true;
      sub?.remove();
      sub = null;
    };
  }, [active]);

  // Re-arm the throttle when sharing restarts, so the first fix goes at once.
  useEffect(() => {
    if (share) lastSent.current = null;
  }, [share]);

  return { position, permission };
}
