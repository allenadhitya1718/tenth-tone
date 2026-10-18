import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { passwordChecks } from '@/lib/password';
import { useTheme } from '@/providers/ThemeProvider';

import { AppText } from './ui';

export function PasswordRules({ value }: { value: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6, marginBottom: 14, marginTop: -2 }}>
      {passwordChecks(value).map((c) => (
        <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons
            name={c.ok ? 'checkmark-circle' : 'ellipse-outline'}
            size={16}
            color={c.ok ? colors.success : colors.muted2}
          />
          <AppText variant="small" muted={!c.ok}>
            {t(c.key)}
          </AppText>
        </View>
      ))}
    </View>
  );
}
