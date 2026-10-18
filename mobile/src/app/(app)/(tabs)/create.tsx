import { useTranslation } from 'react-i18next';

import { Placeholder } from '@/components/Placeholder';

export default function Create() {
  const { t } = useTranslation();
  return <Placeholder title={t('tabs.create')} />;
}
