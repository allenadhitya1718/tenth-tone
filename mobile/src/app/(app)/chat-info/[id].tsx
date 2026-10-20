import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { NotFoundState } from '@/components/NotFoundState';
import { GroupInfo } from '@/features/chat/GroupInfo';

// Deep links deliver untrusted strings; chat ids are uuids.
const Params = z.object({ id: z.uuid() });

export default function GroupInfoRoute() {
  const { t } = useTranslation();
  const parsed = Params.safeParse(useLocalSearchParams());
  if (!parsed.success) {
    return <NotFoundState icon="people-outline" title={t('groupInfo.goneTitle')} body={t('groupInfo.goneBody')} />;
  }
  return <GroupInfo key={parsed.data.id} chatId={parsed.data.id} />;
}
