import { useLocalSearchParams } from 'expo-router';

import { HomeFeed } from '@/features/feed/HomeFeed';

export default function Home() {
  const { v, at } = useLocalSearchParams<{ v?: string; at?: string }>();
  return <HomeFeed pin={typeof v === 'string' && v ? { id: v, at: at ?? '' } : undefined} />;
}
