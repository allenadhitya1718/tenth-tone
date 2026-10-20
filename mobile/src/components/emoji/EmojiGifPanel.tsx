import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import type { Gif } from '@/api/gifs';
import { useTheme } from '@/providers/ThemeProvider';

import { EmojiPanel } from './EmojiPanel';
import { GifPanel, useGifQuery } from './GifPanel';

type Tab = 'emoji' | 'gif';

type Props = {
  onPickEmoji: (e: string) => void;
  onPickGif: (gif: Gif) => void;
  // Screen-reader hint for a GIF cell: what a tap does here.
  gifPickHint: string;
  // Told when the GIF search field gains or loses focus, so the parent does
  // not close the panel when that field brings the keyboard up.
  onGifSearchFocusChange?: (focused: boolean) => void;
  height?: number;
  // The GIF tab's height while its search field has the keyboard: one row of
  // results stays visible above the keyboard.
  compactHeight?: number;
};

// "Emoji | GIF", in place of the keyboard (owner request: like WhatsApp and
// Instagram). Trending GIFs are fetched when the panel opens (cached for ten
// minutes): that warms the GIF tab and tells whether gif-search is deployed
// with a key. When it is not, the GIF tab is not offered.
export function EmojiGifPanel({
  onPickEmoji,
  onPickGif,
  gifPickHint,
  onGifSearchFocusChange,
  height = 260,
  compactHeight = 210,
}: Props) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const [tab, setTab] = useState<Tab>('emoji');
  const [searching, setSearching] = useState(false);
  const lang = (i18n.language || 'en').slice(0, 2);
  const probe = useGifQuery('', lang);
  const unavailable = probe.error instanceof ApiError && probe.error.code === 'gif_unavailable';
  // Never pull the tab out from under someone who is on it: the GIF tab says
  // "not available" itself.
  const showGifTab = !unavailable || tab === 'gif';

  // Closing the panel unmounts the search field without a blur event: tell
  // the parent the search is over, or it would keep ignoring the keyboard.
  const notify = useRef(onGifSearchFocusChange);
  useEffect(() => {
    notify.current = onGifSearchFocusChange;
  }, [onGifSearchFocusChange]);
  useEffect(() => () => notify.current?.(false), []);

  const onFocus = useCallback(
    (focused: boolean) => {
      setSearching(focused);
      onGifSearchFocusChange?.(focused);
    },
    [onGifSearchFocusChange],
  );

  const select = (next: Tab) => {
    if (next !== 'gif' && searching) onFocus(false);
    setTab(next);
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'emoji', label: t('gif.tabEmoji') },
    ...(showGifTab ? [{ key: 'gif' as const, label: t('gif.tabGif') }] : []),
  ];

  return (
    <View style={{ backgroundColor: colors.bg2 }}>
      {tabs.length > 1 ? (
        <View style={[styles.tabs, { borderTopColor: colors.border }]} accessibilityRole="tablist">
          {tabs.map((x) => {
            const on = x.key === tab;
            return (
              <Pressable
                key={x.key}
                onPress={() => select(x.key)}
                style={[styles.tab, on && { backgroundColor: colors.primarySoft }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                hitSlop={4}
              >
                <Text style={[styles.tabText, { color: on ? colors.primary2 : colors.muted }]}>{x.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {tab === 'gif' ? (
        <GifPanel
          height={searching ? compactHeight : height}
          onPick={onPickGif}
          onSearchFocusChange={onFocus}
          pickHint={gifPickHint}
        />
      ) : (
        <EmojiPanel onPick={onPickEmoji} height={height} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 5,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tab: { minWidth: 72, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 14, alignItems: 'center' },
  tabText: { fontSize: 14, fontWeight: '700' },
});
