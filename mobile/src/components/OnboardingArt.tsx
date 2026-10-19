import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

// Dark, layered mock-ups for the redesigned tour. Each one fills its frame
// with real FLYP interface (no empty gradients) and lets a few glass pieces
// break out past the frame edge so the picture feels three-dimensional.
// All horizontal placement uses start/end so Arabic and Urdu mirror cleanly.

export type ArtKind = 'watch' | 'create' | 'live' | 'chat';

export const FRAME_W = 260;
export const FRAME_H = 370;

const GLASS = {
  backgroundColor: 'rgba(22,25,38,0.85)',
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

function Pulse({ children, style, color }: { children: React.ReactNode; style?: ViewStyle; color: string }) {
  const s = useSharedValue(1);
  useEffect(() => {
    s.value = withRepeat(withSequence(withTiming(1.14, { duration: 900 }), withTiming(1, { duration: 900 })), -1);
  }, [s]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }], opacity: 2 - s.value * 1.2 }));
  return (
    <View style={style}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 999, borderWidth: 2, borderColor: color }, a]} />
      {children}
    </View>
  );
}

function Disc() {
  const r = useSharedValue(0);
  useEffect(() => {
    r.value = withRepeat(withTiming(360, { duration: 5000, easing: Easing.linear }), -1);
  }, [r]);
  const a = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value}deg` }] }));
  return (
    <Animated.View style={[styles.disc, a]}>
      <LinearGradient colors={['#38BDF8', '#8B5CF6', '#F43F5E']} style={StyleSheet.absoluteFill} />
      <View style={styles.discHole} />
    </Animated.View>
  );
}

function Avatar({ letter, size, colors, ring }: { letter: string; size: number; colors: [string, string]; ring?: string }) {
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, ring ? { borderWidth: 2, borderColor: ring } : null]}>
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Text style={{ color: '#fff', fontSize: size * 0.42, fontWeight: '800' }}>{letter}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- slide 1
function Watch() {
  const { t } = useTranslation();
  return (
    <>
      <LinearGradient colors={['#1E1B4B', '#701A75', '#EA580C']} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={StyleSheet.absoluteFill} />
      <Svg width={FRAME_W} height={FRAME_H} style={StyleSheet.absoluteFill}>
        <Circle cx={FRAME_W * 0.55} cy={FRAME_H * 0.56} r={46} fill="#FDBA74" opacity={0.9} />
        <Path d={`M0 ${FRAME_H * 0.7} Q 70 ${FRAME_H * 0.6} 130 ${FRAME_H * 0.72} T ${FRAME_W} ${FRAME_H * 0.68} V ${FRAME_H} H0 Z`} fill="#4A044E" opacity={0.85} />
        <Path d={`M0 ${FRAME_H * 0.82} Q 90 ${FRAME_H * 0.74} 170 ${FRAME_H * 0.84} T ${FRAME_W} ${FRAME_H * 0.8} V ${FRAME_H} H0 Z`} fill="#1E1B4B" />
      </Svg>
      <View style={styles.tabs}>
        <Text style={[styles.tab, { opacity: 0.6 }]}>{t('onboarding.mockFollowing')}</Text>
        <Text style={[styles.tab, styles.tabOn]}>{t('onboarding.mockForYou')}</Text>
        <View>
          <Text style={[styles.tab, { opacity: 0.6 }]}>{t('onboarding.mockLive')}</Text>
          <View style={styles.liveDot} />
        </View>
      </View>
      <View style={styles.watchInfo}>
        <View style={styles.row6}>
          <Avatar letter="س" size={26} colors={['#3B82F6', '#6366F1']} />
          <Text style={styles.creator}>@sara.k</Text>
          <Ionicons name="checkmark-circle" size={13} color="#38BDF8" />
        </View>
        <Text style={styles.caption} numberOfLines={2}>
          {t('onboarding.mockCaption')}
        </Text>
        <View style={styles.ticker}>
          <Ionicons name="musical-notes" size={10} color="#fff" />
          <Text style={styles.tickerTxt} numberOfLines={1}>
            {t('onboarding.mockSound')} · sara.k
          </Text>
        </View>
      </View>
    </>
  );
}

function WatchBreakout() {
  const rail: [React.ComponentProps<typeof Ionicons>['name'], string, string][] = [
    ['heart', '#F43F5E', '12.4K'],
    ['chatbubble', '#fff', '318'],
    ['bookmark', '#FBBF24', '1.1K'],
    ['arrow-redo', '#fff', '96'],
  ];
  return (
    <Float style={styles.rail} amp={4}>
      <View style={[styles.railPill, GLASS]}>
        {rail.map(([ic, c, n]) => (
          <View key={ic} style={{ alignItems: 'center' }}>
            <Ionicons name={ic} size={21} color={c} />
            <Text style={styles.railN}>{n}</Text>
          </View>
        ))}
      </View>
      <Disc />
    </Float>
  );
}

// ---------------------------------------------------------------- slide 2
const BARS = [10, 18, 12, 24, 16, 28, 14, 22, 10, 20, 26, 12];
const FILTERS: [string, string][] = [['#FDBA74', '#EA580C'], ['#22D3EE', '#8B5CF6'], ['#A8A29E', '#57534E'], ['#E5E7EB', '#6B7280']];

function Create() {
  const { t } = useTranslation();
  return (
    <>
      <LinearGradient colors={['#0B1424', '#0F2A3D', '#0B3B4B']} style={StyleSheet.absoluteFill} />
      <View style={styles.neon} />
      {[
        { top: 70, start: 18, bt: 2, bs: 2 },
        { top: 70, end: 18, bt: 2, be: 2 },
        { top: 232, start: 18, bb: 2, bs: 2 },
        { top: 232, end: 18, bb: 2, be: 2 },
      ].map((c, i) => (
        <View
          key={i}
          style={{
            position: 'absolute', width: 18, height: 18, top: c.top, start: c.start, end: c.end, borderColor: 'rgba(255,255,255,0.7)',
            borderTopWidth: c.bt ?? 0, borderBottomWidth: c.bb ?? 0, borderStartWidth: c.bs ?? 0, borderEndWidth: c.be ?? 0,
          }}
        />
      ))}
      <View style={styles.camTop}>
        <View style={styles.recPill}>
          <View style={styles.recBlip} />
          <Text style={styles.recTxt}>00:07</Text>
        </View>
        <View style={styles.row6}>
          {['0.5x', '1x', '2x'].map((z) => (
            <Text key={z} style={[styles.chip, z === '1x' && styles.chipOn]}>
              {z}
            </Text>
          ))}
        </View>
      </View>
      <View style={[styles.soundPill, GLASS]}>
        <Ionicons name="musical-notes" size={11} color="#fff" />
        <Text style={styles.soundTxt}>{t('onboarding.mockSound')}</Text>
        <View style={styles.eq}>
          {BARS.map((h, i) => (
            <View key={i} style={{ width: 2.5, height: h * 0.7, borderRadius: 2, backgroundColor: '#38BDF8' }} />
          ))}
        </View>
      </View>
      <View style={styles.shutterRow}>
        {FILTERS.slice(0, 2).map((f, i) => (
          <LinearGradient key={i} colors={f} style={styles.filterThumb} />
        ))}
        <View style={styles.shutter}>
          <View style={styles.shutterDot} />
        </View>
        {FILTERS.slice(2).map((f, i) => (
          <LinearGradient key={i} colors={f} style={styles.filterThumb} />
        ))}
      </View>
      <View style={styles.trim}>
        <View style={styles.trimSel} />
        <View style={[styles.trimHandle, { start: 36 }]} />
        <View style={[styles.trimHandle, { end: 52 }]} />
        <Text style={styles.trimTxt}>00:07</Text>
      </View>
    </>
  );
}

function CreateBreakout() {
  return (
    <Float style={styles.flagStart} amp={4}>
      <View style={[styles.flag, GLASS]}>
        <Ionicons name="sparkles" size={13} color="#38BDF8" />
        <Text style={styles.flagTxt}>Neon</Text>
      </View>
    </Float>
  );
}

// ---------------------------------------------------------------- slide 3
function Live() {
  const { t } = useTranslation();
  return (
    <>
      <LinearGradient colors={['#2A0F1D', '#1B0F2E', '#0E0B1A']} style={StyleSheet.absoluteFill} />
      <View style={styles.liveBar}>
        <Text style={styles.livePill}>{t('onboarding.mockLive')}</Text>
        <View style={styles.viewers}>
          <Ionicons name="eye" size={10} color="#fff" />
          <Text style={styles.viewersTxt}>1.2K</Text>
        </View>
        <View style={styles.viewers}>
          <Ionicons name="mic" size={10} color="#fff" />
          <Text style={styles.viewersTxt}>{t('onboarding.mockStage')}</Text>
        </View>
      </View>
      <View style={styles.stage}>
        <Pulse color="#22D3EE" style={styles.host}>
          <Avatar letter="س" size={62} colors={['#3B82F6', '#6366F1']} ring="#fff" />
        </Pulse>
        <View style={styles.guests}>
          {[
            { l: 'أ', c: ['#0284C7', '#38BDF8'] as [string, string] },
            { l: 'ن', c: ['#BE123C', '#FB7185'] as [string, string] },
            { l: 'س', c: ['#7C3AED', '#C084FC'] as [string, string] },
          ].map((g, i) => (
            <Avatar key={i} letter={g.l} size={44} colors={g.c} />
          ))}
          <View style={styles.slotReq}>
            <Text style={{ fontSize: 15 }}>✋</Text>
          </View>
        </View>
        <Text style={styles.reqTxt}>{t('onboarding.mockRequest')}</Text>
      </View>
      <View style={styles.liveMsgs}>
        <View style={styles.bub}>
          <Avatar letter="ع" size={18} colors={['#0284C7', '#38BDF8']} />
          <Text style={styles.bubTxt}>{t('onboarding.mockMsg1')}</Text>
        </View>
        <View style={styles.bub}>
          <Avatar letter="س" size={18} colors={['#3B82F6', '#6366F1']} />
          <Text style={styles.bubTxt}>{t('onboarding.mockMsg2')}</Text>
        </View>
      </View>
      <View style={styles.hearts}>
        <Text style={{ fontSize: 18 }}>❤️</Text>
        <Text style={{ fontSize: 14, marginTop: -5 }}>💙</Text>
        <Text style={{ fontSize: 20, marginTop: -5 }}>💜</Text>
      </View>
    </>
  );
}

function LiveBreakout() {
  const { t } = useTranslation();
  return (
    <Float style={styles.giftPos} amp={5}>
      <LinearGradient colors={['#F59E0B', '#8B5CF6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.gift}>
        <Text style={{ fontSize: 15 }}>🦅</Text>
        <Text style={styles.giftTxt}>{t('onboarding.mockGift')}</Text>
      </LinearGradient>
    </Float>
  );
}

// ---------------------------------------------------------------- slide 4
function Chat() {
  const { t } = useTranslation();
  return (
    <>
      <LinearGradient colors={['#0B1A18', '#0B1220']} style={StyleSheet.absoluteFill} />
      <View style={styles.chatTop}>
        <View style={[styles.row6, { alignItems: 'flex-end' }]}>
          <Avatar letter="ن" size={20} colors={['#BE123C', '#FB7185']} />
          <Text style={styles.msg}>{t('onboarding.mockChat1')}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.msg, { backgroundColor: '#3B82F6' }]}>{t('onboarding.mockChat2')}</Text>
        </View>
      </View>
      <View style={styles.radar}>
        <Svg width="100%" height="100%" viewBox="0 0 230 120" preserveAspectRatio="xMidYMid slice">
          <Path d="M-10 70 L240 48" stroke="rgba(255,255,255,0.16)" strokeWidth={5} />
          <Path d="M130 -10 L146 130" stroke="rgba(255,255,255,0.16)" strokeWidth={5} />
          <Path d="M0 110 Q 90 80 240 100" stroke="rgba(16,185,129,0.4)" strokeWidth={3} fill="none" />
          {[16, 34, 54].map((r) => (
            <Circle key={r} cx={115} cy={62} r={r} stroke="rgba(52,211,153,0.5)" strokeWidth={1} fill="rgba(16,185,129,0.06)" />
          ))}
        </Svg>
        <View style={{ position: 'absolute', top: 18, start: 40 }}>
          <Pulse color="#34D399" style={{ width: 28, height: 28 }}>
            <Avatar letter="س" size={28} colors={['#3B82F6', '#6366F1']} ring="#fff" />
          </Pulse>
        </View>
        <View style={{ position: 'absolute', top: 58, end: 36 }}>
          <Avatar letter="ع" size={28} colors={['#0284C7', '#38BDF8']} ring="#fff" />
        </View>
        <Text style={styles.away}>{t('onboarding.mockAway')}</Text>
        <Text style={styles.mapLbl}>{t('onboarding.mockMap')}</Text>
      </View>
      <View style={[styles.walkie, GLASS]}>
        <View style={styles.row6}>
          <View style={styles.walkieDot} />
          <Text style={styles.walkieTxt}>{t('onboarding.mockWalkie')}</Text>
        </View>
        <View style={styles.wave}>
          {BARS.concat(BARS.slice(0, 6)).map((h, i) => (
            <View key={i} style={{ width: 2.5, height: h * 0.6, borderRadius: 2, backgroundColor: i % 2 ? '#10B981' : '#3B82F6' }} />
          ))}
        </View>
        <View style={styles.hold}>
          <Ionicons name="mic" size={14} color="#fff" />
          <Text style={styles.holdTxt}>{t('onboarding.mockHold')}</Text>
        </View>
      </View>
    </>
  );
}

function ChatBreakout() {
  return (
    <Float style={styles.flagEnd} amp={4}>
      <View style={[styles.flag, GLASS]}>
        <Ionicons name="location" size={13} color="#34D399" />
        <Text style={styles.flagTxt}>Riyadh</Text>
      </View>
    </Float>
  );
}

const ART = {
  watch: [Watch, WatchBreakout],
  create: [Create, CreateBreakout],
  live: [Live, LiveBreakout],
  chat: [Chat, ChatBreakout],
} as const;

export function OnboardingArt({ kind, scale = 1 }: { kind: ArtKind; scale?: number }) {
  const [Inner, Breakout] = ART[kind];
  return (
    <View style={{ width: FRAME_W * scale, height: FRAME_H * scale }}>
      <View style={[styles.frame, { transform: [{ scale }], transformOrigin: 'top left' }]}>
        <View style={styles.clip}>
          <Inner />
        </View>
        <Breakout />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: FRAME_W, height: FRAME_H, borderRadius: 34, backgroundColor: '#11131F', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.18)', shadowColor: '#6366F1', shadowOpacity: 0.45, shadowRadius: 30, shadowOffset: { width: 0, height: 14 }, elevation: 14 },
  clip: { flex: 1, borderRadius: 32, overflow: 'hidden' },
  row6: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  tabs: { position: 'absolute', top: 14, start: 0, end: 0, flexDirection: 'row', justifyContent: 'center', gap: 14 },
  tab: { color: '#fff', fontSize: 11.5, fontWeight: '700' },
  tabOn: { borderBottomWidth: 2, borderBottomColor: '#fff', paddingBottom: 2, opacity: 1 },
  liveDot: { position: 'absolute', top: -2, end: -6, width: 5, height: 5, borderRadius: 3, backgroundColor: '#F43F5E' },
  watchInfo: { position: 'absolute', bottom: 16, start: 12, end: 60, gap: 6 },
  creator: { color: '#fff', fontSize: 11.5, fontWeight: '800' },
  caption: { color: '#fff', fontSize: 10.5, lineHeight: 14 },
  ticker: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', backgroundColor: 'rgba(0,0,0,0.42)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  tickerTxt: { color: '#fff', fontSize: 9.5, fontWeight: '600', maxWidth: 120 },
  rail: { position: 'absolute', end: -22, bottom: 24, alignItems: 'center', gap: 10 },
  railPill: { borderRadius: 24, paddingVertical: 12, paddingHorizontal: 10, gap: 13 },
  railN: { color: '#fff', fontSize: 9.5, fontWeight: '800', marginTop: 2 },
  disc: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden', borderWidth: 2, borderColor: '#0B0C12', alignItems: 'center', justifyContent: 'center' },
  discHole: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#0B0C12' },

  neon: { position: 'absolute', top: 100, alignSelf: 'center', width: 112, height: 112, borderRadius: 56, borderWidth: 3, borderColor: '#22D3EE', shadowColor: '#22D3EE', shadowOpacity: 0.9, shadowRadius: 18, shadowOffset: { width: 0, height: 0 }, backgroundColor: 'rgba(34,211,238,0.07)' },
  camTop: { position: 'absolute', top: 14, start: 12, end: 12, alignItems: 'center', gap: 8 },
  recPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(244,63,94,0.95)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 4 },
  recBlip: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff' },
  recTxt: { color: '#fff', fontSize: 12, fontWeight: '800' },
  chip: { color: '#fff', fontSize: 9.5, fontWeight: '800', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.45)', overflow: 'hidden' },
  chipOn: { backgroundColor: '#fff', color: '#0B0C12' },
  soundPill: { position: 'absolute', bottom: 150, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  soundTxt: { color: '#fff', fontSize: 9.5, fontWeight: '700' },
  eq: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  shutterRow: { position: 'absolute', bottom: 70, start: 0, end: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  filterThumb: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)' },
  shutter: { width: 58, height: 58, borderRadius: 29, borderWidth: 4, borderColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  shutterDot: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F43F5E' },
  trim: { position: 'absolute', bottom: 16, start: 14, end: 14, height: 34, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
  trimSel: { position: 'absolute', top: 0, bottom: 0, start: 36, end: 52, borderTopWidth: 2, borderBottomWidth: 2, borderColor: '#FBBF24', backgroundColor: 'rgba(251,191,36,0.15)' },
  trimHandle: { position: 'absolute', top: -2, bottom: -2, width: 6, borderRadius: 3, backgroundColor: '#FBBF24' },
  trimTxt: { color: '#fff', fontSize: 9, fontWeight: '800' },
  flagStart: { position: 'absolute', start: -22, top: 118 },
  flagEnd: { position: 'absolute', end: -20, top: 70 },
  flag: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
  flagTxt: { color: '#fff', fontSize: 10.5, fontWeight: '800' },

  liveBar: { position: 'absolute', top: 14, start: 12, flexDirection: 'row', gap: 5, alignItems: 'center' },
  livePill: { color: '#fff', backgroundColor: '#F43F5E', fontSize: 9, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  viewers: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  viewersTxt: { color: '#fff', fontSize: 9, fontWeight: '700' },
  stage: { position: 'absolute', top: 56, start: 0, end: 0, alignItems: 'center', gap: 12 },
  host: { width: 70, height: 70, alignItems: 'center', justifyContent: 'center', borderRadius: 35 },
  guests: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  slotReq: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.45)', alignItems: 'center', justifyContent: 'center' },
  reqTxt: { color: 'rgba(255,255,255,0.7)', fontSize: 9.5, fontWeight: '600' },
  liveMsgs: { position: 'absolute', bottom: 16, start: 12, gap: 5 },
  bub: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 999, paddingVertical: 3, paddingStart: 4, paddingEnd: 10, alignSelf: 'flex-start' },
  bubTxt: { color: '#fff', fontSize: 9.5 },
  hearts: { position: 'absolute', end: 14, bottom: 70, alignItems: 'center' },
  giftPos: { position: 'absolute', start: -26, bottom: 96 },
  gift: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, shadowColor: '#F59E0B', shadowOpacity: 0.7, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } },
  giftTxt: { color: '#fff', fontSize: 10.5, fontWeight: '800' },

  chatTop: { position: 'absolute', top: 16, start: 12, end: 12, gap: 7 },
  msg: { color: '#fff', fontSize: 10, lineHeight: 14, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 15, backgroundColor: '#2B2F42', overflow: 'hidden' },
  radar: { position: 'absolute', top: 100, start: 12, end: 12, height: 120, borderRadius: 16, overflow: 'hidden', backgroundColor: '#0E2A22', borderWidth: 1, borderColor: 'rgba(52,211,153,0.35)' },
  away: { position: 'absolute', bottom: 8, end: 10, color: '#fff', fontSize: 9, fontWeight: '800', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  mapLbl: { position: 'absolute', top: 8, start: 10, color: 'rgba(255,255,255,0.8)', fontSize: 9, fontWeight: '700' },
  walkie: { position: 'absolute', bottom: 14, start: 12, end: 12, borderRadius: 18, padding: 11, gap: 8 },
  walkieDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#10B981' },
  walkieTxt: { color: '#fff', fontSize: 10.5, fontWeight: '800' },
  wave: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2.5, height: 22 },
  hold: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#3B82F6', borderRadius: 999, paddingVertical: 7 },
  holdTxt: { color: '#fff', fontSize: 11, fontWeight: '800' },
});
