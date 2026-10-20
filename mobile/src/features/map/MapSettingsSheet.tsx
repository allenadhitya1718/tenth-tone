import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  fetchIncomingPermits,
  fetchTrackedLocations,
  locationKeys,
  respondToLocationPermit,
  revokeLocationPermit,
  setLocationVisibility,
  stopSharingLocation,
  type LocationSettings,
} from '@/api/location';
import { Alert } from '@/components/Dialog';
import { AppText, Button } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';

import { locationErrorKey } from './errors';
import { PersonAvatar } from './PersonAvatar';

type Props = {
  visible: boolean;
  settings: LocationSettings | undefined;
  onClose: () => void;
  onTurnOn: () => void;
};

// Who can see you, stop sharing, requests to track you, and the people you
// track. Everything that changes what others can see is confirmed first.
export function MapSettingsSheet({ visible, settings, onClose, onTurnOn }: Props) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const tint = isDark ? colors.primary2 : colors.primary;
  const sharing = !!settings?.sharing_enabled;
  const fail = (e: unknown) => Alert.alert(t('map.errTitle'), t(locationErrorKey(e)));

  const incoming = useQuery({
    queryKey: locationKeys.incomingPermits(),
    queryFn: fetchIncomingPermits,
    enabled: visible,
  });
  const tracked = useQuery({ queryKey: locationKeys.tracked(), queryFn: fetchTrackedLocations, enabled: visible });

  const visibility = useMutation({
    mutationFn: (v: 'friends' | 'public') => setLocationVisibility(v),
    onSuccess: () => qc.invalidateQueries({ queryKey: locationKeys.settings() }),
    onError: fail,
  });
  const stop = useMutation({
    mutationFn: stopSharingLocation,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: locationKeys.settings() });
      onClose();
    },
    onError: fail,
  });
  const respond = useMutation({
    mutationFn: ({ id, d }: { id: string; d: 'approved' | 'denied' }) => respondToLocationPermit(id, d),
    onSuccess: () => qc.invalidateQueries({ queryKey: locationKeys.incomingPermits() }),
    onError: fail,
  });
  const revoke = useMutation({
    mutationFn: (userId: string) => revokeLocationPermit(userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: locationKeys.tracked() });
      void qc.invalidateQueries({ queryKey: locationKeys.all() });
    },
    onError: fail,
  });

  const confirmStop = () =>
    Alert.alert(t('map.stopSharingQ'), t('map.stopSharingBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('map.stopSharing'), style: 'destructive', onPress: () => stop.mutate() },
    ]);

  const approve = (id: string, name: string) =>
    Alert.alert(t('map.approveQ', { name }), t('map.approveBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('map.approve'), onPress: () => respond.mutate({ id, d: 'approved' }) },
    ]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('map.close')}
      />
      <View
        style={[styles.panel, { backgroundColor: colors.bg, paddingBottom: insets.bottom + 12 }]}
        accessibilityViewIsModal
      >
        <View style={styles.head}>
          <AppText variant="label" style={{ flex: 1 }} accessibilityRole="header">
            {t('map.settingsTitle')}
          </AppText>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('map.close')} style={styles.iconBtn}>
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 12, gap: 8 }}>
          <Section title={t('map.yourLocation')}>
            <View style={styles.row}>
              <Ionicons name={sharing ? 'location' : 'location-outline'} size={20} color={sharing ? colors.success : colors.muted} />
              <AppText style={{ flex: 1 }}>{sharing ? t('map.statusSharing') : t('map.statusOff')}</AppText>
            </View>
            {sharing ? (
              <>
                {(['friends', 'public'] as const).map((v) => {
                  const on = settings?.visibility === v;
                  return (
                    <Pressable
                      key={v}
                      onPress={() => !on && visibility.mutate(v)}
                      disabled={visibility.isPending}
                      style={styles.row}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on, busy: visibility.isPending }}
                    >
                      <Ionicons name={v === 'friends' ? 'people-outline' : 'earth-outline'} size={20} color={colors.text} />
                      <View style={{ flex: 1 }}>
                        <AppText>{t(`map.visibility_${v}`)}</AppText>
                        <AppText variant="small" muted>
                          {t(`map.visibility_${v}_hint`)}
                        </AppText>
                      </View>
                      <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? tint : colors.muted} />
                    </Pressable>
                  );
                })}
                <Button
                  title={t('map.stopSharing')}
                  variant="secondary"
                  onPress={confirmStop}
                  loading={stop.isPending}
                  style={{ marginBottom: 10 }}
                />
              </>
            ) : (
              <Button
                title={t('map.shareMyLocation')}
                onPress={() => {
                  onClose();
                  onTurnOn();
                }}
                style={{ marginBottom: 10 }}
              />
            )}
          </Section>

          <Section title={t('map.requestsTitle')}>
            {incoming.isLoading ? (
              <ActivityIndicator style={{ marginVertical: 14 }} color={colors.muted} />
            ) : incoming.isError ? (
              <AppText variant="small" style={{ color: colors.danger, paddingVertical: 12 }}>
                {t('map.loadFailed')}
              </AppText>
            ) : !incoming.data?.length ? (
              <AppText variant="small" muted style={{ paddingVertical: 12 }}>
                {t('map.noRequests')}
              </AppText>
            ) : (
              incoming.data.map((p) => {
                const name = p.requester?.name || p.requester?.handle || t('map.someone');
                return (
                  <View key={p.id} style={styles.row}>
                    <PersonAvatar uri={p.requester?.avatar_url} name={name} size={40} />
                    <AppText style={{ flex: 1 }} numberOfLines={2}>
                      {t('map.wantsToSee', { name })}
                    </AppText>
                    <SmallButton label={t('map.deny')} onPress={() => respond.mutate({ id: p.id, d: 'denied' })} />
                    <SmallButton label={t('map.approve')} primary onPress={() => approve(p.id, name)} />
                  </View>
                );
              })
            )}
          </Section>

          <Section title={t('map.trackingTitle')}>
            {tracked.isLoading ? (
              <ActivityIndicator style={{ marginVertical: 14 }} color={colors.muted} />
            ) : !tracked.data?.length ? (
              <AppText variant="small" muted style={{ paddingVertical: 12 }}>
                {t('map.noTracking')}
              </AppText>
            ) : (
              tracked.data.map((l) => {
                const name = l.profiles?.name || l.profiles?.handle || t('map.someone');
                return (
                  <View key={l.user_id} style={styles.row}>
                    <PersonAvatar uri={l.profiles?.avatar_url} name={name} size={40} />
                    <AppText style={{ flex: 1 }} numberOfLines={1}>
                      {name}
                    </AppText>
                    <SmallButton
                      label={t('map.stopTracking')}
                      onPress={() =>
                        Alert.alert(t('map.stopTrackingQ', { name }), undefined, [
                          { text: t('common.cancel'), style: 'cancel' },
                          { text: t('map.confirm'), style: 'destructive', onPress: () => revoke.mutate(l.user_id) },
                        ])
                      }
                    />
                  </View>
                );
              })
            )}
          </Section>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 4, marginTop: 6 }}>
      <AppText variant="small" muted style={{ fontWeight: '700' }} accessibilityRole="header">
        {title}
      </AppText>
      <View style={[styles.card, { backgroundColor: colors.bg2 }]}>{children}</View>
    </View>
  );
}

function SmallButton({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.small,
        { backgroundColor: primary ? (pressed ? colors.primaryPressed : colors.primary) : colors.bg3 },
      ]}
    >
      <AppText
        variant="small"
        style={{ fontWeight: '700', color: primary ? colors.onPrimary : colors.text }}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 0,
    maxHeight: '85%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 12, paddingBottom: 4 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 14, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 6 },
  small: { paddingHorizontal: 12, minHeight: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
