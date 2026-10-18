import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { AppText, Screen, TopBar } from '@/components/ui';
import { ChatThread } from '@/features/chat/ChatThread';

// Deep links deliver untrusted strings; chat ids are uuids.
const Params = z.object({ id: z.uuid() });

export default function ChatRoute() {
  const { t } = useTranslation();
  const parsed = Params.safeParse(useLocalSearchParams());
  if (!parsed.success) {
    return (
      <Screen header={<TopBar title={t('chat.notFoundTitle')} />}>
        <AppText muted center style={{ marginTop: 60 }}>
          {t('chat.notFound')}
        </AppText>
      </Screen>
    );
  }
  // Keyed so moving from one chat straight to another starts clean.
  return <ChatThread key={parsed.data.id} chatId={parsed.data.id} />;
}
