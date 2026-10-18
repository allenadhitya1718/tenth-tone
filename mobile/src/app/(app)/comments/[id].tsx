import { useLocalSearchParams } from 'expo-router';

import { CommentsSheet } from '@/features/comments/CommentsSheet';

export default function CommentsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CommentsSheet videoId={String(id)} />;
}
