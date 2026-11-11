package com.margelo.nitro.forgeboard.whiteboard

import java.io.File
import java.io.IOException
import java.net.URI
import java.net.URISyntaxException

/**
 * Decides whether an asset `src` may be decoded, and from where.
 *
 * Accepted: base64 `data:` URLs up to [maxDataUrlChars] characters, and
 * regular files (`file:///...` or an absolute path) whose canonical path is
 * inside one of [fileRoots]. Canonicalising first resolves `..` and symbolic
 * links, so neither can reach outside the roots. Everything else, including
 * remote and `content://` URLs, is refused and draws QuickDraw's placeholder.
 *
 * @param fileRoots the app's own directories, such as `cacheDir` and `filesDir`.
 */
internal class AssetSourceResolver(fileRoots: List<File>, private val maxDataUrlChars: Int = MAX_DATA_URL_CHARS) {
  private val roots: List<String> = fileRoots.mapNotNull { root ->
    try {
      root.canonicalPath
    } catch (_: IOException) {
      null
    }
  }

  /** @return the source to decode, or null when [src] is not allowed. */
  fun resolve(src: String): AssetSource? {
    if (src.startsWith("data:")) return resolveDataUrl(src)
    val path = when {
      src.startsWith("file:") -> pathOfFileUrl(src) ?: return null
      src.startsWith("/") -> src
      else -> return null
    }
    return resolveFile(path)
  }

  private fun resolveDataUrl(src: String): AssetSource? {
    if (src.length > maxDataUrlChars) return null
    val comma = src.indexOf(',')
    if (comma < 0 || !src.substring(0, comma).endsWith(";base64")) return null
    return Base64AssetSource(src.substring(comma + 1))
  }

  private fun pathOfFileUrl(src: String): String? {
    try {
      val uri = URI(src)
      // file://host/... names another machine; only an empty authority is local.
      if (uri.scheme != "file" || !uri.authority.isNullOrEmpty()) return null
      return uri.path
    } catch (_: URISyntaxException) {
      return null
    }
  }

  private fun resolveFile(path: String): AssetSource? {
    if (path.indexOf('\u0000') >= 0 || !path.startsWith("/")) return null
    val canonical = try {
      File(path).canonicalFile
    } catch (_: IOException) {
      return null
    }
    val canonicalPath = canonical.path
    val isInsideRoot = roots.any { root -> canonicalPath.startsWith(root + File.separator) }
    if (!isInsideRoot || !canonical.isFile) return null
    return FileAssetSource(canonical)
  }

  companion object {
    /** 8 MiB of base64 text, about 6 MiB of image bytes. */
    const val MAX_DATA_URL_CHARS = 8 * 1024 * 1024
  }
}
