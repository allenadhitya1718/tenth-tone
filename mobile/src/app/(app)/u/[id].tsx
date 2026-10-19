import { Redirect, useLocalSearchParams } from 'expo-router';

// https://flyp-sa.com/u/<userId> (and flyp://u/<userId>) is the shared
// profile link (profileLink in api/discover.ts). Forwarded to the profile route.
export default function ShortProfileLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={{ pathname: '/user/[id]', params: { id: String(id) } }} />;
}
