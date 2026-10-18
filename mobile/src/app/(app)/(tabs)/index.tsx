import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Placeholder } from '@/components/Placeholder';
import { AppText } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';

// The feed lands in Phase 3, where these tabs also become a swipe pager
// (client note 24).
export default function Home() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [tab, setTab] = useState<'following' | 'forYou' | 'live'>('forYou');
  return (
    <Placeholder title={t('tabs.home')}>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 22, paddingVertical: 10 }}>
        {(['following', 'forYou', 'live'] as const).map((k) => (
          <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: tab === k }}>
            <AppText
              variant="label"
              muted={tab !== k}
              style={tab === k ? { borderBottomWidth: 2, borderBottomColor: colors.text, paddingBottom: 4 } : undefined}
            >
              {t(`home.${k}`)}
            </AppText>
          </Pressable>
        ))}
      </View>
    </Placeholder>
  );
}
