import Foundation
import Capacitor
import AgoraRtcKit

/**
 * Voice calls on iPhone, run by Apple's audio instead of the WebView's.
 *
 * Why this exists. Everything else in FLYP's calls is the Agora *Web* SDK
 * inside WKWebView, and that works - except for one thing, which took six
 * builds to prove. Moving the output to the receiver (the earpiece) kills the
 * outgoing audio. The phone's own numbers, one build at a time:
 *
 *   1.4.17  sendLevel 142    sendBitrate 0     capture alive, encoder dead
 *   1.4.18  sendLevel 15480  sendBitrate 0     capture alive, encoder dead
 *   1.4.19  sendLevel 0      sendBitrate 0     capture dead as well
 *
 * Receiving was fine every time: "I can hear him, he cannot hear me". The
 * cause is not the routing call - it is that WKWebView owns the audio session
 * and rebuilds it whenever a media element starts or stops, and WebRTC's
 * encoder inside it does not survive the rebuild. Nothing in JavaScript can
 * reach that. The seventh check settled it for good: `call_sink_probe` on
 * iOS 18.3 reported no setSinkId, no selectAudioOutput and an EMPTY
 * audiooutput device list, so WebKit's own sanctioned way to choose the
 * receiver does not exist on that phone either. There is no web-side fix.
 *
 * So for a VOICE call on iOS the audio leaves the WebView entirely and runs
 * on Agora's native SDK, which manages AVAudioSession itself - the way every
 * phone app does. setEnableSpeakerphone(false) then reaches the earpiece
 * because the SDK rebuilds its own audio unit around the change coherently,
 * which is exactly what the plugin fighting WKWebView could never do.
 *
 * Deliberately audio-only (the AgoraAudio_iOS pod, not the video one). Video
 * calls stay entirely on the web SDK - nobody holds a video call to their ear,
 * and the audio-only pod is a fraction of the size.
 *
 * This plugin must NEVER run at the same time as the web SDK's call, and
 * AudioRoutePlugin must not touch the session while it is joined: two owners
 * of one audio session is the bug this replaces. agora.js enforces both -
 * the native path does not call routeAudio()/applyRoute() at all.
 *
 * Nothing here is reachable unless JS asks for it, and JS only asks on iOS
 * for a voice call. If any step fails the caller falls back to the web SDK,
 * so the worst case is the behaviour that shipped in 1.4.20.
 */
@objc(AgoraCallPlugin)
public class AgoraCallPlugin: CAPPlugin {

    private var engine: AgoraRtcEngineKit?

    /// Held from joinChannel() until the SDK confirms through
    /// didJoinChannel, or the timeout below gives up. `joinChannel` returns
    /// the instant it is queued and says nothing about whether the channel
    /// was actually reached, so resolving on its return value would tell the
    /// call screen "connected" while the phone was still negotiating.
    private var pendingJoin: CAPPluginCall?
    private var joined = false

    /// Everyone else in the channel right now. The call screen draws its
    /// "connected" state from this, so it is kept as a set rather than a
    /// count - didJoinedOfUid can legitimately repeat.
    private var remotes = Set<UInt>()

    /// Last reported by the SDK, for stats(). Kept rather than queried,
    /// because Agora reports them on a timer and there is no getter.
    private var txAudioKbps = 0
    private var rxAudioKbps = 0
    private var localVolume = 0
    private var remoteVolume = 0
    private var micMuted = false
    private var speakerOn = true

    /// Apple gives no figure for how long a join may take; 15 s is longer
    /// than any successful join observed on this app (the slowest measured
    /// web join was 4.9 s) and short enough that a dead network still falls
    /// back to the web SDK while the person is watching the ring.
    private static let joinTimeout: TimeInterval = 15.0

    // MARK: - Can this phone do it at all

    /// JS asks before committing to the native path. A build without the pod
    /// would not have this class at all, so reaching here is the answer.
    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": true])
    }

    // MARK: - Join

    /**
     * join({ appId, channel, token, uid, speaker })
     *
     * Resolves { joined: true, uid } only once the SDK is really in the
     * channel. The uid MUST be the one the token was signed for: a token is
     * bound to a uid and Agora rejects any mismatch - the same rule the web
     * path already follows.
     */
    @objc func join(_ call: CAPPluginCall) {
        guard let appId = call.getString("appId"), !appId.isEmpty else {
            call.reject("no appId"); return
        }
        guard let channel = call.getString("channel"), !channel.isEmpty else {
            call.reject("no channel"); return
        }
        let token = call.getString("token")
        let uid = UInt(call.getInt("uid") ?? 0)
        let wantSpeaker = call.getBool("speaker") ?? true

        // A second join with the first still up would leave two engines on one
        // audio session - the exact failure this plugin exists to end.
        teardownEngine()

        let config = AgoraRtcEngineConfig()
        config.appId = appId
        // .communication, not .liveBroadcasting: it is the profile meant for
        // two-way calls, and it matches the web side, which creates its client
        // with mode 'rtc'. Both halves of one channel must agree.
        config.channelProfile = .communication

        let kit = AgoraRtcEngineKit.sharedEngine(with: config, delegate: self)
        engine = kit

        // Audio only. Without this the SDK still prepares a video pipeline,
        // which costs start-up time and can light the camera indicator on a
        // call that has no camera in it.
        kit.disableVideo()
        kit.enableAudio()
        // Matches the web side's encoderConfig 'speech_standard', so a call
        // between an iPhone on this path and an Android on the web path is not
        // two different-sounding halves.
        kit.setAudioProfile(.speechStandard)
        // Speakerphone is where a call starts, as on the web path. This is the
        // DEFAULT route, set before joining; the live switch is
        // setEnableSpeakerphone below, which is the one the earpiece needs.
        kit.setDefaultAudioRouteToSpeakerphone(wantSpeaker)
        // Every 300 ms, so stats() can report whether this microphone is
        // actually capturing - the measurement that diagnosed six failed
        // builds. reportVad false: speech detection is not needed, only level.
        kit.enableAudioVolumeIndication(300, smooth: 3, reportVad: false)

        speakerOn = wantSpeaker
        micMuted = false
        remotes.removeAll()
        pendingJoin = call
        call.keepAlive = true

        let options = AgoraRtcChannelMediaOptions()
        options.publishMicrophoneTrack = true
        options.publishCameraTrack = false
        options.autoSubscribeAudio = true
        options.autoSubscribeVideo = false
        options.clientRoleType = .broadcaster

        let rc = kit.joinChannel(byToken: token, channelId: channel, uid: uid, mediaOptions: options)
        if rc != 0 {
            // Refused before it even started - a malformed channel name, a
            // token for a different channel. Fail now so JS falls back to the
            // web SDK rather than waiting out the timeout in silence.
            finishJoin(error: "joinChannel returned \(rc)")
            return
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + AgoraCallPlugin.joinTimeout) { [weak self] in
            guard let self = self, self.pendingJoin != nil, !self.joined else { return }
            self.finishJoin(error: "join timed out")
        }
    }

    /// Resolve or reject the held join exactly once, and tear the engine down
    /// on failure - a half-joined engine still holds the audio session, and
    /// the web SDK is about to want it.
    private func finishJoin(uid: UInt? = nil, error: String? = nil) {
        guard let call = pendingJoin else { return }
        pendingJoin = nil
        call.keepAlive = false
        if let error = error {
            teardownEngine()
            call.reject(error)
        } else {
            joined = true
            call.resolve(["joined": true, "uid": Int(uid ?? 0)])
        }
    }

    // MARK: - While the call is up

    @objc func setMuted(_ call: CAPPluginCall) {
        let muted = call.getBool("muted") ?? false
        engine?.muteLocalAudioStream(muted)
        micMuted = muted
        call.resolve(["muted": micMuted])
    }

    /**
     * The button this whole plugin was written for.
     *
     * setEnableSpeakerphone(false) is the earpiece. It works here and not in
     * the WebView because the SDK owns the audio session: it moves the route
     * and rebuilds its own capture and encoder around the move, instead of
     * having the route yanked out from under a pipeline that cannot cope.
     *
     * iOS refuses to leave a connected headset or Bluetooth device for the
     * loudspeaker, so the answer is read back rather than assumed.
     */
    @objc func setSpeaker(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? true
        guard let kit = engine else { call.reject("not in a call"); return }
        kit.setEnableSpeakerphone(on)
        speakerOn = kit.isSpeakerphoneEnabled()
        call.resolve(["speakerOn": speakerOn])
    }

    /**
     * What the audio is doing right now, in the same shape agora.js already
     * reports for the web path, so one call screen reads both.
     *
     * sendBitrate is the number that matters: it was 0 in every failed
     * earpiece build while sendLevel was loud, which is what proved the
     * capture was alive and the encoder dead.
     */
    @objc func stats(_ call: CAPPluginCall) {
        call.resolve([
            "sendBitrate": txAudioKbps * 1000,
            "recvBitrate": rxAudioKbps * 1000,
            "sendLevel": localVolume,
            "recvLevel": remoteVolume,
            "remotes": remotes.count,
            "micMuted": micMuted,
            "speakerOn": speakerOn,
            "native": true,
        ])
    }

    // MARK: - Leaving

    @objc func leave(_ call: CAPPluginCall) {
        teardownEngine()
        call.resolve()
    }

    /**
     * Everything down, and the audio session handed back.
     *
     * destroy() is what releases AVAudioSession. Without it the phone stays in
     * call mode after a hang-up - every later sound quiet and aimed at the
     * receiver - which is the same fault AudioRoutePlugin.reset() exists to
     * avoid on the web path. Safe to call twice, and called on every exit:
     * a failed join, a normal hang-up, a second join arriving.
     */
    private func teardownEngine() {
        if let call = pendingJoin {
            pendingJoin = nil
            call.keepAlive = false
            call.reject("superseded")
        }
        joined = false
        remotes.removeAll()
        txAudioKbps = 0
        rxAudioKbps = 0
        localVolume = 0
        remoteVolume = 0
        if engine != nil {
            engine?.leaveChannel(nil)
            engine = nil
            AgoraRtcEngineKit.destroy()
        }
    }

    private func emitRemotes() {
        notifyListeners("remoteChanged", data: ["remotes": remotes.count])
    }
}

// MARK: - What the SDK tells us

extension AgoraCallPlugin: AgoraRtcEngineDelegate {

    public func rtcEngine(_ engine: AgoraRtcEngineKit, didJoinChannel channel: String, withUid uid: UInt, elapsed: Int) {
        finishJoin(uid: uid)
    }

    public func rtcEngine(_ engine: AgoraRtcEngineKit, didJoinedOfUid uid: UInt, elapsed: Int) {
        remotes.insert(uid)
        emitRemotes()
    }

    public func rtcEngine(_ engine: AgoraRtcEngineKit, didOfflineOfUid uid: UInt, reason: AgoraUserOfflineReason) {
        remotes.remove(uid)
        emitRemotes()
    }

    /// Reported on a timer while the call runs. txAudioKBitrate is the
    /// outgoing audio - the one that was zero every time the earpiece broke.
    public func rtcEngine(_ engine: AgoraRtcEngineKit, reportRtcStats stats: AgoraChannelStats) {
        txAudioKbps = stats.txAudioKBitrate
        rxAudioKbps = stats.rxAudioKBitrate
    }

    /// uid 0 is this phone's own microphone; everything else is somebody
    /// else's. Both are kept so stats() can say "capturing but not sending",
    /// which is the distinction that took six builds to see.
    public func rtcEngine(_ engine: AgoraRtcEngineKit, reportAudioVolumeIndicationOfSpeakers speakers: [AgoraRtcAudioVolumeInfo], totalVolume: Int) {
        var remoteMax = 0
        for s in speakers {
            if s.uid == 0 {
                localVolume = Int(s.volume)
            } else {
                remoteMax = max(remoteMax, Int(s.volume))
            }
        }
        if !speakers.isEmpty { remoteVolume = remoteMax }
    }

    /// A token expiring mid-call, a channel that cannot be reached. Reported
    /// to JS rather than swallowed: the call screen can say something true,
    /// and the code goes into client_logs where it can be read afterwards -
    /// this plugin cannot be debugged from a Windows machine any other way.
    public func rtcEngine(_ engine: AgoraRtcEngineKit, didOccurError errorCode: AgoraErrorCode) {
        notifyListeners("callError", data: ["code": errorCode.rawValue])
        if pendingJoin != nil {
            finishJoin(error: "agora error \(errorCode.rawValue)")
        }
    }
}
