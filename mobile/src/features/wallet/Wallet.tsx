import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  fetchCoinPackages,
  fetchMyTopups,
  fetchWallet,
  fetchWalletTransactions,
  creatorKeys,
  isDiamondGift,
  walletKeys,
  type CoinPackage,
  type WalletTopup,
  type WalletTransaction,
  type WalletTransactionType,
} from '@/api/wallet';
import { showToast } from '@/components/Toast';
import { AppText, Button, TextField, TopBar } from '@/components/ui';
import { Sheet } from '@/features/live/Sheet';
import { CoinIcon } from '@/features/wallet/CoinIcon';
import { CreatorEarnings } from '@/features/wallet/CreatorEarnings';
import {
  buyCoins,
  connectStore,
  getStoreSnapshot,
  onPurchaseNotice,
  reconnectStore,
  subscribeStore,
  type PurchaseNotice,
} from '@/features/wallet/store';
import { useTheme } from '@/providers/ThemeProvider';

type Tab = 'recharge' | 'earnings' | 'history';

const STORE = Platform.OS === 'ios' ? 'App Store' : 'Google Play';

const TX_ICON: Record<WalletTransactionType, ComponentProps<typeof Ionicons>['name']> = {
  topup: 'add-circle',
  gift_sent: 'gift-outline',
  gift_received: 'gift',
  withdrawal: 'arrow-up-circle-outline',
};

// The balance card is a deep night-blue gradient in both themes.
const HERO = ['#0B1A4A', '#1E56D6'] as const;
// The coin wallet (client note 12): balance, coin packs, creator earnings and
// history, as three tabs under the balance with the checkout pinned below.
//
// App Review 3.1.1 / Play Billing: coins are a digital good, so they are only
// sold through the App Store / Google Play as consumable in-app purchases
// (./store.ts). Prices are the store's localized ones. This screen only READS
// money: coins are credited on the server after verify-purchase has checked
// the purchase with the store (credit_wallet_topup, 0104), never by the app.
export function Wallet() {
  const { t, i18n } = useTranslation();
  const { colors, isDark } = useTheme();
  const balance = useQuery({ queryKey: walletKeys.balance(), queryFn: fetchWallet });
  const txs = useQuery({ queryKey: walletKeys.transactions(), queryFn: () => fetchWalletTransactions() });
  const packages = useQuery({ queryKey: walletKeys.packages(), queryFn: fetchCoinPackages });
  const topups = useQuery({ queryKey: walletKeys.topups(), queryFn: fetchMyTopups });
  const queryClient = useQueryClient();
  const store = useSyncExternalStore(subscribeStore, getStoreSnapshot, getStoreSnapshot);
  const [notice, setNotice] = useState<PurchaseNotice | null>(null);
  const [tab, setTab] = useState<Tab>('recharge');
  const productIds = useMemo(() => (packages.data ?? []).map((p) => p.product_id), [packages.data]);
  const tint = isDark ? colors.primary2 : colors.primary;
  const num = (n: number) => n.toLocaleString(i18n.language);
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' });

  // Connect to the store (also settles unfinished purchases) and load the
  // localized prices of the packages on sale.
  useEffect(() => {
    void connectStore(productIds);
  }, [productIds]);

  useEffect(
    () =>
      onPurchaseNotice((n) => {
        if (n.kind === 'credited' || n.kind === 'otherAccount' || n.kind === 'pending') {
          void queryClient.invalidateQueries({ queryKey: walletKeys.all() });
        }
        if (n.userInitiated) setNotice(n);
        else if (n.kind === 'credited' && n.coins > 0) {
          showToast(t('live.wallet.toastAdded', { count: n.coins, n: n.coins.toLocaleString(i18n.language) }), 'add-circle');
        }
      }),
    [queryClient, t, i18n.language],
  );

  // ---------- recharge choice (kept here so the checkout bar can see it) ----------
  const list = useMemo(() => packages.data ?? [], [packages.data]);
  const [pick, setPick] = useState<string | null>(null);
  // Custom amount: the stores only sell fixed products, so the amount typed
  // picks the smallest pack that covers it (or the biggest pack when it is
  // more than any single pack holds).
  const [custom, setCustom] = useState(false);
  const [customText, setCustomText] = useState('');
  const wanted = Number(customText.replace(/[^0-9]/g, '')) || 0;
  const coinsOf = (p: CoinPackage) => p.coins + p.bonus_coins;
  const byCoins = useMemo(() => [...list].sort((a, b) => a.coins + a.bonus_coins - (b.coins + b.bonus_coins)), [list]);
  const customPack = wanted > 0 ? (byCoins.find((p) => coinsOf(p) >= wanted) ?? byCoins[byCoins.length - 1] ?? null) : null;
  const chosen = custom ? customPack : (list.find((p) => p.product_id === pick) ?? list[0] ?? null);
  // SAR per coin from the packs' price labels: what one coin costs, and the
  // pack that is cheapest per coin (the smallest one if several tie).
  const rates = useMemo(
    () =>
      list.map((p) => ({ id: p.product_id, rate: Number((p.price_label ?? '').replace(/[^0-9.]/g, '')) / (p.coins + p.bonus_coins) })),
    [list],
  );
  const valid = rates.filter((r) => Number.isFinite(r.rate) && r.rate > 0);
  const perCoin = valid.length ? { low: Math.min(...valid.map((r) => r.rate)), high: Math.max(...valid.map((r) => r.rate)) } : null;
  const bestId =
    perCoin && perCoin.high - perCoin.low >= 0.0005 ? (byCoins.find((p) => valid.some((r) => r.id === p.product_id && r.rate - perCoin.low < 0.0005))?.product_id ?? null) : null;
  const product = chosen ? store.products[chosen.product_id] : undefined;
  const canBuy = store.status === 'ready' && !!product;
  // The store's localized price, or the package's own label when the store
  // returns the product with a blank price (seen on Google Play test builds).
  const priceOf = (p: CoinPackage) => store.products[p.product_id]?.displayPrice || p.price_label || '';

  const refreshing = balance.isRefetching || txs.isRefetching || packages.isRefetching || topups.isRefetching;
  const refresh = () => {
    void balance.refetch();
    void txs.refetch();
    void packages.refetch();
    void topups.refetch();
    void queryClient.invalidateQueries({ queryKey: creatorKeys.all() });
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'recharge', label: t('live.wallet.recharge') },
    { key: 'earnings', label: t('live.wallet.tabEarnings') },
    { key: 'history', label: t('live.wallet.history') },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <TopBar title={t('live.wallet.title')} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.muted} />}
      >
        {/* Balance */}
        <LinearGradient
          colors={HERO}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
          accessible
          accessibilityLabel={t('live.wallet.balanceA11y', { count: balance.data?.balance ?? 0 })}
        >
          <View style={styles.heroGlow} />
          <Text style={styles.heroLabel}>{t('live.wallet.balance').toUpperCase()}</Text>
          {balance.isLoading ? (
            <ActivityIndicator color="#fff" style={{ alignSelf: 'flex-start', marginVertical: 14 }} />
          ) : balance.isError ? (
            <Pressable onPress={() => void balance.refetch()} accessibilityRole="button">
              <Text style={styles.heroError}>{t('live.wallet.balanceFailed')}</Text>
            </Pressable>
          ) : (
            <View style={styles.heroRow}>
              <CoinIcon size={34} />
              <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
                {num(balance.data?.balance ?? 0)}
              </Text>
            </View>
          )}
          <Text style={styles.heroSub}>{t('live.wallet.balanceSub')}</Text>
        </LinearGradient>

        {/* Tabs */}
        <View style={[styles.tabs, { backgroundColor: colors.bg2 }]} accessibilityRole="tablist">
          {TABS.map((x) => {
            const on = tab === x.key;
            return (
              <Pressable
                key={x.key}
                onPress={() => setTab(x.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                style={[styles.tab, on && { backgroundColor: colors.bg3 }]}
              >
                <Text style={[styles.tabText, { color: on ? colors.text : colors.muted }]}>{x.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {tab === 'recharge' ? (
          packages.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
          ) : packages.isError ? (
            <View style={styles.state}>
              <AppText variant="small" muted>
                {t('live.wallet.loadFailed')}
              </AppText>
              <Button title={t('live.retry')} variant="ghost" onPress={() => void packages.refetch()} />
            </View>
          ) : !list.length ? (
            <AppText variant="small" muted center style={{ marginVertical: 24 }}>
              {t('live.wallet.noPackages')}
            </AppText>
          ) : (
            <View style={{ gap: 12 }}>
              <View style={styles.grid} accessibilityRole="radiogroup">
                {list.map((p) => {
                  const total = coinsOf(p);
                  const on = !custom && p.product_id === chosen?.product_id;
                  const price = priceOf(p);
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => {
                        setCustom(false);
                        setPick(p.product_id);
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${t('live.wallet.coins', { count: total, n: num(total) })}, ${price}`}
                      style={[styles.tile, { backgroundColor: colors.bg2, borderColor: on ? tint : colors.border }]}
                    >
                      {p.product_id === bestId ? (
                        <View style={[styles.badge, { backgroundColor: tint }]}>
                          <Text style={styles.badgeText}>{t('live.wallet.bestValue')}</Text>
                        </View>
                      ) : null}
                      <View style={styles.tileCoins}>
                        <CoinIcon size={18} />
                        <Text style={[styles.tileValue, { color: colors.text }]}>{num(total)}</Text>
                      </View>
                      {p.bonus_coins ? (
                        <Text style={[styles.tileBonus, { color: colors.success }]}>{t('live.wallet.bonus', { n: num(p.bonus_coins) })}</Text>
                      ) : null}
                      <Text style={[styles.tilePrice, { color: on ? tint : colors.muted }]}>{price}</Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={() => setCustom(true)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: custom }}
                  accessibilityLabel={t('live.wallet.custom')}
                  style={[styles.tile, { backgroundColor: colors.bg2, borderColor: custom ? tint : colors.border, borderStyle: custom ? 'solid' : 'dashed' }]}
                >
                  <Ionicons name="create-outline" size={20} color={custom ? tint : colors.text} />
                  <Text style={[styles.tilePrice, { color: custom ? tint : colors.muted }]}>{t('live.wallet.custom')}</Text>
                </Pressable>
              </View>

              {custom ? (
                <View style={{ gap: 6 }}>
                  <TextField
                    value={customText}
                    onChangeText={(v) => setCustomText(v.replace(/[^0-9]/g, '').slice(0, 7))}
                    placeholder={t('live.wallet.customPlaceholder')}
                    keyboardType="number-pad"
                    autoFocus
                    accessibilityLabel={t('live.wallet.customPlaceholder')}
                  />
                  <AppText variant="small" muted>
                    {!customPack
                      ? t('live.wallet.customHint')
                      : coinsOf(customPack) === wanted
                        ? t('live.wallet.customExact', { price: priceOf(customPack) })
                        : wanted > coinsOf(customPack)
                          ? t('live.wallet.customTooMany', { n: num(coinsOf(customPack)), price: priceOf(customPack) })
                          : t('live.wallet.customMatch', { n: num(coinsOf(customPack)), price: priceOf(customPack) })}
                  </AppText>
                </View>
              ) : null}

              {perCoin ? (
                <View style={styles.infoRow}>
                  <Ionicons name="information-circle-outline" size={16} color={colors.muted} />
                  <AppText variant="small" muted style={{ flex: 1 }}>
                    {perCoin.high - perCoin.low < 0.0005
                      ? t('live.wallet.perCoinOne', { price: perCoin.low.toFixed(3) })
                      : t('live.wallet.perCoin', { low: perCoin.low.toFixed(3), high: perCoin.high.toFixed(3) })}
                  </AppText>
                </View>
              ) : null}
              {store.status === 'ready' && chosen && !product ? (
                <AppText variant="small" muted>
                  {t('live.wallet.productUnavailable', { store: STORE })}
                </AppText>
              ) : store.status === 'connecting' || store.status === 'idle' || store.status === 'ready' ? null : (
                <StoreNote status={store.status} onRetry={() => void reconnectStore(productIds)} />
              )}
            </View>
          )
        ) : null}

        {tab === 'earnings' ? <CreatorEarnings /> : null}

        {tab === 'history' ? (
          <View style={{ gap: 18 }}>
            <HistoryList
              title={t('live.wallet.history')}
              q={txs}
              emptyKey="live.wallet.noHistory"
              render={(x: WalletTransaction) => {
                const incoming = x.type === 'topup' || x.type === 'gift_received';
                // Since 0131 a received gift earns diamonds, not coins (amount 0).
                const diamondGift = isDiamondGift(x);
                return (
                  <View key={x.id} style={[styles.row, { borderBottomColor: colors.border }]} accessible>
                    <View style={[styles.rowIcon, { backgroundColor: incoming ? colors.primarySoft : colors.bg3 }]}>
                      <Ionicons name={TX_ICON[x.type] ?? 'swap-horizontal'} size={18} color={incoming ? tint : colors.muted} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowTitle, { color: colors.text }]}>{t(`live.wallet.tx.${x.type}`, { defaultValue: x.type })}</Text>
                      <Text style={[styles.rowSub, { color: colors.muted }]} numberOfLines={1}>
                        {x.description ? `${x.description} · ` : ''}
                        {date(x.created_at)}
                      </Text>
                    </View>
                    {diamondGift ? (
                      x.diamonds != null ? (
                        <Text style={[styles.amount, { color: colors.success }]}>
                          {t('live.wallet.diamondsEarned', { count: x.diamonds, n: num(x.diamonds) })}
                        </Text>
                      ) : null
                    ) : (
                      <Text style={[styles.amount, { color: incoming ? colors.success : colors.text }]}>
                        {incoming ? '+' : '−'}
                        {num(x.amount)}
                      </Text>
                    )}
                  </View>
                );
              }}
            />
            <HistoryList
              title={t('live.wallet.topups')}
              q={topups}
              emptyKey="live.wallet.noTopups"
              render={(u: WalletTopup) => {
                const tone = u.status === 'credited' ? colors.success : u.status === 'rejected' ? colors.danger : colors.warn;
                return (
                  <View key={u.id} style={[styles.row, { borderBottomColor: colors.border }]} accessible>
                    <View style={[styles.rowIcon, { backgroundColor: colors.bg3 }]}>
                      <Ionicons name={u.platform === 'ios' ? 'logo-apple' : 'logo-google-playstore'} size={16} color={colors.muted} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowTitle, { color: colors.text }]}>{t('live.wallet.coins', { count: u.coins, n: num(u.coins) })}</Text>
                      <Text style={[styles.rowSub, { color: colors.muted }]}>{date(u.created_at)}</Text>
                    </View>
                    <Text style={[styles.status, { color: tone, borderColor: tone }]}>{t(`live.wallet.status.${u.status}`)}</Text>
                  </View>
                );
              }}
            />
          </View>
        ) : null}
      </ScrollView>

      {/* Checkout, pinned: what is picked, its price, and the one button. */}
      {tab === 'recharge' && list.length ? (
        <View style={[styles.checkout, { backgroundColor: colors.bg, borderTopColor: colors.border }]}>
          <View style={styles.checkoutRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              {chosen ? (
                <>
                  <View style={styles.tileCoins}>
                    <CoinIcon size={16} />
                    <Text style={[styles.checkoutCoins, { color: colors.text }]} numberOfLines={1}>
                      {num(coinsOf(chosen))}
                    </Text>
                  </View>
                  <Text style={[styles.rowSub, { color: colors.muted }]} numberOfLines={1}>
                    {priceOf(chosen)}
                  </Text>
                </>
              ) : (
                <Text style={[styles.rowSub, { color: colors.muted }]}>{t('live.wallet.customHint')}</Text>
              )}
            </View>
            <Button
              title={t('live.wallet.recharge')}
              loading={!!chosen && store.buying === chosen.product_id}
              disabled={!canBuy || !!store.buying}
              onPress={() => chosen && void buyCoins(chosen.product_id)}
              style={styles.checkoutBtn}
            />
          </View>
          <View style={styles.secureRow}>
            <Ionicons name="lock-closed" size={12} color={colors.muted} />
            <Text style={[styles.secureText, { color: colors.muted }]}>{t('live.wallet.secure', { store: STORE })}</Text>
          </View>
        </View>
      ) : null}

      <PurchaseResult notice={notice} onClose={() => setNotice(null)} />
    </SafeAreaView>
  );
}

function HistoryList<T>({
  title,
  q,
  emptyKey,
  render,
}: {
  title: string;
  q: { isLoading: boolean; isError: boolean; data?: T[]; refetch: () => unknown };
  emptyKey: string;
  render: (x: T) => ReactNode;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View>
      <Text style={[styles.sectionTitle, { color: colors.text }]} accessibilityRole="header">
        {title}
      </Text>
      {q.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: 18 }} />
      ) : q.isError ? (
        <View style={styles.state}>
          <AppText variant="small" muted>
            {t('live.wallet.loadFailed')}
          </AppText>
          <Button title={t('live.retry')} variant="ghost" onPress={() => void q.refetch()} />
        </View>
      ) : !q.data?.length ? (
        <AppText variant="small" muted style={{ paddingVertical: 14 }}>
          {t(emptyKey)}
        </AppText>
      ) : (
        q.data.map(render)
      )}
    </View>
  );
}

// Under the recharge grid: where prices come from, or why Buy is hidden.
function StoreNote({ status, onRetry }: { status: ReturnType<typeof getStoreSnapshot>['status']; onRetry: () => void }) {
  const { t } = useTranslation();
  if (status === 'simulator' || status === 'unsupported') {
    return (
      <AppText variant="small" muted>
        {t(status === 'simulator' ? 'live.wallet.simulator' : 'live.wallet.unsupported')}
      </AppText>
    );
  }
  if (status === 'unavailable') {
    return (
      <View style={styles.storeNote}>
        <AppText variant="small" muted style={{ flex: 1 }}>
          {t('live.wallet.storeUnavailable', { store: STORE })}
        </AppText>
        <Button title={t('live.retry')} variant="ghost" onPress={onRetry} style={styles.retry} />
      </View>
    );
  }
  return (
    <AppText variant="small" muted>
      {t('live.wallet.priceNote', { store: STORE })}
    </AppText>
  );
}

const RESULT: Record<
  PurchaseNotice['kind'],
  { icon: ComponentProps<typeof Ionicons>['name']; tone: 'success' | 'warn' | 'danger' }
> = {
  credited: { icon: 'checkmark-circle', tone: 'success' },
  pending: { icon: 'time-outline', tone: 'warn' },
  retryLater: { icon: 'cloud-offline-outline', tone: 'warn' },
  otherAccount: { icon: 'people-circle-outline', tone: 'warn' },
  testRestricted: { icon: 'flask-outline', tone: 'warn' },
  invalid: { icon: 'close-circle', tone: 'danger' },
  failed: { icon: 'alert-circle', tone: 'danger' },
};

// The outcome of a purchase the user just made.
function PurchaseResult({ notice, onClose }: { notice: PurchaseNotice | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const kind = notice?.kind ?? 'credited';
  const body =
    notice?.kind === 'credited'
      ? t('live.wallet.result.creditedBody', { count: notice.coins, n: notice.coins.toLocaleString(i18n.language) })
      : notice?.kind === 'otherAccount'
        ? t(notice.granted ? 'live.wallet.result.otherAccountBody' : 'live.wallet.result.otherAccountWaitBody')
        : t(`live.wallet.result.${kind}Body`, { store: STORE });
  return (
    <Sheet visible={!!notice} onClose={onClose} title={t(`live.wallet.result.${kind}Title`)}>
      <View style={styles.result} accessibilityLiveRegion="polite">
        <Ionicons name={RESULT[kind].icon} size={48} color={colors[RESULT[kind].tone]} />
        <AppText center>{body}</AppText>
        <Button title={t('live.wallet.ok')} onPress={onClose} style={{ alignSelf: 'stretch' }} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 16, paddingBottom: 28 },
  hero: { borderRadius: 22, padding: 20, gap: 6, overflow: 'hidden' },
  heroGlow: { position: 'absolute', width: 220, height: 220, borderRadius: 110, right: -70, top: -90, backgroundColor: 'rgba(91,155,245,0.25)' },
  heroLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700', letterSpacing: 1.2 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 2 },
  heroValue: { color: '#fff', fontSize: 40, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -0.5, flexShrink: 1 },
  heroError: { color: '#fff', fontSize: 15, fontWeight: '700', textDecorationLine: 'underline', marginVertical: 10 },
  heroSub: { color: 'rgba(255,255,255,0.75)', fontSize: 13 },
  tabs: { flexDirection: 'row', borderRadius: 14, padding: 4, gap: 4 },
  tab: { flex: 1, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontSize: 14, fontWeight: '700' },
  sectionTitle: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  state: { alignItems: 'center', paddingVertical: 18, paddingHorizontal: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '31%', flexGrow: 1, borderRadius: 16, borderWidth: 1.5, paddingVertical: 16, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 92 },
  badge: { position: 'absolute', top: -9, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  tileCoins: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tileValue: { fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  tileBonus: { fontSize: 11.5, fontWeight: '700' },
  tilePrice: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 58 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  rowSub: { fontSize: 12.5, marginTop: 1 },
  amount: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  status: { fontSize: 12, fontWeight: '700', borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  checkout: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
  checkoutRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  checkoutCoins: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  checkoutBtn: { minWidth: 150, marginVertical: 0 },
  secureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  secureText: { fontSize: 11.5 },
  storeNote: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  retry: { height: 32, paddingHorizontal: 10, marginVertical: 0 },
  result: { alignItems: 'center', gap: 12, padding: 20 },
});
