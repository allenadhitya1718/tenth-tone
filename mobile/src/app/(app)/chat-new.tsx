import { useLocalSearchParams } from 'expo-router';

import { NewChat } from '@/features/chat/NewChat';

// flyp://chat-new opens a direct message picker; ?mode=group starts in group mode.
export default function ChatNewRoute() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  return <NewChat initialGroup={mode === 'group'} />;
}
