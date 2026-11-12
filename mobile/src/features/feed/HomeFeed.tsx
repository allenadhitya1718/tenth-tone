import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native';
import PagerView from 'react-native-pager-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FeedList, type Pin } from './FeedList';
import { LiveTab } from './LiveTab';

const TABS = ['following', 'live', 'forYou'] as const;
// Lives are the heart of FLYP (client, Nov 2026): Live sits in the middle and
// Home opens on it.
const LIVE_PAGE = 1;
const FOR_YOU_PAGE = 2;

// Home: Following / Live / For You. Client note 24: the tabs switch by
// swiping as well as tapping, so they sit in a native horizontal pager.
export function HomeFeed({ pin }: { pin?: Pin }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  // Leaving the Home tab must stop the clip; coming back resumes it.
  const [screenFocused, setScreenFocused] = useState(true);
  const pager = useRef<PagerView>(null);
  // A clip opened from a profile, a notification or a link lands on For You.
  // A fresh Home starts there; an existing one turns to it once Home is on
  // screen: a setPage while the tab is still hidden behind the profile moved
  // the pager's state but not the view (Poco F6, 12 Nov: For You played
  // under the Live tab).
  const pinKey = pin ? `${pin.id}:${pin.at}` : '';
  const shownPin = useRef(pinKey);
  const focusedRef = useRef(false);
  const [page, setPage] = useState(pinKey ? FOR_YOU_PAGE : LIVE_PAGE);
  const showPin = useCallback(() => {
    if (!pinKey || shownPin.current === pinKey || !focusedRef.current) return;
    shownPin.current = pinKey;
    setPage(FOR_YOU_PAGE);
    requestAnimationFrame(() => pager.current?.setPageWithoutAnimation(FOR_YOU_PAGE));
  }, [pinKey]);
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      setScreenFocused(true);
      showPin();
      return () => {
        focusedRef.current = false;
        setScreenFocused(false);
      };
    }, [showPin]),
  );
  useEffect(showPin, [showPin]);
  const [height, setHeight] = useState(0);
  const [muted, setMuted] = useState(false);
  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  function go(i: number) {
    pager.current?.setPage(i);
  }

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
        initialPage={pinKey ? FOR_YOU_PAGE : LIVE_PAGE}
        layoutDirection={I18nManager.isRTL ? 'rtl' : 'ltr'}
        onPageSelected={(e) => {
          setPage(e.nativeEvent.position);
          void Haptics.selectionAsync();
        }}
      >
        <View key="following">
          <FeedList tab="following" height={height} focused={screenFocused && page === 0} muted={muted} onToggleMute={toggleMute} />
        </View>
        <View key="live">
          <LiveTab height={height} focused={screenFocused && page === LIVE_PAGE} />
        </View>
        <View key="foryou">
          <FeedList tab="foryou" pin={pin} height={height} focused={screenFocused && page === FOR_YOU_PAGE} muted={muted} onToggleMute={toggleMute} />
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
