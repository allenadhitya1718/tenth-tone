import Foundation
import Capacitor
import AVFoundation

/**
 * Earpiece / loudspeaker / Bluetooth routing for calls, iOS side.
 *
 * The web layer cannot do this on either platform: routing belongs to the OS.
 * This is the counterpart to AudioRoutePlugin.java on Android, and the JS name
 * ("AudioRoute") is shared so one call site in agora.js works on both.
 *
 * Three things have to be true at once or the audio does not move:
 *
 *  1. The category must be .playAndRecord. The receiver (earpiece) is not a
 *     legitimate destination under any other category, so the override is
 *     rejected with kAudioSessionUnsupportedPropertyError.
 *  2. .defaultToSpeaker must NOT be set. With it, overrideOutputAudioPort(.none)
 *     returns to "the default", and the default is then the loudspeaker - which
 *     makes the earpiece unreachable no matter what else is right.
 *  3. overrideOutputAudioPort has to be called. Setting the category alone
 *     changes nothing; the override is the part that moves the audio.
 *
 * The fourth thing, and the reason a toggle that worked once stopped working:
 * WKWebView sets the audio session category itself whenever a media element
 * starts or stops, and that silently drops our override. The call is running
 * through the Agora *Web* SDK inside the WebView, so this happens constantly.
 * routeChangeNotification is how we notice and put it back.
 *
 * Route changes are ASYNCHRONOUS. currentRoute read immediately after the
 * override still describes the old route, so a plugin that answers straight
 * away tells the button a lie. Every method here waits for the route to settle
 * before it reports, and emits `audioRouteChanged` for anything the system does
 * on its own.
 */
@objc(AudioRoutePlugin)
public class AudioRoutePlugin: CAPPlugin {

    /// How long to let a route change settle before reading it back. Apple
    /// gives no figure; an override is tens of milliseconds, Bluetooth is
    /// slower and is covered by the routeChange event instead.
    private static let settleSeconds = 0.25

    /// Never reassert more often than this. The session and the WebView can
    /// both push back, and a handler that answers every notification with
    /// another change can ping-pong; this bounds it to twice a second.
    private static let reassertGapSeconds = 0.5

    private let session = AVAudioSession.sharedInstance()

    /// True once a call has put the session into its telephony shape. Nothing
    /// here touches the session until then - outside a call this plugin must
    /// be completely inert, or it would take the video feed's audio with it.
    private var configured = false

    /// What the app last asked for, including automatic changes: "speaker",
    /// "earpiece", "bluetooth", "auto".
    private var appliedRoute = "speaker"

    /// The last choice a PERSON made, kept separately. When their AirPods die
    /// mid-call we go back to this, not to whatever we switched to when the
    /// AirPods arrived.
    private var userRoute = "speaker"

    private var observing = false
    private var lastReassert = Date.distantPast

    override public func load() {
        startObserving()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: - JS API

    /**
     * Legacy call site: setSpeaker({ on: true|false }).
     *
     * Pass respectExternal: true for the automatic call at the start of a call.
     * Forcing the loudspeaker the moment a call connects is right in the hand
     * and wrong with AirPods in - it steals the audio back off the headset the
     * person is already wearing, which reads as "Bluetooth does not work".
     * A deliberate tap by the user should NOT pass it: choosing the
     * loudspeaker while wearing a headset is a real thing people do.
     */
    @objc func setSpeaker(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? true
        let respectExternal = call.getBool("respectExternal") ?? false

        configureSession()

        var target = on ? "speaker" : "earpiece"
        if respectExternal && on {
            if bluetoothPort() != nil {
                target = "bluetooth"
            } else if wiredOutput() != nil {
                target = "auto"
            }
        }
        userRoute = target
        apply(target)
        settle(call, requested: on)
    }

    /**
     * setRoute({ route: "speaker" | "earpiece" | "bluetooth" | "auto" }).
     * "auto" hands the choice back to iOS, which picks a connected headset if
     * there is one.
     */
    @objc func setRoute(_ call: CAPPluginCall) {
        let wanted = normalise(call.getString("route"))
        configureSession()
        userRoute = wanted
        apply(wanted)
        settle(call, requested: wanted == "speaker")
    }

    /**
     * What is the audio actually coming out of right now, and what else is
     * available. Read-only: safe to call before a call starts, so the UI can
     * know a Bluetooth device is there before there is anything to route.
     */
    @objc func getRoute(_ call: CAPPluginCall) {
        call.resolve(routeInfo(requested: userRoute == "speaker"))
    }

    /** Hand the session back when the call ends. */
    @objc func reset(_ call: CAPPluginCall) {
        configured = false
        appliedRoute = "speaker"
        userRoute = "speaker"

        try? session.setPreferredInput(nil)
        try? session.overrideOutputAudioPort(AVAudioSession.PortOverride.none)
        // Leaving the session in .playAndRecord/.voiceChat makes every later
        // sound in the app behave as though a call were still running: quiet,
        // and aimed at the receiver. .playback is what WKWebView itself uses
        // for ordinary media, so this puts the device back where the video
        // feed expects to find it.
        try? session.setActive(false, options: [.notifyOthersOnDeactivation])
        try? session.setCategory(.playback, mode: .default, options: [])

        call.resolve()
    }

    // MARK: - Session

    private func configureSession() {
        // .allowBluetooth is the HFP (headset, two-way) option and is what a
        // call needs; .allowBluetoothA2DP covers listen-only devices. Newer
        // SDKs spell the first one .allowBluetoothHFP, but that name does not
        // exist on older Xcode, so the old spelling stays - it still compiles
        // and still works, with a deprecation warning at worst.
        let wanted: AVAudioSession.CategoryOptions = [.allowBluetooth, .allowBluetoothA2DP]

        // Note the absence of .defaultToSpeaker. With it, "not speaker" means
        // "speaker" and the earpiece can never be reached.
        let alreadyRight = session.category == .playAndRecord
            && session.mode == .voiceChat
            && session.categoryOptions.contains(.allowBluetooth)

        if !alreadyRight {
            do {
                try session.setCategory(.playAndRecord, mode: .voiceChat, options: wanted)
            } catch {
                // Losing echo cancellation beats losing the call.
                print("AudioRoute: .voiceChat refused (\(error.localizedDescription)), trying .default")
                do {
                    try session.setCategory(.playAndRecord, mode: .default, options: wanted)
                } catch {
                    print("AudioRoute: setCategory failed: \(error.localizedDescription)")
                }
            }
        }

        // Activating is idempotent and can legitimately fail while another app
        // holds the session; that is not a reason to skip the override below.
        do {
            try session.setActive(true, options: [])
        } catch {
            print("AudioRoute: setActive failed: \(error.localizedDescription)")
        }

        configured = true
    }

    /// Move the audio. Both halves matter: the output override decides speaker
    /// vs receiver, and the preferred INPUT is what pulls the route on or off a
    /// Bluetooth headset - clearing the override alone will not leave one.
    private func apply(_ target: String) {
        appliedRoute = target
        switch target {
        case "speaker":
            preferBuiltInMic()
            setOverride(.speaker)
        case "earpiece":
            preferBuiltInMic()
            setOverride(AVAudioSession.PortOverride.none)
        case "bluetooth":
            preferBluetoothInput()
            setOverride(AVAudioSession.PortOverride.none)
        default: // "auto"
            try? session.setPreferredInput(nil)
            setOverride(AVAudioSession.PortOverride.none)
        }
    }

    private func setOverride(_ port: AVAudioSession.PortOverride) {
        do {
            try session.overrideOutputAudioPort(port)
        } catch {
            print("AudioRoute: override failed: \(error.localizedDescription)")
        }
    }

    /// Forcing the input to the phone's own microphone is the documented way
    /// to route AWAY from a connected Bluetooth headset. Without it, "earpiece"
    /// with AirPods connected just stays on the AirPods.
    private func preferBuiltInMic() {
        let inputs = session.availableInputs ?? []
        if let builtIn = inputs.first(where: { $0.portType == .builtInMic }) {
            try? session.setPreferredInput(builtIn)
        } else {
            try? session.setPreferredInput(nil)
        }
    }

    private func preferBluetoothInput() {
        let inputs = session.availableInputs ?? []
        if let bt = inputs.first(where: { isBluetooth($0.portType) }) {
            try? session.setPreferredInput(bt)
        } else {
            // A listen-only A2DP device has no input port to prefer; clearing
            // the override and letting iOS choose is all there is.
            try? session.setPreferredInput(nil)
        }
    }

    // MARK: - Reading the route

    private func routeInfo(requested: Bool) -> [String: Any] {
        let outputs = session.currentRoute.outputs
        let types = outputs.map { $0.portType }
        let speakerOn = types.contains(.builtInSpeaker)
        let earpieceOn = types.contains(.builtInReceiver)

        let btOut = outputs.first(where: { isBluetooth($0.portType) })
        let wired = outputs.first(where: { isWired($0.portType) })
        let inputs = session.availableInputs ?? []
        let btInput = inputs.first(where: { isBluetooth($0.portType) })
        let bt = btOut ?? btInput

        var route = "unknown"
        if btOut != nil {
            route = "bluetooth"
        } else if wired != nil {
            route = "wired"
        } else if speakerOn {
            route = "speaker"
        } else if earpieceOn {
            route = "earpiece"
        }

        var available = ["speaker", "earpiece"]
        if bt != nil { available.append("bluetooth") }
        if wired != nil { available.append("wired") }

        return [
            // speakerOn is the only field the existing agora.js reads, so it
            // keeps its old meaning exactly: is the built-in loudspeaker the
            // thing making the sound.
            "speakerOn": speakerOn,
            "requested": requested,
            "route": route,
            "routeName": outputs.first?.portName ?? "",
            "bluetoothConnected": bt != nil,
            "bluetoothName": bt?.portName ?? "",
            "wiredConnected": wired != nil,
            "external": (btOut != nil || wired != nil),
            "available": available,
            "outputs": outputs.map { ["type": $0.portType.rawValue, "name": $0.portName] }
        ]
    }

    private func settle(_ call: CAPPluginCall, requested: Bool) {
        let deadline = DispatchTime.now() + AudioRoutePlugin.settleSeconds
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: deadline) { [weak self] in
            guard let self = self else {
                call.resolve()
                return
            }
            call.resolve(self.routeInfo(requested: requested))
        }
    }

    private func normalise(_ raw: String?) -> String {
        switch (raw ?? "").lowercased() {
        case "speaker", "loudspeaker": return "speaker"
        case "earpiece", "receiver": return "earpiece"
        case "bluetooth", "bt", "headset": return "bluetooth"
        default: return "auto"
        }
    }

    private func isBluetooth(_ port: AVAudioSession.Port) -> Bool {
        return port == .bluetoothA2DP || port == .bluetoothHFP || port == .bluetoothLE
    }

    private func isWired(_ port: AVAudioSession.Port) -> Bool {
        return port == .headphones
            || port == .headsetMic
            || port == .usbAudio
            || port == .carAudio
            || port == .airPlay
            || port == .HDMI
            || port == .lineOut
    }

    private func bluetoothPort() -> AVAudioSessionPortDescription? {
        if let out = session.currentRoute.outputs.first(where: { isBluetooth($0.portType) }) {
            return out
        }
        let inputs = session.availableInputs ?? []
        return inputs.first(where: { isBluetooth($0.portType) })
    }

    private func wiredOutput() -> AVAudioSessionPortDescription? {
        return session.currentRoute.outputs.first(where: { isWired($0.portType) })
    }

    // MARK: - What the system does behind our back

    private func startObserving() {
        guard !observing else { return }
        observing = true
        let centre = NotificationCenter.default
        centre.addObserver(self,
                           selector: #selector(handleRouteChange(_:)),
                           name: AVAudioSession.routeChangeNotification,
                           object: nil)
        centre.addObserver(self,
                           selector: #selector(handleMediaServicesReset(_:)),
                           name: AVAudioSession.mediaServicesWereResetNotification,
                           object: nil)
        centre.addObserver(self,
                           selector: #selector(handleInterruption(_:)),
                           name: AVAudioSession.interruptionNotification,
                           object: nil)
    }

    @objc private func handleRouteChange(_ note: Notification) {
        guard configured else { return }

        let raw = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) ?? 0
        let reason = AVAudioSession.RouteChangeReason(rawValue: raw) ?? .unknown

        switch reason {
        case .newDeviceAvailable:
            // AirPods went in mid-call. A headset that has just been connected
            // wins over both the earpiece and the loudspeaker - that is what
            // every other phone app does.
            if bluetoothPort() != nil {
                apply("bluetooth")
            } else if wiredOutput() != nil {
                apply("auto")
            }
        case .oldDeviceUnavailable:
            // They came out, or the battery died. iOS falls back to the
            // receiver, which is a call that has gone silent in someone's hand
            // if they were on the loudspeaker. Go back to their own last
            // choice rather than to ours.
            if bluetoothPort() == nil && wiredOutput() == nil {
                apply(userRoute == "bluetooth" ? "speaker" : userRoute)
            }
        default:
            // .categoryChange lands here, and that is usually WKWebView
            // reconfiguring the session out from under us when a media element
            // starts or stops.
            reassertIfDrifted()
        }

        emitRoute()
    }

    @objc private func handleMediaServicesReset(_ note: Notification) {
        // Apple: the session is gone and every bit of state must be rebuilt.
        guard configured else { return }
        configured = false
        configureSession()
        apply(appliedRoute)
        emitRoute()
    }

    @objc private func handleInterruption(_ note: Notification) {
        guard configured else { return }
        let raw = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) ?? 0
        guard let type = AVAudioSession.InterruptionType(rawValue: raw), type == .ended else { return }
        configureSession()
        apply(appliedRoute)
        emitRoute()
    }

    /// Put the route back if something moved it and we did not ask. Compares
    /// before it acts, so re-applying cannot chase its own notification
    /// forever, and refuses to run twice in quick succession as a backstop.
    private func reassertIfDrifted() {
        let wantsSpeaker = (appliedRoute == "speaker")
        if wantsSpeaker == session.currentRoute.outputs.contains(where: { $0.portType == .builtInSpeaker }) {
            return
        }
        guard Date().timeIntervalSince(lastReassert) > AudioRoutePlugin.reassertGapSeconds else { return }
        lastReassert = Date()
        configureSession()
        apply(appliedRoute)
    }

    private func emitRoute() {
        notifyListeners("audioRouteChanged", data: routeInfo(requested: userRoute == "speaker"))
    }
}
