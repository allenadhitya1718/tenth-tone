import { Redirect, useLocalSearchParams } from 'expo-router';

import { PublishScreen } from '@/features/publish/PublishScreen';

export default function PublishRoute() {
  const { uri, mime, size } = useLocalSearchParams<{ uri?: string; mime?: string; size?: string }>();
  // flyp://publish with no clip has nothing to post: back to the camera.
  if (!uri || typeof uri !== 'string') return <Redirect href="/camera" />;
  return <PublishScreen uri={uri} mime={mime} size={size ? Number(size) || undefined : undefined} />;
}
