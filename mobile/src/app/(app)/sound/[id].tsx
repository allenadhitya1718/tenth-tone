import { useLocalSearchParams } from 'expo-router';

import { SoundScreen } from '@/features/discover/SoundScreen';

export default function SoundRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SoundScreen soundId={String(id ?? '')} />;
}
