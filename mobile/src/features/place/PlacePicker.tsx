import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  I18nManager,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Alert } from '@/components/Dialog';
import type { VideoPlace } from '@/api/videos';
import { useDebouncedValue } from '@/features/discover/useDebouncedValue';
import { useTheme } from '@/providers/ThemeProvider';

import { describeAddress, placeLabel, toVideoPlace } from './placeName';

type Candidate = { key: string; title: string; subtitle: string; lat: number; lng: number };

const placeKeys = {
  here: ['place', 'here'] as const,
  search: (q: string) => ['place', 'search', q] as const,
};

// Reverse geocodes one point. Never throws: a point with no address just
// has no name.
async function nameOf(lat: number, lng: number) {
  try {
    const [a] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    return a ? describeAddress(a) : null;
  } catch {
    return null;
  }
}

// Where the phone is, as a named place. A recent last-known fix is enough for
// a place name (and much faster); otherwise one balanced-accuracy fix.
async function locateHere(): Promise<Candidate> {
  let pos = await Location.getLastKnownPositionAsync({ maxAge: 2 * 60 * 1000, requiredAccuracy: 500 });
  if (!pos) pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const { latitude, longitude } = pos.coords;
  const named = await nameOf(latitude, longitude);
  if (!named) throw new Error('no_address');
  return { key: 'here', ...named, lat: latitude, lng: longitude };
}

// Free text to places, with the platform geocoder (no paid Places API). The
// geocoder answers coordinates; each is named by reverse geocoding, one at a
// time because iOS's geocoder refuses overlapping requests.
async function searchPlaces(q: string): Promise<Candidate[]> {
  const hits = (await Location.geocodeAsync(q)).slice(0, 4);
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    const named = await nameOf(h.latitude, h.longitude);
    if (!named) continue;
    const key = `${named.title}|${named.subtitle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, ...named, lat: h.latitude, lng: h.longitude });
  }
  // Nothing nameable: still offer the raw hits under the typed text.
  if (!out.length && hits[0]) out.push({ key: 'raw', title: q, subtitle: '', lat: hits[0].latitude, lng: hits[0].longitude });
  return out;
}

// Client note 21: choose a place for a post. "Current location" names where
// the phone is; the search box geocodes typed text. Whatever is chosen is
// saved with its coordinates rounded to ~100 m (placeName.ts), never the raw
// GPS fix.
export function PlacePicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (place: VideoPlace) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [perm, requestPerm] = Location.useForegroundPermissions();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const query = useDebouncedValue(text.trim(), 700);
  const granted = !!perm?.granted;
  // Android's geocoder needs the location permission; iOS's does not.
  const canSearch = Platform.OS === 'ios' || granted;

  // Asked once on opening: the person tapped "Add location", so this is the
  // moment the permission makes sense.
  useEffect(() => {
    if (open && perm && !perm.granted && perm.canAskAgain && perm.status === 'undetermined') void requestPerm();
  }, [open, perm, requestPerm]);

  const here = useQuery({
    queryKey: placeKeys.here,
    queryFn: locateHere,
    enabled: open && granted,
    staleTime: 2 * 60 * 1000,
    retry: false,
  });

  const results = useQuery({
    queryKey: placeKeys.search(query.toLowerCase()),
    queryFn: () => searchPlaces(query),
    enabled: open && canSearch && query.length >= 3,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  function close() {
    setText('');
    onClose();
  }

  function pick(c: Candidate, name = placeLabel(c.title, c.subtitle.split(',')[0])) {
    onPick(toVideoPlace(name, c.lat, c.lng));
    close();
  }

  async function chooseHere() {
    if (busy) return;
    let p = perm;
    if (!p?.granted) {
      p = await requestPerm();
      if (!p.granted) {
        Alert.alert(t('place.permissionTitle'), t('place.permissionDenied'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('place.openSettings'), onPress: () => void Linking.openSettings() },
        ]);
        return;
      }
    }
    setBusy(true);
    try {
      pick(await qc.fetchQuery({ queryKey: placeKeys.here, queryFn: locateHere, staleTime: 2 * 60 * 1000 }));
    } catch {
      Alert.alert(t('place.locateFailed'));
    } finally {
      setBusy(false);
    }
  }

  const typed = query.length >= 3 ? query : '';
  const first = results.data?.[0];
  const searching = typed && results.isFetching;

  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        <View style={styles.head}>
          <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.cancel')}>
            <Ionicons name="close" size={26} color={colors.text} />
          </Pressable>
          <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
            {t('place.pickerTitle')}
          </Text>
          <View style={{ width: 26 }} />
        </View>

        <View style={[styles.search, { backgroundColor: colors.bg2 }]}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('place.searchPlaceholder')}
            placeholderTextColor={colors.muted}
            autoCorrect={false}
            returnKeyType="search"
            editable={canSearch}
            style={[styles.input, { color: colors.text, textAlign: I18nManager.isRTL ? 'right' : 'left' }]}
            accessibilityLabel={t('place.searchPlaceholder')}
          />
          {searching ? <ActivityIndicator size="small" color={colors.muted} /> : null}
          {text ? (
            <Pressable onPress={() => setText('')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('place.clear')}>
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>

        <FlatList
          data={typed ? (results.data ?? []) : []}
          keyExtractor={(c) => c.key}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 24 }}
          ListHeaderComponent={
            <View>
              {!typed ? (
                <Row
                  icon="navigate"
                  tint={colors.primary}
                  title={t('place.currentLocation')}
                  subtitle={
                    here.data
                      ? placeLabel(here.data.title, here.data.subtitle.split(',')[0])
                      : here.isFetching
                        ? t('place.locating')
                        : granted
                          ? ''
                          : t('place.allowHint')
                  }
                  busy={busy}
                  onPress={chooseHere}
                />
              ) : null}
              {typed && first ? (
                <Row
                  icon="create-outline"
                  title={t('place.useTyped', { name: typed })}
                  subtitle={first.subtitle.split(',')[0] || first.title}
                  onPress={() => pick(first, placeLabel(typed, first.subtitle.split(',')[0] || null))}
                />
              ) : null}
              {!canSearch && perm && !perm.granted ? (
                <Text style={[styles.note, { color: colors.muted }]}>{t('place.searchNeedsPermission')}</Text>
              ) : null}
            </View>
          }
          renderItem={({ item }) => <Row icon="location-outline" title={item.title} subtitle={item.subtitle} onPress={() => pick(item)} />}
          ListEmptyComponent={
            typed && !results.isFetching && (results.isSuccess || results.isError) ? (
              <Text style={[styles.note, { color: colors.muted }]}>
                {results.isError ? t('place.searchFailed') : t('place.noResults')}
              </Text>
            ) : undefined
          }
          ListFooterComponent={<Text style={[styles.note, { color: colors.muted }]}>{t('place.privacyHint')}</Text>}
        />
      </SafeAreaView>
    </Modal>
  );
}

function Row({
  icon,
  tint,
  title,
  subtitle,
  busy,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint?: string;
  title: string;
  subtitle?: string;
  busy?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bg2 }]}
    >
      <View style={[styles.rowIcon, { backgroundColor: colors.bg2 }]}>
        <Ionicons name={icon} size={18} color={tint ?? colors.text} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ color: colors.muted, fontSize: 13 }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {busy ? <ActivityIndicator size="small" color={colors.muted} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 17, fontWeight: '700' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, borderRadius: 12, minHeight: 44 },
  input: { flex: 1, fontSize: 15, paddingVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, minHeight: 56 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  note: { fontSize: 13, paddingHorizontal: 16, paddingVertical: 12, lineHeight: 18 },
});
