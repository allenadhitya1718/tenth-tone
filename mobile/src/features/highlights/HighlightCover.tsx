import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { isImageUrl } from '@/features/discover/nav';
import { useTheme } from '@/providers/ThemeProvider';

// A highlight's picture: its cover (the photo the host chose, else the
// live's cover, else the host's profile photo), or, when there is none, a
// branded card (the FLYP waveform on navy with the host's name), so a
// highlight is never just a play button. (Owner, 7 Nov 2026: "the highlight
// should have a cover image with the audio".)
//
// Fills its parent (absolute), like StyleSheet.absoluteFill.
export function HighlightCover({
  uri,
  hostName,
  recyclingKey,
  blurRadius,
  compact,
  style,
}: {
  uri: string | null | undefined;
  hostName: string;
  recyclingKey?: string;
  blurRadius?: number;
  // Small tiles (grids, the trim screen's thumbnail): no name, smaller logo.
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  // A photo just picked on the phone (file://) shows too, before upload.
  const src = typeof uri === 'string' && (uri.startsWith('file:') || isImageUrl(uri)) ? uri : null;
  if (src) {
    return (
      <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
        <Image source={{ uri: src }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={recyclingKey} blurRadius={blurRadius} />
      </View>
    );
  }
  return (
    <View style={[StyleSheet.absoluteFill, styles.brand, style]} pointerEvents="none">
      {/* Stops short of the app's navy (#000421), so the card's edge shows on a navy page. */}
      <LinearGradient colors={['#13246e', '#081245']} style={StyleSheet.absoluteFill} />
      {blurRadius ? null : (
        <>
          <Image
            source={require('../../../assets/flyp-logo-mark.png')}
            style={compact ? styles.logoSmall : styles.logo}
            contentFit="contain"
            accessibilityIgnoresInvertColors
          />
          {!compact && hostName ? (
            <Text style={styles.name} numberOfLines={1}>
              {hostName}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

/** The i18n key for "From X's live" or "X's voice clip" (0170 kinds). */
export function clipByKey(kind: 'live' | 'voice' | undefined): string {
  return kind === 'voice' ? 'voice.by' : 'live.highlight.by';
}

/** The best picture a highlight has: its cover, else the host's photo. */
export function highlightCoverUri(cover: string | null | undefined, hostAvatar: string | null | undefined): string | null {
  if (isImageUrl(cover)) return cover;
  if (isImageUrl(hostAvatar)) return hostAvatar;
  return null;
}

// ---------- cover layout (0173) ----------
// How the cover is shown on the highlight's page (owner, 14 Nov 2026): a
// square in the middle (the old look), a tall or a wide card, or the photo
// filling the whole page.
export type CoverFit = 'square' | 'tall' | 'wide' | 'full';
export const COVER_FITS: CoverFit[] = ['square', 'tall', 'wide', 'full'];

/** A row's cover_fit; anything unknown (or missing before 0173) is 'square'. */
export function coverFitOf(v: unknown): CoverFit {
  return COVER_FITS.includes(v as CoverFit) ? (v as CoverFit) : 'square';
}

/** Width / height of the cover for a layout (the editor's frame). */
export const COVER_ASPECT: Record<CoverFit, [number, number]> = { square: [1, 1], tall: [3, 4], wide: [16, 9], full: [9, 16] };

/** The size of the cover card in the middle of a page `pageW` wide (not
 *  used for 'full', which fills the page). */
export function coverArtSize(fit: CoverFit, pageW: number, pageH: number): { width: number; height: number } {
  if (fit === 'wide') {
    const width = Math.min(pageW - 32, 520);
    return { width, height: Math.round((width * 9) / 16) };
  }
  if (fit === 'tall') {
    const height = Math.min(Math.round(pageH * 0.5), Math.round(((pageW - 96) * 4) / 3));
    return { width: Math.round((height * 3) / 4), height };
  }
  const side = Math.min(240, pageW - 64);
  return { width: side, height: side };
}

const FIT_ICON: Record<CoverFit, keyof typeof Ionicons.glyphMap> = {
  square: 'square-outline',
  tall: 'phone-portrait-outline',
  wide: 'tablet-landscape-outline',
  full: 'expand-outline',
};

/** Four choices in a row, each an icon and a word, on the maker screens. */
export function CoverFitPicker({
  value,
  onChange,
  disabled,
}: {
  value: CoverFit;
  onChange: (f: CoverFit) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={styles.fitWrap}>
      <Text style={[styles.fitLabel, { color: colors.muted }]}>{t('live.highlight.fitLabel')}</Text>
      <View style={styles.fitRow} accessibilityRole="radiogroup">
        {COVER_FITS.map((f) => {
          const on = f === value;
          return (
            <Pressable
              key={f}
              onPress={() => onChange(f)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled }}
              style={[
                styles.fitBtn,
                { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary + '22' : colors.bg2 },
              ]}
            >
              <Ionicons name={FIT_ICON[f]} size={20} color={on ? colors.primary : colors.text} />
              <Text style={[styles.fitText, { color: on ? colors.primary : colors.text }]} numberOfLines={1}>
                {t(`live.highlight.fit_${f}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fitWrap: { gap: 6, marginTop: 10 },
  fitLabel: { fontSize: 13, fontWeight: '700' },
  fitRow: { flexDirection: 'row', gap: 8 },
  fitBtn: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 8, borderRadius: 12, borderWidth: 1.5 },
  fitText: { fontSize: 11.5, fontWeight: '700' },
  brand: { alignItems: 'center', justifyContent: 'center', gap: 10, overflow: 'hidden' },
  logo: { width: '62%', aspectRatio: 472 / 230 },
  logoSmall: { width: '70%', aspectRatio: 472 / 230 },
  name: { color: 'rgba(255,255,255,0.85)', fontWeight: '700', fontSize: 15, maxWidth: '80%' },
});
