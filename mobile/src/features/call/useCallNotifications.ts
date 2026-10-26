import { useEffect } from 'react';
import { Platform } from 'react-native';
import notifee, { EventType } from 'react-native-notify-kit';

import { attachCallActions, handleNotificationEvent, type CallAction } from './background';
import { startCallKitBridge } from './callkit';
import { answerWhenReady } from './callSession';
import { openCallScreen } from './nav';
import { checkIncomingCallsNow } from './useIncomingCalls';

// The running app's half of the incoming-call notification (background.ts is
// the other): Accept opens /call/<id> and answers it, a tap opens it
// ringing, a missed-call tap opens the chat. Mounted by usePushRegistration
// while signed in; `openRoute` maps a send-push route onto a screen.
export function useCallNotifications(enabled: boolean, openRoute: (route: string) => void) {
  useEffect(() => {
    if (!enabled || (Platform.OS !== 'android' && Platform.OS !== 'ios')) return;

    const run = (a: CallAction) => {
      if (a.action === 'route') {
        openRoute(a.route);
        return;
      }
      if (a.action === 'accept') answerWhenReady(a.callId);
      openCallScreen(a.callId);
    };
    const detach = attachCallActions({ run, ring: () => checkIncomingCallsNow() });
    // iPhone: the native CallKit call screen (modules/flyp-callkit).
    const stopCallKit = startCallKitBridge();

    let unsubscribe = () => {};
    if (Platform.OS === 'android') {
      unsubscribe = notifee.onForegroundEvent((e) => void handleNotificationEvent(e));
      // Opened from a closed app by Accept / a tap: the event may only be
      // available here.
      notifee
        .getInitialNotification()
        .then((init) => {
          if (!init) return;
          void handleNotificationEvent({
            type: EventType.ACTION_PRESS,
            detail: { notification: init.notification, pressAction: init.pressAction },
          });
        })
        .catch(() => {});
    }
    return () => {
      detach();
      stopCallKit();
      unsubscribe();
    };
  }, [enabled, openRoute]);
}
