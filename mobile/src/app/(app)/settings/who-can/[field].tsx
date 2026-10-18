import { Redirect, useLocalSearchParams } from 'expo-router';

import { WHO_FIELDS, type WhoField } from '@/features/settings/PrivacyScreen';
import { WhoCanScreen } from '@/features/settings/WhoCanScreen';

// flyp://settings/who-can/message | comment | tag. The param comes from a
// deep link, so anything else goes back to Settings.
export default function WhoCanRoute() {
  const { field } = useLocalSearchParams<{ field: string }>();
  if (!WHO_FIELDS.includes(field as WhoField)) return <Redirect href="/settings" />;
  return <WhoCanScreen field={field as WhoField} />;
}
