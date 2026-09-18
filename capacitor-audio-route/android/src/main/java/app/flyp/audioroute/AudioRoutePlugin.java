package app.flyp.audioroute;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * Earpiece / loudspeaker / Bluetooth routing for calls. Same four methods
 * and the same result shape as the iOS plugin, so the single call site in
 * agora.js works on both platforms.
 *
 * Why native at all: a WebView plays call audio as "media", which Android
 * always sends to the loudspeaker. The receiver (earpiece) and a Bluetooth
 * headset are only destinations in MODE_IN_COMMUNICATION - the mode the
 * phone's own dialler uses - and only the OS can put the app there.
 *
 * The mode is set ONCE, before the call's audio exists (agora.js applies the
 * route before opening the microphone). Mid-call, only the output device
 * changes; re-entering the mode under running WebRTC audio is what makes a
 * call go silent in both directions.
 */
@CapacitorPlugin(name = "AudioRoute")
public class AudioRoutePlugin extends Plugin {

    private boolean scoStarted = false;

    private AudioManager audio() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    private static boolean isBluetooth(AudioDeviceInfo d) {
        int t = d.getType();
        if (t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) return true;
        return Build.VERSION.SDK_INT >= 31 && t == AudioDeviceInfo.TYPE_BLE_HEADSET;
    }

    /** Is a Bluetooth output there to route to right now? */
    private boolean hasBluetooth() {
        AudioManager am = audio();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) if (isBluetooth(d)) return true;
            return false;
        }
        for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) if (isBluetooth(d)) return true;
        return false;
    }

    private String currentRoute() {
        AudioManager am = audio();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AudioDeviceInfo d = am.getCommunicationDevice();
            if (d != null) {
                if (isBluetooth(d)) return "bluetooth";
                if (d.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) return "speaker";
                if (d.getType() == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) return "earpiece";
                return "other";
            }
        }
        if (am.isBluetoothScoOn()) return "bluetooth";
        return am.isSpeakerphoneOn() ? "speaker" : "earpiece";
    }

    private JSObject routeInfo() {
        String route = currentRoute();
        JSObject r = new JSObject();
        r.put("route", route);
        r.put("speakerOn", "speaker".equals(route));
        r.put("hasBluetooth", hasBluetooth());
        return r;
    }

    private AudioDeviceInfo findCommDevice(String route) {
        AudioManager am = audio();
        List<AudioDeviceInfo> list = am.getAvailableCommunicationDevices();
        for (AudioDeviceInfo d : list) {
            if ("bluetooth".equals(route) && isBluetooth(d)) return d;
            if ("speaker".equals(route) && d.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) return d;
            if ("earpiece".equals(route) && d.getType() == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) return d;
        }
        return null;
    }

    /** Call mode once; then point the output where asked. */
    private void apply(String route) {
        AudioManager am = audio();
        if (am.getMode() != AudioManager.MODE_IN_COMMUNICATION) {
            am.setMode(AudioManager.MODE_IN_COMMUNICATION);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AudioDeviceInfo pick = findCommDevice(route);
            if (pick == null && "bluetooth".equals(route)) pick = findCommDevice("speaker");
            if (pick != null) { am.setCommunicationDevice(pick); return; }
            // A tablet has no earpiece: fall through to the legacy switch.
        }
        if ("bluetooth".equals(route) && hasBluetooth()) {
            am.setSpeakerphoneOn(false);
            if (!scoStarted) { am.startBluetoothSco(); scoStarted = true; }
            am.setBluetoothScoOn(true);
            return;
        }
        if (scoStarted) { am.setBluetoothScoOn(false); am.stopBluetoothSco(); scoStarted = false; }
        am.setSpeakerphoneOn("speaker".equals(route));
    }

    @PluginMethod
    public void setSpeaker(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        apply(on ? "speaker" : "earpiece");
        JSObject info = routeInfo();
        notifyListeners("audioRouteChanged", info);
        call.resolve(info);
    }

    @PluginMethod
    public void setRoute(PluginCall call) {
        String route = call.getString("route", "speaker");
        if (!"speaker".equals(route) && !"earpiece".equals(route) && !"bluetooth".equals(route)) route = "speaker";
        apply(route);
        JSObject info = routeInfo();
        notifyListeners("audioRouteChanged", info);
        call.resolve(info);
    }

    @PluginMethod
    public void getRoute(PluginCall call) {
        call.resolve(routeInfo());
    }

    /** Back to normal media playback once the call ends. */
    @PluginMethod
    public void reset(PluginCall call) {
        AudioManager am = audio();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            am.clearCommunicationDevice();
        }
        if (scoStarted) { am.setBluetoothScoOn(false); am.stopBluetoothSco(); scoStarted = false; }
        am.setSpeakerphoneOn(false);
        am.setMode(AudioManager.MODE_NORMAL);
        call.resolve();
    }
}
