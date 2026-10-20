import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Animated, FlatList, I18nManager, Pressable, StyleSheet, Text, View } from 'react-native';

import { fetchGifts, giftKeys, sendGift, type Gift } from '@/api/gifts';
import type { UserSummary } from '@/api/types';
import { fetchWallet, walletKeys } from '@/api/wallet';
import { showAlert } from '@/components/Dialog';
import { Button } from '@/components/ui';
import { formatCount } from '@/features/feed/format';
import { useTheme } from '@/providers/ThemeProvider';

import { errorCode, liveError } from './errors';
import { Avatar, Sheet } from './Sheet';

// Live gifts (client note 17). Money only moves inside send_gift on the
// server; this screen never touches a balance, it only re-reads it.

export function giftName(gift: Pick<Gift, 'name' | 'name_en'>, lang: string) {
  return lang.startsWith('ar') ? gift.name : gift.name_en || gift.name;
}

// asset_url may be a Lottie JSON (0104); only still images are drawn here,
// anything else falls back to the emoji.
const isImage = (url: string | null) => !!url && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);

export function GiftGlyph({ gift, size }: { gift: Pick<Gift, 'emoji' | 'asset_url'>; size: number }) {
  if (isImage(gift.asset_url)) {
    return <Image source={{ uri: gift.asset_url! }} style={{ width: size, height: size }} contentFit="contain" accessibilityIgnoresInvertColors />;
  }
  return <Text style={{ fontSize: size * 0.8 }}>{gift.emoji || '🎁'}</Text>;
}

export function useGiftCatalogue(enabled = true) {
  return useQuery({ queryKey: giftKeys.catalogue(), queryFn: fetchGifts, staleTime: 10 * 60_000, enabled });
}

export function GiftTray({
  visible,
  onClose,
  liveId,
  recipients,
  onSent,
}: {
  visible: boolean;
  onClose: () => void;
  liveId: string;
  /** The host first, then accepted guests; never the sender. */
  recipients: UserSummary[];
  onSent: (txId: string, gift: Gift, to: UserSummary) => void;
}) {
  const { t, i18n } = useTranslation();
  const { colors, isDark } = useTheme();
  const qc = useQueryClient();
  const gifts = useGiftCatalogue(visible);
  const wallet = useQuery({ queryKey: walletKeys.balance(), queryFn: fetchWallet, enabled: visible });
  const [selected, setSelected] = useState<Gift | null>(null);
  const [toId, setToId] = useState<string | null>(null);

  const to = recipients.find((r) => r.id === toId) ?? recipients[0] ?? null;
  const balance = wallet.data?.balance ?? 0;

  const send = useMutation({
    mutationFn: ({ gift, user }: { gift: Gift; user: UserSummary }) =>
      sendGift({ toUserId: user.id, giftId: gift.id, liveStreamId: liveId }),
    onSuccess: (txId, { gift, user }) => {
      void qc.invalidateQueries({ queryKey: walletKeys.all() });
      onSent(txId, gift, user);
    },
    onError: (e) => {
      void qc.invalidateQueries({ queryKey: walletKeys.balance() });
      if (errorCode(e) === 'insufficient_balance') {
        showAlert(t('live.gifts.lowTitle'), t('live.gifts.lowBody'), [
          { text: t('live.cancel'), style: 'cancel' },
          { text: t('live.gifts.topUp'), onPress: openWallet },
        ]);
        return;
      }
      showAlert(t('live.gifts.failed'), t(liveError(e).key));
    },
  });

  function openWallet() {
    onClose();
    router.push('/wallet');
  }

  function submit() {
    if (!selected || !to || send.isPending) return;
    send.mutate({ gift: selected, user: to });
  }

  const tint = isDark ? colors.primary2 : colors.primary;

  return (
    <Sheet visible={visible} onClose={onClose} title={t('live.gifts.title')}>
      {recipients.length > 1 ? (
        <View style={styles.toRow}>
          <Text style={[styles.toLabel, { color: colors.muted }]}>{t('live.gifts.to')}</Text>
          <FlatList
            horizontal
            data={recipients}
            keyExtractor={(r) => r.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingEnd: 16 }}
            renderItem={({ item }) => {
              const on = item.id === to?.id;
              return (
                <Pressable
                  onPress={() => setToId(item.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={item.name || item.handle || t('live.someone')}
                  style={[styles.toChip, { borderColor: on ? tint : colors.border, backgroundColor: on ? colors.primarySoft : 'transparent' }]}
                >
                  <Avatar uri={item.avatar_url} name={item.name} size={26} />
                  <Text style={[styles.toName, { color: colors.text }]} numberOfLines={1}>
                    {item.name || item.handle || t('live.someone')}
                  </Text>
                </Pressable>
              );
            }}
          />
        </View>
      ) : null}

      {gifts.isLoading ? (
        <ActivityIndicator style={{ marginVertical: 40 }} color={colors.primary} />
      ) : gifts.isError ? (
        <View style={styles.center}>
          <Text style={[styles.muted, { color: colors.muted }]}>{t('live.gifts.loadFailed')}</Text>
          <Button title={t('live.retry')} variant="secondary" onPress={() => void gifts.refetch()} />
        </View>
      ) : !gifts.data?.length ? (
        <Text style={[styles.muted, styles.center, { color: colors.muted }]}>{t('live.gifts.empty')}</Text>
      ) : (
        <FlatList
          data={gifts.data}
          keyExtractor={(g) => g.id}
          numColumns={4}
          style={{ maxHeight: 300 }}
          contentContainerStyle={{ padding: 8 }}
          renderItem={({ item }) => (
            <GiftCell
              gift={item}
              name={giftName(item, i18n.language)}
              selected={selected?.id === item.id}
              onPress={setSelected}
              tint={tint}
              soft={colors.primarySoft}
              text={colors.text}
              muted={colors.muted}
              coinsLabel={t('live.gifts.coins', { count: item.price })}
            />
          )}
        />
      )}

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <Pressable
          onPress={openWallet}
          style={styles.balance}
          accessibilityRole="button"
          accessibilityLabel={t('live.gifts.balanceA11y', { count: balance })}
          accessibilityHint={t('live.gifts.openWallet')}
        >
          <Text style={styles.coin}>🪙</Text>
          {wallet.isLoading ? (
            <ActivityIndicator size="small" color={colors.muted} />
          ) : (
            <Text style={[styles.balanceText, { color: colors.text }]}>{formatCount(balance)}</Text>
          )}
          <Text style={[styles.topUp, { color: tint }]}>{t('live.gifts.topUp')}</Text>
          <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color={tint} />
        </Pressable>
        <Button
          title={selected ? t('live.gifts.sendNamed', { name: giftName(selected, i18n.language) }) : t('live.gifts.send')}
          onPress={submit}
          disabled={!selected || !to}
          loading={send.isPending}
          style={styles.sendBtn}
        />
      </View>
    </Sheet>
  );
}

const GiftCell = memo(function GiftCell({
  gift,
  name,
  selected,
  onPress,
  tint,
  soft,
  text,
  muted,
  coinsLabel,
}: {
  gift: Gift;
  name: string;
  selected: boolean;
  onPress: (g: Gift) => void;
  tint: string;
  soft: string;
  text: string;
  muted: string;
  coinsLabel: string;
}) {
  return (
    <Pressable
      onPress={() => onPress(gift)}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${name}, ${coinsLabel}`}
      style={[styles.cell, selected && { borderColor: tint, backgroundColor: soft }]}
    >
      <GiftGlyph gift={gift} size={40} />
      <Text style={[styles.cellName, { color: text }]} numberOfLines={1}>
        {name}
      </Text>
      <Text style={[styles.cellPrice, { color: muted }]}>🪙 {formatCount(gift.price)}</Text>
    </Pressable>
  );
});

// ---------- the banner for gifts arriving in the room ----------

export type GiftEvent = { id: number; key: string; sender: string; recipient: string | null; gift: Pick<Gift, 'name' | 'name_en' | 'emoji' | 'asset_url'>; count: number };

const SHOW_MS = 2800;

// A queue shown one at a time. A repeat of the same gift from the same sender
// while it is on screen (or waiting) adds to its count instead of queueing
// another banner, so a burst reads "x5" rather than five banners.
export function useGiftBanner() {
  const [queue, setQueue] = useState<GiftEvent[]>([]);
  const seq = useRef(0);
  const push = useCallback((e: Omit<GiftEvent, 'count' | 'id'>) => {
    const id = ++seq.current;
    setQueue((q) => {
      const i = q.findIndex((x) => x.key === e.key);
      if (i >= 0) return q.map((x, j) => (j === i ? { ...x, count: x.count + 1 } : x));
      return [...q, { ...e, id, count: 1 }].slice(-20);
    });
  }, []);
  const shift = useCallback(() => setQueue((q) => q.slice(1)), []);
  return { current: queue[0] ?? null, push, shift };
}

export function GiftBanner({ event, onDone }: { event: GiftEvent | null; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const [slide] = useState(() => new Animated.Value(0));
  // The entry's own id, not its combo key: the same gift from the same person
  // can come round again after its banner has gone.
  const key = event?.id;
  const count = event?.count ?? 0;

  useEffect(() => {
    if (!key) return;
    slide.setValue(0);
    Animated.spring(slide, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
  }, [key, slide]);

  // Restarted by every repeat, so a combo stays up while it grows.
  useEffect(() => {
    if (!key) return;
    const timer = setTimeout(() => {
      Animated.timing(slide, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => onDone());
    }, SHOW_MS);
    return () => clearTimeout(timer);
  }, [key, count, slide, onDone]);

  if (!event) return null;
  const name = giftName(event.gift, i18n.language);
  const text = event.recipient
    ? t('live.gifts.bannerTo', { sender: event.sender, gift: name, recipient: event.recipient, count: event.count })
    : t('live.gifts.banner', { sender: event.sender, gift: name, count: event.count });
  const from = I18nManager.isRTL ? 240 : -240;
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityLabel={text}
      style={[
        styles.banner,
        {
          opacity: slide,
          transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }],
        },
      ]}
    >
      <GiftGlyph gift={event.gift} size={30} />
      <Text style={styles.bannerText} numberOfLines={2}>
        {text}
      </Text>
      <Text style={styles.bannerCount}>×{event.count}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingStart: 16, paddingVertical: 10 },
  toLabel: { fontSize: 13, fontWeight: '600' },
  toChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingStart: 4, paddingEnd: 10, minHeight: 36, borderRadius: 18, borderWidth: 1.5 },
  toName: { fontSize: 13, fontWeight: '600', maxWidth: 110 },
  center: { alignItems: 'center', paddingVertical: 30, paddingHorizontal: 24, gap: 8 },
  muted: { fontSize: 14, textAlign: 'center' },
  cell: { flex: 1 / 4, alignItems: 'center', paddingVertical: 10, gap: 3, borderRadius: 14, borderWidth: 1.5, borderColor: 'transparent', minHeight: 44 },
  cellName: { fontSize: 12, fontWeight: '600' },
  cellPrice: { fontSize: 11 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  balance: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
  coin: { fontSize: 18 },
  balanceText: { fontSize: 16, fontWeight: '800', marginEnd: 6 },
  topUp: { fontSize: 14, fontWeight: '700' },
  sendBtn: { flex: 1, height: 46 },
  banner: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '86%',
    marginStart: 12,
    paddingVertical: 6,
    paddingStart: 8,
    paddingEnd: 14,
    borderRadius: 24,
    backgroundColor: 'rgba(232,71,138,0.9)',
  },
  bannerText: { color: '#fff', fontSize: 13, fontWeight: '700', flexShrink: 1 },
  bannerCount: { color: '#FFE27A', fontSize: 18, fontWeight: '900' },
});
