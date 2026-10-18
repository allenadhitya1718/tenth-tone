import { Redirect, useLocalSearchParams } from 'expo-router';

import { StoryViewer } from '@/features/stories/StoryViewer';

// Deep links carry untrusted strings; only a UUID reaches the viewer.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// flyp://stories/<userId>
export default function StoriesRoute() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const id = Array.isArray(userId) ? userId[0] : userId;
  if (!id || !UUID.test(id)) return <Redirect href="/" />;
  // Keyed so moving to the next person starts a fresh player.
  return <StoryViewer key={id} userId={id} />;
}
