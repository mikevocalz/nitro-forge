plugins {
  kotlin("jvm") version "2.2.21"
}
repositories { mavenCentral() }
dependencies {
  testImplementation("junit:junit:4.13.2")
  // Production JSON parser uses org.json, not fake Android JSON stubs.
  implementation("org.json:json:20250517")
}
val plainSource = listOf(
  "BoardGeometry", "GeoKind", "BoardRect", "BoardPoint",
  "SeededRandom", "PathSink", "RevisionGate",
  "BoardLimits", "BoardParseException", "DrawFailures",
  "BoardRecord", "BoardShape", "BoardAsset", "BoardDiff", "BoardDocument",
  "BoardJsonParser", "InkColor", "StrokeSize", "DashStyle", "FillStyle",
  "BoardFont", "TextAlign", "TextMeasurer", "TextBlockLayout",
  "TextLayoutEngine", "TextLine", "ShapeBounds", "ShapeGeometry", "BoardPalette",
  "DrawShape", "HighlightShape", "GeoShape", "ConnectorShape",
  "ImageShape", "NoteShape", "TextShape", "PlacedShape",
  "BoardOverlayState", "OverlaySelection", "OverlayBoxSelection",
  "OverlayLineSelection", "OverlayLaserStroke"
)
val plainTests = listOf(
  "BoardGeometryTest", "SeededRandomTest", "RevisionGateTest",
  "BoardDocumentTest", "BoardJsonParserTest", "BoardLimitsTest",
  "ShapeGeometryTest", "ShapeBoundsTest", "TextLayoutEngineTest",
  "RecordingPathSink", "ExpectThrows", "FixedWidthMeasurer"
)
sourceSets {
  main {
    kotlin.srcDir("../../packages/board/android/src/main/java")
    kotlin.include(*plainSource.map { "**/$it.kt" }.toTypedArray())
  }
  test {
    kotlin.srcDir("../../packages/board/android/src/test/java")
    kotlin.include(*plainTests.map { "**/$it.kt" }.toTypedArray())
  }
}
tasks.test {
  useJUnit()
  testLogging { events("passed", "skipped", "failed") }
}
