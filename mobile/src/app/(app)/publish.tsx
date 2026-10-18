import { useLocalSearchParams } from 'expo-router';

import { PublishScreen } from '@/features/publish/PublishScreen';

export default function PublishRoute() {
  const { uri, mime, size } = useLocalSearchParams<{ uri: string; mime?: string; size?: string }>();
  return <PublishScreen uri={String(uri)} mime={mime} size={size ? Number(size) || undefined : undefined} />;
}
