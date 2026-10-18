import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { z } from 'zod';

import { LiveRoom } from '@/features/live/LiveRoom';

// /live/<id>[?host=1]. The id arrives from deep links and notifications, so it
// is checked before it reaches a query or an Agora channel name.
const Params = z.object({
  id: z.uuid(),
  host: z.string().optional(),
});

export default function Screen() {
  const parsed = Params.safeParse(useLocalSearchParams());
  const ok = parsed.success;
  useEffect(() => {
    if (!ok) router.replace('/');
  }, [ok]);
  if (!parsed.success) return null;
  return <LiveRoom key={parsed.data.id} liveId={parsed.data.id} hostHint={parsed.data.host === '1'} />;
}
