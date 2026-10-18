import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet } from 'react-native';

import type { WhoCan } from '@/api/settings';
import { Screen, TopBar } from '@/components/ui';

import { ErrorView, LoadingView, Note, pgCode, RadioGroup, RadioRow, showError } from './components';
import { useUpdateUserSettings, useUserSettings } from './hooks';
import { whoLabelKey, type WhoField } from './PrivacyScreen';

// Client note 13: Everyone / Friends / Nobody. Friends means people who
// follow you back. Older accounts may have 'following' (people I follow)
// saved; it is shown to them, and stays selectable, but is not offered to
// anyone else.
const BASE: WhoCan[] = ['everyone', 'friends', 'nobody'];

export function WhoCanScreen({ field }: { field: WhoField }) {
  const { t } = useTranslation();
  const settings = useUserSettings();
  const update = useUpdateUserSettings();
  const column = `who_can_${field}` as const;
  const current = settings.data?.[column];

  // Remembered from the first value we saw, so choosing something else does
  // not make the legacy option vanish from under the person's finger.
  const [legacy, setLegacy] = useState(false);
  if (!legacy && current === 'following') setLegacy(true);
  const options: WhoCan[] = legacy ? ['everyone', 'following', 'friends', 'nobody'] : BASE;

  function choose(v: WhoCan) {
    update.mutate(
      { [column]: v },
      {
        onError: (e) => {
          // 23514: the check constraint still only allows the old values,
          // i.e. the migration that adds 'friends' has not run yet.
          if (v === 'friends' && pgCode(e) === '23514') {
            Alert.alert(t('settings2.who.friendsUnavailableTitle'), t('settings2.who.friendsUnavailable'));
            return;
          }
          showError(t, e, 'settings2.common.updateFailed');
        },
      },
    );
  }

  return (
    <Screen header={<TopBar title={t(`settings2.who.title_${field}`)} />} contentStyle={styles.content}>
      {settings.isLoading ? (
        <LoadingView />
      ) : settings.isError ? (
        <ErrorView onRetry={() => settings.refetch()} />
      ) : (
        <>
          <RadioGroup title={t(`settings2.who.question_${field}`)}>
            {options.map((v) => (
              <RadioRow
                key={v}
                label={t(whoLabelKey(v))}
                hint={t(`settings2.who.hint_${v}`)}
                selected={current === v}
                disabled={update.isPending}
                onPress={() => choose(v)}
              />
            ))}
          </RadioGroup>
          <Note>{t(`settings2.who.note_${field}`)}</Note>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({ content: { paddingHorizontal: 16, paddingBottom: 40 } });
