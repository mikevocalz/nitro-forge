package com.margelo.nitro.forgeboard.whiteboard

/** A `data:...;base64,` URL; [payload] is the base64 text after the comma. */
internal class Base64AssetSource(val payload: String) : AssetSource
