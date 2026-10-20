import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { liveKeys, startLive, uploadLiveThumbnail, type LivePrivacy } from '@/api/live';
import type { LocalMedia } from '@/api/upload';
import { showAlert } from '@/components/Dialog';
import { AppText, Button, ErrorBox, Screen, TextField, TopBar, type ErrorMsg } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';

import { MAX_TITLE } from './config';
import { errorCode, liveError, serverDetail } from './errors';

// Go live (client note 4): audio only, so there is no camera and no camera
// choice at all. A title, an optional cover photo (shown blurred behind the
// stage and on the live list) and who may join. Port of V.liveStart without
// the camera half.

const PRIVACY: { key: LivePrivacy; icon: ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'public', icon: 'earth-outline' },
  { key: 'friends', icon: 'people-outline' },
  { key: 'private', icon: 'lock-closed-outline' },
];

async function ensureMic(): Promise<'granted' | 'denied' | 'blocked'> {
  try {
    const now = await getRecordingPermissionsAsync();
    if (now.granted) return 'granted';
    if (!now.canAskAgain) return 'blocked';
    return (await requestRecordingPermissionsAsync()).granted ? 'granted' : 'denied';
  } catch {
    return 'granted';
  }
}

export function GoLive() {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [cover, setCover] = useState<LocalMedia | null>(null);
  const [privacy, setPrivacy] = useState<LivePrivacy>('public');
  const [busy, setBusy] = useState<null | 'cover' | 'start'>(null);
  const [error, setError] = useState<ErrorMsg>(null);
  const [detail, setDetail] = useState<string | undefined>();
  const tint = isDark ? colors.primary2 : colors.primary;

  async function pickCover() {
    setError(null);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.8,
      });
      if (res.canceled || !res.assets[0]) return;
      const a = res.assets[0];
      setCover({ uri: a.uri, mimeType: a.mimeType ?? 'image/jpeg', size: a.fileSize ?? null, name: a.fileName ?? null });
    } catch {
      setError({ key: 'live.go.pickFailed' });
    }
  }

  async function start() {
    if (busy) return;
    setError(null);
    setDetail(undefined);

    // A live is nothing but your voice: ask for the microphone before the
    // stream exists, so nobody goes live silent.
    const mic = await ensureMic();
    if (mic !== 'granted') {
      showAlert(t('live.go.micTitle'), t('live.go.micBody'), [
        { text: t('live.cancel'), style: 'cancel' },
        { text: t('live.openSettings'), onPress: () => void Linking.openSettings() },
      ]);
      return;
    }

    let thumbnail: string | null = null;
    if (cover) {
      setBusy('cover');
      try {
        thumbnail = await uploadLiveThumbnail(cover);
      } catch (e) {
        // Refused by screening: the cover goes, the person decides again.
        setBusy(null);
        setCover(null);
        setError({ key: errorCode(e) === 'content_blocked' ? 'live.go.coverRefused' : 'live.go.coverFailed' });
        setDetail(serverDetail(e));
        return;
      }
    }

    setBusy('start');
    try {
      const row = await startLive({ title: title.trim() || null, thumbnail, privacy });
      void qc.invalidateQueries({ queryKey: liveKeys.list() });
      router.replace({ pathname: '/live/[id]', params: { id: row.id, host: '1' } });
    } catch (e) {
      setError(liveError(e, 'live.go.startFailed'));
      setDetail(serverDetail(e));
      setBusy(null);
    }
  }

  return (
    <Screen header={<TopBar title={t('live.go.title')} />}>
      <View style={[styles.hero, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name="mic" size={28} color={tint} />
        <View style={{ flex: 1 }}>
          <AppText variant="label">{t('live.go.audioOnly')}</AppText>
          <AppText variant="small" muted>
            {t('live.go.audioOnlySub')}
          </AppText>
        </View>
      </View>

      <AppText variant="label" style={styles.label}>
        {t('live.go.titleLabel')}
      </AppText>
      <TextField
        value={title}
        onChangeText={(v) => setTitle(v.slice(0, MAX_TITLE))}
        placeholder={t('live.go.titlePlaceholder')}
        maxLength={MAX_TITLE}
        returnKeyType="done"
        accessibilityLabel={t('live.go.titleLabel')}
      />
      <AppText variant="small" muted style={styles.counter}>
        {t('live.go.counter', { n: title.length, max: MAX_TITLE })}
      </AppText>

      <AppText variant="label" style={styles.label}>
        {t('live.go.coverLabel')}
      </AppText>
      <View style={styles.coverRow}>
        <Pressable
          onPress={() => void pickCover()}
          style={[styles.cover, { backgroundColor: colors.bg2, borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel={cover ? t('live.go.coverChange') : t('live.go.coverAdd')}
        >
          {cover ? (
            <Image source={{ uri: cover.uri }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />
          ) : (
            <Ionicons name="image-outline" size={30} color={colors.muted} />
          )}
        </Pressable>
        <View style={{ flex: 1, gap: 6 }}>
          <AppText variant="small" muted>
            {t('live.go.coverHint')}
          </AppText>
          <Button
            title={cover ? t('live.go.coverChange') : t('live.go.coverAdd')}
            variant="secondary"
            onPress={() => void pickCover()}
            style={styles.smallBtn}
          />
          {cover ? <Button title={t('live.go.coverRemove')} variant="ghost" onPress={() => setCover(null)} style={styles.smallBtn} /> : null}
        </View>
      </View>

      <AppText variant="label" style={styles.label}>
        {t('live.go.audience')}
      </AppText>
      <View style={styles.privacy} accessibilityRole="radiogroup">
        {PRIVACY.map((p) => {
          const on = p.key === privacy;
          return (
            <Pressable
              key={p.key}
              onPress={() => setPrivacy(p.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityHint={t(`live.go.privacy.${p.key}Sub`)}
              style={[
                styles.privacyBtn,
                { borderColor: on ? tint : colors.border, backgroundColor: on ? colors.primarySoft : colors.bg },
              ]}
            >
              <Ionicons name={p.icon} size={22} color={on ? tint : colors.muted} />
              <Text style={[styles.privacyText, { color: on ? tint : colors.text }]}>{t(`live.go.privacy.${p.key}`)}</Text>
            </Pressable>
          );
        })}
      </View>
      <AppText variant="small" muted style={{ marginBottom: 18 }}>
        {t(`live.go.privacy.${privacy}Sub`)}
      </AppText>

      <ErrorBox error={error} />
      {detail ? (
        <AppText variant="small" muted style={{ marginTop: -6, marginBottom: 12 }}>
          {detail}
        </AppText>
      ) : null}

      <Button
        title={busy === 'cover' ? t('live.go.uploading') : busy === 'start' ? t('live.go.starting') : t('live.go.start')}
        onPress={() => void start()}
        loading={!!busy}
      />
      <AppText variant="small" muted center style={{ marginTop: 8 }}>
        {t('live.go.rules')}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 16, marginBottom: 20 },
  label: { marginBottom: 8 },
  counter: { marginTop: -6, marginBottom: 16, alignSelf: 'flex-end' },
  coverRow: { flexDirection: 'row', gap: 14, marginBottom: 20, alignItems: 'center' },
  cover: { width: 96, height: 128, borderRadius: 14, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  smallBtn: { height: 42, marginVertical: 0 },
  privacy: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  privacyBtn: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 14, borderWidth: 1.5, minHeight: 44 },
  privacyText: { fontSize: 13, fontWeight: '700' },
});
