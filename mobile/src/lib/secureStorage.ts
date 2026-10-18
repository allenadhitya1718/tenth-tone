import AsyncStorage from '@react-native-async-storage/async-storage';
import * as aesjs from 'aes-js';
import * as Crypto from 'expo-crypto';

// Supabase's session (access + refresh token) must not sit in AsyncStorage,
// which is plain text on disk. The Keychain/Keystore (expo-secure-store) is
// encrypted but caps values at ~2 KB, and a session is larger. So, as in
// Supabase's own Expo guide: the session is AES-encrypted into AsyncStorage
// and only the 256-bit key lives in secure storage.

type SecureStoreModule = typeof import('expo-secure-store');

// Loaded lazily so a development build made before the module was added
// still starts (falling back to plain AsyncStorage) instead of crashing.
let secure: SecureStoreModule | null | undefined;
function secureStore(): SecureStoreModule | null {
  if (secure === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      secure = require('expo-secure-store') as SecureStoreModule;
    } catch {
      secure = null;
    }
  }
  return secure;
}

const hex = aesjs.utils.hex;
const utf8 = aesjs.utils.utf8;

async function encrypt(key: string, value: string, store: SecureStoreModule) {
  const keyBytes = Crypto.getRandomBytes(32);
  const cipher = new aesjs.ModeOfOperation.ctr(keyBytes, new aesjs.Counter(1));
  const encrypted = cipher.encrypt(utf8.toBytes(value));
  await store.setItemAsync(key, hex.fromBytes(keyBytes));
  return hex.fromBytes(encrypted);
}

async function decrypt(key: string, value: string, store: SecureStoreModule) {
  const keyHex = await store.getItemAsync(key);
  if (!keyHex) return null;
  const cipher = new aesjs.ModeOfOperation.ctr(hex.toBytes(keyHex), new aesjs.Counter(1));
  return utf8.fromBytes(cipher.decrypt(hex.toBytes(value)));
}

export const largeSecureStorage = {
  async getItem(key: string) {
    const stored = await AsyncStorage.getItem(key);
    if (!stored) return null;
    const store = secureStore();
    if (!store) return stored;
    try {
      return await decrypt(key, stored, store);
    } catch {
      // A session written before encryption existed is plain JSON; reading it
      // as ciphertext fails. Treat it as signed out rather than crash.
      return null;
    }
  },
  async setItem(key: string, value: string) {
    const store = secureStore();
    await AsyncStorage.setItem(key, store ? await encrypt(key, value, store) : value);
  },
  async removeItem(key: string) {
    await AsyncStorage.removeItem(key);
    await secureStore()?.deleteItemAsync(key).catch(() => {});
  },
};
