import { Ionicons } from '@expo/vector-icons';
import { type ComponentRef, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type AccessibilityActionEvent,
  Alert,
  Animated,
  I18nManager,
  Keyboard,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import type { LocalMedia } from '@/api/upload';
import { EmojiPanel, QuickEmojis } from '@/components/emoji/EmojiPanel';
import { useTheme } from '@/providers/ThemeProvider';

import { formatDuration, previewText } from './format';
import { useVoiceRecorder } from './useVoiceRecorder';
import type { ThreadMessage } from './useThread';
import { PushToTalkButton } from './walkie/PushToTalkButton';
import type { WalkieControls } from './walkie/useWalkie';
import { WalkieBar } from './walkie/WalkieBar';

const MAX_LEN = 2000;
// How far the finger travels toward the start edge before the note is dropped.
const CANCEL_PX = 110;
const MIC_ACTIONS = [{ name: 'activate' as const }];

type Props = {
  replyTo: ThreadMessage | null;
  replyName: string;
  onCancelReply: () => void;
  emojiOpen: boolean;
  setEmojiOpen: (open: boolean) => void;
  // Resolves false when the send failed, so the text can be put back.
  onSendText: (text: string) => Promise<boolean>;
  onPickImage: () => void;
  onSendVoice: (media: LocalMedia) => void;
  // Live push-to-talk (client note 26); null where it is not offered.
  walkie?: WalkieControls | null;
};

export const Composer = memo(function Composer({
  replyTo,
  replyName,
  onCancelReply,
  emojiOpen,
  setEmojiOpen,
  onSendText,
  onPickImage,
  onSendVoice,
  walkie = null,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [text, setText] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slide = useRef(new Animated.Value(0)).current;

  const flash = useCallback((msg: string) => {
    setHint(msg);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), 2200);
  }, []);
  useEffect(() => () => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  const events = useMemo(
    () => ({
      onDone: (media: LocalMedia) => onSendVoice(media),
      onTooShort: () => flash(t('chat.holdToRecord')),
      onPermissionAsked: () => flash(t('chat.holdToRecord')),
      onPermissionDenied: () =>
        Alert.alert(t('chat.micDeniedTitle'), t('chat.micDeniedBody'), [
          { text: t('chat.cancel'), style: 'cancel' },
          { text: t('chat.openSettings'), onPress: () => void Linking.openSettings() },
        ]),
      onError: () => flash(t('chat.recordFailed')),
    }),
    [onSendVoice, flash, t],
  );
  const rec = useVoiceRecorder(events);

  // Note 29: the emoji panel gives way to the keyboard.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => setEmojiOpen(false));
    return () => sub.remove();
  }, [setEmojiOpen]);

  // Choosing "reply" brings the keyboard up on the reply.
  useEffect(() => {
    if (replyTo) input.current?.focus();
  }, [replyTo]);

  const submit = useCallback(() => {
    const body = text.trim();
    if (!body) return;
    setText('');
    // Client note 10: the keyboard stays up after sending. submitBehavior
    // "submit" keeps the field focused on the return key; the send button
    // refocuses in case the tap took focus away.
    input.current?.focus();
    void onSendText(body).then((ok) => {
      // Nothing was written: hand the text back rather than losing it.
      if (!ok) setText((cur) => cur || body);
    });
  }, [text, onSendText]);

  const toggleEmoji = () => {
    if (emojiOpen) {
      setEmojiOpen(false);
      input.current?.focus();
    } else {
      Keyboard.dismiss();
      setEmojiOpen(true);
    }
  };

  const addEmoji = useCallback((e: string) => setText((v) => (v + e).slice(0, MAX_LEN)), []);

  // Hold to record, slide toward the start edge to cancel. The callbacks run
  // on the JS thread: they drive the native recorder, not an animation.
  const { begin, finish, cancel } = rec;
  const micGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .minDistance(0)
        .shouldCancelWhenOutside(false)
        .onBegin(() => {
          slide.setValue(0);
          void begin();
        })
        .onUpdate((e) => {
          // "Toward the start" is left in English and right in Arabic.
          const d = Math.max(0, I18nManager.isRTL ? e.translationX : -e.translationX);
          slide.setValue(d);
          if (d >= CANCEL_PX) cancel();
        })
        .onFinalize(() => {
          slide.setValue(0);
          finish();
        }),
    [begin, finish, cancel, slide],
  );

  // A screen reader cannot hold and slide: activating the button starts the
  // recording and activating it again sends it.
  const onMicA11y = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName !== 'activate') return;
    if (rec.recording) finish();
    else void begin();
  };

  const hintShift = slide.interpolate({
    inputRange: [0, CANCEL_PX],
    outputRange: [0, (I18nManager.isRTL ? 1 : -1) * CANCEL_PX * 0.6],
    extrapolate: 'clamp',
  });
  const hintFade = slide.interpolate({ inputRange: [0, CANCEL_PX], outputRange: [1, 0.2], extrapolate: 'clamp' });

  const hasText = text.trim().length > 0;
  const walkieOn = !!walkie?.on;

  return (
    <View style={{ backgroundColor: colors.bg }}>
      {replyTo ? (
        <View style={[styles.replyBar, { borderTopColor: colors.border, backgroundColor: colors.bg2 }]}>
          <View style={[styles.replyAccent, { backgroundColor: colors.primary2 }]} />
          <View style={styles.replyBody}>
            <Text style={[styles.replyName, { color: colors.primary2 }]} numberOfLines={1}>
              {replyName}
            </Text>
            <Text style={[styles.replyText, { color: colors.muted }]} numberOfLines={1}>
              {previewText(replyTo, t)}
            </Text>
          </View>
          <Pressable
            onPress={onCancelReply}
            hitSlop={10}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel={t('chat.cancelReply')}
          >
            <Ionicons name="close" size={22} color={colors.muted} />
          </Pressable>
        </View>
      ) : null}

      {walkie && walkieOn ? <WalkieBar walkie={walkie} /> : null}

      {hint ? (
        <Text style={[styles.hint, { color: colors.muted }]} accessibilityLiveRegion="polite" accessibilityRole="alert">
          {hint}
        </Text>
      ) : null}

      <View style={[styles.row, { borderTopColor: colors.border }]}>
        {rec.recording ? (
          <View style={styles.recording} accessibilityLiveRegion="polite">
            <View style={[styles.recDot, { backgroundColor: colors.danger }]} />
            <Text style={[styles.recTime, { color: colors.text }]}>{formatDuration(rec.durationMs / 1000)}</Text>
            <Animated.View style={[styles.slideHint, { opacity: hintFade, transform: [{ translateX: hintShift }] }]}>
              <Ionicons name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'} size={16} color={colors.muted} />
              <Text style={[styles.slideText, { color: colors.muted }]}>{t('chat.slideToCancel')}</Text>
            </Animated.View>
          </View>
        ) : (
          <>
            <Pressable
              onPress={toggleEmoji}
              hitSlop={6}
              style={styles.iconBtn}
              accessibilityRole="button"
              accessibilityLabel={emojiOpen ? t('chat.keyboard') : t('chat.emoji')}
            >
              <Ionicons name={emojiOpen ? 'keypad-outline' : 'happy-outline'} size={26} color={colors.muted} />
            </Pressable>
            <View style={[styles.field, { backgroundColor: colors.bg2 }]}>
              <TextInput
                ref={input}
                value={text}
                onChangeText={(v) => setText(v.slice(0, MAX_LEN))}
                onFocus={() => setEmojiOpen(false)}
                placeholder={t('chat.placeholder')}
                placeholderTextColor={colors.muted}
                style={[styles.input, { color: colors.text }]}
                multiline
                // Return sends and the field keeps focus, so the keyboard
                // does not drop between messages (client note 10).
                submitBehavior="submit"
                returnKeyType="send"
                onSubmitEditing={submit}
                accessibilityLabel={t('chat.placeholder')}
              />
              {walkie ? (
                <Pressable
                  onPress={() => walkie.setOn(!walkieOn)}
                  hitSlop={6}
                  style={styles.attach}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: walkieOn }}
                  accessibilityLabel={t('walkie.toggle')}
                  accessibilityHint={t('walkie.toggleHint')}
                >
                  <Ionicons name={walkieOn ? 'radio' : 'radio-outline'} size={23} color={walkieOn ? colors.success : colors.muted} />
                </Pressable>
              ) : null}
              <Pressable
                onPress={onPickImage}
                hitSlop={6}
                style={styles.attach}
                accessibilityRole="button"
                accessibilityLabel={t('chat.attachPhoto')}
              >
                <Ionicons name="image-outline" size={23} color={colors.muted} />
              </Pressable>
            </View>
          </>
        )}

        {hasText && !rec.recording ? (
          <Pressable
            onPress={submit}
            style={[styles.round, { backgroundColor: colors.primary }]}
            accessibilityRole="button"
            accessibilityLabel={t('chat.send')}
          >
            <Ionicons name="send" size={20} color={colors.onPrimary} style={I18nManager.isRTL ? styles.flip : undefined} />
          </Pressable>
        ) : walkie && walkieOn && !rec.recording ? (
          // Walkie on: the mic button talks live instead of recording a note
          // (client note 26). Switching walkie off brings voice notes back.
          <PushToTalkButton
            status={walkie.status}
            talking={walkie.talking}
            startTalking={walkie.startTalking}
            stopTalking={walkie.stopTalking}
          />
        ) : (
          <GestureDetector gesture={micGesture}>
            <View
              style={[styles.round, { backgroundColor: rec.recording ? colors.danger : colors.primary }, rec.recording && styles.big]}
              accessible
              accessibilityRole="button"
              accessibilityLabel={rec.recording ? t('chat.stopAndSend') : t('chat.recordVoice')}
              accessibilityHint={t('chat.recordHint')}
              accessibilityActions={MIC_ACTIONS}
              onAccessibilityAction={onMicA11y}
            >
              <Ionicons name="mic" size={rec.recording ? 26 : 22} color={colors.onPrimary} />
            </View>
          </GestureDetector>
        )}
      </View>

      {emojiOpen ? (
        <View style={{ backgroundColor: colors.bg2 }}>
          <QuickEmojis onPick={addEmoji} />
          <EmojiPanel onPick={addEmoji} />
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingStart: 12,
    paddingEnd: 6,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  replyAccent: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
  replyBody: { flex: 1, minWidth: 0 },
  replyName: { fontSize: 13, fontWeight: '700', textAlign: 'left' },
  replyText: { fontSize: 13, textAlign: 'left' },
  hint: { fontSize: 13, textAlign: 'center', paddingTop: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 22,
    minHeight: 44,
    paddingStart: 14,
    paddingEnd: 4,
  },
  input: {
    flex: 1,
    fontSize: 16,
    maxHeight: 120,
    paddingTop: 11,
    paddingBottom: 11,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
    textAlignVertical: 'center',
  },
  attach: { width: 38, height: 44, alignItems: 'center', justifyContent: 'center' },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  big: { transform: [{ scale: 1.25 }] },
  flip: { transform: [{ scaleX: -1 }] },
  recording: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 10, overflow: 'hidden' },
  recDot: { width: 10, height: 10, borderRadius: 5 },
  recTime: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  slideHint: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  slideText: { fontSize: 14 },
});
