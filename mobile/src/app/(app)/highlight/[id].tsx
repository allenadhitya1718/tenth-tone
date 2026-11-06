import { useLocalSearchParams } from 'expo-router';
import { z } from 'zod';

import { HighlightPlayer } from '@/features/highlights/HighlightPlayer';

// Deep links deliver untrusted strings; highlight ids are uuids.
const Params = z.object({ id: z.uuid() });

export default function HighlightRoute() {
  const parsed = Params.safeParse(useLocalSearchParams());
  if (!parsed.success) return null;
  return <HighlightPlayer id={parsed.data.id} />;
}
