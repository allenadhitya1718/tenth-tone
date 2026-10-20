package expo.modules.flypfxcamera

import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLUtils
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log
import android.util.Size
import android.view.Surface
import androidx.camera.core.CameraEffect
import androidx.camera.core.SurfaceOutput
import androidx.camera.core.SurfaceProcessor
import androidx.camera.core.SurfaceRequest
import androidx.core.util.Consumer
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.concurrent.Executor

private const val TAG = "FlypFx"

/** Where the effect's output lives, as CameraX hands it over. */
internal class OutputGeometry(val sensorToBuffer: Matrix, val width: Int, val height: Int)

/** The latest face target and the matrix that places display-space pixels on the effect buffer. */
internal class FaceFrame(val target: FloatArray, val displayToBuffer: FloatArray)

/**
 * The camera effect: CameraX sends every camera frame to [FxProcessor]; it draws
 * the look and the face sprites ONCE into the single output surface CameraX
 * gives an effect that targets PREVIEW | VIDEO_CAPTURE
 * (CameraEffect.OUTPUT_OPTION_ONE_FOR_ALL_TARGETS, the default). CameraX itself
 * then copies that finished picture to the preview and to the video encoder, so
 * what is shown and what is recorded cannot differ.
 */
internal class FxEffect(val processor: FxProcessor) :
  CameraEffect(
    CameraEffect.PREVIEW or CameraEffect.VIDEO_CAPTURE,
    processor.executor,
    processor,
    Consumer<Throwable> { t -> processor.reportError(t) },
  )

private const val VERTEX = """attribute vec4 aFramePosition;
varying vec2 vTexSamplingCoord;
void main() {
  gl_Position = aFramePosition;
  vTexSamplingCoord = aFramePosition.xy * 0.5 + 0.5;
}
"""

// highp where the GPU has it: with mediump (fp16 on Adreno/Mali) a texture
// coordinate near 1.0 only resolves ~1/2048, about one texel of a 1920-wide
// frame, so every pixel was re-sampled half a texel off (a visible blur).
private const val COPY_FRAGMENT = """#extension GL_OES_EGL_image_external : require
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform samplerExternalOES uTexSampler;
uniform mat4 uTexMat;
varying vec2 vTexSamplingCoord;
void main() {
  gl_FragColor = vec4(texture2D(uTexSampler, (uTexMat * vec4(vTexSamplingCoord, 0.0, 1.0)).xy).rgb, 1.0);
}
"""

private const val SPRITE_VERTEX = """attribute vec2 aPos;
attribute vec2 aUv;
varying vec2 vUv;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
  vUv = aUv;
}
"""

private const val SPRITE_FRAGMENT = """precision mediump float;
uniform sampler2D uSprite;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uSprite, vUv) * uAlpha;
}
"""

private val UVS = floatArrayOf(0f, 0f, 1f, 0f, 0f, 1f, 1f, 1f)

private class Prog(val id: Int) {
  val u = HashMap<String, Int>()
  fun loc(name: String): Int = u.getOrPut(name) { GLES20.glGetUniformLocation(id, name) }
}

private fun compileShader(type: Int, src: String): Int {
  val s = GLES20.glCreateShader(type)
  GLES20.glShaderSource(s, src)
  GLES20.glCompileShader(s)
  val ok = IntArray(1)
  GLES20.glGetShaderiv(s, GLES20.GL_COMPILE_STATUS, ok, 0)
  if (ok[0] == 0) {
    val log = GLES20.glGetShaderInfoLog(s)
    GLES20.glDeleteShader(s)
    throw IllegalStateException("shader compile failed: $log")
  }
  return s
}

private fun link(vertex: String, fragment: String): Prog {
  val vs = compileShader(GLES20.GL_VERTEX_SHADER, vertex)
  val fs = try {
    compileShader(GLES20.GL_FRAGMENT_SHADER, fragment)
  } catch (e: Exception) {
    GLES20.glDeleteShader(vs)
    throw e
  }
  val p = GLES20.glCreateProgram()
  GLES20.glAttachShader(p, vs)
  GLES20.glAttachShader(p, fs)
  GLES20.glLinkProgram(p)
  GLES20.glDeleteShader(vs)
  GLES20.glDeleteShader(fs)
  val ok = IntArray(1)
  GLES20.glGetProgramiv(p, GLES20.GL_LINK_STATUS, ok, 0)
  if (ok[0] == 0) {
    val log = GLES20.glGetProgramInfoLog(p)
    GLES20.glDeleteProgram(p)
    throw IllegalStateException("program link failed: $log")
  }
  return Prog(p)
}

private fun directFloats(n: Int): FloatBuffer =
  ByteBuffer.allocateDirect(n * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()

private class Input(val request: SurfaceRequest, val texId: Int, val st: SurfaceTexture, val surface: Surface) {
  val size: Size = request.resolution
}

private class Output(val out: SurfaceOutput, val eglSurface: EGLSurface, val geometry: OutputGeometry)

private class SpriteTex(val tex: Int, val x0: Float, val y0: Float, val x1: Float, val y1: Float)

/**
 * Draws on a dedicated GL thread. Every CameraX callback (input surface, output
 * surface, errors) is delivered on that thread too, because [executor] posts to it.
 */
internal class FxProcessor(
  private val onFirstFrame: () -> Unit,
  private val onFatal: (code: String, message: String) -> Unit,
) : SurfaceProcessor {
  private val thread = HandlerThread("flyp-fx-gl").apply { start() }
  private val handler = Handler(thread.looper)
  val executor: Executor = Executor { r ->
    if (!released) handler.post(r)
  }

  @Volatile private var released = false

  // EGL / GL objects: only touched on the GL thread.
  private var display: EGLDisplay = EGL14.EGL_NO_DISPLAY
  private var context: EGLContext = EGL14.EGL_NO_CONTEXT
  private var config: EGLConfig? = null
  private var pbuffer: EGLSurface = EGL14.EGL_NO_SURFACE
  private var eglReady = false
  private var copyProg: Prog? = null
  private var lookProg: Prog? = null
  private var spriteProg: Prog? = null
  private var input: Input? = null
  private var output: Output? = null
  private var firstFrameSent = false
  private val quad: FloatBuffer = directFloats(8).apply {
    put(floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f))
    position(0)
  }
  private val spriteBuf: FloatBuffer = directFloats(16)
  private val texMat = FloatArray(16)
  private val outMat = FloatArray(16)

  // Look state, written from the UI thread through [handler].
  private var fragmentSource: String? = null
  private var fragmentDirty = false
  private var uniforms: FloatArray? = null // 24 floats: uA uBal uSh uHi uFx uBty
  // 0 full, 1 lite beauty/bloom taps, 2 lite and no beauty. Only ever changes
  // the look shader's beauty and bloom; never the resolution or the plain copy.
  private var quality = 0

  // Face effect state.
  private var fxIndex = -1
  private var spritesJson: String? = null
  private var sprites: List<SpriteTex?>? = null
  private var pose = poseEmpty()
  private val placements = Placements()
  private val spriteMatrix = Matrix()
  private val totalMatrix = Matrix()
  private val corners = FloatArray(8)
  private val cornerValues = FloatArray(9)

  @Volatile var faceFrame: FaceFrame? = null
  @Volatile var geometry: OutputGeometry? = null

  /** The camera stream the effect receives, and the buffer it draws (for the size log). */
  @Volatile var inputSize: String? = null
  @Volatile var outputSize: String? = null

  // Adaptive quality: average time a render call takes (it blocks when the GPU is behind).
  private var avgMs = 16f
  private var frames = 0
  private var slowStreak = 0
  private var fastStreak = 0
  private var recoverAfter = RECOVER_FRAMES

  private val reported = HashSet<String>()

  // Each kind of failure is reported once; a broken render would otherwise repeat every frame.
  private fun fatal(code: String, message: String) {
    if (reported.add(code)) onFatal(code, message)
  }

  fun reportError(t: Throwable) {
    handler.post { fatal("PIPELINE", t.message ?: t.javaClass.simpleName) }
  }

  // ---------------------------------------------------------------- props

  fun setLook(fragment: String?, u: FloatArray?) {
    handler.post {
      if (fragment != fragmentSource) {
        fragmentSource = fragment
        fragmentDirty = true
      }
      uniforms = if (fragment == null) null else u
    }
  }

  fun setFx(index: Int, json: String?) {
    handler.post {
      fxIndex = index
      if (json != null && json != spritesJson) {
        spritesJson = json
        freeSprites()
      }
      if (index < 0) {
        pose = poseEmpty()
        faceFrame = null
      }
    }
  }

  // ------------------------------------------------------------- CameraX

  override fun onInputSurface(request: SurfaceRequest) {
    if (released) {
      request.willNotProvideSurface()
      return
    }
    try {
      ensureEgl()
      makeCurrent(pbuffer)
      val tex = IntArray(1)
      GLES20.glGenTextures(1, tex, 0)
      GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, tex[0])
      GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
      GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
      GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
      GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
      val st = SurfaceTexture(tex[0])
      val size = request.resolution
      st.setDefaultBufferSize(size.width, size.height)
      inputSize = "${size.width}x${size.height}"
      Log.i(TAG, "effect input ${size.width}x${size.height}")
      val surface = Surface(st)
      val inp = Input(request, tex[0], st, surface)
      input = inp
      // Every new camera session reports its own first frame (JS uses it as a watchdog).
      firstFrameSent = false
      st.setOnFrameAvailableListener({ renderFrame(inp) }, handler)
      request.provideSurface(surface, executor, Consumer { releaseInput(inp) })
    } catch (e: Exception) {
      Log.e(TAG, "input surface failed", e)
      request.willNotProvideSurface()
      fatal("GL_INIT", e.message ?: "GL init failed")
    }
  }

  override fun onOutputSurface(surfaceOutput: SurfaceOutput) {
    if (released) {
      surfaceOutput.close()
      return
    }
    try {
      ensureEgl()
      val surface = surfaceOutput.getSurface(executor, Consumer { event ->
        if (event.eventCode == SurfaceOutput.Event.EVENT_REQUEST_CLOSE) releaseOutput(surfaceOutput)
      })
      val es = EGL14.eglCreateWindowSurface(display, config, surface, intArrayOf(EGL14.EGL_NONE), 0)
      if (es == null || es == EGL14.EGL_NO_SURFACE) throw IllegalStateException("eglCreateWindowSurface failed: 0x${Integer.toHexString(EGL14.eglGetError())}")
      val size = surfaceOutput.size
      val geo = OutputGeometry(surfaceOutput.sensorToBufferTransform, size.width, size.height)
      outputSize = "${size.width}x${size.height}"
      Log.i(TAG, "effect output ${size.width}x${size.height}")
      output?.let { destroyOutput(it) }
      output = Output(surfaceOutput, es, geo)
      geometry = geo
    } catch (e: Exception) {
      Log.e(TAG, "output surface failed", e)
      surfaceOutput.close()
      fatal("GL_INIT", e.message ?: "output surface failed")
    }
  }

  private fun releaseInput(inp: Input) {
    try {
      inp.st.setOnFrameAvailableListener(null)
      if (eglReady) {
        makeCurrent(pbuffer)
        GLES20.glDeleteTextures(1, intArrayOf(inp.texId), 0)
      }
      inp.st.release()
      inp.surface.release()
    } catch (e: Exception) {
      Log.w(TAG, "input release", e)
    }
    if (input === inp) input = null
  }

  private fun releaseOutput(out: SurfaceOutput) {
    val o = output
    if (o != null && o.out === out) {
      output = null
      geometry = null
      destroyOutput(o)
    } else {
      out.close()
    }
  }

  private fun destroyOutput(o: Output) {
    try {
      if (eglReady) {
        EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
        EGL14.eglDestroySurface(display, o.eglSurface)
      }
    } catch (e: Exception) {
      Log.w(TAG, "output destroy", e)
    }
    o.out.close()
  }

  // ----------------------------------------------------------------- EGL

  private fun ensureEgl() {
    if (eglReady) return
    display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
    check(display != EGL14.EGL_NO_DISPLAY) { "no EGL display" }
    val ver = IntArray(2)
    check(EGL14.eglInitialize(display, ver, 0, ver, 1)) { "eglInitialize failed" }
    val attribs = intArrayOf(
      EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
      EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT or EGL14.EGL_PBUFFER_BIT,
      EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8,
      EGLExt.EGL_RECORDABLE_ANDROID, 1,
      EGL14.EGL_NONE,
    )
    val configs = arrayOfNulls<EGLConfig>(1)
    val n = IntArray(1)
    check(EGL14.eglChooseConfig(display, attribs, 0, configs, 0, 1, n, 0) && n[0] > 0) { "no EGL config" }
    config = configs[0]
    context = EGL14.eglCreateContext(display, config, EGL14.EGL_NO_CONTEXT, intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0)
    check(context != EGL14.EGL_NO_CONTEXT) { "eglCreateContext failed" }
    pbuffer = EGL14.eglCreatePbufferSurface(display, config, intArrayOf(EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE), 0)
    check(pbuffer != EGL14.EGL_NO_SURFACE) { "pbuffer failed" }
    eglReady = true
    makeCurrent(pbuffer)
    copyProg = link(VERTEX, COPY_FRAGMENT)
    spriteProg = link(SPRITE_VERTEX, SPRITE_FRAGMENT)
  }

  private fun makeCurrent(s: EGLSurface) {
    check(EGL14.eglMakeCurrent(display, s, s, context)) { "eglMakeCurrent failed: 0x${Integer.toHexString(EGL14.eglGetError())}" }
  }

  // ----------------------------------------------------------- the render

  private fun rebuildLook() {
    fragmentDirty = false
    lookProg?.let { GLES20.glDeleteProgram(it.id) }
    lookProg = null
    val src = fragmentSource ?: return
    val lite = if (quality >= 1) liteFragment(src) else src
    try {
      lookProg = link(VERTEX, lite)
    } catch (e: Exception) {
      // The grade cannot run on this GPU: carry on with the plain picture and tell JS.
      Log.e(TAG, "look shader failed", e)
      fragmentSource = null
      fatal("SHADER", e.message ?: "look shader failed")
    }
  }

  private fun renderFrame(inp: Input) {
    if (released || input !== inp) return
    val t0 = SystemClock.elapsedRealtimeNanos()
    try {
      val o = output
      if (o == null) {
        // No consumer yet: keep the camera's buffers flowing.
        makeCurrent(pbuffer)
        inp.st.updateTexImage()
        return
      }
      makeCurrent(o.eglSurface)
      inp.st.updateTexImage()
      inp.st.getTransformMatrix(texMat)
      o.out.updateTransformMatrix(outMat, texMat)
      val w = o.geometry.width
      val h = o.geometry.height
      val ts = inp.st.timestamp

      if (fragmentDirty) rebuildLook()

      GLES20.glViewport(0, 0, w, h)
      GLES20.glDisable(GLES20.GL_BLEND)
      GLES20.glClearColor(0f, 0f, 0f, 1f)
      GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
      drawPicture(inp, w, h, ts)
      if (fxIndex >= 0) drawFace(o.geometry, ts)
      EGLExt.eglPresentationTimeANDROID(display, o.eglSurface, ts)
      if (!EGL14.eglSwapBuffers(display, o.eglSurface)) {
        val err = EGL14.eglGetError()
        if (err != EGL14.EGL_BAD_SURFACE) Log.w(TAG, "swap failed 0x${Integer.toHexString(err)}")
      }
      if (!firstFrameSent) {
        firstFrameSent = true
        onFirstFrame()
      }
    } catch (e: Exception) {
      Log.e(TAG, "render failed", e)
      fatal("RENDER", e.message ?: "render failed")
      return
    }
    adapt((SystemClock.elapsedRealtimeNanos() - t0) / 1_000_000f)
  }

  private fun drawPicture(inp: Input, w: Int, h: Int, ts: Long) {
    val look = lookProg
    val u = uniforms
    val prog = if (look != null && u != null) look else copyProg!!
    GLES20.glUseProgram(prog.id)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, inp.texId)
    GLES20.glUniform1i(prog.loc("uTexSampler"), 0)
    GLES20.glUniformMatrix4fv(prog.loc("uTexMat"), 1, false, outMat, 0)
    if (prog === look && u != null) {
      val names = LOOK_UNIFORMS
      for (i in names.indices) {
        val l = prog.loc(names[i])
        if (l < 0) continue
        if (quality >= 2 && names[i] == "uBty") GLES20.glUniform4f(l, 0f, 0f, 0f, 0f)
        else GLES20.glUniform4f(l, u[i * 4], u[i * 4 + 1], u[i * 4 + 2], u[i * 4 + 3])
      }
      GLES20.glUniform4f(prog.loc("uDim"), w.toFloat(), h.toFloat(), 1f / w, 1f / h)
      val seconds = ((ts / 1e9) % 3600.0).toFloat()
      GLES20.glUniform4f(prog.loc("uT"), seconds, 0f, 0f, 0f)
    }
    val pos = GLES20.glGetAttribLocation(prog.id, "aFramePosition")
    GLES20.glEnableVertexAttribArray(pos)
    quad.position(0)
    GLES20.glVertexAttribPointer(pos, 2, GLES20.GL_FLOAT, false, 0, quad)
    GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
    GLES20.glDisableVertexAttribArray(pos)
  }

  private fun drawFace(geo: OutputGeometry, ts: Long) {
    val frame = faceFrame ?: return
    val atlas = sprites ?: loadSprites()
    // One smoothing step per rendered frame, like the Skia preview does per frame.
    pose = stepPose(pose, frame.target)
    placeEffect(fxIndex, pose, (ts / 1e9) % 3600.0, placements)
    if (placements.count == 0) return

    val prog = spriteProg!!
    GLES20.glUseProgram(prog.id)
    GLES20.glEnable(GLES20.GL_BLEND)
    GLES20.glBlendFunc(GLES20.GL_ONE, GLES20.GL_ONE_MINUS_SRC_ALPHA)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glUniform1i(prog.loc("uSprite"), 0)
    val aPos = GLES20.glGetAttribLocation(prog.id, "aPos")
    val aUv = GLES20.glGetAttribLocation(prog.id, "aUv")
    GLES20.glEnableVertexAttribArray(aPos)
    GLES20.glEnableVertexAttribArray(aUv)

    val d2b = frame.displayToBuffer
    val wF = geo.width.toFloat()
    val hF = geo.height.toFloat()
    val data = placements.data
    for (n in 0 until placements.count) {
      val o = n * PLACEMENT_LEN
      val s = atlas.getOrNull(data[o].toInt()) ?: continue
      val alpha = data[o + 7]
      if (alpha <= 0.01f) continue
      // Sprite units -> display pixels (the placement) -> effect buffer pixels.
      cornerValues[0] = data[o + 1]; cornerValues[1] = data[o + 3]; cornerValues[2] = data[o + 5]
      cornerValues[3] = data[o + 2]; cornerValues[4] = data[o + 4]; cornerValues[5] = data[o + 6]
      cornerValues[6] = 0f; cornerValues[7] = 0f; cornerValues[8] = 1f
      spriteMatrix.setValues(cornerValues)
      totalMatrix.setValues(d2b)
      totalMatrix.preConcat(spriteMatrix)
      corners[0] = s.x0; corners[1] = s.y0
      corners[2] = s.x1; corners[3] = s.y0
      corners[4] = s.x0; corners[5] = s.y1
      corners[6] = s.x1; corners[7] = s.y1
      totalMatrix.mapPoints(corners)
      spriteBuf.position(0)
      for (k in 0 until 4) {
        spriteBuf.put(corners[k * 2] / wF * 2f - 1f)
        spriteBuf.put(1f - corners[k * 2 + 1] / hF * 2f)
        spriteBuf.put(UVS[k * 2])
        spriteBuf.put(UVS[k * 2 + 1])
      }
      GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, s.tex)
      GLES20.glUniform1f(prog.loc("uAlpha"), alpha)
      spriteBuf.position(0)
      GLES20.glVertexAttribPointer(aPos, 2, GLES20.GL_FLOAT, false, 16, spriteBuf)
      spriteBuf.position(2)
      GLES20.glVertexAttribPointer(aUv, 2, GLES20.GL_FLOAT, false, 16, spriteBuf)
      GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
    }
    GLES20.glDisableVertexAttribArray(aPos)
    GLES20.glDisableVertexAttribArray(aUv)
    GLES20.glDisable(GLES20.GL_BLEND)
  }

  private fun loadSprites(): List<SpriteTex?> {
    val json = spritesJson
    val list = ArrayList<SpriteTex?>()
    if (json != null) {
      for (sb in SpriteArt.rasterise(json)) {
        if (sb == null) {
          list.add(null)
          continue
        }
        val t = IntArray(1)
        GLES20.glGenTextures(1, t, 0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, t[0])
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, sb.bitmap, 0)
        sb.bitmap.recycle()
        list.add(SpriteTex(t[0], sb.x0, sb.y0, sb.x1, sb.y1))
      }
    }
    sprites = list
    return list
  }

  private fun freeSprites() {
    val l = sprites ?: return
    sprites = null
    if (!eglReady) return
    val ids = l.filterNotNull().map { it.tex }.toIntArray()
    if (ids.isNotEmpty()) GLES20.glDeleteTextures(ids.size, ids, 0)
  }

  /** True when the current look runs the taps quality can cut (beauty smoothing or bloom). */
  private fun heavyLook(): Boolean {
    val u = uniforms ?: return false
    if (lookProg == null) return false
    return u[UNIFORM_BEAUTY] > 0.001f || u[UNIFORM_BLOOM] > 0.001f
  }

  /**
   * Slow GPUs (Mali-G52 / Adreno 610 class) get fewer beauty/bloom taps, then no
   * beauty, instead of dropping frames; and get them back once the load drops.
   * The plain picture and the cheap looks are never measured, since there is
   * nothing to cut (a slow swap there used to push the level down for nothing).
   * Each drop after a recovery waits twice as long before trying again, so it
   * cannot flip-flop.
   */
  private fun adapt(ms: Float) {
    if (!heavyLook()) {
      slowStreak = 0
      fastStreak = 0
      return
    }
    frames++
    avgMs += (ms - avgMs) * 0.1f
    if (frames < 30) return
    if (avgMs > SLOW_MS) slowStreak++ else slowStreak = 0
    if (avgMs < FAST_MS) fastStreak++ else fastStreak = 0
    if (slowStreak > 45 && quality < 2) {
      quality++
      slowStreak = 0
      fastStreak = 0
      avgMs = 16f
      Log.w(TAG, "render is slow (beauty/bloom only): quality level $quality")
      if (fragmentSource != null) fragmentDirty = true
    } else if (quality > 0 && fastStreak > recoverAfter) {
      quality--
      fastStreak = 0
      slowStreak = 0
      recoverAfter = (recoverAfter * 2).coerceAtMost(RECOVER_FRAMES_MAX)
      Log.i(TAG, "render recovered: quality level $quality")
      if (fragmentSource != null) fragmentDirty = true
    }
  }

  fun release() {
    if (released) return
    released = true
    handler.post {
      try {
        output?.let { destroyOutput(it) }
        output = null
        input?.let { releaseInput(it) }
        if (eglReady) {
          makeCurrent(pbuffer)
          freeSprites()
          lookProg?.let { GLES20.glDeleteProgram(it.id) }
          copyProg?.let { GLES20.glDeleteProgram(it.id) }
          spriteProg?.let { GLES20.glDeleteProgram(it.id) }
          EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
          EGL14.eglDestroySurface(display, pbuffer)
          EGL14.eglDestroyContext(display, context)
          EGL14.eglTerminate(display)
          eglReady = false
        }
      } catch (e: Exception) {
        Log.w(TAG, "release", e)
      }
      thread.quitSafely()
    }
  }
}

/** The uniforms JS sends, in this order (looks.ts LOOK_UNIFORM_NAMES without uDim and uT). */
internal val LOOK_UNIFORMS = arrayOf("uA", "uBal", "uSh", "uHi", "uFx", "uBty")

// Indexes into those 24 floats: uFx.z (bloom) and uBty.x (skin smoothing).
private const val UNIFORM_BLOOM = 4 * 4 + 2
private const val UNIFORM_BEAUTY = 5 * 4

// A render call (it blocks while the GPU is behind) is "slow" above SLOW_MS on
// average (a 30 fps frame is 33 ms) and has room again below FAST_MS.
private const val SLOW_MS = 28f
private const val FAST_MS = 18f
private const val RECOVER_FRAMES = 300 // ~10 s at 30 fps
private const val RECOVER_FRAMES_MAX = 3600

/**
 * A cheaper variant of the shared look shader for slow GPUs: only the four
 * axis taps of the skin smoothing and no bloom. If the text changes and a
 * replacement does not match, the shader is simply left as it was.
 */
internal fun liteFragment(src: String): String {
  // Drop the 4 diagonal and the 4 outer-ring taps of the skin smoothing (lines that call wtap with r2 or a diagonal), keep the 4 axis taps.
  val kept = src.lines().filterNot { line ->
    line.contains("wtap(c0, p + vec2(") && (line.contains("r2") || line.contains("dg"))
  }
  return kept.joinToString("\n").replace("if (uFx.z > 0.001) {", "if (false) {")
}
