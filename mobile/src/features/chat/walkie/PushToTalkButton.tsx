import { Ionicons } from '@expo/vector-icons';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type AccessibilityActionEvent, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { useTheme } from '@/providers/ThemeProvider';

import type { WalkieControls } from './useWalkie';

// Hold to talk, release to stop. A quick tap instead LATCHES the microphone
// open (tap again to stop), for anyone who cannot hold a button down; a
// screen reader's "activate" does the same. The latch still stops itself
// after a minute (useWalkie MAX_TALK_MS).
const TAP_MS = 250;
const A11Y_ACTIONS = [{ name: 'activate' as const }];

type Props = Pick<WalkieControls, 'status' | 'talking' | 'startTalking' | 'stopTalking'>;

export const PushToTalkButton = memo(function PushToTalkButton({ status, talking, startTalking, stopTalking }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [latched, setLatched] = useState(false);
  const latchedRef = useRef(false);
  const pressedAt = useRef(0);
  const stopOnRelease = useRef(false);
  const ready = status === 'connected' || status === 'reconnecting';

  // The talk ended on its own (time limit, walkie off, screen left).
  useEffect(() => {
    if (!talking && latchedRef.current) {
      latchedRef.current = false;
      void Promise.resolve().then(() => setLatched(false));
    }
  }, [talking]);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .minDistance(0)
        .shouldCancelWhenOutside(false)
        .enabled(ready)
        .onBegin(() => {
          pressedAt.current = Date.now();
          if (latchedRef.current) {
            stopOnRelease.current = true;
            return;
          }
          stopOnRelease.current = false;
          startTalking();
        })
        .onFinalize(() => {
          if (stopOnRelease.current) {
            stopOnRelease.current = false;
            latchedRef.current = false;
            setLatched(false);
            stopTalking();
            return;
          }
          if (Date.now() - pressedAt.current < TAP_MS) {
            latchedRef.current = true;
            setLatched(true);
            return;
          }
          stopTalking();
        }),
    [ready, startTalking, stopTalking],
  );

  const onA11y = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName !== 'activate' || !ready) return;
    if (talking || latchedRef.current) {
      latchedRef.current = false;
      setLatched(false);
      stopTalking();
    } else {
      latchedRef.current = true;
      setLatched(true);
      startTalking();
    }
  };

  const live = talking;
  return (
    <GestureDetector gesture={gesture}>
      <View
        style={[
          styles.round,
          { backgroundColor: live ? colors.danger : ready ? colors.success : colors.muted2 },
          live && styles.big,
        ]}
        accessible
        accessibilityRole="button"
        accessibilityLabel={live ? t('walkie.stopTalking') : t('walkie.holdToTalk')}
        accessibilityHint={t('walkie.talkHint')}
        accessibilityState={{ disabled: !ready, selected: live || latched }}
        accessibilityActions={A11Y_ACTIONS}
        onAccessibilityAction={onA11y}
      >
        <Ionicons name={live ? 'radio' : 'radio-outline'} size={live ? 26 : 22} color={colors.onPrimary} />
      </View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  big: { transform: [{ scale: 1.25 }] },
});
