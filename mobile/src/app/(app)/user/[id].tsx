import { useLocalSearchParams } from 'expo-router';

import { ProfileView } from '@/features/profile/ProfileView';
import { useAuth } from '@/providers/AuthProvider';

export default function UserProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  return <ProfileView userId={String(id)} isMe={session?.user.id === id} />;
}
