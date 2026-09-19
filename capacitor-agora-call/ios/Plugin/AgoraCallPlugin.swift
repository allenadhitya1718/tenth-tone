import Foundation
import Capacitor
import AVFoundation
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

    /// Every field below is written from Agora's own delegate thread and read
    /// from Capacitor's bridge queue, which are different threads. Without a
    /// single owner that is a data race on a Set and an optional - an
    /// intermittent crash mid-call, most likely while the route sheet is open,
    /// because that is when stats() is read while people are joining. One
    /// serial queue owns them all; nothing touches them from outside it.
    ///
    /// Rule for this file: never `q.sync` from inside `q`.
    private let q = DispatchQueue(label: "app.flyp.agoracall.state")

    /// Creating and destroying the engine, in order, one at a time.
    ///
    /// AgoraRtcEngineKit is a SINGLETON: sharedEngine and destroy act on the
    /// same object for the whole process. The teardown has to wait for
    /// leaveChannel and must not run on a callback thread, so it is
    /// asynchronous - which means a redial can reach sharedEngine while the
    /// previous call's destroy is still pending, and that destroy then tears
    /// down the engine the NEW call is using. The join never completes, the
    /// 15 s timeout fires, and JS quietly falls back to the web SDK: the
    /// earpiece silently stops working again, for a reason nobody could see.
    ///
    /// So every create and every destroy goes through here, and a queued
    /// destroy is therefore always finished before the next create begins.
    private let engineQ = DispatchQueue(label: "app.flyp.agoracall.engine")

    /// Which join attempt is current. A timeout belongs to the attempt that
    /// armed it and to no other - without this, an abandoned attempt's timer
    /// fires 15 s later and aborts whatever join happens to be in flight.
    private var joinGeneration = 0

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

        // On engineQ, so any destroy still pending from the previous call has
        // already run. Blocking the bridge queue here is deliberate and brief:
        // in the ordinary case there is nothing queued and this is immediate.
        let kit: AgoraRtcEngineKit = engineQ.sync {
            let config = AgoraRtcEngineConfig()
            config.appId = appId
            // .communication, not .liveBroadcasting: it is the profile meant
            // for two-way calls, and it matches the web side, which creates
            // its client with mode 'rtc'. Both halves must agree.
            config.channelProfile = .communication
            let k = AgoraRtcEngineKit.sharedEngine(with: config, delegate: self)
            // Under the lock like everything else: sharedEngine has already
            // been handed `self` as its delegate, so callbacks can begin
            // arriving on Agora's thread from this line onwards.
            q.sync { engine = k }
            return k
        }

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

        var gen = 0
        q.sync {
            speakerOn = wantSpeaker
            micMuted = false
            remotes.removeAll()
            pendingJoin = call
            joinGeneration += 1
            gen = joinGeneration
        }
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
            guard let self = self else { return }
            var mine = false
            self.q.sync { mine = (self.joinGeneration == gen && self.pendingJoin != nil && !self.joined) }
            // Only the attempt that armed this timer may be aborted by it. A
            // join rejected early (an Agora error, a hang-up while ringing)
            // leaves this timer running; without the generation check it would
            // come back and kill an unrelated join placed moments later.
            if mine { self.finishJoin(error: "join timed out") }
        }
    }

    /// Resolve or reject the held join exactly once, and tear the engine down
    /// on failure - a half-joined engine still holds the audio session, and
    /// the web SDK is about to want it.
    private func finishJoin(uid: UInt? = nil, error: String? = nil) {
        // Claimed under the lock, so two threads racing here - the SDK
        // confirming a join while the timeout fires - cannot both settle it.
        var call: CAPPluginCall?
        q.sync {
            call = pendingJoin
            pendingJoin = nil
            if error == nil && call != nil { joined = true }
        }
        guard let call = call else { return }
        call.keepAlive = false
        if let error = error {
            // Settled BEFORE the teardown, never after. One caller is
            // didOccurError, running on the SDK's own thread; tearing down
            // first would block that thread inside destroy() and this
            // rejection would never be sent - leaving the JS promise pending
            // for ever, so the call screen never falls back to the web SDK
            // and simply sits there.
            call.reject(error)
            teardownEngine()
        } else {
            call.resolve(["joined": true, "uid": Int(uid ?? 0)])
        }
    }

    // MARK: - While the call is up

    @objc func setMuted(_ call: CAPPluginCall) {
        let muted = call.getBool("muted") ?? false
        var kit: AgoraRtcEngineKit?
        q.sync { kit = engine }
        // No engine means nothing was muted. Resolving anyway would have the
        // call screen paint a muted microphone that is still recording, or an
        // open one the person believes is off - the worse of the two.
        guard let kit = kit else { call.reject("not in a call"); return }
        kit.muteLocalAudioStream(muted)
        q.sync { micMuted = muted }
        call.resolve(["muted": muted])
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
        var kit: AgoraRtcEngineKit?
        q.sync { kit = engine }
        guard let kit = kit else { call.reject("not in a call"); return }
        kit.setEnableSpeakerphone(on)
        let actual = kit.isSpeakerphoneEnabled()
        q.sync { speakerOn = actual }
        call.resolve(["speakerOn": actual])
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
        var out: [String: Any] = [:]
        q.sync {
            out = [
                "sendBitrate": txAudioKbps * 1000,
                "recvBitrate": rxAudioKbps * 1000,
                "sendLevel": localVolume,
                "recvLevel": remoteVolume,
                "remotes": remotes.count,
                "micMuted": micMuted,
                "speakerOn": speakerOn,
                "native": true,
            ]
        }
        call.resolve(out)
    }

    // MARK: - Leaving

    @objc func leave(_ call: CAPPluginCall) {
        // Resolve FIRST. The teardown below takes a real fraction of a second
        // inside Agora, and Capacitor runs plugin calls on one shared queue -
        // blocking it here would stall push, haptics, the keyboard and the
        // status bar behind a hang-up, which reads as the whole app freezing
        // at exactly the moment the call screen is closing.
        call.resolve()
        teardownEngine()
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
        var pending: CAPPluginCall?
        var kit: AgoraRtcEngineKit?
        q.sync {
            pending = pendingJoin
            pendingJoin = nil
            joined = false
            remotes.removeAll()
            txAudioKbps = 0
            rxAudioKbps = 0
            localVolume = 0
            remoteVolume = 0
            kit = engine
            engine = nil          // cleared up front, so a re-entrant join
        }                         // never finds the engine being destroyed
        if let pending = pending {
            pending.keepAlive = false
            pending.reject("superseded")
        }
        guard let kit = kit else { return }

        // ── Why this is not just leaveChannel + destroy ──
        //
        // Two separate hazards, and the obvious spelling hits both.
        //
        // destroy() blocks until every outstanding SDK callback has returned,
        // so calling it FROM a callback deadlocks - and one caller here is
        // didOccurError, which IS a callback. It therefore runs on a plain
        // background thread that belongs to nobody.
        //
        // leaveChannel is asynchronous. Destroying immediately after it
        // interrupts the departure before it reaches Agora's servers, so the
        // other phone goes on seeing a participant who has hung up until the
        // server times the ghost out - tens of seconds of a call screen
        // showing somebody who left. So: wait for the leave to complete,
        // off the callback thread, and only then destroy. The 2 s ceiling is
        // there because a dead network must not leak a thread; the audio
        // session still has to come back either way.
        engineQ.async {
            let done = DispatchSemaphore(value: 0)
            kit.leaveChannel { _ in done.signal() }
            _ = done.wait(timeout: .now() + 2.0)
            AgoraRtcEngineKit.destroy()
            AgoraCallPlugin.handBackAudioSession()
        }
    }

    /**
     * Give iOS its audio session back after a call.
     *
     * Destroying the engine releases Agora's hold, but it does NOT put the
     * session back the way the rest of the app expects to find it: the
     * category stays .playAndRecord in a voice-chat mode, configured for a
     * call that is over. The measured consequence was that VOICE NOTES
     * stopped recording on the iPhone - five attempts in a row logged
     * `vn_stop {via:"pcm", bytes:0, chunks:0}` after holding the button for
     * five seconds. The microphone opened and WebKit's AudioContext reported
     * itself running; it simply received no samples, because the session
     * underneath it still belonged to a finished call. The same four
     * recordings on v1.4.17, before this plugin existed, all produced audio.
     *
     * This is the same restoration AudioRoutePlugin.reset() performs for the
     * web call path, for the same reason. .playback is what WKWebView uses
     * for ordinary media, and deactivating with notifyOthersOnDeactivation
     * lets anything the call interrupted resume - and lets WebKit build a
     * fresh capture from scratch the next time it wants the microphone.
     *
     * Every step is `try?`: a failure here must never take down a hang-up,
     * and the app is in a worse state with a half-restored session than with
     * an unreported error.
     */
    private static func handBackAudioSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setPreferredInput(nil)
        try? session.overrideOutputAudioPort(AVAudioSession.PortOverride.none)
        try? session.setActive(false, options: [.notifyOthersOnDeactivation])
        try? session.setCategory(.playback, mode: .default, options: [])
    }

    private func emitRemotes(_ n: Int) {
        notifyListeners("remoteChanged", data: ["remotes": n])
    }
}

// MARK: - What the SDK tells us

extension AgoraCallPlugin: AgoraRtcEngineDelegate {

    public func rtcEngine(_ engine: AgoraRtcEngineKit, didJoinChannel channel: String, withUid uid: UInt, elapsed: Int) {
        finishJoin(uid: uid)
    }

    public func rtcEngine(_ engine: AgoraRtcEngineKit, didJoinedOfUid uid: UInt, elapsed: Int) {
        var n = 0
        q.sync { remotes.insert(uid); n = remotes.count }
        emitRemotes(n)
    }

    public func rtcEngine(_ engine: AgoraRtcEngineKit, didOfflineOfUid uid: UInt, reason: AgoraUserOfflineReason) {
        var n = 0
        q.sync { remotes.remove(uid); n = remotes.count }
        emitRemotes(n)
    }

    /// Reported on a timer while the call runs. txAudioKBitrate is the
    /// outgoing audio - the one that was zero every time the earpiece broke.
    public func rtcEngine(_ engine: AgoraRtcEngineKit, reportRtcStats stats: AgoraChannelStats) {
        // Agora reports these as UInt; everything this plugin hands back to JS
        // is Int, so convert here rather than widening the stored fields.
        let tx = Int(stats.txAudioKBitrate)
        let rx = Int(stats.rxAudioKBitrate)
        q.async { self.txAudioKbps = tx; self.rxAudioKbps = rx }
    }

    /// uid 0 is this phone's own microphone; everything else is somebody
    /// else's. Both are kept so stats() can say "capturing but not sending",
    /// which is the distinction that took six builds to see.
    public func rtcEngine(_ engine: AgoraRtcEngineKit, reportAudioVolumeIndicationOfSpeakers speakers: [AgoraRtcAudioVolumeInfo], totalVolume: Int) {
        // Agora fires this callback TWICE on a timer: once carrying only the
        // local speaker (uid 0), once carrying the remote ones. So an empty
        // remote list here usually means "this was the local report", NOT
        // "nobody is talking" - and overwriting remoteVolume with 0 on those
        // ticks would make recvLevel read zero through a perfectly audible
        // call. That matters more than it sounds: these logs are the only
        // instrument this project has on an iPhone, and a lying recvLevel
        // would read as "the incoming audio died when I hit the earpiece",
        // which is precisely the wrong diagnosis to chase a seventh time.
        var sawRemote = false
        var remoteMax = 0
        var localSeen: Int?
        for s in speakers {
            if s.uid == 0 {
                localSeen = Int(s.volume)
            } else {
                sawRemote = true
                remoteMax = max(remoteMax, Int(s.volume))
            }
        }
        q.async {
            if let l = localSeen { self.localVolume = l }
            if sawRemote { self.remoteVolume = remoteMax }
        }
    }

    /// A token expiring mid-call, a channel that cannot be reached. Reported
    /// to JS rather than swallowed: the call screen can say something true,
    /// and the code goes into client_logs where it can be read afterwards -
    /// this plugin cannot be debugged from a Windows machine any other way.
    public func rtcEngine(_ engine: AgoraRtcEngineKit, didOccurError errorCode: AgoraErrorCode) {
        notifyListeners("callError", data: ["code": errorCode.rawValue])
        var waiting = false
        q.sync { waiting = (pendingJoin != nil) }
        if waiting {
            // finishJoin rejects before it tears down, and the teardown puts
            // destroy() on a background thread - both deliberate, because this
            // is the SDK's own callback thread and destroy() waits on it.
            finishJoin(error: "agora error \(errorCode.rawValue)")
        }
    }
}
