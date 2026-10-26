import { Ionicons } from '@expo/vector-icons';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { UserSummary } from '@/api/types';

import { agoraUidFor, MAX_GUESTS } from './config';
import { Avatar } from './Sheet';
import { useIsSpeaking, type SpeakingStore } from './speakingStore';

// The stage (client notes 5 and 6, round 4): TikTok's multi-guest layout for
// an audio room. The host sits large at the top; up to 29 guests fill a
// four-across grid under them that scrolls once it is taller than the space
// it is given. One open seat follows the guests while the stage has room:
// tapping it asks to join (viewer) or opens the stage manager (host).

export type StageSpeaker = { user: UserSummary; isHost: boolean; isMe: boolean; muted?: boolean; hostMuted?: boolean };

const RING = '#5B9BF5';
const COLUMNS = 4;

export function Stage({
  speakers,
  speaking,
  onLongPress,
  onEmptySeat,
  emptySeatLabel,
  maxHeight,
}: {
  speakers: StageSpeaker[];
  speaking: SpeakingStore;
  onLongPress: (s: StageSpeaker) => void;
  onEmptySeat?: () => void;
  emptySeatLabel: string;
  maxHeight?: number;
}) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const tile = Math.floor((Math.min(width, 520) - 32) / COLUMNS);
  const host = speakers.find((s) => s.isHost) ?? null;
  const guests = speakers.filter((s) => !s.isHost);
  const full = guests.length >= MAX_GUESTS;

  // A web-hosted stream joins with a random uid that is not ours to compute;
  // any speaker we cannot place is credited to the host tile.
  const ids = speakers.map((s) => s.user.id).join(',');
  const known = useMemo(() => new Set(ids.split(',').filter(Boolean).map(agoraUidFor)), [ids]);

  return (
    <View style={{ gap: 10 }}>
      {host ? (
        <View style={styles.hostRow}>
          <SpeakerTile speaker={host} size={124} speaking={speaking} fallback={known} onLongPress={onLongPress} />
        </View>
      ) : null}
      <Text style={styles.count} accessibilityRole="text">
        {t('live.stage.count', { count: guests.length + 1, max: MAX_GUESTS + 1 })}
      </Text>
      <ScrollView
        style={maxHeight ? { maxHeight } : undefined}
        contentContainerStyle={styles.grid}
        showsVerticalScrollIndicator={guests.length > COLUMNS * 2}
        nestedScrollEnabled
        accessibilityRole="list"
      >
        {guests.map((s) => (
          <SpeakerTile key={s.user.id} speaker={s} size={tile} speaking={speaking} onLongPress={onLongPress} />
        ))}
        {!full && onEmptySeat ? (
          <Pressable
            onPress={onEmptySeat}
            accessibilityRole="button"
            accessibilityLabel={emptySeatLabel}
            style={[styles.tile, { width: tile }]}
          >
            <View style={[styles.seat, { width: tile * 0.66, height: tile * 0.66, borderRadius: tile * 0.33 }]}>
              <Ionicons name="add" size={24} color="rgba(255,255,255,0.75)" />
            </View>
            <Text style={styles.seatLabel} numberOfLines={1}>
              {emptySeatLabel}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const SpeakerTile = memo(function SpeakerTile({
  speaker,
  size,
  speaking,
  fallback,
  onLongPress,
}: {
  speaker: StageSpeaker;
  size: number;
  speaking: SpeakingStore;
  fallback?: ReadonlySet<number>;
  onLongPress: (s: StageSpeaker) => void;
}) {
  const { t } = useTranslation();
  const isSpeaking = useIsSpeaking(speaking, agoraUidFor(speaker.user.id), fallback) && !speaker.muted && !speaker.hostMuted;
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!isSpeaking) {
      pulse.stopAnimation();
      Animated.timing(pulse, { toValue: 0, duration: 150, useNativeDriver: true }).start();
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 450, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.55, duration: 450, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isSpeaking, pulse]);

  const avatar = size * 0.66;
  const name = speaker.user.name || speaker.user.handle || t('live.someone');
  const label = [
    name,
    speaker.isHost ? t('live.stage.host') : t('live.stage.guest'),
    isSpeaking ? t('live.stage.speaking') : null,
    speaker.hostMuted ? t('live.stage.mutedByHost') : speaker.muted ? t('live.stage.muted') : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      onLongPress={speaker.isMe ? undefined : () => onLongPress(speaker)}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={speaker.isMe ? undefined : t('live.stage.longPressHint')}
      accessibilityActions={speaker.isMe ? undefined : [{ name: 'longpress', label: t('live.options') }]}
      onAccessibilityAction={() => onLongPress(speaker)}
      style={[styles.tile, { width: size }]}
    >
      <View style={{ width: avatar + 10, height: avatar + 10, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            {
              width: avatar + 10,
              height: avatar + 10,
              borderRadius: (avatar + 10) / 2,
              opacity: pulse,
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.06] }) }],
            },
          ]}
        />
        <Avatar uri={speaker.user.avatar_url} name={name} size={avatar} />
        {speaker.isHost ? (
          <View style={styles.hostBadge}>
            <Ionicons name="star" size={10} color="#fff" />
          </View>
        ) : null}
        {speaker.muted || speaker.hostMuted ? (
          <View style={styles.mutedBadge}>
            <Ionicons name="mic-off" size={11} color="#fff" />
          </View>
        ) : null}
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {speaker.isMe ? t('live.you') : name}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  hostRow: { alignItems: 'center' },
  count: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    rowGap: 12,
    paddingHorizontal: 16,
  },
  seatLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '600', maxWidth: '100%' },
  tile: { alignItems: 'center', gap: 6, minHeight: 44 },
  seat: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginTop: 5,
  },
  ring: { position: 'absolute', borderWidth: 3, borderColor: RING },
  hostBadge: {
    position: 'absolute',
    bottom: 2,
    end: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ff2d55',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000421',
  },
  mutedBadge: {
    position: 'absolute',
    bottom: 2,
    start: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { color: '#fff', fontSize: 12, fontWeight: '700', maxWidth: '100%', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
});
