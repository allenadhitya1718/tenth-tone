import { useEventListener } from 'expo';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect } from 'react';
import { type Animated, StyleSheet } from 'react-native';

import type { UserStory } from '@/api/stories';

type Common = {
  story: UserStory;
  onReady: (id: string) => void;
  onFail: (id: string) => void;
};

// A photo story. The viewer's timer starts on onReady, so a slow network
// never eats into the five seconds.
export function ImageStory({ story, onReady, onFail }: Common) {
  return (
    <Image
      source={{ uri: story.media_url }}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      transition={120}
      recyclingKey={story.id}
      onLoad={() => onReady(story.id)}
      onError={() => onFail(story.id)}
      accessibilityIgnoresInvertColors
    />
  );
}

// A video story: plays once, its own duration is the story's length, and the
// progress bar follows the playhead.
export function VideoStory({
  story,
  paused,
  progress,
  onReady,
  onFail,
  onEnd,
}: Common & { paused: boolean; progress: Animated.Value; onEnd: () => void }) {
  const player = useVideoPlayer({ uri: story.media_url, useCaching: true }, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 0.1;
  });

  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'readyToPlay') onReady(story.id);
    if (status === 'error') onFail(story.id);
  });
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (player.duration > 0) progress.setValue(Math.min(1, currentTime / player.duration));
  });
  useEventListener(player, 'playToEnd', () => {
    progress.setValue(1);
    onEnd();
  });

  useEffect(() => {
    if (paused) player.pause();
    else player.play();
  }, [player, paused]);

  return (
    <>
      {story.poster_url ? (
        <Image source={{ uri: story.poster_url }} style={StyleSheet.absoluteFill} contentFit="contain" />
      ) : null}
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls={false}
        surfaceType="textureView"
      />
    </>
  );
}
