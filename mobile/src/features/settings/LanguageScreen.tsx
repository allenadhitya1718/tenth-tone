import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, StyleSheet } from 'react-native';

import { Screen, TopBar } from '@/components/ui';
import { LANGUAGES, languageIsRtl, setLanguage, type LangCode } from '@/i18n';

import { confirm, Note, RadioGroup, RadioRow, showError } from './components';

// Client note 14: every language the app has, by its own name. Moving
// between a right-to-left and a left-to-right language restarts the app,
// because React Native only reads the layout direction at startup.
export function LanguageScreen() {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);

  async function choose(code: LangCode) {
    if (code === i18n.language || busy) return;
    const flips = languageIsRtl(code) !== I18nManager.isRTL;
    if (flips) {
      const target = LANGUAGES.find((l) => l.code === code)?.native ?? code;
      const yes = await confirm({
        title: t('settings2.language.restartTitle'),
        message: t('settings2.language.restartMessage', { language: target }),
        confirmLabel: t('settings2.language.restartConfirm'),
        cancelLabel: t('common.cancel'),
      });
      if (!yes) return;
    }
    setBusy(true);
    try {
      await setLanguage(code);
    } catch (e) {
      showError(t, e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen header={<TopBar title={t('settings.language')} />} contentStyle={styles.content}>
      <RadioGroup title={t('settings2.language.choose')}>
        {LANGUAGES.map((l) => {
          // The name in the current language and in English as well, for
          // anyone who cannot read the script of the one they are looking for.
          const local = t(`settings2.language.names.${l.code}`, { defaultValue: l.english });
          const hint = [...new Set([local, l.english])].filter((n) => n && n !== l.native).join(' · ');
          return (
            <RadioRow
              key={l.code}
              label={l.native}
              hint={hint || undefined}
              selected={i18n.language === l.code}
              disabled={busy}
              onPress={() => choose(l.code)}
            />
          );
        })}
      </RadioGroup>
      <Note>{t('settings2.language.restartNote')}</Note>
    </Screen>
  );
}

const styles = StyleSheet.create({ content: { paddingHorizontal: 16, paddingBottom: 40 } });
