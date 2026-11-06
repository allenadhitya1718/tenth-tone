import { useLocalSearchParams } from 'expo-router';
import { z } from 'zod';

import { HighlightMaker } from '@/features/live/HighlightMaker';

// Deep links deliver untrusted strings; live ids are uuids.
const Params = z.object({ id: z.uuid() });

export default function HighlightMakerRoute() {
  const parsed = Params.safeParse(useLocalSearchParams());
  if (!parsed.success) return null;
  return <HighlightMaker liveId={parsed.data.id} />;
}
