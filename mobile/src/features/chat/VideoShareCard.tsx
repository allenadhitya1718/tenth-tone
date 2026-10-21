import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, type AccessibilityActionEvent, type AccessibilityActionInfo, Pressable, StyleSheet, Text, View } from 'react-native';

import { fetchSharedVideo, parseVideoShare, sharedVideoKey } from '@/api/videoShare';
import { atHandle } from '@/lib/handle';
import { useTheme } from '@/providers/ThemeProvider';

import { Avatar } from './Avatar';

// The card a 'video_share' message draws (0146): the thumbnail with a play
// icon, the creator's photo and handle, and the caption's first line. Tap
// opens the video in the app. A video the viewer cannot see (deleted,
// hidden, private) is "Video unavailable", never a blank box.
export const VideoShareCard = memo(function VideoShareCard({
  url,
  fg,
  sub,
  a11yPrefix,
  actions,
  onAction,
  onLongPress,
}: {
  url: string | null;
  fg: string;
  sub: string;
  // Who sent it, when, its ticks: read before the card itself.
  a11yPrefix: string;
  actions: AccessibilityActionInfo[];
  onAction: (e: AccessibilityActionEvent) => void;
  onLongPress: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const id = parseVideoShare(url);
  const video = useQuery({
    queryKey: sharedVideoKey(id ?? ''),
    queryFn: () => fetchSharedVideo(id!),
    enabled: !!id,
    staleTime: 5 * 60_000,
  });

  const v = video.data;
  const unavailable = !id || video.data === null;
  const handle = v?.user?.handle ? atHandle(v.user.handle) : v?.user?.name ?? '';
  const caption = (v?.description ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const isImage = !!v?.thumbnail && !/\.(mp4|mov|webm)(\?|$)/i.test(v.thumbnail);

  const label = unavailable
    ? t('sendTo.unavailable')
    : v
      ? caption
        ? t('sendTo.cardA11y', { handle, caption })
        : t('sendTo.cardA11yPlain', { handle })
      : video.isError
        ? t('sendTo.cardError')
        : t('sendTo.loadingVideo');

  const open = () => {
    if (v) router.push(`/video/${v.id}`);
    else if (video.isError) void video.refetch();
  };

  return (
    <Pressable
      onPress={open}
      onLongPress={onLongPress}
      delayLongPress={300}
      style={styles.card}
      accessibilityRole={v ? 'link' : 'button'}
      accessibilityLabel={`${a11yPrefix}, ${t('sendTo.sharedVideo')}: ${label}`}
      accessibilityHint={v ? t('sendTo.openHint') : video.isError ? t('sendTo.retry') : undefined}
      accessibilityActions={actions}
      onAccessibilityAction={onAction}
    >
      {unavailable ? (
        <View style={[styles.unavailable, { backgroundColor: colors.bg3 }]}>
          <Ionicons name="videocam-off-outline" size={28} color={colors.muted} />
          <Text style={[styles.unavailableTitle, { color: colors.text }]}>{t('sendTo.unavailable')}</Text>
          <Text style={[styles.unavailableBody, { color: colors.muted }]}>{t('sendTo.unavailableBody')}</Text>
        </View>
      ) : (
        <View style={[styles.thumb, { backgroundColor: '#111' }]}>
          {isImage ? (
            <Image source={{ uri: v!.thumbnail! }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} recyclingKey={v!.id} accessible={false} />
          ) : null}
          {!v ? (
            video.isError ? (
              <View style={styles.centerFill}>
                <Ionicons name="refresh" size={26} color="#fff" />
                <Text style={styles.errorText}>{t('sendTo.cardError')}</Text>
              </View>
            ) : (
              <ActivityIndicator style={styles.centerFill} color="#fff" />
            )
          ) : (
            <>
              <View style={styles.who}>
                <Avatar uri={v.user?.avatar_url} name={v.user?.name || v.user?.handle} size={24} />
                <Text style={styles.handle} numberOfLines={1}>
                  {handle}
                </Text>
              </View>
              <View style={styles.play} pointerEvents="none">
                <Ionicons name="play" size={30} color="#fff" style={styles.playIcon} />
              </View>
            </>
          )}
        </View>
      )}
      {v && caption ? (
        <Text style={[styles.caption, { color: fg }]} numberOfLines={1}>
          {caption}
        </Text>
      ) : v ? (
        <Text style={[styles.caption, { color: sub }]} numberOfLines={1}>
          {t('sendTo.sharedVideo')}
        </Text>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  // Same frame as a photo or GIF in the bubble (MessageBubble mediaClip).
  card: { width: 220 },
  thumb: { width: 220, height: 300, borderRadius: 15, overflow: 'hidden' },
  centerFill: { ...(StyleSheet.absoluteFill as object), alignItems: 'center', justifyContent: 'center', gap: 6 },
  errorText: { color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center', paddingHorizontal: 12 },
  who: {
    position: 'absolute',
    top: 8,
    start: 8,
    end: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  handle: {
    flexShrink: 1,
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowRadius: 4,
  },
  play: {
    position: 'absolute',
    top: '50%',
    alignSelf: 'center',
    marginTop: -28,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The triangle points right in every language; nudged to look centred.
  playIcon: { marginLeft: 3 },
  caption: { fontSize: 14, marginTop: 4, paddingHorizontal: 8, textAlign: 'left', writingDirection: 'auto' },
  unavailable: { width: 220, height: 120, borderRadius: 15, alignItems: 'center', justifyContent: 'center', gap: 4, padding: 12 },
  unavailableTitle: { fontSize: 14, fontWeight: '700' },
  unavailableBody: { fontSize: 12.5, textAlign: 'center' },
});
