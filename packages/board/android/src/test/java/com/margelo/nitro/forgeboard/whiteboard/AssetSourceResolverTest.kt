package com.margelo.nitro.forgeboard.whiteboard

import java.io.File
import java.nio.file.Files
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class AssetSourceResolverTest {
  private lateinit var base: File
  private lateinit var cache: File
  private lateinit var files: File
  private lateinit var outside: File
  private lateinit var resolver: AssetSourceResolver

  @Before
  fun setUp() {
    base = Files.createTempDirectory("asset-resolver").toFile().canonicalFile
    cache = File(base, "cache").apply { mkdirs() }
    files = File(base, "files").apply { mkdirs() }
    outside = File(base, "cache2").apply { mkdirs() }
    resolver = AssetSourceResolver(fileRoots = listOf(cache, files), maxDataUrlChars = 64)
  }

  @After
  fun tearDown() {
    base.deleteRecursively()
  }

  private fun touch(dir: File, name: String): File = File(dir, name).apply { writeBytes(byteArrayOf(1, 2, 3)) }

  @Test
  fun acceptsBase64DataUrls() {
    val source = resolver.resolve("data:image/png;base64,AAAA") as Base64AssetSource
    assertEquals("AAAA", source.payload)
  }

  @Test
  fun rejectsDataUrlsThatAreNotBase64OrTooLong() {
    assertNull(resolver.resolve("data:image/svg+xml,<svg/>"))
    assertNull(resolver.resolve("data:image/png;base64"))
    assertNull(resolver.resolve("data:image/png;base64," + "A".repeat(64)))
  }

  @Test
  fun acceptsRegularFilesUnderTheAppDirectories() {
    val inCache = touch(cache, "a.png")
    val inFiles = touch(File(files, "nested").apply { mkdirs() }, "b.png")
    assertEquals(inCache, (resolver.resolve("file://${inCache.path}") as FileAssetSource).file)
    assertEquals(inFiles, (resolver.resolve(inFiles.path) as FileAssetSource).file)
  }

  @Test
  fun decodesPercentEscapesInFileUrls() {
    val spaced = touch(cache, "a b.png")
    assertEquals(spaced, (resolver.resolve("file://${cache.path}/a%20b.png") as FileAssetSource).file)
  }

  @Test
  fun rejectsFilesOutsideTheAppDirectories() {
    val elsewhere = touch(outside, "x.png")
    assertNull("sibling directory sharing the root's prefix", resolver.resolve(elsewhere.path))
    assertNull("dot-dot escape", resolver.resolve("${cache.path}/../cache2/x.png"))
    assertNull("dot-dot escape in a URL", resolver.resolve("file://${cache.path}/..%2Fcache2/x.png"))
  }

  @Test
  fun rejectsASymlinkThatLeavesTheAppDirectories() {
    val target = touch(outside, "secret.png")
    val link = File(cache, "link.png")
    Files.createSymbolicLink(link.toPath(), target.toPath())
    assertNull(resolver.resolve(link.path))
  }

  @Test
  fun rejectsDirectoriesMissingFilesAndOtherSchemes() {
    assertNull(resolver.resolve(cache.path))
    assertNull(resolver.resolve("${cache.path}/missing.png"))
    assertNull(resolver.resolve("https://example.com/a.png"))
    assertNull(resolver.resolve("content://media/external/images/1"))
    assertNull(resolver.resolve("file://host${cache.path}/a.png"))
    assertNull(resolver.resolve("relative/a.png"))
    assertNull(resolver.resolve("${cache.path}/a\u0000.png"))
  }

  @Test
  fun allowsNoFilesWithoutRoots() {
    val inCache = touch(cache, "a.png")
    val noRoots = AssetSourceResolver(fileRoots = emptyList(), maxDataUrlChars = 64)
    assertNull(noRoots.resolve(inCache.path))
    assertTrue(noRoots.resolve("data:image/png;base64,AAAA") is Base64AssetSource)
  }

  @Test
  fun budgetCountsSampledArgbBytesAndRefusesOverruns() {
    assertEquals(1024L * 512 * 4, BitmapBudget.estimatedBytes(widthPx = 2048, heightPx = 1024, sampleSize = 2))
    assertEquals(0L, BitmapBudget.estimatedBytes(widthPx = -1, heightPx = 10, sampleSize = 1))
    val budget = BitmapBudget(maxBytes = 1000)
    assertTrue(budget.fits(currentBytes = 600, nextBytes = 400))
    assertTrue(!budget.fits(currentBytes = 600, nextBytes = 401))
    assertTrue("an unknown size never fits", !budget.fits(currentBytes = 0, nextBytes = 0))
  }
}
