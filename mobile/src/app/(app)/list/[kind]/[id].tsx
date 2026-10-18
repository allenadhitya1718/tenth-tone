import { useLocalSearchParams } from 'expo-router';

import { FollowList, type FollowListKind } from '@/features/discover/FollowList';

export default function FollowListRoute() {
  const { kind, id } = useLocalSearchParams<{ kind: string; id: string }>();
  // Anything but "following" is the followers list, so a mistyped link still
  // shows something sensible.
  const k: FollowListKind = kind === 'following' ? 'following' : 'followers';
  return <FollowList kind={k} userId={String(id ?? '')} />;
}
