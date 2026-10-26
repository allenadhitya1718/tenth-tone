import AVFAudio
import CallKit
import ExpoModulesCore
import PushKit
import UIKit

// Incoming FLYP calls on iPhone, the way WhatsApp shows them (client round 4).
//
// send-push sends a ringing call to this phone's PushKit (VoIP) token
// (push_tokens.voip_token, 0160). iOS wakes or launches the app for it, and
// the push MUST be reported to CallKit straight away, natively, or iOS stops
// delivering VoIP pushes to the app; JavaScript may not even be running yet.
// So this file reports the call itself and keeps what the person does
// (Answer, Decline / End, Mute) until the app's JavaScript collects it
// (src/features/call/callkit.ts), which then answers, declines or hangs up
// through the normal call code.
//
// The JS side ends the CallKit call whenever the FLYP call ends for any other
// reason (the caller gave up, answered on another phone, hung up).

final class FlypCallKit: NSObject, CXProviderDelegate, PKPushRegistryDelegate {
  static let shared = FlypCallKit()

  // How long a call rings (send-push RING_MS).
  private let ringSeconds: Double = 45

  private let provider: CXProvider
  private let controller = CXCallController()
  private var registry: PKPushRegistry?
  private(set) var token: String?
  // CallKit's UUID for each FLYP call id (the call id IS a UUID).
  private var calls: [UUID: String] = [:]
  private var answered: Set<UUID> = []
  // Answered in the app itself: CallKit is told, without echoing it back.
  private var answeredInApp: Set<UUID> = []
  // Events waiting for JavaScript; delivered live once it listens.
  private var pending: [[String: Any]] = []
  var emit: ((String, [String: Any]) -> Void)?

  override init() {
    let config = CXProviderConfiguration()
    config.supportsVideo = true
    config.maximumCallGroups = 1
    config.maximumCallsPerCallGroup = 1
    config.supportedHandleTypes = [.generic]
    config.includesCallsInRecents = true
    if Bundle.main.url(forResource: "flyp_ring", withExtension: "caf") != nil {
      config.ringtoneSound = "flyp_ring.caf"
    }
    if let icon = UIImage(named: "CallKitIcon") {
      config.iconTemplateImageData = icon.pngData()
    }
    provider = CXProvider(configuration: config)
    super.init()
    provider.setDelegate(self, queue: nil)
  }

  /// Starts listening for VoIP pushes. Safe to call more than once.
  func start() {
    if registry != nil { return }
    let r = PKPushRegistry(queue: .main)
    r.delegate = self
    r.desiredPushTypes = [.voIP]
    registry = r
  }

  // MARK: - Events for JavaScript

  private func send(_ name: String, _ body: [String: Any]) {
    if let emit = emit {
      emit(name, body)
      return
    }
    // The token is read on demand; only call events are kept.
    if name == "token" { return }
    var e = body
    e["event"] = name
    pending.append(e)
    if pending.count > 20 { pending.removeFirst(pending.count - 20) }
  }

  func takePending() -> [[String: Any]] {
    let p = pending
    pending = []
    return p
  }

  // MARK: - PushKit

  func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    let t = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
    token = t
    send("token", ["token": t])
  }

  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    token = nil
    send("token", ["token": ""])
  }

  func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    let d = payload.dictionaryPayload
    let callId = (d["call_id"] as? String) ?? ""
    let name = (d["caller_name"] as? String) ?? (d["handle"] as? String) ?? "FLYP"
    let video = (d["call_kind"] as? String) == "video"
    let createdMs = Double((d["created_at"] as? String) ?? "") ?? Date().timeIntervalSince1970 * 1000
    let uuid = UUID(uuidString: callId) ?? UUID()

    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: name)
    update.localizedCallerName = name
    update.hasVideo = video
    update.supportsHolding = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    update.supportsDTMF = false

    // Already ringing (a repeated push): nothing new to report.
    if calls[uuid] != nil {
      completion()
      return
    }
    calls[uuid] = callId
    provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
      defer { completion() }
      guard let self = self else { return }
      if error != nil {
        // Do Not Disturb, a blocked number, or a call already in progress.
        self.calls.removeValue(forKey: uuid)
        return
      }
      let age = (Date().timeIntervalSince1970 * 1000 - createdMs) / 1000
      if callId.isEmpty || age > self.ringSeconds {
        // Too late to ring: iOS still had to be told, now take it back.
        self.provider.reportCall(with: uuid, endedAt: nil, reason: .unanswered)
        self.calls.removeValue(forKey: uuid)
        return
      }
      self.send("incoming", ["callId": callId, "video": video])
      // Stop ringing at the ring time even if JavaScript never runs.
      DispatchQueue.main.asyncAfter(deadline: .now() + max(3, self.ringSeconds - age)) {
        if self.calls[uuid] != nil && !self.answered.contains(uuid) {
          self.provider.reportCall(with: uuid, endedAt: nil, reason: .unanswered)
          self.calls.removeValue(forKey: uuid)
        }
      }
    }
  }

  // MARK: - CallKit

  func providerDidReset(_ provider: CXProvider) {
    calls.removeAll()
    answered.removeAll()
    answeredInApp.removeAll()
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    answered.insert(action.callUUID)
    if let id = calls[action.callUUID], answeredInApp.remove(action.callUUID) == nil {
      send("action", ["action": "answer", "callId": id])
    }
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    if let id = calls.removeValue(forKey: action.callUUID) {
      send("action", ["action": "end", "callId": id])
    }
    answered.remove(action.callUUID)
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    if let id = calls[action.callUUID] {
      send("action", ["action": "mute", "callId": id, "muted": action.isMuted])
    }
    action.fulfill()
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {}

  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {}

  // MARK: - From JavaScript

  /// The FLYP call ended outside CallKit: take the CallKit call away without
  /// echoing an "end" back. reason: missed | remote | elsewhere | declined | failed
  func endCall(_ callId: String, reason: String) {
    guard let uuid = calls.first(where: { $0.value == callId })?.key else { return }
    calls.removeValue(forKey: uuid)
    answered.remove(uuid)
    let r: CXCallEndedReason
    switch reason {
    case "missed": r = .unanswered
    case "elsewhere": r = .answeredElsewhere
    case "declined": r = .declinedElsewhere
    case "failed": r = .failed
    default: r = .remoteEnded
    }
    provider.reportCall(with: uuid, endedAt: nil, reason: r)
  }

  /// The call was answered on the app's own screen: answer the CallKit call
  /// too, so the ringing stops and it shows as an ongoing call.
  func callConnected(_ callId: String) {
    guard let uuid = calls.first(where: { $0.value == callId })?.key, !answered.contains(uuid) else { return }
    answeredInApp.insert(uuid)
    controller.request(CXTransaction(action: CXAnswerCallAction(call: uuid))) { [weak self] error in
      if error != nil { self?.answeredInApp.remove(uuid) }
    }
  }
}

public class FlypCallKitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FlypCallKit")

    Events("token", "action", "incoming")

    OnStartObserving {
      FlypCallKit.shared.emit = { [weak self] name, body in
        self?.sendEvent(name, body)
      }
    }

    OnStopObserving {
      FlypCallKit.shared.emit = nil
    }

    Function("getVoipToken") { () -> String? in
      FlypCallKit.shared.token
    }

    Function("takePending") { () -> [[String: Any]] in
      FlypCallKit.shared.takePending()
    }

    Function("endCall") { (callId: String, reason: String) in
      DispatchQueue.main.async { FlypCallKit.shared.endCall(callId, reason: reason) }
    }

    Function("callConnected") { (callId: String) in
      DispatchQueue.main.async { FlypCallKit.shared.callConnected(callId) }
    }
  }
}

public class FlypCallKitAppDelegate: ExpoAppDelegateSubscriber {
  // As early as possible: a VoIP push that launched the app must find the
  // PushKit registry already listening.
  public func subscriberDidRegister() {
    FlypCallKit.shared.start()
  }

  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    FlypCallKit.shared.start()
    return true
  }
}
