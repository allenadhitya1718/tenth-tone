import { Ionicons } from '@expo/vector-icons';
import { type Href, router } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import type { CallKind } from '@/api/calls';
import type { UserSummary, Uuid } from '@/api/types';
import { showAlert } from '@/components/Dialog';
import { useTheme } from '@/providers/ThemeProvider';

import { checkReady, getCallState, isCallActive } from './callSession';
import { dialPath, openCallScreen } from './nav';

// The voice and video buttons for a chat header. One-to-one only: give it the
// other person of a DM. Busy and permission problems are explained here,
// before any screen opens or any phone rings.
export function CallButtons({
  peer,
  chatId,
  size = 24,
  color,
}: {
  peer: UserSummary;
  chatId?: Uuid | null;
  size?: number;
  // On a chat theme the header icons take the theme's contrast.
  color?: string;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [checking, setChecking] = useState(false);

  const start = useCallback(
    async (kind: CallKind) => {
      if (checking) return;
      const s = getCallState();
      if (isCallActive(s) && s.callId) {
        // Already talking to them: take them back to it rather than refusing.
        if (s.peer?.id === peer.id) {
          openCallScreen(s.callId);
          return;
        }
      }
      setChecking(true);
      try {
        const ready = await checkReady(kind);
        if (!ready.ok) {
          const buttons: { text: string; style?: 'cancel'; onPress?: () => void }[] = [{ text: t('call.ok'), style: 'cancel' }];
          if (ready.openSettings) buttons.push({ text: t('call.openSettings'), onPress: () => void Linking.openSettings() });
          showAlert(t('call.cantCallTitle'), t(ready.error.key, ready.error.params), buttons);
          return;
        }
        router.push(
          dialPath({
            to: peer.id,
            kind,
            chat: chatId ?? null,
            name: peer.name,
            handle: peer.handle,
            avatar: peer.avatar_url,
          }) as Href,
        );
      } finally {
        setChecking(false);
      }
    },
    [checking, peer, chatId, t],
  );

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => void start('audio')}
        hitSlop={6}
        style={styles.btn}
        accessibilityRole="button"
        accessibilityLabel={t('call.startVoice')}
        disabled={checking}
      >
        <Ionicons name="call-outline" size={size} color={color ?? colors.text} />
      </Pressable>
      <Pressable
        onPress={() => void start('video')}
        hitSlop={6}
        style={styles.btn}
        accessibilityRole="button"
        accessibilityLabel={t('call.startVideo')}
        disabled={checking}
      >
        <Ionicons name="videocam-outline" size={size + 2} color={color ?? colors.text} />
      </Pressable>
    </View>
  );
}

// The voice and video buttons for a GROUP chat header (0145): every member
// who may be rung rings at once; the call screen shows them as they answer.
export function GroupCallButtons({
  chatId,
  title,
  photo,
  size = 24,
  color,
}: {
  chatId: Uuid;
  title: string;
  photo?: string | null;
  size?: number;
  color?: string;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [checking, setChecking] = useState(false);

  const start = useCallback(
    async (kind: CallKind) => {
      if (checking) return;
      const s = getCallState();
      // Already in this group's call: back to it.
      if (isCallActive(s) && s.callId && s.groupChatId === chatId) {
        openCallScreen(s.callId);
        return;
      }
      setChecking(true);
      try {
        const ready = await checkReady(kind);
        if (!ready.ok) {
          const buttons: { text: string; style?: 'cancel'; onPress?: () => void }[] = [{ text: t('call.ok'), style: 'cancel' }];
          if (ready.openSettings) buttons.push({ text: t('call.openSettings'), onPress: () => void Linking.openSettings() });
          showAlert(t('call.cantCallTitle'), t(ready.error.key, ready.error.params), buttons);
          return;
        }
        router.push(dialPath({ to: chatId, kind, chat: chatId, name: title, avatar: photo ?? null, group: true }) as Href);
      } finally {
        setChecking(false);
      }
    },
    [checking, chatId, title, photo, t],
  );

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => void start('audio')}
        hitSlop={6}
        style={styles.btn}
        accessibilityRole="button"
        accessibilityLabel={t('call.group.startVoice', { name: title })}
        disabled={checking}
      >
        <Ionicons name="call-outline" size={size} color={color ?? colors.text} />
      </Pressable>
      <Pressable
        onPress={() => void start('video')}
        hitSlop={6}
        style={styles.btn}
        accessibilityRole="button"
        accessibilityLabel={t('call.group.startVideo', { name: title })}
        disabled={checking}
      >
        <Ionicons name="videocam-outline" size={size + 2} color={color ?? colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  btn: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
});
