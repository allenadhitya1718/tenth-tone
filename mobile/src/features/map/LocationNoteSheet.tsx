import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { LOCATION_NOTE_MAX, locationKeys, setLocationNote } from '@/api/location';
import { showAlert } from '@/components/Dialog';
import { AppText, Button } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';

import { locationErrorKey } from './errors';

type Props = {
  visible: boolean;
  // The note as it is now (already hidden once a day old).
  current: string | null;
  onClose: () => void;
};

const NOTE_ERRORS: Record<string, string> = {
  note_blocked: 'map.noteBlocked',
  note_too_long: 'map.noteTooLong',
  not_sharing: 'map.noteNotSharing',
};

// 0154 (owner: "what good does only location give"): a short note shown with
// my pin to whoever can see my location, for 24 hours.
export function LocationNoteSheet({ visible, current, onClose }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [text, setText] = useState(current ?? '');
  // Opening the sheet starts from the saved note.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setText(current ?? '');
  }

  const save = useMutation({
    mutationFn: (note: string) => setLocationNote(note),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: locationKeys.settings() });
      onClose();
    },
    onError: (e) => {
      const key = e instanceof ApiError ? NOTE_ERRORS[e.code] : undefined;
      showAlert(t('map.errTitle'), t(key ?? locationErrorKey(e)));
    },
  });

  const trimmed = text.trim();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('map.close')}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.avoid} pointerEvents="box-none">
        <View style={[styles.panel, { backgroundColor: colors.bg, paddingBottom: insets.bottom + 14 }]} accessibilityViewIsModal>
          <View style={styles.head}>
            <AppText variant="label" style={{ flex: 1 }} accessibilityRole="header">
              {t('map.noteTitle')}
            </AppText>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('map.close')} style={styles.iconBtn}>
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>
          <AppText variant="small" style={[styles.hint, { color: colors.muted }]}>
            {t('map.noteHint')}
          </AppText>
          <TextInput
            value={text}
            onChangeText={(v) => setText(v.replace(/\n/g, ' ').slice(0, LOCATION_NOTE_MAX))}
            placeholder={t('map.notePlaceholder')}
            placeholderTextColor={colors.muted}
            style={[styles.input, { color: colors.text, backgroundColor: colors.bg2, textAlign: I18nManager.isRTL ? 'right' : 'left' }]}
            maxLength={LOCATION_NOTE_MAX}
            multiline
            autoFocus
            returnKeyType="done"
            blurOnSubmit
            onSubmitEditing={() => trimmed && trimmed !== current && save.mutate(trimmed)}
            accessibilityLabel={t('map.noteTitle')}
          />
          <AppText variant="small" style={[styles.count, { color: colors.muted }]}>
            {`${text.length}/${LOCATION_NOTE_MAX}`}
          </AppText>
          <View style={styles.actions}>
            {current ? (
              <Button
                title={t('map.noteClear')}
                variant="secondary"
                onPress={() => save.mutate('')}
                disabled={save.isPending}
                style={styles.flex}
              />
            ) : null}
            <Button
              title={t('map.noteSave')}
              onPress={() => save.mutate(trimmed)}
              disabled={!trimmed || trimmed === current}
              loading={save.isPending}
              style={styles.flex}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  avoid: { flex: 1, justifyContent: 'flex-end' },
  panel: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18 },
  head: { flexDirection: 'row', alignItems: 'center', paddingTop: 12 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  hint: { marginBottom: 10 },
  input: { minHeight: 64, borderRadius: 14, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, fontSize: 16, textAlignVertical: 'top' },
  count: { alignSelf: 'flex-end', marginTop: 4 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  flex: { flex: 1 },
});
