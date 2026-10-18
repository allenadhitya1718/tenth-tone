import { Image } from 'react-native';

// The wide FLYP wordmark (web/icons/flyp-logo-wide.png). Its navy ground is
// baked into the PNG, so it is rounded to sit as a badge rather than a
// sticker, as on the web login screen.
export function Logo({ width = 165 }: { width?: number }) {
  return (
    <Image
      source={require('../../assets/flyp-logo-wide.png')}
      style={{ width, height: width * (230 / 472), borderRadius: 12 }}
      resizeMode="contain"
      accessibilityLabel="FLYP"
    />
  );
}
