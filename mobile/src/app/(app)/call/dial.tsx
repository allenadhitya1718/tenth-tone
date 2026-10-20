import { useLocalSearchParams } from 'expo-router';

import { CallScreen } from '@/features/call/CallScreen';
import { DialConfirm } from '@/features/call/DialConfirm';
import { dialIntent } from '@/features/call/nav';

// Placing a call: /call/dial?to=<userId>&kind=audio|video&n=<nonce>. Build
// the link with dialPath() in features/call/nav.ts, which files the rest of
// the request (chat, name, photo) in memory under the nonce.
//
// The same route opens from a deep link (flyp://call/dial?...). Only a nonce
// dialPath() handed out in this app session dials at once; anything else
// asks first, showing the person as the server knows them (DialConfirm) and
// ignoring any name / photo in the link.
export default function DialRoute() {
  const p = useLocalSearchParams<{ to: string; kind?: string; n?: string }>();
  const to = String(p.to ?? '');
  const kind = p.kind === 'video' ? 'video' : 'audio';
  const nonce = p.n ? String(p.n) : undefined;
  const intent = dialIntent(nonce, to);

  if (!intent || !nonce) return <DialConfirm to={to} kind={kind} />;

  return (
    <CallScreen
      key={nonce}
      dial={{
        nonce,
        to: intent.to,
        kind: intent.kind,
        chat: intent.chat ?? null,
        name: intent.name ?? null,
        handle: intent.handle ?? null,
        avatar: intent.avatar ?? null,
        group: !!intent.group,
      }}
    />
  );
}
