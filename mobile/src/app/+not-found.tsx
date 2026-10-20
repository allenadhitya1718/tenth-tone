import { useTranslation } from 'react-i18next';

import { NotFoundState } from '@/components/NotFoundState';

// Any link no route matches (an old or mistyped flyp:// link): a translated
// message and a way out, instead of expo-router's developer "Unmatched Route".
export default function NotFound() {
  const { t } = useTranslation();
  return <NotFoundState title={t('errors.pageNotFoundTitle')} body={t('errors.pageNotFoundBody')} />;
}
