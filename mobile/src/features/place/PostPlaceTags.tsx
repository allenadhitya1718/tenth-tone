import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fetchPostExtras, tagKeys } from '@/api/tags';
import type { Uuid } from '@/api/types';

import { openPlaceInMaps } from './placeName';
import { atHandle } from '@/lib/handle';

const SHOWN = 3;

// Client note 21, on the feed card under the caption: "📍 place" (opens the
// maps app there) and "with @a, @b" (each name opens that profile). The feed
// RPCs do not carry either, so they are read once the card is on screen and
// kept for the session; nothing is drawn until there is something to show.
export function PostPlaceTags({ videoId, active }: { videoId: Uuid; active: boolean }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: tagKeys.postExtras(videoId),
    queryFn: () => fetchPostExtras(videoId),
    enabled: active,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });
  const place = q.data?.place ?? null;
  const tags = q.data?.tags ?? [];
  if (!place && !tags.length) return null;

  const shown = tags.slice(0, SHOWN);
  const more = tags.length - shown.length;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {tags.length ? (
        <View style={styles.line}>
          <Ionicons name="people" size={13} color="#fff" style={styles.shadow} />
          <Text
            style={styles.text}
            numberOfLines={1}
            accessibilityLabel={t('place.taggedA11y', { names: tags.map((p) => p.handle ?? p.name).join(', ') })}
          >
            {t('place.with')}{' '}
            {shown.map((p, i) => (
              <Fragment key={p.id}>
                {i ? ', ' : ''}
                <Text style={styles.name} onPress={() => router.push(`/user/${p.id}`)} accessibilityRole="link">
                  {atHandle(p.handle ?? p.name)}
                </Text>
              </Fragment>
            ))}
            {more > 0 ? ` ${t('place.andMore', { n: more })}` : ''}
          </Text>
        </View>
      ) : null}
      {place ? (
        <Pressable
          onPress={() => openPlaceInMaps(place)}
          accessibilityRole="link"
          accessibilityLabel={t('place.openInMaps', { name: place.name })}
          hitSlop={6}
          style={[styles.line, styles.pill]}
        >
          <Ionicons name="location" size={13} color="#fff" />
          <Text style={styles.text} numberOfLines={1}>
            {place.name}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4, marginTop: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', maxWidth: '100%' },
  pill: { backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  text: { color: '#fff', fontSize: 13, flexShrink: 1, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  name: { fontWeight: '800' },
  shadow: { textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },
});
