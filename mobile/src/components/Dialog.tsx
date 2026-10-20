import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, BackHandler, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';

import { showToast } from '@/components/Toast';
import { useTheme } from '@/providers/ThemeProvider';

// The app's own alert box, in place of the system one (the grey 2010s dialog).
// `Alert.alert(title, message?, buttons?, options?)` keeps the exact shape of
// React Native's Alert, so a screen only changes its import. <DialogHost />
// sits once at the root.
//
//  - Buttons: a plain button is the main (blue) action, `cancel` is the quiet
//    one, `destructive` is red. Two buttons sit side by side, more are stacked.
//  - A bare notice (a title and nothing else, no buttons) is shown as a toast
//    instead of blocking the screen.
export type DialogButton = {
  text?: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: (value?: string) => void;
};
type DialogOptions = { cancelable?: boolean; onDismiss?: () => void };
type DialogItem = { id: number; title: string; message?: string; buttons: DialogButton[]; options?: DialogOptions };

let push: ((d: DialogItem) => void) | null = null;
let nextId = 1;
const OK: DialogButton = { text: 'OK', style: 'default' };

// A short failure line looks wrong with a green tick.
const BAD = /fail|error|denied|cannot|can't|couldn|unable|not\b|refused|wrong|invalid|blocked/i;

export function showAlert(title: string, message?: string, buttons?: DialogButton[], options?: DialogOptions) {
  const hasButtons = !!buttons && buttons.length > 0;
  if (!hasButtons && !message) {
    showToast(title, BAD.test(title) ? 'alert-circle' : 'checkmark-circle', BAD.test(title) ? 'error' : 'success');
    return;
  }
  const item: DialogItem = { id: nextId++, title, message, buttons: hasButtons ? buttons! : [OK], options };
  if (push) push(item);
}

export const Alert = { alert: showAlert };

export function DialogHost() {
  const { colors } = useTheme();
  const [queue, setQueue] = useState<DialogItem[]>([]);
  const current = queue[0];

  useEffect(() => {
    push = (d) => setQueue((q) => [...q, d]);
    return () => {
      push = null;
    };
  }, []);

  const close = useCallback((then?: () => void) => {
    setQueue((q) => q.slice(1));
    // Let the box leave before the action runs, so a follow-up alert is not eaten.
    if (then) setTimeout(then, 60);
  }, []);

  const dismiss = useCallback(() => {
    if (!current) return;
    const cancel = current.buttons.find((b) => b.style === 'cancel');
    if (current.options?.cancelable === false && !cancel) return;
    close(() => {
      cancel?.onPress?.();
      current.options?.onDismiss?.();
    });
  }, [current, close]);

  useEffect(() => {
    if (!current) return;
    AccessibilityInfo.announceForAccessibility(current.title);
    if (current.buttons.some((b) => b.style === 'destructive')) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss();
      return true;
    });
    return () => sub.remove();
  }, [current, dismiss]);

  if (!current) return null;

  const destructive = current.buttons.some((b) => b.style === 'destructive');
  const tone = destructive ? colors.danger : colors.primary;
  const stacked = current.buttons.length > 2 || current.buttons.some((b) => (b.text ?? '').length > 16);
  const ordered = stacked ? current.buttons : current.buttons;

  return (
    <Modal visible transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={[StyleSheet.absoluteFill, styles.backdrop, { backgroundColor: colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityRole="button" accessibilityLabel="Close" />
        <Animated.View
          entering={ZoomIn.springify().damping(18).stiffness(240)}
          style={[styles.card, { backgroundColor: colors.bg, borderColor: colors.border }]}
          accessibilityViewIsModal
        >
          <View style={[styles.icon, { backgroundColor: destructive ? colors.dangerSoft : colors.bg2 }]}>
            <Ionicons name={destructive ? 'warning' : 'information-circle'} size={26} color={tone} />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>{current.title}</Text>
          {current.message ? <Text style={[styles.message, { color: colors.muted }]}>{current.message}</Text> : null}
          <View style={[styles.actions, stacked ? styles.stack : styles.row]}>
            {ordered.map((b, i) => {
              const kind = b.style ?? 'default';
              const filled = kind !== 'cancel';
              const bg = kind === 'destructive' ? '#DC2626' : kind === 'default' ? colors.primary : colors.bg2;
              const fg = filled ? '#FFFFFF' : colors.text;
              return (
                <Pressable
                  key={`${b.text}-${i}`}
                  onPress={() => close(() => b.onPress?.())}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.btn, !stacked && styles.btnRow, { backgroundColor: bg, opacity: pressed ? 0.85 : 1 }]}
                >
                  <Text style={[styles.btnText, { color: fg }]} numberOfLines={1}>
                    {b.text ?? 'OK'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 18,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  icon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { fontSize: 18, fontWeight: '700', textAlign: 'center', lineHeight: 24 },
  message: { fontSize: 14.5, lineHeight: 21, textAlign: 'center', marginTop: 8 },
  actions: { alignSelf: 'stretch', marginTop: 20, gap: 10 },
  row: { flexDirection: 'row' },
  stack: { flexDirection: 'column' },
  btn: { height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  btnRow: { flex: 1 },
  btnText: { fontSize: 15.5, fontWeight: '700' },
});
