import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { recordSession } from '@/api/settings';
import { useAuth } from '@/providers/AuthProvider';

import { SESSION_ID_KEY } from './accountAuth';

// Records this phone in Login activity once per sign-in, and remembers the
// row id so the screen can mark it "This device".
export function useRecordSession() {
  const { session } = useAuth();
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    const name = Device.modelName ?? Device.deviceName ?? Platform.OS;
    recordSession(`${name} · ${Platform.OS}`, 'mobile')
      .then((id) => {
        if (id) void AsyncStorage.setItem(SESSION_ID_KEY, id);
      })
      .catch(() => {});
  }, [userId]);
}
