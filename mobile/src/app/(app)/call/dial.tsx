import { useLocalSearchParams } from 'expo-router';

import { CallScreen } from '@/features/call/CallScreen';

// Placing a call: /call/dial?to=<userId>&kind=audio|video&n=<nonce>
// [&chat=<chatId>&name=&handle=&avatar=]. Build the link with dialPath() in
// features/call/nav.ts. The screen shows "Calling…" at once and writes the
// calls row behind it.
export default function DialRoute() {
  const p = useLocalSearchParams<{
    to: string;
    kind?: string;
    n?: string;
    chat?: string;
    name?: string;
    handle?: string;
    avatar?: string;
  }>();
  const nonce = String(p.n ?? p.to);
  return (
    <CallScreen
      key={nonce}
      dial={{
        nonce,
        to: String(p.to),
        kind: p.kind === 'video' ? 'video' : 'audio',
        chat: p.chat || null,
        name: p.name || null,
        handle: p.handle || null,
        avatar: p.avatar || null,
      }}
    />
  );
}
