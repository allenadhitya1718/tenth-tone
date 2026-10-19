import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, Text, View, type ImageSourcePropType, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

// Onboarding v1b: real app screenshots in an oversized frame that melts into
// the background (bottom fade), one translated pill breaking out past the
// frame edge, and a little live simulation drawn over the still picture.
//
// Screenshots: English and Arabic sets (the app's two main languages). Every
// other language shows the English set; the title, subtitle and pill are
// translated for all nine. Placement uses start/end so Arabic and Urdu mirror.

export type ArtKind = 'watch' | 'create' | 'live' | 'chat';

/**
 * Design size of the phone frame. The screenshots are 1080x2252, so the inner
 * screen (frame minus the 2px bezel each side) is exactly that aspect ratio:
 * 246 x 513. Nothing is cropped or stretched.
 */
export const BEZEL = 2;
export const ART_W = 250;
export const ART_H = 553;
const IN_H = ART_H - BEZEL * 2;
/** The screenshots carry 160 source px of extra background below the real screen, keeping its controls clear of the rounded corners. */
const LIFT = IN_H * (160 / 2412);

const SHOTS: Record<'en' | 'ar', Record<ArtKind, ImageSourcePropType>> = {
  en: {
    watch: require('../../assets/onboarding/en/watch.jpg'),
    create: require('../../assets/onboarding/en/create.jpg'),
    live: require('../../assets/onboarding/en/live.jpg'),
    chat: require('../../assets/onboarding/en/chat.jpg'),
  },
  ar: {
    watch: require('../../assets/onboarding/ar/watch.jpg'),
    create: require('../../assets/onboarding/ar/create.jpg'),
    live: require('../../assets/onboarding/ar/live.jpg'),
    chat: require('../../assets/onboarding/ar/chat.jpg'),
  },
};

const GLASS = {
  backgroundColor: 'rgba(20,24,38,0.92)',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.2)',
} as const;

/** Gentle up/down drift for the pill that floats outside the frame. */
function Float({ children, style, amp = 6 }: { children: React.ReactNode; style?: ViewStyle; amp?: number }) {
  const y = useSharedValue(-amp);
  useEffect(() => {
    y.value = withRepeat(withTiming(amp, { duration: 2500, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [y, amp]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}

// ---- live simulation drawn over the still screenshots ------------------------

/** One heart rising from the corner and fading as it goes. Loops forever. */
function RisingHeart({ emoji, delay, dur, drift, size }: { emoji: string; delay: number; dur: number; drift: number; size: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(delay, withRepeat(withTiming(1, { duration: dur, easing: Easing.out(Easing.quad) }), -1, false));
  }, [p, delay, dur]);
  const a = useAnimatedStyle(() => ({
    opacity: p.value < 0.12 ? p.value / 0.12 : 1 - (p.value - 0.12) / 0.88,
    transform: [{ translateY: -250 * p.value }, { translateX: Math.sin(p.value * Math.PI * 3) * drift }, { scale: 0.6 + 0.55 * p.value }],
  }));
  return <Animated.Text style={[{ position: 'absolute', bottom: 0, fontSize: size }, a]}>{emoji}</Animated.Text>;
}

function RisingHearts({ style }: { style: ViewStyle }) {
  const set: [string, number, number, number, number][] = [
    ['❤️', 0, 3600, 12, 30],
    ['💜', 700, 4000, 16, 26],
    ['💙', 1500, 3400, 11, 28],
    ['❤️', 2200, 3800, 14, 34],
    ['🔥', 2900, 3600, 10, 24],
    ['💖', 3300, 4200, 13, 29],
  ];
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', width: 50, height: 260 }, style]}>
      {set.map(([e, d, du, dr, sz], i) => (
        <RisingHeart key={i} emoji={e} delay={d} dur={du} drift={dr} size={sz} />
      ))}
    </View>
  );
}

/** Comments arriving one by one, newest at the bottom, older ones sliding up. */
function CommentFeed({ lines, style }: { lines: { who: string; tone: [string, string]; text: string }[]; style: ViewStyle }) {
  const [n, setN] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setN((v) => v + 1), 1900);
    return () => clearInterval(id);
  }, []);
  const shown = [n - 2, n - 1, n].filter((i) => i >= 1).map((i) => ({ i, ...lines[(i - 1) % lines.length] }));
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', justifyContent: 'flex-end' }, style]}>
      {shown.map((l) => (
        <Animated.View key={l.i} entering={FadeInDown.duration(380)} exiting={FadeOut.duration(250)} layout={LinearTransition} style={styles.bub}>
          <LinearGradient colors={l.tone} style={styles.bubAv}>
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{l.who}</Text>
          </LinearGradient>
          <Text style={styles.bubTxt} numberOfLines={1}>
            {l.text}
          </Text>
        </Animated.View>
      ))}
    </View>
  );
}

/** Big heart that pops in the middle, like a double tap. */
function HeartBurst() {
  const s = useSharedValue(0);
  useEffect(() => {
    s.value = withRepeat(
      withSequence(withTiming(0, { duration: 1400 }), withTiming(1.15, { duration: 220 }), withTiming(1, { duration: 120 }), withTiming(1, { duration: 380 }), withTiming(0, { duration: 260 })),
      -1,
    );
  }, [s]);
  const a = useAnimatedStyle(() => ({ opacity: Math.min(1, s.value * 1.5), transform: [{ scale: s.value }] }));
  return (
    <Animated.Text pointerEvents="none" style={[{ position: 'absolute', alignSelf: 'center', top: IN_H * 0.3, fontSize: 84 }, a]}>
      ❤️
    </Animated.Text>
  );
}

/** Counter that ticks up while the slide is on screen. */
function useTick(start: number, step: number, ms: number) {
  const [v, setV] = useState(start);
  useEffect(() => {
    const id = setInterval(() => setV((x) => x + step), ms);
    return () => clearInterval(id);
  }, [step, ms]);
  return v;
}

function RecTimer() {
  const sec = useTick(7, 1, 1000);
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  const blink = useSharedValue(1);
  useEffect(() => {
    blink.value = withRepeat(withSequence(withTiming(0.2, { duration: 500 }), withTiming(1, { duration: 500 })), -1);
  }, [blink]);
  const a = useAnimatedStyle(() => ({ opacity: blink.value }));
  return (
    <View pointerEvents="none" style={styles.rec}>
      <Animated.View style={[styles.recBlip, a]} />
      <Text style={styles.recTxt}>
        {mm}:{ss}
      </Text>
    </View>
  );
}

function WaveDot({ delay }: { delay: number }) {
  const s = useSharedValue(0);
  useEffect(() => {
    s.value = withDelay(delay, withRepeat(withSequence(withTiming(-5, { duration: 300 }), withTiming(0, { duration: 300 })), -1));
  }, [s, delay]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: s.value }] }));
  return <Animated.View style={[{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff' }, a]} />;
}

function Typing() {
  return (
    <View pointerEvents="none" style={[styles.typing, GLASS]}>
      {[0, 1, 2].map((i) => (
        <WaveDot key={i} delay={i * 160} />
      ))}
    </View>
  );
}

/** The moving pieces drawn over each screenshot. */
function Sim({ kind }: { kind: ArtKind }) {
  const { t } = useTranslation();
  const likes = useTick(12400, 7, 650);
  switch (kind) {
    case 'watch':
      return (
        <>
          <HeartBurst />
          <RisingHearts style={{ end: 14, bottom: IN_H * 0.2 + LIFT }} />
          <View pointerEvents="none" style={[styles.likeCount, GLASS]}>
            <Ionicons name="heart" size={15} color="#F43F5E" />
            <Text style={styles.chipTxt}>{(likes / 1000).toFixed(1)}K</Text>
          </View>
        </>
      );
    case 'create':
      return <RecTimer />;
    case 'live':
      return (
        <>
          <RisingHearts style={{ end: 14, bottom: IN_H * 0.14 + LIFT }} />
          <CommentFeed
            style={{ start: 12, end: 44, bottom: IN_H * 0.15 + LIFT }}
            lines={[
              { who: 'ع', tone: ['#0284C7', '#38BDF8'], text: t('onboarding.mockMsg1') },
              { who: 'س', tone: ['#3B82F6', '#6366F1'], text: t('onboarding.mockMsg2') },
              { who: 'ن', tone: ['#BE123C', '#FB7185'], text: '🔥🔥🔥' },
              { who: 'م', tone: ['#7C3AED', '#C084FC'], text: '👏👏👏' },
            ]}
          />
        </>
      );
    case 'chat':
      return (
        <>
          <Typing />
        </>
      );
  }
}

const PILL: Record<ArtKind, { text: string; side: 'start' | 'end'; top: number }> = {
  watch: { text: 'onboarding.pillWatch', side: 'end', top: ART_H * 0.27 },
  create: { text: 'onboarding.pillCreate', side: 'start', top: ART_H * 0.36 },
  live: { text: 'onboarding.pillLive', side: 'start', top: ART_H * 0.42 },
  chat: { text: 'onboarding.pillChat', side: 'end', top: ART_H * 0.15 },
};

/** The one translated pill per slide that breaks out past the frame edge. */
function Pill({ kind }: { kind: ArtKind }) {
  const { t } = useTranslation();
  const p = PILL[kind];
  return (
    <Float style={{ position: 'absolute', [p.side]: -26, top: p.top, maxWidth: 230 }}>
      <View style={[styles.pill, GLASS]}>
        <Text style={styles.pillTxt}>{t(p.text)}</Text>
      </View>
    </Float>
  );
}

export function OnboardingArt({ kind, scale = 1 }: { kind: ArtKind; scale?: number }) {
  const { i18n } = useTranslation();
  const set = i18n.language === 'ar' ? SHOTS.ar : SHOTS.en;
  return (
    <View style={{ width: ART_W * scale, height: ART_H * scale }}>
      <View
        style={[
          styles.frame,
          // Physical left/top + a centre origin keep the scaled frame centred
          // in its box in both reading directions.
          { position: 'absolute', left: (ART_W * scale - ART_W) / 2, top: (ART_H * scale - ART_H) / 2, transform: [{ scale }], transformOrigin: 'center' },
        ]}
      >
        <View style={styles.clip}>
          <Image source={set[kind]} style={[StyleSheet.absoluteFill, { width: '100%', height: '100%', objectFit: 'cover' }]} accessibilityIgnoresInvertColors />
          <LinearGradient colors={['rgba(7,8,13,0)', 'rgba(7,8,13,0.85)', '#07080D']} style={styles.fade} pointerEvents="none" />
          <Sim kind={kind} />
        </View>
        <Pill kind={kind} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: ART_W,
    height: ART_H,
    borderRadius: 36,
    backgroundColor: '#11131F',
    borderWidth: BEZEL,
    borderColor: 'rgba(255,255,255,0.18)',
    shadowColor: '#6366F1',
    shadowOpacity: 0.45,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 16 },
    elevation: 14,
  },
  clip: { flex: 1, borderRadius: 36 - BEZEL, overflow: 'hidden' },
  fade: { position: 'absolute', start: 0, end: 0, bottom: 0, height: '12%' },
  pill: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  pillTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },
  chipTxt: { color: '#fff', fontSize: 14, fontWeight: '800' },
  bub: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, paddingVertical: 4, paddingStart: 4, paddingEnd: 12, alignSelf: 'flex-start', marginTop: 6 },
  bubAv: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  bubTxt: { color: '#fff', fontSize: 13 },
  likeCount: { position: 'absolute', alignSelf: 'center', bottom: IN_H * 0.2 + LIFT, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 6 },
  rec: { position: 'absolute', alignSelf: 'center', top: IN_H * 0.07 - 14, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#F43F5E', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  recBlip: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  recTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
  typing: { position: 'absolute', start: 14, bottom: IN_H * 0.11 + LIFT, flexDirection: 'row', gap: 5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 12 },
});
