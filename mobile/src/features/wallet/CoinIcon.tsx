import { LinearGradient } from 'expo-linear-gradient';
import { View } from 'react-native';

// Coins are drawn gold, the same in both themes.
const GOLD = ['#FFE08A', '#F5B12E'] as const;

// A drawn coin instead of the 🪙 emoji, which renders differently on every
// phone and reads as a placeholder.
export function CoinIcon({ size = 20 }: { size?: number }) {
  return (
    <LinearGradient
      colors={GOLD}
      start={{ x: 0.2, y: 0 }}
      end={{ x: 0.8, y: 1 }}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}
    >
      <View
        style={{
          width: size * 0.62,
          height: size * 0.62,
          borderRadius: size,
          borderWidth: Math.max(1, size * 0.07),
          borderColor: 'rgba(255,255,255,0.65)',
          backgroundColor: 'rgba(196,120,10,0.35)',
        }}
      />
    </LinearGradient>
  );
}
