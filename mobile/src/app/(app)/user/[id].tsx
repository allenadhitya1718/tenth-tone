import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { NotFoundState } from '@/components/NotFoundState';
import { ProfileView } from '@/features/profile/ProfileView';
import { useAuth } from '@/providers/AuthProvider';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function UserProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { t } = useTranslation();
  // Deep links deliver untrusted strings; a profile id is a uuid.
  if (!UUID.test(String(id))) {
    return <NotFoundState icon="person-outline" title={t('fix4.notFoundUserTitle')} body={t('fix4.notFoundUserBody')} />;
  }
  return <ProfileView userId={String(id)} isMe={session?.user.id === id} />;
}
