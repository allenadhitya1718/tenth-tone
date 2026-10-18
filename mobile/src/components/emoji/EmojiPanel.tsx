import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/providers/ThemeProvider';

import { EMOJI_GROUPS, QUICK } from './emojis';

// Quick-reaction row shown above a composer.
export function QuickEmojis({ onPick }: { onPick: (e: string) => void }) {
  return (
    <View style={styles.quick}>
      {QUICK.map((e) => (
        <Pressable key={e} onPress={() => onPick(e)} hitSlop={4} accessibilityRole="button" accessibilityLabel={e}>
          <Text style={styles.quickEmoji}>{e}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// The full picker, in place of the keyboard (client note 9). The parent
// closes it when the keyboard opens or anything outside it is tapped
// (client note 29).
export function EmojiPanel({ onPick, height = 260 }: { onPick: (e: string) => void; height?: number }) {
  const { colors } = useTheme();
  const [group, setGroup] = useState(0);
  return (
    <View style={[styles.panel, { height, backgroundColor: colors.bg2, borderTopColor: colors.border }]}>
      <View style={[styles.groups, { borderBottomColor: colors.border }]}>
        {EMOJI_GROUPS.map((g, i) => (
          <Pressable
            key={g.key}
            onPress={() => setGroup(i)}
            accessibilityRole="tab"
            accessibilityState={{ selected: i === group }}
            style={[styles.groupBtn, i === group && { backgroundColor: colors.primarySoft }]}
          >
            <Text style={styles.groupIcon}>{g.icon}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        key={group}
        data={EMOJI_GROUPS[group].list}
        numColumns={8}
        keyExtractor={(e, i) => `${e}-${i}`}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={{ padding: 6 }}
        renderItem={({ item }) => (
          <Pressable onPress={() => onPick(item)} style={styles.cell} accessibilityRole="button" accessibilityLabel={item}>
            <Text style={styles.emoji}>{item}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  quick: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 6, paddingHorizontal: 8 },
  quickEmoji: { fontSize: 24 },
  panel: { borderTopWidth: StyleSheet.hairlineWidth },
  groups: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  groupBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  groupIcon: { fontSize: 20 },
  cell: { flex: 1 / 8, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 26 },
});
