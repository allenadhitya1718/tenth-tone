import * as Updates from 'expo-updates';
import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

// Test builds only (the "preview" update channel, or a development build):
// proves the crash protection works on a real phone.
//   flyp://debug-crash?kind=render   throws while rendering  -> recovery screen
//   flyp://debug-crash?kind=handler  throws from a timer     -> toast, app stays open
// In a store build (channel "production") this screen does nothing.
const enabled = __DEV__ || Updates.channel === 'preview';

function Boom(): never {
  throw new Error('debug-crash: render error (test)');
}

export default function DebugCrash() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();

  useEffect(() => {
    if (!enabled || kind !== 'handler') return;
    const timer = setTimeout(() => {
      throw new Error('debug-crash: handler error (test)');
    }, 300);
    return () => clearTimeout(timer);
  }, [kind]);

  if (!enabled) return null;
  if (kind === 'render') return <Boom />;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000421' }}>
      <Text style={{ color: '#fff' }}>debug-crash: {kind ?? 'none'}</Text>
    </View>
  );
}
