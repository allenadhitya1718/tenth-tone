import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmojiPanel, QuickEmojis } from '@/components/emoji/EmojiPanel';
import { useTheme } from '@/providers/ThemeProvider';

import { previewText } from './format';
import type { ThreadMessage } from './useThread';

type IconName = keyof typeof Ionicons.glyphMap;

// The long-press sheet for one message: react, reply, copy, delete (own
// messages only). A bubble still sending has no id yet, so it can only be
// copied. A shared video (0146) offers Copy link instead of Copy text.
// Without onReply (a message request, where there is no composer) there is
// no Reply.
export function MessageMenu({
  message,
  mine,
  onClose,
  onReact,
  onReply,
  onCopy,
  onDelete,
  onInfo,
}: {
  message: ThreadMessage | null;
  mine: boolean;
  onClose: () => void;
  onReact: (m: ThreadMessage, emoji: string) => void;
  onReply?: (m: ThreadMessage) => void;
  onCopy: (m: ThreadMessage) => void;
  onDelete: (m: ThreadMessage) => void;
  // Message info (who has read it); own messages only.
  onInfo?: (m: ThreadMessage) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [moreEmoji, setMoreEmoji] = useState(false);

  const close = () => {
    setMoreEmoji(false);
    onClose();
  };

  const m = message;
  const sent = !!m && !m.pending;
  const isVideoShare = m?.type === 'video_share';
  const canCopy = isVideoShare ? !!m?.attachment_url : !!m?.text && m.type !== 'call' && m.type !== 'voice' && m.type !== 'gif';

  return (
    <Modal visible={!!m} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={close} accessibilityLabel={t('chat.close')} />
      {m ? (
        <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: colors.bg }]}>
          <View style={[styles.grabber, { backgroundColor: colors.muted2 }]} />
          <Text style={[styles.preview, { color: colors.muted }]} numberOfLines={2}>
            {previewText(m, t)}
          </Text>

          {sent ? (
            <View style={styles.reactRow} accessibilityLabel={t('chat.react')}>
              <View style={styles.quick}>
                <QuickEmojis
                  onPick={(e) => {
                    onReact(m, e);
                    close();
                  }}
                />
              </View>
              <Pressable
                onPress={() => setMoreEmoji((v) => !v)}
                hitSlop={6}
                style={[styles.more, { backgroundColor: colors.bg2 }]}
                accessibilityRole="button"
                accessibilityLabel={t('chat.moreReactions')}
                accessibilityState={{ expanded: moreEmoji }}
              >
                <Ionicons name={moreEmoji ? 'chevron-down' : 'add'} size={22} color={colors.text} />
              </Pressable>
            </View>
          ) : null}

          {moreEmoji && sent ? (
            <EmojiPanel
              height={240}
              onPick={(e) => {
                onReact(m, e);
                close();
              }}
            />
          ) : (
            <View style={[styles.actions, { borderTopColor: colors.border }]}>
              {sent && onReply ? (
                <Action
                  icon="arrow-undo-outline"
                  label={t('chat.reply')}
                  onPress={() => {
                    onReply(m);
                    close();
                  }}
                />
              ) : null}
              {canCopy ? (
                <Action
                  icon={isVideoShare ? 'link-outline' : 'copy-outline'}
                  label={isVideoShare ? t('sendTo.copyLink') : t('chat.copy')}
                  onPress={() => {
                    onCopy(m);
                    close();
                  }}
                />
              ) : null}
              {mine && sent && onInfo && m.type !== 'call' && m.type !== 'system' ? (
                <Action
                  icon="information-circle-outline"
                  label={t('msgInfo.title')}
                  onPress={() => {
                    close();
                    onInfo(m);
                  }}
                />
              ) : null}
              {mine && sent ? (
                <Action
                  icon="trash-outline"
                  label={t('chat.delete')}
                  danger
                  onPress={() => {
                    close();
                    onDelete(m);
                  }}
                />
              ) : null}
              <Action icon="close" label={t('chat.cancel')} onPress={close} />
            </View>
          )}
        </SafeAreaView>
      ) : null}
    </Modal>
  );
}

function Action({ icon, label, onPress, danger }: { icon: IconName; label: string; onPress: () => void; danger?: boolean }) {
  const { colors } = useTheme();
  const color = danger ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && { backgroundColor: colors.bg2 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={22} color={color} />
      <Text style={[styles.actionText, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 },
  sheet: { position: 'absolute', start: 0, end: 0, bottom: 0, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 8 },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 8 },
  preview: { fontSize: 13, paddingHorizontal: 20, marginBottom: 6, textAlign: 'center' },
  reactRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 6 },
  quick: { flex: 1 },
  more: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  actions: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 4 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, minHeight: 50 },
  actionText: { fontSize: 16, fontWeight: '600' },
});
