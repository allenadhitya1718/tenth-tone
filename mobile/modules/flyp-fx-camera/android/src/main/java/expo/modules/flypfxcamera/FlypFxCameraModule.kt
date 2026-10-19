package expo.modules.flypfxcamera

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// An Instagram/Snapchat-style camera: the live preview AND the recorded file are
// the same picture, because one GPU pass (look, beauty, face sprites) feeds both
// (see FxPipeline.kt). Android only; iOS keeps the VisionCamera + Skia path.
class FlypFxCameraModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FlypFxCamera")

    // Bumped when the JS <-> native contract changes, so a newer bundle can refuse an older binary.
    Constants("protocol" to 1)

    View(FlypFxCameraView::class) {
      Events("onReady", "onFirstFrame", "onError", "onFacesCount", "onRecordingFinished")

      Prop("facing") { view: FlypFxCameraView, value: String -> view.setFacing(value) }
      Prop("torch") { view: FlypFxCameraView, value: Boolean -> view.setTorch(value) }
      Prop("zoom") { view: FlypFxCameraView, value: Double -> view.setZoom(value) }
      Prop("active") { view: FlypFxCameraView, value: Boolean -> view.setActive(value) }
      Prop("bitRate") { view: FlypFxCameraView, value: Int -> view.setBitRate(value) }
      // The one shared look shader (GLSL ES 1.00, external-OES input) and its 24 uniform floats; null = no grade.
      Prop("lookFragment") { view: FlypFxCameraView, value: String? -> view.setLookFragment(value) }
      Prop("lookUniforms") { view: FlypFxCameraView, value: List<Double>? -> view.setLookUniforms(value) }
      // Index into FACE_FX_IDS, -1 for none, and the sprite art (faceFx.ts SPRITES) as JSON.
      Prop("fxIndex") { view: FlypFxCameraView, value: Int -> view.setFxIndex(value) }
      Prop("spritesJson") { view: FlypFxCameraView, value: String? -> view.setSpritesJson(value) }

      OnViewDidUpdateProps { view: FlypFxCameraView -> view.applyProps() }
      OnViewDestroys { view: FlypFxCameraView -> view.destroy() }

      // Resolves with the file path once the recorder has started; the finished
      // file arrives through onRecordingFinished.
      AsyncFunction("startRecording") { view: FlypFxCameraView, maxSeconds: Int, promise: Promise ->
        view.startRecording(maxSeconds, promise)
      }
      AsyncFunction("stopRecording") { view: FlypFxCameraView ->
        view.stopRecording()
      }
    }
  }
}
