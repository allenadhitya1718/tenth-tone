import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, useSyncExternalStore, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  fetchCoinPackages,
  fetchMyTopups,
  fetchWallet,
  fetchWalletTransactions,
  walletKeys,
  type CoinPackage,
  type WalletTopup,
  type WalletTransaction,
  type WalletTransactionType,
} from '@/api/wallet';
import { showToast } from '@/components/Toast';
import { AppText, Button, TopBar } from '@/components/ui';
import { Sheet } from '@/features/live/Sheet';
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

// The coin wallet (client note 12): balance, how topping up works, the coin
// packages, and the history of gifts and top-ups.
//
// App Review 3.1.1 / Play Billing: coins are a digital good, so they are only
// sold through the App Store / Google Play as consumable in-app purchases
// (./store.ts). Prices are the store's localized ones. This screen only READS
// money: coins are credited on the server after verify-purchase has checked
// the purchase with the store (credit_wallet_topup, 0104), never by the app.
// Buy is hidden on simulators and whenever the store is unavailable.

type Row =
  | { kind: 'package'; pkg: CoinPackage }
  | { kind: 'tx'; tx: WalletTransaction }
  | { kind: 'topup'; topup: WalletTopup }
  | { kind: 'state'; state: 'loading' | 'error' | 'empty'; retry?: () => void; emptyKey: string };

const STORE = Platform.OS === 'ios' ? 'App Store' : 'Google Play';

const TX_ICON: Record<WalletTransactionType, ComponentProps<typeof Ionicons>['name']> = {
  topup: 'add-circle',
  gift_sent: 'gift-outline',
  gift_received: 'gift',
  withdrawal: 'arrow-up-circle-outline',
};

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
  const productIds = useMemo(() => (packages.data ?? []).map((p) => p.product_id), [packages.data]);

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

  const refreshing = balance.isRefetching || txs.isRefetching || packages.isRefetching || topups.isRefetching;
  const refresh = () => {
    void balance.refetch();
    void txs.refetch();
    void packages.refetch();
    void topups.refetch();
  };

  function section<T>(
    q: { isLoading: boolean; isError: boolean; data?: T[]; refetch: () => unknown },
    map: (x: T) => Row,
    emptyKey: string,
  ): Row[] {
    if (q.isLoading) return [{ kind: 'state', state: 'loading', emptyKey }];
    if (q.isError) return [{ kind: 'state', state: 'error', retry: () => void q.refetch(), emptyKey }];
    if (!q.data?.length) return [{ kind: 'state', state: 'empty', emptyKey }];
    return q.data.map(map);
  }

  const sections = [
    { key: 'packages', title: t('live.wallet.packages'), data: section(packages, (pkg) => ({ kind: 'package', pkg }), 'live.wallet.noPackages') },
    { key: 'tx', title: t('live.wallet.history'), data: section(txs, (tx) => ({ kind: 'tx', tx }), 'live.wallet.noHistory') },
    { key: 'topups', title: t('live.wallet.topups'), data: section(topups, (topup) => ({ kind: 'topup', topup }), 'live.wallet.noTopups') },
  ];

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' });
  const num = (n: number) => n.toLocaleString(i18n.language);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <TopBar title={t('live.wallet.title')} />
      <SectionList
        sections={sections}
        keyExtractor={(r, i) =>
          r.kind === 'package' ? r.pkg.id : r.kind === 'tx' ? r.tx.id : r.kind === 'topup' ? r.topup.id : `${r.emptyKey}-${i}`
        }
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.muted} />}
        ListHeaderComponent={
          <View style={{ padding: 16, gap: 14 }}>
            <View style={[styles.balanceCard, { backgroundColor: colors.primary }]} accessible accessibilityLabel={t('live.wallet.balanceA11y', { count: balance.data?.balance ?? 0 })}>
              <Text style={styles.balanceLabel}>{t('live.wallet.balance')}</Text>
              {balance.isLoading ? (
                <ActivityIndicator color="#fff" style={{ alignSelf: 'flex-start', marginVertical: 8 }} />
              ) : balance.isError ? (
                <Pressable onPress={() => void balance.refetch()} accessibilityRole="button">
                  <Text style={styles.balanceError}>{t('live.wallet.balanceFailed')}</Text>
                </Pressable>
              ) : (
                <View style={styles.balanceRow}>
                  <Text style={styles.coin}>🪙</Text>
                  <Text style={styles.balanceValue}>{num(balance.data?.balance ?? 0)}</Text>
                </View>
              )}
              <Text style={styles.balanceSub}>{t('live.wallet.balanceSub')}</Text>
            </View>

            <View style={[styles.howTo, { backgroundColor: colors.bg2 }]}>
              <AppText variant="label">{t('live.wallet.howTitle')}</AppText>
              {(['how1', 'how2', 'how3'] as const).map((k, i) => (
                <View key={k} style={styles.howRow}>
                  <View style={[styles.howNum, { backgroundColor: colors.primarySoft }]}>
                    <Text style={[styles.howNumText, { color: isDark ? colors.primary2 : colors.primary }]}>{num(i + 1)}</Text>
                  </View>
                  <AppText variant="small" style={{ flex: 1 }}>
                    {t(`live.wallet.${k}`, { store: STORE })}
                  </AppText>
                </View>
              ))}
            </View>
          </View>
        }
        renderSectionHeader={({ section: s }) => (
          <View style={styles.sectionHead}>
            <Text style={[styles.sectionTitle, { color: colors.text }]} accessibilityRole="header">
              {s.title}
            </Text>
            {s.key === 'packages' ? <StoreNote status={store.status} onRetry={() => void reconnectStore(productIds)} /> : null}
          </View>
        )}
        renderItem={({ item }) => {
          if (item.kind === 'state') {
            return (
              <View style={styles.state}>
                {item.state === 'loading' ? (
                  <ActivityIndicator color={colors.primary} />
                ) : item.state === 'error' ? (
                  <>
                    <AppText variant="small" muted>
                      {t('live.wallet.loadFailed')}
                    </AppText>
                    <Button title={t('live.retry')} variant="ghost" onPress={item.retry} />
                  </>
                ) : (
                  <AppText variant="small" muted>
                    {t(item.emptyKey)}
                  </AppText>
                )}
              </View>
            );
          }
          if (item.kind === 'package') {
            const p = item.pkg;
            const total = p.coins + p.bonus_coins;
            const product = store.products[p.product_id];
            return (
              <View style={[styles.row, { borderBottomColor: colors.border }]}>
                <Text style={styles.rowCoin}>🪙</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: colors.text }]}>{t('live.wallet.coins', { count: total, n: num(total) })}</Text>
                  {p.bonus_coins ? (
                    <Text style={[styles.rowSub, { color: colors.success }]}>{t('live.wallet.bonus', { n: num(p.bonus_coins) })}</Text>
                  ) : null}
                  {product ? (
                    <Text style={[styles.rowSub, { color: colors.muted }]}>{product.displayPrice}</Text>
                  ) : store.status === 'ready' && p.product_id ? (
                    <Text style={[styles.rowSub, { color: colors.muted }]}>{t('live.wallet.productUnavailable', { store: STORE })}</Text>
                  ) : null}
                </View>
                {store.status === 'connecting' || store.status === 'idle' ? (
                  <ActivityIndicator color={colors.muted} style={styles.buySpinner} />
                ) : store.status === 'ready' && product ? (
                  <Button
                    title={t('live.wallet.buy')}
                    variant="secondary"
                    loading={store.buying === p.product_id}
                    disabled={!!store.buying && store.buying !== p.product_id}
                    onPress={() => void buyCoins(p.product_id)}
                    style={styles.buy}
                  />
                ) : null}
              </View>
            );
          }
          if (item.kind === 'tx') {
            const x = item.tx;
            const incoming = x.type === 'topup' || x.type === 'gift_received';
            return (
              <View style={[styles.row, { borderBottomColor: colors.border }]} accessible>
                <Ionicons name={TX_ICON[x.type] ?? 'swap-horizontal'} size={24} color={incoming ? colors.success : colors.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: colors.text }]}>{t(`live.wallet.tx.${x.type}`, { defaultValue: x.type })}</Text>
                  <Text style={[styles.rowSub, { color: colors.muted }]} numberOfLines={1}>
                    {x.description ? `${x.description} · ` : ''}
                    {date(x.created_at)}
                  </Text>
                </View>
                <Text style={[styles.amount, { color: incoming ? colors.success : colors.text }]}>
                  {incoming ? '+' : '−'}
                  {num(x.amount)}
                </Text>
              </View>
            );
          }
          const u = item.topup;
          const tone = u.status === 'credited' ? colors.success : u.status === 'rejected' ? colors.danger : colors.warn;
          return (
            <View style={[styles.row, { borderBottomColor: colors.border }]} accessible>
              <Ionicons name={u.platform === 'ios' ? 'logo-apple' : 'logo-google-playstore'} size={22} color={colors.muted} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: colors.text }]}>{t('live.wallet.coins', { count: u.coins, n: num(u.coins) })}</Text>
                <Text style={[styles.rowSub, { color: colors.muted }]}>{date(u.created_at)}</Text>
              </View>
              <Text style={[styles.status, { color: tone, borderColor: tone }]}>{t(`live.wallet.status.${u.status}`)}</Text>
            </View>
          );
        }}
      />

      <PurchaseResult notice={notice} onClose={() => setNotice(null)} />
    </SafeAreaView>
  );
}

// Under "Coin packages": where prices come from, or why Buy is hidden.
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
  balanceCard: { borderRadius: 20, padding: 18, gap: 4 },
  balanceLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '600' },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  coin: { fontSize: 30 },
  balanceValue: { color: '#fff', fontSize: 38, fontWeight: '900', fontVariant: ['tabular-nums'] },
  balanceError: { color: '#fff', fontSize: 15, fontWeight: '700', textDecorationLine: 'underline', marginVertical: 8 },
  balanceSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13 },
  howTo: { borderRadius: 16, padding: 14, gap: 10 },
  howRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  howNum: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  howNumText: { fontSize: 12, fontWeight: '800' },
  sectionHead: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6, gap: 2 },
  sectionTitle: { fontSize: 17, fontWeight: '800' },
  state: { alignItems: 'center', paddingVertical: 18, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 56 },
  rowCoin: { fontSize: 24 },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  rowSub: { fontSize: 12.5, marginTop: 1 },
  amount: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  buy: { height: 40, paddingHorizontal: 18, marginVertical: 0 },
  status: { fontSize: 12, fontWeight: '700', borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  buySpinner: { width: 64 },
  storeNote: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  retry: { height: 32, paddingHorizontal: 10, marginVertical: 0 },
  result: { alignItems: 'center', gap: 12, padding: 20 },
});
