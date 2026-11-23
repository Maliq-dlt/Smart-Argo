package id.smartagro.app

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.time.Instant

class OverviewCacheTest {
    @Test fun roundTripAccountIsolationClearAndCorruptCache() {
        val root=File("tests/runtime").apply { mkdirs() }
        val dir=java.nio.file.Files.createTempDirectory(root.toPath(),"overview-").toFile()
        try {
            val cache=OverviewCache(dir)
            val at=Instant.parse("2026-11-23T07:30:00Z")
            cache.save("https://one:user-a", """{"ok":true}""", at)
            assertEquals(OverviewCache.Cached("""{"ok":true}""",at),cache.load("https://one:user-a"))
            assertNull(cache.load("https://one:user-b"))
            assertNull(cache.load("https://two:user-a"))
            cache.clear()
            assertNull(cache.load("https://one:user-a"))
            cache.save("a","{}",at)
            dir.listFiles()!!.single().writeText("broken")
            assertNull(cache.load("a"))
        } finally { dir.deleteRecursively() }
    }
}
