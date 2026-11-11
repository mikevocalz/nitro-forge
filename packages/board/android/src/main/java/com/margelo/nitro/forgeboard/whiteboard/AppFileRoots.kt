package com.margelo.nitro.forgeboard.whiteboard

import android.util.Log
import com.margelo.nitro.NitroModules
import java.io.File

/** The directories image assets may be read from: the app's `cacheDir` and `filesDir`. */
internal object AppFileRoots {
  /** Empty when Nitro has no application context yet; then only `data:` assets decode. */
  fun current(): List<File> {
    val context = NitroModules.applicationContext
    if (context == null) {
      Log.w("WhiteboardRenderer", "No application context; file image assets will draw placeholders")
      return emptyList()
    }
    return listOf(context.cacheDir, context.filesDir)
  }
}
