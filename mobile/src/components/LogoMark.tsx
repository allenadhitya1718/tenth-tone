import { Image } from 'react-native';

// The FLYP wordmark with its navy ground removed (assets/flyp-logo-mark.png),
// so it glows directly on the dark entry screens instead of sitting on them
// as a rectangle. Only for dark backgrounds; light screens keep <Logo />.
export function LogoMark({ width = 180 }: { width?: number }) {
  return (
    <Image
      source={require('../../assets/flyp-logo-mark.png')}
      style={{ width, height: width * (230 / 472) }}
      resizeMode="contain"
      accessibilityLabel="FLYP"
    />
  );
}
