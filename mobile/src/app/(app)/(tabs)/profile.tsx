import { ProfileView } from '@/features/profile/ProfileView';
import { useAuth } from '@/providers/AuthProvider';

export default function MyProfile() {
  const { session } = useAuth();
  if (!session) return null;
  return <ProfileView userId={session.user.id} isMe />;
}
