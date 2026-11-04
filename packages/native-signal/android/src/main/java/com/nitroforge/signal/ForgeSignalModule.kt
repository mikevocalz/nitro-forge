package com.nitroforge.signal

import io.github.expo.modules.v2.ExpoModule
import io.github.expo.modules.v2.JS
import io.github.expo.modules.v2.Module
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.URI
import java.nio.ByteBuffer
import java.nio.ByteOrder

// Original Forge implementation; not a port of an upstream Compose component.
@ExpoModule("ForgeSignal")
class ForgeSignalModule : Module() {
  @JS
  suspend fun analyzeWavFile(uri: String, columns: Int): List<List<Double>> =
    withContext(Dispatchers.IO) { WavPeaks.analyze(uri, columns) }
}

private object WavPeaks {
  fun analyze(uri: String, columns: Int): List<List<Double>> {
    require(columns in 1..4096) { "columns must be between 1 and 4096" }
    val parsed = URI(uri)
    require(parsed.scheme == "file") { "Only sandbox-local file:// WAV URIs are supported" }
    val file = File(parsed)
    require(file.isFile && file.length() in 44L..(64L * 1024L * 1024L)) {
      "WAV file missing or larger than 64 MiB"
    }

    val bytes = file.readBytes()
    val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    fun four(at: Int): String =
      String(bytes, at, 4, Charsets.US_ASCII)
    require(four(0) == "RIFF" && four(8) == "WAVE") { "Expected RIFF/WAVE" }

    var offset = 12
    var sampleFormat = 0
    var channels = 0
    var sampleRate = 0L
    var blockAlign = 0
    var bitsPerSample = 0
    var dataStart = -1
    var dataLength = 0

    while (offset + 8 <= bytes.size) {
      val name = four(offset)
      val length = buffer.getInt(offset + 4).toLong() and 0xffffffffL
      val start = offset + 8
      require(length <= bytes.size.toLong() - start) { "Truncated WAV chunk" }
      if (name == "fmt ") {
        require(length >= 16) { "Truncated fmt chunk" }
        sampleFormat = buffer.getShort(start).toInt() and 0xffff
        channels = buffer.getShort(start + 2).toInt() and 0xffff
        sampleRate = buffer.getInt(start + 4).toLong() and 0xffffffffL
        blockAlign = buffer.getShort(start + 12).toInt() and 0xffff
        bitsPerSample = buffer.getShort(start + 14).toInt() and 0xffff
      } else if (name == "data" && dataStart < 0) {
        dataStart = start
        dataLength = length.toInt()
      }
      offset = (start + length + (length and 1L)).toInt()
    }

    require(sampleFormat == 1 && channels in 1..2 && bitsPerSample == 16 &&
      sampleRate in 8000L..384000L && blockAlign == channels * 2 &&
      dataStart >= 0 && dataLength > 0 && dataLength % blockAlign == 0) {
      "Only mono/stereo 16-bit integer PCM WAV is supported"
    }

    val frames = dataLength / blockAlign
    val lows = DoubleArray(columns) { 1.0 }
    val highs = DoubleArray(columns) { -1.0 }
    for (frame in 0 until frames) {
      val bucket = ((frame.toLong() * columns) / frames).toInt().coerceAtMost(columns - 1)
      val start = dataStart + frame * blockAlign
      for (ch in 0 until channels) {
        val value = buffer.getShort(start + ch * 2).toDouble() / 32768.0
        if (value < lows[bucket]) lows[bucket] = value
        if (value > highs[bucket]) highs[bucket] = value
      }
    }
    return List(columns) { i ->
      if (highs[i] < lows[i]) listOf(0.0, 0.0) else listOf(lows[i], highs[i])
    }
  }
}
