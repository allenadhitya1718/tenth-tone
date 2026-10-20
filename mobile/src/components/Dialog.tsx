import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  Alert,
  type AlertButton,
  type AlertOptions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useTheme } from '@/providers/ThemeProvider';

type Dialog = {
  id: number;
  title: string;
  message?: string;
  buttons: AlertButton[];
  options?: AlertOptions;
};

// FLYP's own dialog in place of the grey system alert box (owner bug 3). Same
// call shape as Alert.alert, so a call site swaps one name: showAlert(title,
// message?, buttons?, options?). <DialogHost /> sits once at the root; calls
// made while another dialog is up wait their turn.
//
// Buttons: two or fewer sit side by side (cancel first), more stack. A
// 'destructive' button is solid red, the last non-cancel one is solid FLYP
// blue, cancel is a quiet grey. Tapping outside or the back button counts as
// the cancel button when there is one, as the only button when there is just
// one, and otherwise only when options.cancelable is set.
let push: ((d: Dialog) => void) | null = null;
let nextId = 1;

export function showAlert(title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions) {
  if (!push) {
    // The root has not mounted yet (or has unmounted): never drop a message.
    Alert.alert(title, message, buttons, options);
    return;
  }
  push({ id: nextId++, title, message, buttons: buttons?.length ? buttons : [], options });
}

export function DialogHost() {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const [queue, setQueue] = useState<Dialog[]>([]);
  const current = queue[0] ?? null;
  // iOS cannot present a Modal while another (a sheet this call site just
  // closed) is still animating away: it fails without a sound. When onShow
  // has not fired in time, remount and present again; after a few tries
  // fall back to the system alert rather than lose the message.
  const [tries, setTries] = useState({ id: 0, n: 0 });
  const attempt = current && tries.id === current.id ? tries.n : 0;
  const shown = useRef(false);

  const close = useCallback((run?: () => void) => {
    shown.current = false;
    setQueue((q) => q.slice(1));
    // After the state change, so a button that opens another dialog queues
    // it behind nothing.
    if (run) setTimeout(run, 0);
  }, []);

  useEffect(() => {
    push = (d) => setQueue((q) => [...q, d]);
    return () => {
      push = null;
    };
  }, []);

  useEffect(() => {
    if (!current) return;
    if (current.buttons.some((b) => b.style === 'destructive')) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
    AccessibilityInfo.announceForAccessibility([current.title, current.message].filter(Boolean).join('. '));
  }, [current]);

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => {
      if (shown.current) return;
      if (attempt < MAX_ATTEMPTS) {
        setTries({ id: current.id, n: attempt + 1 });
        return;
      }
      Alert.alert(current.title, current.message, current.buttons, current.options);
      close();
    }, SHOW_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [current, attempt, close]);

  const buttons: AlertButton[] = current?.buttons.length ? current.buttons : [{ text: t('common.ok') }];

  const press = (b: AlertButton) => close(b.onPress ? () => b.onPress?.() : undefined);

  const dismiss = () => {
    if (!current) return;
    const cancel = buttons.find((b) => b.style === 'cancel');
    if (cancel) return press(cancel);
    if (buttons.length === 1) return press(buttons[0]);
    if (current.options?.cancelable) close(current.options.onDismiss);
  };

  if (!current) return null;

  // Cancel first (start side, flips in RTL), then the rest in call order.
  const ordered = [...buttons.filter((b) => b.style === 'cancel'), ...buttons.filter((b) => b.style !== 'cancel')];
  const primary = [...ordered].reverse().find((b) => b.style !== 'cancel' && b.style !== 'destructive');
  const stacked = ordered.length > 2;

  return (
    <Modal
      key={`${current.id}-${attempt}`}
      visible
      onShow={() => {
        shown.current = true;
      }}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={dismiss}
    >
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        onPress={dismiss}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <View style={styles.center} pointerEvents="box-none">
        <View
          style={[styles.card, { backgroundColor: isDark ? colors.bg2 : colors.bg, borderColor: colors.border }]}
          accessibilityViewIsModal
          accessibilityRole="alert"
        >
          <ScrollView contentContainerStyle={styles.body} bounces={false} style={styles.bodyScroll}>
            {current.title ? (
              <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
                {current.title}
              </Text>
            ) : null}
            {current.message ? <Text style={[styles.message, { color: colors.muted }]}>{current.message}</Text> : null}
          </ScrollView>
          <View style={[styles.buttons, stacked && styles.buttonsStacked]}>
            {ordered.map((b, i) => {
              const destructive = b.style === 'destructive';
              const cancel = b.style === 'cancel';
              const isPrimary = b === primary;
              const bg = destructive ? colors.danger : isPrimary ? colors.primary : colors.bg3;
              const fg = destructive || isPrimary ? colors.onPrimary : colors.text;
              return (
                <Pressable
                  key={`${i}-${b.text ?? ''}`}
                  onPress={() => press(b)}
                  style={({ pressed }) => [
                    styles.button,
                    !stacked && styles.buttonFlex,
                    { backgroundColor: bg },
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={b.text ?? t('common.ok')}
                >
                  <Text style={[styles.buttonText, { color: fg }, cancel && styles.cancelText]} numberOfLines={2}>
                    {b.text ?? t('common.ok')}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const SHOW_TIMEOUT_MS = 700;
const MAX_ATTEMPTS = 3;

const styles = StyleSheet.create({
  backdrop: StyleSheet.absoluteFill,
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  card: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '80%',
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 22,
    paddingBottom: 16,
    paddingHorizontal: 18,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  bodyScroll: { flexGrow: 0 },
  body: { gap: 8, paddingHorizontal: 4, paddingBottom: 18 },
  title: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  message: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  buttons: { flexDirection: 'row', gap: 10 },
  buttonsStacked: { flexDirection: 'column' },
  button: { minHeight: 48, borderRadius: 14, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  buttonFlex: { flex: 1 },
  pressed: { opacity: 0.8 },
  buttonText: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  cancelText: { fontWeight: '600' },
});
