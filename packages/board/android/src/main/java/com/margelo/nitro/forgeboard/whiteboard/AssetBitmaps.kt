package com.margelo.nitro.forgeboard.whiteboard

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import android.util.Log
import kotlin.math.max

/**
 * Decoded image assets keyed by asset id and `src`. [resolver] decides which
 * sources may be read: base64 `data:` URLs and files inside the app's own
 * directories. Remote URLs are not fetched; refused, undecodable and
 * over-[budget] assets draw QuickDraw's placeholder. Decoding runs on the
 * render thread, downsampled so the longest side is at most [MAX_SIDE_PX].
 * Render thread only.
 */
internal class AssetBitmaps(
  private val resolver: AssetSourceResolver,
  private val budget: BitmapBudget = BitmapBudget(),
) {
  private class Entry(val src: String, val bitmap: Bitmap?)

  private val entries = HashMap<String, Entry>()

  /** @return the bitmap, or null when the asset cannot be decoded here. */
  fun bitmapFor(asset: BoardAsset): Bitmap? {
    entries[asset.id]?.let { previous ->
      if (previous.src == asset.src) return previous.bitmap
      // Out of the map before decoding, so the budget does not count it.
      entries.remove(asset.id)
      previous.bitmap?.recycle()
    }
    val bitmap = decode(asset.src)
    entries[asset.id] = Entry(asset.src, bitmap)
    return bitmap
  }

  fun retainOnly(ids: Set<String>) {
    val iterator = entries.entries.iterator()
    while (iterator.hasNext()) {
      val next = iterator.next()
      if (next.key !in ids) {
        next.value.bitmap?.recycle()
        iterator.remove()
      }
    }
  }

  fun byteCount(): Long = entries.values.sumOf { it.bitmap?.allocationByteCount?.toLong() ?: 0L }

  fun clear() {
    for (entry in entries.values) entry.bitmap?.recycle()
    entries.clear()
  }

  private fun decode(src: String): Bitmap? {
    val source = resolver.resolve(src) ?: return null
    try {
      return when (source) {
        is Base64AssetSource -> {
          val bytes = Base64.decode(source.payload, Base64.DEFAULT)
          val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
          BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
          val options = withinBudget(bounds) ?: return null
          BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
        }
        is FileAssetSource -> {
          val path = source.file.path
          val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
          BitmapFactory.decodeFile(path, bounds)
          val options = withinBudget(bounds) ?: return null
          BitmapFactory.decodeFile(path, options)
        }
      }
    } catch (error: IllegalArgumentException) {
      // Bad base64, among others.
      Log.w(TAG, "Could not decode image asset", error)
      return null
    } catch (error: OutOfMemoryError) {
      // Covers the base64 decode as well as the bitmap.
      Log.w(TAG, "Image asset too large to decode", error)
      return null
    }
  }

  /** Decode options for [bounds], or null when the result would exceed the budget. */
  private fun withinBudget(bounds: BitmapFactory.Options): BitmapFactory.Options? {
    val options = sampled(bounds)
    val nextBytes = BitmapBudget.estimatedBytes(bounds.outWidth, bounds.outHeight, options.inSampleSize)
    if (!budget.fits(byteCount(), nextBytes)) {
      Log.w(TAG, "Skipping an image asset: $nextBytes bytes would exceed the renderer's bitmap budget")
      return null
    }
    return options
  }

  private fun sampled(bounds: BitmapFactory.Options): BitmapFactory.Options {
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / sample > MAX_SIDE_PX) sample *= 2
    return BitmapFactory.Options().apply {
      inSampleSize = sample
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }
  }

  private companion object {
    const val TAG = "WhiteboardRenderer"
    const val MAX_SIDE_PX = 2048
  }
}
