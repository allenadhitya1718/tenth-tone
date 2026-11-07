import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { isImageUrl } from '@/features/discover/nav';

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

/** The best picture a highlight has: its cover, else the host's photo. */
export function highlightCoverUri(cover: string | null | undefined, hostAvatar: string | null | undefined): string | null {
  if (isImageUrl(cover)) return cover;
  if (isImageUrl(hostAvatar)) return hostAvatar;
  return null;
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', justifyContent: 'center', gap: 10, overflow: 'hidden' },
  logo: { width: '62%', aspectRatio: 472 / 230 },
  logoSmall: { width: '70%', aspectRatio: 472 / 230 },
  name: { color: 'rgba(255,255,255,0.85)', fontWeight: '700', fontSize: 15, maxWidth: '80%' },
});
