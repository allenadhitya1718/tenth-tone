import { useLocalSearchParams } from 'expo-router';

import { HashtagScreen } from '@/features/discover/HashtagScreen';

export default function TagScreen() {
  const { tag } = useLocalSearchParams<{ tag: string }>();
  // A deep link hands over any string; keep a single path segment's worth.
  return <HashtagScreen tag={String(tag ?? '').slice(0, 100)} />;
}
