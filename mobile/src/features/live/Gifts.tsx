import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Animated, Easing, FlatList, I18nManager, Pressable, StyleSheet, Text, View } from 'react-native';

import { fetchGifts, giftKeys, sendGift, type Gift } from '@/api/gifts';
import type { UserSummary } from '@/api/types';
import { fetchWallet, walletKeys } from '@/api/wallet';
import { showAlert } from '@/components/Dialog';
import { Button } from '@/components/ui';
import { formatCount } from '@/features/feed/format';
import { WALLET_LAUNCHED } from '@/features/wallet/launch';
import { CoinIcon } from '@/features/wallet/CoinIcon';
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

type GiftTrayProps = {
  visible: boolean;
  onClose: () => void;
  liveId: string;
  /** The host first, then accepted guests; never the sender. */
  recipients: UserSummary[];
  onSent: (txId: string, gift: Gift, to: UserSummary) => void;
};

export function GiftTray(props: GiftTrayProps) {
  return WALLET_LAUNCHED ? <GiftPicker {...props} /> : <GiftsComingSoon visible={props.visible} onClose={props.onClose} />;
}

// Before launch (./wallet/launch.ts): what gifts will be, no balance or catalogue.
function GiftsComingSoon({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const tint = isDark ? colors.primary2 : colors.primary;
  return (
    <Sheet visible={visible} onClose={onClose} title={t('live.gifts.title')}>
      <View style={styles.soon} accessibilityLiveRegion="polite">
        <View style={[styles.soonIcon, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="gift" size={36} color={tint} />
        </View>
        <Text style={[styles.soonBadge, { color: tint, borderColor: tint }]}>{t('live.wallet.soon.badge')}</Text>
        <Text style={[styles.soonTitle, { color: colors.text }]} accessibilityRole="header">
          {t('live.gifts.soonTitle')}
        </Text>
        <Text style={[styles.soonBody, { color: colors.muted }]}>{t('live.gifts.soonBody')}</Text>
        <Button title={t('live.wallet.soon.back')} onPress={onClose} style={{ alignSelf: 'stretch' }} />
      </View>
    </Sheet>
  );
}

// TikTok's gift panel: tap a gift to select it, tap its Send button to send.
// Right after a send, a round combo button counts down COMBO_MS; each tap
// sends the same gift to the same person again and restarts the count. The
// panel stays open so a viewer can keep gifting.
const COMBO_MS = 3500;

type Combo = { gift: Gift; user: UserSummary; count: number; key: number };

function GiftPicker({ visible, onClose, liveId, recipients, onSent }: GiftTrayProps) {
  const { t, i18n } = useTranslation();
  const { colors, isDark } = useTheme();
  const qc = useQueryClient();
  const gifts = useGiftCatalogue(visible);
  const wallet = useQuery({ queryKey: walletKeys.balance(), queryFn: fetchWallet, enabled: visible });
  const [selected, setSelected] = useState<Gift | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [combo, setCombo] = useState<Combo | null>(null);

  const to = recipients.find((r) => r.id === toId) ?? recipients[0] ?? null;
  const balance = wallet.data?.balance ?? 0;

  // Closing the panel ends any combo.
  const close = () => {
    setCombo(null);
    onClose();
  };

  const send = useMutation({
    mutationFn: ({ gift, user }: { gift: Gift; user: UserSummary }) =>
      sendGift({ toUserId: user.id, giftId: gift.id, liveStreamId: liveId }),
    onSuccess: (txId, { gift, user }) => {
      void qc.invalidateQueries({ queryKey: walletKeys.all() });
      setCombo((c) =>
        c && c.gift.id === gift.id && c.user.id === user.id
          ? { ...c, count: c.count + 1, key: c.key + 1 }
          : { gift, user, count: 1, key: Date.now() },
      );
      onSent(txId, gift, user);
    },
    onError: (e) => {
      setCombo(null);
      void qc.invalidateQueries({ queryKey: walletKeys.balance() });
      if (errorCode(e) === 'insufficient_balance') {
        showAlert(t('live.gifts.lowTitle'), t('live.gifts.lowBody'), [
          { text: t('live.cancel'), style: 'cancel' },
          { text: t('live.gifts.recharge'), onPress: openWallet },
        ]);
        return;
      }
      showAlert(t('live.gifts.failed'), t(liveError(e).key));
    },
  });

  function openWallet() {
    close();
    router.push('/wallet');
  }

  function sendGiftTo(gift: Gift, user: UserSummary | null) {
    if (!user) return;
    // Checked here too so a short balance answers at once, without a round trip.
    if (wallet.data && balance < gift.price) {
      showAlert(t('live.gifts.lowTitle'), t('live.gifts.lowBody'), [
        { text: t('live.cancel'), style: 'cancel' },
        { text: t('live.gifts.recharge'), onPress: openWallet },
      ]);
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    send.mutate({ gift, user });
  }

  const endCombo = useCallback(() => setCombo(null), []);
  const tint = isDark ? colors.primary2 : colors.primary;

  return (
    <Sheet visible={visible} onClose={close} title={t('live.gifts.title')}>
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
                  onPress={() => {
                    setToId(item.id);
                    setCombo(null);
                  }}
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
          style={{ maxHeight: 320 }}
          contentContainerStyle={{ padding: 8 }}
          extraData={selected?.id}
          renderItem={({ item }) => (
            <GiftCell
              gift={item}
              name={giftName(item, i18n.language)}
              selected={selected?.id === item.id}
              onSelect={(g) => {
                setSelected(g);
                if (combo && combo.gift.id !== g.id) setCombo(null);
              }}
              onSend={(g) => sendGiftTo(g, to)}
              sending={send.isPending && selected?.id === item.id}
              tint={tint}
              soft={colors.primarySoft}
              text={colors.text}
              muted={colors.muted}
              sendLabel={t('live.gifts.sendShort')}
              coinsLabel={t('live.gifts.coins', { count: item.price })}
            />
          )}
        />
      )}

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <View style={styles.balance} accessible accessibilityLabel={t('live.gifts.balanceA11y', { count: balance })}>
          <CoinIcon size={18} />
          {wallet.isLoading ? (
            <ActivityIndicator size="small" color={colors.muted} />
          ) : (
            <Text style={[styles.balanceText, { color: colors.text }]}>{formatCount(balance)}</Text>
          )}
        </View>
        <Pressable
          onPress={openWallet}
          style={[styles.recharge, { backgroundColor: colors.primarySoft }]}
          accessibilityRole="button"
          accessibilityHint={t('live.gifts.openWallet')}
        >
          <Text style={[styles.topUp, { color: tint }]}>{t('live.gifts.recharge')}</Text>
          <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color={tint} />
        </Pressable>
        <View style={{ flex: 1 }} />
        {combo ? (
          <ComboButton
            combo={combo}
            label={t('live.gifts.combo')}
            a11y={t('live.gifts.comboA11y', { gift: giftName(combo.gift, i18n.language), count: combo.count })}
            onPress={() => sendGiftTo(combo.gift, combo.user)}
            onEnd={endCombo}
          />
        ) : null}
      </View>
    </Sheet>
  );
}

// The round combo button: a ring that empties over COMBO_MS, restarted by
// every send. When it runs out the combo ends.
function ComboButton({ combo, label, a11y, onPress, onEnd }: { combo: Combo; label: string; a11y: string; onPress: () => void; onEnd: () => void }) {
  const [left] = useState(() => new Animated.Value(1));
  const [pop] = useState(() => new Animated.Value(1));
  useEffect(() => {
    left.setValue(1);
    pop.setValue(1.15);
    Animated.spring(pop, { toValue: 1, friction: 4, useNativeDriver: true }).start();
    const run = Animated.timing(left, { toValue: 0, duration: COMBO_MS, easing: Easing.linear, useNativeDriver: false });
    run.start(({ finished }) => {
      if (finished) onEnd();
    });
    return () => run.stop();
  }, [combo.key, left, pop, onEnd]);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} hitSlop={8}>
      <Animated.View style={[styles.combo, { transform: [{ scale: pop }] }]}>
        <Animated.View
          style={[styles.comboFill, { height: left.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}
        />
        <GiftGlyph gift={combo.gift} size={26} />
        <Text style={styles.comboLabel}>{label}</Text>
        <Text style={styles.comboCount}>×{combo.count}</Text>
      </Animated.View>
    </Pressable>
  );
}

const GiftCell = memo(function GiftCell({
  gift,
  name,
  selected,
  onSelect,
  onSend,
  sending,
  tint,
  soft,
  text,
  muted,
  sendLabel,
  coinsLabel,
}: {
  gift: Gift;
  name: string;
  selected: boolean;
  onSelect: (g: Gift) => void;
  onSend: (g: Gift) => void;
  sending: boolean;
  tint: string;
  soft: string;
  text: string;
  muted: string;
  sendLabel: string;
  coinsLabel: string;
}) {
  return (
    <Pressable
      onPress={() => (selected ? onSend(gift) : onSelect(gift))}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${name}, ${coinsLabel}`}
      accessibilityHint={selected ? sendLabel : undefined}
      style={[styles.cell, selected && { borderColor: tint, backgroundColor: soft }]}
    >
      <View style={selected ? styles.glyphUp : undefined}>
        <GiftGlyph gift={gift} size={selected ? 46 : 40} />
      </View>
      {selected ? (
        <View style={[styles.sendPill, { backgroundColor: tint }]}>
          {sending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.sendPillText}>{sendLabel}</Text>}
        </View>
      ) : (
        <>
          <Text style={[styles.cellName, { color: text }]} numberOfLines={1}>
            {name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <CoinIcon size={11} />
            <Text style={[styles.cellPrice, { color: muted }]}>{formatCount(gift.price)}</Text>
          </View>
        </>
      )}
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

// ---------- full-screen moment for a big gift ----------

// TikTok plays large gifts across the whole screen. From BIG_GIFT coins up,
// a gift gets its own centre-stage moment (one at a time, queued) on top of
// the usual banner. Never blocks touches.
export const BIG_GIFT = 499;
const SPOT_MS = 2600;

export type SpotEvent = { id: number; sender: string; gift: Pick<Gift, 'name' | 'name_en' | 'emoji' | 'asset_url'> };

export function useGiftSpotlight() {
  const [queue, setQueue] = useState<SpotEvent[]>([]);
  const seq = useRef(0);
  const push = useCallback((e: Omit<SpotEvent, 'id'>) => {
    const id = ++seq.current;
    setQueue((q) => [...q, { ...e, id }].slice(-10));
  }, []);
  const shift = useCallback(() => setQueue((q) => q.slice(1)), []);
  return { current: queue[0] ?? null, push, shift };
}

export function GiftSpotlight({ event, onDone }: { event: SpotEvent | null; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const [v] = useState(() => new Animated.Value(0));
  const key = event?.id;
  useEffect(() => {
    if (!key) return;
    v.setValue(0);
    const run = Animated.sequence([
      Animated.spring(v, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }),
      Animated.delay(SPOT_MS),
      Animated.timing(v, { toValue: 2, duration: 350, useNativeDriver: true }),
    ]);
    run.start(({ finished }) => {
      if (finished) onDone();
    });
    return () => run.stop();
  }, [key, v, onDone]);
  if (!event) return null;
  const name = giftName(event.gift, i18n.language);
  const text = t('live.gifts.banner', { sender: event.sender, gift: name });
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.spotWrap]} accessibilityLiveRegion="polite" accessibilityLabel={text}>
      <Animated.View
        style={{
          alignItems: 'center',
          opacity: v.interpolate({ inputRange: [0, 0.3, 1, 2], outputRange: [0, 1, 1, 0] }),
          transform: [
            { scale: v.interpolate({ inputRange: [0, 1, 2], outputRange: [0.3, 1, 1.25] }) },
            { translateY: v.interpolate({ inputRange: [0, 1, 2], outputRange: [60, 0, -40] }) },
          ],
        }}
      >
        <View style={styles.spotGlow}>
          <GiftGlyph gift={event.gift} size={150} />
        </View>
        <Text style={styles.spotText} numberOfLines={2}>
          {text}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  spotWrap: { alignItems: 'center', justifyContent: 'center' },
  spotGlow: { width: 210, height: 210, borderRadius: 105, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,201,60,0.18)' },
  spotText: { color: '#fff', fontSize: 17, fontWeight: '900', textAlign: 'center', marginTop: 10, paddingHorizontal: 32, textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 6 },
  soon: { alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20 },
  soonIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  soonBadge: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 3, overflow: 'hidden' },
  soonTitle: { fontSize: 20, fontWeight: '800', textAlign: 'center' },
  soonBody: { fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 320, marginBottom: 6 },
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
  recharge: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 36, paddingStart: 12, paddingEnd: 8, borderRadius: 18 },
  glyphUp: { marginTop: -4 },
  sendPill: { minWidth: 64, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, marginTop: 4 },
  sendPillText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  combo: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: 'rgba(232,71,138,0.45)',
    borderWidth: 2,
    borderColor: '#E8478A',
  },
  comboFill: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#E8478A' },
  comboLabel: { color: '#fff', fontSize: 11, fontWeight: '800' },
  comboCount: { color: '#FFE27A', fontSize: 14, fontWeight: '900' },
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
