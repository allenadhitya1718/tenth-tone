package com.flyp.app;

import android.content.Context;
import android.media.AudioManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Earpiece / loudspeaker routing for calls.
 *
 * The web layer cannot do this. Audio routing belongs to the OS, and a WebView
 * has no API for it - so the call screen's speaker button was faking the
 * difference by dropping the remote track's volume to 40% while its label
 * promised "سماعة الأذن" (earpiece). Both settings came out of the loudspeaker,
 * which is what testers reported.
 *
 * MODIFY_AUDIO_SETTINGS was already declared in the manifest, so nothing new is
 * being asked of the user.
 *
 * MODE_IN_COMMUNICATION is the part that makes setSpeakerphoneOn(false)
 * actually reach the earpiece. In MODE_NORMAL Android routes media to the
 * loudspeaker regardless, which is the other half of why this never worked.
 */
@CapacitorPlugin(name = "AudioRoute")
public class AudioRoutePlugin extends Plugin {

    private Integer previousMode = null;

    @PluginMethod
    public void setSpeaker(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        AudioManager am = manager();
        if (am == null) {
            call.reject("audio manager unavailable");
            return;
        }
        try {
            if (previousMode == null) previousMode = am.getMode();
            am.setMode(AudioManager.MODE_IN_COMMUNICATION);
            am.setSpeakerphoneOn(on);

            // Report what the OS actually did rather than what we asked for.
            // Some devices refuse the switch while a headset or Bluetooth
            // device is connected, and the caller deserves to know so the
            // button can show the truth.
            JSObject ret = new JSObject();
            ret.put("speakerOn", am.isSpeakerphoneOn());
            ret.put("requested", on);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("could not change audio route: " + e.getMessage());
        }
    }

    /** Put the device back as we found it when the call ends. */
    @PluginMethod
    public void reset(PluginCall call) {
        AudioManager am = manager();
        if (am != null) {
            try {
                am.setSpeakerphoneOn(false);
                am.setMode(previousMode != null ? previousMode : AudioManager.MODE_NORMAL);
            } catch (Exception ignored) {
                // Leaving the device in communication mode is bad, but throwing
                // here would leave the call screen unable to close.
            }
        }
        previousMode = null;
        call.resolve();
    }

    private AudioManager manager() {
        Context ctx = getContext();
        return ctx == null ? null : (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
    }
}
