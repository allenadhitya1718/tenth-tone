import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { addHiddenWord, fetchHiddenWords, removeHiddenWord, safetyKeys } from '@/api/safety';
import { Button, Screen, TextField, TopBar } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';

import { EmptyView, ErrorView, LoadingView, Note, showError } from './components';

const MAX = 40;

export function HiddenWordsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const key = safetyKeys.hiddenWords();
  const words = useQuery({ queryKey: key, queryFn: fetchHiddenWords });
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const clean = draft.trim().toLowerCase();
  const already = !!clean && (words.data ?? []).includes(clean);

  async function add() {
    if (!clean || already) return;
    setAdding(true);
    try {
      await addHiddenWord(clean);
      qc.setQueryData<string[]>(key, (rows) => [...(rows ?? []), clean]);
      qc.invalidateQueries({ queryKey: key });
      setDraft('');
    } catch (e) {
      showError(t, e, 'settings2.hiddenWords.addFailed');
    } finally {
      setAdding(false);
    }
  }

  async function remove(w: string) {
    setRemoving(w);
    try {
      await removeHiddenWord(w);
      qc.setQueryData<string[]>(key, (rows) => (rows ?? []).filter((x) => x !== w));
      qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      showError(t, e, 'settings2.hiddenWords.removeFailed');
    } finally {
      setRemoving(null);
    }
  }

  const sorted = [...(words.data ?? [])].sort((a, b) => a.localeCompare(b));

  return (
    <Screen header={<TopBar title={t('settings2.hiddenWords.title')} />} contentStyle={styles.content}>
      <Note>{t('settings2.hiddenWords.note')}</Note>
      <View style={styles.form}>
        <View style={{ flex: 1 }}>
          <TextField
            value={draft}
            onChangeText={(v) => setDraft(v.slice(0, MAX))}
            placeholder={t('settings2.hiddenWords.placeholder')}
            accessibilityLabel={t('settings2.hiddenWords.placeholder')}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={MAX}
            returnKeyType="done"
            onSubmitEditing={add}
          />
        </View>
        <Button
          title={t('settings2.hiddenWords.add')}
          onPress={add}
          loading={adding}
          disabled={!clean || already}
          style={styles.addBtn}
        />
      </View>
      {already ? (
        <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 8 }}>{t('settings2.hiddenWords.already')}</Text>
      ) : null}

      {words.isLoading ? (
        <LoadingView />
      ) : words.isError ? (
        <ErrorView onRetry={() => words.refetch()} />
      ) : !sorted.length ? (
        <EmptyView icon="eye-off-outline" title={t('settings2.hiddenWords.empty')} />
      ) : (
        <View style={styles.chips}>
          {sorted.map((w) => (
            <View key={w} style={[styles.chip, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
              <Text style={{ color: colors.text, fontSize: 14 }}>{w}</Text>
              <Pressable
                onPress={() => remove(w)}
                disabled={removing === w}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('settings2.hiddenWords.remove', { word: w })}
              >
                <Ionicons name="close-circle" size={18} color={removing === w ? colors.muted2 : colors.muted} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  form: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 14 },
  addBtn: { marginVertical: 0, paddingHorizontal: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingStart: 14, paddingEnd: 8, height: 36, borderRadius: 18, borderWidth: 1 },
});
