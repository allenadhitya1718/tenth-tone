import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { locationKeys, setLocationSharing, setLocationVisibility, type LocationVisibility } from '@/api/location';
import { AppText, Button, ErrorBox, Screen, TopBar, type ErrorMsg } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';

import { locationErrorKey } from './errors';

const POINTS: { icon: keyof typeof Ionicons.glyphMap; key: string }[] = [
  { icon: 'eye-outline', key: 'map.consentWho' },
  { icon: 'time-outline', key: 'map.consentOnlyOpen' },
  { icon: 'trash-outline', key: 'map.consentNoHistory' },
  { icon: 'shield-checkmark-outline', key: 'map.consentAdult' },
];

// Opening the map is not consent. Sharing starts only from this screen, with
// the reader told exactly who sees what, and the 18+ rule (enforced by the
// database) said up front rather than discovered as an error.
export function LocationConsent({ onSkip }: { onSkip: () => void }) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const qc = useQueryClient();
  const [visibility, setVisibility] = useState<Exclude<LocationVisibility, 'none'>>('friends');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorMsg>(null);
  const [blocked, setBlocked] = useState(false);
  const tint = isDark ? colors.primary2 : colors.primary;

  async function accept() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        setBlocked(!perm.canAskAgain);
        setError({ key: 'map.permissionDenied' });
        return;
      }
      await setLocationSharing(true);
      if (visibility === 'public') await setLocationVisibility('public');
      await qc.invalidateQueries({ queryKey: locationKeys.settings() });
    } catch (e) {
      setError({ key: locationErrorKey(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen header={<TopBar title={t('map.title')} />}>
      <View style={[styles.hero, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name="location" size={40} color={tint} />
      </View>
      <AppText variant="title" center accessibilityRole="header">
        {t('map.consentTitle')}
      </AppText>
      <AppText variant="subtitle" muted center>
        {t('map.consentLead')}
      </AppText>

      <View style={[styles.card, { backgroundColor: colors.bg2 }]}>
        {POINTS.map((p) => (
          <View key={p.key} style={styles.point}>
            <Ionicons name={p.icon} size={20} color={tint} />
            <AppText style={{ flex: 1 }}>{t(p.key)}</AppText>
          </View>
        ))}
      </View>

      <AppText variant="label" style={{ marginTop: 18, marginBottom: 6 }}>
        {t('map.whoCanSee')}
      </AppText>
      <View style={[styles.card, { backgroundColor: colors.bg2 }]} accessibilityRole="radiogroup">
        {(['friends', 'public'] as const).map((v) => (
          <Pressable
            key={v}
            onPress={() => setVisibility(v)}
            style={styles.option}
            accessibilityRole="radio"
            accessibilityState={{ checked: visibility === v }}
            accessibilityHint={t(`map.visibility_${v}_hint`)}
          >
            <Ionicons name={v === 'friends' ? 'people-outline' : 'earth-outline'} size={20} color={colors.text} />
            <View style={{ flex: 1 }}>
              <AppText>{t(`map.visibility_${v}`)}</AppText>
              <AppText variant="small" muted>
                {t(`map.visibility_${v}_hint`)}
              </AppText>
            </View>
            <Ionicons
              name={visibility === v ? 'radio-button-on' : 'radio-button-off'}
              size={22}
              color={visibility === v ? tint : colors.muted}
            />
          </Pressable>
        ))}
      </View>

      <View style={{ height: 18 }} />
      <ErrorBox error={error} />
      {blocked ? (
        <Button title={t('map.openSettings')} variant="secondary" onPress={() => void Linking.openSettings()} />
      ) : null}
      <Button title={t('map.shareMyLocation')} onPress={accept} loading={busy} disabled={busy} />
      <Button title={t('map.notNow')} variant="ghost" onPress={onSkip} disabled={busy} />
      <AppText variant="small" muted center>
        {t('map.consentFooter')}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginVertical: 18,
  },
  card: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6 },
  point: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 10 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60 },
});
