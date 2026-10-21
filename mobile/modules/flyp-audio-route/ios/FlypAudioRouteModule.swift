import AVFoundation
import ExpoModulesCore

// Call audio output. Agora's setEnableSpeakerphone does nothing while a
// Bluetooth or wired headset is connected, and Agora has no iOS call to pick
// one, so the output is chosen here on the shared audio session Agora uses:
//   speaker    override the output to the built-in speaker
//   bluetooth  drop the override and prefer the Bluetooth headset's mic,
//              which routes the call back to the headset
//   earpiece   drop the override and prefer the built-in mic (the receiver)
//   headset    drop the override and prefer the wired headset's mic
// "change" fires on every route change, with the same shape as getState().
public class FlypAudioRouteModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("FlypAudioRoute")
    Events("change")

    OnStartObserving {
      self.observer = NotificationCenter.default.addObserver(
        forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
      ) { [weak self] _ in
        self?.sendEvent("change", Self.state())
      }
    }
    OnStopObserving {
      if let o = self.observer { NotificationCenter.default.removeObserver(o) }
      self.observer = nil
    }

    Function("getState") { () -> [String: Any] in
      Self.state().mapValues { $0 ?? NSNull() }
    }

    Function("setOutput") { (output: String) -> Bool in
      let session = AVAudioSession.sharedInstance()
      do {
        switch output {
        case "speaker":
          try session.overrideOutputAudioPort(.speaker)
        case "bluetooth":
          try session.overrideOutputAudioPort(.none)
          if let bt = session.availableInputs?.first(where: { Self.bluetoothIn.contains($0.portType) }) {
            try session.setPreferredInput(bt)
          }
        case "headset":
          try session.overrideOutputAudioPort(.none)
          if let h = session.availableInputs?.first(where: { $0.portType == .headsetMic }) {
            try session.setPreferredInput(h)
          }
        default:
          try session.overrideOutputAudioPort(.none)
          if let mic = session.availableInputs?.first(where: { $0.portType == .builtInMic }) {
            try session.setPreferredInput(mic)
          }
        }
        return true
      } catch {
        return false
      }
    }
  }

  static let bluetoothIn: [AVAudioSession.Port] = [.bluetoothHFP, .bluetoothLE]
  static let bluetoothOut: [AVAudioSession.Port] = [.bluetoothHFP, .bluetoothA2DP, .bluetoothLE]

  static func state() -> [String: Any?] {
    let session = AVAudioSession.sharedInstance()
    let inputs = session.availableInputs ?? []
    let outs = session.currentRoute.outputs
    let btIn = inputs.first(where: { bluetoothIn.contains($0.portType) })
    let btOut = outs.first(where: { bluetoothOut.contains($0.portType) })
    let headset = inputs.contains(where: { $0.portType == .headsetMic })
      || outs.contains(where: { $0.portType == .headphones })
    var output = "other"
    if let o = outs.first {
      switch o.portType {
      case .builtInSpeaker: output = "speaker"
      case .builtInReceiver: output = "earpiece"
      case .headphones, .headsetMic: output = "headset"
      default: output = bluetoothOut.contains(o.portType) ? "bluetooth" : "other"
      }
    }
    return [
      "bluetooth": btIn != nil || btOut != nil,
      "bluetoothName": btIn?.portName ?? btOut?.portName,
      "headset": headset,
      "output": output,
    ]
  }
}
