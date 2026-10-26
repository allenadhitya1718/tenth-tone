package expo.modules.flypringer

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The FLYP ringtone inside the app (an incoming call while the app is open),
// played the way the phone rings: on the RINGTONE stream at the ring volume,
// and not at all when the phone is on silent or vibrate, as WhatsApp does.
class FlypRingerModule : Module() {
  private var player: MediaPlayer? = null

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("no context")

  override fun definition() = ModuleDefinition {
    Name("FlypRinger")

    // 0 silent, 1 vibrate, 2 normal (AudioManager.RINGER_MODE_*).
    Function("ringerMode") {
      (context.getSystemService(Context.AUDIO_SERVICE) as AudioManager).ringerMode
    }

    Function("start") {
      stop()
      val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      if (audio.ringerMode != AudioManager.RINGER_MODE_NORMAL) return@Function false
      val id = context.resources.getIdentifier("flyp_ring", "raw", context.packageName)
      if (id == 0) return@Function false
      val p = MediaPlayer()
      p.setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
      )
      p.setDataSource(context, Uri.parse("android.resource://${context.packageName}/$id"))
      p.isLooping = true
      p.prepare()
      p.start()
      player = p
      true
    }

    Function("stop") { stop() }

    OnDestroy { stop() }
  }

  private fun stop() {
    player?.let {
      try {
        it.stop()
      } catch (_: Exception) {}
      it.release()
    }
    player = null
  }
}
