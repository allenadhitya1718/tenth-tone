import { useTranslation } from 'react-i18next';

// A SAR amount with two decimals, in the app's language (digits included).
export function useSar() {
  const { i18n } = useTranslation();
  return (n: number) => n.toLocaleString(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
