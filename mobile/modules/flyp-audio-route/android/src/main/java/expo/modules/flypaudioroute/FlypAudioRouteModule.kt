package expo.modules.flypaudioroute

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Call audio output, Android side: reports whether a Bluetooth or wired
// headset is connected (and which output the call is on), and fires "change"
// when a device comes or goes. Switching is done in JS with Agora's
// setRouteInCommunicationMode, which Android supports and which works while
// a headset is connected (setEnableSpeakerphone does not).
class FlypAudioRouteModule : Module() {
  private var callback: AudioDeviceCallback? = null

  private val audio: AudioManager?
    get() = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  override fun definition() = ModuleDefinition {
    Name("FlypAudioRoute")
    Events("change")

    OnStartObserving("change") {
      val am = audio ?: return@OnStartObserving
      val cb = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>?) {
          sendEvent("change", state())
        }
        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>?) {
          sendEvent("change", state())
        }
      }
      am.registerAudioDeviceCallback(cb, Handler(Looper.getMainLooper()))
      callback = cb
    }
    OnStopObserving("change") {
      callback?.let { audio?.unregisterAudioDeviceCallback(it) }
      callback = null
    }

    Function("getState") { state() }

    // Not used on Android (see above); present so the JS shape matches.
    Function("setOutput") { _: String -> false }
  }

  private fun isBluetooth(t: Int): Boolean =
    t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
      (Build.VERSION.SDK_INT >= 31 && (t == AudioDeviceInfo.TYPE_BLE_HEADSET || t == AudioDeviceInfo.TYPE_BLE_SPEAKER))

  private fun isWired(t: Int): Boolean =
    t == AudioDeviceInfo.TYPE_WIRED_HEADSET || t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
      t == AudioDeviceInfo.TYPE_USB_HEADSET

  private fun state(): Map<String, Any?> {
    val am = audio ?: return mapOf("bluetooth" to false, "bluetoothName" to null, "headset" to false, "output" to "other")
    val outs = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
    val bt = outs.firstOrNull { isBluetooth(it.type) }
    val wired = outs.any { isWired(it.type) }
    var output = "other"
    if (Build.VERSION.SDK_INT >= 31) {
      val dev = am.communicationDevice
      if (dev != null) {
        output = when {
          dev.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
          dev.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "earpiece"
          isBluetooth(dev.type) -> "bluetooth"
          isWired(dev.type) -> "headset"
          else -> "other"
        }
      }
    } else {
      @Suppress("DEPRECATION")
      output = when {
        am.isBluetoothScoOn -> "bluetooth"
        am.isSpeakerphoneOn -> "speaker"
        wired -> "headset"
        else -> "earpiece"
      }
    }
    return mapOf(
      "bluetooth" to (bt != null),
      "bluetoothName" to bt?.productName?.toString(),
      "headset" to wired,
      "output" to output,
    )
  }
}
