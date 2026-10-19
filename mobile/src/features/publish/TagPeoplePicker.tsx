import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, I18nManager, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchFollowing } from '@/api/profiles';
import { normalizePeopleQuery, searchPeople } from '@/api/search';
import type { UserSummary } from '@/api/types';
import { Button } from '@/components/ui';
import { useDebouncedValue } from '@/features/discover/useDebouncedValue';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/providers/ThemeProvider';
import { atHandle } from '@/lib/handle';

// Well under the database's cap of 20 (0101), so a post never hits it.
export const MAX_TAGS = 10;

// Client note 21: who is in the video. With an empty search box it lists the
// people you follow; typing searches everyone (search_profiles, which already
// hides blocked accounts). Whether a person accepts tags is the server's
// call (who_can_tag, 0097); refusals come back after posting.
export function TagPeoplePicker({
  open,
  initial,
  onClose,
  onDone,
}: {
  open: boolean;
  initial: UserSummary[];
  onClose: () => void;
  onDone: (people: UserSummary[]) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { session } = useAuth();
  const me = session?.user.id ?? null;
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<UserSummary[]>(initial);
  const q = normalizePeopleQuery(useDebouncedValue(text, 300));

  const following = useQuery({
    queryKey: ['tagPicker', 'following', me],
    queryFn: () => fetchFollowing(me),
    enabled: open && !!me,
    staleTime: 5 * 60 * 1000,
  });
  const search = useQuery({
    queryKey: ['tagPicker', 'search', q.toLowerCase()],
    queryFn: () => searchPeople(q, 25),
    enabled: open && q.length > 0,
    staleTime: 60 * 1000,
  });

  const list = ((q ? search.data : following.data) ?? []).filter((p) => p.id !== me);
  const loading = q ? search.isFetching && !search.data : following.isLoading;
  const pickedIds = new Set(picked.map((p) => p.id));
  const full = picked.length >= MAX_TAGS;

  function toggle(p: UserSummary) {
    setPicked((cur) =>
      cur.some((x) => x.id === p.id)
        ? cur.filter((x) => x.id !== p.id)
        : cur.length >= MAX_TAGS
          ? cur
          : [...cur, { id: p.id, name: p.name, handle: p.handle, avatar_url: p.avatar_url, verified: p.verified }],
    );
  }

  function cancel() {
    setPicked(initial);
    setText('');
    onClose();
  }

  function done() {
    onDone(picked);
    setText('');
    onClose();
  }

  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={cancel} onShow={() => setPicked(initial)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        <View style={styles.head}>
          <Pressable onPress={cancel} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.cancel')}>
            <Ionicons name="close" size={26} color={colors.text} />
          </Pressable>
          <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
            {t('place.tagTitle')}
          </Text>
          <Text style={{ color: full ? colors.primary : colors.muted, fontWeight: '700', minWidth: 26, textAlign: 'right' }}>
            {t('place.tagCount', { count: picked.length, max: MAX_TAGS })}
          </Text>
        </View>

        <View style={[styles.search, { backgroundColor: colors.bg2 }]}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('place.tagSearchPlaceholder')}
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { color: colors.text, textAlign: I18nManager.isRTL ? 'right' : 'left' }]}
            accessibilityLabel={t('place.tagSearchPlaceholder')}
          />
          {loading ? <ActivityIndicator size="small" color={colors.muted} /> : null}
        </View>

        {picked.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
            {picked.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => toggle(p)}
                accessibilityRole="button"
                accessibilityLabel={t('place.removeTag', { name: p.handle ?? p.name ?? '' })}
                style={[styles.chip, { backgroundColor: colors.primarySoft }]}
              >
                <Avatar user={p} size={22} />
                <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13 }} numberOfLines={1}>
                  {atHandle(p.handle ?? p.name)}
                </Text>
                <Ionicons name="close" size={14} color={colors.muted} />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {full ? <Text style={[styles.note, { color: colors.muted }]}>{t('place.tagLimit', { max: MAX_TAGS })}</Text> : null}

        <FlatList
          data={list}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1 }}
          ListHeaderComponent={
            !q && list.length ? <Text style={[styles.section, { color: colors.muted }]}>{t('place.following')}</Text> : undefined
          }
          ListEmptyComponent={
            loading ? undefined : (
              <Text style={[styles.note, { color: colors.muted }]}>{q ? t('place.noPeople') : t('place.tagHint')}</Text>
            )
          }
          renderItem={({ item }) => {
            const on = pickedIds.has(item.id);
            const off = !on && full;
            return (
              <Pressable
                onPress={() => toggle(item)}
                disabled={off}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: off }}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bg2 }, off && { opacity: 0.45 }]}
              >
                <Avatar user={item} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '600', fontSize: 15 }} numberOfLines={1}>
                    {item.name || item.handle}
                    {item.verified ? ' ' : ''}
                    {item.verified ? <Ionicons name="checkmark-circle" size={14} color={colors.primary} /> : null}
                  </Text>
                  {item.handle ? (
                    <Text style={{ color: colors.muted, fontSize: 13 }} numberOfLines={1}>
                      {atHandle(item.handle)}
                    </Text>
                  ) : null}
                </View>
                <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={on ? colors.primary : colors.muted} />
              </Pressable>
            );
          }}
        />
        <View style={styles.foot}>
          <Button title={t('place.done')} onPress={done} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

export function Avatar({ user, size }: { user: UserSummary; size: number }) {
  const { colors } = useTheme();
  const box = { width: size, height: size, borderRadius: size / 2 };
  return user.avatar_url ? (
    <Image source={{ uri: user.avatar_url }} style={box} />
  ) : (
    <View style={[box, { backgroundColor: colors.bg3, alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: size * 0.42 }}>
        {(user.name ?? user.handle ?? '?').slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 17, fontWeight: '700' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, borderRadius: 12, minHeight: 44 },
  input: { flex: 1, fontSize: 15, paddingVertical: 10 },
  chips: { gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingStart: 4, paddingEnd: 10, paddingVertical: 4, borderRadius: 16, maxWidth: 200 },
  section: { fontSize: 13, fontWeight: '700', paddingHorizontal: 16, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  note: { fontSize: 13, paddingHorizontal: 16, paddingVertical: 10, lineHeight: 18 },
  foot: { paddingHorizontal: 16, paddingTop: 8 },
});
