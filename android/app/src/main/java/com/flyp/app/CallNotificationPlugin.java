package com.flyp.app;

import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The call's notification, driven from the web layer that owns the call.
 *
 *   CallNotification.start({ name, text })  - a call has connected
 *   CallNotification.stop()                 - it is over
 *   addListener('hangup', ...)              - they hung up from the shade
 *
 * Nothing here decides anything about the call. The service exists to keep
 * the process alive while the person is in another app and to give them a way
 * back; the call itself lives in JavaScript, and Hang up is handed straight
 * there so the session is wound down by the same code that would have ended
 * it on screen. Two paths to the same ending is how a call ends up half-dead:
 * a row that says accepted and a microphone still publishing.
 */
@CapacitorPlugin(name = "CallNotification")
public class CallNotificationPlugin extends Plugin {

    // The service has no handle on the bridge, and the plugin instance is not
    // static. This is how the two meet. Held as the LAST loaded instance,
    // which is the live one: a plugin is created once per WebView.
    private static CallNotificationPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    /** Called from the service when Hang up is tapped in the shade. */
    static void fireHangup() {
        CallNotificationPlugin p = instance;
        if (p == null) return;
        try { p.notifyListeners("hangup", new JSObject()); } catch (Exception ignored) {}
    }

    @PluginMethod
    public void start(PluginCall call) {
        String name = call.getString("name", "");
        String text = call.getString("text", "");
        Intent i = new Intent(getContext(), CallForegroundService.class)
                .setAction(CallForegroundService.ACTION_START)
                .putExtra(CallForegroundService.EXTRA_NAME, name == null ? "" : name)
                .putExtra(CallForegroundService.EXTRA_TEXT, text == null ? "" : text);
        try {
            // From Android 8 a background start would be refused; this is only
            // ever called with the call screen open, so the app is in the
            // foreground and the O+ path is the correct one.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getContext().startForegroundService(i);
            else getContext().startService(i);
            call.resolve();
        } catch (Exception e) {
            // A call that cannot post a notification is still a call. Report
            // the failure rather than throwing it at the person mid-dial.
            JSObject r = new JSObject();
            r.put("started", false);
            r.put("reason", String.valueOf(e.getMessage()));
            call.resolve(r);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            getContext().startService(new Intent(getContext(), CallForegroundService.class)
                    .setAction(CallForegroundService.ACTION_STOP));
        } catch (Exception ignored) {
            // Already gone, or the process is being torn down anyway.
        }
        call.resolve();
    }
}
