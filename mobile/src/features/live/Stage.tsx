import { Ionicons } from '@expo/vector-icons';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { UserSummary } from '@/api/types';

import { agoraUidFor, MAX_GUESTS } from './config';
import { Avatar } from './Sheet';
import { useIsSpeaking, type SpeakingStore } from './speakingStore';

// The stage (client notes 5 and 6): the host and up to four guests as avatar
// tiles, laid out as an even 3 + 2 grid that does not jump around as people
// join and leave. Empty seats are shown so the layout stays still; tapping
// one asks to speak (viewer) or opens the stage manager (host).

export type StageSpeaker = { user: UserSummary; isHost: boolean; isMe: boolean; muted?: boolean };

const RING = '#5B9BF5';

export function Stage({
  speakers,
  speaking,
  onLongPress,
  onEmptySeat,
  emptySeatLabel,
}: {
  speakers: StageSpeaker[];
  speaking: SpeakingStore;
  onLongPress: (s: StageSpeaker) => void;
  onEmptySeat?: () => void;
  emptySeatLabel: string;
}) {
  const { width } = useWindowDimensions();
  const tile = Math.min(116, Math.floor((width - 48) / 3));
  const seats = Math.max(0, 1 + MAX_GUESTS - speakers.length);

  // A web-hosted stream joins with a random uid that is not ours to compute;
  // any speaker we cannot place is credited to the host tile.
  const ids = speakers.map((s) => s.user.id).join(',');
  const known = useMemo(() => new Set(ids.split(',').filter(Boolean).map(agoraUidFor)), [ids]);

  return (
    <View style={styles.grid} accessibilityRole="list">
      {speakers.map((s) => (
        <SpeakerTile
          key={s.user.id}
          speaker={s}
          size={tile}
          speaking={speaking}
          fallback={s.isHost ? known : undefined}
          onLongPress={onLongPress}
        />
      ))}
      {Array.from({ length: seats }, (_, i) => (
        <Pressable
          key={`seat-${i}`}
          onPress={onEmptySeat}
          disabled={!onEmptySeat}
          accessibilityRole="button"
          accessibilityLabel={emptySeatLabel}
          style={[styles.tile, { width: tile }]}
        >
          <View style={[styles.seat, { width: tile * 0.62, height: tile * 0.62, borderRadius: tile * 0.31 }]}>
            <Ionicons name={onEmptySeat ? 'add' : 'mic-outline'} size={22} color="rgba(255,255,255,0.55)" />
          </View>
        </Pressable>
      ))}
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
  const isSpeaking = useIsSpeaking(speaking, agoraUidFor(speaker.user.id), fallback) && !speaker.muted;
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

  const avatar = size * 0.62;
  const name = speaker.user.name || speaker.user.handle || t('live.someone');
  const label = [
    name,
    speaker.isHost ? t('live.stage.host') : t('live.stage.guest'),
    isSpeaking ? t('live.stage.speaking') : null,
    speaker.muted ? t('live.stage.muted') : null,
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
        {speaker.muted ? (
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    rowGap: 14,
    columnGap: 8,
    paddingHorizontal: 16,
  },
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
  name: { color: '#fff', fontSize: 13, fontWeight: '700', maxWidth: '100%', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
});
