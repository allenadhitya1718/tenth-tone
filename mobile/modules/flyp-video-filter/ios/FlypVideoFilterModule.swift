import AVFoundation
import CoreImage
import ExpoModulesCore

// Re-encodes a recorded clip with a colour matrix baked into every frame.
// VisionCamera records straight from the sensor, so this is how a camera
// filter reaches the uploaded file. AVAssetReader/Writer rather than an export
// session so the H.264 bit rate (and so the upload size) stays under our control.
public class FlypVideoFilterModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FlypVideoFilter")

    AsyncFunction("applyColorMatrix") { (inputUri: String, matrix: [Double], bitRate: Int) async throws -> String in
      guard matrix.count == 20 else {
        throw Exception(name: "ERR_FILTER_MATRIX", description: "Expected a 4x5 colour matrix (20 values)")
      }
      let input = inputUri.hasPrefix("file://") ? URL(string: inputUri)! : URL(fileURLWithPath: inputUri)
      let output = FileManager.default.temporaryDirectory
        .appendingPathComponent("flyp-filter-\(UUID().uuidString).mp4")
      try await FlypVideoFilter.export(input: input, output: output, matrix: matrix, bitRate: bitRate)
      return output.absoluteString
    }
  }
}

enum FlypVideoFilter {
  // No working colour space: Core Image would otherwise linearise first, while
  // Skia applies the preview matrix to the gamma-encoded values.
  private static let context = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull()])

  static func export(input: URL, output: URL, matrix m: [Double], bitRate: Int) async throws {
    let asset = AVURLAsset(url: input)
    guard let videoTrack = try await asset.loadTracks(withMediaType: .video).first else {
      throw Exception(name: "ERR_FILTER_NO_VIDEO", description: "The recording has no video track")
    }
    let audioTrack = try await asset.loadTracks(withMediaType: .audio).first

    // Skia's 4x5 row-major matrix maps 1:1 onto CIColorMatrix's vectors.
    let r = CIVector(x: m[0], y: m[1], z: m[2], w: m[3])
    let g = CIVector(x: m[5], y: m[6], z: m[7], w: m[8])
    let b = CIVector(x: m[10], y: m[11], z: m[12], w: m[13])
    let a = CIVector(x: m[15], y: m[16], z: m[17], w: m[18])
    let bias = CIVector(x: m[4], y: m[9], z: m[14], w: m[19])

    // This composition also applies the track's preferredTransform, so the
    // frames come out upright and the writer needs no transform of its own.
    let composition = try await AVMutableVideoComposition.videoComposition(with: asset) { request in
      let source = request.sourceImage.clampedToExtent()
      let filter = CIFilter(name: "CIColorMatrix")!
      filter.setValue(source, forKey: kCIInputImageKey)
      filter.setValue(r, forKey: "inputRVector")
      filter.setValue(g, forKey: "inputGVector")
      filter.setValue(b, forKey: "inputBVector")
      filter.setValue(a, forKey: "inputAVector")
      filter.setValue(bias, forKey: "inputBiasVector")
      if let out = filter.outputImage?.cropped(to: request.sourceImage.extent) {
        request.finish(with: out, context: context)
      } else {
        request.finish(with: request.sourceImage, context: context)
      }
    }

    let reader = try AVAssetReader(asset: asset)
    let videoOut = AVAssetReaderVideoCompositionOutput(
      videoTracks: [videoTrack],
      videoSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    )
    videoOut.videoComposition = composition
    videoOut.alwaysCopiesSampleData = false
    reader.add(videoOut)

    var audioOut: AVAssetReaderTrackOutput?
    if let audioTrack {
      let out = AVAssetReaderTrackOutput(track: audioTrack, outputSettings: nil)
      out.alwaysCopiesSampleData = false
      if reader.canAdd(out) {
        reader.add(out)
        audioOut = out
      }
    }

    let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
    writer.shouldOptimizeForNetworkUse = true
    let size = composition.renderSize
    let videoIn = AVAssetWriterInput(mediaType: .video, outputSettings: [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: Int(size.width),
      AVVideoHeightKey: Int(size.height),
      AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: bitRate,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
      ],
    ])
    videoIn.expectsMediaDataInRealTime = false
    writer.add(videoIn)

    // Audio is copied as-is (passthrough), it needs the source format as a hint.
    var audioIn: AVAssetWriterInput?
    if audioOut != nil, let audioTrack, let format = try await audioTrack.load(.formatDescriptions).first {
      let input = AVAssetWriterInput(mediaType: .audio, outputSettings: nil, sourceFormatHint: format)
      input.expectsMediaDataInRealTime = false
      if writer.canAdd(input) {
        writer.add(input)
        audioIn = input
      }
    }

    guard reader.startReading() else {
      throw reader.error ?? Exception(name: "ERR_FILTER_READ", description: "Could not read the recording")
    }
    guard writer.startWriting() else {
      reader.cancelReading()
      throw writer.error ?? Exception(name: "ERR_FILTER_WRITE", description: "Could not start writing")
    }
    writer.startSession(atSourceTime: .zero)

    async let video: Void = pump(videoOut, into: videoIn, label: "video")
    if let audioOut, let audioIn {
      async let audio: Void = pump(audioOut, into: audioIn, label: "audio")
      _ = await (video, audio)
    } else {
      await video
    }

    if reader.status == .failed || writer.status == .failed {
      writer.cancelWriting()
      try? FileManager.default.removeItem(at: output)
      throw writer.error ?? reader.error ?? Exception(name: "ERR_FILTER_EXPORT", description: "Export failed")
    }
    await writer.finishWriting()
    if writer.status != .completed {
      try? FileManager.default.removeItem(at: output)
      throw writer.error ?? Exception(name: "ERR_FILTER_EXPORT", description: "Export failed")
    }
  }

  private static func pump(_ output: AVAssetReaderOutput, into input: AVAssetWriterInput, label: String) async {
    let queue = DispatchQueue(label: "flyp.videofilter.\(label)")
    await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
      input.requestMediaDataWhenReady(on: queue) {
        while input.isReadyForMoreMediaData {
          guard let buffer = output.copyNextSampleBuffer(), input.append(buffer) else {
            input.markAsFinished()
            done.resume()
            return
          }
        }
      }
    }
  }
}
