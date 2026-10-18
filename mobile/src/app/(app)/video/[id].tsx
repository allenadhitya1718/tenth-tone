import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

// A video opens in the home feed itself (For You), pinned first, so a swipe
// carries on into the normal feed. Grid tiles, notifications and /v/<id>
// links all come through here. `at` makes tapping the same clip twice
// re-pin it.
export default function VideoRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [at] = useState(() => String(Date.now()));
  return <Redirect href={{ pathname: '/', params: { v: String(id), at } }} />;
}
