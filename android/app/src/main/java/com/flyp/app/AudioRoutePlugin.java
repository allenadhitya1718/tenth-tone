package com.flyp.app;

import android.annotation.TargetApi;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Earpiece / loudspeaker / Bluetooth routing for calls.
 *
 * The web layer cannot do this. Audio routing belongs to the OS, and a WebView
 * has no API for it - so the call screen's speaker button was faking the
 * difference by dropping the remote track's volume to 40% while its label
 * promised "سماعة الأذن" (earpiece). Both settings came out of the loudspeaker,
 * which is what testers reported.
 *
 * MODIFY_AUDIO_SETTINGS was already declared in the manifest, so nothing new is
 * being asked of the user, and nothing here needs BLUETOOTH_CONNECT: choosing a
 * communication device is not the same as talking to the Bluetooth stack. The
 * headset's NAME may come back empty without that permission, which is why the
 * UI must be able to fall back to a generic label.
 *
 * MODE_IN_COMMUNICATION is the part that makes setSpeakerphoneOn(false)
 * actually reach the earpiece. In MODE_NORMAL Android routes media to the
 * loudspeaker regardless.
 *
 * Bluetooth is the half that was missing entirely. A paired headset does NOT
 * receive call audio just because it is connected: the SCO link has to be
 * started, or - from Android 12 - the device has to be named explicitly with
 * setCommunicationDevice(). Both paths are here, the modern one first, because
 * startBluetoothSco() is deprecated and unreliable on newer OEM builds.
 */
@CapacitorPlugin(name = "AudioRoute")
public class AudioRoutePlugin extends Plugin {

    private static final String SPEAKER = "speaker";
    private static final String EARPIECE = "earpiece";
    private static final String BLUETOOTH = "bluetooth";
    private static final String WIRED = "wired";
    private static final String AUTO = "auto";
    private static final String UNKNOWN = "unknown";
    private static final String EVENT = "audioRouteChanged";

    /** Let a route change land before reporting it. SCO in particular is slow. */
    private static final long SETTLE_MS = 250;

    private Integer previousMode = null;

    /** True only between the first setSpeaker of a call and reset(). */
    private boolean configured = false;

    /** What is applied right now, including changes we made automatically. */
    private String appliedRoute = SPEAKER;

    /** The last choice a PERSON made. When their headset disconnects we go back
     *  to this, not to whatever we switched to when it arrived. */
    private String userRoute = SPEAKER;

    private BroadcastReceiver scoReceiver = null;

    /** Typed as Object so an API 22 device never has to resolve
     *  AudioDeviceCallback, which does not exist there. */
    private Object deviceCallback = null;

    @Override
    public void load() {
        registerScoReceiver();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            registerDeviceCallback();
        }
    }

    // ── JS API ──────────────────────────────────────────────────────────────

    /**
     * setSpeaker({ on: true|false, respectExternal?: boolean })
     *
     * respectExternal is for the automatic call at the start of a call. Forcing
     * the loudspeaker the moment a call connects is right in the hand and wrong
     * with a headset already on someone's ears - it takes the audio back off
     * the device they are wearing, which reads as "Bluetooth does not work".
     * A deliberate tap must NOT pass it: choosing the loudspeaker while wearing
     * a headset is a real thing people do.
     */
    @PluginMethod
    public void setSpeaker(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        boolean respectExternal = Boolean.TRUE.equals(call.getBoolean("respectExternal", false));

        AudioManager am = manager();
        if (am == null) {
            call.reject("audio manager unavailable");
            return;
        }
        try {
            configureSession(am);
            String target = on ? SPEAKER : EARPIECE;
            if (respectExternal && on) {
                if (bluetoothConnected()) {
                    target = BLUETOOTH;
                } else if (wiredConnected()) {
                    target = AUTO;
                }
            }
            userRoute = target;
            apply(target);
            settle(call, on);
        } catch (Exception e) {
            call.reject("could not change audio route: " + e.getMessage());
        }
    }

    /** setRoute({ route: "speaker" | "earpiece" | "bluetooth" | "auto" }) */
    @PluginMethod
    public void setRoute(PluginCall call) {
        AudioManager am = manager();
        if (am == null) {
            call.reject("audio manager unavailable");
            return;
        }
        try {
            String wanted = normalise(call.getString("route"));
            configureSession(am);
            userRoute = wanted;
            apply(wanted);
            settle(call, SPEAKER.equals(wanted));
        } catch (Exception e) {
            call.reject("could not change audio route: " + e.getMessage());
        }
    }

    /**
     * What the audio is actually coming out of, and what else is connected.
     * Read-only, so the call screen can ask before a call starts whether there
     * is a Bluetooth device to offer at all.
     */
    @PluginMethod
    public void getRoute(PluginCall call) {
        call.resolve(routeInfo(SPEAKER.equals(userRoute)));
    }

    /** Put the device back as we found it when the call ends. */
    @PluginMethod
    @TargetApi(Build.VERSION_CODES.S)
    public void reset(PluginCall call) {
        AudioManager am = manager();
        configured = false;
        appliedRoute = SPEAKER;
        userRoute = SPEAKER;

        if (am != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                try {
                    am.clearCommunicationDevice();
                } catch (Exception ignored) {
                    // Leaving a communication device set is bad, but throwing
                    // here would leave the call screen unable to close.
                }
            }
            try {
                am.setBluetoothScoOn(false);
                am.stopBluetoothSco();
            } catch (Exception ignored) {}
            try {
                am.setSpeakerphoneOn(false);
            } catch (Exception ignored) {}
            try {
                am.setMode(previousMode != null ? previousMode : AudioManager.MODE_NORMAL);
            } catch (Exception ignored) {}
        }
        previousMode = null;
        call.resolve();
    }

    // ── Applying a route ────────────────────────────────────────────────────

    private void configureSession(AudioManager am) {
        if (previousMode == null) previousMode = am.getMode();
        if (am.getMode() != AudioManager.MODE_IN_COMMUNICATION) {
            am.setMode(AudioManager.MODE_IN_COMMUNICATION);
        }
        configured = true;
    }

    private void apply(String target) {
        AudioManager am = manager();
        if (am == null) return;
        appliedRoute = target;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                applyModern(am, target);
            } else {
                applyLegacy(am, target);
            }
        } catch (Exception ignored) {
            // A refused route must not take the call down with it; routeInfo()
            // reports what really happened either way.
        }
    }

    /** Android 12+. setCommunicationDevice is the documented replacement for
     *  both setSpeakerphoneOn and startBluetoothSco, and is the only reliable
     *  way to reach a Bluetooth headset on recent OEM builds. */
    @TargetApi(Build.VERSION_CODES.S)
    private void applyModern(AudioManager am, String target) {
        List<AudioDeviceInfo> devices = am.getAvailableCommunicationDevices();
        AudioDeviceInfo pick = null;

        if (BLUETOOTH.equals(target)) {
            pick = firstOfType(devices,
                    AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
                    AudioDeviceInfo.TYPE_BLE_HEADSET,
                    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP);
        } else if (SPEAKER.equals(target)) {
            pick = firstOfType(devices, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER);
        } else if (EARPIECE.equals(target)) {
            pick = firstOfType(devices, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE);
        }

        if (pick == null) {
            // AUTO, or the device we wanted has gone. Handing the choice back
            // to the platform is what puts a connected headset in charge.
            am.clearCommunicationDevice();
            return;
        }
        if (!am.setCommunicationDevice(pick)) {
            applyLegacy(am, target);
        }
    }

    /** Android 11 and older. */
    private void applyLegacy(AudioManager am, String target) {
        String t = target;
        if (AUTO.equals(t)) t = bluetoothConnected() ? BLUETOOTH : EARPIECE;

        if (BLUETOOTH.equals(t)) {
            am.setSpeakerphoneOn(false);
            try {
                // Asynchronous: the SCO link is not up until the broadcast
                // arrives, which is what scoReceiver is for.
                am.startBluetoothSco();
                am.setBluetoothScoOn(true);
            } catch (Exception ignored) {}
            return;
        }
        try {
            am.setBluetoothScoOn(false);
            am.stopBluetoothSco();
        } catch (Exception ignored) {}
        // With wired headphones plugged in, "speakerphone off" reaches the
        // headphones rather than the earpiece, which is what a person expects.
        am.setSpeakerphoneOn(SPEAKER.equals(t));
    }

    @TargetApi(Build.VERSION_CODES.M)
    private AudioDeviceInfo firstOfType(List<AudioDeviceInfo> devices, int... types) {
        if (devices == null) return null;
        for (int want : types) {
            for (AudioDeviceInfo d : devices) {
                if (d.getType() == want) return d;
            }
        }
        return null;
    }

    // ── Reading the route ───────────────────────────────────────────────────

    private JSObject routeInfo(boolean requested) {
        AudioManager am = manager();
        boolean bt = bluetoothConnected();
        boolean wired = wiredConnected();
        String route = UNKNOWN;

        if (am != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) route = modernRoute(am);
            if (UNKNOWN.equals(route)) route = legacyRoute(am, bt, wired);
        }

        List<String> available = new ArrayList<>();
        available.add(SPEAKER);
        available.add(EARPIECE);
        if (bt) available.add(BLUETOOTH);
        if (wired) available.add(WIRED);

        String btName = bt ? bluetoothName() : "";

        JSObject ret = new JSObject();
        // speakerOn keeps exactly its old meaning - is the built-in
        // loudspeaker the thing making the sound - because that is the one
        // field the existing agora.js reads.
        ret.put("speakerOn", SPEAKER.equals(route));
        ret.put("requested", requested);
        ret.put("route", route);
        ret.put("routeName", BLUETOOTH.equals(route) ? btName : "");
        ret.put("bluetoothConnected", bt);
        ret.put("bluetoothName", btName);
        ret.put("wiredConnected", wired);
        ret.put("external", BLUETOOTH.equals(route) || WIRED.equals(route));
        ret.put("available", new JSArray(available));
        return ret;
    }

    /** Android 12+ can be asked directly what is carrying the call. */
    @TargetApi(Build.VERSION_CODES.S)
    private String modernRoute(AudioManager am) {
        try {
            AudioDeviceInfo d = am.getCommunicationDevice();
            if (d == null) return UNKNOWN;
            switch (d.getType()) {
                case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER:
                    return SPEAKER;
                case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE:
                    return EARPIECE;
                case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
                case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:
                case AudioDeviceInfo.TYPE_BLE_HEADSET:
                    return BLUETOOTH;
                case AudioDeviceInfo.TYPE_WIRED_HEADSET:
                case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
                case AudioDeviceInfo.TYPE_USB_HEADSET:
                    return WIRED;
                default:
                    return UNKNOWN;
            }
        } catch (Exception e) {
            return UNKNOWN;
        }
    }

    private String legacyRoute(AudioManager am, boolean bt, boolean wired) {
        boolean scoOn = false;
        boolean speakerOn = false;
        try {
            scoOn = am.isBluetoothScoOn();
        } catch (Exception ignored) {}
        try {
            speakerOn = am.isSpeakerphoneOn();
        } catch (Exception ignored) {}

        if (bt && scoOn) return BLUETOOTH;
        if (speakerOn) return SPEAKER;
        if (wired) return WIRED;
        return EARPIECE;
    }

    @TargetApi(Build.VERSION_CODES.M)
    private boolean bluetoothConnected() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false;
        AudioManager am = manager();
        if (am == null) return false;
        try {
            for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                if (isBluetoothType(d.getType())) return true;
            }
        } catch (Exception ignored) {}
        return false;
    }

    /** May be empty without BLUETOOTH_CONNECT, so the UI needs a fallback label. */
    @TargetApi(Build.VERSION_CODES.M)
    private String bluetoothName() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return "";
        AudioManager am = manager();
        if (am == null) return "";
        try {
            for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                if (isBluetoothType(d.getType())) {
                    CharSequence name = d.getProductName();
                    return name == null ? "" : name.toString();
                }
            }
        } catch (Exception ignored) {}
        return "";
    }

    @TargetApi(Build.VERSION_CODES.M)
    private boolean wiredConnected() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false;
        AudioManager am = manager();
        if (am == null) return false;
        try {
            for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                int t = d.getType();
                if (t == AudioDeviceInfo.TYPE_WIRED_HEADSET || t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES) {
                    return true;
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && t == AudioDeviceInfo.TYPE_USB_HEADSET) {
                    return true;
                }
            }
        } catch (Exception ignored) {}
        return false;
    }

    @TargetApi(Build.VERSION_CODES.M)
    private boolean isBluetoothType(int type) {
        if (type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) {
            return true;
        }
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && type == AudioDeviceInfo.TYPE_BLE_HEADSET;
    }

    // ── What the system does behind our back ────────────────────────────────

    private void registerScoReceiver() {
        final Context ctx = getContext();
        if (ctx == null || scoReceiver != null) return;

        scoReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                int state = intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE,
                        AudioManager.SCO_AUDIO_STATE_ERROR);
                AudioManager am = manager();
                if (am != null
                        && state == AudioManager.SCO_AUDIO_STATE_CONNECTED
                        && BLUETOOTH.equals(appliedRoute)) {
                    // The link only just came up; this is the point at which
                    // routing to it can succeed.
                    try {
                        am.setBluetoothScoOn(true);
                    } catch (Exception ignored) {}
                }
                emitRoute();
            }
        };

        IntentFilter filter = new IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ctx.registerReceiver(scoReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                ctx.registerReceiver(scoReceiver, filter);
            }
        } catch (Exception e) {
            scoReceiver = null;
        }
    }

    /** API 23+. The counterpart to iOS's routeChangeNotification: headphones
     *  going in or coming out mid-call. */
    @TargetApi(Build.VERSION_CODES.M)
    private void registerDeviceCallback() {
        AudioManager am = manager();
        if (am == null || deviceCallback != null) return;
        AudioDeviceCallback cb = new AudioDeviceCallback() {
            @Override
            public void onAudioDevicesAdded(AudioDeviceInfo[] added) {
                onDevicesChanged(true);
            }

            @Override
            public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
                onDevicesChanged(false);
            }
        };
        try {
            am.registerAudioDeviceCallback(cb, new Handler(Looper.getMainLooper()));
            deviceCallback = cb;
        } catch (Exception ignored) {}
    }

    private void onDevicesChanged(boolean added) {
        if (!configured) return;
        if (added) {
            // A headset that has just been connected wins over both the
            // earpiece and the loudspeaker - that is what every other phone
            // app does. userRoute is deliberately left alone.
            if (bluetoothConnected()) {
                apply(BLUETOOTH);
            } else if (wiredConnected()) {
                apply(AUTO);
            }
        } else if (!bluetoothConnected() && !wiredConnected() && !SPEAKER.equals(appliedRoute)) {
            // It came out, or the battery died. Fall back to the person's own
            // last choice rather than leaving the call somewhere silent.
            apply(BLUETOOTH.equals(userRoute) || AUTO.equals(userRoute) ? SPEAKER : userRoute);
        }
        emitRoute();
    }

    @Override
    @TargetApi(Build.VERSION_CODES.M)
    protected void handleOnDestroy() {
        Context ctx = getContext();
        if (scoReceiver != null && ctx != null) {
            try {
                ctx.unregisterReceiver(scoReceiver);
            } catch (Exception ignored) {}
        }
        scoReceiver = null;

        if (deviceCallback != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            AudioManager am = manager();
            if (am != null) {
                try {
                    am.unregisterAudioDeviceCallback((AudioDeviceCallback) deviceCallback);
                } catch (Exception ignored) {}
            }
        }
        deviceCallback = null;
        super.handleOnDestroy();
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private void settle(final PluginCall call, final boolean requested) {
        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override
            public void run() {
                call.resolve(routeInfo(requested));
            }
        }, SETTLE_MS);
    }

    private void emitRoute() {
        try {
            notifyListeners(EVENT, routeInfo(SPEAKER.equals(userRoute)));
        } catch (Exception ignored) {}
    }

    private String normalise(String raw) {
        if (raw == null) return AUTO;
        String s = raw.toLowerCase(Locale.ROOT);
        if (SPEAKER.equals(s) || "loudspeaker".equals(s)) return SPEAKER;
        if (EARPIECE.equals(s) || "receiver".equals(s)) return EARPIECE;
        if (BLUETOOTH.equals(s) || "bt".equals(s) || "headset".equals(s)) return BLUETOOTH;
        return AUTO;
    }

    private AudioManager manager() {
        Context ctx = getContext();
        return ctx == null ? null : (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
    }
}
