import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDuration } from './format';

// Only one note plays at a time: starting one pauses the one before.
let stopCurrent: (() => void) | null = null;

type Tone = { fg: string; track: string };

// A voice note. The player is only created on the first tap: a thread with
// dozens of notes would otherwise open a native player for each one.
export const VoiceNote = memo(function VoiceNote({ uri, tone }: { uri: string; tone: Tone }) {
  const { t } = useTranslation();
  const [active, setActive] = useState(false);
  if (active) return <ActiveVoiceNote uri={uri} tone={tone} />;
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => setActive(true)}
        hitSlop={8}
        style={styles.btn}
        accessibilityRole="button"
        accessibilityLabel={t('chat.playVoice')}
      >
        <Ionicons name="play" size={24} color={tone.fg} />
      </Pressable>
      <View style={[styles.track, { backgroundColor: tone.track }]} />
      <Text style={[styles.time, { color: tone.fg }]}>{t('chat.voiceShort')}</Text>
    </View>
  );
});

function ActiveVoiceNote({ uri, tone }: { uri: string; tone: Tone }) {
  const { t } = useTranslation();
  const player = useAudioPlayer({ uri }, { updateInterval: 200 });
  const status = useAudioPlayerStatus(player);

  // Stable, so the module-level "now playing" slot can be compared to it.
  const pause = useCallback(() => {
    try {
      player.pause();
    } catch {}
  }, [player]);

  const start = useCallback(() => {
    if (stopCurrent && stopCurrent !== pause) stopCurrent();
    stopCurrent = pause;
    // Recording leaves iOS routing to the earpiece; playback goes to the speaker.
    void setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
    player.play();
  }, [player, pause]);

  // Mounted by the first tap, so it starts playing straight away. Both
  // callbacks are stable for the life of the player, so this runs once.
  useEffect(() => {
    start();
    return () => {
      if (stopCurrent === pause) stopCurrent = null;
    };
  }, [start, pause]);

  function toggle() {
    if (status.playing) {
      pause();
      return;
    }
    if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.05)) {
      void player.seekTo(0);
    }
    start();
  }

  const duration = status.duration || 0;
  const progress = duration > 0 ? Math.min(1, status.currentTime / duration) : 0;
  const shown = status.playing || status.currentTime > 0 ? status.currentTime : duration;

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => toggle()}
        hitSlop={8}
        style={styles.btn}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? t('chat.pauseVoice') : t('chat.playVoice')}
        accessibilityValue={{ text: `${formatDuration(status.currentTime)} / ${formatDuration(duration)}` }}
      >
        {status.isBuffering && !status.isLoaded ? (
          <Ionicons name="hourglass-outline" size={22} color={tone.fg} />
        ) : (
          <Ionicons name={status.playing ? 'pause' : 'play'} size={24} color={tone.fg} />
        )}
      </Pressable>
      <View style={[styles.track, { backgroundColor: tone.track }]}>
        <View style={[styles.fill, { backgroundColor: tone.fg, width: `${progress * 100}%` }]} />
      </View>
      <Text style={[styles.time, { color: tone.fg }]}>{formatDuration(shown)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, width: 210, paddingVertical: 2 },
  btn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  track: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2 },
  time: { fontSize: 12, minWidth: 34, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
