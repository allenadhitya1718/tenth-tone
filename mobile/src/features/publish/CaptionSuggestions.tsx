import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { commentKeys, searchMentions } from '@/api/comments';
import { searchHashtags } from '@/api/discover';
import { formatCount } from '@/features/feed/format';
import { atHandle } from '@/lib/handle';
import { useTheme } from '@/providers/ThemeProvider';

export type CaptionToken = { kind: '#' | '@'; prefix: string; start: number; end: number };

// The #word or @word being typed right before the cursor. Like the comments
// composer, the sign must start a word so an e-mail address does not open
// the list. Hashtags follow the database's own rule (0016/0025:
// #([^\s#]{1,60})), so Arabic and other scripts work; handles are ASCII.
export function captionToken(text: string, cursor: number): CaptionToken | null {
  const before = text.slice(0, cursor);
  const tag = /(^|\s)#([^\s#@]{0,60})$/.exec(before);
  if (tag) return { kind: '#', prefix: tag[2], start: cursor - tag[2].length - 1, end: cursor };
  const at = /(^|\s)@([A-Za-z0-9_.]{0,30})$/.exec(before);
  if (at) return { kind: '@', prefix: at[2], start: cursor - at[2].length - 1, end: cursor };
  return null;
}

// The caption with the token replaced by the picked #tag / @handle and a
// trailing space, plus where the cursor goes; null when it would not fit.
export function applyCaptionPick(text: string, token: CaptionToken, value: string, max: number) {
  const insert = `${token.kind}${value} `;
  const next = text.slice(0, token.start) + insert + text.slice(token.end);
  if (next.length > max) return null;
  return { text: next, cursor: token.start + insert.length };
}

type Item = { key: string; value: string; label: string; sub: string | null; avatar: string | null };

// A short list right under the caption (so it stays above the keyboard):
// hashtags from the hashtags table (trending when only '#' is typed), people
// from search_handles via the comments mention search. Tap to insert.
export function CaptionSuggestions({ token, onPick }: { token: CaptionToken | null; onPick: (value: string) => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [debounced, setDebounced] = useState<{ kind: '#' | '@'; prefix: string } | null>(null);
  const kind = token?.kind;
  const prefix = token?.prefix;
  useEffect(() => {
    const next = kind !== undefined && prefix !== undefined ? { kind, prefix } : null;
    const id = setTimeout(() => setDebounced(next), next?.prefix ? 150 : 0);
    return () => clearTimeout(id);
  }, [kind, prefix]);

  const live = !!token && debounced?.kind === token.kind && debounced.prefix === token.prefix;
  const tags = useQuery({
    queryKey: ['captionHashtags', debounced?.prefix.toLowerCase() ?? ''],
    queryFn: () => searchHashtags(debounced?.prefix ?? '', 6),
    enabled: live && debounced?.kind === '#',
    staleTime: 60_000,
  });
  const people = useQuery({
    queryKey: commentKeys.mentions(debounced?.prefix ?? ''),
    queryFn: () => searchMentions(debounced?.prefix ?? '', 5),
    enabled: live && debounced?.kind === '@' && !!debounced.prefix,
    staleTime: 60_000,
  });

  if (!live || !token) return null;
  const items: Item[] =
    token.kind === '#'
      ? (tags.data ?? [])
          .filter((h) => h.tag && h.tag.toLowerCase() !== token.prefix.toLowerCase())
          .map((h) => ({
            key: `#${h.tag}`,
            value: h.tag,
            label: `#${h.tag}`,
            sub: h.usage_count ? t('polish.caption.tagUses', { count: h.usage_count, n: formatCount(h.usage_count) }) : null,
            avatar: null,
          }))
      : (people.data ?? []).map((p) => ({
          key: p.id,
          value: p.handle,
          label: atHandle(p.handle),
          sub: p.name,
          avatar: p.avatar_url,
        }));
  if (!items.length) return null;

  return (
    <View
      style={[styles.list, { borderColor: colors.border, backgroundColor: colors.bg2 }]}
      accessibilityLabel={t(token.kind === '#' ? 'polish.caption.tagList' : 'ugc.mentionList')}
    >
      {items.map((it) => (
        <Pressable
          key={it.key}
          onPress={() => onPick(it.value)}
          style={styles.row}
          accessibilityRole="button"
          accessibilityLabel={it.sub ? `${it.label}, ${it.sub}` : it.label}
        >
          {token.kind === '@' ? (
            it.avatar ? (
              <Image source={{ uri: it.avatar }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.initial, { backgroundColor: colors.primary }]}>
                <Text style={styles.initialText}>{(it.sub ?? it.value).slice(0, 1)}</Text>
              </View>
            )
          ) : null}
          <Text style={[styles.label, { color: colors.text }]} numberOfLines={1}>
            {it.label}
          </Text>
          {it.sub ? (
            <Text style={[styles.sub, { color: colors.muted }]} numberOfLines={1}>
              {it.sub}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, marginTop: 6, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9 },
  avatar: { width: 26, height: 26, borderRadius: 13 },
  initial: { alignItems: 'center', justifyContent: 'center' },
  initialText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  label: { fontSize: 14.5, fontWeight: '700', flexShrink: 1 },
  sub: { fontSize: 13, flexShrink: 1 },
});
