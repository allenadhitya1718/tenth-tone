import AsyncStorage from '@react-native-async-storage/async-storage';

// Same key as the web app: the tour shows once, then the app opens on the
// new-or-returning fork.
const KEY = 'tt-onboarded';

export async function hasOnboarded() {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return false;
  }
}

export async function markOnboarded() {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {}
}
