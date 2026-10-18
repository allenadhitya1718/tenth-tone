import { useLocalSearchParams } from 'expo-router';

import { CallScreen } from '@/features/call/CallScreen';

// A call by its calls.id: incoming ring, a call placed earlier, or a push tap.
export default function CallRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CallScreen key={id} callId={String(id)} />;
}
