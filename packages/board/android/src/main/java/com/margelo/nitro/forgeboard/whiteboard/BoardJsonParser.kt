package com.margelo.nitro.forgeboard.whiteboard

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

/**
 * Parses the renderer's wire JSON (see `WhiteboardRenderer.nitro.ts`).
 *
 * Parsing is all-or-nothing: any malformed known record, or input over a
 * [BoardLimits] limit, throws [BoardParseException] and nothing from the
 * call is used. Records of a
 * `typeName` or shape `type` this renderer does not know are skipped, so a
 * newer QuickDraw record kind does not reject a whole document.
 */
internal object BoardJsonParser {
  private val DEFAULT_LIMITS = BoardLimits()

  /** `{ document: { store: { [id]: record } } }`. */
  fun parseSnapshot(json: String, limits: BoardLimits = DEFAULT_LIMITS): List<BoardRecord> {
    val root = parseObject(json, "snapshot", limits.maxDocumentJsonChars)
    val document = root.optJSONObject("document") ?: throw BoardParseException("snapshot.document must be an object")
    val store = document.optJSONObject("store") ?: throw BoardParseException("snapshot.document.store must be an object")
    checkRecordCount(store.length(), "snapshot", limits)
    val records = ArrayList<BoardRecord>(store.length())
    for (key in store.keys()) {
      val value = store.opt(key)
      if (value == null || value == JSONObject.NULL) continue
      val record = value as? JSONObject ?: throw BoardParseException("record \"$key\" must be an object")
      parseRecord(record, "record \"$key\"", limits)?.let { records.add(it) }
    }
    return records
  }

  /** `{ added, updated, removed }`; the first `updated` element and `removed` values are ignored. */
  fun parseDiff(json: String, limits: BoardLimits = DEFAULT_LIMITS): BoardDiff {
    val root = parseObject(json, "diff", limits.maxDocumentJsonChars)
    val added = optObject(root, "added", "diff")
    val updated = optObject(root, "updated", "diff")
    val removedObject = optObject(root, "removed", "diff")
    checkRecordCount((added?.length() ?: 0) + (updated?.length() ?: 0) + (removedObject?.length() ?: 0), "diff", limits)
    val puts = ArrayList<BoardRecord>()
    added?.let { added ->
      for (key in added.keys()) {
        val record = added.opt(key) as? JSONObject ?: throw BoardParseException("diff.added[\"$key\"] must be a record")
        parseRecord(record, "diff.added[\"$key\"]", limits)?.let { puts.add(it) }
      }
    }
    updated?.let { updated ->
      for (key in updated.keys()) {
        val pair = updated.opt(key) as? JSONArray
        if (pair == null || pair.length() != 2) throw BoardParseException("diff.updated[\"$key\"] must be a [from, to] pair")
        val to = pair.opt(1) as? JSONObject ?: throw BoardParseException("diff.updated[\"$key\"][1] must be a record")
        parseRecord(to, "diff.updated[\"$key\"][1]", limits)?.let { puts.add(it) }
      }
    }
    val removed = removedObject?.keys()?.asSequence()?.toList() ?: emptyList()
    return BoardDiff(puts, removed)
  }

  /** The headless board's `BoardOverlay` as JSON. */
  fun parseOverlay(json: String, limits: BoardLimits = DEFAULT_LIMITS): BoardOverlayState {
    val root = parseObject(json, "overlay", limits.maxOverlayJsonChars)
    val selection = when (val value = root.opt("selection")) {
      null, JSONObject.NULL -> null
      is JSONObject -> parseSelection(value, limits)
      else -> throw BoardParseException("overlay.selection must be an object")
    }
    val marquees = mapArray(root, "marquees", "overlay", limits) { item, path -> parseRect(asObject(item, path), path) }
    val lasers = mapArray(root, "laserStrokes", "overlay", limits) { item, path ->
      val stroke = asObject(item, path)
      val points = mapArray(stroke, "points", path, limits) { p, pointPath -> parsePoint(asObject(p, pointPath), pointPath) }
      val flat = DoubleArray(points.size * 2)
      points.forEachIndexed { i, p ->
        flat[i * 2] = p.x
        flat[i * 2 + 1] = p.y
      }
      val opacity = finite(stroke, "opacity", path)
      if (opacity < 0 || opacity > 1) throw BoardParseException("$path.opacity must be in [0, 1]")
      OverlayLaserStroke(flat, opacity)
    }
    val trails = mapArray(root, "eraserTrails", "overlay", limits) { item, path ->
      val trail = asObject(item, path)
      val points = numberArray(trail, "points", path, limits)
      if (points.size % 2 != 0) throw BoardParseException("$path.points must hold x, y pairs")
      points
    }
    val pending = mapArray(root, "pendingEraseIds", "overlay", limits) { item, path -> idString(item, path, limits) }.toSet()
    return BoardOverlayState(selection, marquees, lasers, trails, pending)
  }

  private fun parseSelection(value: JSONObject, limits: BoardLimits): OverlaySelection =
    when (val kind = value.opt("kind")) {
      "box" -> OverlayBoxSelection(
        ids = mapArray(value, "ids", "overlay.selection", limits) { item, path -> idString(item, path, limits) },
        bounds = parseRect(requireObject(value, "bounds", "overlay.selection"), "overlay.selection.bounds"),
        isResizable = bool(value, "isResizable", "overlay.selection"),
        isRotatable = bool(value, "isRotatable", "overlay.selection"),
      )
      "line" -> OverlayLineSelection(
        id = string(value, "id", "overlay.selection", limits),
        start = parsePoint(requireObject(value, "start", "overlay.selection"), "overlay.selection.start"),
        end = parsePoint(requireObject(value, "end", "overlay.selection"), "overlay.selection.end"),
        bend = parsePoint(requireObject(value, "bend", "overlay.selection"), "overlay.selection.bend"),
      )
      else -> throw BoardParseException("overlay.selection.kind must be \"box\" or \"line\", got $kind")
    }

  private fun parseRecord(record: JSONObject, path: String, limits: BoardLimits): BoardRecord? {
    val id = string(record, "id", path, limits)
    return when (record.opt("typeName")) {
      "asset" -> {
        // An asset src is bounded by the document length; AssetSourceResolver
        // caps what it will decode.
        val src = record.opt("src")
        if (src !is String) throw BoardParseException("$path.src must be a string")
        BoardAsset(id, src)
      }
      "shape" -> parseShape(record, id, path, limits)
      else -> null
    }
  }

  private fun parseShape(record: JSONObject, id: String, path: String, limits: BoardLimits): BoardShape? {
    val x = finite(record, "x", path)
    val y = finite(record, "y", path)
    val rot = optFinite(record, "rot", path) ?: 0.0
    val z = optFinite(record, "z", path) ?: 0.0
    val props = requireObject(record, "props", path)
    val propsPath = "$path.props"
    return when (record.opt("type")) {
      "draw" -> {
        val dash = enumOf(props, "dash", propsPath) { DashStyle.fromId(it) }
        val outline = if (dash == DashStyle.DRAW) {
          if (!record.has("inkOutline")) {
            throw BoardParseException("$path.inkOutline is required for dash \"draw\"; attach getInkOutline(record)")
          }
          numberArray(record, "inkOutline", path, limits).also {
            if (it.size % 2 != 0) throw BoardParseException("$path.inkOutline must hold x, y pairs")
          }
        } else {
          null
        }
        DrawShape(
          id, x, y, rot, z,
          color = enumOf(props, "color", propsPath) { InkColor.fromId(it) },
          size = enumOf(props, "size", propsPath) { StrokeSize.fromId(it) },
          dash = dash,
          points = triplets(props, propsPath, limits),
          inkOutline = outline,
          isDone = props.optBoolean("done", false),
        )
      }
      "highlight" -> HighlightShape(
        id, x, y, rot, z,
        color = enumOf(props, "color", propsPath) { InkColor.fromId(it) },
        size = enumOf(props, "size", propsPath) { StrokeSize.fromId(it) },
        points = triplets(props, propsPath, limits),
      )
      "geo" -> GeoShape(
        id, x, y, rot, z,
        color = enumOf(props, "color", propsPath) { InkColor.fromId(it) },
        size = enumOf(props, "size", propsPath) { StrokeSize.fromId(it) },
        dash = enumOf(props, "dash", propsPath) { DashStyle.fromId(it) },
        fill = enumOf(props, "fill", propsPath) { FillStyle.fromId(it) },
        geo = GeoKind.fromId(props.opt("geo") as? String),
        w = extent(props, "w", propsPath, limits),
        h = extent(props, "h", propsPath, limits),
        label = optString(props, "label", propsPath, limits),
        labelSize = enumOf(props, "labelSize", propsPath) { StrokeSize.fromId(it, StrokeSize.S) },
        font = enumOf(props, "font", propsPath) { BoardFont.fromId(it) },
      )
      "arrow", "line" -> ConnectorShape(
        id, x, y, rot, z,
        color = enumOf(props, "color", propsPath) { InkColor.fromId(it) },
        size = enumOf(props, "size", propsPath) { StrokeSize.fromId(it) },
        dash = enumOf(props, "dash", propsPath) { DashStyle.fromId(it) },
        dx = finite(props, "dx", propsPath),
        dy = finite(props, "dy", propsPath),
        bend = optFinite(props, "bend", propsPath) ?: 0.0,
        hasArrowHead = record.opt("type") == "arrow",
      )
      "text" -> {
        val autosize = props.opt("autosize")
        val w = optFinite(props, "w", propsPath)
        TextShape(
          id, x, y, rot, z,
          color = enumOf(props, "color", propsPath) { InkColor.fromId(it) },
          size = enumOf(props, "size", propsPath) { StrokeSize.fromId(it) },
          scale = scale(props, propsPath),
          font = enumOf(props, "font", propsPath) { BoardFont.fromId(it) },
          text = optString(props, "text", propsPath, limits),
          align = enumOf(props, "align", propsPath) { TextAlign.fromId(it) },
          fixedWidth = if (autosize == false && w != null && w != 0.0) w.coerceIn(-limits.maxExtent, limits.maxExtent) else null,
        )
      }
      "note" -> NoteShape(
        id, x, y, rot, z,
        color = enumOf(props, "color", propsPath) { InkColor.fromId(it) },
        size = enumOf(props, "size", propsPath) { StrokeSize.fromId(it) },
        scale = scale(props, propsPath),
        font = enumOf(props, "font", propsPath) { BoardFont.fromId(it) },
        text = optString(props, "text", propsPath, limits),
      )
      "image" -> ImageShape(
        id, x, y, rot, z,
        w = extent(props, "w", propsPath, limits),
        h = extent(props, "h", propsPath, limits),
        assetId = optString(props, "assetId", propsPath, limits),
      )
      else -> null
    }
  }

  private fun parseObject(json: String, what: String, maxChars: Int): JSONObject {
    if (json.length > maxChars) throw BoardParseException("$what is ${json.length} characters; the limit is $maxChars")
    try {
      val value = JSONTokener(json).nextValue()
      return value as? JSONObject ?: throw BoardParseException("$what must be a JSON object")
    } catch (error: JSONException) {
      throw BoardParseException("$what is not valid JSON: ${error.message}", error)
    }
  }

  private fun parseRect(value: JSONObject, path: String): BoardRect =
    BoardRect(finite(value, "x", path), finite(value, "y", path), finite(value, "w", path), finite(value, "h", path))

  private fun parsePoint(value: JSONObject, path: String): BoardPoint = BoardPoint(finite(value, "x", path), finite(value, "y", path))

  private fun asObject(value: Any?, path: String): JSONObject = value as? JSONObject ?: throw BoardParseException("$path must be an object")

  private fun requireObject(obj: JSONObject, key: String, path: String): JSONObject =
    obj.opt(key) as? JSONObject ?: throw BoardParseException("$path.$key must be an object")

  private fun optObject(obj: JSONObject, key: String, path: String): JSONObject? =
    when (val value = obj.opt(key)) {
      null, JSONObject.NULL -> null
      is JSONObject -> value
      else -> throw BoardParseException("$path.$key must be an object")
    }

  private fun <T> mapArray(obj: JSONObject, key: String, path: String, limits: BoardLimits, map: (Any?, String) -> T): List<T> {
    val array = when (val value = obj.opt(key)) {
      null, JSONObject.NULL -> return emptyList()
      is JSONArray -> value
      else -> throw BoardParseException("$path.$key must be an array")
    }
    if (array.length() > limits.maxArrayItems) {
      throw BoardParseException("$path.$key has ${array.length()} items; the limit is ${limits.maxArrayItems}")
    }
    return List(array.length()) { i -> map(array.opt(i), "$path.$key[$i]") }
  }

  private fun numberArray(obj: JSONObject, key: String, path: String, limits: BoardLimits): DoubleArray {
    val array = obj.opt(key) as? JSONArray ?: throw BoardParseException("$path.$key must be an array of numbers")
    if (array.length() > limits.maxArrayNumbers) {
      throw BoardParseException("$path.$key has ${array.length()} numbers; the limit is ${limits.maxArrayNumbers}")
    }
    return DoubleArray(array.length()) { i ->
      val value = (array.opt(i) as? Number)?.toDouble()
      if (value == null || !value.isFinite()) throw BoardParseException("$path.$key[$i] must be a finite number")
      value
    }
  }

  private fun triplets(props: JSONObject, path: String, limits: BoardLimits): DoubleArray {
    val pts = numberArray(props, "pts", path, limits)
    if (pts.isEmpty() || pts.size % 3 != 0) throw BoardParseException("$path.pts must hold x, y, pressure triplets")
    return pts
  }

  private fun finite(obj: JSONObject, key: String, path: String): Double =
    optFinite(obj, key, path) ?: throw BoardParseException("$path.$key must be a finite number")

  private fun optFinite(obj: JSONObject, key: String, path: String): Double? {
    val value = obj.opt(key)
    if (value == null || value == JSONObject.NULL) return null
    val number = (value as? Number)?.toDouble()
    if (number == null || !number.isFinite()) throw BoardParseException("$path.$key must be a finite number")
    return number
  }

  private fun nonNegative(obj: JSONObject, key: String, path: String): Double {
    val value = finite(obj, key, path)
    if (value < 0) throw BoardParseException("$path.$key must be >= 0")
    return value
  }

  /** A non-negative size, clamped to [BoardLimits.maxExtent]. */
  private fun extent(obj: JSONObject, key: String, path: String, limits: BoardLimits): Double =
    nonNegative(obj, key, path).coerceAtMost(limits.maxExtent)

  private fun checkRecordCount(count: Int, what: String, limits: BoardLimits) {
    if (count > limits.maxRecords) throw BoardParseException("$what has $count records; the limit is ${limits.maxRecords}")
  }

  private fun checkTextLength(value: String, path: String, limits: BoardLimits): String {
    if (value.length > limits.maxTextChars) {
      throw BoardParseException("$path is ${value.length} characters; the limit is ${limits.maxTextChars}")
    }
    return value
  }

  private fun idString(item: Any?, path: String, limits: BoardLimits): String {
    val value = item as? String ?: throw BoardParseException("$path must be a string")
    return checkTextLength(value, path, limits)
  }

  /** QuickDraw's `p.scale || 1`. */
  private fun scale(props: JSONObject, path: String): Double {
    val value = optFinite(props, "scale", path) ?: return 1.0
    if (value < 0) throw BoardParseException("$path.scale must be >= 0")
    return if (value == 0.0) 1.0 else value
  }

  private fun string(obj: JSONObject, key: String, path: String, limits: BoardLimits): String {
    val value = obj.opt(key)
    if (value !is String || value.isEmpty()) throw BoardParseException("$path.$key must be a non-empty string")
    return checkTextLength(value, "$path.$key", limits)
  }

  private fun optString(obj: JSONObject, key: String, path: String, limits: BoardLimits): String =
    when (val value = obj.opt(key)) {
      null, JSONObject.NULL -> ""
      is String -> checkTextLength(value, "$path.$key", limits)
      else -> throw BoardParseException("$path.$key must be a string")
    }

  private fun bool(obj: JSONObject, key: String, path: String): Boolean =
    obj.opt(key) as? Boolean ?: throw BoardParseException("$path.$key must be a boolean")

  private fun <T> enumOf(obj: JSONObject, key: String, path: String, lookup: (String?) -> T?): T {
    val raw = when (val value = obj.opt(key)) {
      null, JSONObject.NULL -> null
      is String -> value
      else -> throw BoardParseException("$path.$key must be a string")
    }
    return lookup(raw) ?: throw BoardParseException("$path.$key has unknown value \"$raw\"")
  }
}
