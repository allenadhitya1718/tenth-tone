import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, I18nManager, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { fetchLiveTopGifters, liveKeys, type LiveGuest, type LiveTopGifter } from '@/api/live';
import { fetchFollowing, follow, isFollowing, profileKeys } from '@/api/profiles';
import { searchPeople } from '@/api/search';
import type { UserSummary } from '@/api/types';
import { showAlert } from '@/components/Dialog';
import { formatCount } from '@/features/feed/format';
import { atHandle } from '@/lib/handle';
import { useTheme } from '@/providers/ThemeProvider';

import { formatDuration } from './config';
import { Avatar, Sheet } from './Sheet';

// Pieces of the TikTok-style live room (client round 4): the host capsule,
// the top-gifter avatars and their ranking, and the host's "invite someone"
// search. LiveRoom.tsx lays them out.

// ---------- host capsule (top left) ----------

export function HostChip({
  host,
  elapsed,
  canFollow,
  onProfile,
}: {
  host: UserSummary | null;
  elapsed: number;
  /** A viewer, not the host: show the follow button until they follow. */
  canFollow: boolean;
  onProfile: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const hostId = host?.id ?? null;
  const following = useQuery({
    queryKey: profileKeys.isFollowing(hostId ?? ''),
    queryFn: () => isFollowing(hostId),
    enabled: canFollow && !!hostId,
    staleTime: 60_000,
  });
  const [requested, setRequested] = useState(false);
  const doFollow = useMutation({
    mutationFn: () => follow(hostId!),
    onSuccess: (r) => {
      if (r === 'requested') setRequested(true);
      else qc.setQueryData(profileKeys.isFollowing(hostId!), true);
    },
    onError: () => showAlert(t('live.follow.failed')),
  });
  const name = host?.name || host?.handle || t('live.someone');
  const showFollow = canFollow && following.data === false && !requested;

  return (
    <View style={styles.chip}>
      <Pressable
        onPress={onProfile}
        style={styles.chipMain}
        accessibilityRole="button"
        accessibilityLabel={t('live.hostProfile', { name })}
      >
        <Avatar uri={host?.avatar_url} name={name} size={34} />
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.chipName} numberOfLines={1}>
            {name}
          </Text>
          <View style={styles.chipSub} accessible accessibilityLabel={t('live.badgeA11y', { time: formatDuration(elapsed) })}>
            <View style={styles.liveDot} />
            <Text style={styles.chipTime}>{formatDuration(elapsed)}</Text>
          </View>
        </View>
      </Pressable>
      {showFollow ? (
        <Pressable
          onPress={() => doFollow.mutate()}
          disabled={doFollow.isPending}
          style={styles.follow}
          accessibilityRole="button"
          accessibilityLabel={t('live.follow.action', { name })}
          hitSlop={6}
        >
          {doFollow.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="add" size={18} color="#fff" />}
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------- top gifters (top right) and the ranking sheet ----------

const MEDAL = ['#FFC93C', '#C9D3E0', '#E0995E'];

export function useTopGifters(liveId: string, enabled: boolean) {
  return useQuery({
    queryKey: liveKeys.topGifters(liveId),
    queryFn: () => fetchLiveTopGifters(liveId),
    enabled,
    staleTime: 15_000,
    refetchInterval: enabled ? 60_000 : false,
  });
}

export function TopGifterStack({ gifters, onPress }: { gifters: LiveTopGifter[]; onPress: () => void }) {
  const { t } = useTranslation();
  const top = gifters.slice(0, 3);
  return (
    <Pressable
      onPress={onPress}
      style={styles.stack}
      accessibilityRole="button"
      accessibilityLabel={t('live.ranking.open')}
      hitSlop={6}
    >
      {top.length ? (
        top.map((g, i) => (
          <View key={g.user_id} style={[styles.stackItem, { borderColor: MEDAL[i], marginStart: i ? -8 : 0, zIndex: 3 - i }]}>
            <Avatar uri={g.avatar_url} name={g.name || g.handle} size={26} />
          </View>
        ))
      ) : (
        <View style={styles.rankPill}>
          <Ionicons name="trophy" size={13} color="#FFC93C" />
        </View>
      )}
    </Pressable>
  );
}

export function RankingSheet({
  visible,
  onClose,
  query,
  onPerson,
}: {
  visible: boolean;
  onClose: () => void;
  query: ReturnType<typeof useTopGifters>;
  onPerson: (u: UserSummary) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const list = query.data ?? [];
  return (
    <Sheet visible={visible} onClose={onClose} title={t('live.ranking.title')}>
      <Text style={[styles.lead, { color: colors.muted }]}>{t('live.ranking.lead')}</Text>
      {query.isLoading ? (
        <ActivityIndicator style={{ marginVertical: 30 }} color={colors.primary} />
      ) : query.isError ? (
        <Text style={[styles.empty, { color: colors.muted }]}>{t('live.ranking.failed')}</Text>
      ) : !list.length ? (
        <Text style={[styles.empty, { color: colors.muted }]}>{t('live.ranking.empty')}</Text>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(g) => g.user_id}
          renderItem={({ item, index }) => {
            const name = item.name || item.handle || t('live.someone');
            return (
              <Pressable
                onPress={() => onPerson({ id: item.user_id, name: item.name, handle: item.handle, avatar_url: item.avatar_url })}
                style={[styles.row, { borderBottomColor: colors.border }]}
                accessibilityRole="button"
                accessibilityLabel={t('live.ranking.rowA11y', { rank: index + 1, name, count: item.coins })}
              >
                <Text style={[styles.rank, { color: index < 3 ? MEDAL[index] : colors.muted }]}>{index + 1}</Text>
                <Avatar uri={item.avatar_url} name={name} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
                    {name}
                  </Text>
                  {item.handle ? <Text style={[styles.rowSub, { color: colors.muted }]}>{atHandle(item.handle)}</Text> : null}
                </View>
                <Text style={[styles.coins, { color: colors.text }]}>🪙 {formatCount(item.coins)}</Text>
              </Pressable>
            );
          }}
        />
      )}
    </Sheet>
  );
}

// ---------- invite a specific person (host) ----------

const QUICK_LIMIT = 30;

export function InvitePeopleSheet({
  visible,
  onClose,
  myId,
  guests,
  busyId,
  onInvite,
}: {
  visible: boolean;
  onClose: () => void;
  myId: string | null;
  guests: LiveGuest[];
  busyId: string | null;
  onInvite: (userId: string) => void;
}) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const tint = isDark ? colors.primary2 : colors.primary;
  const [q, setQ] = useState('');
  const term = q.trim();
  // With no search, the people the host follows: the likeliest guests.
  const following = useQuery({
    queryKey: profileKeys.following(myId ?? ''),
    queryFn: () => fetchFollowing(myId),
    enabled: visible && !!myId,
    staleTime: 60_000,
  });
  const found = useQuery({
    queryKey: ['live', 'inviteSearch', term],
    queryFn: () => searchPeople(term, 20),
    enabled: visible && term.length >= 2,
    staleTime: 30_000,
  });
  const source = term.length >= 2 ? found : following;
  const people = ((source.data ?? []) as UserSummary[]).filter((p) => p.id !== myId).slice(0, QUICK_LIMIT);
  const statusOf = (id: string) => guests.find((g) => g.user_id === id)?.status ?? null;

  return (
    <Sheet visible={visible} onClose={onClose} title={t('live.invite.title')} maxHeight={0.85}>
      <View style={[styles.search, { backgroundColor: colors.bg2 }]}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={t('live.invite.search')}
          placeholderTextColor={colors.muted}
          style={[styles.searchInput, { color: colors.text, textAlign: I18nManager.isRTL ? 'right' : 'left' }]}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={t('live.invite.search')}
        />
        {q ? (
          <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('live.invite.clear')}>
            <Ionicons name="close-circle" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      <Text style={[styles.lead, { color: colors.muted }]}>
        {term.length >= 2 ? t('live.invite.results') : t('live.invite.lead')}
      </Text>
      {source.isLoading ? (
        <ActivityIndicator style={{ marginVertical: 30 }} color={colors.primary} />
      ) : source.isError ? (
        <Text style={[styles.empty, { color: colors.muted }]}>{t('live.invite.failed')}</Text>
      ) : !people.length ? (
        <Text style={[styles.empty, { color: colors.muted }]}>
          {term.length >= 2 ? t('live.invite.noResults') : t('live.invite.noFollowing')}
        </Text>
      ) : (
        <FlatList
          data={people}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const name = item.name || item.handle || t('live.someone');
            const st = statusOf(item.id);
            const done = st === 'invited' || st === 'accepted';
            return (
              <View style={[styles.row, { borderBottomColor: colors.border }]}>
                <Avatar uri={item.avatar_url} name={name} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
                    {name}
                  </Text>
                  {item.handle ? <Text style={[styles.rowSub, { color: colors.muted }]}>{atHandle(item.handle)}</Text> : null}
                </View>
                <Pressable
                  onPress={() => onInvite(item.id)}
                  disabled={done || busyId === item.id}
                  style={[styles.inviteBtn, done ? { backgroundColor: colors.bg2 } : { backgroundColor: tint }]}
                  accessibilityRole="button"
                  accessibilityLabel={done ? t(`live.invite.${st}`) : t('live.invite.actionA11y', { name })}
                >
                  {busyId === item.id ? (
                    <ActivityIndicator size="small" color={done ? colors.muted : '#fff'} />
                  ) : (
                    <Text style={[styles.inviteText, { color: done ? colors.muted : '#fff' }]}>
                      {done ? t(`live.invite.${st}`) : t('live.invite.action')}
                    </Text>
                  )}
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 22, padding: 3, paddingEnd: 6, flexShrink: 1, maxWidth: 230 },
  chipMain: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1, minHeight: 38 },
  chipName: { color: '#fff', fontSize: 13, fontWeight: '800', maxWidth: 130 },
  chipSub: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ff2d55' },
  chipTime: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  follow: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#ff2d55', alignItems: 'center', justifyContent: 'center' },
  stack: { flexDirection: 'row', alignItems: 'center', minHeight: 36, paddingHorizontal: 2 },
  stackItem: { borderWidth: 2, borderRadius: 16 },
  rankPill: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  lead: { fontSize: 13, paddingHorizontal: 16, paddingVertical: 8 },
  empty: { fontSize: 14, textAlign: 'center', paddingVertical: 30, paddingHorizontal: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 60 },
  rank: { width: 22, fontSize: 16, fontWeight: '900', textAlign: 'center' },
  rowName: { fontSize: 15, fontWeight: '700' },
  rowSub: { fontSize: 12.5 },
  coins: { fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 4, paddingHorizontal: 12, borderRadius: 14, minHeight: 44 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 10 },
  inviteBtn: { minWidth: 84, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  inviteText: { fontSize: 13, fontWeight: '800' },
});
