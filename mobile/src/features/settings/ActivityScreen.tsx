import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { deleteMyComment, fetchMyComments, type MyComment } from '@/api/comments';
import { countMyContent, fetchMyLikedVideos } from '@/api/videos';
import { Screen, TopBar } from '@/components/ui';
import { formatCount } from '@/features/feed/format';
import { timeAgo } from '@/lib/timeAgo';
import { useTheme } from '@/providers/ThemeProvider';

import { confirm, EmptyView, ErrorView, go, LoadingView, showError } from './components';

type Tab = 'likes' | 'comments';
const keys = {
  counts: ['myActivity', 'counts'] as const,
  likes: ['myActivity', 'likes'] as const,
  comments: ['myActivity', 'comments'] as const,
};

// What you did (likes, comments), not what was done to you.
export function ActivityScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('likes');
  const [deleting, setDeleting] = useState<string | null>(null);

  const counts = useQuery({ queryKey: keys.counts, queryFn: countMyContent });
  const likes = useQuery({ queryKey: keys.likes, queryFn: () => fetchMyLikedVideos(), enabled: tab === 'likes' });
  const comments = useQuery({ queryKey: keys.comments, queryFn: () => fetchMyComments(), enabled: tab === 'comments' });
  const active = tab === 'likes' ? likes : comments;

  const tile = Math.floor((width - 32 - 8) / 3);

  async function removeComment(c: MyComment) {
    const yes = await confirm({
      title: t('settings2.activity.deleteTitle'),
      message: t('settings2.activity.deleteBody'),
      confirmLabel: t('settings2.activity.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!yes) return;
    setDeleting(c.id);
    try {
      await deleteMyComment(c.id);
      qc.setQueryData<MyComment[]>(keys.comments, (rows) => rows?.filter((r) => r.id !== c.id));
      qc.invalidateQueries({ queryKey: ['myActivity'] });
    } catch (e) {
      showError(t, e, 'settings2.activity.deleteFailed');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Screen header={<TopBar title={t('settings2.activity.title')} />} contentStyle={styles.content}>
      <View style={[styles.stats, { backgroundColor: colors.bg2 }]}>
        {(['posts', 'likes', 'comments'] as const).map((k) => (
          <View key={k} style={styles.stat} accessible accessibilityLabel={`${counts.data?.[k] ?? 0} ${t(`settings2.activity.stat_${k}`)}`}>
            <Text style={[styles.statNum, { color: colors.text }]}>{counts.data ? formatCount(counts.data[k]) : '–'}</Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>{t(`settings2.activity.stat_${k}`)}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.tabs, { borderBottomColor: colors.border }]} accessibilityRole="tablist">
        {(['likes', 'comments'] as Tab[]).map((k) => (
          <Pressable
            key={k}
            onPress={() => setTab(k)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === k }}
            style={[styles.tab, tab === k && { borderBottomColor: colors.text }]}
          >
            <Text style={{ color: tab === k ? colors.text : colors.muted, fontWeight: '700' }}>{t(`settings2.activity.tab_${k}`)}</Text>
          </Pressable>
        ))}
      </View>

      {active.isLoading ? (
        <LoadingView />
      ) : active.isError ? (
        <ErrorView onRetry={() => active.refetch()} />
      ) : tab === 'likes' ? (
        likes.data?.length ? (
          <View style={styles.grid}>
            {likes.data.map((v) => (
              <Pressable
                key={v.id}
                onPress={() => go(`/video/${v.id}`)}
                accessibilityRole="button"
                accessibilityLabel={v.description || t('settings2.activity.video')}
                style={{ width: tile, height: tile * 1.33, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.bg3 }}
              >
                {v.thumbnail ? <Image source={{ uri: v.thumbnail }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
              </Pressable>
            ))}
          </View>
        ) : (
          <EmptyView icon="heart-outline" title={t('settings2.activity.noLikes')} />
        )
      ) : comments.data?.length ? (
        <View>
          {comments.data.map((c) => (
            <View key={c.id} style={[styles.comment, { borderBottomColor: colors.border }]}>
              <Pressable
                style={{ flex: 1, minWidth: 0 }}
                onPress={() => go(`/video/${c.video_id}`)}
                accessibilityRole="button"
                accessibilityHint={t('settings2.activity.openVideo')}
              >
                <Text style={{ color: colors.text, fontSize: 14.5, textAlign: 'left' }} numberOfLines={3}>
                  {/* 0144: a GIF comment may have no text of its own. */}
                  {c.gif_url ? [c.text.trim(), t('gif.preview')].filter(Boolean).join(' · ') : c.text}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 3, textAlign: 'left' }}>
                  {timeAgo(c.created_at, t, i18n.language)}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => removeComment(c)}
                disabled={deleting === c.id}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('settings2.activity.delete')}
              >
                <Ionicons name="trash-outline" size={20} color={deleting === c.id ? colors.muted2 : colors.danger} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : (
        <EmptyView icon="chatbubble-outline" title={t('settings2.activity.noComments')} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  stats: { flexDirection: 'row', borderRadius: 14, paddingVertical: 14, marginTop: 6 },
  stat: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 20, fontWeight: '800' },
  statLabel: { fontSize: 12.5, marginTop: 2 },
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, marginTop: 16, marginBottom: 10 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  comment: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
});
