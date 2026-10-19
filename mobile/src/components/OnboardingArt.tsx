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

// Onboarding v1b: real screenshots of the app inside a slim phone frame, with
// a few glass pieces breaking out past the frame edge. The screenshots are
// English-only captures; the title, subtitle and chips are translated.
// Placement uses start/end so Arabic and Urdu mirror cleanly.

export type ArtKind = 'watch' | 'create' | 'live' | 'chat';

export const FRAME_W = 188;
export const FRAME_H = 392;

const SHOTS: Record<ArtKind, ImageSourcePropType> = {
  watch: require('../../assets/onboarding/watch.jpg'),
  create: require('../../assets/onboarding/create.jpg'),
  live: require('../../assets/onboarding/live.jpg'),
  chat: require('../../assets/onboarding/chat.jpg'),
};

const GLASS = {
  backgroundColor: 'rgba(22,25,38,0.88)',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.15)',
} as const;

/** Gentle up/down drift for the pieces that float outside the frame. */
function Float({ children, style, delay = 0, amp = 5 }: { children: React.ReactNode; style?: ViewStyle; delay?: number; amp?: number }) {
  const y = useSharedValue(-amp);
  useEffect(() => {
    y.value = withDelay(delay, withRepeat(withTiming(amp, { duration: 2500, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [y, amp, delay]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}

function Chip({ icon, color, text, style, delay }: { icon: React.ComponentProps<typeof Ionicons>['name']; color: string; text: string; style: ViewStyle; delay?: number }) {
  return (
    <Float style={style} delay={delay}>
      <View style={[styles.chip, GLASS]}>
        <Ionicons name={icon} size={14} color={color} />
        <Text style={styles.chipTxt}>{text}</Text>
      </View>
    </Float>
  );
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
    transform: [{ translateY: -190 * p.value }, { translateX: Math.sin(p.value * Math.PI * 3) * drift }, { scale: 0.6 + 0.55 * p.value }],
  }));
  return <Animated.Text style={[{ position: 'absolute', bottom: 0, fontSize: size }, a]}>{emoji}</Animated.Text>;
}

function RisingHearts({ style }: { style: ViewStyle }) {
  const set: [string, number, number, number, number][] = [
    ['❤️', 0, 3600, 9, 20],
    ['💜', 700, 4000, 12, 17],
    ['💙', 1500, 3400, 8, 18],
    ['❤️', 2200, 3800, 11, 22],
    ['🔥', 2900, 3600, 7, 16],
    ['💖', 3300, 4200, 10, 19],
  ];
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', width: 40, height: 200 }, style]}>
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
            <Text style={{ color: '#fff', fontSize: 8, fontWeight: '800' }}>{l.who}</Text>
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
    <Animated.Text pointerEvents="none" style={[{ position: 'absolute', alignSelf: 'center', top: 130, fontSize: 64 }, a]}>
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

function Ring({ style, size }: { style: ViewStyle; size: number }) {
  const s = useSharedValue(0);
  useEffect(() => {
    s.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.out(Easing.quad) }), -1);
  }, [s]);
  const a = useAnimatedStyle(() => ({ opacity: 0.8 * (1 - s.value), transform: [{ scale: 1 + 0.55 * s.value }] }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: '#F43F5E' }, style, a]} />;
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

function WaveBar({ h, delay, color }: { h: number; delay: number; color: string }) {
  const s = useSharedValue(0.3);
  useEffect(() => {
    s.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 320 }), withTiming(0.3, { duration: 320 })), -1));
  }, [s, delay]);
  const a = useAnimatedStyle(() => ({ transform: [{ scaleY: s.value }] }));
  return <Animated.View style={[{ width: 2.5, height: 16 * h, borderRadius: 2, backgroundColor: color }, a]} />;
}

function Wave({ color }: { color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, height: 16 }}>
      {[0.5, 0.9, 0.6, 1, 0.7, 0.85, 0.45].map((h, i) => (
        <WaveBar key={i} h={h} delay={i * 90} color={color} />
      ))}
    </View>
  );
}

function WaveDot({ delay }: { delay: number }) {
  const s = useSharedValue(0);
  useEffect(() => {
    s.value = withDelay(delay, withRepeat(withSequence(withTiming(-4, { duration: 300 }), withTiming(0, { duration: 300 })), -1));
  }, [s, delay]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: s.value }] }));
  return <Animated.View style={[{ width: 5, height: 5, borderRadius: 3, backgroundColor: '#fff' }, a]} />;
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
          <RisingHearts style={{ end: 8, bottom: 70 }} />
          <View pointerEvents="none" style={[styles.likeCount, GLASS]}>
            <Ionicons name="heart" size={11} color="#F43F5E" />
            <Text style={styles.chipTxt}>{(likes / 1000).toFixed(1)}K</Text>
          </View>
        </>
      );
    case 'create':
      return (
        <>
          <Ring size={32} style={{ start: 75, bottom: 36 }} />
          <RecTimer />
        </>
      );
    case 'live':
      return (
        <>
          <View pointerEvents="none" style={styles.cover} />
          <RisingHearts style={{ end: 12, bottom: 34 }} />
          <CommentFeed
            style={{ start: 8, end: 30, bottom: 28 }}
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
          <View pointerEvents="none" style={[styles.talk, GLASS]}>
            <Wave color="#34D399" />
          </View>
        </>
      );
  }
}

function Breakout({ kind }: { kind: ArtKind }) {
  const { t } = useTranslation();
  switch (kind) {
    case 'watch':
      return (
        <>
          <Chip icon="musical-notes" color="#38BDF8" text={t('onboarding.mockSound')} style={{ position: 'absolute', start: -34, bottom: 120 }} delay={600} />
        </>
      );
    case 'create':
      return (
        <>
          <Chip icon="sparkles" color="#38BDF8" text="Neon" style={{ position: 'absolute', start: -30, top: 150 }} />
        </>
      );
    case 'live':
      return (
        <>
          <Float style={{ position: 'absolute', start: -38, bottom: 96 }}>
            <LinearGradient colors={['#F59E0B', '#8B5CF6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.gift}>
              <Text style={{ fontSize: 15 }}>🦅</Text>
              <Text style={styles.chipTxt}>{t('onboarding.mockGift')}</Text>
            </LinearGradient>
          </Float>
          <Chip icon="eye" color="#fff" text="1.2K" style={{ position: 'absolute', end: -22, top: 70 }} delay={600} />
        </>
      );
    case 'chat':
      return (
        <>
          <Chip icon="location" color="#34D399" text={t('onboarding.mockAway')} style={{ position: 'absolute', end: -34, top: 90 }} />
          <Chip icon="mic" color="#60A5FA" text={t('onboarding.mockHold')} style={{ position: 'absolute', start: -30, bottom: 100 }} delay={600} />
        </>
      );
  }
}

export function OnboardingArt({ kind, scale = 1 }: { kind: ArtKind; scale?: number }) {
  return (
    <View style={{ width: FRAME_W * scale, height: FRAME_H * scale }}>
      <View style={[styles.frame, { transform: [{ scale }], transformOrigin: 'top left' }]}>
        <View style={styles.clip}>
          <Image source={SHOTS[kind]} style={[StyleSheet.absoluteFill, { width: '100%', height: '100%', objectFit: 'cover' }]} accessibilityIgnoresInvertColors />
        </View>
        <Sim kind={kind} />
        <Breakout kind={kind} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: FRAME_W,
    height: FRAME_H,
    borderRadius: 30,
    backgroundColor: '#0B0C12',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.2)',
    shadowColor: '#6366F1',
    shadowOpacity: 0.45,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 14 },
    elevation: 14,
  },
  clip: { flex: 1, borderRadius: 27, overflow: 'hidden' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
  chipTxt: { color: '#fff', fontSize: 10.5, fontWeight: '800' },
  bub: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, paddingVertical: 3, paddingStart: 3, paddingEnd: 9, alignSelf: 'flex-start', marginTop: 4 },
  bubAv: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  bubTxt: { color: '#fff', fontSize: 9.5 },
  cover: { position: 'absolute', start: 0, end: 0, bottom: 24, height: 42, backgroundColor: '#04091F' },
  likeCount: { position: 'absolute', alignSelf: 'center', bottom: 66, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  rec: { position: 'absolute', alignSelf: 'center', top: 10, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#F43F5E', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  recBlip: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  recTxt: { color: '#fff', fontSize: 11, fontWeight: '800' },
  typing: { position: 'absolute', start: 10, bottom: 54, flexDirection: 'row', gap: 4, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 9 },
  talk: { position: 'absolute', end: 10, bottom: 54, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  gift: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, shadowColor: '#F59E0B', shadowOpacity: 0.7, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } },
});
