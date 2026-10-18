import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Circle } from 'react-native-svg';

import { Backdrop } from './Backdrop';

// The onboarding mock-ups from V.onboarding in web/js/views.js: a phone
// showing FLYP's own interface over a branded backdrop. No photos and no
// invented faces, just the interface.

export type ArtKind = 'watch' | 'create' | 'live' | 'chat';

const TONES: Record<1 | 2 | 3, [string, string]> = {
  1: ['#1e56d6', '#5b9bf5'],
  2: ['#0284c7', '#38bdf8'],
  3: ['#be123c', '#fb7185'],
};

function Avatar({ letter, size, tone, ring }: { letter: string; size: number; tone: 1 | 2 | 3; ring?: boolean }) {
  const [a, b] = TONES[tone];
  const id = `av${tone}`;
  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, ring && styles.ring]}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={a} />
            <Stop offset="1" stopColor={b} />
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
      </Svg>
      <Text style={styles.avLetter}>{letter}</Text>
    </View>
  );
}

const W = (s: string) => <Text style={styles.white}>{s}</Text>;

function Watch() {
  const { t } = useTranslation();
  return (
    <>
      <Backdrop
        base={['#101a36', '#080b18']}
        washes={[
          { cx: 0.2, cy: 0.15, rx: 1.2, ry: 0.8, color: '#3b82f6', stop: 0.55 },
          { cx: 0.85, cy: 0.8, rx: 1, ry: 0.7, color: '#ec4899', stop: 0.6 },
        ]}
      />
      <View style={styles.tabs}>
        <Text style={[styles.tab, { opacity: 0.6 }]}>{t('onboarding.mockFollowing')}</Text>
        <Text style={[styles.tab, styles.tabOn]}>{t('onboarding.mockForYou')}</Text>
      </View>
      <View style={styles.rail}>
        {([['heart', '#ff2d55', '12.4K'], ['chatbubble', '#fff', '318'], ['arrow-redo', '#fff', '96']] as const).map(([ic, c, n]) => (
          <View key={ic} style={{ alignItems: 'center' }}>
            <Ionicons name={ic} size={22} color={c} />
            <Text style={styles.railN}>{n}</Text>
          </View>
        ))}
      </View>
      <View style={styles.caption}>
        <View style={styles.row6}>
          <Avatar letter="س" size={22} tone={1} />
          <Text style={[styles.white, { fontSize: 10.5, fontWeight: '700' }]}>sara.k</Text>
        </View>
        <Text style={[styles.white, { fontSize: 10, opacity: 0.92, marginTop: 4 }]}>{t('onboarding.mockCaption')}</Text>
      </View>
      <View style={styles.swipe} />
    </>
  );
}

function Create() {
  const { t } = useTranslation();
  return (
    <>
      <Backdrop
        base={['#0f1b2e', '#0a0f18']}
        washes={[
          { cx: 0.5, cy: 0, rx: 0.9, ry: 0.6, color: '#2563eb', stop: 0.55 },
          { cx: 0.3, cy: 1, rx: 1.2, ry: 0.9, color: '#0891b2', stop: 0.6 },
        ]}
      />
      <View style={styles.grid} pointerEvents="none">
        {[1, 2].map((i) => (
          <View key={`h${i}`} style={[styles.gridLine, { top: `${(i * 100) / 3}%`, left: 0, right: 0, height: 1 }]} />
        ))}
        {[1, 2].map((i) => (
          <View key={`v${i}`} style={[styles.gridLine, { left: `${(i * 100) / 3}%`, top: 0, bottom: 0, width: 1 }]} />
        ))}
      </View>
      <View style={styles.camTop}>
        {['0.5x', '1x', '2x'].map((z) => (
          <Text key={z} style={[styles.chip, z === '1x' && styles.chipOn]}>
            {z}
          </Text>
        ))}
      </View>
      <View style={styles.timer}>{W('00:07')}</View>
      <View style={styles.sound}>
        <Ionicons name="musical-notes" size={11} color="#fff" />
        <Text style={[styles.white, { fontSize: 9.5, fontWeight: '600' }]}>{t('onboarding.mockSound')}</Text>
      </View>
      <View style={styles.rec}>
        <View style={styles.recDot} />
      </View>
    </>
  );
}

function Live() {
  const { t } = useTranslation();
  return (
    <>
      <Backdrop
        base={['#2a0f1d', '#120a16']}
        washes={[
          { cx: 0.75, cy: 0.1, rx: 1.1, ry: 0.7, color: '#f43f5e', stop: 0.55 },
          { cx: 0.15, cy: 0.9, rx: 1, ry: 0.8, color: '#5b9bf5', stop: 0.6 },
        ]}
      />
      <View style={styles.liveBar}>
        <Text style={styles.livePill}>{t('onboarding.mockLive')}</Text>
        <Text style={styles.viewers}>1.2K</Text>
      </View>
      <View style={styles.hearts}>
        <Text style={{ fontSize: 18 }}>❤️</Text>
        <Text style={{ fontSize: 15, marginTop: -6 }}>💙</Text>
        <Text style={{ fontSize: 20, marginTop: -6 }}>❤️</Text>
      </View>
      <View style={styles.liveMsgs}>
        <View style={styles.bub}>
          <Avatar letter="ع" size={18} tone={2} />
          <Text style={[styles.white, { fontSize: 9.5 }]}>{t('onboarding.mockMsg1')}</Text>
        </View>
        <View style={styles.bub}>
          <Avatar letter="س" size={18} tone={1} />
          <Text style={[styles.white, { fontSize: 9.5 }]}>{t('onboarding.mockMsg2')}</Text>
        </View>
      </View>
    </>
  );
}

function Chat() {
  const { t } = useTranslation();
  return (
    <>
      <Backdrop
        base={['#16161f', '#10101a']}
        washes={[{ cx: 0.8, cy: 0.05, rx: 1, ry: 0.6, color: '#1e56d6', stop: 0.5 }]}
      />
      <View style={styles.chat}>
        <View style={[styles.row6, { alignItems: 'flex-end' }]}>
          <Avatar letter="ن" size={20} tone={3} />
          <Text style={[styles.msg, { borderBottomStartRadius: 5 }]}>{t('onboarding.mockChat1')}</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <Text style={[styles.msg, { backgroundColor: '#1e56d6', borderBottomEndRadius: 5 }]}>
            {t('onboarding.mockChat2')}
          </Text>
        </View>
        <View style={styles.mapCard}>
          <View style={styles.map}>
            <Backdrop base="#1b2a22" washes={[{ cx: 0.68, cy: 0.26, rx: 0.6, ry: 0.6, color: '#1e56d6', opacity: 0.3, stop: 0.55 }]} />
            <View style={[styles.road, { top: '44%', left: '-10%', right: '-10%', height: 5, transform: [{ rotate: '-7deg' }] }]} />
            <View style={[styles.road, { top: '-10%', bottom: '-10%', start: '58%', width: 5, transform: [{ rotate: '9deg' }] }]} />
            <View style={{ position: 'absolute', top: 24, start: 34 }}>
              <Avatar letter="س" size={22} tone={1} ring />
            </View>
            <View style={{ position: 'absolute', top: 64, end: 40 }}>
              <Avatar letter="ع" size={22} tone={2} ring />
            </View>
          </View>
          <Text style={[styles.white, { fontSize: 9.5, fontWeight: '600', padding: 8 }]}>{t('onboarding.mockMap')}</Text>
        </View>
      </View>
    </>
  );
}

const ARTS: Record<ArtKind, () => React.JSX.Element> = { watch: Watch, create: Create, live: Live, chat: Chat };

export function PhoneArt({ kind, scale = 1, style }: { kind: ArtKind; scale?: number; style?: ViewStyle }) {
  const Art = ARTS[kind];
  return (
    <View style={[{ width: 210 * scale, height: 380 * scale, alignSelf: 'center' }, style]}>
      <View style={[styles.phone, { transform: [{ scale }], transformOrigin: 'top left' }]}>
        <Art />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  phone: {
    width: 210,
    height: 380,
    borderRadius: 30,
    overflow: 'hidden',
    backgroundColor: '#101014',
    borderWidth: 5,
    borderColor: '#1c1c22',
    shadowColor: '#141428',
    shadowOpacity: 0.22,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 24 },
    elevation: 12,
  },
  white: { color: '#fff' },
  row6: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  avLetter: { color: '#fff', fontSize: 9, fontWeight: '700' },
  ring: { borderWidth: 2, borderColor: '#fff', borderRadius: 99 },
  tabs: { position: 'absolute', top: 13, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 12 },
  tab: { color: '#fff', fontSize: 11, fontWeight: '700' },
  tabOn: { borderBottomWidth: 2, borderBottomColor: '#fff', paddingBottom: 2 },
  rail: { position: 'absolute', end: 9, bottom: 56, gap: 14, alignItems: 'center' },
  railN: { color: '#fff', fontSize: 8.5, fontWeight: '700', marginTop: 2 },
  caption: { position: 'absolute', bottom: 14, start: 11, end: 46 },
  swipe: { position: 'absolute', bottom: 6, alignSelf: 'center', left: '50%', marginLeft: -17, width: 34, height: 3, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  grid: { position: 'absolute', top: 14, left: 14, right: 14, bottom: 14 },
  gridLine: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.07)' },
  camTop: { position: 'absolute', top: 13, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  chip: { color: '#fff', fontSize: 9, fontWeight: '700', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.42)', overflow: 'hidden' },
  chipOn: { backgroundColor: '#fff', color: '#111' },
  timer: { position: 'absolute', top: 44, alignSelf: 'center', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 6, backgroundColor: '#ff2d55' },
  sound: { position: 'absolute', bottom: 88, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.5)' },
  rec: { position: 'absolute', bottom: 18, alignSelf: 'center', width: 54, height: 54, borderRadius: 27, borderWidth: 4, borderColor: 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center' },
  recDot: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#ff2d55' },
  liveBar: { position: 'absolute', top: 13, start: 11, flexDirection: 'row', gap: 6, alignItems: 'center' },
  livePill: { color: '#fff', backgroundColor: '#ff2d55', fontSize: 9, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  viewers: { color: '#fff', backgroundColor: 'rgba(0,0,0,0.42)', fontSize: 9, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  hearts: { position: 'absolute', end: 14, bottom: 74, alignItems: 'center' },
  liveMsgs: { position: 'absolute', bottom: 16, start: 11, gap: 5 },
  bub: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.42)', borderRadius: 999, paddingVertical: 3, paddingStart: 4, paddingEnd: 10, alignSelf: 'flex-start' },
  chat: { position: 'absolute', top: 24, bottom: 24, left: 13, right: 13, gap: 9 },
  msg: { color: '#fff', fontSize: 10, lineHeight: 14, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 15, backgroundColor: '#2b2b35', overflow: 'hidden' },
  mapCard: { marginTop: 6, borderRadius: 15, overflow: 'hidden', backgroundColor: '#24242c' },
  map: { height: 124, overflow: 'hidden' },
  road: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.13)' },
});
