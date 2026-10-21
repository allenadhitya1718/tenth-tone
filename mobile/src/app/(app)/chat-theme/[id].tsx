import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { NotFoundState } from '@/components/NotFoundState';
import { ChatThemeScreen } from '@/features/chat/ChatThemeScreen';

// Deep links deliver untrusted strings; chat ids are uuids.
const Params = z.object({ id: z.uuid() });

export default function ChatThemeRoute() {
  const { t } = useTranslation();
  const parsed = Params.safeParse(useLocalSearchParams());
  if (!parsed.success) {
    return <NotFoundState icon="chatbubbles-outline" title={t('fix4.notFoundChatTitle')} body={t('fix4.notFoundChatBody')} />;
  }
  return <ChatThemeScreen key={parsed.data.id} chatId={parsed.data.id} />;
}
