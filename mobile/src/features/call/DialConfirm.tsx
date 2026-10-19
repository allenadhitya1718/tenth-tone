import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { type Href, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CallKind } from '@/api/calls';
import { fetchProfile, profileKeys } from '@/api/profiles';
import { Avatar } from '@/features/chat/Avatar';

import { dialPath, leaveCallScreen } from './nav';
import { atHandle } from '@/lib/handle';

// A /call/dial link that did not come from inside the app (a deep link from a
// web page, a message, another app). Nothing rings until the person says so,
// and who they are calling is shown as the SERVER knows them: a link's own
// name or photo is never shown or trusted (security review F14).
//
// Always dark, like the call screen it leads to.
const INK = '#FFFFFF';
const INK_SOFT = 'rgba(255,255,255,0.72)';
const GROUND = '#000421';
const GREEN = '#22C55E';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function DialConfirm({ to, kind }: { to: string; kind: CallKind }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const valid = UUID_RE.test(to);
  const profile = useQuery({
    queryKey: profileKeys.profile(to),
    queryFn: () => fetchProfile(to),
    enabled: valid,
  });
  const person = profile.data;
  const name = person?.name || person?.handle || t('call.someone');

  function call() {
    if (!person) return;
    router.replace(
      dialPath({
        to: person.id,
        kind,
        name: person.name,
        handle: person.handle,
        avatar: person.avatar_url,
      }) as Href,
    );
  }

  let body;
  if (valid && profile.isLoading) {
    body = <ActivityIndicator color={INK} />;
  } else if (!valid || !person) {
    body = <Text style={styles.title}>{t('call.errors.generic')}</Text>;
  } else {
    body = (
      <>
        <Avatar uri={person.avatar_url} name={name} size={112} />
        <Text style={styles.title}>{t('call.confirmTitle', { name })}</Text>
        {person.handle ? <Text style={styles.sub}>{atHandle(person.handle)}</Text> : null}
        <Text style={styles.sub}>{t('call.confirmBody')}</Text>
        <Pressable onPress={call} style={styles.callBtn} accessibilityRole="button">
          <Ionicons name={kind === 'video' ? 'videocam' : 'call'} size={20} color={INK} />
          <Text style={styles.callText}>{t(kind === 'video' ? 'call.startVideo' : 'call.startVoice')}</Text>
        </Pressable>
      </>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {body}
      <Pressable onPress={leaveCallScreen} style={styles.closeBtn} accessibilityRole="button">
        <Text style={styles.closeText}>{t('call.cancel')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: GROUND,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  title: { color: INK, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  sub: { color: INK_SOFT, fontSize: 15, textAlign: 'center' },
  callBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: GREEN,
  },
  callText: { color: INK, fontWeight: '700', fontSize: 16 },
  closeBtn: { paddingHorizontal: 18, paddingVertical: 10 },
  closeText: { color: INK_SOFT, fontWeight: '600' },
});
