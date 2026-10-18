import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { signInWithApple } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/providers/ThemeProvider';

// Native Sign in with Apple, the path App Review checks (guideline 4.8).
// Apple hands over the name only on the very first authorization, so it is
// written to the profile metadata straight away.
// forceLight: on the always-light pre-login screens the black button is right
// whatever the app theme.
export function AppleButton({ onError, forceLight }: { onError: (e: unknown) => void; forceLight?: boolean }) {
  const { isDark: themeDark } = useTheme();
  const isDark = themeDark && !forceLight;
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync().then(setAvailable).catch(() => {});
  }, []);

  if (!available) return null;

  async function press() {
    try {
      const raw = Crypto.randomUUID();
      const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashed,
      });
      if (!cred.identityToken) throw new Error('No identity token');
      await signInWithApple(cred.identityToken, raw);
      const name = [cred.fullName?.givenName, cred.fullName?.familyName].filter(Boolean).join(' ');
      if (name) await supabase.auth.updateUser({ data: { name } }).catch(() => {});
    } catch (e) {
      if ((e as { code?: string })?.code === 'ERR_REQUEST_CANCELED') return;
      onError(e);
    }
  }

  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
      buttonStyle={
        isDark
          ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
          : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
      }
      cornerRadius={26}
      style={{ height: 52, marginVertical: 6 }}
      onPress={press}
    />
  );
}
