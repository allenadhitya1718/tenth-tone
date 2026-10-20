import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  I18nManager,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { fetchProfile, profileKeys, updateProfile, uploadAvatar, type Profile, type ProfilePatch } from '@/api/profiles';
import { fetchMyPrivateDetails, saveMyPrivateDetails, settingsKeys, type Gender } from '@/api/settings';
import type { LocalMedia } from '@/api/upload';
import { showAlert } from '@/components/Dialog';
import { AppText, Screen, TopBar } from '@/components/ui';
import { cleanHandle, useHandleCheck } from '@/hooks/useHandleCheck';
import { HANDLE_RE } from '@/lib/auth';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/providers/ThemeProvider';

import { countryNameFor } from '@/lib/countryNames';

import { pickAvatar } from './avatarImage';
import { Avatar, confirm, ErrorView, errorText, Group, InlineError, LoadingView, pgCode, RadioRow, Row } from './components';

const LIMITS = { name: 50, handle: 30, bio: 150, link: 200 } as const;
const GENDERS: Gender[] = ['male', 'female', 'other', 'undisclosed'];
// Same list as the web app; names come from src/lib/countryNames.ts.
const COUNTRY_CODES = [
  'SA', 'AE', 'EG', 'QA', 'KW', 'BH', 'OM', 'JO', 'LB', 'IQ', 'SY', 'YE', 'PS', 'SD', 'LY', 'TN', 'DZ', 'MA', 'MR', 'SO', 'DJ', 'KM',
  'TR', 'IR', 'PK', 'IN', 'BD', 'ID', 'MY', 'SG', 'PH', 'TH', 'VN', 'CN', 'JP', 'KR',
  'GB', 'IE', 'FR', 'DE', 'ES', 'IT', 'PT', 'NL', 'BE', 'SE', 'NO', 'DK', 'FI', 'PL', 'RO', 'GR', 'CH', 'AT', 'CZ', 'HU', 'UA', 'RU',
  'US', 'CA', 'MX', 'BR', 'AR', 'CL', 'CO', 'PE',
  'AU', 'NZ', 'ZA', 'NG', 'KE', 'ET', 'GH', 'TZ', 'UG',
];

// Hermes has no Intl.DisplayNames, so the names come from a shipped table.
function countryName(code: string, lang: string) {
  return countryNameFor(code, lang.split('-')[0]);
}

type Form = { name: string; handle: string; bio: string; link: string; gender: Gender | ''; country: string };

const fromProfile = (p: Profile | null, gender: Gender | null, country: string | null): Form => ({
  name: p?.name ?? '',
  handle: (p?.handle ?? '').replace(/^@/, ''),
  bio: p?.bio ?? '',
  link: p?.link ?? '',
  gender: gender ?? '',
  country: country ?? '',
});

export function EditProfile() {
  const myId = useAuth().session?.user.id ?? null;
  const profile = useQuery({ queryKey: profileKeys.profile(myId ?? ''), queryFn: () => fetchProfile(myId), enabled: !!myId });
  const priv = useQuery({ queryKey: settingsKeys.privateDetails(), queryFn: fetchMyPrivateDetails });
  const { t } = useTranslation();

  if (profile.isLoading || priv.isLoading) {
    return (
      <Screen header={<TopBar title={t('profile.edit')} />}>
        <LoadingView />
      </Screen>
    );
  }
  // Never show the form on top of a failed load: saving it would overwrite
  // the real name and handle with blanks.
  if (profile.isError || !profile.data || !myId) {
    return (
      <Screen header={<TopBar title={t('profile.edit')} />}>
        <ErrorView onRetry={() => profile.refetch()} />
      </Screen>
    );
  }
  return (
    <EditForm
      myId={myId}
      profile={profile.data}
      baseline={fromProfile(profile.data, priv.data?.gender ?? null, priv.data?.country ?? null)}
    />
  );
}

function EditForm({ myId, profile, baseline }: { myId: string; profile: Profile; baseline: Form }) {
  const { t, i18n } = useTranslation();
  const { colors, isDark } = useTheme();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(baseline);
  const [avatar, setAvatar] = useState<LocalMedia | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<'gender' | 'country' | null>(null);

  const set = (k: keyof Form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setError(null);
  };

  const handleChanged = form.handle !== baseline.handle;
  const handleState = useHandleCheck(handleChanged ? form.handle : '');
  const handleBad = !HANDLE_RE.test(form.handle);
  const dirty =
    !!avatar || removeAvatar || (Object.keys(form) as (keyof Form)[]).some((k) => form[k] !== baseline[k]);
  const canSave =
    dirty && !saving && !!form.name.trim() && !handleBad && (!handleChanged || handleState === 'free');

  // Leaving with unsaved edits asks first, for the back button, the Android
  // back key and (by turning it off while dirty) the iOS swipe.
  const leave = async () => {
    if (!dirty || saving) return router.back();
    const yes = await confirm({
      title: t('settings2.edit.discardTitle'),
      message: t('settings2.edit.discardBody'),
      confirmLabel: t('settings2.edit.discard'),
      cancelLabel: t('settings2.edit.keepEditing'),
      destructive: true,
    });
    if (yes) router.back();
  };
  useEffect(() => {
    if (!dirty) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      leave();
      return true;
    });
    return () => sub.remove();
  });

  async function choosePhoto() {
    const options: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [
      { text: t('settings2.edit.fromLibrary'), onPress: () => pick('library') },
      { text: t('settings2.edit.takePhoto'), onPress: () => pick('camera') },
    ];
    if ((profile.avatar_url && !removeAvatar) || avatar) {
      options.push({
        text: t('settings2.edit.removePhoto'),
        style: 'destructive',
        onPress: () => {
          setAvatar(null);
          setRemoveAvatar(true);
        },
      });
    }
    options.push({ text: t('common.cancel'), style: 'cancel' });
    showAlert(t('settings2.edit.changePhoto'), undefined, options);
  }

  async function pick(source: 'library' | 'camera') {
    setPicking(true);
    try {
      const r = await pickAvatar(source);
      if (!r) return;
      if ('denied' in r) {
        showAlert(t('settings2.edit.cameraDeniedTitle'), t('settings2.edit.cameraDenied'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('settings2.edit.openSettings'), onPress: () => Linking.openSettings().catch(() => {}) },
        ]);
        return;
      }
      setAvatar(r.media);
      setRemoveAvatar(false);
      setError(null);
    } catch (e) {
      setError(errorText(e, t, 'settings2.edit.photoFailed'));
    } finally {
      setPicking(false);
    }
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const fields: ProfilePatch = {
        name: form.name.trim().slice(0, LIMITS.name),
        handle: form.handle.slice(0, LIMITS.handle),
        bio: form.bio.trim().slice(0, LIMITS.bio),
        link: form.link.trim().slice(0, LIMITS.link) || null,
      };
      if (avatar) {
        try {
          fields.avatar_url = await uploadAvatar(avatar);
        } catch (e) {
          if (e instanceof ApiError && e.code === 'content_blocked') {
            setError(e.message && e.message !== 'content_blocked' ? e.message : t('settings2.edit.photoBlocked'));
            return;
          }
          throw e;
        }
      } else if (removeAvatar) {
        fields.avatar_url = null;
      }
      const saved = await updateProfile(myId, fields);
      qc.setQueryData(profileKeys.profile(myId), saved);
      if (form.gender !== baseline.gender || form.country !== baseline.country) {
        await saveMyPrivateDetails({ gender: form.gender || null, country: form.country || null });
        qc.invalidateQueries({ queryKey: settingsKeys.privateDetails() });
      }
      qc.invalidateQueries({ queryKey: profileKeys.all });
      qc.invalidateQueries({ queryKey: settingsKeys.mySettings() });
      router.back();
    } catch (e) {
      if (pgCode(e) === '23505') setError(t('register.handleTakenPick'));
      else setError(errorText(e, t, 'settings2.edit.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const tone = isDark ? colors.primary2 : colors.primary;
  const shownAvatar = avatar?.uri ?? (removeAvatar ? null : profile.avatar_url);
  const handleNote =
    !handleChanged || !form.handle
      ? null
      : form.handle.length < 3
        ? { text: t('register.handleShort'), color: colors.danger }
        : handleBad
          ? { text: t('register.handleRule'), color: colors.danger }
          : handleState === 'checking'
            ? { text: t('register.handleChecking'), color: colors.muted }
            : handleState === 'taken'
              ? { text: t('register.handleTaken'), color: colors.danger }
              : { text: t('register.handleFree'), color: colors.success };

  const saveBtn = (
    <Pressable
      onPress={save}
      disabled={!canSave}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={t('common.save')}
      accessibilityState={{ disabled: !canSave, busy: saving }}
    >
      {saving ? (
        <ActivityIndicator color={tone} />
      ) : (
        <Text style={{ color: canSave ? tone : colors.muted2, fontWeight: '700', fontSize: 16 }}>{t('common.save')}</Text>
      )}
    </Pressable>
  );

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: !dirty }} />
      <Screen header={<TopBar title={t('profile.edit')} onBack={leave} right={saveBtn} />} contentStyle={styles.content}>
        <View style={styles.photo}>
          <Pressable
            onPress={choosePhoto}
            disabled={picking || saving}
            accessibilityRole="button"
            accessibilityLabel={t('settings2.edit.changePhoto')}
          >
            <Avatar uri={shownAvatar} name={form.name || form.handle} size={96} />
            <View style={[styles.cam, { backgroundColor: colors.primary, borderColor: colors.bg }]}>
              {picking ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Ionicons name="camera" size={16} color={colors.onPrimary} />}
            </View>
          </Pressable>
          <Text onPress={choosePhoto} style={{ color: tone, fontWeight: '700', marginTop: 10 }} accessibilityRole="button">
            {t('settings2.edit.changePhoto')}
          </Text>
        </View>

        <AppText variant="small" muted style={styles.section} accessibilityRole="header">
          {t('settings2.edit.profileSection')}
        </AppText>
        <Field label={t('register.name')} value={form.name} max={LIMITS.name} onChangeText={(v) => set('name', v)} autoComplete="name" />
        <Field
          label={t('register.handle')}
          value={form.handle}
          max={LIMITS.handle}
          prefix="@"
          onChangeText={(v) => set('handle', cleanHandle(v))}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          note={handleNote}
        />
        <Field label={t('settings2.edit.bio')} value={form.bio} max={LIMITS.bio} multiline onChangeText={(v) => set('bio', v)} />
        <Field
          label={t('settings2.edit.link')}
          value={form.link}
          max={LIMITS.link}
          placeholder="yoursite.com"
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={(v) => set('link', v)}
        />

        <Group title={t('settings2.edit.privateSection')} footer={t('settings2.edit.privateNote')}>
          <Row
            icon="person-circle-outline"
            label={t('settings2.edit.gender')}
            value={form.gender ? t(`settings2.edit.gender_${form.gender}`) : t('settings2.edit.choose')}
            onPress={() => setPicker('gender')}
          />
          <Row
            icon="flag-outline"
            label={t('settings2.edit.country')}
            value={form.country ? countryName(form.country, i18n.language) : t('settings2.edit.choose')}
            onPress={() => setPicker('country')}
          />
        </Group>

        <InlineError text={error} />
      </Screen>

      <ChoiceSheet
        visible={picker === 'gender'}
        title={t('settings2.edit.gender')}
        options={GENDERS.map((g) => ({ value: g, label: t(`settings2.edit.gender_${g}`) }))}
        selected={form.gender}
        onSelect={(v) => set('gender', v)}
        onClose={() => setPicker(null)}
      />
      <CountrySheet
        visible={picker === 'country'}
        selected={form.country}
        onSelect={(v) => set('country', v)}
        onClose={() => setPicker(null)}
      />
    </>
  );
}

function Field({
  label,
  max,
  prefix,
  note,
  multiline,
  ...rest
}: TextInputProps & {
  label: string;
  max: number;
  prefix?: string;
  note?: { text: string; color: string } | null;
}) {
  const { colors } = useTheme();
  const len = String(rest.value ?? '').length;
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={styles.labelRow}>
        <AppText variant="small" style={{ fontWeight: '700' }}>
          {label}
        </AppText>
        <Text style={{ color: colors.muted, fontSize: 12 }} accessibilityLabel={`${len} / ${max}`}>
          {len}/{max}
        </Text>
      </View>
      <View
        style={[
          styles.inputBox,
          { backgroundColor: colors.bg2, borderColor: colors.border },
          multiline && { height: undefined, minHeight: 92, alignItems: 'flex-start', paddingVertical: 10 },
        ]}
      >
        {prefix ? <Text style={{ color: colors.muted, fontSize: 16, marginEnd: 2 }}>{prefix}</Text> : null}
        <TextInput
          {...rest}
          multiline={multiline}
          maxLength={max}
          accessibilityLabel={label}
          placeholderTextColor={colors.muted}
          style={[
            styles.input,
            { color: colors.text, textAlign: I18nManager.isRTL ? 'right' : 'left' },
            multiline && { textAlignVertical: 'top', minHeight: 72 },
          ]}
        />
      </View>
      {note ? (
        <Text style={{ color: note.color, fontSize: 12.5, marginTop: 6 }} accessibilityLiveRegion="polite">
          {note.text}
        </Text>
      ) : null}
    </View>
  );
}

function SheetFrame({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        <View style={[styles.sheetBar, { borderBottomColor: colors.border }]}>
          <AppText variant="label" accessibilityRole="header">
            {title}
          </AppText>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
            <Text style={{ color: isDark ? colors.primary2 : colors.primary, fontWeight: '700' }}>{t('settings2.common.done')}</Text>
          </Pressable>
        </View>
        {children}
      </SafeAreaView>
    </Modal>
  );
}

function ChoiceSheet<V extends string>({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: { value: V; label: string }[];
  selected: string;
  onSelect: (v: V) => void;
  onClose: () => void;
}) {
  return (
    <SheetFrame visible={visible} title={title} onClose={onClose}>
      <View style={{ paddingHorizontal: 16 }} accessibilityRole="radiogroup">
        <Group>
          {options.map((o) => (
            <RadioRow
              key={o.value}
              label={o.label}
              selected={selected === o.value}
              onPress={() => {
                onSelect(o.value);
                onClose();
              }}
            />
          ))}
        </Group>
      </View>
    </SheetFrame>
  );
}

function CountrySheet({
  visible,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selected: string;
  onSelect: (v: string) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const [q, setQ] = useState('');
  const lang = i18n.language;
  const all = useMemo(
    () =>
      COUNTRY_CODES.map((code) => ({ code, name: countryName(code, lang) })).sort((a, b) =>
        a.name.localeCompare(b.name, lang),
      ),
    [lang],
  );
  const needle = q.trim().toLowerCase();
  const shown = needle ? all.filter((c) => c.name.toLowerCase().includes(needle) || c.code.toLowerCase() === needle) : all;

  return (
    <SheetFrame visible={visible} title={t('settings2.edit.country')} onClose={onClose}>
      <View style={{ padding: 16, paddingBottom: 6 }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={t('settings2.edit.searchCountry')}
          accessibilityLabel={t('settings2.edit.searchCountry')}
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          style={[
            styles.inputBox,
            styles.input,
            { color: colors.text, backgroundColor: colors.bg2, borderColor: colors.border, textAlign: I18nManager.isRTL ? 'right' : 'left' },
          ]}
        />
      </View>
      <FlatList
        data={shown}
        keyExtractor={(c) => c.code}
        keyboardShouldPersistTaps="handled"
        accessibilityRole="radiogroup"
        ListHeaderComponent={
          selected ? (
            <RadioRow
              label={t('settings2.edit.clearCountry')}
              selected={false}
              onPress={() => {
                onSelect('');
                onClose();
              }}
            />
          ) : undefined
        }
        renderItem={({ item }) => (
          <RadioRow
            label={item.name}
            selected={item.code === selected}
            onPress={() => {
              onSelect(item.code);
              onClose();
            }}
          />
        )}
      />
    </SheetFrame>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  photo: { alignItems: 'center', marginTop: 8, marginBottom: 6 },
  cam: {
    position: 'absolute',
    bottom: 0,
    end: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { fontWeight: '700', marginTop: 18, marginBottom: 10, marginHorizontal: 4, textAlign: 'left' },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, marginHorizontal: 4 },
  inputBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, height: 52 },
  input: { flex: 1, fontSize: 16 },
  sheetBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 54,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
