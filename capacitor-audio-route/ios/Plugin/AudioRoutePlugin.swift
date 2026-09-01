import Foundation
import Capacitor
import AVFoundation

/**
 * Earpiece / loudspeaker routing for calls, iOS side.
 *
 * The web layer cannot do this on either platform: routing belongs to the OS.
 * The call screen used to fake the difference by halving the remote track's
 * volume while the button read "earpiece", so both settings came out of the
 * loudspeaker. This is the counterpart to AudioRoutePlugin.java on Android.
 *
 * The category matters as much as the override. .playAndRecord with mode
 * .voiceChat is what puts the session into a telephony configuration where the
 * receiver (earpiece) is a legitimate destination at all; setting the override
 * without it does not reliably move the audio.
 */
@objc(AudioRoutePlugin)
public class AudioRoutePlugin: CAPPlugin {

    private var configured = false

    @objc func setSpeaker(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? true
        let session = AVAudioSession.sharedInstance()
        do {
            if !configured {
                // .allowBluetooth so a paired headset keeps working; the OS
                // then owns the decision and may refuse our override, which is
                // why the result is read back rather than assumed.
                try session.setCategory(.playAndRecord,
                                        mode: .voiceChat,
                                        options: [.allowBluetooth, .allowBluetoothA2DP])
                try session.setActive(true, options: [])
                configured = true
            }
            try session.overrideOutputAudioPort(on ? .speaker : .none)

            // Report what actually happened. A connected headset or CarPlay
            // can override us, and the button must show the truth.
            let routedToSpeaker = session.currentRoute.outputs.contains {
                $0.portType == .builtInSpeaker
            }
            call.resolve([
                "speakerOn": routedToSpeaker,
                "requested": on
            ])
        } catch {
            call.reject("could not change audio route: \(error.localizedDescription)")
        }
    }

    /** Hand the session back when the call ends. */
    @objc func reset(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.overrideOutputAudioPort(.none)
            // Leaving the session active and in .voiceChat makes every later
            // sound in the app behave as though a call were still running -
            // quieter, and routed to the receiver.
            try session.setActive(false, options: [.notifyOthersOnDeactivation])
        } catch {
            // Never fail a hang-up over tidying up.
        }
        configured = false
        call.resolve()
    }
}
