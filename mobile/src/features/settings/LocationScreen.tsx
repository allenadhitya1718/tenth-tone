import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import {
  fetchMyLocationSettings,
  locationKeys,
  setLocationSharing,
  setLocationVisibility,
  type LocationSettings,
  type LocationVisibility,
} from '@/api/location';
import { getMyBirthDate, isAdult, settingsKeys } from '@/api/settings';
import { BirthDateField } from '@/components/BirthDateField';
import { AppText, Button, Screen, TopBar } from '@/components/ui';
import { saveBirthDate } from '@/lib/auth';

import {
  ErrorView,
  errorText,
  Group,
  InlineError,
  LoadingView,
  Note,
  RadioGroup,
  RadioRow,
  showError,
  SwitchRow,
} from './components';

// Location sharing: the master switch and who sees you. Sharing is 18+,
// which a database trigger enforces; an account made before the signup
// wizard may have no birthday yet, so it is asked for here.
export function LocationScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = locationKeys.settings();
  const loc = useQuery({ queryKey: key, queryFn: fetchMyLocationSettings });
  const [busy, setBusy] = useState(false);
  const [askBirth, setAskBirth] = useState(false);
  const [birth, setBirth] = useState('');
  const [birthErr, setBirthErr] = useState<string | null>(null);

  const put = (patch: Partial<LocationSettings>) => {
    const prev = qc.getQueryData<LocationSettings>(key);
    if (prev) qc.setQueryData<LocationSettings>(key, { ...prev, ...patch });
    return prev;
  };

  async function turnOn() {
    setBusy(true);
    try {
      if (!(await getMyBirthDate())) {
        setAskBirth(true);
        return;
      }
      if (!(await isAdult())) {
        showError(t, new Error('adult'), 'settings2.location.adultOnly');
        return;
      }
      await apply(true);
    } catch (e) {
      showError(t, e, 'settings2.common.updateFailed');
    } finally {
      setBusy(false);
    }
  }

  async function apply(on: boolean) {
    const prev = put({ sharing_enabled: on });
    try {
      await setLocationSharing(on);
    } catch (e) {
      qc.setQueryData(key, prev);
      throw e;
    } finally {
      qc.invalidateQueries({ queryKey: locationKeys.all() });
    }
  }

  async function toggle(on: boolean) {
    if (on) return turnOn();
    setBusy(true);
    try {
      await apply(false);
    } catch (e) {
      showError(t, e, 'settings2.common.updateFailed');
    } finally {
      setBusy(false);
    }
  }

  async function saveBirthAndContinue() {
    if (!birth) return;
    setBusy(true);
    setBirthErr(null);
    try {
      await saveBirthDate(birth);
      qc.invalidateQueries({ queryKey: settingsKeys.birthDate() });
      setAskBirth(false);
      if (!(await isAdult())) {
        setBirthErr(t('settings2.location.adultOnly'));
        return;
      }
      await apply(true);
    } catch (e) {
      setBirthErr(/minimum age/i.test(String((e as Error)?.message)) ? t('errors.tooYoung') : errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function choose(v: LocationVisibility) {
    const prev = put({ visibility: v });
    try {
      await setLocationVisibility(v);
    } catch (e) {
      qc.setQueryData(key, prev);
      showError(t, e, 'settings2.common.updateFailed');
    } finally {
      qc.invalidateQueries({ queryKey: locationKeys.all() });
    }
  }

  const on = !!loc.data?.sharing_enabled && loc.data.visibility !== 'none';

  return (
    <Screen header={<TopBar title={t('settings2.location.title')} />} contentStyle={styles.content}>
      {loc.isLoading ? (
        <LoadingView />
      ) : loc.isError ? (
        <ErrorView onRetry={() => loc.refetch()} />
      ) : (
        <>
          <Group footer={t('settings2.location.switchHint')}>
            <SwitchRow
              icon="location-outline"
              label={t('settings2.location.share')}
              value={on}
              disabled={busy}
              onChange={toggle}
            />
          </Group>

          {askBirth ? (
            <View style={styles.birth}>
              <AppText variant="label">{t('settings2.location.birthTitle')}</AppText>
              <AppText variant="small" muted style={{ marginVertical: 8 }}>
                {t('settings2.location.birthBody')}
              </AppText>
              <BirthDateField value={birth} onChange={setBirth} />
              <Button title={t('common.save')} disabled={!birth} loading={busy} onPress={saveBirthAndContinue} />
            </View>
          ) : null}
          <InlineError text={birthErr} />

          {on ? (
            <RadioGroup title={t('settings2.location.withTitle')}>
              {(['friends', 'public'] as LocationVisibility[]).map((v) => (
                <RadioRow
                  key={v}
                  label={t(`settings2.location.${v}`)}
                  hint={t(`settings2.location.${v}Hint`)}
                  selected={loc.data?.visibility === v}
                  onPress={() => choose(v)}
                />
              ))}
            </RadioGroup>
          ) : null}
          <Note>{t('settings2.location.note')}</Note>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  birth: { marginTop: 18 },
});
