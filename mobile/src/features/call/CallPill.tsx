import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDuration } from '@/features/live/config';

import { hangUp, isCallActive, useCallState } from './callSession';
import { openCallScreen } from './nav';

// The bar that brings a minimised call back, the web app's call-pill. Shown on
// every screen except the call itself while a call is ringing out or running.
// Mount once, after the root <Stack> (it floats over it).
export function CallPill() {
  const { t } = useTranslation();
  const s = useCallState();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(() => Date.now());

  const visible = isCallActive(s) && s.phase !== 'incoming' && s.phase !== 'loading' && !!s.callId && !pathname.startsWith('/call');

  useEffect(() => {
    if (!visible || !s.startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [visible, s.startedAt]);

  if (!visible) return null;
  const name = s.peer?.name || s.peer?.handle || t('call.someone');
  const status =
    s.phase === 'connected' && s.startedAt
      ? formatDuration((now - s.startedAt) / 1000)
      : s.phase === 'connecting'
        ? t('call.connecting')
        : t('call.calling');

  return (
    <View style={[styles.wrap, { top: insets.top + 6 }]} pointerEvents="box-none">
      <Pressable
        onPress={() => s.callId && openCallScreen(s.callId)}
        style={styles.pill}
        accessibilityRole="button"
        accessibilityLabel={t('call.pillA11y', { name, status })}
        accessibilityHint={t('call.returnToCall')}
      >
        <Ionicons name={s.kind === 'video' ? 'videocam' : 'call'} size={16} color="#FFFFFF" />
        <Text style={styles.text} numberOfLines={1}>
          {name} · {status}
        </Text>
        <Pressable
          onPress={() => hangUp()}
          hitSlop={10}
          style={styles.end}
          accessibilityRole="button"
          accessibilityLabel={t('call.end')}
        >
          <Ionicons name="call" size={14} color="#FFFFFF" style={styles.endIcon} />
        </Pressable>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', start: 0, end: 0, alignItems: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#16A34A',
    borderRadius: 20,
    paddingStart: 14,
    paddingEnd: 6,
    paddingVertical: 6,
    maxWidth: '86%',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  text: { color: '#FFFFFF', fontWeight: '700', fontSize: 13.5, flexShrink: 1, fontVariant: ['tabular-nums'] },
  end: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center' },
  endIcon: { transform: [{ rotate: '135deg' }] },
});
