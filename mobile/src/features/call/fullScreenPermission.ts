// Android 14+: "full-screen notifications" (USE_FULL_SCREEN_INTENT) is a
// special permission. Google Play grants it at install only to apps declared
// as calling / alarm apps in the Play Console; anywhere else the person has to
// switch it on in Settings. Without it the incoming call still rings as a
// heads-up notification with Accept / Decline - it just does not take over a
// locked or idle screen.
//
// So: ask once, explain why, offer the settings page, never nag.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TFunction } from 'i18next';
import { Alert, Linking, Platform } from 'react-native';
import notifee, { AndroidNotificationSetting } from 'react-native-notify-kit';

const ASKED_KEY = 'tt-fsi-asked';

export async function canUseFullScreenCalls(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const s = await notifee.getNotificationSettings();
    return s.android.fullScreenIntent !== AndroidNotificationSetting.DISABLED;
  } catch {
    return true;
  }
}

/** Opens the system page where full-screen notifications are allowed. */
export async function openFullScreenSettings(): Promise<void> {
  try {
    // Settings > Special app access > Full-screen notifications (Android 14).
    await Linking.sendIntent('android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT');
    return;
  } catch {}
  try {
    await notifee.openNotificationSettings();
  } catch {
    await Linking.openSettings().catch(() => {});
  }
}

/** Once per install, when the permission is off: say why and offer Settings. */
export async function maybeAskFullScreenCalls(t: TFunction): Promise<void> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 34) return;
  if (await canUseFullScreenCalls()) return;
  try {
    if (await AsyncStorage.getItem(ASKED_KEY)) return;
    await AsyncStorage.setItem(ASKED_KEY, String(Date.now()));
  } catch {
    return;
  }
  Alert.alert(t('notify.fsi.title'), t('notify.fsi.body'), [
    { text: t('notify.fsi.later'), style: 'cancel' },
    { text: t('notify.fsi.open'), onPress: () => void openFullScreenSettings() },
  ]);
}
