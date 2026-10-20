import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  I18nManager,
  Linking,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { openOrCreateDm } from '@/api/chat';
import { profileLink } from '@/api/discover';
import {
  fetchProfile,
  cancelFollowRequest,
  follow,
  hasRequestedFollow,
  isFollowing,
  type Profile,
  profileKeys,
  unfollow,
} from '@/api/profiles';
import { fetchUserSounds, type Sound, soundKeys } from '@/api/sounds';
import { fetchDrafts, fetchSavedVideos, fetchUserVideos, videoKeys, type VideoTile } from '@/api/videos';
import { tagKeys } from '@/api/tags';
import { NotFoundState } from '@/components/NotFoundState';
import { Button } from '@/components/ui';
import { DraftSheet } from '@/features/drafts/DraftSheet';
import { useDeleteVideo } from '@/features/feed/useDeleteVideo';
import { ProfilePlacesMap } from '@/features/map/ProfilePlacesMap';
import { formatCount } from '@/features/feed/format';
import { BottomSheet } from '@/features/safety/BottomSheet';
import { ReportSheet } from '@/features/safety/ReportSheet';
import { useBlock } from '@/features/safety/useBlock';
import { ProfileStoryAvatar } from '@/features/stories/ProfileStoryAvatar';
import { atHandle } from '@/lib/handle';
import { useTheme } from '@/providers/ThemeProvider';

type Tab = 'videos' | 'audio' | 'map' | 'saved' | 'drafts';

// One screen for your own profile and everyone else's. Client note 28: a
// profile shows audio and maps as well as videos.
export function ProfileView({ userId, isMe }: { userId: string; isMe: boolean }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('videos');
  // Client note 2: a draft opens its own sheet, never the For You feed.
  const [openDraft, setOpenDraft] = useState<VideoTile | null>(null);
  // Long-press on one of your own posts offers Delete video.
  const del = useDeleteVideo();

  const profile = useQuery({ queryKey: profileKeys.profile(userId), queryFn: () => fetchProfile(userId) });
  const tabs: Tab[] = isMe ? ['videos', 'audio', 'map', 'saved', 'drafts'] : ['videos', 'audio', 'map'];

  const videos = useQuery({
    queryKey: videoKeys.userVideos(userId),
    queryFn: () => fetchUserVideos(userId),
    enabled: tab === 'videos',
  });
  const saved = useQuery({ queryKey: videoKeys.saved(), queryFn: fetchSavedVideos, enabled: isMe && tab === 'saved' });
  const drafts = useQuery({ queryKey: videoKeys.drafts(), queryFn: fetchDrafts, enabled: isMe && tab === 'drafts' });
  const sounds = useQuery({
    queryKey: soundKeys.byUser(userId),
    queryFn: () => fetchUserSounds(userId),
    enabled: tab === 'audio',
  });

  const grid = tab === 'videos' ? videos : tab === 'saved' ? saved : tab === 'drafts' ? drafts : null;
  const tile = Math.floor((width - 4) / 3);

  // A link to a person who does not exist (or is not visible to you).
  if (!isMe && profile.isSuccess && !profile.data) {
    return <NotFoundState icon="person-outline" title={t('fix4.notFoundUserTitle')} body={t('fix4.notFoundUserBody')} />;
  }

  const header = (
    <>
      <ProfileHeader profile={profile.data ?? null} userId={userId} isMe={isMe} loading={profile.isLoading} />
      <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
        {tabs.map((k) => (
          <Pressable
            key={k}
            onPress={() => setTab(k)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === k }}
            accessibilityLabel={t(`profile.tab_${k}`)}
            style={[styles.tabBtn, tab === k && { borderBottomColor: colors.text }]}
          >
            <Ionicons name={TAB_ICON[k]} size={22} color={tab === k ? colors.text : colors.muted} />
          </Pressable>
        ))}
      </View>
    </>
  );

  const refreshing = profile.isRefetching || !!grid?.isRefetching || sounds.isRefetching;
  const onRefresh = () => {
    void profile.refetch();
    if (grid) void grid.refetch();
    if (tab === 'audio') void sounds.refetch();
    if (tab === 'map') void qc.invalidateQueries({ queryKey: tagKeys.profilePlaces(userId) });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {grid ? (
        <FlatList<VideoTile>
          key={`grid-${tab}`}
          data={grid.data ?? []}
          numColumns={3}
          keyExtractor={(v) => v.id}
          ListHeaderComponent={header}
          columnWrapperStyle={{ gap: 2 }}
          contentContainerStyle={{ gap: 2, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={grid.isLoading ? <Spinner /> : <Empty icon={TAB_ICON[tab]} text={t(`profile.empty_${tab}${isMe ? '_me' : ''}`)} />}
          renderItem={({ item }) => (
            <Pressable
              style={{ width: tile, height: tile * 1.33, backgroundColor: colors.bg3 }}
              onPress={() => (tab === 'drafts' ? setOpenDraft(item) : router.push(`/video/${item.id}`))}
              onLongPress={isMe && tab === 'videos' ? () => del.confirm(item.id) : undefined}
              disabled={del.busyId === item.id}
              accessibilityHint={isMe && tab === 'videos' ? t('fix4.deleteHint') : undefined}
              accessibilityRole="button"
              accessibilityLabel={tab === 'drafts' ? t('drafts.open') : undefined}
            >
              {item.thumbnail && !/\.(mp4|mov|webm)(\?|$)/i.test(item.thumbnail) ? (
                <Image source={{ uri: item.thumbnail }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : null}
              {del.busyId === item.id ? (
                <View style={[StyleSheet.absoluteFill, styles.deleting]}>
                  <ActivityIndicator color="#fff" />
                </View>
              ) : null}
              {item.is_pinned ? <Text style={styles.pinned}>{t('profile.pinned')}</Text> : null}
              <View style={styles.views}>
                <Ionicons name="play" size={12} color="#fff" />
                <Text style={styles.viewsText}>{formatCount(item.views_count ?? item.likes_count)}</Text>
              </View>
            </Pressable>
          )}
        />
      ) : (
        <FlatList<Sound>
          key={`list-${tab}`}
          data={tab === 'audio' ? (sounds.data ?? []) : []}
          keyExtractor={(s) => s.id}
          ListHeaderComponent={header}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            tab === 'audio' && sounds.isLoading ? (
              <Spinner />
            ) : tab === 'map' ? (
              <ProfilePlacesMap userId={userId} isMe={isMe} height={Math.round(width * 1.15)} />
            ) : (
              <Empty icon={TAB_ICON[tab]} text={t(`profile.empty_audio${isMe ? '_me' : ''}`)} />
            )
          }
          renderItem={({ item }) => <SoundRow sound={item} />}
        />
      )}
      {isMe ? <DraftSheet draft={openDraft} onClose={() => setOpenDraft(null)} /> : null}
    </SafeAreaView>
  );
}

const TAB_ICON: Record<Tab, keyof typeof Ionicons.glyphMap> = {
  videos: 'grid-outline',
  audio: 'musical-notes-outline',
  map: 'map-outline',
  saved: 'bookmark-outline',
  drafts: 'document-text-outline',
};

function ProfileHeader({ profile, userId, isMe, loading }: { profile: Profile | null; userId: string; isMe: boolean; loading: boolean }) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const share = () => {
    if (profile?.handle) void Share.share({ message: profileLink(profile.handle) });
  };
  // Report and block live behind a "more" button on other people's profiles.
  const [menuOpen, setMenuOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const confirmBlock = useBlock();
  const shownName = profile?.name ?? profile?.handle ?? '';
  async function onBlock() {
    setMenuOpen(false);
    if (await confirmBlock(userId, shownName)) router.back();
  }

  return (
    <View>
      <View style={styles.topBar}>
        {isMe ? (
          <Pressable onPress={() => router.push('/settings')} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('settings.title')}>
            <Ionicons name="menu" size={26} color={colors.text} />
          </Pressable>
        ) : (
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.back')}>
            <Ionicons name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'} size={26} color={colors.text} />
          </Pressable>
        )}
        <Text style={[styles.topHandle, { color: colors.text }]} numberOfLines={1}>
          {profile?.handle ? atHandle(profile.handle) : ''}
        </Text>
        <View style={styles.topRight}>
          <Pressable onPress={share} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('profile.share')}>
            <Ionicons name="share-social-outline" size={24} color={colors.text} />
          </Pressable>
          {!isMe && profile ? (
            <Pressable onPress={() => setMenuOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('ugc.moreOptions')}>
              <Ionicons name="ellipsis-horizontal" size={24} color={colors.text} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {!isMe ? (
        <>
          <BottomSheet visible={menuOpen} onClose={() => setMenuOpen(false)}>
            <Pressable
              style={styles.menuRow}
              accessibilityRole="button"
              onPress={() => {
                setMenuOpen(false);
                setReporting(true);
              }}
            >
              <Ionicons name="flag-outline" size={22} color={colors.text} />
              <Text style={[styles.menuText, { color: colors.text }]}>{t('ugc.reportUser')}</Text>
            </Pressable>
            <Pressable style={styles.menuRow} accessibilityRole="button" onPress={() => void onBlock()}>
              <Ionicons name="ban-outline" size={22} color="#ff453a" />
              <Text style={[styles.menuText, { color: '#ff453a' }]}>{t('ugc.blockUser')}</Text>
            </Pressable>
          </BottomSheet>
          <ReportSheet visible={reporting} onClose={() => setReporting(false)} targetType="user" targetId={userId} />
        </>
      ) : null}

      {loading ? <Spinner /> : null}

      <View style={styles.top}>
        {/* Stories live here now (not in the feed): ring when there are
            active stories, tap to watch them, "+" on your own to post. */}
        <ProfileStoryAvatar
          userId={userId}
          isMe={isMe}
          uri={profile?.avatar_url}
          name={profile?.name ?? profile?.handle ?? null}
          style={styles.avatarWrap}
        />
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: colors.text }]}>{profile?.name ?? ''}</Text>
          {profile?.verified ? <Ionicons name="checkmark-circle" size={18} color={colors.primary2} /> : null}
          {profile?.is_private ? <Ionicons name="lock-closed" size={15} color={colors.muted} /> : null}
        </View>

        <View style={styles.stats}>
          <Stat n={profile?.following_count} label={t('profile.following')} onPress={() => router.push(`/list/following/${userId}`)} />
          <Stat n={profile?.followers_count} label={t('profile.followers')} onPress={() => router.push(`/list/followers/${userId}`)} />
          <Stat n={profile?.likes_count} label={t('profile.likes')} />
        </View>

        {profile?.bio ? <Text style={[styles.bio, { color: colors.text }]}>{profile.bio}</Text> : null}
        {profile?.link ? (
          <Text style={[styles.link, { color: colors.primary2 }]} onPress={() => Linking.openURL(normalizeLink(profile.link!))}>
            {profile.link}
          </Text>
        ) : null}

        {isMe ? (
          <View style={styles.actions}>
            <Button title={t('profile.edit')} variant="secondary" style={styles.action} onPress={() => router.push('/profile/edit')} />
            <Button title={t('profile.share')} variant="secondary" style={styles.action} onPress={share} />
          </View>
        ) : profile ? (
          <OtherActions profile={profile} />
        ) : null}
      </View>
    </View>
  );
}

function OtherActions({ profile }: { profile: Profile }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const following = useQuery({ queryKey: profileKeys.isFollowing(profile.id), queryFn: () => isFollowing(profile.id) });
  const requested = useQuery({
    queryKey: profileKeys.hasRequestedFollow(profile.id),
    queryFn: () => hasRequestedFollow(profile.id),
    // Fallback to the realtime sync: a request answered elsewhere clears.
    refetchInterval: (q) => (q.state.data ? 15_000 : false),
  });
  const state = following.data ? 'following' : requested.data ? 'requested' : 'none';

  const toggle = useMutation({
    mutationFn: async () => {
      if (state === 'none') return follow(profile.id);
      if (state === 'requested') await cancelFollowRequest(profile.id);
      else await unfollow(profile.id);
      return 'none' as const;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: profileKeys.isFollowing(profile.id) });
      void qc.invalidateQueries({ queryKey: profileKeys.hasRequestedFollow(profile.id) });
      void qc.invalidateQueries({ queryKey: profileKeys.profile(profile.id) });
      void qc.invalidateQueries({ queryKey: videoKeys.feed('following') });
    },
    onError: () => Alert.alert(t('profile.updateFailed')),
  });

  function onFollowPress() {
    if (state === 'requested') {
      const name = profile.name ?? profile.handle ?? '';
      Alert.alert(t('discover.follow.cancelRequestTitle'), t('discover.follow.cancelRequestBody', { name }), [
        { text: t('discover.follow.cancelRequestKeep'), style: 'cancel' },
        { text: t('discover.follow.cancelRequestConfirm'), style: 'destructive', onPress: () => toggle.mutate() },
      ]);
      return;
    }
    // Leaving a private account means asking again and waiting, so only that
    // unfollow is confirmed.
    if (state === 'following' && profile.is_private) {
      Alert.alert(t('profile.unfollowTitle'), t('profile.unfollowPrivate'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('profile.unfollow'), style: 'destructive', onPress: () => toggle.mutate() },
      ]);
      return;
    }
    toggle.mutate();
  }

  const message = useMutation({
    mutationFn: () => openOrCreateDm(profile.id),
    onSuccess: (chatId) => router.push(`/chat/${chatId}`),
    onError: () => Alert.alert(t('profile.chatFailed')),
  });

  return (
    <View style={styles.actions}>
      <Button
        title={t(state === 'following' ? 'profile.followingBtn' : state === 'requested' ? 'profile.requested' : 'feed.follow')}
        variant={state === 'none' ? 'primary' : 'secondary'}
        loading={toggle.isPending}
        style={styles.action}
        onPress={onFollowPress}
      />
      <Button title={t('profile.message')} variant="secondary" loading={message.isPending} style={styles.action} onPress={() => message.mutate()} />
    </View>
  );
}

function Stat({ n, label, onPress }: { n: number | undefined; label: string; onPress?: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={styles.stat} accessibilityRole={onPress ? 'button' : undefined}>
      <Text style={[styles.statN, { color: colors.text }]}>{formatCount(n)}</Text>
      <Text style={[styles.statL, { color: colors.muted }]}>{label}</Text>
    </Pressable>
  );
}

function SoundRow({ sound }: { sound: Sound }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Pressable style={styles.soundRow} onPress={() => router.push(`/sound/${sound.id}`)} accessibilityRole="button">
      <View style={[styles.soundCover, { backgroundColor: colors.bg3 }]}>
        {sound.cover_url ? <Image source={{ uri: sound.cover_url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
        <Ionicons name="musical-notes" size={20} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.soundTitle, { color: colors.text }]} numberOfLines={1}>
          {sound.title ?? ''}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 13 }}>{t('profile.soundUses', { count: Number(sound.usage_count ?? 0) })}</Text>
      </View>
      <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.muted} />
    </Pressable>
  );
}

function Empty({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={40} color={colors.muted2} />
      <Text style={{ color: colors.muted, textAlign: 'center', fontSize: 14, lineHeight: 20 }}>{text}</Text>
    </View>
  );
}

function Spinner() {
  const { colors } = useTheme();
  return <ActivityIndicator style={{ marginVertical: 30 }} color={colors.primary} />;
}

const normalizeLink = (l: string) => (/^https?:\/\//i.test(l) ? l : `https://${l}`);

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 48 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 16 },
  menuText: { fontSize: 16, fontWeight: '600' },
  topHandle: { fontSize: 16, fontWeight: '800', flex: 1, textAlign: 'center' },
  top: { alignItems: 'center', paddingHorizontal: 20, paddingBottom: 14 },
  avatarWrap: { marginTop: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  name: { fontSize: 19, fontWeight: '800' },
  stats: { flexDirection: 'row', gap: 28, marginTop: 14 },
  stat: { alignItems: 'center', minWidth: 64 },
  statN: { fontSize: 17, fontWeight: '800' },
  statL: { fontSize: 12.5, marginTop: 2 },
  bio: { marginTop: 12, textAlign: 'center', fontSize: 14.5, lineHeight: 21 },
  link: { marginTop: 4, fontWeight: '700', fontSize: 14 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14, alignSelf: 'stretch' },
  action: { flex: 1, height: 44 },
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  deleting: { backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  pinned: { position: 'absolute', top: 6, start: 6, backgroundColor: '#ff2d55', color: '#fff', fontSize: 10, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  views: { position: 'absolute', bottom: 6, start: 6, flexDirection: 'row', alignItems: 'center', gap: 3 },
  viewsText: { color: '#fff', fontSize: 12, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
  soundRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  soundCover: { width: 52, height: 52, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  soundTitle: { fontSize: 15, fontWeight: '700' },
  empty: { alignItems: 'center', gap: 10, paddingHorizontal: 40, paddingVertical: 50 },
});
