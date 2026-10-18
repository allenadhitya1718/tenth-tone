import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { locationKeys, fetchIncomingPermits } from '@/api/location';
import {
  fetchNotifications,
  markNotificationsRead,
  type Notification,
  notificationKeys,
} from '@/api/notifications';
import { fetchFollowRequests, profileKeys } from '@/api/profiles';
import { TopBar } from '@/components/ui';
import { go } from '@/features/discover/nav';
import { EmptyState, ErrorState, LoadingState } from '@/features/discover/parts';
import { Chevron } from '@/features/discover/rows';
import { useTheme } from '@/providers/ThemeProvider';

import { NotificationRow } from './NotificationRow';

type Bucket = 'today' | 'week' | 'earlier';
type Item = { kind: 'header'; id: string; bucket: Bucket } | { kind: 'row'; id: string; n: Notification };

const DAY = 86_400_000;

// Calendar days, not 24-hour windows: something from 23:50 yesterday is not
// "today" at 00:10.
function bucketOf(iso: string, todayStart: number): Bucket {
  const at = new Date(iso).getTime();
  if (at >= todayStart) return 'today';
  if (at >= todayStart - 6 * DAY) return 'week';
  return 'earlier';
}

export function Notifications() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();

  const list = useQuery({ queryKey: notificationKeys.list(), queryFn: fetchNotifications });
  // Which follow requests and location requests are still waiting, so a row
  // only offers a decision that can still be made.
  const requests = useQuery({ queryKey: profileKeys.followRequests(), queryFn: fetchFollowRequests });
  const permits = useQuery({ queryKey: locationKeys.incomingPermits(), queryFn: fetchIncomingPermits });

  const markRead = useMutation({
    mutationFn: () => markNotificationsRead(),
    // The list keeps its unread tint until the next refresh, so you can
    // still see what was new; only the badge clears now.
    onSuccess: () => qc.setQueryData(notificationKeys.unreadCount(), 0),
  });

  // Opening the screen reads everything, once the rows are on screen.
  const marked = useRef(false);
  const hasData = !!list.data;
  const { mutate: mark } = markRead;
  useEffect(() => {
    if (!hasData || marked.current) return;
    marked.current = true;
    mark();
  }, [hasData, mark]);

  const { refetch: refetchList } = list;
  const { refetch: refetchRequests } = requests;
  const { refetch: refetchPermits } = permits;
  const onRefresh = useCallback(() => {
    void refetchList().then(() => mark());
    void refetchRequests();
    void refetchPermits();
  }, [refetchList, refetchRequests, refetchPermits, mark]);

  const items = useMemo<Item[]>(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const out: Item[] = [];
    let last: Bucket | null = null;
    for (const n of list.data ?? []) {
      const b = bucketOf(n.created_at, todayStart);
      if (b !== last) {
        out.push({ kind: 'header', id: `h-${b}`, bucket: b });
        last = b;
      }
      out.push({ kind: 'row', id: n.id, n });
    }
    return out;
  }, [list.data]);

  const pendingRequests = useMemo(() => new Set((requests.data ?? []).map((r) => r.id)), [requests.data]);
  const pendingPermits = useMemo(() => new Set((permits.data ?? []).map((p) => p.id)), [permits.data]);

  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      if (item.kind === 'header') return <BucketHeader bucket={item.bucket} />;
      const n = item.n;
      const permitId = typeof n.payload?.permit_id === 'string' ? n.payload.permit_id : null;
      return (
        <NotificationRow
          n={n}
          requestPending={n.type === 'follow_request' && !!n.actor?.id && pendingRequests.has(n.actor.id)}
          permitPending={!!permitId && pendingPermits.has(permitId)}
        />
      );
    },
    [pendingRequests, pendingPermits],
  );

  const requestCount = requests.data?.length ?? 0;
  const header = requestCount ? <RequestsEntry count={requestCount} first={requests.data?.[0]?.name ?? requests.data?.[0]?.handle ?? ''} /> : null;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top']}>
      <TopBar title={t('discover.notif.title')} />
      <FlashList
        data={items}
        keyExtractor={keyOf}
        getItemType={typeOf}
        renderItem={renderItem}
        ListHeaderComponent={header}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={list.isRefetching} onRefresh={onRefresh} tintColor={colors.muted} />
        }
        ListEmptyComponent={
          list.isLoading ? (
            <LoadingState />
          ) : list.isError ? (
            <ErrorState onRetry={onRefresh} />
          ) : (
            <EmptyState icon="notifications-outline" title={t('discover.notif.empty')} sub={t('discover.notif.emptySub')} />
          )
        }
      />
    </SafeAreaView>
  );
}

const keyOf = (i: Item) => i.id;
const typeOf = (i: Item) => i.kind;

function BucketHeader({ bucket }: { bucket: Bucket }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Text style={[styles.bucket, { color: colors.text }]} accessibilityRole="header">
      {t(`discover.notif.bucket_${bucket}`)}
    </Text>
  );
}

// Instagram's "Follow requests" line above the list.
function RequestsEntry({ count, first }: { count: number; first: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const sub = count > 1 ? t('discover.requests.entrySubMany', { name: first, n: count - 1 }) : first;
  return (
    <Pressable
      onPress={() => go('/follow-requests')}
      style={[styles.entry, { borderBottomColor: colors.border }]}
      accessibilityRole="button"
      accessibilityLabel={`${t('discover.requests.title')}, ${count}`}
    >
      <View style={[styles.entryIcon, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name="person-add" size={20} color={colors.primary2} />
      </View>
      <View style={styles.entryText}>
        <Text style={[styles.entryTitle, { color: colors.text }]}>{t('discover.requests.title')}</Text>
        {sub ? (
          <Text style={[styles.entrySub, { color: colors.muted }]} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      <View style={[styles.count, { backgroundColor: colors.danger }]}>
        <Text style={styles.countText}>{count > 99 ? '99+' : count}</Text>
      </View>
      <Chevron />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingBottom: 40 },
  bucket: { fontSize: 16, fontWeight: '800', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 6 },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  entryIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  entryText: { flex: 1, gap: 2 },
  entryTitle: { fontSize: 15, fontWeight: '700', alignSelf: 'flex-start' },
  entrySub: { fontSize: 13, alignSelf: 'flex-start', maxWidth: '100%' },
  count: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  countText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
