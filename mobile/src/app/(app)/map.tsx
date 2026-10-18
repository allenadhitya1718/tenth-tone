import { useLocalSearchParams } from 'expo-router';

import { FriendsMap } from '@/features/map/FriendsMap';

// Deep links carry untrusted strings; only a UUID is passed on.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: string | string[] | undefined) => {
  const s = Array.isArray(v) ? v[0] : v;
  return s && UUID.test(s) ? s : null;
};

// flyp://map, flyp://map?user=<id> (centre on a friend),
// flyp://map?request=<id> (ask someone for their location).
export default function MapRoute() {
  const { user, request } = useLocalSearchParams<{ user?: string; request?: string }>();
  return <FriendsMap focusUserId={uuidOrNull(user)} requestUserId={uuidOrNull(request)} />;
}
