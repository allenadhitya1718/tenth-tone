import { useLocalSearchParams } from 'expo-router';

import { HomeFeed } from '@/features/feed/HomeFeed';

// `v` = a video, `h` = a highlight to show first on For You.
export default function Home() {
  const { v, h, at } = useLocalSearchParams<{ v?: string; h?: string; at?: string }>();
  const pin =
    typeof h === 'string' && h
      ? ({ kind: 'highlight', id: h, at: at ?? '' } as const)
      : typeof v === 'string' && v
        ? ({ kind: 'video', id: v, at: at ?? '' } as const)
        : undefined;
  return <HomeFeed pin={pin} />;
}
