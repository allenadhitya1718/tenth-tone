import { Redirect, useLocalSearchParams } from 'expo-router';

// https://flyp-sa.com/v/<id> (and flyp://v/<id>) is the shared video link
// (videoLink in api/discover.ts). The OS hands the path to the router as-is,
// so this forwards it to the real video route.
export default function ShortVideoLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={{ pathname: '/video/[id]', params: { id: String(id) } }} />;
}
