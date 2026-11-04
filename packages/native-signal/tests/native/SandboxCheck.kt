// Host-side check for WavPeaks.sandboxLocal and analyze. CI appends this to
// the WavPeaks object extracted from ForgeSignalModule.kt and runs it on the JVM.
fun main() {
  val tmp = Files.createTempDirectory("sbx").toFile()
  val cache = File(tmp, "cache").apply { mkdirs() }; File(cache, "rec").mkdirs()
  val files = File(tmp, "files").apply { mkdirs() }
  val sib = File(tmp, "cache2").apply { mkdirs() }
  val b = ByteBuffer.allocate(52).order(ByteOrder.LITTLE_ENDIAN)
  b.put("RIFF".toByteArray()).putInt(44).put("WAVEfmt ".toByteArray()).putInt(16).putShort(1).putShort(1)
   .putInt(8000).putInt(16000).putShort(2).putShort(16).put("data".toByteArray()).putInt(8)
  listOf(-16384, 0, 8192, 16384).forEach { b.putShort(it.toShort()) }
  val good = File(cache, "rec/a.wav").apply { writeBytes(b.array()) }
  val out = File(sib, "b.wav").apply { writeBytes(b.array()) }
  val link = File(cache, "link.wav"); Files.createSymbolicLink(link.toPath(), out.toPath())
  val roots = listOf(cache, files)
  fun ok(u: String) = runCatching { WavPeaks.sandboxLocal(u, roots) }.isSuccess
  var fails = 0
  fun check(n: String, c: Boolean) { println((if (c) "PASS " else "FAIL ") + n); if (!c) fails++ }
  check("inside accepted", ok(good.toURI().toString()))
  check("sibling prefix rejected", !ok(out.toURI().toString()))
  check("traversal rejected", !ok("file://" + cache.path + "/rec/../../cache2/b.wav"))
  check("symlink escape rejected", !ok(link.toURI().toString()))
  check("root itself rejected", !ok(cache.toURI().toString()))
  check("non-file scheme rejected", !ok("https://example.com/a.wav"))
  check("/etc rejected", !ok("file:///etc/hosts"))
  val peaks = WavPeaks.analyze(good.toURI().toString(), 2, roots)
  check("analyze inside returns peaks $peaks", peaks == listOf(listOf(-0.5, 0.0), listOf(0.25, 0.5)))
  tmp.deleteRecursively()
  kotlin.system.exitProcess(if (fails == 0) 0 else 1)
}
