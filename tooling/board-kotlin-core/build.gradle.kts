plugins {
  kotlin("jvm") version "2.2.21"
}
repositories { mavenCentral() }
dependencies {
  testImplementation("junit:junit:4.13.2")
}
sourceSets {
  main {
    kotlin.srcDir("../../packages/board/android/src/main/java")
    kotlin.include(
      "**/BoardGeometry.kt", "**/GeoKind.kt", "**/BoardRect.kt",
      "**/SeededRandom.kt", "**/PathSink.kt", "**/RevisionGate.kt"
    )
  }
  test {
    kotlin.srcDir("../../packages/board/android/src/test/java")
    kotlin.include(
      "**/BoardGeometryTest.kt", "**/SeededRandomTest.kt",
      "**/RevisionGateTest.kt", "**/RecordingPathSink.kt", "**/ExpectThrows.kt"
    )
  }
}
tasks.test {
  useJUnit()
  testLogging { events("passed", "skipped", "failed") }
}
