import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { Hashtag, Sound } from '@/api/sounds';
import type { UserSummary } from '@/api/types';
import type { VideoTile } from '@/api/videos';
import { formatCount } from '@/features/feed/format';
import { useTheme } from '@/providers/ThemeProvider';

import { FollowButton } from './FollowButton';
import { go, isImageUrl, soundPath, tagPath, userPath, videoPath } from './nav';
import { Avatar } from './parts';
import { makeThemed } from './themed';

export type PersonLike = UserSummary & { followers_count?: number | null };

// One person: avatar, name, @handle and a follow button. `onOpen` lets a
// caller record the tap (recent searches) before the profile opens.
export const PersonRow = memo(function PersonRow({
  person,
  onOpen,
  showFollow = true,
}: {
  person: PersonLike;
  onOpen?: (p: PersonLike) => void;
  showFollow?: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const th = useThemed();
  const display = person.name || person.handle || '';
  const meta = [
    person.handle ? `@${person.handle}` : null,
    person.followers_count != null ? t('discover.common.followers', { n: formatCount(person.followers_count) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.personRow}>
      <Pressable
        style={styles.personMain}
        onPress={() => {
          onOpen?.(person);
          go(userPath(person.id));
        }}
        accessibilityRole="button"
        accessibilityLabel={[display, meta].filter(Boolean).join(', ')}
      >
        <Avatar uri={person.avatar_url} name={display} size={48} />
        <View style={styles.personText}>
          <View style={styles.nameLine}>
            <Text style={th.name} numberOfLines={1}>
              {display}
            </Text>
            {person.verified ? <Ionicons name="checkmark-circle" size={15} color={colors.primary2} /> : null}
          </View>
          {meta ? (
            <Text style={th.meta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {showFollow ? <FollowButton userId={person.id} name={display} /> : null}
    </View>
  );
});

// Three tiles per row with a 2pt gutter, sized from the screen width.
export function useTileStyle() {
  const { width } = useWindowDimensions();
  return useMemo(() => {
    const w = Math.floor((width - GRID_GAP * 2) / 3);
    return { width: w, height: Math.round(w * 1.33) };
  }, [width]);
}

export const GRID_GAP = 2;

export const VideoTileCell = memo(function VideoTileCell({
  video,
  size,
  onOpen,
}: {
  video: VideoTile;
  size: { width: number; height: number };
  onOpen?: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const th = useThemed();
  const count = formatCount(video.views_count ?? video.likes_count);
  return (
    <Pressable
      style={[size, th.tileBg]}
      onPress={() => {
        onOpen?.();
        go(videoPath(video.id));
      }}
      accessibilityRole="button"
      accessibilityLabel={[video.description?.trim() || t('discover.common.video'), t('discover.common.plays', { n: count })].join(', ')}
    >
      {isImageUrl(video.thumbnail) ? (
        <Image source={{ uri: video.thumbnail }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={video.id} transition={120} />
      ) : (
        <View style={styles.tilePlaceholder}>
          <Ionicons name="videocam-outline" size={22} color={colors.muted2} />
        </View>
      )}
      <View style={styles.tileCount}>
        <Ionicons name="play" size={11} color="#fff" />
        <Text style={styles.tileCountText}>{count}</Text>
      </View>
    </Pressable>
  );
});

export const HashtagRow = memo(function HashtagRow({ tag, onOpen }: { tag: Hashtag; onOpen?: (tag: string) => void }) {
  const { t } = useTranslation();
  const th = useThemed();
  const count = t('discover.common.videosCount', { n: formatCount(tag.usage_count), count: Number(tag.usage_count ?? 0) });
  return (
    <Pressable
      style={styles.listRow}
      onPress={() => {
        onOpen?.(tag.tag);
        go(tagPath(tag.tag));
      }}
      accessibilityRole="button"
      accessibilityLabel={`#${tag.tag}, ${count}`}
    >
      <View style={th.roundIcon}>
        <Text style={th.hash}>#</Text>
      </View>
      <View style={styles.personText}>
        <Text style={th.title} numberOfLines={1}>
          {tag.tag}
        </Text>
        <Text style={th.meta}>{count}</Text>
      </View>
      <Chevron />
    </Pressable>
  );
});

export const SoundRow = memo(function SoundRow({ sound, onOpen }: { sound: Sound; onOpen?: () => void }) {
  const { t } = useTranslation();
  const th = useThemed();
  const uses = t('discover.sound.uses', { n: formatCount(sound.usage_count ?? 0), count: Number(sound.usage_count ?? 0) });
  return (
    <Pressable
      style={styles.listRow}
      onPress={() => {
        onOpen?.();
        go(soundPath(sound.id));
      }}
      accessibilityRole="button"
      accessibilityLabel={[sound.title, sound.author_name, uses].filter(Boolean).join(', ')}
    >
      <View style={th.cover}>
        {isImageUrl(sound.cover_url) ? (
          <Image source={{ uri: sound.cover_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : null}
        <Ionicons name="musical-notes" size={20} color="#fff" />
      </View>
      <View style={styles.personText}>
        <Text style={th.title} numberOfLines={1}>
          {sound.title || t('discover.sound.untitled')}
        </Text>
        <Text style={th.meta} numberOfLines={1}>
          {[sound.author_name, uses].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Chevron />
    </Pressable>
  );
});

// Points "forward", which is left in RTL.
export function Chevron() {
  const { colors } = useTheme();
  return <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.muted} />;
}

const useThemed = makeThemed((c) => ({
  name: [styles.name, { color: c.text }],
  title: [styles.title, { color: c.text }],
  meta: [styles.meta, { color: c.muted }],
  hash: [styles.hash, { color: c.text }],
  roundIcon: [styles.roundIcon, { backgroundColor: c.bg3 }],
  cover: [styles.cover, { backgroundColor: c.bg3 }],
  tileBg: { backgroundColor: c.bg3 },
}));

const styles = StyleSheet.create({
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  personMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  personText: { flex: 1, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  title: { fontSize: 15, fontWeight: '700', alignSelf: 'flex-start', maxWidth: '100%' },
  // Sized to its text and pinned to the start edge, so it sits on the right
  // in Arabic even when the handle itself is Latin.
  meta: { fontSize: 13, alignSelf: 'flex-start', maxWidth: '100%' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, minHeight: 64 },
  roundIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  hash: { fontSize: 22, fontWeight: '800' },
  cover: { width: 48, height: 48, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  tilePlaceholder: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' },
  tileCount: { position: 'absolute', bottom: 6, start: 6, flexDirection: 'row', alignItems: 'center', gap: 3 },
  tileCountText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 3,
  },
});
