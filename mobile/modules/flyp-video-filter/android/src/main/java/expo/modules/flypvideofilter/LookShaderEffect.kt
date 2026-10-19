package expo.modules.flypvideofilter

import android.content.Context
import android.opengl.GLES20
import androidx.annotation.OptIn
import androidx.media3.common.VideoFrameProcessingException
import androidx.media3.common.util.GlProgram
import androidx.media3.common.util.GlUtil
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BaseGlShaderProgram
import androidx.media3.effect.GlEffect
import androidx.media3.effect.GlShaderProgram

// Runs a fragment shader that JS sends as source text. It is the same
// look/beauty maths the Skia preview runs (looks.ts builds the SkSL and this
// GLSL ES 1.00 version from one body), so the posted file matches the preview.
@OptIn(UnstableApi::class)
class LookShaderEffect(
  private val vertex: String,
  private val fragment: String,
  private val uniforms: Map<String, FloatArray>,
) : GlEffect {
  override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram {
    // The grade is written for gamma-encoded SDR values.
    if (useHdr) throw VideoFrameProcessingException("The look shader does not support HDR input")
    return LookShaderProgram(vertex, fragment, uniforms)
  }
}

@OptIn(UnstableApi::class)
private fun compile(vertex: String, fragment: String): GlProgram {
  try {
    return GlProgram(vertex, fragment)
  } catch (e: GlUtil.GlException) {
    throw VideoFrameProcessingException(e)
  }
}

@OptIn(UnstableApi::class)
private class LookShaderProgram(
  vertex: String,
  fragment: String,
  private val uniforms: Map<String, FloatArray>,
) : BaseGlShaderProgram(/* useHighPrecisionColorComponents= */ false, /* texturePoolCapacity= */ 1) {
  private val program: GlProgram = compile(vertex, fragment)
  private var width = 1
  private var height = 1

  init {
    // Draw the frame on the whole normalised device coordinate space.
    program.setBufferAttribute(
      "aFramePosition",
      GlUtil.getNormalizedCoordinateBounds(),
      GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE,
    )
  }

  override fun configure(inputWidth: Int, inputHeight: Int): Size {
    width = inputWidth
    height = inputHeight
    return Size(inputWidth, inputHeight)
  }

  override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
    try {
      program.use()
      program.setSamplerTexIdUniform("uTexSampler", inputTexId, /* texUnitIndex= */ 0)
      for ((name, value) in uniforms) program.setFloatsUniformIfPresent(name, value)
      program.setFloatsUniformIfPresent("uDim", floatArrayOf(width.toFloat(), height.toFloat(), 1f / width, 1f / height))
      val seconds = ((presentationTimeUs / 1_000_000.0) % 3600.0).toFloat()
      program.setFloatsUniformIfPresent("uT", floatArrayOf(seconds, 0f, 0f, 0f))
      program.bindAttributesAndUniforms()
      GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, /* first= */ 0, /* count= */ 4)
    } catch (e: GlUtil.GlException) {
      throw VideoFrameProcessingException(e, presentationTimeUs)
    }
  }

  override fun release() {
    super.release()
    try {
      program.delete()
    } catch (e: GlUtil.GlException) {
      throw VideoFrameProcessingException(e)
    }
  }
}
