import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  favoriteSound,
  fetchSound,
  fetchSoundVideos,
  isSoundFavorited,
  type Sound,
  soundKeys,
  unfavoriteSound,
} from '@/api/sounds';
import { Alert } from '@/components/Dialog';
import { Button, TopBar } from '@/components/ui';
import { formatCount } from '@/features/feed/format';
import { useTheme } from '@/providers/ThemeProvider';

import { go, isImageUrl, userPath } from './nav';
import { EmptyState, ErrorState, LoadingState } from './parts';
import { VideoGrid } from './VideoGrid';
import { atHandle } from '@/lib/handle';

// A sound: who made it, how often it is used, a favourite toggle, "Use this
// sound" (opens the camera with it), then every video that uses it.
export function SoundScreen({ soundId }: { soundId: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const sound = useQuery({ queryKey: soundKeys.sound(soundId), queryFn: () => fetchSound(soundId) });
  const videos = useQuery({ queryKey: soundKeys.soundVideos(soundId), queryFn: () => fetchSoundVideos(soundId) });

  const { refetch: refetchSound } = sound;
  const { refetch: refetchVideos } = videos;
  const onRefresh = useCallback(() => {
    void refetchSound();
    void refetchVideos();
  }, [refetchSound, refetchVideos]);

  let body;
  if (sound.isLoading) body = <LoadingState />;
  else if (sound.isError) body = <ErrorState onRetry={onRefresh} />;
  else if (!sound.data) body = <EmptyState icon="musical-notes-outline" title={t('discover.sound.notFound')} />;
  else
    body = (
      <VideoGrid
        videos={videos.data}
        header={<SoundHeader sound={sound.data} count={videos.data?.length ?? 0} />}
        loading={videos.isLoading}
        failed={videos.isError}
        refreshing={sound.isRefetching || videos.isRefetching}
        onRefresh={onRefresh}
        empty={{ icon: 'musical-notes-outline', title: t('discover.sound.empty'), sub: t('discover.sound.emptySub') }}
      />
    );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <TopBar title={t('discover.sound.title')} />
      {body}
    </SafeAreaView>
  );
}

function SoundHeader({ sound, count }: { sound: Sound; count: number }) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const uses = Math.max(Number(sound.usage_count ?? 0), count);
  const creator = sound.creator;

  return (
    <View style={styles.header}>
      <View style={styles.top}>
        <View style={[styles.cover, { backgroundColor: colors.bg3 }]}>
          {isImageUrl(sound.cover_url) ? (
            <Image source={{ uri: sound.cover_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : null}
          <Ionicons name="musical-notes" size={34} color="#fff" />
        </View>
        <View style={styles.info}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={2} accessibilityRole="header">
            {sound.title || t('discover.sound.untitled')}
          </Text>
          {creator ? (
            <Pressable
              onPress={() => go(userPath(creator.id))}
              hitSlop={6}
              accessibilityRole="link"
              style={styles.creator}
            >
              <Text style={[styles.author, { color: isDark ? colors.primary2 : colors.primary }]} numberOfLines={1}>
                {creator.name || (creator.handle ? atHandle(creator.handle) : sound.author_name)}
              </Text>
            </Pressable>
          ) : sound.author_name ? (
            <Text style={[styles.author, { color: colors.muted }]} numberOfLines={1}>
              {sound.author_name}
            </Text>
          ) : null}
          <Text style={[styles.meta, { color: colors.muted }]}>
            {t('discover.sound.uses', { n: formatCount(uses), count: Number(uses ?? 0) })}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <FavoriteButton soundId={sound.id} />
        <Button
          title={t('discover.sound.use')}
          style={styles.use}
          // The camera reads soundId to start recording over this sound.
          onPress={() => router.push({ pathname: '/camera', params: { soundId: sound.id } })}
        />
      </View>
    </View>
  );
}

function FavoriteButton({ soundId }: { soundId: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const key = soundKeys.favorited(soundId);
  const fav = useQuery({ queryKey: key, queryFn: () => isSoundFavorited(soundId) });

  const toggle = useMutation({
    mutationFn: (on: boolean) => (on ? favoriteSound(soundId) : unfavoriteSound(soundId)),
    // Flip at once; put it back if the server refuses.
    onMutate: async (on) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<boolean>(key);
      qc.setQueryData(key, on);
      return { before };
    },
    onError: (_e, _on, ctx) => {
      qc.setQueryData(key, ctx?.before ?? false);
      Alert.alert(t('discover.sound.favoriteFailed'));
    },
  });

  const on = !!fav.data;
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync().catch(() => {});
        toggle.mutate(!on);
      }}
      disabled={fav.isLoading}
      style={[styles.fav, { backgroundColor: colors.bg3 }]}
      accessibilityRole="button"
      accessibilityLabel={t(on ? 'discover.sound.unfavorite' : 'discover.sound.favorite')}
      accessibilityState={{ selected: on }}
    >
      <Ionicons name={on ? 'bookmark' : 'bookmark-outline'} size={20} color={on ? colors.warn : colors.text} />
      <Text style={[styles.favText, { color: colors.text }]}>
        {t(on ? 'discover.sound.favorited' : 'discover.sound.favorite')}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 14, gap: 14 },
  top: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  cover: { width: 96, height: 96, borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, gap: 4 },
  title: { fontSize: 19, fontWeight: '800', alignSelf: 'flex-start', maxWidth: '100%' },
  creator: { alignSelf: 'flex-start', minHeight: 28, justifyContent: 'center', maxWidth: '100%' },
  author: { fontSize: 14.5, fontWeight: '600', alignSelf: 'flex-start', maxWidth: '100%' },
  meta: { fontSize: 13, alignSelf: 'flex-start' },
  actions: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  fav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 46,
    paddingHorizontal: 16,
    borderRadius: 23,
  },
  favText: { fontSize: 14.5, fontWeight: '700' },
  use: { flex: 1, height: 46, marginVertical: 0 },
});
