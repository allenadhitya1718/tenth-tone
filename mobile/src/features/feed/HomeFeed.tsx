import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native';
import PagerView from 'react-native-pager-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FeedList, type Pin } from './FeedList';
import { LiveTab } from './LiveTab';

const TABS = ['following', 'forYou', 'live'] as const;

// Home: Following / For You / Live. Client note 24: the tabs switch by
// swiping as well as tapping, so they sit in a native horizontal pager.
export function HomeFeed({ pin }: { pin?: Pin }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  // Leaving the Home tab must stop the clip; coming back resumes it.
  const [screenFocused, setScreenFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => setScreenFocused(false);
    }, []),
  );
  const pager = useRef<PagerView>(null);
  const [page, setPage] = useState(1);
  const [height, setHeight] = useState(0);
  const [muted, setMuted] = useState(false);
  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  function go(i: number) {
    pager.current?.setPage(i);
  }

  // A video opened from a profile, a notification or a link lands on For You.
  const pinKey = pin ? `${pin.id}:${pin.at}` : '';
  useEffect(() => {
    if (pinKey) pager.current?.setPage(1);
  }, [pinKey]);

  return (
    // While a sheet route (comments, share...) is open over the feed this
    // screen is blurred: hide it from TalkBack / VoiceOver (and uiautomator)
    // so the sheet on top is what accessibility services read, not the
    // playing video underneath.
    <View
      style={styles.root}
      // Whole device pixels: the feed snaps every `height`, and a fractional
      // page drifts a little further off with each clip.
      onLayout={(e) => setHeight(PixelRatio.roundToNearestPixel(e.nativeEvent.layout.height))}
      importantForAccessibility={screenFocused ? 'auto' : 'no-hide-descendants'}
      accessibilityElementsHidden={!screenFocused}
    >
      <PagerView
        ref={pager}
        style={StyleSheet.absoluteFill}
        initialPage={1}
        layoutDirection={I18nManager.isRTL ? 'rtl' : 'ltr'}
        onPageSelected={(e) => {
          setPage(e.nativeEvent.position);
          void Haptics.selectionAsync();
        }}
      >
        <View key="following">
          <FeedList tab="following" height={height} focused={screenFocused && page === 0} muted={muted} onToggleMute={toggleMute} />
        </View>
        <View key="foryou">
          <FeedList tab="foryou" pin={pin} height={height} focused={screenFocused && page === 1} muted={muted} onToggleMute={toggleMute} />
        </View>
        <View key="live">
          <LiveTab height={height} focused={screenFocused && page === 2} />
        </View>
      </PagerView>

      <View style={[styles.tabs, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        {TABS.map((k, i) => (
          <Pressable key={k} onPress={() => go(i)} accessibilityRole="tab" accessibilityState={{ selected: page === i }} hitSlop={8}>
            <Text style={[styles.tab, page === i && styles.tabOn]}>{t(`home.${k}`)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  tabs: { position: 'absolute', top: 0, start: 0, end: 0, flexDirection: 'row', justifyContent: 'center', gap: 24 },
  tab: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 16,
    fontWeight: '700',
    paddingBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 4,
  },
  tabOn: { color: '#fff', borderBottomWidth: 2, borderBottomColor: '#fff' },
});
