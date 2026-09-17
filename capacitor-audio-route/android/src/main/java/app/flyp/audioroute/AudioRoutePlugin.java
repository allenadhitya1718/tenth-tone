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

/**
 * Earpiece / loudspeaker routing for calls. Same four methods and the same
 * result shape as the iOS plugin, so the single call site in agora.js works
 * on both platforms.
 *
 * Why native at all: a WebView plays call audio as "media", which Android
 * always sends to the loudspeaker. The receiver (earpiece) is only a
 * destination in MODE_IN_COMMUNICATION - the mode the phone's own dialler
 * uses - and only the OS can put the app there. Being in that mode is also
 * what turns on the platform's echo cancellation for the call, which a
 * media-mode WebView never gets.
 */
@CapacitorPlugin(name = "AudioRoute")
public class AudioRoutePlugin extends Plugin {

    private AudioManager audio() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    private boolean speakerOn() {
        AudioManager am = audio();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AudioDeviceInfo d = am.getCommunicationDevice();
            return d != null && d.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER;
        }
        return am.isSpeakerphoneOn();
    }

    private JSObject routeInfo() {
        boolean on = speakerOn();
        JSObject r = new JSObject();
        r.put("speakerOn", on);
        r.put("route", on ? "speaker" : "earpiece");
        return r;
    }

    /** Puts the app in call mode and points output at the speaker or the earpiece. */
    private void apply(boolean speaker) {
        AudioManager am = audio();
        if (am.getMode() != AudioManager.MODE_IN_COMMUNICATION) {
            am.setMode(AudioManager.MODE_IN_COMMUNICATION);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            int want = speaker ? AudioDeviceInfo.TYPE_BUILTIN_SPEAKER : AudioDeviceInfo.TYPE_BUILTIN_EARPIECE;
            AudioDeviceInfo pick = null;
            for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
                if (d.getType() == want) { pick = d; break; }
            }
            if (pick != null) {
                am.setCommunicationDevice(pick);
                return;
            }
            // A tablet has no earpiece: fall through and use the legacy switch,
            // which at least honours "speaker on/off".
        }
        am.setSpeakerphoneOn(speaker);
    }

    @PluginMethod
    public void setSpeaker(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        apply(on);
        JSObject info = routeInfo();
        notifyListeners("audioRouteChanged", info);
        call.resolve(info);
    }

    @PluginMethod
    public void setRoute(PluginCall call) {
        String route = call.getString("route", "speaker");
        apply(!"earpiece".equals(route));
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
        am.setSpeakerphoneOn(false);
        am.setMode(AudioManager.MODE_NORMAL);
        call.resolve();
    }
}
