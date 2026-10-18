import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { type AccessibilityActionEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Tick } from '@/api/chat';
import { useTheme } from '@/providers/ThemeProvider';
import { light } from '@/theme/colors';

import { callLabel, clockTime, formatDuration, parseCall, previewText } from './format';
import type { ThreadMessage } from './useThread';
import { VoiceNote } from './VoiceNote';

// Read ticks sit on MY bubble, which is brand blue (#1E56D6) in both themes,
// so a theme blue would vanish into it. A fixed light blue is used on that
// fixed surface (about 4.8:1 against it). A `tickRead` theme token would be
// the better home for it.
const TICK_READ = light.tickRead;

const A11Y_ACTIONS = [{ name: 'longpress' as const }];

type Props = {
  item: ThreadMessage;
  mine: boolean;
  tick: Tick | null;
  // In a group, other people's bubbles say who wrote them.
  authorName: string | null;
  myId: string | undefined;
  onMenu: (m: ThreadMessage) => void;
  onOpenImage: (uri: string) => void;
  onQuotePress: (id: string) => void;
};

export const MessageBubble = memo(function MessageBubble({
  item,
  mine,
  tick,
  authorName,
  myId,
  onMenu,
  onOpenImage,
  onQuotePress,
}: Props) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const time = clockTime(item.created_at, i18n.language);

  const tone = useMemo(
    () =>
      mine
        ? { bg: colors.primary, fg: colors.onPrimary, sub: colors.onPrimary, track: colors.primaryPressed, quote: colors.primaryPressed }
        : { bg: colors.bg2, fg: colors.text, sub: colors.muted, track: colors.border, quote: colors.bg3 },
    [mine, colors],
  );
  const voiceTone = useMemo(() => ({ fg: tone.fg, track: tone.track }), [tone]);

  // Calls and system rows are centred records, not bubbles.
  if (item.type === 'call' || item.type === 'system') {
    const info = item.type === 'call' ? parseCall(item.text) : null;
    const missed = info?.status === 'missed' || info?.status === 'declined';
    const label = info ? callLabel(info, t) : item.text || '';
    const secs = Number(info?.seconds) || 0;
    return (
      <View style={styles.centerRow} accessible accessibilityLabel={`${label}, ${time}`}>
        <View style={[styles.record, { backgroundColor: colors.bg2 }]}>
          {info ? (
            <Ionicons
              name={info.kind === 'video' ? 'videocam' : 'call'}
              size={15}
              color={missed ? colors.danger : colors.muted}
            />
          ) : null}
          <Text style={[styles.recordText, { color: missed ? colors.danger : colors.muted }]}>
            {label}
            {secs > 0 ? ` · ${formatDuration(secs)}` : ''} · {time}
          </Text>
        </View>
      </View>
    );
  }

  const isImage = (item.type === 'image' || item.type === 'video') && !!item.attachment_url;
  const isVoice = item.type === 'voice' && !!item.attachment_url;
  const hasInteractive = isImage || isVoice || !!item.reply_to;

  const tickLabel =
    tick === 'read' ? t('chat.tickRead') : tick === 'delivered' ? t('chat.tickDelivered') : tick ? t('chat.tickSent') : '';
  const status = item.pending ? t('chat.sending') : tickLabel;
  const who = mine ? t('chat.you') : authorName || '';
  const a11yLabel = [who, previewText(item, t), time, status].filter(Boolean).join(', ');

  const onA11yAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'longpress') onMenu(item);
  };

  const reactions = groupReactions(item.reactions, myId);

  return (
    <View style={[styles.wrap, mine ? styles.wrapMine : styles.wrapTheirs]}>
      <Pressable
        onLongPress={() => onMenu(item)}
        delayLongPress={300}
        accessible={!hasInteractive}
        accessibilityLabel={hasInteractive ? undefined : a11yLabel}
        accessibilityHint={hasInteractive ? undefined : t('chat.messageHint')}
        accessibilityActions={hasInteractive ? undefined : A11Y_ACTIONS}
        onAccessibilityAction={hasInteractive ? undefined : onA11yAction}
        style={[
          styles.bubble,
          { backgroundColor: tone.bg },
          mine ? styles.bubbleMine : styles.bubbleTheirs,
          isImage && styles.bubbleMedia,
          item.pending && styles.pending,
        ]}
      >
        {authorName && !mine ? (
          <Text style={[styles.author, { color: colors.primary2 }]} numberOfLines={1}>
            {authorName}
          </Text>
        ) : null}

        {item.reply_to || item.reply_to_id ? (
          <Pressable
            onPress={() => item.reply_to && onQuotePress(item.reply_to.id)}
            onLongPress={() => onMenu(item)}
            disabled={!item.reply_to}
            style={[styles.quote, { backgroundColor: tone.quote, borderStartColor: mine ? colors.onPrimary : colors.primary2 }]}
            accessibilityRole="button"
            accessibilityLabel={
              item.reply_to
                ? t('chat.replyingTo', { name: item.reply_to.from?.name ?? '' }) + ': ' + previewText(item.reply_to, t)
                : t('chat.deletedMessage')
            }
          >
            {item.reply_to ? (
              <>
                <Text style={[styles.quoteName, { color: tone.fg }]} numberOfLines={1}>
                  {item.reply_to.from_user_id === myId ? t('chat.you') : item.reply_to.from?.name ?? ''}
                </Text>
                <Text style={[styles.quoteText, { color: tone.sub }]} numberOfLines={2}>
                  {previewText(item.reply_to, t)}
                </Text>
              </>
            ) : (
              <Text style={[styles.quoteText, styles.italic, { color: tone.sub }]}>{t('chat.deletedMessage')}</Text>
            )}
          </Pressable>
        ) : null}

        {isImage ? (
          <Pressable
            onPress={() => item.attachment_url && onOpenImage(item.attachment_url)}
            onLongPress={() => onMenu(item)}
            delayLongPress={300}
            accessibilityRole="imagebutton"
            accessibilityLabel={`${who}, ${t('chat.photo')}, ${time}${status ? `, ${status}` : ''}`}
            accessibilityHint={t('chat.openPhotoHint')}
            accessibilityActions={A11Y_ACTIONS}
            onAccessibilityAction={onA11yAction}
          >
            <Image
              source={{ uri: item.attachment_url ?? undefined }}
              style={[styles.image, { backgroundColor: colors.bg3 }]}
              contentFit="cover"
              transition={150}
              recyclingKey={item.localId ?? item.id}
            />
          </Pressable>
        ) : null}

        {isVoice && item.attachment_url ? <VoiceNote uri={item.attachment_url} tone={voiceTone} /> : null}

        {item.text && item.type !== 'voice' && item.type !== 'location' ? (
          <Text style={[styles.text, { color: tone.fg }, isImage && styles.captionPad]} selectable={false}>
            {item.text}
          </Text>
        ) : null}

        <View
          style={[styles.meta, isImage && styles.captionPad]}
          accessible={hasInteractive}
          accessibilityLabel={hasInteractive ? a11yLabel : undefined}
          accessibilityActions={hasInteractive ? A11Y_ACTIONS : undefined}
          onAccessibilityAction={hasInteractive ? onA11yAction : undefined}
        >
          <Text style={[styles.time, { color: tone.sub }]}>{time}</Text>
          {mine ? <TickIcon tick={tick} pending={!!item.pending} color={tone.sub} /> : null}
        </View>
      </Pressable>

      {reactions.length ? (
        <View
          style={[styles.reactions, { backgroundColor: colors.bg3, borderColor: colors.bg }]}
          accessible
          accessibilityLabel={t('chat.reactionsLabel', {
            list: reactions.map((r) => (r.count > 1 ? `${r.emoji} ${r.count}` : r.emoji)).join(' '),
          })}
        >
          {reactions.map((r) => (
            <Text key={r.emoji} style={[styles.reaction, { color: colors.text }, r.mine && styles.reactionMine]}>
              {r.emoji}
              {r.count > 1 ? ` ${r.count}` : ''}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
});

// Client note 10: one grey tick sent, two grey delivered, two blue read.
// A clock while the send is still in flight.
function TickIcon({ tick, pending, color }: { tick: Tick | null; pending: boolean; color: string }) {
  if (pending) return <Ionicons name="time-outline" size={13} color={color} style={styles.tick} />;
  if (!tick) return null;
  return (
    <Ionicons
      name={tick === 'sent' ? 'checkmark' : 'checkmark-done'}
      size={16}
      color={tick === 'read' ? TICK_READ : color}
      style={[styles.tick, tick !== 'read' && styles.tickDim]}
    />
  );
}

function groupReactions(list: ThreadMessage['reactions'], myId: string | undefined) {
  if (!list?.length) return [];
  const by = new Map<string, { emoji: string; count: number; mine: boolean }>();
  for (const r of list) {
    const g = by.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    g.count += 1;
    if (r.user_id === myId) g.mine = true;
    by.set(r.emoji, g);
  }
  return Array.from(by.values());
}

// Day separator between messages of different days.
export const DaySeparator = memo(function DaySeparator({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.centerRow} accessibilityRole="header">
      <View style={[styles.day, { backgroundColor: colors.bg2 }]}>
        <Text style={[styles.dayText, { color: colors.muted }]}>{label}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 10, marginVertical: 2, maxWidth: '100%' },
  // flex-start/flex-end follow the layout direction, so "mine on the end
  // side" holds in Arabic as well.
  wrapMine: { alignItems: 'flex-end' },
  wrapTheirs: { alignItems: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: 18, paddingHorizontal: 12, paddingTop: 7, paddingBottom: 5 },
  bubbleMine: { borderBottomEndRadius: 5 },
  bubbleTheirs: { borderBottomStartRadius: 5 },
  bubbleMedia: { paddingHorizontal: 4, paddingTop: 4 },
  pending: { opacity: 0.75 },
  author: { fontSize: 12.5, fontWeight: '700', marginBottom: 2, textAlign: 'left' },
  quote: { borderStartWidth: 3, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, marginBottom: 5, minWidth: 120 },
  quoteName: { fontSize: 12.5, fontWeight: '700', textAlign: 'left' },
  quoteText: { fontSize: 13, textAlign: 'left' },
  italic: { fontStyle: 'italic' },
  image: { width: 230, height: 270, borderRadius: 14 },
  text: { fontSize: 16, lineHeight: 22, textAlign: 'left', writingDirection: 'auto' },
  captionPad: { paddingHorizontal: 8 },
  meta: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 3, marginTop: 2 },
  time: { fontSize: 11 },
  tick: { marginStart: 1 },
  tickDim: { opacity: 0.85 },
  reactions: {
    flexDirection: 'row',
    gap: 2,
    marginTop: -6,
    marginHorizontal: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: 2,
  },
  reaction: { fontSize: 13 },
  reactionMine: { fontWeight: '800' },
  centerRow: { alignItems: 'center', marginVertical: 8, paddingHorizontal: 16 },
  record: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },
  recordText: { fontSize: 13 },
  day: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  dayText: { fontSize: 12, fontWeight: '600' },
});
