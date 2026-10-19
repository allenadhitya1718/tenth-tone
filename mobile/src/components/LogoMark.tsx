import { Image } from 'react-native';

// The FLYP wordmark with its navy ground removed, so it sits directly on the
// page instead of as a rectangle. `dark` = glowing mark for dark pages
// (assets/flyp-logo-mark.png); `light` = brand-blue waveform with ink letters
// for light pages (assets/flyp-logo-mark-light.png).
export function LogoMark({ width = 180, tone = 'dark' }: { width?: number; tone?: 'dark' | 'light' }) {
  return (
    <Image
      source={tone === 'dark' ? require('../../assets/flyp-logo-mark.png') : require('../../assets/flyp-logo-mark-light.png')}
      style={{ width, height: width * (230 / 472) }}
      resizeMode="contain"
      accessibilityLabel="FLYP"
    />
  );
}
