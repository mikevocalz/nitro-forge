package com.margelo.nitro.forgeboard.whiteboard

import java.io.File

/** A regular file inside one of the app's own directories, as a canonical path. */
internal class FileAssetSource(val file: File) : AssetSource
