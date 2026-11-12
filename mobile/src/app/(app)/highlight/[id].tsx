import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { z } from 'zod';

// A highlight opens in the home feed itself (For You), pinned first, so a
// swipe carries on to the next highlight, as on Reels (client, Nov 2026: it
// used to open alone, like an audio player). Profile tiles, links and the
// "posted" hand-off all come through here. `at` makes tapping the same
// highlight twice re-pin it.
const Params = z.object({ id: z.uuid() });

export default function HighlightRoute() {
  const parsed = Params.safeParse(useLocalSearchParams());
  const [at] = useState(() => String(Date.now()));
  // Deep links deliver untrusted strings; highlight ids are uuids.
  if (!parsed.success) return <Redirect href="/" />;
  return <Redirect href={{ pathname: '/', params: { h: parsed.data.id, at } }} />;
}
