import { useLocalSearchParams } from 'expo-router';

import { ConfirmBirthday } from '@/features/settings/ConfirmBirthday';

// /confirm-birthday: the one-time ask after signing in (AppLayout sends
// accounts without a birthday here); ?from=edit when opened from Edit Profile.
export default function ConfirmBirthdayRoute() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  return <ConfirmBirthday mode={from === 'edit' ? 'edit' : 'gate'} />;
}
